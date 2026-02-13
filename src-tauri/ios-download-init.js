(function () {
    if (window.__monochromeIosDownloadInit) return;
    window.__monochromeIosDownloadInit = true;

    const baseDir = window.__TAURI__?.path?.BaseDirectory;
    if (baseDir && typeof baseDir.Document !== 'undefined') {
        window.__monochromeDownloadBaseDir = baseDir.Document;
    }
})();
