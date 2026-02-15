(function () {
    if (window.__monochromeDownloadInjected) return;
    window.__monochromeDownloadInjected = true;

    // ── Blob registry ──
    // We need to capture blob references before they are revoked,
    // because the frontend does: createObjectURL → a.click() → revokeObjectURL
    // all synchronously, and our async handler runs after revocation.
    const blobRegistry = new Map();

    const _createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (obj) {
        const url = _createObjectURL(obj);
        if (obj instanceof Blob) {
            blobRegistry.set(url, obj);
        }
        return url;
    };

    const _revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = function (url) {
        _revokeObjectURL(url);
        // Keep the blob reference a bit longer so our async handler can use it
        setTimeout(() => blobRegistry.delete(url), 30000);
    };

    // ── Helpers ──

    function getInvoke() {
        if (window.__TAURI__?.core?.invoke) {
            return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
        }
        if (window.__TAURI__?.tauri?.invoke) {
            return window.__TAURI__.tauri.invoke.bind(window.__TAURI__.tauri);
        }
        return null;
    }

    function showToast(message, isError) {
        const existing = document.getElementById('__dl-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = '__dl-toast';
        toast.textContent = message;
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '120px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: isError ? '#ef4444' : '#22c55e',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: '10px',
            zIndex: '999999',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '13px',
            fontWeight: '600',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            opacity: '0',
            transition: 'opacity 0.25s ease',
            pointerEvents: 'none',
            maxWidth: '80vw',
            textAlign: 'center',
        });

        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function getDocumentBaseDir() {
        const baseDir = window.__TAURI__?.path?.BaseDirectory;
        if (baseDir && typeof baseDir.Document !== 'undefined') {
            return baseDir.Document;
        }
        return 6;
    }

    function sanitizeFilename(name) {
        return name.replace(/[\/\\\0]/g, '_');
    }

    function splitFilename(name) {
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex <= 0) {
            return { stem: name, ext: '' };
        }
        return { stem: name.slice(0, dotIndex), ext: name.slice(dotIndex) };
    }

    async function resolveAvailableName(invoke, baseDir, filename) {
        const { stem, ext } = splitFilename(filename);
        let candidate = filename;
        let n = 1;

        while (
            await invoke('plugin:fs|exists', {
                path: candidate,
                options: { baseDir: baseDir },
            })
        ) {
            candidate = stem + ' (' + n + ')' + ext;
            n += 1;
        }

        return candidate;
    }

    async function writeFile(invoke, baseDir, path, data) {
        const headers = {
            path: encodeURIComponent(path),
            options: JSON.stringify({ baseDir: baseDir }),
        };

        await invoke('plugin:fs|write_file', data, { headers: headers });
    }

    // ── Download interception ──
    // Captures clicks on <a download="filename" href="blob:..."> elements
    // which are programmatically created by the frontend's triggerDownload().

    document.addEventListener(
        'click',
        async (event) => {
            const invoke = getInvoke();
            if (!invoke) return;

            let anchor = event.target;
            if (anchor && anchor.closest) {
                anchor = anchor.closest('a[download]');
            }
            if (!anchor || !anchor.download) return;
            if (!anchor.href || !anchor.href.startsWith('blob:')) return;

            event.preventDefault();
            event.stopImmediatePropagation();

            const filename = anchor.download;
            const blob = blobRegistry.get(anchor.href);

            if (!blob) {
                showToast('Download failed: file data not available', true);
                return;
            }

            try {
                const baseDir = getDocumentBaseDir();
                const sanitized = sanitizeFilename(filename).trim() || 'download';
                showToast('Saving ' + sanitized + '...');
                console.info('[Monochrome] download start', {
                    name: sanitized,
                    bytes: blob.size,
                });

                const resolvedName = await resolveAvailableName(
                    invoke,
                    baseDir,
                    sanitized,
                );

                const arrayBuffer = await blob.arrayBuffer();
                const data = new Uint8Array(arrayBuffer);
                await writeFile(invoke, baseDir, resolvedName, data);
                showToast('Saved to Files: ' + resolvedName);
                console.info('[Monochrome] download saved', {
                    name: resolvedName,
                    bytes: data.length,
                });
            } catch (err) {
                console.error('[Monochrome] Download save failed:', err);
                showToast('Save failed: ' + (err.message || err), true);
            }
        },
        true,
    );
})();
