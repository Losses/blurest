use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context as AnyhowContext, Result};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use blurhash::{decode as blurhash_decode, encode};
use diesel::{SqliteConnection, connection::SimpleConnection, prelude::*};
use image::GenericImageView;
use log::{debug, info, warn};
use xxhash_rust::xxh3::xxh3_64;

use crate::{
    models::{BlurhashCache, NewBlurhashCache},
    schema::blurhash_cache,
};

/// Application context containing database connection and project root path
pub struct AppContext {
    pub db_conn: SqliteConnection,
    pub project_root: PathBuf,
}

/// The side length (in pixels) of the square placeholder rendered from a blurhash.
///
/// Matches the web component's blurhash decode base size so the baked WebP is a
/// direct replacement for the client-side CSS gradient render.
const PLACEHOLDER_SIZE: u32 = 32;

/// libwebp lossy quality used when baking the placeholder WebP.
const WEBP_QUALITY: f32 = 20.0;

/// libwebp compression effort / `method` (0 = fastest, 6 = slowest, smallest output).
const WEBP_METHOD: i32 = 6;

#[derive(Debug)]
pub struct BlurhashData {
    pub blurhash: String,
    pub width: i32,
    pub height: i32,
    /// Base64-encoded lossy WebP render of the blurhash placeholder, if it could be baked.
    pub webp_base64: Option<String>,
}

/// Outcome of a WebP placeholder backfill migration.
#[derive(Debug, Default, Clone, Copy)]
pub struct WebpMigrationResult {
    /// Number of cache rows that received a freshly baked WebP placeholder.
    pub processed: u64,
    /// Number of cache rows whose WebP bake failed and were left untouched.
    pub skipped: u64,
}

/// SQL migrations for creating the blurhash cache table and triggers.
///
/// Uses `IF NOT EXISTS` so it is safe to run on every connection, regardless of
/// whether the database is fresh or pre-existing.
const MIGRATIONS_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS blurhash_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    relative_path TEXT NOT NULL UNIQUE,
    xxhash TEXT NOT NULL,
    mtime_ms BIGINT NOT NULL,
    blurhash TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    webp_base64 TEXT
);

CREATE TRIGGER IF NOT EXISTS trigger_blurhash_cache_updated_at
AFTER UPDATE ON blurhash_cache
FOR EACH ROW
BEGIN
    UPDATE blurhash_cache SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
"#;

/// Returns `true` if `column` exists on the `blurhash_cache` table.
///
/// Probes with a zero-row `SELECT` so no data is read; SQLite resolves columns at
/// planning time, so a missing column fails with a stable `"no such column"` error
/// before any row would be considered.
///
/// The column is referenced with a table qualifier (`blurhash_cache.<col>`) rather
/// than double quotes: SQLite would otherwise treat an unknown `"col"` as a string
/// literal and report success, masking a genuinely missing column.
fn column_exists(conn: &mut SqliteConnection, column: &str) -> Result<bool> {
    let sql = format!("SELECT blurhash_cache.{column} FROM blurhash_cache LIMIT 0;");
    match diesel::sql_query(&sql).execute(conn) {
        Ok(_) => Ok(true),
        Err(diesel::result::Error::DatabaseError(_, info)) => {
            Ok(!info.message().to_lowercase().contains("no such column"))
        }
        Err(e) => Err(e).with_context(|| "failed to inspect blurhash_cache schema"),
    }
}

/// Runs all migrations against the connection.
///
/// This is idempotent and runs on every connection so that existing user databases
/// pick up new columns (e.g. `webp_base64`) without a separate migration step.
fn run_migrations(conn: &mut SqliteConnection) -> Result<()> {
    conn.batch_execute(MIGRATIONS_SQL)
        .with_context(|| "Failed to run blurhash_cache migrations")?;

    // Databases created before the `webp_base64` column shipped need it added.
    // `CREATE TABLE IF NOT EXISTS` above is a no-op for them, so handle the upgrade here.
    if !column_exists(conn, "webp_base64")? {
        info!("Migration: adding webp_base64 column to blurhash_cache");
        conn.batch_execute("ALTER TABLE blurhash_cache ADD COLUMN webp_base64 TEXT;")
            .with_context(|| "Failed to add webp_base64 column")?;
    }

    Ok(())
}

/// Initializes the database and returns a connection.
///
/// Migrations always run (they are idempotent), so both fresh and pre-existing
/// databases end up with the current schema.
pub fn initialize_and_connect_db(database_url: &str) -> Result<SqliteConnection> {
    let db_path = Path::new(database_url);
    if !db_path.exists() {
        info!("Database file not found, creating and running migrations");
    }

    let mut conn = SqliteConnection::establish(database_url)
        .with_context(|| format!("Error connecting to or creating database at {database_url}"))?;

    run_migrations(&mut conn)?;

    if db_path.exists() {
        debug!("Database migrations complete for {database_url}");
    } else {
        info!("Database initialized successfully");
    }

    Ok(conn)
}

/// Converts SystemTime to Unix timestamp in milliseconds
fn time_to_ms(time: SystemTime) -> Result<i64> {
    let duration = time.duration_since(UNIX_EPOCH)?;
    Ok(duration.as_millis() as i64)
}

/// Bake a 32×32 lossy WebP placeholder from a blurhash string and return it
/// base64-encoded.
///
/// The blurhash is decoded into a square PLACEHOLDER_SIZE×PLACEHOLDER_SIZE RGBA
/// buffer, then encoded with libwebp (`quality = 20`, `method = 6`). Returns
/// `None` on any decoding/encoding failure so that blurhash generation never
/// fails solely because the WebP bake could not be produced.
fn blurhash_to_webp_base64(blurhash_str: &str) -> Option<String> {
    let rgba = match blurhash_decode(blurhash_str, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, 1.0) {
        Ok(data) => data,
        Err(e) => {
            warn!("Failed to decode blurhash for WebP bake: {e}");
            return None;
        }
    };

    match encode_webp_placeholder(&rgba, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE) {
        Ok(webp_bytes) => Some(BASE64_STANDARD.encode(&webp_bytes)),
        Err(e) => {
            warn!("Failed to encode WebP placeholder: {e}");
            None
        }
    }
}

/// Encode an RGBA buffer as a lossy WebP (`quality = WEBP_QUALITY`, `method = WEBP_METHOD`).
fn encode_webp_placeholder(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    use libwebp_sys::{
        WebPConfig, WebPConfigInit, WebPEncode, WebPMemoryWrite, WebPMemoryWriter,
        WebPMemoryWriterClear, WebPMemoryWriterInit, WebPPicture, WebPPictureFree,
        WebPPictureImportRGBA, WebPPictureInit, WebPValidateConfig,
    };
    use std::mem::MaybeUninit;
    use std::os::raw::{c_int, c_void};

    unsafe {
        let mut config: WebPConfig = MaybeUninit::<WebPConfig>::zeroed().assume_init();
        if WebPConfigInit(&mut config) == 0 {
            anyhow::bail!("WebPConfigInit failed");
        }
        config.lossless = 0;
        config.quality = WEBP_QUALITY;
        config.method = WEBP_METHOD;
        if WebPValidateConfig(&config) == 0 {
            anyhow::bail!("WebPValidateConfig rejected the encode configuration");
        }

        let mut pic: WebPPicture = MaybeUninit::<WebPPicture>::zeroed().assume_init();
        if WebPPictureInit(&mut pic) == 0 {
            anyhow::bail!("WebPPictureInit failed");
        }
        pic.use_argb = 1;
        pic.width = width as c_int;
        pic.height = height as c_int;
        if WebPPictureImportRGBA(&mut pic, rgba.as_ptr(), (width as c_int) * 4) == 0 {
            anyhow::bail!("WebPPictureImportRGBA failed");
        }

        let mut writer: WebPMemoryWriter = MaybeUninit::<WebPMemoryWriter>::zeroed().assume_init();
        WebPMemoryWriterInit(&mut writer);
        /// Safe trampoline matching libwebp's expected `WebPPicture.writer` signature.
        extern "C" fn memory_writer(
            data: *const u8,
            data_size: usize,
            picture: *const WebPPicture,
        ) -> c_int {
            unsafe { WebPMemoryWrite(data, data_size, picture) }
        }
        pic.writer = Some(memory_writer);
        pic.custom_ptr = &mut writer as *mut WebPMemoryWriter as *mut c_void;

        let ok = WebPEncode(&config, &mut pic);
        WebPPictureFree(&mut pic);

        if ok == 0 {
            WebPMemoryWriterClear(&mut writer);
            anyhow::bail!("WebPEncode failed");
        }

        let bytes = std::slice::from_raw_parts(writer.mem, writer.size).to_vec();
        WebPMemoryWriterClear(&mut writer);
        Ok(bytes)
    }
}

/// Persist a freshly-baked WebP placeholder onto an existing cache row.
///
/// Used for lazy backfill: when a cache hit returns a row that pre-dates the
/// `webp_base64` column, the placeholder is baked from the cached blurhash and
/// written back so subsequent reads skip the work.
fn persist_webp_for_row(
    conn: &mut SqliteConnection,
    row_id: i32,
    relative_path: &str,
    blurhash: &str,
) -> Option<String> {
    let webp = blurhash_to_webp_base64(blurhash)?;
    if let Err(e) = diesel::update(blurhash_cache::table.filter(blurhash_cache::id.eq(row_id)))
        .set(blurhash_cache::webp_base64.eq(&webp))
        .execute(conn)
    {
        warn!("Failed to persist baked WebP placeholder for {relative_path}: {e}");
    }
    Some(webp)
}

/// Gets the blurhash for an image with intelligent caching.
///
/// This function implements a two-tier caching strategy:
/// 1. First checks modification time (mtime) for quick validation
/// 2. Falls back to content hash (xxhash) verification if mtime differs
///
/// Alongside the blurhash it also ensures a baked WebP placeholder exists
/// (lazily back-filled for rows that pre-date the `webp_base64` column).
///
/// # Arguments
/// * `context` - Application context containing database connection and project root
/// * `image_path` - Path to the image file
///
/// # Returns
/// * `Result<BlurhashData>` - A struct containing the blurhash string, width, height,
///   and an optional base64 WebP placeholder, or an error
pub fn get_blurhash_with_cache(
    context: &mut AppContext,
    image_path: &Path,
) -> Result<BlurhashData> {
    let absolute_path = fs::canonicalize(image_path)
        .with_context(|| format!("Failed to find file at: {image_path:?}"))?;

    let relative_key = absolute_path
        .strip_prefix(&context.project_root)
        .with_context(|| "Image path is not within the project root.")?
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Path contains non-UTF8 characters"))?
        .to_string();

    let metadata = fs::metadata(&absolute_path)?;
    let current_mtime_ms = time_to_ms(metadata.modified()?)?;

    let cached_entry = blurhash_cache::table
        .filter(blurhash_cache::relative_path.eq(&relative_key))
        .select(BlurhashCache::as_select())
        .first::<BlurhashCache>(&mut context.db_conn)
        .optional()?;

    if let Some(cache) = cached_entry {
        if current_mtime_ms == cache.mtime_ms {
            debug!("Cache hit: mtime match for {relative_key}");
            let webp_base64 = cache.webp_base64.clone().or_else(|| {
                debug!("Lazy backfill: baking WebP placeholder for {relative_key}");
                persist_webp_for_row(
                    &mut context.db_conn,
                    cache.id,
                    &relative_key,
                    &cache.blurhash,
                )
            });
            return Ok(BlurhashData {
                blurhash: cache.blurhash,
                width: cache.width,
                height: cache.height,
                webp_base64,
            });
        }

        let file_bytes = fs::read(&absolute_path)?;
        let current_xxhash_val = xxh3_64(&file_bytes);
        let current_xxhash_str = hex::encode(current_xxhash_val.to_be_bytes());

        if current_xxhash_str == cache.xxhash {
            debug!("Cache hit: content unchanged, updating mtime for {relative_key}");
            let webp_base64 = cache
                .webp_base64
                .clone()
                .or_else(|| blurhash_to_webp_base64(&cache.blurhash));
            diesel::update(&cache)
                .set((
                    blurhash_cache::mtime_ms.eq(current_mtime_ms),
                    blurhash_cache::webp_base64.eq(webp_base64.as_deref()),
                ))
                .execute(&mut context.db_conn)?;
            return Ok(BlurhashData {
                blurhash: cache.blurhash,
                width: cache.width,
                height: cache.height,
                webp_base64,
            });
        }

        warn!("Cache stale: content changed for {relative_key}");
        let (new_blurhash, _, new_width, new_height, new_webp) =
            calculate_blurhash_hash_and_webp(&file_bytes)?;

        diesel::update(&cache)
            .set((
                blurhash_cache::xxhash.eq(current_xxhash_str),
                blurhash_cache::mtime_ms.eq(current_mtime_ms),
                blurhash_cache::blurhash.eq(&new_blurhash),
                blurhash_cache::width.eq(new_width as i32),
                blurhash_cache::height.eq(new_height as i32),
                blurhash_cache::webp_base64.eq(new_webp.as_deref()),
            ))
            .execute(&mut context.db_conn)?;

        return Ok(BlurhashData {
            blurhash: new_blurhash,
            width: new_width as i32,
            height: new_height as i32,
            webp_base64: new_webp,
        });
    }

    info!("Cache miss: new file {relative_key}");
    let file_bytes = fs::read(&absolute_path)?;
    let (new_blurhash, new_xxhash_str, new_width, new_height, new_webp) =
        calculate_blurhash_hash_and_webp(&file_bytes)?;

    let new_cache_entry = NewBlurhashCache {
        relative_path: &relative_key,
        xxhash: &new_xxhash_str,
        mtime_ms: current_mtime_ms,
        blurhash: &new_blurhash,
        width: new_width as i32,
        height: new_height as i32,
        webp_base64: new_webp.as_deref(),
    };

    diesel::insert_into(blurhash_cache::table)
        .values(&new_cache_entry)
        .execute(&mut context.db_conn)?;

    Ok(BlurhashData {
        blurhash: new_blurhash,
        width: new_width as i32,
        height: new_height as i32,
        webp_base64: new_webp,
    })
}

/// Helper function that encapsulates blurhash, xxhash, dimension, and WebP
/// placeholder calculation logic.
///
/// # Arguments
/// * `file_bytes` - Raw image file bytes
///
/// # Returns
/// * `Result<(String, String, u32, u32, Option<String>)>` - Tuple of
///   (blurhash, xxhash_hex, width, height, webp_base64) or error
fn calculate_blurhash_hash_and_webp(
    file_bytes: &[u8],
) -> Result<(String, String, u32, u32, Option<String>)> {
    let hash_val = xxh3_64(file_bytes);
    let hash_str = hex::encode(hash_val.to_be_bytes());

    let img = image::load_from_memory(file_bytes)?;
    let (width, height) = img.dimensions();
    let rgba_data = img.to_rgba8().into_vec();

    let blurhash_str = encode(4, 3, width, height, &rgba_data)?;
    let webp_base64 = blurhash_to_webp_base64(&blurhash_str);

    Ok((blurhash_str, hash_str, width, height, webp_base64))
}

/// How many leading bytes of a file to read when falling back to SVG text
/// sniffing. Format headers and realistic SVG root elements live well within
/// this bound.
const SVG_SNIFF_LIMIT: u64 = 64 * 1024;

/// Read the intrinsic pixel dimensions of an image file without decoding it.
///
/// Raster formats go through the `image` crate's header-only `into_dimensions`,
/// the same decoder registry the blurhash path uses, so format coverage is
/// identical (PNG/JPEG/GIF/WebP/BMP/TIFF/...). SVG, which the `image` crate
/// cannot read, falls back to sniffing the root `<svg>` element for absolute
/// `width`/`height` attributes or a `viewBox`.
///
/// Returns `Err` when the file is unreadable, the format is unknown, or (for
/// SVG) no absolute dimension pair can be derived.
pub fn probe_image_dimensions(path: &Path) -> Result<(u32, u32)> {
    match probe_raster_dimensions(path) {
        Ok(dimensions) => Ok(dimensions),
        // Surface the raster error when SVG sniffing cannot answer either;
        // it is usually the more informative of the two failures.
        Err(raster_error) => probe_svg_dimensions(path).ok_or(raster_error),
    }
}

/// Header-only dimension probe for the raster formats the `image` crate knows.
fn probe_raster_dimensions(path: &Path) -> Result<(u32, u32)> {
    let reader = image::ImageReader::open(path)
        .with_context(|| format!("Failed to open file at: {path:?}"))?;
    let reader = reader
        .with_guessed_format()
        .with_context(|| format!("Failed to read header of: {path:?}"))?;
    let (width, height) = reader
        .into_dimensions()
        .with_context(|| format!("Failed to parse image header of: {path:?}"))?;
    Ok((width, height))
}

/// Sniff intrinsic dimensions from the root `<svg>` element of a file.
///
/// Absolute `width`/`height` attributes win; otherwise a `viewBox` supplies
/// the intrinsic size, mirroring how a browser sizes an SVG without explicit
/// dimensions. Percentages, relative units (`em`/`rem`) and unitless
/// non-numeric values yield `None`.
fn probe_svg_dimensions(path: &Path) -> Option<(u32, u32)> {
    let head = read_file_head(path, SVG_SNIFF_LIMIT)?;
    let text = String::from_utf8_lossy(&head);
    let tag = svg_root_tag(&text)?;

    let width = svg_attr_px(&tag, "width");
    let height = svg_attr_px(&tag, "height");
    if let (Some(width), Some(height)) = (width, height) {
        return Some((width, height));
    }

    let view_box = svg_attr(&tag, "viewbox")?;
    let mut parts = view_box.split(|c: char| c.is_whitespace() || c == ',');
    let min_x = parts.next()?.parse::<f64>().ok()?;
    let min_y = parts.next()?.parse::<f64>().ok()?;
    let vb_width = parts.next()?.parse::<f64>().ok()?;
    let vb_height = parts.next()?.parse::<f64>().ok()?;
    let side = |min: f64, size: f64| min.is_finite() && size.is_finite() && size >= 0.5;
    if !side(min_x, vb_width) || !side(min_y, vb_height) {
        return None;
    }
    Some((vb_width.round() as u32, vb_height.round() as u32))
}

/// Read up to `limit` leading bytes of a file.
fn read_file_head(path: &Path, limit: u64) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut buf = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(limit)
        .read_to_end(&mut buf)
        .ok()?;
    Some(buf)
}

/// Extract the root `<svg ...>` start tag, lowercased.
///
/// Attribute values containing `>` are not supported (rare in the root tag,
/// and always legal to rewrite); matching stops at the first `>`.
fn svg_root_tag(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    let start = lower.find("<svg")?;
    let after = lower[start + 4..].chars().next()?;
    if !after.is_whitespace() && after != '>' && after != '/' {
        // A longer tag name such as `<svgx>`: not an SVG root element.
        return None;
    }
    let end = lower[start..].find('>')? + start;
    Some(lower[start..=end].to_string())
}

/// Extract a quoted attribute value from a lowercased tag string.
///
/// Handles `name="value"` and `name='value'` with optional whitespace around
/// the `=`. Matching is exact on the (lowercased) name.
fn svg_attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let bytes = tag.as_bytes();
    let name_bytes = name.as_bytes();
    for i in 0..bytes.len() {
        if !bytes[i..].starts_with(name_bytes) {
            continue;
        }
        // The name must start on a token boundary.
        if i > 0 && !bytes[i - 1].is_ascii_whitespace() {
            continue;
        }
        let mut j = i + name_bytes.len();
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if j >= bytes.len() || bytes[j] != b'=' {
            continue;
        }
        j += 1;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if j >= bytes.len() || (bytes[j] != b'"' && bytes[j] != b'\'') {
            continue;
        }
        let quote = bytes[j];
        let value_start = j + 1;
        let value_end = bytes[value_start..]
            .iter()
            .position(|&b| b == quote)
            .map(|offset| value_start + offset)?;
        return Some(&tag[value_start..value_end]);
    }
    None
}

/// Parse an SVG length that is absolute (a bare number or `px` suffix).
/// Percentages, `em`/`rem` and other units yield `None`.
fn svg_attr_px(tag: &str, name: &str) -> Option<u32> {
    let value = svg_attr(tag, name)?.trim();
    let number = value.strip_suffix("px").unwrap_or(value).trim();
    let parsed: f64 = number.parse().ok()?;
    if !parsed.is_finite() || parsed < 0.5 || parsed > u32::MAX as f64 {
        return None;
    }
    Some(parsed.round() as u32)
}

/// Backfill `webp_base64` for every cached entry that is missing it.
///
/// This is the bulk migration path: for rows created before the WebP column
/// existed (or whose WebP bake previously failed), the placeholder is regenerated
/// purely from the cached blurhash string; no source files are read, so missing
/// or moved images do not block the migration.
pub fn migrate_webp_placeholders(context: &mut AppContext) -> Result<WebpMigrationResult> {
    let stale_rows = blurhash_cache::table
        .filter(blurhash_cache::webp_base64.is_null())
        .select(BlurhashCache::as_select())
        .load::<BlurhashCache>(&mut context.db_conn)?;

    let mut result = WebpMigrationResult::default();
    for row in stale_rows {
        match blurhash_to_webp_base64(&row.blurhash) {
            Some(webp) => {
                diesel::update(blurhash_cache::table.filter(blurhash_cache::id.eq(row.id)))
                    .set(blurhash_cache::webp_base64.eq(&webp))
                    .execute(&mut context.db_conn)?;
                result.processed += 1;
            }
            None => {
                warn!(
                    "Skipping WebP backfill for {}: could not bake from blurhash",
                    row.relative_path
                );
                result.skipped += 1;
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgba};
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    /// Create a distinct test image (PNG bytes) of the given dimensions.
    fn make_test_image(width: u32, height: u32, seed: u8) -> Vec<u8> {
        let mut img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::new(width, height);
        for (_x, y, pixel) in img.enumerate_pixels_mut() {
            *pixel = Rgba([
                (seed.wrapping_mul(7)).wrapping_add((y % 256) as u8),
                (seed.wrapping_mul(13)).wrapping_add((y % 128) as u8),
                200,
                255,
            ]);
        }
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("encode png");
        bytes
    }

    struct TestEnv {
        _tmp: TempDir,
        project_root: PathBuf,
        db_path: PathBuf,
    }

    impl TestEnv {
        fn new() -> Self {
            let tmp = tempfile::tempdir().expect("tempdir");
            let project_root = tmp.path().canonicalize().expect("canonicalize root");
            let db_path = project_root.join("test-cache.sqlite3");
            Self {
                _tmp: tmp,
                project_root,
                db_path,
            }
        }

        /// A context whose connection has had migrations applied.
        fn migrated_context(&self) -> AppContext {
            let conn = initialize_and_connect_db(self.db_path.to_str().unwrap()).expect("init db");
            AppContext {
                db_conn: conn,
                project_root: self.project_root.clone(),
            }
        }
    }

    /// Insert an image into the project root and return its absolute path.
    fn write_image(env: &TestEnv, name: &str, bytes: &[u8]) -> PathBuf {
        let path = env.project_root.join(name);
        fs::write(&path, bytes).expect("write image");
        path
    }

    #[test]
    fn webp_placeholder_is_valid_riff_webp() {
        // A known-valid blurhash; baking should yield a decodable WebP.
        let webp_b64 = blurhash_to_webp_base64("LFE.@D9F01_2%M%MIVRj~qofWAYe")
            .expect("webp base64 should be produced");
        let raw = BASE64_STANDARD.decode(&webp_b64).expect("decode base64");
        assert!(
            raw.starts_with(b"RIFF"),
            "expected RIFF header, got: {:?}",
            &raw[..8.min(raw.len())]
        );
        assert_eq!(&raw[8..12], b"WEBP", "expected WEBP tag");
        // 32x32 lossy webp is tiny; sanity bound.
        assert!(
            raw.len() < 4096,
            "placeholder unexpectedly large: {}",
            raw.len()
        );
    }

    #[test]
    fn invalid_blurhash_yields_no_webp() {
        assert!(blurhash_to_webp_base64("not-a-valid-blurhash").is_none());
    }

    /// Encode a flat single-color test image in the given format.
    fn make_test_image_formatted(width: u32, height: u32, format: image::ImageFormat) -> Vec<u8> {
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(width, height, Rgb([120, 40, 200]));
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut std::io::Cursor::new(&mut bytes), format)
            .expect("encode image");
        bytes
    }

    #[test]
    fn probe_image_dimensions_reads_raster_headers() {
        let env = TestEnv::new();
        for (name, format) in [
            ("a.png", image::ImageFormat::Png),
            ("a.jpg", image::ImageFormat::Jpeg),
            ("a.gif", image::ImageFormat::Gif),
            ("a.webp", image::ImageFormat::WebP),
        ] {
            let bytes = make_test_image_formatted(40, 30, format);
            let path = write_image(&env, name, &bytes);
            assert_eq!(
                probe_image_dimensions(&path).expect(name),
                (40, 30),
                "header probe failed for {name}"
            );
        }
    }

    #[test]
    fn probe_image_dimensions_reads_svg_absolute() {
        let env = TestEnv::new();
        let path = write_image(
            &env,
            "logo.svg",
            br#"<?xml version="1.0" encoding="UTF-8"?>
<!-- a leading comment -->
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect/></svg>"#,
        );
        assert_eq!(probe_image_dimensions(&path).expect("svg probe"), (120, 60));
    }

    #[test]
    fn probe_image_dimensions_reads_svg_viewbox_only() {
        let env = TestEnv::new();
        let path = write_image(
            &env,
            "icon.svg",
            br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>"#,
        );
        assert_eq!(probe_image_dimensions(&path).expect("svg probe"), (24, 24));
    }

    #[test]
    fn probe_image_dimensions_prefers_svg_width_height() {
        let env = TestEnv::new();
        let path = write_image(
            &env,
            "mixed.svg",
            br#"<svg viewBox="0 0 100 50" width="30" height="30"></svg>"#,
        );
        assert_eq!(probe_image_dimensions(&path).expect("svg probe"), (30, 30));
    }

    #[test]
    fn probe_image_dimensions_rejects_relative_svg_sizes() {
        let env = TestEnv::new();
        let path = write_image(
            &env,
            "fluid.svg",
            br#"<svg width="100%" height="100%" viewBox="0 0 0 0"></svg>"#,
        );
        assert!(probe_image_dimensions(&path).is_err());
    }

    #[test]
    fn probe_image_dimensions_fails_for_non_images() {
        let env = TestEnv::new();
        let text = write_image(&env, "notes.txt", b"just some text");
        assert!(probe_image_dimensions(&text).is_err());
        let missing = env.project_root.join("ghost.png");
        assert!(probe_image_dimensions(&missing).is_err());
    }

    #[test]
    fn get_blurhash_with_cache_bakes_and_returns_webp() {
        let env = TestEnv::new();
        let img_bytes = make_test_image(40, 30, 42);
        let path = write_image(&env, "a.png", &img_bytes);

        let mut ctx = env.migrated_context();
        let data = get_blurhash_with_cache(&mut ctx, &path).expect("process");
        assert!(!data.blurhash.is_empty());
        assert_eq!(data.width, 40);
        assert_eq!(data.height, 30);
        let webp = data
            .webp_base64
            .expect("webp should be baked on cache miss");
        let raw = BASE64_STANDARD.decode(&webp).unwrap();
        assert!(raw.starts_with(b"RIFF") && &raw[8..12] == b"WEBP");
    }

    #[test]
    fn cache_hit_returns_baked_webp_without_rebaking() {
        let env = TestEnv::new();
        let img_bytes = make_test_image(40, 30, 7);
        let path = write_image(&env, "a.png", &img_bytes);

        let mut ctx = env.migrated_context();
        let first = get_blurhash_with_cache(&mut ctx, &path).expect("first");
        let first_webp = first.webp_base64.clone().expect("webp present");

        // Second read is a mtime cache hit; should return the same baked webp.
        let second = get_blurhash_with_cache(&mut ctx, &path).expect("second");
        assert_eq!(second.blurhash, first.blurhash);
        assert_eq!(second.webp_base64.as_deref(), Some(first_webp.as_str()));
    }

    #[test]
    fn lazy_backfill_when_webp_column_is_null() {
        let env = TestEnv::new();
        let img_bytes = make_test_image(48, 36, 99);
        let path = write_image(&env, "a.png", &img_bytes);

        let mut ctx = env.migrated_context();
        let data = get_blurhash_with_cache(&mut ctx, &path).expect("process");
        let baked = data.webp_base64.clone().expect("baked");

        // Simulate a pre-migration row by clearing the baked webp.
        diesel::update(
            blurhash_cache::table.filter(
                blurhash_cache::relative_path.eq(path
                    .strip_prefix(&env.project_root)
                    .unwrap()
                    .to_str()
                    .unwrap()),
            ),
        )
        .set(blurhash_cache::webp_base64.eq::<Option<String>>(None))
        .execute(&mut ctx.db_conn)
        .expect("null out webp");

        // A cache hit should lazily re-bake and persist it.
        let data2 = get_blurhash_with_cache(&mut ctx, &path).expect("reprocess");
        assert_eq!(data2.webp_base64.as_deref(), Some(baked.as_str()));

        // And it should now be persisted: a fresh connection sees it.
        let mut ctx2 = env.migrated_context();
        let data3 = get_blurhash_with_cache(&mut ctx2, &path).expect("reprocess 2");
        assert_eq!(data3.webp_base64.as_deref(), Some(baked.as_str()));
    }

    #[test]
    fn bulk_migrate_backfills_all_null_rows() {
        let env = TestEnv::new();
        // Two distinct images.
        let path_a = write_image(&env, "a.png", &make_test_image(40, 30, 1));
        let path_b = write_image(&env, "b.png", &make_test_image(60, 40, 2));

        let mut ctx = env.migrated_context();
        let a = get_blurhash_with_cache(&mut ctx, &path_a).expect("a");
        let b = get_blurhash_with_cache(&mut ctx, &path_b).expect("b");

        // Null them out to simulate a pre-migration database.
        diesel::update(blurhash_cache::table)
            .set(blurhash_cache::webp_base64.eq::<Option<String>>(None))
            .execute(&mut ctx.db_conn)
            .expect("null all");

        let result = migrate_webp_placeholders(&mut ctx).expect("migrate");
        assert_eq!(result.processed, 2);
        assert_eq!(result.skipped, 0);

        // Rows now carry webp that matches a fresh bake.
        let a2 = get_blurhash_with_cache(&mut ctx, &path_a).expect("a2");
        let b2 = get_blurhash_with_cache(&mut ctx, &path_b).expect("b2");
        assert_eq!(a2.webp_base64, a.webp_base64);
        assert_eq!(b2.webp_base64, b.webp_base64);

        // Second migrate run is a no-op.
        let result2 = migrate_webp_placeholders(&mut ctx).expect("migrate2");
        assert_eq!(result2.processed, 0);
        assert_eq!(result2.skipped, 0);
    }

    #[test]
    fn migration_adds_column_to_preexisting_database() {
        let env = TestEnv::new();
        // Create a database with the OLD schema (no webp_base64 column).
        let old_schema = r#"
            CREATE TABLE blurhash_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                relative_path TEXT NOT NULL UNIQUE,
                xxhash TEXT NOT NULL,
                mtime_ms BIGINT NOT NULL,
                blurhash TEXT NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        "#;
        {
            let mut conn =
                SqliteConnection::establish(env.db_path.to_str().unwrap()).expect("establish");
            conn.batch_execute(old_schema).expect("create old table");
            // Insert a legacy row without webp_base64.
            conn.batch_execute(
                "INSERT INTO blurhash_cache (relative_path, xxhash, mtime_ms, blurhash, width, height) \
                 VALUES ('legacy.png', 'deadbeef', 1000, 'LFE.@D9F01_2%M%MIVRj~qofWAYe', 10, 10);",
            )
            .expect("insert legacy");
        }

        // Connecting (which runs migrations) should add the column.
        let mut ctx = env.migrated_context();
        assert!(
            column_exists(&mut ctx.db_conn, "webp_base64").expect("check"),
            "webp_base64 column should be added to old database"
        );

        // Bulk migrate should backfill the legacy row from its blurhash.
        let result = migrate_webp_placeholders(&mut ctx).expect("migrate");
        assert_eq!(result.processed, 1);
        assert_eq!(result.skipped, 0);
    }

    #[test]
    fn fresh_database_has_webp_column() {
        let env = TestEnv::new();
        let mut ctx = env.migrated_context();
        assert!(column_exists(&mut ctx.db_conn, "webp_base64").expect("check"));
    }
}
