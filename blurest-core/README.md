# @fuuck/blurest-core

A high-performance TypeScript/Node.js library for generating and caching [Blurhash](https://blurha.sh/) placeholders for images. This library provides a integration between JavaScript and a Rust module for optimal performance, with built-in database caching to avoid redundant processing.

## Features

- 🚀 **High Performance**: Native module implementation for fast blurhash generation
- 💾 **Smart Caching**: Database-backed caching system to avoid reprocessing images
- 🛡️ **Type Safety**: Full TypeScript support with comprehensive type definitions
- 📁 **Path Validation**: Automatic validation of image paths and project boundaries
- 🔧 **Easy Integration**: Simple API for seamless integration into existing projects

## Installation

```bash
npm install @fuuck/blurest-core
# or
yarn add @fuuck/blurhash-core
# or
bun add @fuuck/blurhash-core
```

## Quick Start

```typescript
import { BlurhashCore } from "@fuuck/blurest-core";

// Initialize the core
const blurhash = new BlurhashCore({
  databasePath: join(__dirname, "db.sqlite3"),
  projectRoot: __dirname,
});

// Initialize the cache system
blurhash.initialize();

// Process an image
const result = blurhash.processImage("./images/photo.jpg");

if (result && result.success) {
  console.log("Blurhash:", result.blurhash);
  console.log("Dimensions:", result.width, "x", result.height);
} else if (result && !result.success) {
  console.error("Error:", result.error);
}

// Cleanup when done
blurhash.cleanup();
```

## API Reference

### BlurhashCore Class

#### Constructor

```typescript
new BlurhashCore(options: BlurhashCoreOptions)
```

**Options:**

- `databasePath`: Path of the database file, will be created if it doesn't exist
- `projectRoot`: Absolute path to your project root directory

#### Methods

##### `initialize(): void`

Initializes the blurhash cache system. Must be called before processing any images.

```typescript
blurhash.initialize();
```

##### `isInitialized(): boolean`

Checks if the core is properly initialized.

```typescript
if (blurhash.isInitialized()) {
  // Ready to process images
}
```

##### `processImage(src: string): BlurhashResult | null`

Processes an image and returns blurhash data. Returns `null` if the image should be skipped.

```typescript
const result = blurhash.processImage("./images/photo.jpg");
```

**Returns:**

- `BlurhashSuccessResult` on success
- `BlurhashErrorResult` on error
- `null` if processing should be skipped

##### `cleanup(): boolean`

Cleans up resources and closes database connections.

```typescript
blurhash.cleanup();
```

##### `getProjectRoot(): string`

Returns the configured project root path.

### Utility Functions

#### `parseImageSrc(src: string): ParsedImageSource`

Parses image source strings with optional dimension specifications.

```typescript
import { parseImageSrc } from "@fuuck/blurest-core";

// Examples:
parseImageSrc("image.jpg =100x200"); // { cleanSrc: 'image.jpg', renderWidth: 100, renderHeight: 200 }
parseImageSrc("image.jpg =100x"); // { cleanSrc: 'image.jpg', renderWidth: 100, renderHeight: null }
parseImageSrc("image.jpg =x200"); // { cleanSrc: 'image.jpg', renderWidth: null, renderHeight: 200 }
parseImageSrc("image.jpg"); // { cleanSrc: 'image.jpg', renderWidth: null, renderHeight: null }
```

#### `validateFile(src: string, projectRoot: string): FileValidationResult`

Validates whether a file should be processed by the native module.

```typescript
import { validateFile } from "@fuuck/blurest-core";

const validation = validateFile("./image.jpg", "/project/root");
if (validation.shouldProcess) {
  console.log("File can be processed:", validation.resolvedPath);
} else {
  console.log("Skipping file:", validation.reason);
}
```

#### `isNetworkUrl(src: string): boolean`

Checks if a URL is a network URL (HTTP/HTTPS).

```typescript
import { isNetworkUrl } from "@fuuck/blurest-core";

isNetworkUrl("https://example.com/image.jpg"); // true
isNetworkUrl("./local/image.jpg"); // false
```

## Type Definitions

### BlurhashResult Types

```typescript
interface BlurhashSuccessResult {
  success: true;
  blurhash: string;
  width: number;
  height: number;
}

interface BlurhashErrorResult {
  success: false;
  error: string;
}

type BlurhashResult = BlurhashSuccessResult | BlurhashErrorResult;
```

### Configuration Types

```typescript
interface BlurhashCoreOptions {
  databasePath: string;
  projectRoot: string;
}

interface ParsedImageSource {
  cleanSrc: string;
  renderWidth: number | null;
  renderHeight: number | null;
}

interface FileValidationResult {
  shouldProcess: boolean;
  resolvedPath?: string;
  reason?: string;
}
```

## Usage Examples

### Basic Image Processing

```typescript
import { BlurhashCore } from "@fuuck/blurest-core";

const core = new BlurhashCore({
  databasePath: join(__dirname, "db.sqlite3"),
  projectRoot: __dirname,
});

core.initialize();

// Process a single image
const result = core.processImage("./src/assets/hero-image.jpg");
if (result?.success) {
  console.log(`Generated blurhash: ${result.blurhash}`);
  console.log(`Image dimensions: ${result.width}x${result.height}`);
}
```

### Batch Processing

```typescript
import { BlurhashCore } from "@fuuck/blurest-core";
import { glob } from "glob";

const core = new BlurhashCore({
  databasePath: join(__dirname, "db.sqlite3"),
  projectRoot: __dirname,
});

core.initialize();

// Process all images in a directory
const imageFiles = glob.sync("./src/assets/**/*.{jpg,jpeg,png,webp}");

const results = imageFiles.map((file) => {
  const result = core.processImage(file);
  return { file, result };
});

console.log(`Processed ${results.length} images`);
core.cleanup();
```

### Integration with Markdown Processing

```typescript
import { BlurhashCore, parseImageSrc } from "@fuuck/blurest-core";

const core = new BlurhashCore({
  databasePath: join(__dirname, "db.sqlite3"),
  projectRoot: __dirname,
});

core.initialize();

function processMarkdownImage(src: string) {
  // Parse image source for dimensions
  const { cleanSrc, renderWidth, renderHeight } = parseImageSrc(src);

  // Get blurhash for the clean source
  const blurhashResult = core.processImage(cleanSrc);

  if (blurhashResult?.success) {
    return {
      src: cleanSrc,
      blurhash: blurhashResult.blurhash,
      intrinsicWidth: blurhashResult.width,
      intrinsicHeight: blurhashResult.height,
      renderWidth,
      renderHeight,
    };
  }

  return null;
}

// Usage
const imageData = processMarkdownImage("./images/photo.jpg =800x600");
```

## Error Handling

The library provides comprehensive error handling:

```typescript
try {
  core.initialize();

  const result = core.processImage("./image.jpg");

  if (result === null) {
    console.log(
      "Image processing was skipped (likely a network URL or invalid path)"
    );
  } else if (!result.success) {
    console.error("Blurhash generation failed:", result.error);
  } else {
    console.log("Success:", result.blurhash);
  }
} catch (error) {
  console.error("Initialization or processing error:", error);
} finally {
  core.cleanup();
}
```

## File Validation

The library automatically validates files before processing:

- ✅ **Local files only**: Network URLs are automatically skipped
- ✅ **Project boundary**: Files must be within the specified project root
- ✅ **File existence**: Non-existent files are skipped
- ✅ **File type**: Only actual files are processed (not directories)

## Performance Considerations

- **Caching**: The library uses a database cache to avoid reprocessing unchanged images
- **Native Performance**: Core blurhash generation is handled by a native module for optimal speed
- **Memory Management**: Automatic cleanup of resources when done processing
- **Batch Processing**: Efficient handling of multiple images in sequence

## License

MIT
