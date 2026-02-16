(function() {
    if (window.__monochromeSafeAreaInsetsAndroidInit) {
        return;
    }
    window.__monochromeSafeAreaInsetsAndroidInit = true;

    const STYLE_ID = 'monochrome-safe-area-style';
    const REFRESH_DELAYS = [0];
    const TAURI_CHECK_INTERVAL = 50;
    const TAURI_CHECK_MAX_ATTEMPTS = 200;
    const TAURI_PLUGIN_COMMAND = 'plugin:safe-area-insets|get_insets';
    let refreshToken = 0;
    let refreshTimers = [];
    let lastInsets = null;
    let tauriReadyPromise = null;
    let isUnloading = false;

    function ensureViewportFit() {
        const head = document.head || document.getElementsByTagName('head')[0] || null;
        if (!head) return false;

        let viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) {
            viewport = document.createElement('meta');
            viewport.setAttribute('name', 'viewport');
            head.appendChild(viewport);
        }

        const content = viewport.getAttribute('content') || '';
        const parts = content
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
        const map = {};

        parts.forEach((part) => {
            const eq = part.indexOf('=');
            if (eq === -1) {
                map[part] = true;
            } else {
                const key = part.slice(0, eq).trim();
                const value = part.slice(eq + 1).trim();
                map[key] = value;
            }
        });

        map['viewport-fit'] = 'cover';

        const updated = Object.keys(map)
            .map((key) => {
                const value = map[key];
                if (value === true || value === '') return key;
                return `${key}=${value}`;
            })
            .join(', ');

        viewport.setAttribute('content', updated);
        return true;
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            body {
                padding-top: var(--safe-area-inset-top, 0px);
                padding-right: var(--safe-area-inset-right, 0px);
                padding-bottom: var(--safe-area-inset-bottom, 0px);
                padding-left: var(--safe-area-inset-left, 0px);
                box-sizing: border-box;
                margin: 0;
            }
            #side-panel {
                padding-top: var(--safe-area-inset-top, 0px) !important;
                padding-right: var(--safe-area-inset-right, 0px) !important;
                padding-bottom: var(--safe-area-inset-bottom, 0px) !important;
                box-sizing: border-box;
            }
            .sidebar {
                padding-top: calc(1.25rem + var(--safe-area-inset-top, 0px)) !important;
                padding-left: calc(1.25rem + var(--safe-area-inset-left, 0px)) !important;
                padding-bottom: calc(1.25rem + var(--safe-area-inset-bottom, 0px)) !important;
                box-sizing: border-box;
            }
            #close-fullscreen-cover-btn {
                top: calc(1rem + var(--safe-area-inset-top, 0px)) !important;
                right: calc(1rem + var(--safe-area-inset-right, 0px)) !important;
            }
            .fullscreen-lyrics-toggle {
                top: calc(1rem + var(--safe-area-inset-top, 0px)) !important;
                right: calc(4.5rem + var(--safe-area-inset-right, 0px)) !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function applyInsets(insets) {
        const root = document.documentElement;
        if (!root) return;
        root.style.setProperty('--safe-area-inset-top', `${insets.top}px`);
        root.style.setProperty('--safe-area-inset-right', `${insets.right}px`);
        root.style.setProperty('--safe-area-inset-bottom', `${insets.bottom}px`);
        root.style.setProperty('--safe-area-inset-left', `${insets.left}px`);
    }

    function readEnvInsets() {
        const el = document.createElement('div');
        el.style.position = 'absolute';
        el.style.visibility = 'hidden';
        el.style.paddingTop = 'env(safe-area-inset-top, 0px)';
        el.style.paddingRight = 'env(safe-area-inset-right, 0px)';
        el.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
        el.style.paddingLeft = 'env(safe-area-inset-left, 0px)';
        (document.body || document.documentElement).appendChild(el);
        const styles = window.getComputedStyle(el);
        const top = parseFloat(styles.paddingTop) || 0;
        const right = parseFloat(styles.paddingRight) || 0;
        const bottom = parseFloat(styles.paddingBottom) || 0;
        const left = parseFloat(styles.paddingLeft) || 0;
        el.remove();
        return { top, right, bottom, left };
    }

    function normalizeInset(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.max(0, num);
    }

    function normalizeInsets(raw) {
        return {
            top: normalizeInset(raw.top),
            right: normalizeInset(raw.right),
            bottom: normalizeInset(raw.bottom),
            left: normalizeInset(raw.left),
        };
    }

    function getTauriCore() {
        const tauri = window.__TAURI__;
        if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') {
            return null;
        }
        return tauri.core;
    }

    function waitForTauri() {
        if (tauriReadyPromise) return tauriReadyPromise;
        if (getTauriCore()) {
            tauriReadyPromise = Promise.resolve(true);
            return tauriReadyPromise;
        }
        tauriReadyPromise = new Promise((resolve) => {
            let attempts = 0;
            const check = () => {
                if (getTauriCore()) {
                    resolve(true);
                    return;
                }
                attempts += 1;
                if (attempts > TAURI_CHECK_MAX_ATTEMPTS) {
                    resolve(false);
                    return;
                }
                window.setTimeout(check, TAURI_CHECK_INTERVAL);
            };
            check();
        });
        return tauriReadyPromise;
    }

    async function getNativeInsets() {
        if (isUnloading) return null;
        const ready = await waitForTauri();
        if (isUnloading) return null;
        if (!ready) return null;
        const core = getTauriCore();
        if (!core) return null;
        try {
            const result = await core.invoke(TAURI_PLUGIN_COMMAND);
            if (isUnloading) return null;
            if (!result) return null;
            return normalizeInsets(result);
        } catch (_error) {
            return null;
        }
    }

    async function readInsets() {
        const nativeInsets = await getNativeInsets();
        if (nativeInsets) return nativeInsets;
        return normalizeInsets(readEnvInsets());
    }

    async function refreshInsets(token) {
        const envInset = await readInsets();
        if (token !== refreshToken) return;
        ensureStyle();
        if (
            lastInsets &&
            lastInsets.top === envInset.top &&
            lastInsets.right === envInset.right &&
            lastInsets.bottom === envInset.bottom &&
            lastInsets.left === envInset.left
        ) {
            return;
        }
        lastInsets = envInset;
        applyInsets(envInset);
    }

    function clearRefreshTimers() {
        if (!refreshTimers.length) return;
        refreshTimers.forEach((timer) => window.clearTimeout(timer));
        refreshTimers = [];
    }

    function scheduleRefresh() {
        if (isUnloading) return;
        if (document.visibilityState === 'hidden') return;
        refreshToken += 1;
        const token = refreshToken;
        clearRefreshTimers();
        REFRESH_DELAYS.forEach((delay) => {
            refreshTimers.push(window.setTimeout(() => refreshInsets(token), delay));
        });
    }

    function init() {
        if (!ensureViewportFit() && document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ensureViewportFit, { once: true });
        }
        scheduleRefresh();
        waitForTauri().then((ready) => {
            if (ready) {
                scheduleRefresh();
            }
        });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', scheduleRefresh, { once: true });
        }
        window.addEventListener('load', scheduleRefresh, { once: true });
        window.addEventListener('pageshow', scheduleRefresh);
        window.addEventListener('resize', scheduleRefresh);
        window.addEventListener('orientationchange', scheduleRefresh);
        document.addEventListener('visibilitychange', scheduleRefresh);
        window.addEventListener('beforeunload', () => {
            isUnloading = true;
            clearRefreshTimers();
        });
        window.addEventListener('unload', () => {
            isUnloading = true;
            clearRefreshTimers();
        });
    }

    init();
})();
