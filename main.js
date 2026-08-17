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

        // ---- Argand diagram viewport (world coords: Re = x, Im = y) ----
        this.viewport = {
            width:   0,
            height:  0,
            scale:   60,   // pixels per unit (uniform on both axes)
            minX: 0, maxX: 0,
            minY: 0, maxY: 0,
            centerX: 0,
            centerY: 0
        };

        // ---- UI preferences ----
        this.sizeMode = 'normal';   // 'normal' | 'large' | 'xlarge'

        // ---- Complex number constants ----
        this.complexConstants = [];
        this.nextConstantId   = 1;
        this.constantColors   = [
            '#0057FF', '#00C853', '#B91C1C',
            '#C026D3', '#1ABC9C', '#00E5FF', '#A855F7',
            '#FF6B6B', '#4A90E2', '#FFD400', '#84CC16', '#F39C12'
        ];
        this.displayMode = 'arrow'; // 'arrow' | 'point'

        // ---- Input state ----
        this.input = {
            mouse: { down: false, x: 0, y: 0, velocityX: 0, velocityY: 0, lastMoveTime: 0 },
            lastX: 0,
            lastY: 0,
            dragging: false,
            viewportPanActive: false,
            pinch: {
                active: false,
                initialDistance: 0,
                initialCenterX: 0,
                initialCenterY: 0,
                initialMinX: 0, initialMaxX: 0,
                initialMinY: 0, initialMaxY: 0
            }
        };

        // ---- Pan inertia ----
        this.mousePanInertia = { active: false, velocityX: 0, velocityY: 0 };

        // ---- Animation loop ----
        this.animationId   = null;
        this.lastFrameTime = 0;
        this.deltaTime     = 0;

        this.initElements();
        this.loadConstants();
        this.initializeTheme();
        this.initializeSizeMode();
        this.setupPWALandscapeDetection();
        this.initEventListeners();
        this.initCanvasInputListeners();
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
        this.hamburgerBtn       = document.getElementById('hamburger-menu');
        this.sidebarPanel       = document.getElementById('sidebar-panel');
        this.mobileOverlay      = document.getElementById('mobile-overlay');
        this.titleScreen        = document.getElementById('title-screen');
        this.launchBtn          = document.getElementById('title-launch-button');
        this.returnBtn          = document.getElementById('return-to-title');
        this.appContainer       = document.getElementById('app-container');
        this.constantsContainer = document.getElementById('constants-container');
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

        const reopenPanelIfClosed = () => {
            if (this.currentState === this.states.APP && !this.panelOpen) {
                this.openPanel();
            }
        };
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) reopenPanelIfClosed();
        });
        window.addEventListener('focus', reopenPanelIfClosed);
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Panel control buttons
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) themeToggle.addEventListener('click', () => this.toggleTheme());
        const sizeModeToggle = document.getElementById('size-mode-toggle');
        if (sizeModeToggle) sizeModeToggle.addEventListener('click', () => this.toggleSizeMode());

        const addConstantBtn = document.getElementById('add-constant-btn');
        if (addConstantBtn) addConstantBtn.addEventListener('click', () => this.addConstant());
        const displayModeToggle = document.getElementById('display-mode-toggle');
        if (displayModeToggle) displayModeToggle.addEventListener('click', () => this.toggleDisplayMode());
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
        this.stopAnimationLoop();

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
        this.updateViewport();
        if (this.currentState === this.states.APP) {
            this.drawCanvas();
        }
    }

    drawCanvas() {
        if (!this.viewport.width || !this.viewport.height) return;
        const ctx = this.ctx;
        const canvasBg = getComputedStyle(document.documentElement)
            .getPropertyValue('--canvas-bg').trim() || '#000000';
        ctx.fillStyle = canvasBg;
        ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);
        this.drawGrid();
        this.drawAxes();
        this.drawAxisLabels();
        this.drawComplexConstants();
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
    // =========================================================================
    // Viewport
    // =========================================================================

    updateViewport() {
        this.viewport.width  = this.canvas.width;
        this.viewport.height = this.canvas.height;
        if (this.viewport.width > 0 && this.viewport.height > 0) {
            const halfW = this.viewport.width  / (2 * this.viewport.scale);
            const halfH = this.viewport.height / (2 * this.viewport.scale);
            this.viewport.minX = this.viewport.centerX - halfW;
            this.viewport.maxX = this.viewport.centerX + halfW;
            this.viewport.minY = this.viewport.centerY - halfH;
            this.viewport.maxY = this.viewport.centerY + halfH;
        }
    }

    worldToScreen(worldX, worldY) {
        const xRatio = (worldX - this.viewport.minX) / (this.viewport.maxX - this.viewport.minX);
        const yRatio = (worldY - this.viewport.minY) / (this.viewport.maxY - this.viewport.minY);
        return {
            x: xRatio * this.viewport.width,
            y: this.viewport.height - yRatio * this.viewport.height
        };
    }

    screenToWorld(screenX, screenY) {
        const xRatio = screenX / this.viewport.width;
        const yRatio = (this.viewport.height - screenY) / this.viewport.height;
        return {
            x: this.viewport.minX + xRatio * (this.viewport.maxX - this.viewport.minX),
            y: this.viewport.minY + yRatio * (this.viewport.maxY - this.viewport.minY)
        };
    }

    screenToWorldFrom(screenX, screenY, minX, maxX, minY, maxY) {
        const xRatio = screenX / this.viewport.width;
        const yRatio = (this.viewport.height - screenY) / this.viewport.height;
        return {
            x: minX + xRatio * (maxX - minX),
            y: minY + yRatio * (maxY - minY)
        };
    }

    // =========================================================================
    // Grid spacing
    // =========================================================================

    findBestGridSpacing(pixelsPerUnit) {
        const minPx = 40, maxPx = 120, idealPx = 80;
        const bases = [];
        for (let exp = -6; exp <= 6; exp++) {
            const b = Math.pow(10, exp);
            bases.push(b, 2 * b, 5 * b);
        }
        bases.sort((a, b) => a - b);
        let best = bases[0];
        let bestScore = Infinity;
        for (const s of bases) {
            const px = s * pixelsPerUnit;
            if (px < minPx || px > maxPx) continue;
            const score = Math.abs(px - idealPx);
            if (score < bestScore) { best = s; bestScore = score; }
        }
        if (bestScore === Infinity) {
            for (const s of bases) {
                if (s * pixelsPerUnit >= minPx) { best = s; break; }
            }
        }
        return best;
    }

    getLabelSpacing() {
        return this.findBestGridSpacing(this.viewport.scale);
    }

    formatNumber(n) {
        if (Math.abs(n) < 1e-10) return '0';
        const abs = Math.abs(n);
        if (abs >= 1e5 || (abs < 1e-3 && abs > 0)) return n.toExponential(2);
        return parseFloat(n.toPrecision(6)).toString();
    }

    // =========================================================================
    // Drawing
    // =========================================================================

    drawGrid() {
        const isLight    = document.documentElement.getAttribute('data-theme') === 'light';
        const minorColor = isLight ? 'rgba(0, 0, 0, 0.08)'  : 'rgba(255, 255, 255, 0.2)';
        const majorColor = isLight ? 'rgba(0, 0, 0, 0.18)'  : 'rgba(255, 255, 255, 0.32)';
        const subdiv     = 5;
        const labelSpacing = this.getLabelSpacing();
        const minorSpacing = labelSpacing / subdiv;
        const drawMinor    = (minorSpacing * this.viewport.scale) >= 9;

        const isNearMajor = (v, major) => {
            if (!isFinite(v) || major <= 0) return false;
            const q = v / major;
            return Math.abs(q - Math.round(q)) < 1e-6;
        };
        const crisp = (v) => Math.round(v) + 0.5;

        this.ctx.save();

        if (drawMinor) {
            this.ctx.strokeStyle  = minorColor;
            this.ctx.globalAlpha  = 0.58;
            this.ctx.lineWidth    = 1;
            this.ctx.beginPath();

            const sx0 = Math.floor(this.viewport.minX / minorSpacing) * minorSpacing;
            for (let x = sx0; x <= this.viewport.maxX + minorSpacing * 0.5; x += minorSpacing) {
                if (isNearMajor(x, labelSpacing)) continue;
                const cx = crisp(this.worldToScreen(x, 0).x);
                this.ctx.moveTo(cx, 0);
                this.ctx.lineTo(cx, this.viewport.height);
            }
            const sy0 = Math.floor(this.viewport.minY / minorSpacing) * minorSpacing;
            for (let y = sy0; y <= this.viewport.maxY + minorSpacing * 0.5; y += minorSpacing) {
                if (isNearMajor(y, labelSpacing)) continue;
                const cy = crisp(this.worldToScreen(0, y).y);
                this.ctx.moveTo(0, cy);
                this.ctx.lineTo(this.viewport.width, cy);
            }
            this.ctx.stroke();
        }

        this.ctx.strokeStyle  = majorColor;
        this.ctx.globalAlpha  = 1;
        this.ctx.lineWidth    = 1.15;
        this.ctx.beginPath();

        const mx0 = Math.floor(this.viewport.minX / labelSpacing) * labelSpacing;
        for (let x = mx0; x <= this.viewport.maxX + labelSpacing * 0.5; x += labelSpacing) {
            const cx = crisp(this.worldToScreen(x, 0).x);
            this.ctx.moveTo(cx, 0);
            this.ctx.lineTo(cx, this.viewport.height);
        }
        const my0 = Math.floor(this.viewport.minY / labelSpacing) * labelSpacing;
        for (let y = my0; y <= this.viewport.maxY + labelSpacing * 0.5; y += labelSpacing) {
            const cy = crisp(this.worldToScreen(0, y).y);
            this.ctx.moveTo(0, cy);
            this.ctx.lineTo(this.viewport.width, cy);
        }
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawAxes() {
        const isLight   = document.documentElement.getAttribute('data-theme') === 'light';
        const axisColor = isLight ? '#000000' : 'rgba(255, 255, 255, 0.72)';
        const crisp     = (v) => Math.round(v) + 0.5;

        this.ctx.save();
        this.ctx.strokeStyle = axisColor;
        this.ctx.lineWidth   = 2.2;
        this.ctx.globalAlpha = 1;
        this.ctx.beginPath();

        if (this.viewport.minY <= 0 && this.viewport.maxY >= 0) {
            const y = crisp(this.worldToScreen(0, 0).y);
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.viewport.width, y);
        }
        if (this.viewport.minX <= 0 && this.viewport.maxX >= 0) {
            const x = crisp(this.worldToScreen(0, 0).x);
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.viewport.height);
        }
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawAxisLabels() {
        const isLight    = document.documentElement.getAttribute('data-theme') === 'light';
        const labelColor = isLight
            ? '#000000'
            : getComputedStyle(document.documentElement).getPropertyValue('--label-color').trim();

        this.ctx.save();
        this.ctx.fillStyle = labelColor;

        const font = this.sizeMode === 'xlarge' ? 'bold 20px Arial'
                   : this.sizeMode === 'large'  ? 'bold 16px Arial'
                   : '12px Arial';
        this.ctx.font = font;

        const labelSpacing = this.getLabelSpacing();

        // Real (x) axis numbers
        if (this.viewport.minY <= 0 && this.viewport.maxY >= 0) {
            const axisY = this.worldToScreen(0, 0).y;
            this.ctx.textAlign    = 'center';
            this.ctx.textBaseline = 'top';
            const x0 = Math.floor(this.viewport.minX / labelSpacing) * labelSpacing;
            for (let x = x0; x <= this.viewport.maxX; x += labelSpacing) {
                if (Math.abs(x) < 1e-9) continue;
                const sp = this.worldToScreen(x, 0);
                if (sp.x < 20 || sp.x > this.viewport.width - 20) continue;
                const ly = axisY + 5;
                if (ly < this.viewport.height - 15) {
                    this.ctx.fillText(this.formatNumber(x), sp.x, ly);
                }
            }
        }

        // Imaginary (y) axis numbers
        if (this.viewport.minX <= 0 && this.viewport.maxX >= 0) {
            const axisX = this.worldToScreen(0, 0).x;
            this.ctx.textAlign    = 'right';
            this.ctx.textBaseline = 'middle';
            const y0 = Math.floor(this.viewport.minY / labelSpacing) * labelSpacing;
            for (let y = y0; y <= this.viewport.maxY; y += labelSpacing) {
                if (Math.abs(y) < 1e-9) continue;
                const sp = this.worldToScreen(0, y);
                if (sp.y < 20 || sp.y > this.viewport.height - 20) continue;
                const lx = axisX - 5;
                if (lx > 15) {
                    this.ctx.fillText(this.formatNumber(y), lx, sp.y);
                }
            }
        }

        // Origin label
        if (this.viewport.minX <= 0 && this.viewport.maxX >= 0 &&
            this.viewport.minY <= 0 && this.viewport.maxY >= 0) {
            const o = this.worldToScreen(0, 0);
            this.ctx.textAlign    = 'right';
            this.ctx.textBaseline = 'top';
            this.ctx.fillText('0', o.x - 5, o.y + 5);
        }

        // Axis title labels (Re / Im)
        const titleColor = isLight ? '#1566c0' : '#4A90E2';
        const titleFont  = this.sizeMode === 'xlarge' ? 'bold 18px Arial'
                         : this.sizeMode === 'large'  ? 'bold 14px Arial'
                         : 'bold 11px Arial';
        this.ctx.fillStyle = titleColor;
        this.ctx.font      = titleFont;

        if (this.viewport.minY <= 0 && this.viewport.maxY >= 0) {
            const axisY = this.worldToScreen(0, 0).y;
            this.ctx.textAlign    = 'right';
            this.ctx.textBaseline = 'bottom';
            this.ctx.fillText('Re', this.viewport.width - 6, axisY - 6);
        }
        if (this.viewport.minX <= 0 && this.viewport.maxX >= 0) {
            const axisX = this.worldToScreen(0, 0).x;
            this.ctx.textAlign    = 'left';
            this.ctx.textBaseline = 'top';
            this.ctx.fillText('Im', axisX + 6, 6);
        }

        this.ctx.restore();
    }

    // =========================================================================
    // Canvas input listeners (mouse, touch, wheel)
    // =========================================================================

    initCanvasInputListeners() {
        this.canvas.addEventListener('mousedown', (e) => {
            if (this.currentState !== this.states.APP) return;
            if (e.button !== 0) return;
            this.handlePointerStart(e.clientX, e.clientY);
        });
        document.addEventListener('mousemove', (e) => {
            if (this.currentState !== this.states.APP) return;
            this.handlePointerMove(e.clientX, e.clientY);
        });
        document.addEventListener('mouseup', () => {
            if (this.input.mouse.down) this.handlePointerEnd();
        });
        this.canvas.addEventListener('wheel', (e) => {
            if (this.currentState !== this.states.APP) return;
            this.handleWheel(e);
        }, { passive: false });
        this.canvas.addEventListener('touchstart', (e) => {
            if (this.currentState !== this.states.APP) return;
            this.handleTouchStart(e);
        }, { passive: false });
        this.canvas.addEventListener('touchmove', (e) => {
            if (this.currentState !== this.states.APP) return;
            this.handleTouchMove(e);
        }, { passive: false });
        this.canvas.addEventListener('touchend', (e) => {
            if (this.currentState !== this.states.APP) return;
            this.handleTouchEnd(e);
        }, { passive: true });
        this.canvas.addEventListener('touchcancel', (e) => {
            if (this.currentState !== this.states.APP) return;
            this.handleTouchEnd(e);
        }, { passive: true });
    }

    // =========================================================================
    // Pointer / mouse handling
    // =========================================================================

    handlePointerStart(clientX, clientY) {
        this.stopMousePanInertia();
        const rect = this.canvas.getBoundingClientRect();
        const cx = clientX - rect.left;
        const cy = clientY - rect.top;
        this.input.mouse.down          = true;
        this.input.mouse.x             = cx;
        this.input.mouse.y             = cy;
        this.input.lastX               = cx;
        this.input.lastY               = cy;
        this.input.dragging            = false;
        this.input.viewportPanActive   = false;
        this.input.mouse.velocityX     = 0;
        this.input.mouse.velocityY     = 0;
        this.input.mouse.lastMoveTime  = performance.now();
    }

    handlePointerMove(clientX, clientY) {
        if (!this.input.mouse.down) return;
        const rect   = this.canvas.getBoundingClientRect();
        const cx     = clientX - rect.left;
        const cy     = clientY - rect.top;
        const now    = performance.now();
        const deltaX = cx - this.input.lastX;
        const deltaY = cy - this.input.lastY;

        if (deltaX !== 0 || deltaY !== 0) {
            const xRange  = this.viewport.maxX - this.viewport.minX;
            const yRange  = this.viewport.maxY - this.viewport.minY;
            const worldDX = -(deltaX / this.viewport.width)  * xRange;
            const worldDY =  (deltaY / this.viewport.height) * yRange;

            const elapsed = Math.max(now - this.input.mouse.lastMoveTime, 1);
            const smooth  = 0.35;
            this.input.mouse.velocityX = this.input.mouse.velocityX * (1 - smooth) + (worldDX / elapsed) * smooth;
            this.input.mouse.velocityY = this.input.mouse.velocityY * (1 - smooth) + (worldDY / elapsed) * smooth;
            this.input.mouse.lastMoveTime = now;

            this.viewport.minX   += worldDX; this.viewport.maxX   += worldDX;
            this.viewport.minY   += worldDY; this.viewport.maxY   += worldDY;
            this.viewport.centerX = (this.viewport.minX + this.viewport.maxX) / 2;
            this.viewport.centerY = (this.viewport.minY + this.viewport.maxY) / 2;

            this.input.dragging          = true;
            this.input.viewportPanActive = true;
            this.drawCanvas();
        }
        this.input.lastX = cx;
        this.input.lastY = cy;
    }

    handlePointerEnd() {
        if (!this.input.mouse.down) return;
        const speed  = Math.hypot(this.input.mouse.velocityX, this.input.mouse.velocityY);
        const idleMs = performance.now() - this.input.mouse.lastMoveTime;
        if (this.input.viewportPanActive && speed > 1e-6 && idleMs < 120) {
            this.startMousePanInertia();
        }
        this.input.mouse.down        = false;
        this.input.dragging          = false;
        this.input.viewportPanActive = false;
    }

    // =========================================================================
    // Wheel zoom (towards cursor)
    // =========================================================================

    handleWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.15 : (1 / 1.15);
        const rect   = this.canvas.getBoundingClientRect();
        const cx     = e.clientX - rect.left;
        const cy     = e.clientY - rect.top;
        this.zoomAtScreenPoint(factor, cx, cy);
    }

    zoomAtScreenPoint(factor, cx, cy) {
        const pivot  = this.screenToWorld(cx, cy);
        const xRange = (this.viewport.maxX - this.viewport.minX) * factor;
        const yRange = (this.viewport.maxY - this.viewport.minY) * factor;
        if (xRange < 0.0005 || xRange > 1e9) return;

        const xRatio = cx / this.viewport.width;
        const yRatio = (this.viewport.height - cy) / this.viewport.height;
        this.viewport.minX    = pivot.x - xRatio * xRange;
        this.viewport.maxX    = this.viewport.minX + xRange;
        this.viewport.minY    = pivot.y - yRatio * yRange;
        this.viewport.maxY    = this.viewport.minY + yRange;
        this.viewport.scale   = this.viewport.width / xRange;
        this.viewport.centerX = (this.viewport.minX + this.viewport.maxX) / 2;
        this.viewport.centerY = (this.viewport.minY + this.viewport.maxY) / 2;
        this.drawCanvas();
    }

    zoomIn()  { this.zoomAtScreenPoint(1 / 1.2, this.viewport.width / 2, this.viewport.height / 2); }
    zoomOut() { this.zoomAtScreenPoint(1.2,     this.viewport.width / 2, this.viewport.height / 2); }

    // =========================================================================
    // Keyboard
    // =========================================================================

    handleKeyboard(e) {
        // Suppress all key handling while a text / math input is focused
        const active = document.activeElement;
        if (active && (
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.isContentEditable ||
            active.tagName === 'MATH-FIELD'
        )) return;

        if (e.key === 'Escape') {
            if (e.repeat) return;
            this.returnToTitle();
            return;
        }
        if (e.key === ' ' && this.currentState === this.states.TITLE) {
            e.preventDefault();
            this.launchApp();
            return;
        }
        if (this.currentState !== this.states.APP) return;

        switch (e.key) {
            case '=': case '+': e.preventDefault(); this.zoomIn();         break;
            case '-': case '_': e.preventDefault(); this.zoomOut();        break;
            case 'ArrowLeft':   e.preventDefault(); this.panBy(-0.15, 0);  break;
            case 'ArrowRight':  e.preventDefault(); this.panBy( 0.15, 0);  break;
            case 'ArrowUp':     e.preventDefault(); this.panBy(0,  0.15);  break;
            case 'ArrowDown':   e.preventDefault(); this.panBy(0, -0.15);  break;
        }
    }

    panBy(dxFraction, dyFraction) {
        const dx = dxFraction * (this.viewport.maxX - this.viewport.minX);
        const dy = dyFraction * (this.viewport.maxY - this.viewport.minY);
        this.viewport.minX    += dx; this.viewport.maxX    += dx;
        this.viewport.minY    += dy; this.viewport.maxY    += dy;
        this.viewport.centerX += dx;
        this.viewport.centerY += dy;
        this.drawCanvas();
    }

    // =========================================================================
    // Touch (single-finger pan + two-finger pinch zoom)
    // =========================================================================

    handleTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            this.input.pinch.active = false;
            const t = e.touches[0];
            this.handlePointerStart(t.clientX, t.clientY);
        } else if (e.touches.length === 2) {
            this.input.mouse.down = false;
            this.stopMousePanInertia();
            const t1   = e.touches[0];
            const t2   = e.touches[1];
            const rect = this.canvas.getBoundingClientRect();
            const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const pcx  = ((t1.clientX + t2.clientX) / 2) - rect.left;
            const pcy  = ((t1.clientY + t2.clientY) / 2) - rect.top;
            this.input.pinch.active          = true;
            this.input.pinch.initialDistance = dist;
            this.input.pinch.initialCenterX  = pcx;
            this.input.pinch.initialCenterY  = pcy;
            this.input.pinch.initialMinX     = this.viewport.minX;
            this.input.pinch.initialMaxX     = this.viewport.maxX;
            this.input.pinch.initialMinY     = this.viewport.minY;
            this.input.pinch.initialMaxY     = this.viewport.maxY;
        }
    }

    handleTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1 && !this.input.pinch.active) {
            const t = e.touches[0];
            this.handlePointerMove(t.clientX, t.clientY);
        } else if (e.touches.length === 2 && this.input.pinch.active) {
            const t1     = e.touches[0];
            const t2     = e.touches[1];
            const dist   = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const factor = this.input.pinch.initialDistance / dist;
            const newXRange = (this.input.pinch.initialMaxX - this.input.pinch.initialMinX) * factor;
            const newYRange = (this.input.pinch.initialMaxY - this.input.pinch.initialMinY) * factor;
            if (newXRange < 0.0005 || newXRange > 1e9) return;

            const pivot  = this.screenToWorldFrom(
                this.input.pinch.initialCenterX, this.input.pinch.initialCenterY,
                this.input.pinch.initialMinX, this.input.pinch.initialMaxX,
                this.input.pinch.initialMinY, this.input.pinch.initialMaxY
            );
            const xRatio = this.input.pinch.initialCenterX / this.viewport.width;
            const yRatio = (this.viewport.height - this.input.pinch.initialCenterY) / this.viewport.height;
            this.viewport.minX    = pivot.x - xRatio * newXRange;
            this.viewport.maxX    = this.viewport.minX + newXRange;
            this.viewport.minY    = pivot.y - yRatio * newYRange;
            this.viewport.maxY    = this.viewport.minY + newYRange;
            this.viewport.scale   = this.viewport.width / newXRange;
            this.viewport.centerX = (this.viewport.minX + this.viewport.maxX) / 2;
            this.viewport.centerY = (this.viewport.minY + this.viewport.maxY) / 2;
            this.drawCanvas();
        }
    }

    handleTouchEnd(e) {
        if (e.touches.length === 0) {
            this.input.pinch.active = false;
            this.handlePointerEnd();
        } else if (e.touches.length === 1 && this.input.pinch.active) {
            this.input.pinch.active = false;
            const t = e.touches[0];
            this.handlePointerStart(t.clientX, t.clientY);
        }
    }

    // =========================================================================
    // Pan inertia
    // =========================================================================

    startMousePanInertia() {
        this.mousePanInertia.active    = true;
        this.mousePanInertia.velocityX = this.input.mouse.velocityX;
        this.mousePanInertia.velocityY = this.input.mouse.velocityY;
        this.ensureAnimationLoopRunning();
    }

    stopMousePanInertia() {
        this.mousePanInertia.active    = false;
        this.mousePanInertia.velocityX = 0;
        this.mousePanInertia.velocityY = 0;
    }

    // =========================================================================
    // Animation loop
    // =========================================================================

    ensureAnimationLoopRunning() {
        if (!this.animationId) {
            this.lastFrameTime = performance.now();
            this.animationId   = requestAnimationFrame((t) => this.animationTick(t));
        }
    }

    stopAnimationLoop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.stopMousePanInertia();
    }

    animationTick(timestamp) {
        this.animationId  = null;
        this.deltaTime    = Math.min(timestamp - this.lastFrameTime, 100);
        this.lastFrameTime = timestamp;

        if (this.mousePanInertia.active) {
            const worldDX = this.mousePanInertia.velocityX * this.deltaTime;
            const worldDY = this.mousePanInertia.velocityY * this.deltaTime;
            const speed   = Math.hypot(this.mousePanInertia.velocityX, this.mousePanInertia.velocityY);
            if (speed > 2e-6) {
                this.viewport.minX   += worldDX; this.viewport.maxX   += worldDX;
                this.viewport.minY   += worldDY; this.viewport.maxY   += worldDY;
                this.viewport.centerX = (this.viewport.minX + this.viewport.maxX) / 2;
                this.viewport.centerY = (this.viewport.minY + this.viewport.maxY) / 2;
                const decay = Math.exp(-this.deltaTime / 180);
                this.mousePanInertia.velocityX *= decay;
                this.mousePanInertia.velocityY *= decay;
                if (this.currentState === this.states.APP) this.drawCanvas();
                this.animationId = requestAnimationFrame((t) => this.animationTick(t));
            } else {
                this.stopMousePanInertia();
            }
        }
    }

    // =========================================================================
    // Theme
    // =========================================================================

    toggleTheme() {
        const html      = document.documentElement;
        const isLight   = html.getAttribute('data-theme') === 'light';
        const lightIcon = document.getElementById('light-icon');
        const darkIcon  = document.getElementById('dark-icon');
        if (isLight) {
            html.removeAttribute('data-theme');
            if (lightIcon) lightIcon.style.opacity = '0.3';
            if (darkIcon)  darkIcon.style.opacity  = '1';
            localStorage.setItem('komplexiti-theme', 'dark');
        } else {
            html.setAttribute('data-theme', 'light');
            if (lightIcon) lightIcon.style.opacity = '1';
            if (darkIcon)  darkIcon.style.opacity  = '0.3';
            localStorage.setItem('komplexiti-theme', 'light');
        }
        document.querySelectorAll('.expr-card math-field').forEach(f => this.applyMathFieldTheme(f));
        this.updateCanvasBackground();
        if (this.currentState === this.states.APP) this.drawCanvas();
    }

    applyMathFieldTheme(field) {
        // Read from sidebar-panel scope: it always overrides --input-bg to dark regardless of app theme
        const scope     = document.getElementById('sidebar-panel') || document.documentElement;
        const cs        = getComputedStyle(scope);
        const inputBg   = cs.getPropertyValue('--input-bg').trim()    || '#3A4F6A';
        const textColor = cs.getPropertyValue('--text-primary').trim() || '#E8F4FD';
        field.style.setProperty('background',    inputBg,   'important');
        field.style.setProperty('--background',  inputBg,   'important');
        field.style.setProperty('color',         textColor, 'important');
        field.style.setProperty('--text-color',  textColor, 'important');
        field.style.setProperty('--caret-color', textColor);
    }

    initializeTheme() {
        const saved     = localStorage.getItem('komplexiti-theme');
        const lightIcon = document.getElementById('light-icon');
        const darkIcon  = document.getElementById('dark-icon');
        if (saved === 'dark') {
            document.documentElement.removeAttribute('data-theme');
            if (lightIcon) lightIcon.style.opacity = '0.3';
            if (darkIcon)  darkIcon.style.opacity  = '1';
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            if (lightIcon) lightIcon.style.opacity = '1';
            if (darkIcon)  darkIcon.style.opacity  = '0.3';
        }
        this.updateCanvasBackground();
    }

    updateCanvasBackground() {
        const bg = getComputedStyle(document.documentElement)
            .getPropertyValue('--canvas-bg').trim();
        this.canvas.style.background = bg;
    }

    // =========================================================================
    // Size mode
    // =========================================================================

    toggleSizeMode() {
        const s = document.getElementById('small-size-icon');
        const m = document.getElementById('medium-size-icon');
        const l = document.getElementById('large-size-icon');
        if      (this.sizeMode === 'normal') this.sizeMode = 'large';
        else if (this.sizeMode === 'large')  this.sizeMode = 'xlarge';
        else                                 this.sizeMode = 'normal';
        if (s) s.style.opacity = this.sizeMode === 'normal' ? '1' : '0.3';
        if (m) m.style.opacity = this.sizeMode === 'large'  ? '1' : '0.3';
        if (l) l.style.opacity = this.sizeMode === 'xlarge' ? '1' : '0.3';
        if (this.currentState === this.states.APP) this.drawCanvas();
    }

    initializeSizeMode() {
        const s = document.getElementById('small-size-icon');
        const m = document.getElementById('medium-size-icon');
        const l = document.getElementById('large-size-icon');
        this.sizeMode = 'normal';
        if (s) s.style.opacity = '1';
        if (m) m.style.opacity = '0.3';
        if (l) l.style.opacity = '0.3';
    }

    // =========================================================================
    // Complex number constants
    // =========================================================================

    addConstant() {
        const id = this.nextConstantId++;
        let color;
        if (this.complexConstants.length === 0) {
            color = this.constantColors[0];
        } else {
            const prevColor = this.complexConstants[this.complexConstants.length - 1].color;
            const prevIdx   = this.constantColors.indexOf(prevColor);
            color = this.constantColors[(prevIdx + 1) % this.constantColors.length];
        }
        const c = { id, color, enabled: true, latex: '', name: null, re: null, im: null };
        this.complexConstants.push(c);
        this.createConstantUI(c);
        this.saveConstants();
    }

    createConstantUI(c, { skipFocus = false } = {}) {
        const card = document.createElement('div');
        card.className = 'expr-card';
        card.style.borderLeftColor = c.color;
        card.setAttribute('data-const-id', c.id);

        card.innerHTML = `
            <div class="expr-card-main-row">
                <math-field
                    default-mode="math"
                    virtual-keyboard-mode="manual"
                    color-scheme="dark"
                ></math-field>
                <div class="expr-card-controls">
                    <button class="expr-remove-btn" title="Delete" aria-label="Delete constant">
                        <svg viewBox="0 0 16 16"><path d="M4 4L12 12M12 4L4 12"/></svg>
                    </button>
                    <div class="expr-color-dot" style="background:${c.color};opacity:${c.enabled ? 1 : 0.3}" title="Toggle visibility"></div>
                </div>
            </div>`;

        const mathField = card.querySelector('math-field');
        const dot       = card.querySelector('.expr-color-dot');
        const removeBtn = card.querySelector('.expr-remove-btn');

        mathField.addEventListener('input', () => {
            c.latex = mathField.value;
            const raw = c.latex.trim();
            const assignment = raw ? this.parseAssignment(raw) : null;
            let hasError = false;

            if (assignment) {
                const nameError = this.validateConstantName(assignment.name, c.id);
                if (nameError) {
                    c.name = null;
                    c.re   = null;
                    c.im   = null;
                    hasError = true;
                } else {
                    c.name = assignment.name;
                    const parsed = this.parseComplexFromLatex(assignment.valueLaTeX, this.buildConstantScope(c.id));
                    c.re = parsed !== null ? parsed.re : null;
                    c.im = parsed !== null ? parsed.im : null;
                    hasError = parsed === null;
                }
            } else {
                c.name = null;
                const parsed = this.parseComplexFromLatex(raw, this.buildConstantScope(c.id));
                c.re = parsed !== null ? parsed.re : null;
                c.im = parsed !== null ? parsed.im : null;
                hasError = raw.length > 0 && parsed === null;
            }

            if (hasError) {
                mathField.classList.add('input-error');
                mathField.style.setProperty('background', 'rgba(231, 76, 60, 0.1)', 'important');
            } else {
                mathField.classList.remove('input-error');
                const panel  = document.getElementById('sidebar-panel') || document.documentElement;
                const inputBg = getComputedStyle(panel).getPropertyValue('--input-bg').trim() || '#3A4F6A';
                mathField.style.setProperty('background', inputBg, 'important');
            }
            this.cascadeEvaluate(c.id);
            this.saveConstants();
            if (this.currentState === this.states.APP) this.drawCanvas();
        });

        removeBtn.addEventListener('click', () => this.removeConstant(c.id));

        dot.addEventListener('click', () => {
            c.enabled = !c.enabled;
            dot.style.opacity = c.enabled ? '1' : '0.3';
            this.saveConstants();
            if (this.currentState === this.states.APP) this.drawCanvas();
        });

        if (this.constantsContainer) this.constantsContainer.appendChild(card);

        // Apply theme after DOM insertion so MathLive's connectedCallback fires first
        requestAnimationFrame(() => {
            this.applyMathFieldTheme(mathField);
            if (c.latex) {
                mathField.value = c.latex;
                mathField.dispatchEvent(new Event('input'));
            }
            if (!skipFocus) {
                try { mathField.focus(); } catch { /* ignore */ }
            }
        });
    }

    removeConstant(id) {
        const idx = this.complexConstants.findIndex(c => c.id === id);
        if (idx !== -1) this.complexConstants.splice(idx, 1);
        const card = document.querySelector(`.expr-card[data-const-id="${id}"]`);
        if (card) card.remove();
        this.saveConstants();
        if (this.currentState === this.states.APP) this.drawCanvas();
    }

    saveConstants() {
        const data = {
            nextId:    this.nextConstantId,
            constants: this.complexConstants.map(c => ({
                id:      c.id,
                color:   c.color,
                enabled: c.enabled,
                latex:   c.latex
            }))
        };
        localStorage.setItem('komplexiti-constants', JSON.stringify(data));
    }

    loadConstants() {
        try {
            const raw = localStorage.getItem('komplexiti-constants');
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data.nextId) this.nextConstantId = data.nextId;
            for (const saved of (data.constants || [])) {
                const c = { id: saved.id, color: saved.color, enabled: !!saved.enabled, latex: saved.latex || '', name: null, re: null, im: null };
                this.complexConstants.push(c);
                this.createConstantUI(c, { skipFocus: true });
            }
        } catch { /* ignore corrupt data */ }
    }

    // Returns { name, valueLaTeX } if the expression is a valid assignment, else null.
    parseAssignment(latex) {
        const m = latex.match(/^([a-zA-Z][0-9]*)=(.+)$/);
        if (!m) return null;
        return { name: m[1], valueLaTeX: m[2] };
    }

    // Returns an error string if the name is invalid, or null if it is acceptable.
    validateConstantName(name, ownId) {
        if (name === 'i' || name === 'e') return `'${name}' is reserved`;
        for (const c of this.complexConstants) {
            if (c.id !== ownId && c.name === name) return `'${name}' is already used`;
        }
        return null;
    }

    // Returns a mathjs scope object containing all valid named constants except the one with excludeId.
    buildConstantScope(excludeId = null) {
        if (typeof math === 'undefined') return {};
        const scope = {};
        for (const c of this.complexConstants) {
            if (c.id !== excludeId && c.name && c.re !== null && c.im !== null) {
                scope[c.name] = math.complex(c.re, c.im);
            }
        }
        return scope;
    }

    // Re-evaluates every constant (except the one that just changed) using the updated scope.
    // Multiple passes resolve dependency chains regardless of definition order.
    cascadeEvaluate(triggererId) {
        const passes = this.complexConstants.length;
        for (let pass = 0; pass < passes; pass++) {
            for (const c of this.complexConstants) {
                if (c.id === triggererId) continue;
                const raw = c.latex.trim();
                if (!raw) continue;
                const scope      = this.buildConstantScope(c.id);
                const assignment = this.parseAssignment(raw);
                if (assignment && !this.validateConstantName(assignment.name, c.id)) {
                    const parsed = this.parseComplexFromLatex(assignment.valueLaTeX, scope);
                    c.re = parsed !== null ? parsed.re : null;
                    c.im = parsed !== null ? parsed.im : null;
                } else if (!assignment) {
                    const parsed = this.parseComplexFromLatex(raw, scope);
                    c.re = parsed !== null ? parsed.re : null;
                    c.im = parsed !== null ? parsed.im : null;
                }
            }
        }
    }

    parseComplexFromLatex(latex, scope = {}) {
        if (!latex || !latex.trim() || typeof math === 'undefined') return null;
        try {
            let e = latex.trim();
            // Resolve \frac{a}{b} iteratively to handle one level of nesting
            for (let p = 0; p < 4; p++) {
                e = e.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
            }
            // \sqrt{a} -> sqrt(a)
            for (let p = 0; p < 3; p++) {
                e = e.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
            }
            e = e.replace(/\^\s*\{([^{}]+)\}/g, '^($1)');         // ^{a} -> ^(a)
            e = e.replace(/\{([^{}]*)\}/g, '($1)');               // remaining {} grouping
            e = e.replace(/\\left\s*[(\[]/g, '(').replace(/\\right\s*[)\]]/g, ')');
            e = e.replace(/\\cdot|\\times/g, '*');
            e = e.replace(/\\pi/g, 'pi');
            e = e.replace(/\\cos/g, 'cos').replace(/\\sin/g, 'sin').replace(/\\tan/g, 'tan');
            e = e.replace(/\\ln\b/g, 'log').replace(/\\log\b/g, 'log10');
            e = e.replace(/\\exp\b/g, 'exp');
            e = e.replace(/\\sqrt\s*([0-9])/g, 'sqrt($1)');       // \sqrt2 → sqrt(2)
            e = e.replace(/\\sqrt\b/g, 'sqrt');
            e = e.replace(/\\imaginaryI|\\imath/g, 'i');
            e = e.replace(/\\[a-zA-Z]+\s*/g, '');                 // strip remaining LaTeX commands
            e = e.trim();
            if (!e) return null;
            // implicit multiply: 'i' immediately before a function (e.g. isqrt → i*sqrt)
            e = e.replace(/\bi\s*(sqrt|sin|cos|tan|log|log10|exp)\s*\(/g, 'i*$1(');
            // implicit multiply: closing paren before 'i' (e.g. sqrt(2)i → sqrt(2)*i)
            e = e.replace(/\)\s*i\b/g, ')*i');
            const result = math.evaluate(e, scope);
            if (typeof result === 'number') return { re: result, im: 0 };
            if (result && typeof result.re === 'number') return { re: result.re, im: result.im };
            return null;
        } catch { return null; }
    }

    toggleDisplayMode() {
        this.displayMode = this.displayMode === 'arrow' ? 'point' : 'arrow';
        const arrowIcon = document.querySelector('.mode-arrow-icon');
        const pointIcon = document.querySelector('.mode-point-icon');
        const label     = document.getElementById('display-mode-label');
        if (arrowIcon) arrowIcon.style.opacity = this.displayMode === 'arrow' ? '1' : '0.35';
        if (pointIcon) pointIcon.style.opacity = this.displayMode === 'point' ? '1' : '0.35';
        if (label)     label.textContent = this.displayMode === 'arrow' ? 'Arrow' : 'Point';
        if (this.currentState === this.states.APP) this.drawCanvas();
    }

    drawComplexConstants() {
        if (!this.complexConstants.length) return;
        const ctx     = this.ctx;
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const fSize       = this.sizeMode === 'xlarge' ? 22 : this.sizeMode === 'large' ? 18 : 15;
        const dotR        = this.sizeMode === 'xlarge' ? 7  : this.sizeMode === 'large' ? 6  : 5;
        const strokeWidth = this.sizeMode === 'xlarge' ? 4  : this.sizeMode === 'large' ? 3  : 2;
        const headLen     = this.sizeMode === 'xlarge' ? 13 : this.sizeMode === 'large' ? 11 : 9;

        for (const c of this.complexConstants) {
            if (!c.enabled || c.re === null || c.im === null) continue;
            if (!isFinite(c.re) || !isFinite(c.im)) continue;

            const pt  = this.worldToScreen(c.re, c.im);
            const org = this.worldToScreen(0, 0);

            if (this.displayMode === 'arrow') {
                const dx  = pt.x - org.x;
                const dy  = pt.y - org.y;
                const len = Math.hypot(dx, dy);
                if (len > dotR + 2) {
                    const ang  = Math.atan2(dy, dx);
                    const tipX = pt.x - dotR * Math.cos(ang);
                    const tipY = pt.y - dotR * Math.sin(ang);
                    ctx.save();
                    ctx.strokeStyle = c.color;
                    ctx.lineWidth   = strokeWidth;
                    ctx.globalAlpha = 0.9;
                    ctx.beginPath();
                    ctx.moveTo(org.x, org.y);
                    ctx.lineTo(tipX, tipY);
                    ctx.stroke();
                    ctx.fillStyle   = c.color;
                    ctx.beginPath();
                    ctx.moveTo(tipX, tipY);
                    ctx.lineTo(tipX - headLen * Math.cos(ang - 0.38), tipY - headLen * Math.sin(ang - 0.38));
                    ctx.lineTo(tipX - headLen * Math.cos(ang + 0.38), tipY - headLen * Math.sin(ang + 0.38));
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }
            }

            // Dot
            ctx.save();
            ctx.fillStyle   = c.color;
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = isLight ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.55)';
            ctx.lineWidth   = 1.5;
            ctx.stroke();
            ctx.restore();

            // Label: only draw if the constant has a user-assigned name
            if (c.name) {
                ctx.save();
                ctx.font        = `italic ${fSize}px Arial`;
                ctx.globalAlpha = 1;
                const tw = ctx.measureText(c.name).width;
                const lx = pt.x + dotR + 4;
                const ly = pt.y - dotR - 2;
                ctx.fillStyle = isLight ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.5)';
                ctx.fillRect(lx - 2, ly - fSize + 1, tw + 4, fSize + 3);
                ctx.fillStyle = c.color;
                ctx.fillText(c.name, lx, ly);
                ctx.restore();
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new Komplexiti();
});
