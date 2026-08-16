import { describe, test, expect, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

// These helpers live in the compiled package output (`lib/`). Importing the
// source `index.cts` directly is not possible because it references the
// addon loader (`./load.cjs`) which only exists after `tsc` emits `lib/`.
// Running the tests through `bun run test` builds `lib/` first via `tsc`.
import {
  BlurhashCore,
  isSvgFile,
  parseImageSrc,
  validateFile,
} from "../lib/index.cjs";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
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
 * Encode a solid-gray truecolor PNG, a real decodable image, so tests can
 * exercise the native decode/probe path without binary fixtures.
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

describe("isSvgFile", () => {
  test("detects svg by extension (lowercase)", () => {
    expect(isSvgFile("logo.svg")).toBe(true);
    expect(isSvgFile("a/b/c/icon.svg")).toBe(true);
  });

  test("detects svg case-insensitively", () => {
    expect(isSvgFile("logo.SVG")).toBe(true);
    expect(isSvgFile("logo.Svg")).toBe(true);
  });

  test("rejects non-svg extensions", () => {
    expect(isSvgFile("photo.png")).toBe(false);
    expect(isSvgFile("photo.jpg")).toBe(false);
    expect(isSvgFile("photo.webp")).toBe(false);
    expect(isSvgFile("photo.gif")).toBe(false);
  });

  test("does not match svg in the filename without the extension", () => {
    expect(isSvgFile("svg-logo.png")).toBe(false);
    expect(isSvgFile("mysvg")).toBe(false);
    expect(isSvgFile("")).toBe(false);
  });
});

describe("parseImageSrc", () => {
  test("leaves a plain path untouched", () => {
    expect(parseImageSrc("img/photo.png")).toEqual({
      cleanSrc: "img/photo.png",
      renderWidth: null,
      renderHeight: null,
    });
  });

  test("parses width x height", () => {
    expect(parseImageSrc("img/photo.png =100x200")).toEqual({
      cleanSrc: "img/photo.png",
      renderWidth: 100,
      renderHeight: 200,
    });
  });

  test("parses width only (=Wx)", () => {
    expect(parseImageSrc("img/photo.png =100x")).toEqual({
      cleanSrc: "img/photo.png",
      renderWidth: 100,
      renderHeight: null,
    });
  });

  test("parses height only (=xH)", () => {
    expect(parseImageSrc("img/photo.png =x200")).toEqual({
      cleanSrc: "img/photo.png",
      renderWidth: null,
      renderHeight: 200,
    });
  });

  test("treats an empty =x as invalid (returns original src)", () => {
    expect(parseImageSrc("img/photo.png =x")).toEqual({
      cleanSrc: "img/photo.png =x",
      renderWidth: null,
      renderHeight: null,
    });
  });

  test("ignores a bare =N without an x separator", () => {
    // The size pattern requires a literal `x`, so `=100` is not a dimension spec.
    expect(parseImageSrc("img/photo.png =100")).toEqual({
      cleanSrc: "img/photo.png =100",
      renderWidth: null,
      renderHeight: null,
    });
  });
});

describe("validateFile", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "blurest-validate-"));
  const png = path.join(projectRoot, "photo.png");
  const svg = path.join(projectRoot, "logo.svg");
  fs.writeFileSync(png, "not real png bytes");
  fs.writeFileSync(svg, "<svg/>");

  test("skips SVG files before any filesystem check", () => {
    // Even a nonexistent svg path is rejected purely on extension.
    const result = validateFile(path.join(projectRoot, "missing.svg"), projectRoot);
    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toMatch(/svg/i);
  });

  test("skips network URLs", () => {
    const result = validateFile("https://example.com/photo.png", projectRoot);
    expect(result.shouldProcess).toBe(false);
  });

  test("skips missing files", () => {
    const result = validateFile(path.join(projectRoot, "ghost.png"), projectRoot);
    expect(result.shouldProcess).toBe(false);
  });

  test("skips files outside the project root", () => {
    const outside = path.join(os.tmpdir(), "blurest-outside.png");
    fs.writeFileSync(outside, "x");
    const result = validateFile(outside, projectRoot);
    expect(result.shouldProcess).toBe(false);
  });

  test("accepts an existing raster file inside the project root", () => {
    const result = validateFile(png, projectRoot);
    expect(result.shouldProcess).toBe(true);
    expect(result.resolvedPath).toBe(png);
  });
});

describe("BlurhashCore.probeDimensions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blurest-probe-"));
  fs.writeFileSync(path.join(root, "a.png"), makePng(40, 30));
  fs.writeFileSync(
    path.join(root, "logo.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"/>'
  );
  fs.writeFileSync(
    path.join(root, "icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>'
  );
  fs.writeFileSync(
    path.join(root, "fluid.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="auto"/>'
  );

  const core = new BlurhashCore({
    databasePath: path.join(root, "probe.sqlite3"),
    projectRoot: root,
  });
  core.initialize();

  afterAll(() => {
    core.cleanup();
  });

  test("probes raster headers via the native module", () => {
    expect(core.probeDimensions("a.png")).toEqual({ width: 40, height: 30 });
  });

  test("probes SVG with absolute width/height", () => {
    expect(core.probeDimensions("logo.svg")).toEqual({
      width: 120,
      height: 60,
    });
  });

  test("falls back to the SVG viewBox", () => {
    expect(core.probeDimensions("icon.svg")).toEqual({ width: 24, height: 24 });
  });

  test("returns null for non-absolute SVG sizes", () => {
    expect(core.probeDimensions("fluid.svg")).toBeNull();
  });

  test("returns null for network URLs", () => {
    expect(core.probeDimensions("https://example.com/a.png")).toBeNull();
  });

  test("returns null for missing files", () => {
    expect(core.probeDimensions(path.join(root, "ghost.png"))).toBeNull();
  });

  test("stays silent on probe failures unless verbose", () => {
    const quietCore = new BlurhashCore({
      databasePath: path.join(root, "probe.sqlite3"),
      projectRoot: root,
    });
    quietCore.initialize();

    const verboseCore = new BlurhashCore({
      databasePath: path.join(root, "probe.sqlite3"),
      projectRoot: root,
      verbose: true,
    });
    verboseCore.initialize();

    const original = console.debug;
    const calls: string[] = [];
    console.debug = (message: string) => calls.push(message);
    try {
      quietCore.probeDimensions(path.join(root, "ghost.png"));
      expect(calls).toHaveLength(0);
      verboseCore.probeDimensions(path.join(root, "ghost.png"));
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]).toContain("ghost.png");
    } finally {
      console.debug = original;
    }
  });
});

describe("processImage skip logging", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blurest-skip-"));
  fs.writeFileSync(path.join(root, "logo.svg"), "<svg/>");

  const quietCore = new BlurhashCore({
    databasePath: path.join(root, "skip.sqlite3"),
    projectRoot: root,
  });
  quietCore.initialize();

  const verboseCore = new BlurhashCore({
    databasePath: path.join(root, "skip.sqlite3"),
    projectRoot: root,
    verbose: true,
  });
  verboseCore.initialize();

  afterAll(() => {
    quietCore.cleanup();
  });

  test("skipped files are silent unless verbose", () => {
    const original = console.debug;
    const calls: string[] = [];
    console.debug = (message: string) => calls.push(message);
    try {
      expect(quietCore.processImage("logo.svg")).toBeNull();
      expect(calls).toHaveLength(0);
      expect(verboseCore.processImage("logo.svg")).toBeNull();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]).toContain("logo.svg");
    } finally {
      console.debug = original;
    }
  });
});
