(function () {
    if (window.__monochromeIosDownloadAdapterInit) return;
    window.__monochromeIosDownloadAdapterInit = true;

    function getDocumentBaseDir() {
        const baseDir = window.__TAURI__?.path?.BaseDirectory;
        if (baseDir && typeof baseDir.Document !== 'undefined') {
            return baseDir.Document;
        }
        return 6;
    }

    window.__monochromeDownloadPlatformAdapter = {
        platformName: 'ios',
        saveBlob: async function (ctx) {
            const invoke = ctx.invoke;
            const filename = ctx.filename;
            const blob = ctx.blob;
            const shared = ctx.shared || window.__monochromeDownloadShared;
            const baseDir = getDocumentBaseDir();

            if (!shared || typeof shared.resolveAvailableName !== 'function' || typeof shared.writeBlobToFs !== 'function') {
                throw new Error('iOS download helpers are unavailable');
            }

            const resolvedName = await shared.resolveAvailableName(invoke, baseDir, filename);
            await shared.writeBlobToFs(invoke, baseDir, resolvedName, blob);

            return {
                locationLabel: 'Files',
                savedName: resolvedName,
            };
        },
    };
})();
