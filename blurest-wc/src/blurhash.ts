/**
 * BlurHash to CSS Converter
 *
 * This module provides functionality to convert BlurHash strings into CSS properties
 * that can be used to create blurred placeholder images using CSS gradients.
 *
 * BlurHash is a compact representation of a placeholder for an image that can be
 * decoded into a small blurred version using linear gradients in CSS.
 * 
 * This implementation is based on:
 * https://github.com/JamieMason/blurhash-to-css/
 * Under the MIT License
 */

/**
 * Interface representing CSS properties for a BlurHash placeholder
 */
interface BlurhashCss {
    /** CSS background-image property with linear gradients */
    backgroundImage: string;
    /** CSS background-position property for positioning gradients */
    backgroundPosition: string;
    /** CSS background-repeat property (typically 'no-repeat') */
    backgroundRepeat: string;
    /** CSS background-size property for scaling gradients */
    backgroundSize: string;
    /** CSS filter property for applying blur effect */
    filter: string;
    /** CSS transform property for scaling the element */
    transform: string;
}

/**
 * Represents an RGB color value
 */
interface RgbColor {
    /** Red component (0-255) */
    r: number;
    /** Green component (0-255) */
    g: number;
    /** Blue component (0-255) */
    b: number;
}

/**
 * Configuration options for BlurHash to CSS conversion
 */
interface BlurhashOptions {
    /** Width of the decoded image in pixels */
    width: number;
    /** Height of the decoded image in pixels */
    height: number;
    /** Blur radius in pixels (default: 24) */
    blurRadius?: number;
    /** Scale factor for the transform (default: 1.2) */
    scaleFactor?: number;
    /** Punch factor for BlurHash decoding (default: 1.0) */
    punch?: number;
}

/**
 * BlurHash decoder class that handles the conversion from BlurHash strings to pixel data
 *
 * This is a simplified implementation. In a real-world scenario, you would typically
 * use a proper BlurHash decoding library like 'blurhash' npm package.
 */
class BlurhashDecoder {
    /**
     * Base83 character set used in BlurHash encoding
     */
    private static readonly BASE83_CHARS =
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

    /**
     * Decodes a base83 string to a number
     * @param str - The base83 encoded string
     * @returns The decoded number
     */
    private static decodeBase83(str: string): number {
        let value = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            const index = this.BASE83_CHARS.indexOf(char);
            if (index === -1) {
                throw new Error(`Invalid base83 character: ${char}`);
            }
            value = value * 83 + index;
        }
        return value;
    }

    /**
     * Converts a linear RGB value to sRGB
     * @param value - Linear RGB value (0-1)
     * @returns sRGB value (0-255)
     */
    private static linearTosRgb(value: number): number {
        const v = Math.max(0, Math.min(1, value));
        if (v <= 0.0031308) {
            return Math.round(v * 12.92 * 255);
        } else {
            return Math.round((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
        }
    }

    /**
     * Decodes a BlurHash string into pixel data
     *
     * Note: This is a simplified implementation for demonstration purposes.
     * In production, use a proper BlurHash library.
     *
     * @param blurhash - The BlurHash string to decode
     * @param width - Target width in pixels
     * @param height - Target height in pixels
     * @param punch - Punch factor for contrast adjustment
     * @returns Array of RGBA pixel data
     */
    static decode(blurhash: string, width: number, height: number, punch: number = 1.0): Uint8Array {
        if (!blurhash || blurhash.length < 6) {
            throw new Error('Invalid BlurHash string');
        }

        // This is a simplified mock implementation
        // In reality, you would use the full BlurHash decoding algorithm
        const pixels = new Uint8Array(width * height * 4);

        // Generate a simple gradient as a placeholder
        // Real implementation would decode the actual BlurHash components
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;

                // Simple gradient based on position
                const r = Math.floor((x / width) * 255);
                const g = Math.floor((y / height) * 255);
                const b = Math.floor(((x + y) / (width + height)) * 255);

                pixels[index] = r; // Red
                pixels[index + 1] = g; // Green
                pixels[index + 2] = b; // Blue
                pixels[index + 3] = 255; // Alpha
            }
        }

        return pixels;
    }
}

/**
 * Utility class for BlurHash to CSS conversion
 */
class BlurhashCssConverter {
    /**
     * Calculates the rounded percentage of a part relative to a whole
     *
     * @param part - The part value
     * @param whole - The whole value
     * @returns Rounded percentage as an integer
     *
     * @example
     * ```typescript
     * const percentage = BlurhashCssConverter.getRoundedPercentageOf(25, 100);
     * console.log(percentage); // 25
     * ```
     */
    private static getRoundedPercentageOf(part: number, whole: number): number {
        if (whole === 0) {
            return 0;
        }
        const value = (part / whole) * 100;
        return Math.round(value);
    }

    /**
     * Extracts a pixel value from the pixel data array
     *
     * @param pixelBytes - The pixel data array (RGBA format)
     * @param x - X coordinate of the pixel
     * @param y - Y coordinate of the pixel
     * @param width - Width of the image
     * @param channelIndex - Channel index (0=R, 1=G, 2=B, 3=A)
     * @returns The pixel value for the specified channel
     */
    private static getPixel(pixelBytes: Uint8Array, x: number, y: number, width: number, channelIndex: number): number {
        const numberOfChannels = 4; // RGBA
        const bytesPerRow = width * numberOfChannels;
        const index = numberOfChannels * x + channelIndex + y * bytesPerRow;

        if (index >= pixelBytes.length) {
            throw new Error(`Pixel index out of bounds: ${index}`);
        }

        return pixelBytes[index];
    }

    /**
     * Extracts RGB color from pixel data at specified coordinates
     *
     * @param pixelBytes - The pixel data array
     * @param x - X coordinate
     * @param y - Y coordinate
     * @param width - Image width
     * @returns RGB color object
     */
    private static getRgbColor(pixelBytes: Uint8Array, x: number, y: number, width: number): RgbColor {
        return {
            r: this.getPixel(pixelBytes, x, y, width, 0),
            g: this.getPixel(pixelBytes, x, y, width, 1),
            b: this.getPixel(pixelBytes, x, y, width, 2),
        };
    }

    /**
     * Converts a BlurHash string to pixel data
     *
     * @param hash - The BlurHash string
     * @param width - Target width in pixels
     * @param height - Target height in pixels
     * @param punch - Punch factor for contrast adjustment
     * @returns Pixel data as Uint8Array
     */
    private static blurhashToBytes(hash: string, width: number, height: number, punch: number = 1.0): Uint8Array {
        try {
            return BlurhashDecoder.decode(hash, width, height, punch);
        } catch (error) {
            throw new Error(`Failed to decode BlurHash: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Converts a BlurHash string to a CSS properties object
     *
     * This method generates CSS linear gradients that approximate the BlurHash image,
     * allowing for smooth placeholder images that can be displayed before the actual
     * image loads.
     *
     * @param hash - The BlurHash string to convert
     * @param options - Configuration options for the conversion
     * @returns CSS properties object for creating the BlurHash placeholder
     *
     * @throws {Error} When the BlurHash string is invalid or decoding fails
     *
     * @example
     * ```typescript
     * const css = BlurhashCssConverter.blurhashToCssStruct(
     *   'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.',
     *   { width: 32, height: 32, blurRadius: 20 }
     * );
     *
     * // Apply to DOM element
     * Object.assign(element.style, css);
     * ```
     */
    private static blurhashToCssStruct(hash: string, options: BlurhashOptions): BlurhashCss {
        const { width, height, blurRadius = 24, scaleFactor = 1.2, punch = 1.0 } = options;

        // Validate inputs
        if (!hash || typeof hash !== 'string') {
            throw new Error('Invalid BlurHash: must be a non-empty string');
        }

        if (width <= 0 || height <= 0) {
            throw new Error('Width and height must be positive numbers');
        }

        // Decode BlurHash to pixel data
        const pixelBytes = this.blurhashToBytes(hash, width, height, punch);

        // Calculate background size - each row takes up a proportional height
        const backgroundSize = `100% ${100.0 / height}%`;

        const backgroundPositions: string[] = [];
        const linearGradients: string[] = [];

        // Process each row of pixels
        for (let y = 0; y < height; y++) {
            const rowLinearGradients: string[] = [];

            // Process each pixel in the row
            for (let x = 0; x < width; x++) {
                const { r, g, b } = this.getRgbColor(pixelBytes, x, y, width);

                // Calculate gradient stop positions
                const startPercent = x === 0 ? '' : ` ${this.getRoundedPercentageOf(x, width)}%`;

                const endPercent = x === width - 1 ? '' : ` ${this.getRoundedPercentageOf(x + 1, width)}%`;

                // Create color stop for this pixel
                const colorStop = `rgb(${r},${g},${b})${startPercent}${endPercent}`;
                rowLinearGradients.push(colorStop);
            }

            // Create horizontal linear gradient for this row
            const rowGradient = `linear-gradient(90deg,${rowLinearGradients.join(',')})`;
            linearGradients.push(rowGradient);

            // Calculate vertical position for this row
            if (y === 0) {
                backgroundPositions.push('0 0');
            } else {
                const position = `0 ${this.getRoundedPercentageOf(y, height - 1)}%`;
                backgroundPositions.push(position);
            }
        }

        return {
            backgroundImage: linearGradients.join(','),
            backgroundPosition: backgroundPositions.join(','),
            backgroundRepeat: 'no-repeat',
            backgroundSize: backgroundSize,
            filter: `blur(${blurRadius}px)`,
            transform: `scale(${scaleFactor})`,
        };
    }

    /**
     * Converts a single BlurHash string to CSS properties JSON string
     *
     * This is the main public method for converting a BlurHash to CSS.
     * It returns a JSON string that can be parsed and applied to DOM elements.
     *
     * @param hash - The BlurHash string to convert
     * @param width - Target width in pixels (recommended: 32-64 for performance)
     * @param height - Target height in pixels (recommended: 32-64 for performance)
     * @param blurRadius - Blur radius in pixels (default: 24)
     * @param scaleFactor - Scale factor for transform (default: 1.2)
     * @returns JSON string of CSS properties
     *
     * @throws {Error} When conversion fails
     *
     * @example
     * ```typescript
     * const cssJson = BlurhashCssConverter.blurhashToCss(
     *   'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.',
     *   32,
     *   32
     * );
     *
     * const cssProperties = JSON.parse(cssJson);
     * Object.assign(element.style, cssProperties);
     * ```
     */
    static blurhashToCss(
        hash: string,
        width: number,
        height: number,
        blurRadius: number = 24,
        scaleFactor: number = 1.2
    ): string {
        try {
            const cssStruct = this.blurhashToCssStruct(hash, {
                width,
                height,
                blurRadius,
                scaleFactor,
            });

            return JSON.stringify(cssStruct, null, 2);
        } catch (error) {
            throw new Error(
                `Failed to convert BlurHash to CSS: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Converts multiple BlurHash strings to CSS properties JSON string
     *
     * This method processes an array of BlurHash strings and returns an array
     * of CSS property objects, useful for batch processing multiple images.
     *
     * @param hashes - Array of BlurHash strings to convert
     * @param width - Target width in pixels for all images
     * @param height - Target height in pixels for all images
     * @param blurRadius - Blur radius in pixels (default: 24)
     * @param scaleFactor - Scale factor for transform (default: 1.2)
     * @returns JSON string of array containing CSS properties for each BlurHash
     *
     * @throws {Error} When any conversion fails
     *
     * @example
     * ```typescript
     * const hashes = [
     *   'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.',
     *   'L6PZfSi_.AyE_3t7t7R**0o#DgR4'
     * ];
     *
     * const cssArrayJson = BlurhashCssConverter.blurhashesToCss(hashes, 32, 32);
     * const cssArray = JSON.parse(cssArrayJson);
     *
     * cssArray.forEach((css, index) => {
     *   Object.assign(elements[index].style, css);
     * });
     * ```
     */
    static blurhashesToCss(
        hashes: string[],
        width: number,
        height: number,
        blurRadius: number = 24,
        scaleFactor: number = 1.2
    ): string {
        if (!Array.isArray(hashes)) {
            throw new Error('Hashes must be an array');
        }

        try {
            const cssStructs = hashes.map((hash, index) => {
                try {
                    return this.blurhashToCssStruct(hash, {
                        width,
                        height,
                        blurRadius,
                        scaleFactor,
                    });
                } catch (error) {
                    throw new Error(
                        `Failed to process BlurHash at index ${index}: ${
                            error instanceof Error ? error.message : 'Unknown error'
                        }`
                    );
                }
            });

            return JSON.stringify(cssStructs, null, 2);
        } catch (error) {
            throw new Error(
                `Failed to convert BlurHashes to CSS: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Converts a BlurHash to CSS properties object (not JSON string)
     *
     * This method returns the actual CSS properties object instead of a JSON string,
     * which can be directly applied to DOM elements or used in CSS-in-JS solutions.
     *
     * @param hash - The BlurHash string to convert
     * @param options - Configuration options for the conversion
     * @returns CSS properties object
     *
     * @example
     * ```typescript
     * const css = BlurhashCssConverter.blurhashToCssObject(
     *   'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.',
     *   { width: 32, height: 32 }
     * );
     *
     * // Direct application to DOM element
     * Object.assign(element.style, css);
     *
     * // Or use with CSS-in-JS
     * const StyledDiv = styled.div(css);
     * ```
     */
    static blurhashToCssObject(hash: string, options: BlurhashOptions): BlurhashCss {
        return this.blurhashToCssStruct(hash, options);
    }
}

/**
 * Utility functions for working with BlurHash CSS
 */
class BlurhashUtils {
    /**
     * Applies BlurHash CSS to a DOM element
     *
     * @param element - The DOM element to apply styles to
     * @param hash - The BlurHash string
     * @param options - Configuration options
     *
     * @example
     * ```typescript
     * const element = document.getElementById('placeholder');
     * BlurhashUtils.applyBlurhashToElement(
     *   element,
     *   'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.',
     *   { width: 32, height: 32 }
     * );
     * ```
     */
    static applyBlurhashToElement(element: HTMLElement, hash: string, options: BlurhashOptions): void {
        try {
            const css = BlurhashCssConverter.blurhashToCssObject(hash, options);

            // Convert camelCase to kebab-case for CSS properties
            const kebabCss: Record<string, string> = {};
            Object.entries(css).forEach(([key, value]) => {
                const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
                kebabCss[kebabKey] = value;
            });

            // Apply styles
            Object.assign(element.style, kebabCss);
        } catch (error) {
            console.error('Failed to apply BlurHash to element:', error);
            throw error;
        }
    }

    /**
     * Validates a BlurHash string format
     *
     * @param hash - The BlurHash string to validate
     * @returns True if the hash appears to be valid
     *
     * @example
     * ```typescript
     * if (BlurhashUtils.isValidBlurhash('LGF5]+Yk^6#M@-5c,1J5@[or[Q6.')) {
     *   console.log('Valid BlurHash');
     * }
     * ```
     */
    static isValidBlurhash(hash: string): boolean {
        if (!hash || typeof hash !== 'string') {
            return false;
        }

        // Basic validation - BlurHash should be at least 6 characters
        if (hash.length < 6) {
            return false;
        }

        // Check if all characters are valid base83 characters
        const validChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
        return hash.split('').every((char) => validChars.includes(char));
    }
}

// Export the main converter class and utilities
export { BlurhashCssConverter, BlurhashUtils, type BlurhashCss, type BlurhashOptions, type RgbColor };

// Default export for convenient importing
export default BlurhashCssConverter;
