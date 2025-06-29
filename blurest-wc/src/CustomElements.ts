import BlurhashCssConverter, { BlurhashUtils } from './blurhash';

export class AxBlurest extends HTMLElement {
    static readonly ElementName = 'ax-blurest';
    private root = this.attachShadow({ mode: 'open' });
    private observer: IntersectionObserver | null = null;
    private isInViewport = false;
    private loadingTimer: number | null = null;
    private loadStartTime: number | null = null;

    isImageLoaded: boolean = false;
    isImageError: boolean = false;

    connectedCallback() {
        this.render();
        this.setupIntersectionObserver();
    }

    disconnectedCallback() {
        this.cleanupObserver();
        this.cleanupTimer();
    }

    private setupIntersectionObserver() {
        this.cleanupObserver();

        this.observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting && !this.isInViewport) {
                        this.isInViewport = true;
                        this.handleViewportEntry();
                    } else if (!entry.isIntersecting && this.isInViewport) {
                        this.isInViewport = false;
                        this.handleViewportExit();
                    }
                });
            },
            {
                threshold: 0.1,
                rootMargin: '50px',
            }
        );

        this.observer.observe(this);
    }

    private handleViewportEntry() {
        if (this.isImageLoaded || this.isImageError) {
            return;
        }

        const debugMode = this.getAttribute('debug') !== null;
        const debugDelay = this.getDebugDelay();

        if (debugMode) {
            console.log(`[AxBlurest Debug] Element entered viewport, will load image in ${debugDelay}ms`);

            this.addDebugIndicator();

            this.loadingTimer = window.setTimeout(() => {
                console.log('[AxBlurest Debug] Loading image now');
                this.loadImage();
                this.removeDebugIndicator();
            }, debugDelay);
        } else {
            this.loadImage();
        }
    }

    private handleViewportExit() {
        if (this.loadingTimer && !this.isImageLoaded) {
            clearTimeout(this.loadingTimer);
            this.loadingTimer = null;
            this.removeDebugIndicator();
            const debugMode = this.getAttribute('debug') !== null;
            if (debugMode) {
                console.log('[AxBlurest Debug] Element left viewport, cancelled pending image load');
            }
        }
    }

    private getDebugDelay(): number {
        const delayAttr = this.getAttribute('debug-delay');
        if (delayAttr) {
            const delay = parseInt(delayAttr, 10);
            return isNaN(delay) ? 3000 : delay;
        }
        return 3000;
    }

    private addDebugIndicator() {
        const blurhashLayer = this.root.querySelector('.blurhash-layer') as HTMLElement;
        if (blurhashLayer) {
            blurhashLayer.classList.add('debug-loading');
        }
    }

    private removeDebugIndicator() {
        const blurhashLayer = this.root.querySelector('.blurhash-layer') as HTMLElement;
        if (blurhashLayer) {
            blurhashLayer.classList.remove('debug-loading');
        }
    }

    private cleanupObserver() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    private cleanupTimer() {
        if (this.loadingTimer) {
            clearTimeout(this.loadingTimer);
            this.loadingTimer = null;
        }
    }

    render() {
        const src = this.getAttribute('src');
        const srcWidth = this.getAttribute('src-width');
        const srcHeight = this.getAttribute('src-height');
        const blurhash = this.getAttribute('blurhash');
        const alt = this.getAttribute('alt') || '';
        const renderWidth = this.getAttribute('render-width');
        const debugMode = this.getAttribute('debug') !== null;

        const hasCompleteData = srcWidth && srcHeight && blurhash;

        if (!hasCompleteData) {
            this.root.innerHTML = `
                <style>
                    :host {
                        display: inline-block;
                        line-height: 0;
                        ${renderWidth ? `width: ${renderWidth}px;` : 'width: 100%;'}
                        height: auto;
                    }
                    :host([block]) { display: block; } :host([inline-block]) { display: inline-block; }
                    :host([flex]) { display: flex; } :host([inline-flex]) { display: inline-flex; }
                    :host([grid]) { display: grid; } :host([inline-grid]) { display: inline-grid; }

                    .image-layer {
                        opacity: 0;
                        width: 100%;
                        height: auto;
                        display: block;
                    }

                    .image-layer.loaded {
                        opacity: 1;
                    }
                </style>
                ${src ? `<img class="image-layer" src="" alt="${alt}" data-src="${src}">` : ''}
            `;
            return;
        }

        const aspectRatio = parseFloat(srcWidth) / parseFloat(srcHeight);
        const blurhashCSS = this.generateBlurhashCSS(blurhash, aspectRatio);

        this.root.innerHTML = `
            <style>
                :host {
                    display: inline-block;
                    position: relative;
                    ${renderWidth ? `width: ${renderWidth}px;` : 'width: 100%;'}
                    height: auto;
                    aspect-ratio: ${aspectRatio};
                    overflow: hidden;
                }
                :host([block]) { display: block; } :host([inline-block]) { display: inline-block; }
                :host([flex]) { display: flex; } :host([inline-flex]) { display: inline-flex; }
                :host([grid]) { display: grid; } :host([inline-grid]) { display: inline-grid; }

                .container {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                }

                .blurhash-backdrop-layer,
                .blurhash-layer,
                .image-layer,
                .error-layer {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                
                .blurhash-backdrop-layer,
                .blurhash-layer {
                    ${blurhashCSS}
                }

                .blurhash-layer {
                    opacity: 1;
                    transition: opacity 500ms ease-in-out;
                }

                .error-layer {
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 300ms ease-in-out;
                    box-sizing: border-box;
                }

                .image-layer {
                    opacity: 0;
                    filter: blur(30px);
                    transform: scale(1.1);
                    transition: opacity 400ms ease-in-out,
                                filter 600ms cubic-bezier(0.4, 0, 0.2, 1) 150ms,
                                transform 600ms cubic-bezier(0.4, 0, 0.2, 1) 150ms;
                }

                .image-layer.loaded {
                    opacity: 1;
                    filter: blur(0px);
                    transform: scale(1);
                    pointer-events: auto;
                }

                .image-layer.no-animation {
                    transition: none;
                }

                .error-layer.visible {
                    opacity: 1;
                    pointer-events: auto;
                }

                .blurhash-layer.fade-out {
                    opacity: 0;
                }

                .error-layer { background: #ffffff; border: 1px inset #c0c0c0; border-top-color: #808080; border-left-color: #808080; border-right-color: #dfdfdf; border-bottom-color: #dfdfdf; box-shadow: inset 1px 1px 0px #808080, inset -1px -1px 0px #eee; }
                .icon-container { position: absolute; top: 8px; left: 8px; width: 14px; height: 20px; background: white; border: 1px outset #c0c0c0; border-top-color: #d6d6d6; border-left-color: #d6d6d6; border-right-color: #808080; border-bottom-color: #808080; box-shadow: inset 1px 1px 0px #dfdfdf, inset -1px -1px 0px #9f9f9f; }
                .red-x { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 6px; height: 6px; }
                .red-x::before, .red-x::after { content: ""; position: absolute; top: 50%; left: 50%; width: 8px; height: 1.25px; background: #ff0000; transform-origin: center; }
                .red-x::before { transform: translate(-50%, -50%) rotate(45deg); }
                .red-x::after { transform: translate(-50%, -50%) rotate(-45deg); }
                ${
                    debugMode
                        ? `
                .blurhash-layer.debug-loading::after { content: 'Loading...'; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0, 0, 0, 0.7); color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-family: monospace; z-index: 10; animation: pulse 1.5s ease-in-out infinite; }
                @keyframes pulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
                .container::before { content: 'DEBUG MODE'; position: absolute; top: 4px; left: 4px; background: #ff4444; color: white; padding: 2px 6px; border-radius: 2px; font-size: 10px; font-family: monospace; z-index: 20; opacity: 0.8; }
                `
                        : ''
                }
            </style>
            
            <div class="container">
                <div class="blurhash-backdrop-layer"></div>
                <div class="blurhash-layer"></div>
                ${src ? `<img class="image-layer" src="" alt="${alt}" data-src="${src}">` : ''}
                <div class="error-layer">
                    <div class="icon-container"><div class="red-x"></div></div>
                </div>
            </div>
        `;
    }

    private generateBlurhashCSS(blurhash: string, aspectRatio: number): string {
        try {
            if (!BlurhashUtils.isValidBlurhash(blurhash)) {
                console.warn('Invalid BlurHash provided:', blurhash);
                return 'background-color: #f0f0f0;';
            }

            const baseSize = 32;
            const width = baseSize;
            const height = Math.round(baseSize / aspectRatio);

            const cssProperties = BlurhashCssConverter.blurhashToCssObject(blurhash, {
                width,
                height,
                blurRadius: 16,
                scaleFactor: 1.1,
                punch: 1.2,
            });

            return Object.entries(cssProperties)
                .map(([key, value]) => {
                    const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
                    return `${kebabKey}: ${value};`;
                })
                .join('\n                    ');
        } catch (error) {
            console.error('Failed to generate BlurHash CSS:', error);
            return `
                background: linear-gradient(135deg, #e0e0e0 0%, #f0f0f0 50%, #e0e0e0 100%);
                background-size: 200% 200%;
                animation: gradient-shift 3s ease infinite;
            `;
        }
    }

    loadImage() {
        const imageLayer = this.root.querySelector('.image-layer') as HTMLImageElement;
        if (!imageLayer) return;

        const src = imageLayer.getAttribute('data-src');
        if (!src || this.isImageLoaded || this.isImageError) return;

        this.loadStartTime = Date.now();
        const blurhashLayer = this.root.querySelector('.blurhash-layer') as HTMLElement;
        const img = new Image();

        img.onload = () => {
            const loadDuration = this.loadStartTime ? Date.now() - this.loadStartTime : 999;
            const debugMode = this.getAttribute('debug') !== null;

            if (loadDuration < 200 && blurhashLayer) {
                imageLayer.classList.add('no-animation');
                if (debugMode) console.log(`[AxBlurest Debug] Image loaded in ${loadDuration}ms. Skipping animation.`);
            }

            imageLayer.src = src;
            imageLayer.classList.add('loaded');

            if (blurhashLayer) {
                blurhashLayer.classList.add('fade-out');
            }

            this.isImageLoaded = true;

            this.dispatchEvent(
                new CustomEvent('image-loaded', {
                    detail: { src },
                    bubbles: true,
                    composed: true,
                })
            );

            if (debugMode) {
                console.log('[AxBlurest Debug] Image loaded successfully:', src);
            }
        };

        img.onerror = () => {
            console.warn('Image failed to load:', src);
            this.isImageError = true;

            const errorLayer = this.root.querySelector('.error-layer') as HTMLElement;
            if (errorLayer) {
                errorLayer.classList.add('visible');
            }
            if (blurhashLayer) {
                blurhashLayer.classList.add('fade-out');
            }

            this.dispatchEvent(
                new CustomEvent('image-error', {
                    detail: { src },
                    bubbles: true,
                    composed: true,
                })
            );

            const debugMode = this.getAttribute('debug') !== null;
            if (debugMode) {
                console.log('[AxBlurest Debug] Image failed to load:', src);
            }
        };

        img.src = src;
    }

    static get observedAttributes() {
        return ['src', 'src-width', 'src-height', 'blurhash', 'render-width', 'alt', 'debug', 'debug-delay'];
    }

    attributeChangedCallback(property: string, oldValue: string | null, newValue: string | null) {
        if (oldValue !== newValue) {
            this.isImageLoaded = false;
            this.isImageError = false;
            this.loadStartTime = null;

            if (property === 'debug' || property === 'debug-delay') {
                this.render();
                return;
            }

            this.render();
            this.setupIntersectionObserver();
        }
    }
}
