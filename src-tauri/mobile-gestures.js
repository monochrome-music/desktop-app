(function() {
    if (window.__monochromeSwipeInit) {
        return;
    }
    window.__monochromeSwipeInit = true;

    function openSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (!sidebar || !overlay) return;
        if (sidebar.classList.contains('is-open')) return;
        sidebar.classList.add('is-open');
        overlay.classList.add('is-visible');
    }

    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeTracking = false;
    const edgeSize = 24;
    const swipeThreshold = 60;
    const maxVerticalDelta = 40;

    window.addEventListener(
        'touchstart',
        (event) => {
            if (!event.touches || event.touches.length !== 1) return;
            const touch = event.touches[0];
            if (touch.clientX > edgeSize) return;
            swipeTracking = true;
            swipeStartX = touch.clientX;
            swipeStartY = touch.clientY;
        },
        { passive: true },
    );

    window.addEventListener(
        'touchmove',
        (event) => {
            if (!swipeTracking || !event.touches || event.touches.length !== 1) return;
            const touch = event.touches[0];
            const deltaX = touch.clientX - swipeStartX;
            const deltaY = Math.abs(touch.clientY - swipeStartY);
            if (deltaX > swipeThreshold && deltaY < maxVerticalDelta) {
                swipeTracking = false;
                openSidebar();
            }
        },
        { passive: true },
    );

    window.addEventListener(
        'touchend',
        () => {
            swipeTracking = false;
        },
        { passive: true },
    );
})();
