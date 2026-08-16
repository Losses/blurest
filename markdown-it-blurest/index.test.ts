import { describe, test, expect, afterAll } from "bun:test";
import MarkdownIt from "markdown-it";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import axBlurestPlugin, { cleanupAxBlurest } from "./index";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i] ?? 0;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Encode a solid-gray truecolor PNG, a real decodable image, so the
 * blurhash path runs end to end against the native module.
 */
function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 128)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "blurest-mdit-"));
const staticDir = path.join(root, "static");
fs.mkdirSync(staticDir);
fs.writeFileSync(path.join(staticDir, "a.png"), makePng(40, 30));
fs.writeFileSync(
  path.join(staticDir, "logo.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect/></svg>'
);

/** The most recently created instance, for afterAll cleanup. */
let latest: MarkdownIt | null = null;

function makeMd(extra: Record<string, unknown> = {}): MarkdownIt {
  const md = new MarkdownIt();
  md.use(axBlurestPlugin, {
    databasePath: path.join(root, "cache.sqlite3"),
    projectRoot: root,
    staticFileMapping: { staticDir, urlPrefixes: ["/static/"] },
    ...extra,
  });
  latest = md;
  return md;
}

afterAll(() => {
  if (latest) cleanupAxBlurest(latest);
});

describe("successful blurhash rendering", () => {
  test("emits ax-blurest with intrinsic size hints and lazy attributes", () => {
    const html = makeMd().render("![Alt](/static/a.png)");
    expect(html).toContain("<ax-blurest");
    expect(html).toContain('src-width="40"');
    expect(html).toContain('src-height="30"');
    expect(html).toContain('blurhash="');
    expect(html).toContain('blurhash-webp="');
    expect(html).toContain('src="/static/a.png"');
    // Inner fallback img: intrinsic dimensions plus lazy loading.
    expect(html).toContain('width="40"');
    expect(html).toContain('height="30"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('alt="Alt"');
  });

  test("completes a single-sided imsize from the intrinsic ratio", () => {
    const html = makeMd().render("![Alt](/static/a.png =300x)");
    expect(html).toContain('render-width="300"');
    expect(html).not.toContain("render-height=");
    // 300 * 30/40 = 225: the missing side is filled from the intrinsic ratio.
    expect(html).toContain('width="300"');
    expect(html).toContain('height="225"');
  });

  test("keeps both sides when the imsize is complete", () => {
    const html = makeMd().render("![Alt](/static/a.png =100x50)");
    expect(html).toContain('render-width="100"');
    expect(html).toContain('render-height="50"');
    expect(html).toContain('width="100"');
    expect(html).toContain('height="50"');
  });
});

describe("fallback rendering", () => {
  test("probes SVG dimensions via the core", () => {
    const html = makeMd().render("![Logo](/static/logo.svg)");
    expect(html).not.toContain("<ax-blurest");
    expect(html).toContain("<img ");
    expect(html).toContain('src="/static/logo.svg"');
    expect(html).toContain('width="120"');
    expect(html).toContain('height="60"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  test("emits no dimension hints for network images", () => {
    const html = makeMd().render("![Alt](https://example.com/x.png)");
    expect(html).not.toContain("<ax-blurest");
    expect(html).toContain("<img ");
    expect(html).not.toContain("width=");
    expect(html).not.toContain("height=");
    expect(html).toContain('loading="lazy"');
  });

  test("omits lazy attributes when disabled", () => {
    const html = makeMd({ lazy: false }).render("![Alt](/static/a.png)");
    expect(html).not.toContain("loading=");
    expect(html).not.toContain("decoding=");
  });
});

describe("verbosity", () => {
  test("skip messages stay silent unless verbose", () => {
    const original = console.debug;
    const calls: string[] = [];
    console.debug = (message: string) => calls.push(message);
    try {
      makeMd().render("![Logo](/static/logo.svg)");
      makeMd().render("![Alt](https://example.com/x.png)");
      expect(calls).toHaveLength(0);

      makeMd({ verbose: true }).render("![Logo](/static/logo.svg)");
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.some((message) => message.includes("logo.svg"))).toBe(true);
    } finally {
      console.debug = original;
    }
  });
});
