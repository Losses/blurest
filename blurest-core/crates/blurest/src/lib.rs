//! # Blurhash Cache Module
//!
//! A Neon.js native Node.js module that provides efficient blurhash generation and caching
//! for images with database persistence.
//!
//! ## Overview
//!
//! This module exposes a Rust-based blurhash implementation to Node.js applications,
//! featuring database-backed caching to avoid regenerating blurhashes for previously
//! processed images. Blurhashes are compact string representations of images that can
//! be used as placeholders while images load.
//!
//! ## Features
//!
//! - **Database-backed caching**: Stores generated blurhashes in a database to avoid
//!   redundant computation
//! - **Thread-safe global context**: Uses `OnceLock` and `Mutex` for safe concurrent access
//! - **Error handling**: Comprehensive error reporting for all operations
//! - **Context management**: Initialize, check status, and clear application context
//!
//! ## Usage
//!
//! ```javascript
//! const blurhash = require('./path/to/compiled/module');
//!
//! // Initialize the module with database connection and project root
//! const success = blurhash.initialize_blurhash_cache(
//!   'postgresql://user:pass@localhost/db',
//!   '/path/to/project'
//! );
//!
//! if (success) {
//!   // Generate or retrieve cached blurhash for an image
//!   const result = blurhash.get_blurhash('/path/to/image.jpg');
//!   if (result.success) {
//!     console.log('Blurhash:', result.blurhash);
//!   } else {
//!     console.error('Error:', result.error);
//!   }
//! }
//!
//! // Check if module is initialized
//! const initialized = blurhash.is_initialized();
//!
//! // Clear context when done
//! blurhash.clear_context();
//! ```
//!
//! ## Architecture
//!
//! - **Global State**: Uses `GLOBAL_CONTEXT` with `OnceLock<Mutex<RefCell<Option<AppContext>>>>`
//!   for thread-safe global state management
//! - **Database Integration**: Leverages `initialize_and_connect_db` for database connectivity
//! - **Caching Layer**: `get_blurhash_with_cache` handles cache lookup and generation
//! - **Path Resolution**: Canonicalizes project root path for consistent file handling
//!
//! ## Error Handling
//!
//! All functions return structured results with success/error indicators:
//! - Database connection failures
//! - Path resolution errors
//! - Mutex poisoning protection
//! - Uninitialized context detection
//!
//! ## Dependencies
//!
//! - `neon`: Node.js native module framework
//! - Custom modules: `core`, `models`, `schema` for application logic
//! - Standard library: `std::cell::RefCell`, `std::sync::Mutex`, `std::sync::OnceLock`

use std::{
    cell::RefCell,
    path::Path,
    sync::{Mutex, OnceLock},
};

use neon::prelude::*;

use crate::core::{AppContext, get_blurhash_with_cache, initialize_and_connect_db};

pub mod core;
pub mod models;
pub mod schema;

/// Global application context wrapped in thread-safe containers.
///
/// Uses `OnceLock` for one-time initialization and `Mutex<RefCell<>>` for
/// interior mutability with thread safety. The `RefCell` allows mutable
/// borrowing of the `AppContext` while the `Mutex` ensures thread safety.
static GLOBAL_CONTEXT: OnceLock<Mutex<RefCell<Option<AppContext>>>> = OnceLock::new();

/// Initializes the blurhash cache system with database connection and project root.
///
/// This function must be called before any other operations. It establishes a database
/// connection and sets up the global application context.
///
/// # Arguments
///
/// * `database_url` - Connection string for the database (e.g., PostgreSQL URL)
/// * `project_root` - Absolute or relative path to the project root directory
///
/// # Returns
///
/// * `JsBoolean` - `true` if initialization succeeded, throws error on failure
///
/// # Errors
///
/// Throws JavaScript errors for:
/// - Database connection failures
/// - Invalid or unresolvable project root paths
/// - Mutex poisoning (concurrent access issues)
///
/// # Example
///
/// ```javascript
/// const success = initialize_blurhash_cache(
///   'postgresql://user:pass@localhost/mydb',
///   '/home/user/project'
/// );
/// ```
fn initialize_blurhash_cache(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let database_url = cx.argument::<JsString>(0)?.value(&mut cx);
    let project_root = cx.argument::<JsString>(1)?.value(&mut cx);

    let context_mutex = GLOBAL_CONTEXT.get_or_init(|| Mutex::new(RefCell::new(None)));
    let guard = match context_mutex.lock() {
        Ok(guard) => guard,
        Err(_) => return cx.throw_error("Failed to acquire context lock: Mutex was poisoned."),
    };
    let mut context_ref = guard.borrow_mut();
    let conn = match initialize_and_connect_db(&database_url) {
        Ok(conn) => conn,
        Err(e) => return cx.throw_error(format!("Failed to connect to database: {e}")),
    };
    let root_path = match std::path::PathBuf::from(project_root).canonicalize() {
        Ok(path) => path,
        Err(e) => return cx.throw_error(format!("Failed to resolve project root path: {e}")),
    };
    *context_ref = Some(AppContext {
        db_conn: conn,
        project_root: root_path,
    });
    Ok(cx.boolean(true))
}

/// Generates or retrieves a cached blurhash, width, and height for the specified image.
///
/// Attempts to retrieve cached data from the database first. If not found,
/// generates new data, caches it, and returns the result.
///
/// # Arguments
///
/// * `image_path` - Path to the image file (relative to project root or absolute)
///
/// # Returns
///
/// * `JsObject` with fields:
///   - `success: boolean` - Whether the operation succeeded
///   - `blurhash: string` - The blurhash string (only present on success)
///   - `width: number` - The image width in pixels (only present on success)
///   - `height: number` - The image height in pixels (only present on success)
///   - `error: string` - Error message (only present on failure)
///
/// # Example
///
/// ```javascript
/// const result = get_blurhash('assets/images/hero.jpg');
/// if (result.success) {
///   console.log(`Blurhash: ${result.blurhash}`);
///   console.log(`Dimensions: ${result.width}x${result.height}`);
/// } else {
///   console.error(`Failed: ${result.error}`);
/// }
/// ```
fn get_blurhash(mut cx: FunctionContext) -> JsResult<JsObject> {
    let image_path = cx.argument::<JsString>(0)?.value(&mut cx);

    let context_mutex = match GLOBAL_CONTEXT.get() {
        Some(mutex) => mutex,
        None => {
            let obj = cx.empty_object();
            let success = cx.boolean(false);
            let error = cx.string("Context not initialized. Call initialize_blurhash_cache first.");
            obj.set(&mut cx, "success", success)?;
            obj.set(&mut cx, "error", error)?;
            return Ok(obj);
        }
    };
    let guard = match context_mutex.lock() {
        Ok(guard) => guard,
        Err(_) => {
            let obj = cx.empty_object();
            let success = cx.boolean(false);
            let error = cx.string("Failed to acquire context lock");
            obj.set(&mut cx, "success", success)?;
            obj.set(&mut cx, "error", error)?;
            return Ok(obj);
        }
    };

    let mut context_ref = guard.borrow_mut();
    let context = match context_ref.as_mut() {
        Some(ctx) => ctx,
        None => {
            let obj = cx.empty_object();
            let success = cx.boolean(false);
            let error = cx.string("Context not initialized. Call initialize_blurhash_cache first.");
            obj.set(&mut cx, "success", success)?;
            obj.set(&mut cx, "error", error)?;
            return Ok(obj);
        }
    };

    let path = Path::new(&image_path);
    let result = get_blurhash_with_cache(context, path);
    let obj = cx.empty_object();
    match result {
        Ok(data) => {
            let success = cx.boolean(true);
            let hash_value = cx.string(data.blurhash);
            let width_value = cx.number(data.width);
            let height_value = cx.number(data.height);

            obj.set(&mut cx, "success", success)?;
            obj.set(&mut cx, "blurhash", hash_value)?;
            obj.set(&mut cx, "width", width_value)?;
            obj.set(&mut cx, "height", height_value)?;
        }
        Err(e) => {
            let success = cx.boolean(false);
            let error = cx.string(format!("Error: {e}"));
            obj.set(&mut cx, "success", success)?;
            obj.set(&mut cx, "error", error)?;
        }
    }

    Ok(obj)
}

/// Checks whether the blurhash cache system has been initialized.
///
/// This is a utility function to verify that `initialize_blurhash_cache`
/// has been successfully called and the global context is ready for use.
///
/// # Returns
///
/// * `JsBoolean` - `true` if the context is initialized and ready, `false` otherwise
///
/// # Example
///
/// ```javascript
/// if (!is_initialized()) {
///   console.log('Need to call initialize_blurhash_cache first');
/// }
/// ```
fn is_initialized(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let initialized = match GLOBAL_CONTEXT.get() {
        Some(mutex) => {
            if let Ok(guard) = mutex.lock() {
                guard.borrow().is_some()
            } else {
                false
            }
        }
        None => false,
    };
    Ok(cx.boolean(initialized))
}

/// Clears the global application context and closes database connections.
///
/// This function safely tears down the global state, closing any open database
/// connections and clearing the context. Useful for cleanup during application
/// shutdown or testing scenarios.
///
/// # Returns
///
/// * `JsBoolean` - `true` if clearing succeeded, throws error on mutex poisoning
///
/// # Errors
///
/// Throws JavaScript error if the mutex is poisoned (concurrent access corruption).
///
/// # Example
///
/// ```javascript
/// // Clean shutdown
/// const cleared = clear_context();
/// if (cleared) {
///   console.log('Context cleared successfully');
/// }
/// ```
fn clear_context(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    if let Some(context_mutex) = GLOBAL_CONTEXT.get() {
        match context_mutex.lock() {
            Ok(guard) => {
                let mut context_ref = guard.borrow_mut();
                *context_ref = None;
                Ok(cx.boolean(true))
            }
            Err(_) => cx.throw_error("Failed to acquire context lock: Mutex was poisoned."),
        }
    } else {
        Ok(cx.boolean(true))
    }
}

/// Neon.js module entry point.
///
/// Exports all public functions to make them available in Node.js:
/// - `initialize_blurhash_cache`: Initialize the system
/// - `get_blurhash`: Generate/retrieve blurhashes
/// - `is_initialized`: Check initialization status  
/// - `clear_context`: Clean up global state
///
/// # Usage from Node.js
///
/// ```javascript
/// const blurhash = require('./path/to/compiled/module');
/// // All exported functions are now available on the blurhash object
/// ```
#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("initialize_blurhash_cache", initialize_blurhash_cache)?;
    cx.export_function("get_blurhash", get_blurhash)?;
    cx.export_function("is_initialized", is_initialized)?;
    cx.export_function("clear_context", clear_context)?;
    Ok(())
}
