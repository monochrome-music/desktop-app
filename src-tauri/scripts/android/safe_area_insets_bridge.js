/**
 * Monochrome Safe Area Insets Bridge for Android
 * 
 * Handles dynamic safe area insets (notches, navigation bars, etc.)
 * by bridging native Tauri calls to CSS custom properties.
 */
(function() {
    'use strict';

    if (window.__monochromeSafeAreaInsetsInit) return;
    window.__monochromeSafeAreaInsetsInit = true;

    class SafeAreaManager {
        static STYLE_ID = 'monochrome-safe-area-styles';
        static REFRESH_INTERVALS = [0, 100, 300, 600, 1000, 2000];
        static NATIVE_PLUGIN = 'plugin:safe-area-insets|get_insets';

        constructor() {
            this.lastInsets = { top: 0, right: 0, bottom: 0, left: 0 };
            this.refreshToken = 0;
            this.refreshTimers = [];
            this.isUnloading = false;
            this.styleElement = null;

            this.init();
        }

        init() {
            this.ensureViewportFit();
            this.createStyles();
            this.setupEventListeners();
            this.triggerRefreshCycle();
            
            // Periodic background check to catch system changes without resize events
            setInterval(() => {
                if (document.visibilityState === 'visible') {
                    this.refresh();
                }
            }, 3000);
        }

        ensureViewportFit() {
            let viewport = document.querySelector('meta[name="viewport"]');
            if (!viewport) {
                viewport = document.createElement('meta');
                viewport.name = 'viewport';
                document.head.appendChild(viewport);
            }

            const content = viewport.getAttribute('content') || '';
            if (!content.includes('viewport-fit=cover')) {
                const parts = content.split(',').map(s => s.trim()).filter(Boolean);
                parts.push('viewport-fit=cover');
                viewport.setAttribute('content', parts.join(', '));
            }
        }

        createStyles() {
            if (document.getElementById(SafeAreaManager.STYLE_ID)) return;

            this.styleElement = document.createElement('style');
            this.styleElement.id = SafeAreaManager.STYLE_ID;
            this.styleElement.textContent = `
                :root {
                    --safe-area-inset-top: 0px;
                    --safe-area-inset-right: 0px;
                    --safe-area-inset-bottom: 0px;
                    --safe-area-inset-left: 0px;
                }
                body {
                    padding: var(--safe-area-inset-top) var(--safe-area-inset-right) var(--safe-area-inset-bottom) var(--safe-area-inset-left) !important;
                    box-sizing: border-box !important;
                }
                #side-panel {
                    padding-top: var(--safe-area-inset-top) !important;
                    padding-right: var(--safe-area-inset-right) !important;
                    padding-bottom: var(--safe-area-inset-bottom) !important;
                    box-sizing: border-box !important;
                }
                .sidebar {
                    padding-top: calc(1.25rem + var(--safe-area-inset-top)) !important;
                    padding-left: calc(1.25rem + var(--safe-area-inset-left)) !important;
                    padding-bottom: calc(1.25rem + var(--safe-area-inset-bottom)) !important;
                    box-sizing: border-box !important;
                }
                #close-fullscreen-cover-btn {
                    top: calc(1rem + var(--safe-area-inset-top)) !important;
                    right: calc(1rem + var(--safe-area-inset-right)) !important;
                }
                .fullscreen-lyrics-toggle {
                    top: calc(1rem + var(--safe-area-inset-top)) !important;
                    right: calc(4.5rem + var(--safe-area-inset-right)) !important;
                }
                footer.now-playing-bar {
                    bottom: var(--safe-area-inset-bottom) !important;
                }
            `;
            (document.head || document.documentElement).appendChild(this.styleElement);
        }

        setupEventListeners() {
            const refresh = () => this.triggerRefreshCycle();
            
            window.addEventListener('resize', refresh);
            window.addEventListener('orientationchange', refresh);
            window.addEventListener('pageshow', refresh);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') refresh();
            });

            window.addEventListener('beforeunload', () => {
                this.isUnloading = true;
                this.clearTimers();
            });
        }

        triggerRefreshCycle() {
            if (this.isUnloading) return;
            
            this.refreshToken++;
            const currentToken = this.refreshToken;
            this.clearTimers();

            SafeAreaManager.REFRESH_INTERVALS.forEach(delay => {
                this.refreshTimers.push(
                    setTimeout(() => this.refresh(currentToken), delay)
                );
            });
        }

        clearTimers() {
            this.refreshTimers.forEach(clearTimeout);
            this.refreshTimers = [];
        }

        async refresh(token) {
            if (token && token !== this.refreshToken) return;
            if (this.isUnloading) return;

            try {
                const insets = await this.getInsets();
                if (insets) {
                    this.apply(insets);
                }
            } catch (error) {
                // Silently fail to avoid console noise in production
            }
        }

        async getInsets() {
            // Priority 1: Native Tauri Plugin
            const native = await this.fetchNativeInsets();
            if (native) return native;

            // Priority 2: CSS env() Fallback
            return this.readCssEnv();
        }

        async fetchNativeInsets() {
            const tauri = window.__TAURI__;
            if (!tauri?.core?.invoke) return null;

            try {
                const raw = await tauri.core.invoke(SafeAreaManager.NATIVE_PLUGIN);
                return raw ? {
                    top: this.normalize(raw.top),
                    right: this.normalize(raw.right),
                    bottom: this.normalize(raw.bottom),
                    left: this.normalize(raw.left)
                } : null;
            } catch (e) {
                return null;
            }
        }

        readCssEnv() {
            const div = document.createElement('div');
            div.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;' +
                               'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
            (document.body || document.documentElement).appendChild(div);
            const s = window.getComputedStyle(div);
            const insets = {
                top: this.normalize(s.paddingTop),
                right: this.normalize(s.paddingRight),
                bottom: this.normalize(s.paddingBottom),
                left: this.normalize(s.paddingLeft)
            };
            div.remove();
            return insets;
        }

        normalize(val) {
            const n = parseFloat(val);
            return (Number.isFinite(n) && n > 0) ? n : 0;
        }

        apply(insets) {
            // Skip if identical to last state
            if (this.lastInsets.top === insets.top && 
                this.lastInsets.bottom === insets.bottom && 
                this.lastInsets.left === insets.left && 
                this.lastInsets.right === insets.right) {
                return;
            }

            const root = document.documentElement;
            if (!root) return;

            root.style.setProperty('--safe-area-inset-top', `${insets.top}px`);
            root.style.setProperty('--safe-area-inset-right', `${insets.right}px`);
            root.style.setProperty('--safe-area-inset-bottom', `${insets.bottom}px`);
            root.style.setProperty('--safe-area-inset-left', `${insets.left}px`);

            this.lastInsets = { ...insets };
        }
    }

    // Initialize when DOM is stable
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new SafeAreaManager(), { once: true });
    } else {
        new SafeAreaManager();
    }

})();
