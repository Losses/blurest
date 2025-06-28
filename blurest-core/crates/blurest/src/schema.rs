diesel::table! {
    blurhash_cache (id) {
        id -> Integer,
        relative_path -> Text,
        xxhash -> Text,
        mtime_ms -> BigInt,
        blurhash -> Text,
        width -> Integer,
        height -> Integer,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}
