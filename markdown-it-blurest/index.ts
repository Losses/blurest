import type MarkdownIt from "markdown-it";
import type { Renderer, Token, Options } from "markdown-it/index.js";

import {
  BlurhashCore,
  type BlurhashCoreOptions,
  parseImageSrc,
} from "@fuuck/blurest-core";

/**
 * Plugin options for the markdown-it plugin.
 */
export interface AxBlurestPluginOptions extends BlurhashCoreOptions {}

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
 * Render the ax-blurest component.
 * @param src Image source
 * @param alt Alt text
 * @param renderWidth Render width
 * @param renderHeight Render height
 * @param blurhash Blurhash string
 * @param srcWidth Original image width
 * @param srcHeight Original image height
 * @param md MarkdownIt instance for escaping
 * @returns HTML string
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
  // Create and initialize core
  const core = new BlurhashCore(options);
  core.initialize();

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

    // Parse src to get path and render dimensions
    const { cleanSrc, renderWidth, renderHeight } = parseImageSrc(srcAttr);

    // Process image through core
    const result = core.processImage(srcAttr);

    if (!result) {
      // Use fallback <img> tag for skipped files
      return renderFallbackImg(cleanSrc, alt, renderWidth, renderHeight, md);
    }

    if (!result.success) {
      console.warn(
        `[markdown-it-ax-blurest] Failed to get blurhash for "${cleanSrc}": ${result.error}`
      );
      // Fallback to standard <img> tag
      return renderFallbackImg(cleanSrc, alt, renderWidth, renderHeight, md);
    }

    const { blurhash, width: srcWidth, height: srcHeight } = result;

    return renderAxBlurestComponent(
      cleanSrc,
      alt,
      renderWidth,
      renderHeight,
      blurhash,
      srcWidth,
      srcHeight,
      md
    );
  };

  // Store core instance for potential cleanup
  (md as any).__axBlurestCore = core;
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
    return result;
  }
  return true;
}

export default axBlurestPlugin;
