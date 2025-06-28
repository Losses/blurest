import path from "node:path";
import fs from "node:fs";

import * as addon from "./load.cjs";

/**
 * Core plugin options for initializing the Blurhash cache module.
 */
export interface BlurhashCoreOptions {
  /**
   * Database connection string
   */
  databaseUrl: string;

  /**
   * Absolute path to the project root directory.
   * Used to resolve relative image paths.
   */
  projectRoot: string;
}

/**
 * Success result type for `get_blurhash` function.
 */
export interface BlurhashSuccessResult {
  success: true;
  blurhash: string;
  width: number;
  height: number;
}

/**
 * Error result type for `get_blurhash` function.
 */
export interface BlurhashErrorResult {
  success: false;
  error: string;
}

/**
 * Union return type for `get_blurhash` function.
 */
export type BlurhashResult = BlurhashSuccessResult | BlurhashErrorResult;

/**
 * Parsed image source information.
 */
export interface ParsedImageSource {
  /** Cleaned image path (with size definitions removed) */
  cleanSrc: string;
  /** User-specified render width */
  renderWidth: number | null;
  /** User-specified render height */
  renderHeight: number | null;
}

/**
 * File validation result.
 */
export interface FileValidationResult {
  /** Whether the file should be processed by the native module */
  shouldProcess: boolean;
  /** Resolved absolute path (only if shouldProcess is true) */
  resolvedPath?: string;
  /** Validation failure reason (only if shouldProcess is false) */
  reason?: string;
}

// Type declarations for the native module exports
declare module "./load.cjs" {
  /**
   * Initialize the Blurhash cache system. Must be called before all other functions.
   * @param databaseUrl Database connection string
   * @param projectRoot Project root directory path
   * @returns `true` if initialization succeeds, otherwise throws an error
   */
  function initialize_blurhash_cache(
    databaseUrl: string,
    projectRoot: string
  ): boolean;

  /**
   * Generate or retrieve cached blurhash, width and height for the specified image.
   * @param imagePath Image file path (can be absolute or relative to projectRoot)
   * @returns An object containing blurhash data or error information
   */
  function get_blurhash(imagePath: string): BlurhashResult;

  /**
   * Check if the Blurhash cache system is initialized.
   * @returns `true` if initialized
   */
  function is_initialized(): boolean;

  /**
   * Clean up global context and close database connections.
   * @returns `true` if cleanup succeeds
   */
  function clear_context(): boolean;
}

/**
 * Check if a URL is a network URL (starts with http:// or https://).
 * @param src Image source string
 * @returns true if it's a network URL
 */
export function isNetworkUrl(src: string): boolean {
  return /^https?:\/\//.test(src);
}

/**
 * Validate if the file should be processed by the native module.
 * @param src Image source path
 * @param projectRoot Project root directory
 * @returns Validation result with processing decision
 */
export function validateFile(
  src: string,
  projectRoot: string
): FileValidationResult {
  // Skip network URLs
  if (isNetworkUrl(src)) {
    return {
      shouldProcess: false,
      reason: "Network URL detected",
    };
  }

  let resolvedPath: string;

  try {
    // Resolve path relative to project root
    if (path.isAbsolute(src)) {
      resolvedPath = src;
    } else {
      resolvedPath = path.resolve(projectRoot, src);
    }

    // Normalize paths for comparison
    const normalizedProjectRoot = path.normalize(projectRoot);
    const normalizedResolvedPath = path.normalize(resolvedPath);

    // Check if file is within project root
    if (!normalizedResolvedPath.startsWith(normalizedProjectRoot)) {
      return {
        shouldProcess: false,
        reason: "File is outside project root",
      };
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return {
        shouldProcess: false,
        reason: "File does not exist",
      };
    }

    // Check if it's actually a file (not a directory)
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      return {
        shouldProcess: false,
        reason: "Path is not a file",
      };
    }

    return {
      shouldProcess: true,
      resolvedPath,
    };
  } catch (error) {
    return {
      shouldProcess: false,
      reason: `File validation error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Parse image `src` attribute to separate path and render dimensions.
 * Syntax: `path/to/image.png =100x200`, `path =100x`, `path =x200`
 * @param src Original src string from markdown token
 * @returns Object containing cleaned path and render dimensions
 */
export function parseImageSrc(src: string): ParsedImageSource {
  // Match ' =<width>x<height>' pattern at the end of the string
  const sizeRegex = /\s*=\s*(\d*)x(\d*)\s*$/;
  const match = src.match(sizeRegex);

  if (!match) {
    return {
      cleanSrc: src,
      renderWidth: null,
      renderHeight: null,
    };
  }

  const cleanSrc = src.substring(0, match.index).trim();
  const widthStr = match[1];
  const heightStr = match[2];

  // If both width and height are empty (e.g., `image.png =x`), treat as invalid
  if (!widthStr && !heightStr) {
    return {
      cleanSrc: src,
      renderWidth: null,
      renderHeight: null,
    };
  }

  const renderWidth = widthStr ? parseInt(widthStr, 10) : null;
  const renderHeight = heightStr ? parseInt(heightStr, 10) : null;

  return {
    cleanSrc,
    renderWidth: !isNaN(renderWidth ?? NaN) ? renderWidth : null,
    renderHeight: !isNaN(renderHeight ?? NaN) ? renderHeight : null,
  };
}

/**
 * Core Blurhash processor class
 */
export class BlurhashCore {
  private initialized = false;
  private options: BlurhashCoreOptions;

  constructor(options: BlurhashCoreOptions) {
    this.options = options;
  }

  /**
   * Initialize the Blurhash cache system
   */
  initialize(): void {
    if (!this.options.databaseUrl || !this.options.projectRoot) {
      throw new Error(
        "[blurhash-core] `databaseUrl` and `projectRoot` options are required."
      );
    }

    try {
      const initialized = addon.initialize_blurhash_cache(
        this.options.databaseUrl,
        this.options.projectRoot
      );
      if (!initialized) {
        throw new Error("Native module initialization returned false.");
      }
      this.initialized = true;
    } catch (error) {
      console.error(
        "[blurhash-core] Failed to initialize native module:",
        error
      );
      throw new Error(
        `[blurhash-core] Initialization failed. Please check your options and native module setup. Details: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Check if the core is initialized
   */
  isInitialized(): boolean {
    return this.initialized && addon.is_initialized();
  }

  /**
   * Process an image and get blurhash data
   * @param src Clean image source path (without size definitions)
   * @returns Blurhash result or null if processing should be skipped
   */
  processImage(src: string): BlurhashResult | null {
    if (!this.initialized) {
      throw new Error(
        "[blurhash-core] Core not initialized. Call initialize() first."
      );
    }

    // Validate file before processing
    const validation = validateFile(src, this.options.projectRoot);

    if (!validation.shouldProcess) {
      console.debug(
        `[blurhash-core] Skipping blurhash processing for "${src}": ${validation.reason}`
      );
      return null;
    }

    // Get blurhash and original dimensions from native module
    return addon.get_blurhash(src);
  }

  /**
   * Clean up resources
   */
  cleanup(): boolean {
    try {
      const result = addon.clear_context();
      this.initialized = false;
      return result;
    } catch (error) {
      console.error("[blurhash-core] Failed to cleanup:", error);
      return false;
    }
  }

  /**
   * Get project root
   */
  getProjectRoot(): string {
    return this.options.projectRoot;
  }
}
