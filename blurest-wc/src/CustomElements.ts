import BlurhashCssConverter, { BlurhashUtils } from './blurhash';

export class AxBlurest extends HTMLElement {
    static readonly ElementName = 'ax-blurest';
    private root = this.attachShadow({ mode: 'open' });

    isImageLoaded;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.isImageLoaded = false;
    }

    connectedCallback() {
        this.render();
        this.loadImage();
    }

    render() {
        const srcWidth = this.getAttribute('src-width');
        const srcHeight = this.getAttribute('src-height');
        const blurhash = this.getAttribute('blurhash');

        if (!srcWidth || !srcHeight || !blurhash) {
            this.root.innerHTML = `
                        <style>
                            :host {
                                display: inline-block;
                                width: 0;
                                height: 0;
                                overflow: hidden;
                            }
                            :host([block]) { display: block; }
                            :host([inline-block]) { display: inline-block; }
                            :host([flex]) { display: flex; }
                            :host([inline-flex]) { display: inline-flex; }
                            :host([grid]) { display: grid; }
                            :host([inline-grid]) { display: inline-grid; }
                        </style>
                    `;
            return;
        }

        const renderWidth = this.getAttribute('render-width');
        const src = this.getAttribute('src');
        const alt = this.getAttribute('alt') || '';

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
                        }

                        :host([block]) { display: block; }
                        :host([inline-block]) { display: inline-block; }
                        :host([flex]) { display: flex; }
                        :host([inline-flex]) { display: inline-flex; }
                        :host([grid]) { display: grid; }
                        :host([inline-grid]) { display: inline-grid; }
                        
                        .container {
                            position: relative;
                            width: 100%;
                            height: 100%;
                            overflow: hidden;
                        }
                        
                        .blurhash-layer,
                        .image-layer {
                            position: absolute;
                            top: 0;
                            left: 0;
                            width: 100%;
                            height: 100%;
                            object-fit: cover;
                            transition: opacity 0.3s ease-in-out;
                        }
                        
                        .blurhash-layer {
                            position: absolute;
                            top: 0;
                            left: 0;
                            width: 100%;
                            height: 100%;
                            transition: opacity 0.5s ease-in-out;
                            opacity: 1;
                            ${blurhashCSS}
                        }
                        
                        .image-layer {
                            opacity: 0;
                        }
                        
                        .image-layer.loaded {
                            opacity: 1;
                        }
                        
                        .blurhash-layer.fade-out {
                            opacity: 0;
                        }
                    </style>
                    
                    <div class="container">
                        <div class="blurhash-layer"></div>
                        ${src ? `<img class="image-layer" src="${src}" alt="${alt}">` : ''}
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
        const src = this.getAttribute('src');
        if (!src) return;

        const imageLayer = this.root.querySelector('.image-layer') as HTMLImageElement;
        const blurhashLayer = this.root.querySelector('.blurhash-layer') as HTMLElement;

        if (imageLayer) {
            const img = new Image();

            img.onload = () => {
                imageLayer.classList.add('loaded');

                setTimeout(() => {
                    if (blurhashLayer) {
                        blurhashLayer.classList.add('fade-out');
                    }
                }, 100);

                this.isImageLoaded = true;

                this.dispatchEvent(
                    new CustomEvent('image-loaded', {
                        detail: { src },
                    })
                );
            };

            img.onerror = () => {
                console.warn('Image failed to load:', src);

                this.dispatchEvent(
                    new CustomEvent('image-error', {
                        detail: { src },
                    })
                );
            };

            img.src = src;
        }
    }

    static get observedAttributes() {
        return ['src', 'src-width', 'src-height', 'blurhash', 'render-width', 'alt'];
    }

    attributeChangedCallback(property: string, oldValue: string | null, newValue: string | null) {
        if (oldValue !== newValue) {
            this.isImageLoaded = false;

            this.render();
            this.loadImage();
        }
    }
}
