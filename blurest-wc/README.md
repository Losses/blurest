# Blurest Web Component

A web component for progressive image loading with BlurHash placeholders and lazy loading capabilities.

## Features

-   **Progressive Image Loading**: Smooth transition from BlurHash placeholder to actual image
-   **Lazy Loading**: Images load only when they enter the viewport using Intersection Observer
-   **BlurHash Support**: Beautiful, compact placeholder images using BlurHash algorithm
-   **Responsive Design**: Automatic aspect ratio maintenance and flexible sizing
-   **Performance Optimized**: Smart animation skipping for fast-loading images
-   **Debug Mode**: Built-in debugging tools for development
-   **Error Handling**: Graceful fallback with visual error indicators
-   **Custom Events**: Emits events for image load success and failure
-   **Shadow DOM**: Encapsulated styling without global CSS conflicts

## Installation

```bash
npm install @fuuck/blurest-wc
# or
yarn add @fuuck/blurest-wc
# or
bun add @fuuck/blurest-wc
```

## Usage

### Basic Setup

```javascript
import { AxBlurest } from 'ax-blurest';

AxBlurest.register();
```

### HTML Usage

```html
<ax-blurest
    src="https://example.com/image.jpg"
    src-width="800"
    src-height="600"
    blurhash="LGF5]+Yk^6#M@-5c,1J5@[or[Q6."
    alt="Beautiful landscape"
    render-width="400"
>
</ax-blurest>
```

### Advanced Usage with Debug Mode

```html
<ax-blurest
    src="https://example.com/slow-image.jpg"
    src-width="1200"
    src-height="800"
    blurhash="LGF5]+Yk^6#M@-5c,1J5@[or[Q6."
    alt="High resolution image"
    debug
    debug-delay="2000"
>
</ax-blurest>
```

## Attributes

| Attribute      | Type    | Required | Description                                        |
| -------------- | ------- | -------- | -------------------------------------------------- |
| `src`          | string  | Yes      | The URL of the image to load                       |
| `src-width`    | string  | Yes      | Original width of the image in pixels              |
| `src-height`   | string  | Yes      | Original height of the image in pixels             |
| `blurhash`     | string  | Yes      | BlurHash string for the placeholder                |
| `alt`          | string  | No       | Alt text for accessibility (default: empty)        |
| `render-width` | string  | No       | Desired render width in pixels (default: 100%)     |
| `debug`        | boolean | No       | Enable debug mode with visual indicators           |
| `debug-delay`  | string  | No       | Delay in ms for debug mode loading (default: 3000) |

## Display Modes

Control the display behavior using CSS-like attributes:

```html
<!-- Block display -->
<ax-blurest block src="..." blurhash="...">
    <!-- Flexbox -->
    <ax-blurest flex src="..." blurhash="...">
        <!-- Grid -->
        <ax-blurest grid src="..." blurhash="...">
            <!-- Inline variations -->
            <ax-blurest inline-block src="..." blurhash="...">
                <ax-blurest inline-flex src="..." blurhash="...">
                    <ax-blurest
                        inline-grid
                        src="..."
                        blurhash="..."
                    ></ax-blurest></ax-blurest></ax-blurest></ax-blurest></ax-blurest
></ax-blurest>
```

## Events

The component dispatches custom events you can listen to:

```javascript
const blurestElement = document.querySelector('ax-blurest');

// Image successfully loaded
blurestElement.addEventListener('image-loaded', (event) => {
    console.log('Image loaded:', event.detail.src);
});

// Image failed to load
blurestElement.addEventListener('image-error', (event) => {
    console.log('Image error:', event.detail.src);
});
```

## Performance Features

### Smart Animation Skipping

Images that load in under 200ms automatically skip the blur-to-sharp animation for better perceived performance.

### Intersection Observer

Uses modern Intersection Observer API with:

-   10% visibility threshold
-   50px root margin for preloading
-   Automatic cleanup on disconnect

### Viewport-based Loading

-   Images only load when entering the viewport
-   Pending loads are cancelled if elements leave viewport
-   Optimized for scroll performance

## Debug Mode

Enable debug mode for development insights:

```html
<ax-blurest debug debug-delay="5000" src="..." blurhash="..."></ax-blurest>
```

Debug mode provides:

-   Visual loading indicators
-   Console logging of load events
-   Customizable artificial delay for testing
-   Performance timing information

## Browser Support

-   Modern browsers with Web Components support
-   Intersection Observer API support
-   ES6+ features required

## Styling

The component uses Shadow DOM for style encapsulation. You can style the host element:

```css
ax-blurest {
    border-radius: 8px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

/* Responsive behavior */
ax-blurest {
    width: 100%;
    max-width: 600px;
}
```

## Error Handling

When images fail to load, AxBlurest displays a retro-style error indicator with:

-   Windows 95-inspired error icon
-   Red X symbol
-   Maintains aspect ratio
-   Automatic event dispatching

## License

MIT
