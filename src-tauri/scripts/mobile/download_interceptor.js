(function () {
    if (window.__monochromeDownloadInterceptorInit) return;
    window.__monochromeDownloadInterceptorInit = true;

    const blobRegistry = new Map();

    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (obj) {
        const url = originalCreateObjectURL(obj);
        if (obj instanceof Blob) {
            blobRegistry.set(url, obj);
        }
        return url;
    };

    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = function (url) {
        originalRevokeObjectURL(url);
        setTimeout(() => blobRegistry.delete(url), 30000);
    };

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

    function sanitizeFilename(name) {
        return String(name || 'download').replace(/[\/\\\0]/g, '_');
    }

    function splitFilename(name) {
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex <= 0) {
            return { stem: name, ext: '' };
        }
        return { stem: name.slice(0, dotIndex), ext: name.slice(dotIndex) };
    }

    async function resolveAvailableName(invoke, baseDir, filename) {
        const parts = splitFilename(filename);
        let candidate = filename;
        let suffix = 1;

        while (
            await invoke('plugin:fs|exists', {
                path: candidate,
                options: { baseDir: baseDir },
            })
        ) {
            candidate = parts.stem + ' (' + suffix + ')' + parts.ext;
            suffix += 1;
        }

        return candidate;
    }

    async function writeFile(invoke, baseDir, path, data, extraOptions) {
        const headers = {
            path: encodeURIComponent(path),
            options: JSON.stringify({ baseDir: baseDir, ...extraOptions }),
        };
        await invoke('plugin:fs|write_file', data, { headers: headers });
    }

    async function writeBlobToFs(invoke, baseDir, path, blob) {
        const chunkSize = 512 * 1024;
        let offset = 0;
        let firstChunk = true;

        while (offset < blob.size) {
            const slice = blob.slice(offset, offset + chunkSize);
            const arrayBuffer = await slice.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);

            await writeFile(invoke, baseDir, path, data, { append: !firstChunk });

            firstChunk = false;
            offset += chunkSize;

            if (offset < blob.size) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }
    }

    window.__monochromeDownloadShared = {
        resolveAvailableName: resolveAvailableName,
        writeBlobToFs: writeBlobToFs,
    };

    const queue = [];
    let queueBusy = false;

    async function enqueue(task) {
        queue.push(task);
        if (queueBusy) return;

        queueBusy = true;
        while (queue.length > 0) {
            const currentTask = queue.shift();
            try {
                await currentTask();
            } catch (err) {
                console.error('[Monochrome] Download task failed:', err);
                showToast('Save failed: ' + (err.message || err), true);
            }
        }
        queueBusy = false;
    }

    function getAdapter() {
        const adapter = window.__monochromeDownloadPlatformAdapter;
        if (!adapter || typeof adapter.saveBlob !== 'function') {
            return null;
        }
        return adapter;
    }

    function inferFilename(anchor) {
        if (anchor.download) return anchor.download;
        try {
            const url = new URL(anchor.href, window.location.href);
            return decodeURIComponent(url.pathname.split('/').pop() || 'download');
        } catch (_) {
            return 'download';
        }
    }

    async function resolveBlob(anchor, canOverrideName) {
        let filename = inferFilename(anchor);
        let blob = null;

        if (anchor.href.startsWith('blob:')) {
            blob = blobRegistry.get(anchor.href) || null;
            return { filename: filename, blob: blob };
        }

        if (!anchor.href.startsWith('http://') && !anchor.href.startsWith('https://')) {
            return { filename: filename, blob: null };
        }

        const response = await fetch(anchor.href, { credentials: 'include' });
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }

        if (canOverrideName) {
            const disposition = response.headers.get('content-disposition') || '';
            const match = disposition.match(/filename\*?=([^;]+)/i);
            if (match) {
                filename = match[1].replace(/UTF-8''/i, '').replace(/"/g, '').trim();
            }
        }

        blob = await response.blob();
        return { filename: filename, blob: blob };
    }

    document.addEventListener(
        'click',
        async (event) => {
            const invoke = getInvoke();
            if (!invoke) return;

            let anchor = event.target;
            if (anchor && anchor.closest) {
                anchor = anchor.closest('a[download]');
            }
            if (!anchor || !anchor.hasAttribute('download')) return;
            if (!anchor.href) return;

            event.preventDefault();
            event.stopImmediatePropagation();

            const adapter = getAdapter();
            if (!adapter) {
                showToast('Download failed: no platform adapter available', true);
                return;
            }

            let resolved;
            try {
                resolved = await resolveBlob(anchor, !anchor.download);
            } catch (err) {
                console.error('[Monochrome] Download fetch failed:', err);
                showToast('Download failed: unable to fetch file', true);
                return;
            }

            if (!resolved.blob) {
                showToast('Download failed: file data not available', true);
                return;
            }

            const blob = resolved.blob;
            const sanitized = sanitizeFilename(resolved.filename).trim() || 'download';

            await enqueue(async () => {
                showToast('Saving ' + sanitized + '...');
                console.info('[Monochrome] download start', {
                    name: sanitized,
                    bytes: blob.size,
                    platform: adapter.platformName || 'unknown',
                });

                const result = await adapter.saveBlob({
                    invoke: invoke,
                    filename: sanitized,
                    blob: blob,
                    shared: window.__monochromeDownloadShared,
                });

                const savedName = result && result.savedName ? result.savedName : sanitized;
                const locationLabel = result && result.locationLabel ? result.locationLabel : 'Files';

                showToast('Saved to ' + locationLabel + ': ' + savedName);
                console.info('[Monochrome] download saved', {
                    name: savedName,
                    bytes: blob.size,
                    platform: adapter.platformName || 'unknown',
                });
            });
        },
        true,
    );
})();
