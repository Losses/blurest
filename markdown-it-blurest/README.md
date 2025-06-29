# @fuuck/markdown-it-blurest

A markdown-it plugin that enhances image rendering with blurhash support and custom web components. This plugin automatically generates blurhash placeholders for images and renders them using the `<ax-blurest>` custom element with progressive loading capabilities.

## Features

- 🎨 **Automatic Blurhash Generation**: Generates blurhash strings for images to provide smooth loading placeholders
- 📐 **Dimension Support**: Supports markdown image dimension syntax (`=WxH`, `=W`, `=xH`)
- 🔄 **Progressive Loading**: Uses custom `<ax-blurest>` web component for enhanced user experience
- 🛡️ **Graceful Fallbacks**: Falls back to standard `<img>` tags when blurhash generation fails
- ⚡ **Performance Optimized**: Built on top of `@fuuck/blurest-core` for efficient processing

## Installation

```bash
npm install @fuuck/markdown-it-blurest
# or
yarn add @fuuck/markdown-it-blurest
# or 
bun add @fuuck/markdown-it-blurest
```

## Usage

### Basic Setup

```javascript
import MarkdownIt from "markdown-it";
import axBlurestPlugin from "@fuuck/markdown-it-blurest";

const md = new MarkdownIt();

// Configure the plugin with blurhash options
md.use(axBlurestPlugin, {
  // BlurhashCoreOptions - configure according to your needs
  // See @fuuck/blurest-core documentation for available options
});

// Render markdown with enhanced images
const html = md.render('![Alt text](image.jpg "Title" =400x300)');
```

### With Cleanup

```javascript
import { cleanupAxBlurest } from "@fuuck/markdown-it-blurest";

// When you're done with the markdown instance
const cleanupSuccess = cleanupAxBlurest(md);
```

## Markdown Syntax

### Standard Image Syntax

```markdown
![Alt text](image.jpg)
![Alt text](image.jpg "Title")
```

### With Dimensions

```markdown
![Alt text](image.jpg =400x300) # Width and height
![Alt text](image.jpg =400x) # Width only
![Alt text](image.jpg =x300) # Height only  
![Alt text](image.jpg =400) # Width only (no 'x')
```

### Reference Style

```markdown
![Alt text][ref]
![Alt text][]

[ref]: image.jpg "Title"
```

## Output

### Successful Blurhash Generation

When blurhash is successfully generated, the plugin outputs:

```html
<ax-blurest
  src-width="800"
  src-height="600"
  alt="Alt text"
  src="image.jpg"
  blurhash="L6PZfSi_.AyE_3t7t7R**0o#DgR4"
  render-width="400"
  render-height="300"
>
  <img width="400" height="300" alt="Alt text" src="image.jpg" />
</ax-blurest>
```

### Fallback Output

When blurhash generation fails or is skipped:

```html
<img src="image.jpg" alt="Alt text" width="400" height="300" />
```

## Configuration

The plugin accepts all configuration options from `@fuuck/blurest-core`. Refer to the BlurhashCore documentation for detailed configuration options.

```javascript
md.use(axBlurestPlugin, {
  // Example configuration
  // Add your BlurhashCoreOptions here
});
```

## Custom Element Integration

This plugin is designed to work with the `<ax-blurest>` custom web component. You'll need to do some basic setup:

```javascript
import { AxBlurest } from 'ax-blurest';

AxBlurest.register();
```

## API Reference

### axBlurestPlugin(md, options)

Main plugin function to register with markdown-it.

- `md`: MarkdownIt instance
- `options`: BlurhashCoreOptions configuration object

### cleanupAxBlurest(md)

Cleanup function to dispose of plugin resources.

- `md`: MarkdownIt instance
- Returns: `boolean` - success status

## Dependencies

- `markdown-it`: Peer dependency for markdown processing
- `@fuuck/blurest-core`: Core blurhash rendering functionality

## Browser Support

This plugin generates HTML that uses custom elements (`<ax-blurest>`). Ensure your target browsers support:

- Web Components
- Or include appropriate polyfills

## Error Handling

The plugin includes robust error handling:

- **Invalid Image URLs**: Falls back to standard `<img>` tags
- **Blurhash Generation Failures**: Logs warnings and uses fallback rendering
- **Parsing Errors**: Gracefully handles malformed markdown syntax


## License

MIT
