'use strict';

class Komplexiti {
    constructor() {
        // iOS PWA viewport fix must run first, before anything else
        this.fixIOSViewportBug();

        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');

        this.states = { TITLE: 'title', APP: 'app' };
        this.currentState = this.states.TITLE;
        this.panelOpen = false;

        this.initElements();
        this.setupPWALandscapeDetection();
        this.initEventListeners();
        this.resizeCanvas();
        this.showLoadedState();
        this.registerServiceWorker();
    }

    // -------------------------------------------------------------------------
    // iOS PWA bottom-bar fix
    // Uses window.innerHeight (not visualViewport) to avoid transient heights
    // from share sheets, screenshots, and tab switching on iOS.
    // -------------------------------------------------------------------------
    fixIOSViewportBug() {
        let lastKnownHeight = 0;

        const setActualViewportHeight = () => {
            let viewportHeight = window.innerHeight;

            const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                          window.matchMedia('(display-mode: fullscreen)').matches ||
                          window.navigator.standalone === true;
            const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            const isPortrait = window.innerHeight > window.innerWidth;

            if (isIOS && isPWA && isPortrait) {
                const screenPortraitHeight = Math.max(window.screen.height, window.screen.width);
                const difference = screenPortraitHeight - viewportHeight;

                if (difference > 15) {
                    const computedStyle = getComputedStyle(document.documentElement);
                    const safeTop = computedStyle.getPropertyValue('--safe-area-top');
                    const safeTopPx = parseInt(safeTop) || 0;
                    const heightWithSafeTop = viewportHeight + safeTopPx;
                    const remainingShortfall = screenPortraitHeight - heightWithSafeTop;

                    if (remainingShortfall > 8 && difference <= 180) {
                        viewportHeight = screenPortraitHeight;
                    } else if (safeTopPx > 0) {
                        viewportHeight = heightWithSafeTop;
                    } else if (difference <= 180) {
                        viewportHeight = screenPortraitHeight;
                    }
                }
            }

            document.documentElement.style.setProperty('--actual-vh', `${viewportHeight}px`);

            if (lastKnownHeight > 0 && Math.abs(viewportHeight - lastKnownHeight) > 30) {
                setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
            }
            lastKnownHeight = viewportHeight;
        };

        const scheduleViewportHeightUpdates = (delays) => {
            delays.forEach((delay) => setTimeout(setActualViewportHeight, delay));
        };

        const scheduleIOSPWALayoutRefreshes = (delays) => {
            const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                          window.matchMedia('(display-mode: fullscreen)').matches ||
                          window.navigator.standalone === true;
            const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            if (!isIOS || !isPWA) return;
            delays.forEach((delay) => setTimeout(() => window.dispatchEvent(new Event('resize')), delay));
        };

        setActualViewportHeight();
        scheduleViewportHeightUpdates([50, 100, 200, 350, 600, 900, 1300, 1800, 2400]);
        scheduleIOSPWALayoutRefreshes([350, 900, 1800, 2400]);

        window.addEventListener('resize', setActualViewportHeight);
        window.addEventListener('orientationchange', () => {
            scheduleViewportHeightUpdates([50, 100, 200, 350, 600, 900, 1300, 1800]);
        });
        if (screen.orientation) {
            screen.orientation.addEventListener('change', () => {
                scheduleViewportHeightUpdates([50, 100, 200, 350, 600, 900, 1300, 1800]);
            });
        }
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                scheduleViewportHeightUpdates([50, 200, 500, 900]);
            }
        });
    }

    // -------------------------------------------------------------------------
    // DOM element references
    // -------------------------------------------------------------------------
    initElements() {
        this.hamburgerBtn  = document.getElementById('hamburger-menu');
        this.sidebarPanel  = document.getElementById('sidebar-panel');
        this.mobileOverlay = document.getElementById('mobile-overlay');
        this.titleScreen   = document.getElementById('title-screen');
        this.launchBtn     = document.getElementById('title-launch-button');
        this.returnBtn     = document.getElementById('return-to-title');
        this.appContainer  = document.getElementById('app-container');
    }

    // -------------------------------------------------------------------------
    // PWA landscape detection
    // Adds html.pwa-landscape when installed as a PWA in landscape on a
    // narrow screen, and html.title-compact-landscape on any compact landscape.
    // CSS rules target these classes for layout adjustments.
    // -------------------------------------------------------------------------
    setupPWALandscapeDetection() {
        const update = () => {
            const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                          window.matchMedia('(display-mode: fullscreen)').matches ||
                          window.navigator.standalone === true;
            const isLandscape = window.innerWidth > window.innerHeight;
            const narrowestSide = Math.min(window.innerWidth, window.innerHeight);
            const longestSide = Math.max(window.innerWidth, window.innerHeight);

            const html = document.documentElement;

            if (isPWA && isLandscape && longestSide <= 950) {
                html.classList.add('pwa-landscape');
            } else {
                html.classList.remove('pwa-landscape');
            }

            if (isLandscape && (narrowestSide <= 500)) {
                html.classList.add('title-compact-landscape');
            } else {
                html.classList.remove('title-compact-landscape');
            }
        };

        update();
        window.addEventListener('resize', update);
        window.addEventListener('orientationchange', () => setTimeout(update, 100));
    }

    // -------------------------------------------------------------------------
    // Event listeners
    // -------------------------------------------------------------------------
    initEventListeners() {
        this.hamburgerBtn.addEventListener('click', () => this.togglePanel());

        // Close panel on overlay click/tap (touchstart for iOS responsiveness)
        this.mobileOverlay.addEventListener('click', () => this.closePanel());
        this.mobileOverlay.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.closePanel();
        }, { passive: false });

        // Close panel when tapping the canvas on narrow screens
        this.canvas.addEventListener('pointerdown', () => {
            if (this.isNarrow() && this.panelOpen) this.closePanel();
        });

        this.launchBtn.addEventListener('click', () => this.launchApp());
        this.returnBtn.addEventListener('click', () => this.returnToTitle());
        window.addEventListener('resize', () => this.handleResize());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.returnToTitle();
            if (e.key === ' ' && this.currentState === this.states.TITLE) {
                e.preventDefault();
                this.launchApp();
            }
        });
    }

    isNarrow() {
        return window.innerWidth < 768;
    }

    handleResize() {
        this.resizeCanvas();
        if (this.currentState !== this.states.APP) return;
        // Auto-open on wide screens; remove stale overlay if screen widens
        if (!this.isNarrow()) {
            this.mobileOverlay.classList.remove('active');
            if (!this.panelOpen) this.openPanel();
        }
    }

    // -------------------------------------------------------------------------
    // Sidebar panel open / close / toggle
    // -------------------------------------------------------------------------
    openPanel() {
        this.panelOpen = true;
        this.sidebarPanel.classList.add('mobile-open');
        this.hamburgerBtn.classList.add('active', 'panel-open');
        // Only darken the canvas on narrow screens; wide screens keep it visible
        if (this.isNarrow()) this.mobileOverlay.classList.add('active');
    }

    closePanel() {
        this.panelOpen = false;
        this.sidebarPanel.classList.remove('mobile-open');
        this.hamburgerBtn.classList.remove('active', 'panel-open');
        this.mobileOverlay.classList.remove('active');
    }

    togglePanel() {
        if (this.panelOpen) {
            this.closePanel();
        } else {
            this.openPanel();
        }
    }

    // -------------------------------------------------------------------------
    // State transitions
    // -------------------------------------------------------------------------
    launchApp() {
        this.currentState = this.states.APP;

        this.titleScreen.classList.add('hidden');

        this.sidebarPanel.classList.remove('hidden');
        this.hamburgerBtn.classList.remove('hidden');
        this.canvas.classList.add('loaded');
        this.resizeCanvas();
        this.drawCanvas();

        // Double rAF: panel must paint at left:-100% before mobile-open triggers the slide
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.hamburgerBtn.classList.add('loaded');
                this.openPanel();
            });
        });
    }

    returnToTitle() {
        this.currentState = this.states.TITLE;

        this.closePanel();

        this.sidebarPanel.classList.add('hidden');
        this.hamburgerBtn.classList.remove('loaded');
        this.hamburgerBtn.classList.add('hidden');

        this.titleScreen.classList.remove('hidden');
        this.canvas.classList.remove('loaded');
    }

    // -------------------------------------------------------------------------
    // Canvas
    // -------------------------------------------------------------------------
    resizeCanvas() {
        const w = this.appContainer.clientWidth;
        const h = this.appContainer.clientHeight;
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        if (this.currentState === this.states.APP) {
            this.drawCanvas();
        }
    }

    drawCanvas() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
    }

    // -------------------------------------------------------------------------
    // Initial page load fade-in
    // -------------------------------------------------------------------------
    showLoadedState() {
        requestAnimationFrame(() => {
            this.titleScreen.classList.add('loaded');
        });
    }

    // -------------------------------------------------------------------------
    // Service Worker registration
    // -------------------------------------------------------------------------
    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js').catch((err) => {
                    console.warn('Service worker registration failed:', err);
                });
            });
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new Komplexiti();
});
