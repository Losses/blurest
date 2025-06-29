import type MarkdownIt from "markdown-it";
import type {
  Renderer,
  Token,
  Options,
  StateInline,
} from "markdown-it/index.js";

import {
  BlurhashCore,
  type BlurhashCoreOptions,
  parseImageSrc,
} from "@fuuck/blurest-core";
import path from "path";
import fs from "fs";

interface ParseResult {
  href: string;
  title: string;
  renderWidth: number | null;
  renderHeight: number | null;
}

interface DimensionMatch {
  width: number | null;
  height: number | null;
  consumed: number;
}

interface StaticFileMapping {
  /**
   * Root directory path for static file storage
   * e.g.: "./static" or "/var/www/static"
   */
  staticDir: string;

  /**
   * URL path prefix matching rules
   * e.g.: ["/images/", "/assets/"] means paths starting with these prefixes will be mapped to staticDir
   * If empty array, all relative paths will attempt to be mapped to staticDir
   */
  urlPrefixes?: string[];
}

interface AxBlurestPluginOptions extends BlurhashCoreOptions {
  /**
   * Static file mapping configuration
   * Used to handle relative path image resource mapping
   */
  staticFileMapping?: StaticFileMapping;
}

/**
 * Resolve the actual file path for an image
 * @param imageSrc Image source path
 * @param staticMapping Static file mapping configuration
 * @returns Resolved actual file path, returns original path if unable to resolve
 */
function resolveImagePath(
  imageSrc: string,
  staticMapping?: StaticFileMapping
): string {
  // If it's an absolute URL or no static mapping configured, return original path directly
  if (
    !staticMapping ||
    imageSrc.startsWith("http://") ||
    imageSrc.startsWith("https://")
  ) {
    return imageSrc;
  }

  const { staticDir, urlPrefixes = [] } = staticMapping;

  // If no URL prefixes specified, map all relative paths
  if (urlPrefixes.length === 0) {
    // Remove leading '/' to avoid path joining issues
    const relativePath = imageSrc.startsWith("/")
      ? imageSrc.slice(1)
      : imageSrc;
    const resolvedPath = path.resolve(staticDir, relativePath);

    // Check if file exists
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
    return imageSrc; // Return original path when file doesn't exist
  }

  // Check if matches any URL prefix
  for (const prefix of urlPrefixes) {
    if (imageSrc.startsWith(prefix)) {
      // Remove prefix and build actual file path
      const relativePath = imageSrc.slice(prefix.length);
      const resolvedPath = path.resolve(staticDir, relativePath);

      // Check if file exists
      if (fs.existsSync(resolvedPath)) {
        return resolvedPath;
      }
      break; // Matched prefix but file doesn't exist, break loop
    }
  }

  return imageSrc; // Return original path when unable to resolve
}

/**
 * Parse dimension attributes from markdown image syntax
 * Supports formats: =WxH, =Wx, =xH, =W (interpreted as width)
 */
function parseDimensions(src: string, startPos: number): DimensionMatch {
  const remaining = src.slice(startPos);
  const dimMatch = remaining.match(
    /^\s*=\s*([0-9]*)x([0-9]*)|^\s*=\s*([0-9]+)(?!x)/
  );

  if (!dimMatch) {
    return { width: null, height: null, consumed: 0 };
  }

  let width: number | null = null;
  let height: number | null = null;

  if (dimMatch[3]) {
    // Format: =W (width only, no 'x')
    width = parseInt(dimMatch[3], 10);
  } else {
    // Format: =WxH, =Wx, =xH
    if (dimMatch[1]) width = parseInt(dimMatch[1], 10);
    if (dimMatch[2]) height = parseInt(dimMatch[2], 10);
  }

  return {
    width,
    height,
    consumed: dimMatch[0].length,
  };
}

/**
 * Skip whitespace characters including newlines
 */
function skipWhitespace(src: string, pos: number, max: number): number {
  let newPos = pos;
  while (newPos < max) {
    const code = src.charCodeAt(newPos);
    if (!isSpace(code) && code !== 0x0a) break;
    newPos++;
  }
  return newPos;
}

/**
 * Check if character code represents a space
 */
function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09; // space or tab
}

/**
 * Parse inline image link: ![alt](src "title" =WxH)
 */
function parseInlineLink(
  state: StateInline,
  pos: number,
  md: MarkdownIt
): ParseResult | null {
  const max = state.posMax;
  let currentPos = pos;
  let href = "";
  let title = "";
  let renderWidth: number | null = null;
  let renderHeight: number | null = null;

  // Skip opening parenthesis
  currentPos++;

  // Skip whitespace after opening parenthesis
  currentPos = skipWhitespace(state.src, currentPos, max);
  if (currentPos >= max) return null;

  // Parse link destination
  const destResult = md.helpers.parseLinkDestination(
    state.src,
    currentPos,
    max
  );
  if (destResult.ok) {
    href = md.normalizeLink(destResult.str);
    if (!md.validateLink(href)) {
      href = "";
    }
    currentPos = destResult.pos;
  }

  // Skip whitespace after destination
  const afterDestPos = currentPos;
  currentPos = skipWhitespace(state.src, currentPos, max);

  // Parse title if present
  const titleResult = md.helpers.parseLinkTitle(state.src, currentPos, max);
  if (currentPos < max && afterDestPos !== currentPos && titleResult.ok) {
    title = titleResult.str;
    currentPos = titleResult.pos;

    // Skip whitespace after title
    currentPos = skipWhitespace(state.src, currentPos, max);
  }

  // Parse dimensions if present
  const dimResult = parseDimensions(state.src, currentPos);
  if (dimResult.consumed > 0) {
    renderWidth = dimResult.width;
    renderHeight = dimResult.height;
    currentPos += dimResult.consumed;

    // Skip whitespace after dimensions
    currentPos = skipWhitespace(state.src, currentPos, max);
  }

  // Check for closing parenthesis
  if (currentPos >= max || state.src.charCodeAt(currentPos) !== 0x29 /* ) */) {
    return null;
  }

  return {
    href,
    title,
    renderWidth,
    renderHeight,
  };
}

/**
 * Parse reference link: ![alt][ref] or ![alt][]
 */
function parseReferenceLink(
  state: StateInline,
  labelStart: number,
  labelEnd: number,
  pos: number,
  md: MarkdownIt
): ParseResult | null {
  if (!state.env.references) return null;

  const max = state.posMax;
  let currentPos = pos;
  let label = "";

  // Check for explicit reference label
  if (currentPos < max && state.src.charCodeAt(currentPos) === 0x5b /* [ */) {
    const start = currentPos + 1;
    const refLabelEnd = md.helpers.parseLinkLabel(state, currentPos);

    if (refLabelEnd >= 0) {
      label = state.src.slice(start, refLabelEnd);
      currentPos = refLabelEnd + 1;
    } else {
      currentPos = labelEnd + 1;
    }
  } else {
    currentPos = labelEnd + 1;
  }

  // Use alt text as label if no explicit label provided
  if (!label) {
    label = state.src.slice(labelStart, labelEnd);
  }

  // Normalize and lookup reference
  const normalizedLabel = md.utils.normalizeReference(label);
  const ref = state.env.references[normalizedLabel];

  if (!ref) return null;

  return {
    href: ref.href,
    title: ref.title || "",
    renderWidth: null,
    renderHeight: null,
  };
}

/**
 * Enhanced image parser with dimension support
 */
function axBlurestImageParser(state: StateInline, silent: boolean): boolean {
  const oldPos = state.pos;
  const max = state.posMax;

  // Check for image marker: ![
  if (state.src.charCodeAt(state.pos) !== 0x21 /* ! */) return false;
  if (state.src.charCodeAt(state.pos + 1) !== 0x5b /* [ */) return false;

  const labelStart = state.pos + 2;
  const labelEnd = state.md.helpers.parseLinkLabel(state, state.pos + 1, false);

  // Failed to find closing bracket
  if (labelEnd < 0) return false;

  let pos = labelEnd + 1;
  let parseResult: ParseResult | null = null;

  // Try parsing as inline link
  if (pos < max && state.src.charCodeAt(pos) === 0x28 /* ( */) {
    parseResult = parseInlineLink(state, pos, state.md);
    if (parseResult) {
      pos = state.src.indexOf(")", pos) + 1;
    }
  } else {
    // Try parsing as reference link
    parseResult = parseReferenceLink(
      state,
      labelStart,
      labelEnd,
      pos,
      state.md
    );
    if (parseResult) {
      // Update position for reference links
      if (pos < max && state.src.charCodeAt(pos) === 0x5b /* [ */) {
        const refEnd = state.md.helpers.parseLinkLabel(state, pos);
        pos = refEnd >= 0 ? refEnd + 1 : labelEnd + 1;
      } else {
        pos = labelEnd + 1;
      }
    }
  }

  if (!parseResult) {
    state.pos = oldPos;
    return false;
  }

  // Create token if not in silent mode
  if (!silent) {
    const content = state.src.slice(labelStart, labelEnd);

    // Parse alt text content
    const childTokens: Token[] = [];
    state.md.inline.parse(content, state.md, state.env, childTokens);

    // Create image token
    const token = state.push("image", "img", 0);
    token.attrs = [
      ["src", parseResult.href],
      ["alt", ""],
    ];
    token.children = childTokens;
    token.content = content;

    // Add title attribute if present
    if (parseResult.title) {
      token.attrs.push(["title", parseResult.title]);
    }

    // Store dimensions in token metadata
    if (parseResult.renderWidth !== null || parseResult.renderHeight !== null) {
      token.meta = {
        ...token.meta,
        renderWidth: parseResult.renderWidth,
        renderHeight: parseResult.renderHeight,
      };
    }
  }

  state.pos = pos;
  state.posMax = max;
  return true;
}

/**
 * Render a fallback <img> tag.
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
 * Render the ax-blurest component.
 */
function renderAxBlurestComponent(
  src: string,
  alt: string,
  renderWidth: number | null,
  renderHeight: number | null,
  blurhash: string,
  srcWidth: number,
  srcHeight: number,
  md: MarkdownIt
): string {
  const escapedAlt = md.utils.escapeHtml(alt);
  const escapedSrc = md.utils.escapeHtml(src);

  const axAttrs: [string, string | number][] = [
    ["src-width", srcWidth],
    ["src-height", srcHeight],
    ["alt", escapedAlt],
    ["src", escapedSrc],
    ["blurhash", blurhash],
  ];

  if (renderWidth !== null) axAttrs.push(["render-width", renderWidth]);
  if (renderHeight !== null) axAttrs.push(["render-height", renderHeight]);

  const axAttrsString = axAttrs
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");

  // Build inner <img> tag attributes
  const imgAttrs: string[] = [];
  if (renderWidth !== null) imgAttrs.push(`width="${renderWidth}"`);
  if (renderHeight !== null) imgAttrs.push(`height="${renderHeight}"`);

  const imgTag = `<img ${imgAttrs.join(
    " "
  )} alt="${escapedAlt}" src="${escapedSrc}" />`;

  return `<ax-blurest ${axAttrsString}>${imgTag}</ax-blurest>`;
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
  const { databasePath, staticFileMapping, ...coreOptions } = options;

  // Create core options with the correct database URL parameter
  const blurhashCoreOptions: BlurhashCoreOptions = {
    ...coreOptions,
    databasePath,
  };

  // Create and initialize core
  const core = new BlurhashCore(blurhashCoreOptions);
  core.initialize();

  // Backup default renderer
  const defaultImageRenderer =
    md.renderer.rules.image ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };

  // Replace the default 'image' rule with our enhanced parser
  md.inline.ruler.at("image", axBlurestImageParser);

  // Override image renderer
  md.renderer.rules.image = (
    tokens: Token[],
    idx: number,
    mdOptions: Options,
    env: unknown,
    self: Renderer
  ): string => {
    const token = tokens[idx];

    if (!token) {
      return defaultImageRenderer(tokens, idx, mdOptions, env, self);
    }

    const srcAttr = token.attrGet("src");
    const alt = self.renderInlineAsText(token.children ?? [], mdOptions, env);

    if (!srcAttr) {
      return defaultImageRenderer(tokens, idx, mdOptions, env, self);
    }

    // Get dimensions from token metadata
    const renderWidth = token.meta?.renderWidth ?? null;
    const renderHeight = token.meta?.renderHeight ?? null;

    // Clean the source URL
    const { cleanSrc } = parseImageSrc(srcAttr);

    // Resolve the actual file path using static file mapping
    const resolvedSrc = resolveImagePath(cleanSrc, staticFileMapping);

    const result = core.processImage(resolvedSrc);

    if (!result) {
      // Use fallback <img> tag for skipped files
      return renderFallbackImg(cleanSrc, alt, renderWidth, renderHeight, md);
    }

    if (!result.success) {
      console.warn(
        `[markdown-it-ax-blurest] Failed to get blurhash for "${resolvedSrc}" (original: "${cleanSrc}"): ${result.error}`
      );
      // Fallback to standard <img> tag on processing error
      return renderFallbackImg(cleanSrc, alt, renderWidth, renderHeight, md);
    }

    const { blurhash, width: srcWidth, height: srcHeight } = result;

    return renderAxBlurestComponent(
      cleanSrc, // Use original cleanSrc as the src displayed in frontend
      alt,
      renderWidth,
      renderHeight,
      blurhash,
      srcWidth,
      srcHeight,
      md
    );
  };

  // Store core instance and options for cleanup
  (md as any).__axBlurestCore = core;
  (md as any).__axBlurestOptions = options;
}

/**
 * Cleanup function to properly dispose of resources
 * @param md MarkdownIt instance
 */
export function cleanupAxBlurest(md: MarkdownIt): boolean {
  const core = (md as any).__axBlurestCore as BlurhashCore | undefined;
  if (core) {
    const result = core.cleanup();
    delete (md as any).__axBlurestCore;
    delete (md as any).__axBlurestOptions;
    return result;
  }
  return true;
}

export default axBlurestPlugin;
export type { AxBlurestPluginOptions, StaticFileMapping };
