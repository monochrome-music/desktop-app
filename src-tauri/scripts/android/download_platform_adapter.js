(function () {
    if (window.__monochromeAndroidDownloadAdapterInit) return;
    window.__monochromeAndroidDownloadAdapterInit = true;

    window.__monochromeDownloadRelativePath = 'Download';

    try {
        const key = 'force-individual-downloads';
        if (localStorage.getItem(key) !== 'true') {
            localStorage.setItem(key, 'true');
        }
        const originalGetItem = localStorage.getItem.bind(localStorage);
        const originalSetItem = localStorage.setItem.bind(localStorage);
        localStorage.getItem = function (k) {
            if (k === key) return 'true';
            return originalGetItem(k);
        };
        localStorage.setItem = function (k, v) {
            if (k === key) {
                return originalSetItem(k, 'true');
            }
            return originalSetItem(k, v);
        };
    } catch (_) {}

    try {
        delete window.showSaveFilePicker;
    } catch (_) {}

    if (!window.FileSystemFileHandle) {
        window.FileSystemFileHandle = function () {};
    }
    try {
        window.FileSystemFileHandle.prototype = {};
    } catch (_) {
        try {
            delete window.FileSystemFileHandle.prototype.createWritable;
        } catch (_) {}
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

    window.__monochromeDownloadPlatformAdapter = {
        platformName: 'android',
        saveBlob: async function (ctx) {
            const invoke = ctx.invoke;
            const filename = ctx.filename;
            const blob = ctx.blob;
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

            return {
                locationLabel: 'Downloads',
                savedName: filename,
            };
        },
    };
})();
