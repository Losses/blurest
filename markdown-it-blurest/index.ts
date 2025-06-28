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

  const axAttrs: [string, string | number][] = [
    ["src-width", srcWidth],
    ["src-height", srcHeight],
    ["alt", escapedAlt],
    ["src", escapedSrc],
    ["blurhash", blurhash],
  ];

  if (renderWidth !== null) {
    axAttrs.push(["render-width", renderWidth]);
  }
  if (renderHeight !== null) {
    axAttrs.push(["render-height", renderHeight]);
  }

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
function axBlurestPlugin(md: MarkdownIt, options: BlurhashCoreOptions): void {
  // Create and initialize core
  const core = new BlurhashCore(options);
  core.initialize();

  // Backup default renderer
  const defaultImageRenderer =
    md.renderer.rules.image ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };

  const axBlurestImageParser = (
    state: StateInline,
    silent: boolean
  ): boolean => {
    // This is a fork of the original markdown-it image rule, with modifications
    // to parse `=WIDTHxHEIGHT` dimension attributes.

    let attrs,
      code,
      label,
      labelEnd,
      labelStart,
      pos,
      ref,
      res,
      title,
      token,
      start,
      href = "",
      oldPos = state.pos,
      max = state.posMax;

    // Check for image start: !
    if (state.src.charCodeAt(state.pos) !== 0x21 /* ! */) {
      return false;
    }
    // Check for link open: [
    if (state.src.charCodeAt(state.pos + 1) !== 0x5b /* [ */) {
      return false;
    }

    labelStart = state.pos + 2;
    labelEnd = md.helpers.parseLinkLabel(state, state.pos + 1, false);

    // Parser failed to find ']', so it's not a valid link
    if (labelEnd < 0) {
      return false;
    }

    pos = labelEnd + 1;
    // Check for (
    if (pos < max && state.src.charCodeAt(pos) === 0x28 /* ( */) {
      //
      // Inline link
      //

      pos++;

      // Skip spaces
      for (; pos < max; pos++) {
        code = state.src.charCodeAt(pos);
        if (!md.utils.isSpace(code) && code !== 0x0a) {
          break;
        }
      }
      if (pos >= max) {
        return false;
      }

      // Parse link destination
      start = pos;
      res = md.helpers.parseLinkDestination(state.src, pos, state.posMax);
      if (res.ok) {
        href = md.normalizeLink(res.str);
        if (md.validateLink(href)) {
          pos = res.pos;
        } else {
          href = "";
        }
      }

      // Skip spaces
      start = pos;
      for (; pos < max; pos++) {
        code = state.src.charCodeAt(pos);
        if (!md.utils.isSpace(code) && code !== 0x0a) {
          break;
        }
      }

      // Parse link title
      res = md.helpers.parseLinkTitle(state.src, pos, state.posMax);
      if (pos < max && start !== pos && res.ok) {
        title = res.str;
        pos = res.pos;
        // Skip spaces
        for (; pos < max; pos++) {
          code = state.src.charCodeAt(pos);
          if (!md.utils.isSpace(code) && code !== 0x0a) {
            break;
          }
        }
      } else {
        title = "";
      }

      let renderWidth = null;
      let renderHeight = null;
      // Regex to parse `=WxH`, `=Wx`, or `=xH`
      const dimMatch = state.src.slice(pos).match(/^\s*=\s*([0-9]*)x([0-9]*)/);

      if (dimMatch) {
        const widthStr = dimMatch[1];
        const heightStr = dimMatch[2];
        if (widthStr || heightStr) {
          if (widthStr) renderWidth = parseInt(widthStr, 10);
          if (heightStr) renderHeight = parseInt(heightStr, 10);
          // Advance the parser position
          pos += dimMatch[0].length;

          // Skip spaces after dimensions
          for (; pos < max; pos++) {
            code = state.src.charCodeAt(pos);
            if (!md.utils.isSpace(code) && code !== 0x0a) {
              break;
            }
          }
        }
      }

      // Check for closing )
      if (pos >= max || state.src.charCodeAt(pos) !== 0x29 /* ) */) {
        state.pos = oldPos;
        return false;
      }
      pos++;

      // We found the end of the link, and know for a fact it's a valid link;
      // so all that's left to do is to call tokenizer.
      //
      if (!silent) {
        state.pos = labelStart;
        state.posMax = labelEnd;

        token = state.push("image", "img", 0);
        token.attrs = [
          ["src", href],
          ["alt", ""],
        ];

        const childrenTokens: Token[] = [];
        state.md.inline.parse(
          state.src.slice(labelStart, labelEnd),
          state.md,
          state.env,
          childrenTokens
        );
        token.children = childrenTokens;

        if (title) {
          token.attrs.push(["title", title]);
        }

        if (renderWidth !== null || renderHeight !== null) {
          token.meta = { ...token.meta, renderWidth, renderHeight };
        }
      }

      state.pos = pos;
      state.posMax = max;
      return true;
    }

    //
    // Link reference not implemented for this custom parser for simplicity.
    // If you need it, you would copy the logic from markdown-it's default image parser.
    //
    return false;
  };

  // Replace the default 'image' rule with our new custom one.
  md.inline.ruler.at("image", axBlurestImageParser);

  // Override image renderer (This part is now correct because the parser provides the meta)
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

    // Read dimensions from the token's metadata, populated by our custom parser.
    const renderWidth = token.meta?.renderWidth ?? null;
    const renderHeight = token.meta?.renderHeight ?? null;

    // The srcAttr is already clean, no need to parse dimensions from it here.
    const { cleanSrc } = parseImageSrc(srcAttr);

    console.log("Correctly parsed with custom parser:", {
      originalSrc: srcAttr,
      cleanSrc,
      renderWidth,
      renderHeight,
    });

    const result = core.processImage(cleanSrc);

    if (!result) {
      // Use fallback <img> tag for skipped files (e.g. network URLs)
      return renderFallbackImg(cleanSrc, alt, renderWidth, renderHeight, md);
    }

    if (!result.success) {
      console.warn(
        `[markdown-it-ax-blurest] Failed to get blurhash for "${cleanSrc}": ${result.error}`
      );
      // Fallback to standard <img> tag on processing error
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
