use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context as AnyhowContext, Result};
use blurhash::encode;
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

#[derive(Debug)]
pub struct BlurhashData {
    pub blurhash: String,
    pub width: i32,
    pub height: i32,
}

/// SQL migrations for creating the blurhash cache table and triggers
const MIGRATIONS_SQL: &str = r#"
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

CREATE TRIGGER trigger_blurhash_cache_updated_at
AFTER UPDATE ON blurhash_cache
FOR EACH ROW
BEGIN
    UPDATE blurhash_cache SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
"#;

/// Initializes the database and returns a connection.
/// Creates the database file and runs embedded migrations if the file doesn't exist.
pub fn initialize_and_connect_db(database_url: &str) -> Result<SqliteConnection> {
    let db_path = Path::new(database_url);
    let db_exists = db_path.exists();

    let mut conn = SqliteConnection::establish(database_url)
        .with_context(|| format!("Error connecting to or creating database at {database_url}"))?;

    if !db_exists {
        info!("Database file not found, creating and running migrations");
        conn.batch_execute(MIGRATIONS_SQL)
            .with_context(|| "Failed to run initial migrations on the new database")?;
        info!("Database initialized successfully");
    } else {
        debug!("Database found, skipping migrations");
    }

    Ok(conn)
}

/// Converts SystemTime to Unix timestamp in milliseconds
fn time_to_ms(time: SystemTime) -> Result<i64> {
    let duration = time.duration_since(UNIX_EPOCH)?;
    Ok(duration.as_millis() as i64)
}

/// Gets the blurhash for an image with intelligent caching.
///
/// This function implements a two-tier caching strategy:
/// 1. First checks modification time (mtime) for quick validation
/// 2. Falls back to content hash (xxhash) verification if mtime differs
///
/// # Arguments
/// * `context` - Application context containing database connection and project root
/// * `image_path` - Path to the image file
///
/// # Returns
/// * `Result<BlurhashData>` - A struct containing the blurhash string, width, and height, or an error
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
            return Ok(BlurhashData {
                blurhash: cache.blurhash,
                width: cache.width,
                height: cache.height,
            });
        }

        let file_bytes = fs::read(&absolute_path)?;
        let current_xxhash_val = xxh3_64(&file_bytes);
        let current_xxhash_str = hex::encode(current_xxhash_val.to_be_bytes());

        if current_xxhash_str == cache.xxhash {
            debug!("Cache hit: content unchanged, updating mtime for {relative_key}");
            diesel::update(&cache)
                .set(blurhash_cache::mtime_ms.eq(current_mtime_ms))
                .execute(&mut context.db_conn)?;
            return Ok(BlurhashData {
                blurhash: cache.blurhash,
                width: cache.width,
                height: cache.height,
            });
        }

        warn!("Cache stale: content changed for {relative_key}");
        let (new_blurhash, _, new_width, new_height) = calculate_blurhash_and_hash(&file_bytes)?;

        diesel::update(&cache)
            .set((
                blurhash_cache::xxhash.eq(current_xxhash_str),
                blurhash_cache::mtime_ms.eq(current_mtime_ms),
                blurhash_cache::blurhash.eq(&new_blurhash),
                blurhash_cache::width.eq(new_width as i32),
                blurhash_cache::height.eq(new_height as i32),
            ))
            .execute(&mut context.db_conn)?;

        return Ok(BlurhashData {
            blurhash: new_blurhash,
            width: new_width as i32,
            height: new_height as i32,
        });
    }

    info!("Cache miss: new file {relative_key}");
    let file_bytes = fs::read(&absolute_path)?;
    let (new_blurhash, new_xxhash_str, new_width, new_height) =
        calculate_blurhash_and_hash(&file_bytes)?;

    let new_cache_entry = NewBlurhashCache {
        relative_path: &relative_key,
        xxhash: &new_xxhash_str,
        mtime_ms: current_mtime_ms,
        blurhash: &new_blurhash,
        width: new_width as i32,
        height: new_height as i32,
    };

    diesel::insert_into(blurhash_cache::table)
        .values(&new_cache_entry)
        .execute(&mut context.db_conn)?;

    Ok(BlurhashData {
        blurhash: new_blurhash,
        width: new_width as i32,
        height: new_height as i32,
    })
}

/// Helper function that encapsulates blurhash, xxhash, and dimension calculation logic
///
/// # Arguments
/// * `file_bytes` - Raw image file bytes
///
/// # Returns
/// * `Result<(String, String, u32, u32)>` - Tuple of (blurhash, xxhash_hex, width, height) or error
fn calculate_blurhash_and_hash(file_bytes: &[u8]) -> Result<(String, String, u32, u32)> {
    let hash_val = xxh3_64(file_bytes);
    let hash_str = hex::encode(hash_val.to_be_bytes());

    let img = image::load_from_memory(file_bytes)?;
    let (width, height) = img.dimensions();
    let rgba_data = img.to_rgba8().into_vec();

    let blurhash_str = encode(4, 3, width, height, &rgba_data)?;

    Ok((blurhash_str, hash_str, width, height))
}
