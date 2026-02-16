(function () {
    if (window.__monochromeAndroidSwipeGestureConfigInit) return;
    window.__monochromeAndroidSwipeGestureConfigInit = true;

    window.__monochromeSwipeGestureConfig = {
        edgeSize: 32,
        dragStartThreshold: 8,
        maxVerticalDelta: 60,
        useCapture: true,
        openRegionRatio: 0.6,
    };
})();
