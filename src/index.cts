import type MarkdownIt from "markdown-it";
import type { Token, Renderer } from "markdown-it";
import path from "node:path";
import fs from "node:fs";

import * as addon from "./load.cjs";

/**
 * Plugin options for initializing the Blurhash cache module.
 */
interface AxBlurestPluginOptions {
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
interface BlurhashSuccessResult {
  success: true;
  blurhash: string;
  width: number;
  height: number;
}

/**
 * Error result type for `get_blurhash` function.
 */
interface BlurhashErrorResult {
  success: false;
  error: string;
}

/**
 * Union return type for `get_blurhash` function.
 */
type BlurhashResult = BlurhashSuccessResult | BlurhashErrorResult;

/**
 * Parsed image source information.
 */
interface ParsedImageSource {
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
interface FileValidationResult {
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
function isNetworkUrl(src: string): boolean {
  return /^https?:\/\//.test(src);
}

/**
 * Validate if the file should be processed by the native module.
 * @param src Image source path
 * @param projectRoot Project root directory
 * @returns Validation result with processing decision
 */
function validateFile(src: string, projectRoot: string): FileValidationResult {
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
function parseImageSrc(src: string): ParsedImageSource {
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
 * Render a fallback <img> tag.
 * @param src Image source
 * @param alt Alt text
 * @param renderWidth Render width
 * @param renderHeight Render height
 * @param md MarkdownIt instance for escaping
 * @returns HTML string
 */
function renderFallbackImg(
  src: string,
  alt: string,
  renderWidth: number | null,
  renderHeight: number | null,
  md: MarkdownIt
): string {
  const escapedAlt = md.utils.escapeHtml(alt);
  const escapedSrc = md.utils.escapeHtml(src);

  const attrs: string[] = [`src="${escapedSrc}"`, `alt="${escapedAlt}"`];
  if (renderWidth !== null) attrs.push(`width="${renderWidth}"`);
  if (renderHeight !== null) attrs.push(`height="${renderHeight}"`);

  return `<img ${attrs.join(" ")}>`;
}

/**
 * A markdown-it plugin that renders standard image syntax as custom components with blurhash.
 *
 * @param md MarkdownIt instance
 * @param options Plugin configuration options
 */
function axBlurestPlugin(
  md: MarkdownIt,
  options: AxBlurestPluginOptions
): void {
  if (!options || !options.databaseUrl || !options.projectRoot) {
    throw new Error(
      "[markdown-it-ax-blurest] `databaseUrl` and `projectRoot` options are required."
    );
  }

  // Initialize native module
  try {
    const initialized = addon.initialize_blurhash_cache(
      options.databaseUrl,
      options.projectRoot
    );
    if (!initialized) {
      throw new Error("Native module initialization returned false.");
    }
  } catch (error) {
    console.error(
      "[markdown-it-ax-blurest] Failed to initialize native module:",
      error
    );
    throw new Error(
      `[markdown-it-ax-blurest] Initialization failed. Please check your options and native module setup. Details: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Backup default image renderer
  const defaultImageRenderer =
    md.renderer.rules.image ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };

  // Override image renderer
  md.renderer.rules.image = (
    tokens: Token[],
    idx: number,
    mdOptions: MarkdownIt.Options,
    env: unknown,
    self: Renderer
  ): string => {
    const token = tokens[idx];
    const srcAttr = token.attrGet("src");
    const alt = self.renderInlineAsText(token.children ?? [], mdOptions, env);

    if (!srcAttr) {
      return defaultImageRenderer(tokens, idx, mdOptions, env, self);
    }

    // Parse src to get path and render dimensions
    const { cleanSrc, renderWidth, renderHeight } = parseImageSrc(srcAttr);

    // Validate file before processing
    const validation = validateFile(cleanSrc, options.projectRoot);

    if (!validation.shouldProcess) {
      // Use fallback <img> tag for invalid files
      console.debug(
        `[markdown-it-ax-blurest] Skipping blurhash processing for "${cleanSrc}": ${validation.reason}`
      );
      return renderFallbackImg(cleanSrc, alt, renderWidth, renderHeight, md);
    }

    // Get blurhash and original dimensions from native module
    const result = addon.get_blurhash(cleanSrc);

    const escapedAlt = md.utils.escapeHtml(alt);
    const escapedSrc = md.utils.escapeHtml(cleanSrc);

    if (!result.success) {
      console.warn(
        `[markdown-it-ax-blurest] Failed to get blurhash for "${cleanSrc}": ${result.error}`
      );
      // Fallback to standard <img> tag
      return renderFallbackImg(cleanSrc, alt, renderWidth, renderHeight, md);
    }

    const { blurhash, width: srcWidth, height: srcHeight } = result;

    // Build <ax-blurest> component attributes
    const axAttrs: [string, string | number][] = [
      ["src-width", srcWidth],
      ["src-height", srcHeight],
      ["render-width", renderWidth ?? ""],
      ["render-height", renderHeight ?? ""],
      ["alt", escapedAlt],
      ["src", escapedSrc],
      ["blurhash", blurhash],
    ];

    const axAttrsString = axAttrs
      .map(([key, value]) => `${key}="${value}"`)
      .join(" ");

    // Build inner <img> tag attributes
    const imgAttrs: string[] = [];
    if (renderWidth !== null) {
      imgAttrs.push(`width="${renderWidth}"`);
    }
    if (renderHeight !== null) {
      imgAttrs.push(`height="${renderHeight}"`);
    }

    const imgTag = `<img ${imgAttrs.join(
      " "
    )} alt="${escapedAlt}" src="${escapedSrc}" />`;

    return `<ax-blurest ${axAttrsString}>${imgTag}</ax-blurest>`;
  };
}

export default axBlurestPlugin;
