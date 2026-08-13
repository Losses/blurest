import { describe, test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// These helpers live in the compiled package output (`lib/`). Importing the
// source `index.cts` directly is not possible because it references the
// addon loader (`./load.cjs`) which only exists after `tsc` emits `lib/`.
// Running the tests through `bun run test` builds `lib/` first via `tsc`.
import {
  isSvgFile,
  parseImageSrc,
  validateFile,
} from "../lib/index.cjs";

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
