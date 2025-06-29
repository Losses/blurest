# Blurest - Progressive Image Loading for Markdown

A comprehensive, high-performance solution for enhanced image rendering in Markdown with BlurHash placeholders, progressive loading, and seamless web component integration.

### Key Benefits

- **🚀 Performance First**: Native Rust-powered blurhash generation with intelligent caching
- **🎨 Beautiful Placeholders**: Smooth transitions from compact BlurHash placeholders to full images
- **⚡ Progressive Loading**: Viewport-aware lazy loading with Intersection Observer
- **🛡️ Type Safety**: Full TypeScript support across all packages
- **🔧 Easy Integration**: Drop-in solution for existing Markdown workflows
- **📱 Responsive**: Automatic aspect ratio handling and flexible sizing

## 📦 Packages

### [@fuuck/blurest-core](./packages/blurest-core)

_High-performance blurhash generation and caching_

The foundation of our ecosystem - a TypeScript/Node.js library that bridges JavaScript with native Rust modules for lightning-fast blurhash generation. Features intelligent database caching to eliminate redundant processing.

**Key Features:**

- Native module performance optimization
- SQLite-based caching system
- Comprehensive path validation
- Project boundary enforcement
- Batch processing capabilities

### [@fuuck/blurest-wc](./packages/blurest-wc)

_Progressive loading web component_

A modern web component (`<ax-blurest>`) that provides seamless progressive image loading with BlurHash placeholders. Built with Shadow DOM for style encapsulation and performance optimization.

**Key Features:**

- Intersection Observer-based lazy loading
- Smart animation skipping for fast connections
- Debug mode for development
- Custom event dispatching
- Graceful error handling with retro-style indicators

### [@fuuck/markdown-it-blurest](./packages/markdown-it-blurest)

_Markdown-it plugin for enhanced image rendering_

A markdown-it plugin that automatically transforms standard Markdown image syntax into progressive loading experiences. Supports dimension specifications and provides intelligent fallbacks.

**Key Features:**

- Automatic blurhash generation during Markdown processing
- Extended syntax support (`=WxH`, `=W`, `=xH`)
- Graceful fallback to standard `<img>` tags
- Reference-style image support
- Zero-config integration

## 🚀 Quick Start

### 1. Install Packages

```bash
# Core blurhash functionality
npm install @fuuck/blurest-core

# Web component for progressive loading
npm install @fuuck/blurest-wc

# Markdown-it plugin
npm install @fuuck/markdown-it-blurest
```

### 2. Set Up Web Component

```javascript
import { AxBlurest } from "@fuuck/blurest-wc";

// Register the custom element
AxBlurest.register();
```

### 3. Configure Markdown Processing

```javascript
import MarkdownIt from "markdown-it";
import axBlurestPlugin from "@fuuck/markdown-it-blurest";
import { join } from "path";

const md = new MarkdownIt();

md.use(axBlurestPlugin, {
  databaseUrl: join(__dirname, "blurhash-cache.sqlite3"),
  projectRoot: __dirname,
});

// Transform your markdown
const html = md.render(`
![Beautiful landscape](./images/landscape.jpg "Scenic view" =800x600)
`);
```

### 4. Enhanced Markdown Syntax

```markdown
<!-- Standard images -->

![Alt text](image.jpg)

<!-- With dimensions -->

![Landscape](photo.jpg =800x600) # Width and height
![Portrait](photo.jpg =400x) # Width only
![Square](photo.jpg =x400) # Height only

<!-- Reference style -->

![Mountain view][mountain]

[mountain]: ./images/mountain.jpg "Peak at sunset" =1200x800
```

### 5. Generated Output

Your Markdown images are automatically transformed into progressive loading components:

```html
<ax-blurest
  src-width="1200"
  src-height="800"
  alt="Mountain view"
  src="./images/mountain.jpg"
  blurhash="L6PZfSi_.AyE_3t7t7R**0o#DgR4"
  render-width="800"
  render-height="600"
>
  <img
    width="800"
    height="600"
    alt="Mountain view"
    src="./images/mountain.jpg"
  />
</ax-blurest>
```

## 📚 Documentation

- **[Core API Reference](./blurest-core/README.md)** - Detailed blurhash generation API
- **[Web Component Guide](./blurest-wc/README.md)** - Progressive loading component
- **[Markdown Plugin Docs](./markdown-it-blurest/README.md)** - Integration guide

## 📄 License

MIT
