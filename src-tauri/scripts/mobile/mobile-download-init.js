(function () {
    if (window.__monochromeDownloadInjected) return;
    window.__monochromeDownloadInjected = true;

    const isAndroid = /Android/i.test(navigator.userAgent || '');

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

    const downloadQueue = [];
    let processingQueue = false;

    async function enqueueDownload(task) {
        downloadQueue.push(task);
        if (processingQueue) return;
        processingQueue = true;
        while (downloadQueue.length > 0) {
            const next = downloadQueue.shift();
            try {
                await next();
            } catch (err) {
                console.error('[Monochrome] Download task failed:', err);
                showToast('Save failed: ' + (err.message || err), true);
            }
        }
        processingQueue = false;
    }

    function getDocumentBaseDir() {
        const baseDir = window.__TAURI__?.path?.BaseDirectory;
        if (baseDir && typeof baseDir.Document !== 'undefined') {
            return baseDir.Document;
        }
        return 6;
    }

    function getDownloadBaseDir() {
        const override = window.__monochromeDownloadBaseDir;
        if (typeof override !== 'undefined' && override !== null) {
            return override;
        }
        return getDocumentBaseDir();
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

    async function writeBlobToAndroid(invoke, uri, blob) {
        const chunkSize = 1024 * 1024;
        let offset = 0;
        let firstChunk = true;

        while (offset < blob.size) {
            const slice = blob.slice(offset, offset + chunkSize);
            const arrayBuffer = await slice.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            await invoke('android_download_write', {
                args: {
                    uri: uri,
                    data: data,
                    append: !firstChunk,
                },
            });
            firstChunk = false;
            offset += chunkSize;

            if (offset < blob.size) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }
    }

    async function saveAndroidDownload(invoke, filename, blob) {
        const mimeType = blob.type || 'application/octet-stream';
        const relativePath = window.__monochromeDownloadRelativePath || 'Download';
        const uri = await invoke('android_download_begin', {
            args: {
                filename: filename,
                mimeType: mimeType,
                relativePath: relativePath,
            },
        });
        await writeBlobToAndroid(invoke, uri, blob);
        await invoke('android_download_finish', { args: { uri: uri } });
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
            if (!anchor || !anchor.hasAttribute('download')) return;
            if (!anchor.href) return;

            event.preventDefault();
            event.stopImmediatePropagation();

            let filename = anchor.download;
            if (!filename) {
                try {
                    const url = new URL(anchor.href, window.location.href);
                    filename = decodeURIComponent(url.pathname.split('/').pop() || 'download');
                } catch (_) {
                    filename = 'download';
                }
            }

            let blob = null;
            if (anchor.href.startsWith('blob:')) {
                blob = blobRegistry.get(anchor.href) || null;
            } else if (anchor.href.startsWith('http://') || anchor.href.startsWith('https://')) {
                try {
                    const response = await fetch(anchor.href, { credentials: 'include' });
                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status);
                    }
                    const disposition = response.headers.get('content-disposition') || '';
                    const match = disposition.match(/filename\*?=([^;]+)/i);
                    if (match && !anchor.download) {
                        filename = match[1].replace(/UTF-8''/i, '').replace(/"/g, '').trim();
                    }
                    blob = await response.blob();
                } catch (err) {
                    console.error('[Monochrome] Download fetch failed:', err);
                    showToast('Download failed: unable to fetch file', true);
                    return;
                }
            }

            if (!blob) {
                showToast('Download failed: file data not available', true);
                return;
            }

            const task = async () => {
                const sanitized = sanitizeFilename(filename).trim() || 'download';
                showToast('Saving ' + sanitized + '...');
                console.info('[Monochrome] download start', {
                    name: sanitized,
                    bytes: blob.size,
                });

                if (isAndroid && window.__monochromeAndroidDownloadsEnabled) {
                    await saveAndroidDownload(invoke, sanitized, blob);
                    showToast('Saved to Downloads: ' + sanitized);
                    console.info('[Monochrome] download saved', {
                        name: sanitized,
                        bytes: blob.size,
                    });
                    return;
                }

                if (!isAndroid) {
                    const baseDir = getDownloadBaseDir();
                    const resolvedName = await resolveAvailableName(invoke, baseDir, sanitized);

                    await writeBlobToFs(invoke, baseDir, resolvedName, blob);
                    showToast('Saved to Files: ' + resolvedName);
                    console.info('[Monochrome] download saved', {
                        name: resolvedName,
                        bytes: blob.size,
                    });
                }
            };

            if (isAndroid) {
                enqueueDownload(task);
            } else {
                try {
                    await task();
                } catch (err) {
                    console.error('[Monochrome] Download save failed:', err);
                    showToast('Save failed: ' + (err.message || err), true);
                }
            }
        },
        true,
    );
})();
