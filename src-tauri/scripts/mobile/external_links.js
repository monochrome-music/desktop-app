(function() {
    if (window.__monochromeExternalLinksInjected) {
        return;
    }
    window.__monochromeExternalLinksInjected = true;

    function getInvoke() {
        if (window.__TAURI__?.core?.invoke) {
            return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
        }
        if (window.__TAURI__?.tauri?.invoke) {
            return window.__TAURI__.tauri.invoke.bind(window.__TAURI__.tauri);
        }
        return null;
    }

    function canUseTauriOpen() {
        return Boolean(getInvoke());
    }

    function openExternal(url) {
        const invoke = getInvoke();
        if (!invoke) return false;
        invoke('open_external', { url }).catch(() => {});
        return true;
    }

    function isExternalUrl(url) {
        if (!url) return false;
        const protocol = url.protocol;
        if (protocol === 'mailto:' || protocol === 'tel:') return true;
        if (protocol !== 'http:' && protocol !== 'https:') return false;
        return url.origin !== window.location.origin;
    }

    function shouldOpenExternal(link, url) {
        if (!url) return false;
        const protocol = url.protocol;
        if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:' && protocol !== 'tel:') {
            return false;
        }

        const target = (link.getAttribute('target') || '').toLowerCase();
        if (target === '_blank') return true;

        const rel = (link.getAttribute('rel') || '').toLowerCase();
        if (rel.includes('external')) return true;

        return isExternalUrl(url);
    }

    function resolveHref(href) {
        if (!href || href.startsWith('#')) return null;
        try {
            return new URL(href, window.location.href);
        } catch (_) {
            return null;
        }
    }

    function onClick(event) {
        if (event.defaultPrevented) return;
        if (typeof event.button === 'number' && event.button !== 0) return;
        if (!event.target || !event.target.closest) return;

        const link = event.target.closest('a[href]');
        if (!link) return;
        if (link.hasAttribute('data-tauri-internal')) return;
        if (link.hasAttribute('download')) return;

        const url = resolveHref(link.getAttribute('href'));
        if (!shouldOpenExternal(link, url)) return;
        if (!canUseTauriOpen()) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        openExternal(url.toString());
    }

    document.addEventListener('click', onClick, true);

    function createProxyWindow(initialUrl) {
        let href = initialUrl || '';
        const proxy = {
            closed: false,
            close: () => {
                proxy.closed = true;
            },
            focus: () => {},
            blur: () => {},
            postMessage: () => {}
        };

        const location = {};
        const setLocation = (value) => {
            href = String(value || '');
            const resolved = resolveHref(href);
            if (resolved && isExternalUrl(resolved)) {
                openExternal(resolved.toString());
            }
        };
        Object.defineProperty(location, 'href', {
            configurable: false,
            enumerable: true,
            get() {
                return href;
            },
            set(value) {
                setLocation(value);
            }
        });
        location.assign = (value) => setLocation(value);
        location.replace = (value) => setLocation(value);
        proxy.location = location;

        return proxy;
    }

    const originalOpen = window.open;
    window.open = function(url, target, features) {
        const urlStr = String(url || '');
        const isBlank = urlStr === '' || urlStr === 'about:blank';
        const wantsBlank = !target || target === '_blank' || target === 'blank';
        const parsed = resolveHref(urlStr);

        if (canUseTauriOpen()) {
            if (isBlank && wantsBlank) {
                return createProxyWindow('');
            }
            if (wantsBlank && parsed) {
                openExternal(parsed.toString());
                return createProxyWindow(parsed.toString());
            }
            if (parsed && isExternalUrl(parsed)) {
                openExternal(parsed.toString());
                return createProxyWindow(parsed.toString());
            }
        }

        return originalOpen ? originalOpen.apply(window, arguments) : null;
    };
})();
