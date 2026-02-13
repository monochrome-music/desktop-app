(function() {
    if (window.__monochromeAndroidDownloadInit) return;
    window.__monochromeAndroidDownloadInit = true;

    window.__monochromeAndroidDownloadsEnabled = true;
    window.__monochromeDownloadRelativePath = 'Download';

    try {
        const key = 'force-individual-downloads';
        if (localStorage.getItem(key) !== 'true') {
            localStorage.setItem(key, 'true');
        }
        const originalGetItem = localStorage.getItem.bind(localStorage);
        const originalSetItem = localStorage.setItem.bind(localStorage);
        localStorage.getItem = function(k) {
            if (k === key) return 'true';
            return originalGetItem(k);
        };
        localStorage.setItem = function(k, v) {
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
        window.FileSystemFileHandle = function() {};
    }
    try {
        window.FileSystemFileHandle.prototype = {};
    } catch (_) {
        try {
            delete window.FileSystemFileHandle.prototype.createWritable;
        } catch (_) {}
    }
})();
