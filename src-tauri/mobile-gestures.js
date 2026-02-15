(function() {
    if (window.__monochromeSwipeInit) {
        return;
    }
    window.__monochromeSwipeInit = true;

    function getHead() {
        return document.head || document.getElementsByTagName('head')[0] || null;
    }

    function disableZoomOnce() {
        var head = getHead();
        if (!head) return false;

        var viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) {
            viewport = document.createElement('meta');
            viewport.setAttribute('name', 'viewport');
            head.appendChild(viewport);
            viewport.setAttribute(
                'content',
                'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
            );
            return true;
        }

        var content = viewport.getAttribute('content') || '';
        var parts = content
            .split(',')
            .map(function(part) {
                return part.trim();
            })
            .filter(Boolean);
        var map = {};

        parts.forEach(function(part) {
            var eq = part.indexOf('=');
            if (eq === -1) {
                map[part] = true;
            } else {
                var key = part.slice(0, eq).trim();
                var value = part.slice(eq + 1).trim();
                map[key] = value;
            }
        });

        map['user-scalable'] = 'no';
        map['maximum-scale'] = '1';
        if (!map.width) map.width = 'device-width';
        if (!map['initial-scale']) map['initial-scale'] = '1';

        var updated = Object.keys(map)
            .map(function(key) {
                var value = map[key];
                if (value === true || value === '') return key;
                return key + '=' + value;
            })
            .join(', ');

        viewport.setAttribute('content', updated);
        return true;
    }

    function disableZoom() {
        if (disableZoomOnce()) return;
        document.addEventListener('DOMContentLoaded', disableZoomOnce, { once: true });
        window.addEventListener('load', disableZoomOnce, { once: true });
    }

    function blockZoomGestures() {
        function prevent(event) {
            event.preventDefault();
        }

        document.addEventListener('gesturestart', prevent, { passive: false });
        document.addEventListener('gesturechange', prevent, { passive: false });
        document.addEventListener('gestureend', prevent, { passive: false });
    }

    disableZoom();
    blockZoomGestures();

    function getSidebarElements() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (!sidebar || !overlay) return null;
        return { sidebar, overlay };
    }

    function setDrawerPosition(sidebar, overlay, offset, width) {
        const clampedOffset = Math.min(0, Math.max(-width, offset));
        const progress = width > 0 ? 1 - Math.abs(clampedOffset) / width : 0;
        sidebar.style.transform = `translateX(${clampedOffset}px)`;
        overlay.style.opacity = String(progress);
    }

    function animateDrawer(sidebar, overlay, targetOffset, width, shouldOpen) {
        sidebar.style.transition = 'transform 0.2s ease';
        overlay.style.transition = 'opacity 0.2s ease';
        setDrawerPosition(sidebar, overlay, targetOffset, width);

        window.setTimeout(() => {
            sidebar.style.transition = '';
            overlay.style.transition = '';
            sidebar.style.transform = '';
            overlay.style.opacity = '';
            if (shouldOpen) {
                sidebar.classList.add('is-open');
                overlay.classList.add('is-visible');
            } else {
                sidebar.classList.remove('is-open');
                overlay.classList.remove('is-visible');
            }
        }, 220);
    }

    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeTracking = false;
    let dragging = false;
    let sidebarWidth = 0;
    let startOffset = 0;
    let lastOffset = 0;
    let draggingFromSidebar = false;
    const edgeSize = 24;
    const dragStartThreshold = 10;
    const maxVerticalDelta = 40;

    window.addEventListener(
        'touchstart',
        (event) => {
            if (!event.touches || event.touches.length !== 1) return;
            const elements = getSidebarElements();
            if (!elements) return;
            const { sidebar, overlay } = elements;
            const touch = event.touches[0];
            const isOpen = sidebar.classList.contains('is-open');

            if (!isOpen && touch.clientX > edgeSize) return;
            if (isOpen && !sidebar.contains(event.target)) return;

            sidebarWidth = Math.max(1, sidebar.getBoundingClientRect().width);
            swipeTracking = true;
            dragging = false;
            swipeStartX = touch.clientX;
            swipeStartY = touch.clientY;
            startOffset = isOpen ? 0 : -sidebarWidth;
            lastOffset = startOffset;
            draggingFromSidebar = isOpen;

            overlay.classList.add('is-visible');
            overlay.style.opacity = isOpen ? '1' : '0';
            sidebar.style.transition = 'none';
            overlay.style.transition = 'none';
        },
        { passive: true },
    );

    window.addEventListener(
        'touchmove',
        (event) => {
            if (!swipeTracking || !event.touches || event.touches.length !== 1) return;
            const elements = getSidebarElements();
            if (!elements) return;
            const { sidebar, overlay } = elements;
            const touch = event.touches[0];
            const deltaX = touch.clientX - swipeStartX;
            const deltaY = touch.clientY - swipeStartY;

            if (!dragging) {
                if (Math.abs(deltaY) > maxVerticalDelta && Math.abs(deltaY) > Math.abs(deltaX)) {
                    swipeTracking = false;
                    return;
                }
                if (Math.abs(deltaX) < dragStartThreshold) return;
                dragging = true;
            }

            if (dragging) {
                event.preventDefault();
                const nextOffset = startOffset + deltaX;
                const clamped = Math.min(0, Math.max(-sidebarWidth, nextOffset));
                if (!draggingFromSidebar && clamped < -sidebarWidth) return;
                lastOffset = clamped;
                setDrawerPosition(sidebar, overlay, clamped, sidebarWidth);
            }
        },
        { passive: false },
    );

    function endDrag() {
        if (!swipeTracking) return;
        const elements = getSidebarElements();
        if (!elements) {
            swipeTracking = false;
            dragging = false;
            return;
        }
        const { sidebar, overlay } = elements;

        if (!dragging) {
            swipeTracking = false;
            return;
        }

        const shouldOpen = lastOffset > -sidebarWidth * 0.5;
        const targetOffset = shouldOpen ? 0 : -sidebarWidth;
        animateDrawer(sidebar, overlay, targetOffset, sidebarWidth, shouldOpen);

        swipeTracking = false;
        dragging = false;
    }

    window.addEventListener('touchend', endDrag, { passive: true });
    window.addEventListener('touchcancel', endDrag, { passive: true });
})();
