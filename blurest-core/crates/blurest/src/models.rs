// Generated by diesel_ext

#![allow(unused)]
#![allow(clippy::all)]

use crate::schema::blurhash_cache;
use chrono::NaiveDateTime;
use diesel::prelude::*;

#[derive(Queryable, Selectable, Identifiable, Debug)]
#[diesel(table_name = crate::schema::blurhash_cache)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct BlurhashCache {
    pub id: i32,
    pub relative_path: String,
    pub xxhash: String,
    pub mtime_ms: i64,
    pub blurhash: String,
    pub width: i32,
    pub height: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Insertable)]
#[diesel(table_name = crate::schema::blurhash_cache)]
pub struct NewBlurhashCache<'a> {
    pub relative_path: &'a str,
    pub xxhash: &'a str,
    pub mtime_ms: i64,
    pub blurhash: &'a str,
    pub width: i32,
    pub height: i32,
}
