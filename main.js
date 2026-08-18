'use strict';

class Komplexiti {
    constructor() {
        // iOS PWA viewport fix must run first, before anything else
        this.fixIOSViewportBug();

        // Configure MathLive virtual keyboard globally (before any math fields are created)
        this.configureMathLive();

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
        this.hasInitializedViewport = false;

        // ---- UI preferences ----
        this.sizeMode = 'normal';   // 'normal' | 'large' | 'xlarge'

        // ---- Expressions ----
        this.expressions = [];
        this.nextExpressionId   = 1;
        this.expressionColors   = [
            '#0057FF', '#00C853', '#B91C1C',
            '#C026D3', '#1ABC9C', '#00E5FF', '#A855F7',
            '#FF6B6B', '#4A90E2', '#FFD400', '#84CC16', '#F39C12'
        ];
        this.displayMode = 'arrow'; // 'arrow' | 'point'
        this.activeInfoExpressionId = null;
        this.infoFormat = 'cartesian';

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

        // ---- Pan, Zoom & Viewport Transition inertia ----
        this.mousePanInertia = { active: false, velocityX: 0, velocityY: 0 };
        this.wheelZoom       = { active: false, targetScaleRatio: 1.0, cx: 0, cy: 0 };
        this.keyPanVelocity  = { vx: 0, vy: 0 };
        this.pressedKeys     = new Set();
        this.viewportAnimation = {
            active: false,
            fromCenterX: 0,
            fromCenterY: 0,
            fromScale: 1,
            toCenterX: 0,
            toCenterY: 0,
            toScale: 1,
            startTime: 0,
            duration: 350
        };

        // ---- Animation loop ----
        this.animationId   = null;
        this.lastFrameTime = 0;
        this.deltaTime     = 0;

        // ---- Virtual keyboard state ----
        this.virtualKeyboardDismissLockUntil = 0;
        this.keyboardDismissedByCanvas = false;
        this.virtualKeyboardShowBypass = false;
        this.virtualKeyboardShowGuardPatched = false;
        this.lastEditableMathField = null;
        this.mathLiveFocusSink = null;

        this.initElements();
        this.loadExpressions();
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
    // MathLive virtual keyboard configuration
    // -------------------------------------------------------------------------
    configureMathLive() {
        const setupKeyboard = () => {
            setTimeout(() => {
                if (window.mathVirtualKeyboard) {
                    try {
                        // Complex numbers keyboard layout
                        const complexLayout = {
                            label: '123',
                            labelClass: 'MLK__tex-math',
                            tooltip: 'Complex Numbers',
                            rows: [
                                [
                                    { latex: 'i', label: 'i' },
                                    { latex: '\\pi', label: 'π' },
                                    { latex: '=', label: '=' },
                                    { label: '[backspace]', width: 1 },
                                    '[separator]',
                                    { latex: '7', label: '7' },
                                    { latex: '8', label: '8' },
                                    { latex: '9', label: '9' },
                                    { insert: '\\frac{#@}{#?}', label: '/' }
                                ],
                                [
                                    { latex: '#@^2', label: 'x²' },
                                    { latex: '\\sqrt{#?}', label: '√' },
                                    {
                                        latex: '#@^{#?}',
                                        label: 'xⁿ',
                                        shift: { latex: '\\sqrt[#?]{#@}', label: 'ⁿ√' }
                                    },
                                    { latex: 'e', label: 'e' },
                                    '[separator]',
                                    { latex: '4', label: '4' },
                                    { latex: '5', label: '5' },
                                    { latex: '6', label: '6' },
                                    { latex: '\\cdot', label: '×' }
                                ],
                                [
                                    { latex: '(', label: '(' },
                                    { latex: ')', label: ')' },
                                    { latex: '\\left|#?\\right|', label: '|z|' },
                                    { latex: '\\overline{#?}', label: 'z̅' },
                                    '[separator]',
                                    { latex: '1', label: '1' },
                                    { latex: '2', label: '2' },
                                    { latex: '3', label: '3' },
                                    { latex: '+', label: '+' }
                                ],
                                [
                                    '[left]', '[right]',
                                    { latex: '(', label: '(' },
                                    { latex: ')', label: ')' },
                                    '[separator]',
                                    { latex: '0', label: '0' },
                                    {
                                        latex: '.',
                                        label: '.',
                                        shift: { latex: ',', label: ',' }
                                    },
                                    { label: '[shift]', width: 1 },
                                    { latex: '-', label: '-' }
                                ]
                            ]
                        };

                        const trigLayout = {
                            label: 'f(x)',
                            labelClass: 'MLK__tex-math',
                            tooltip: 'Trigonometric & Hyperbolic Functions',
                            rows: [
                                [
                                    { latex: 'i', label: 'i' },
                                    { latex: '\\pi', label: 'π' },
                                    { latex: '=', label: '=' },
                                    { label: '[backspace]', width: 1 },
                                    '[separator]',
                                    { latex: '7', label: '7' },
                                    { latex: '8', label: '8' },
                                    { latex: '9', label: '9' },
                                    { insert: '\\frac{#@}{#?}', label: '/' }
                                ],
                                [
                                    {
                                        insert: '\\sin(#?)', label: 'sin',
                                        shift: { insert: '\\arcsin(#?)', label: 'sin⁻¹', class: 'small' }
                                    },
                                    {
                                        insert: '\\cos(#?)', label: 'cos',
                                        shift: { insert: '\\arccos(#?)', label: 'cos⁻¹', class: 'small' }
                                    },
                                    {
                                        insert: '\\tan(#?)', label: 'tan',
                                        shift: { insert: '\\arctan(#?)', label: 'tan⁻¹', class: 'small' }
                                    },
                                    {
                                        insert: '\\ln(#?)', label: 'ln',
                                        shift: { insert: 'e^{#?}', label: 'eˣ' }
                                    },
                                    '[separator]',
                                    { latex: '4', label: '4' },
                                    { latex: '5', label: '5' },
                                    { latex: '6', label: '6' },
                                    { latex: '\\cdot', label: '×' }
                                ],
                                [
                                    {
                                        insert: '\\sinh(#?)', label: 'sinh', class: 'small',
                                        shift: { insert: '\\operatorname{arcsinh}(#?)', label: 'sinh⁻¹', class: 'small' }
                                    },
                                    {
                                        insert: '\\cosh(#?)', label: 'cosh', class: 'small',
                                        shift: { insert: '\\operatorname{arccosh}(#?)', label: 'cosh⁻¹', class: 'small' }
                                    },
                                    {
                                        insert: '\\tanh(#?)', label: 'tanh', class: 'small',
                                        shift: { insert: '\\operatorname{arctanh}(#?)', label: 'tanh⁻¹', class: 'small' }
                                    },
                                    {
                                        insert: '\\log(#?)', label: 'log',
                                        shift: { insert: '10^{#?}', label: '10ˣ' }
                                    },
                                    '[separator]',
                                    { latex: '1', label: '1' },
                                    { latex: '2', label: '2' },
                                    { latex: '3', label: '3' },
                                    { latex: '+', label: '+' }
                                ],
                                [
                                    '[left]', '[right]',
                                    { latex: '(', label: '(' },
                                    { latex: ')', label: ')' },
                                    '[separator]',
                                    { latex: '0', label: '0' },
                                    {
                                        latex: '.',
                                        label: '.',
                                        shift: { latex: ',', label: ',' }
                                    },
                                    { label: '[shift]', width: 1 },
                                    { latex: '-', label: '-' }
                                ]
                            ]
                        };

                        const abcLayout = {
                            label: 'abc',
                            labelClass: 'MLK__tex-math',
                            tooltip: 'Variables & Constants',
                            rows: [
                                [
                                    { latex: 'q', label: 'q', shift: { latex: 'Q', label: 'Q' } },
                                    { latex: 'w', label: 'w', shift: { latex: 'W', label: 'W' } },
                                    { latex: 'e', label: 'e', shift: { latex: 'E', label: 'E' } },
                                    { latex: 'r', label: 'r', shift: { latex: 'R', label: 'R' } },
                                    { latex: 't', label: 't', shift: { latex: 'T', label: 'T' } },
                                    { latex: 'y', label: 'y', shift: { latex: 'Y', label: 'Y' } },
                                    { latex: 'u', label: 'u', shift: { latex: 'U', label: 'U' } },
                                    { latex: 'i', label: 'i', shift: { latex: 'I', label: 'I' } },
                                    { latex: 'o', label: 'o', shift: { latex: 'O', label: 'O' } },
                                    { latex: 'p', label: 'p', shift: { latex: 'P', label: 'P' } }
                                ],
                                [
                                    { latex: 'a', label: 'a', shift: { latex: 'A', label: 'A' } },
                                    { latex: 's', label: 's', shift: { latex: 'S', label: 'S' } },
                                    { latex: 'd', label: 'd', shift: { latex: 'D', label: 'D' } },
                                    { latex: 'f', label: 'f', shift: { latex: 'F', label: 'F' } },
                                    { latex: 'g', label: 'g', shift: { latex: 'G', label: 'G' } },
                                    { latex: 'h', label: 'h', shift: { latex: 'H', label: 'H' } },
                                    { latex: 'j', label: 'j', shift: { latex: 'J', label: 'J' } },
                                    { latex: 'k', label: 'k', shift: { latex: 'K', label: 'K' } },
                                    { latex: 'l', label: 'l', shift: { latex: 'L', label: 'L' } },
                                    { label: '[backspace]', width: 1 }
                                ],
                                [
                                    { label: '[shift]', width: 1 },
                                    { latex: 'z', label: 'z', shift: { latex: 'Z', label: 'Z' } },
                                    { latex: 'x', label: 'x', shift: { latex: 'X', label: 'X' } },
                                    { latex: 'c', label: 'c', shift: { latex: 'C', label: 'C' } },
                                    { latex: 'v', label: 'v', shift: { latex: 'V', label: 'V' } },
                                    { latex: 'b', label: 'b', shift: { latex: 'B', label: 'B' } },
                                    { latex: 'n', label: 'n', shift: { latex: 'N', label: 'N' } },
                                    { latex: 'm', label: 'm', shift: { latex: 'M', label: 'M' } },
                                    { latex: '=', label: '=' },
                                    { latex: '+', label: '+' }
                                ],
                                [
                                    '[left]', '[right]',
                                    { latex: '(', label: '(' },
                                    { latex: ')', label: ')' },
                                    '[separator]',
                                    { latex: 'z', label: 'z', shift: { latex: 'Z', label: 'Z' } },
                                    { latex: 'w', label: 'w', shift: { latex: 'W', label: 'W' } },
                                    { latex: '\\theta', label: 'θ', shift: { latex: '\\phi', label: 'φ' } },
                                    { latex: '-', label: '-' }
                                ]
                            ]
                        };

                        window.mathVirtualKeyboard.layouts = [complexLayout, trigLayout, abcLayout];

                        // Mobile-specific setup
                        const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
                        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || isIPadOS;

                        if (isMobile) {
                            window.mathVirtualKeyboard.container = document.body;

                            // Close keyboard on orientation change to prevent layout corruption
                            let lastOrientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
                            const closeOnOrientationChange = () => {
                                setTimeout(() => {
                                    const curr = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
                                    if (curr !== lastOrientation) {
                                        lastOrientation = curr;
                                        if (window.mathVirtualKeyboard?.visible) {
                                            window.mathVirtualKeyboard.hide();
                                            const focused = document.querySelector('math-field:focus');
                                            if (focused) focused.blur();
                                        }
                                        document.querySelectorAll('.MLK__backdrop').forEach(el => el.parentNode?.removeChild(el));
                                    }
                                }, 100);
                            };
                            window.addEventListener('orientationchange', closeOnOrientationChange);
                            window.addEventListener('resize', closeOnOrientationChange);
                            if (screen.orientation) {
                                screen.orientation.addEventListener('change', closeOnOrientationChange);
                            }

                            // iOS shift-latch fix: suppress the synthetic mouseup Safari fires
                            // after a touch pointerup on the shift key, which would reset MathLive's
                            // internal shiftPressCount before the latch could register.
                            let suppressShiftMouseUpUntil = 0;
                            const isShiftTarget = (e) => {
                                if (!e || typeof e.composedPath !== 'function') return false;
                                return e.composedPath().some(n => n?.classList?.contains('shift'));
                            };
                            window.addEventListener('pointerdown', (e) => {
                                if (!window.mathVirtualKeyboard?.visible) return;
                                if (e.pointerType === 'touch' && isShiftTarget(e)) {
                                    suppressShiftMouseUpUntil = Date.now() + 700;
                                }
                            }, { capture: true });
                            window.addEventListener('mouseup', (e) => {
                                if (!window.mathVirtualKeyboard?.visible) return;
                                if (isShiftTarget(e) || Date.now() <= suppressShiftMouseUpUntil) {
                                    e.stopImmediatePropagation();
                                }
                            }, { capture: true });
                        }

                        // Apply dark colour scheme and suppress context menus on all current fields
                        setTimeout(() => {
                            document.querySelectorAll('math-field').forEach(f => {
                                f.setAttribute('color-scheme', 'dark');
                                f.menuItems = [];
                            });
                        }, 100);

                    } catch (err) {
                        console.error('Error configuring virtual keyboard:', err);
                    }
                } else {
                    setTimeout(setupKeyboard, 500);
                }
            }, 100);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupKeyboard);
        } else {
            setupKeyboard();
        }

        // Suppress context menus on every math field as it mounts
        document.addEventListener('mount', (e) => {
            if (e.target?.tagName === 'MATH-FIELD') {
                e.target.menuItems = [];
            }
        }, true);

        document.addEventListener('contextmenu', (e) => {
            if (e.composedPath().some(el => el.tagName === 'MATH-FIELD')) {
                e.preventDefault();
            }
        });
    }

    // -------------------------------------------------------------------------
    // Clear all MathLive focus state (prevents keyboard auto-reopening)
    // -------------------------------------------------------------------------
    clearMathLiveFocusState() {
        document.querySelectorAll('math-field').forEach(mf => {
            try { mf.blur(); } catch { /* ignore */ }
        });
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            try { document.activeElement.blur(); } catch { /* ignore */ }
        }
        if (window.MathfieldElement?.activeMathfield) {
            try { window.MathfieldElement.activeMathfield.blur(); } catch { /* ignore */ }
        }
        if (window.mathVirtualKeyboard && 'target' in window.mathVirtualKeyboard) {
            try { window.mathVirtualKeyboard.target = null; } catch { /* ignore */ }
        }
        // Transfer focus to an inert sink button so touch browsers do not reopen the keyboard
        if (!this.mathLiveFocusSink || !document.contains(this.mathLiveFocusSink)) {
            const sink = document.createElement('button');
            sink.type = 'button';
            sink.tabIndex = -1;
            sink.setAttribute('aria-hidden', 'true');
            sink.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:-10000px;top:-10000px;width:1px;height:1px;';
            document.body.appendChild(sink);
            this.mathLiveFocusSink = sink;
        }
        try { this.mathLiveFocusSink.focus({ preventScroll: true }); } catch { /* ignore */ }
        try {
            const sel = window.getSelection();
            if (sel) sel.removeAllRanges();
        } catch { /* ignore */ }
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
        this.helpBtn            = document.getElementById('help-button');
        this.shortcutsOverlay   = document.getElementById('shortcuts-overlay');
        this.shortcutsCloseBtn  = document.getElementById('shortcuts-close-btn');
        this.appContainer       = document.getElementById('app-container');
        this.expressionsContainer = document.getElementById('expressions-container');
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
        // Monkeypatch mathVirtualKeyboard.show to enforce the dismiss lock.
        // This prevents MathLive's internal focus recovery from re-opening the
        // keyboard immediately after a canvas tap closes it.
        const ensureVirtualKeyboardShowGuard = () => {
            if (!window.mathVirtualKeyboard || this.virtualKeyboardShowGuardPatched) return;
            if (typeof window.mathVirtualKeyboard.show !== 'function') return;
            const originalShow = window.mathVirtualKeyboard.show.bind(window.mathVirtualKeyboard);
            window.mathVirtualKeyboard.show = (options) => {
                if (Date.now() <= this.virtualKeyboardDismissLockUntil && !this.virtualKeyboardShowBypass) return;
                return originalShow(options);
            };
            this.virtualKeyboardShowGuardPatched = true;
        };
        ensureVirtualKeyboardShowGuard();
        setTimeout(ensureVirtualKeyboardShowGuard, 200);
        setTimeout(ensureVirtualKeyboardShowGuard, 800);

        this.hamburgerBtn.addEventListener('click', () => this.togglePanel());

        // Close panel on overlay click/tap (touchstart for iOS responsiveness)
        this.mobileOverlay.addEventListener('click', () => this.closePanel());
        this.mobileOverlay.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.closePanel();
        }, { passive: false });

        // Close panel when tapping the canvas on narrow screens;
        // also dismiss keyboard for mouse/pen interactions (touch is handled in touchend).
        this.canvas.addEventListener('pointerdown', (e) => {
            if (this.isNarrow() && this.panelOpen) this.closePanel();
            if (e.pointerType !== 'touch' && window.mathVirtualKeyboard?.visible) {
                this.keyboardDismissedByCanvas = true;
                this.virtualKeyboardDismissLockUntil = Date.now() + 350;
                this.clearMathLiveFocusState();
                window.mathVirtualKeyboard.hide();
            }
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
            else this.clearPressedKeys();
        });
        window.addEventListener('focus', reopenPanelIfClosed);
        window.addEventListener('blur', () => this.clearPressedKeys());
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // Dismiss add-dropdown when clicking outside it
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('add-dropdown');
            if (!dropdown || !dropdown.classList.contains('show')) return;
            if (!dropdown.contains(e.target) && !e.target.closest('#add-dropdown-toggle')) {
                dropdown.classList.remove('show');
            }
        });

        // Panel control buttons
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) themeToggle.addEventListener('click', () => this.toggleTheme());
        const sizeModeToggle = document.getElementById('size-mode-toggle');
        if (sizeModeToggle) sizeModeToggle.addEventListener('click', () => this.toggleSizeMode());

        // Help modal button and close triggers
        if (this.helpBtn) {
            this.helpBtn.addEventListener('click', () => this.showHelpModal());
        }
        if (this.shortcutsCloseBtn) {
            this.shortcutsCloseBtn.addEventListener('click', () => this.hideHelpModal());
        }
        if (this.shortcutsOverlay) {
            this.shortcutsOverlay.addEventListener('click', (e) => {
                if (e.target === this.shortcutsOverlay) {
                    this.hideHelpModal();
                }
            });
        }

        // Virtual keyboard toggle button
        const virtualKeyboardToggle = document.getElementById('virtual-keyboard-toggle');
        if (virtualKeyboardToggle) {
            virtualKeyboardToggle.addEventListener('click', () => {
                if (!window.mathVirtualKeyboard) return;
                if (window.mathVirtualKeyboard.visible) {
                    window.mathVirtualKeyboard.hide({ animate: true });
                } else {
                    // Bypass any residual dismiss lock - this is an explicit user action
                    this.virtualKeyboardDismissLockUntil = 0;
                    this.keyboardDismissedByCanvas = false;

                    // Prefer the field the user last typed in; fall back to the first field
                    const activeMathField = document.activeElement?.matches('math-field')
                        ? document.activeElement : null;
                    const lastField = this.lastEditableMathField && document.contains(this.lastEditableMathField)
                        ? this.lastEditableMathField : null;
                    const focusedField = activeMathField || lastField || document.querySelector('math-field');

                    if (focusedField) {
                        focusedField.focus();
                        if ('target' in window.mathVirtualKeyboard) {
                            try { window.mathVirtualKeyboard.target = focusedField; } catch { /* ignore */ }
                        }
                    }
                    this.virtualKeyboardShowBypass = true;
                    try {
                        window.mathVirtualKeyboard.show({ animate: true });
                    } finally {
                        setTimeout(() => { this.virtualKeyboardShowBypass = false; }, 0);
                    }
                }
            });
        }

        const addExpressionBtn = document.getElementById('add-expression-btn');
        if (addExpressionBtn) addExpressionBtn.addEventListener('click', () => this.addExpression());

        // Add dropdown toggle and items
        const addDropdownToggle = document.getElementById('add-dropdown-toggle');
        if (addDropdownToggle) addDropdownToggle.addEventListener('click', (e) => this.toggleAddDropdown(e));

        const addDropdown = document.getElementById('add-dropdown');
        if (addDropdown) {
            addDropdown.addEventListener('click', (e) => {
                const item = e.target.closest('[data-action], [data-demo-set]');
                if (!item) return;
                addDropdown.classList.remove('show');
                const action = item.dataset.action;
                const demoSet = item.dataset.demoSet;
                if (action === 'blank') {
                    this.addExpression();
                } else if (action === 'clear-all') {
                    this.clearAllExpressions();
                } else if (demoSet) {
                    this.loadDemoSet(demoSet);
                }
            });
        }

        const resetAxesBtn = document.getElementById('reset-axes');
        if (resetAxesBtn) resetAxesBtn.addEventListener('click', () => this.resetAxes());

        const displayModeToggle = document.getElementById('display-mode-toggle');
        if (displayModeToggle) displayModeToggle.addEventListener('click', () => this.toggleDisplayMode());

        const closeInfoBtn = document.getElementById('close-complex-info-btn');
        if (closeInfoBtn) closeInfoBtn.addEventListener('click', () => {
            const panel = document.getElementById('complex-info-panel');
            if (panel) panel.style.display = 'none';
            this.activeInfoExpressionId = null;
        });

        document.querySelectorAll('.complex-info-fmt-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.infoFormat = btn.dataset.fmt;
                document.querySelectorAll('.complex-info-fmt-btn').forEach(b =>
                    b.classList.toggle('active', b.dataset.fmt === this.infoFormat)
                );
                this.updateComplexInfoPanel();
            });
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
        // Protect fields and clear focus state; remove protection after slide animation
        document.querySelectorAll('math-field').forEach(mf => mf.setAttribute('data-blur-protected', 'true'));
        this.clearMathLiveFocusState();
        if (window.mathVirtualKeyboard?.visible) {
            window.mathVirtualKeyboard.hide();
        }
        this.lastEditableMathField = null;
        setTimeout(() => {
            document.querySelectorAll('math-field').forEach(mf => mf.removeAttribute('data-blur-protected'));
        }, 500);
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
        this.hideHelpModal();

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
        const rect = this.appContainer.getBoundingClientRect();
        const w = Math.ceil(rect.width);
        const h = Math.ceil(rect.height);
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        if ((!this.hasInitializedViewport || this.currentState === this.states.TITLE) && h > 0) {
            this.viewport.scale = h / 10;
            this.viewport.centerX = 0;
            this.viewport.centerY = 0;
            this.hasInitializedViewport = true;
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
        this.drawExpressions();
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
    async registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        try {
            const registration = await navigator.serviceWorker.register('./sw.js');
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        newWorker.postMessage({ type: 'SKIP_WAITING' });
                        setTimeout(() => window.location.reload(), 1000);
                    }
                });
            });
        } catch (err) {
            console.warn('Service worker registration failed:', err);
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

    getVisibleWorldBounds() {
        return {
            minX: this.viewport.minX,
            maxX: this.viewport.maxX,
            minY: this.viewport.minY,
            maxY: this.viewport.maxY
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

    // 4 significant figures for compact card display
    formatNumberShort(n) {
        if (Math.abs(n) < 1e-10) return '0';
        const abs = Math.abs(n);
        if (abs >= 1e4 || (abs < 1e-3 && abs > 0)) return parseFloat(n.toPrecision(4)).toExponential(3);
        return parseFloat(n.toPrecision(4)).toString();
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

        const font = this.sizeMode === 'xlarge' ? 'bold 24px Arial'
                   : this.sizeMode === 'large'  ? 'bold 20px Arial'
                   : 'bold 16px Arial';
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
        const titleFont  = this.sizeMode === 'xlarge' ? 'bold 22px Arial'
                         : this.sizeMode === 'large'  ? 'bold 18px Arial'
                         : 'bold 14px Arial';
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
            if (window.mathVirtualKeyboard?.visible) {
                // preventDefault stops iOS generating synthetic focus/click events.
                // stopPropagation prevents any MathLive global touchend listener.
                e.preventDefault();
                e.stopPropagation();
                this.keyboardDismissedByCanvas = true;
                this.virtualKeyboardDismissLockUntil = Date.now() + 700;
                // Protect every field: if iOS asynchronously restores focus after this
                // handler returns, focusin will immediately re-blur it.
                document.querySelectorAll('math-field').forEach(mf =>
                    mf.setAttribute('data-blur-protected', 'true'));
                this.clearMathLiveFocusState();
                window.mathVirtualKeyboard.hide();
                [80, 200, 380].forEach(ms => setTimeout(() => {
                    if (window.mathVirtualKeyboard?.visible && Date.now() <= this.virtualKeyboardDismissLockUntil) {
                        window.mathVirtualKeyboard.hide();
                    }
                }, ms));
                // Remove protection after the iOS focus-restoration window has closed
                setTimeout(() => {
                    document.querySelectorAll('math-field').forEach(mf =>
                        mf.removeAttribute('data-blur-protected'));
                }, 750);
            }
            this.handleTouchEnd(e);
        }, { passive: false }); // non-passive so e.preventDefault() is available
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
        this.stopWheelZoom();
        this.stopViewportAnimation();
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
    // Wheel zoom (towards cursor) & Smooth zoom
    // =========================================================================

    handleWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const cx   = e.clientX - rect.left;
        const cy   = e.clientY - rect.top;

        // Normalise wheel delta across different browsers and devices (mice, trackpads)
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 20;       // DOM_DELTA_LINE
        else if (e.deltaMode === 2) delta *= 400; // DOM_DELTA_PAGE

        // For a typical mouse wheel notch (~100px), factor is ~1.15 / (1/1.15)
        const factor = Math.pow(1.15, Math.max(-3, Math.min(3, delta / 100)));
        this.startSmoothZoom(factor, cx, cy);
    }

    startSmoothZoom(factor, cx, cy) {
        if (!isFinite(factor) || factor <= 0) return;
        this.stopViewportAnimation();
        const currentXRange = this.viewport.maxX - this.viewport.minX;

        // If already actively zooming, chain onto current target
        if (this.wheelZoom.active) {
            this.wheelZoom.targetScaleRatio *= factor;
        } else {
            this.wheelZoom.active = true;
            this.wheelZoom.targetScaleRatio = factor;
        }
        this.wheelZoom.cx = cx;
        this.wheelZoom.cy = cy;

        // Clamp target range to avoid over-zooming beyond boundaries
        const projectedRange = currentXRange * this.wheelZoom.targetScaleRatio;
        if (projectedRange < 0.0005) {
            this.wheelZoom.targetScaleRatio = 0.0005 / currentXRange;
        } else if (projectedRange > 1e9) {
            this.wheelZoom.targetScaleRatio = 1e9 / currentXRange;
        }

        if (Math.abs(Math.log(this.wheelZoom.targetScaleRatio)) < 0.001) {
            this.stopWheelZoom();
            return;
        }

        this.ensureAnimationLoopRunning();
    }

    stopWheelZoom() {
        this.wheelZoom.active = false;
        this.wheelZoom.targetScaleRatio = 1.0;
    }

    zoomAtScreenPoint(factor, cx, cy, redraw = true) {
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
        if (redraw) this.drawCanvas();
    }

    zoomIn()  { this.startSmoothZoom(1 / 1.2, this.viewport.width / 2, this.viewport.height / 2); }
    zoomOut() { this.startSmoothZoom(1.2,     this.viewport.width / 2, this.viewport.height / 2); }

    // =========================================================================
    // Keyboard
    // =========================================================================

    clearPressedKeys() {
        this.pressedKeys.clear();
    }

    handleKeyUp(e) {
        if (this.pressedKeys.has(e.key)) {
            this.pressedKeys.delete(e.key);
        }
    }

    handleKeyboard(e) {
        // Close dropdown or help modal on Escape
        if (e.key === 'Escape') {
            if (e.repeat) return;
            const dropdown = document.getElementById('add-dropdown');
            if (dropdown?.classList.contains('show')) {
                dropdown.classList.remove('show');
                return;
            }
            if (this.shortcutsOverlay?.classList.contains('show')) {
                this.hideHelpModal();
                return;
            }
            this.returnToTitle();
            return;
        }

        // Open help modal on ? or / when no input is active
        if ((e.key === '?' || e.key === '/') && !this.shortcutsOverlay?.classList.contains('show')) {
            const active = document.activeElement;
            const isEditing = active && (
                active.tagName === 'INPUT' ||
                active.tagName === 'TEXTAREA' ||
                active.isContentEditable ||
                active.tagName === 'MATH-FIELD'
            );
            if (!isEditing && this.currentState === this.states.APP) {
                e.preventDefault();
                this.showHelpModal();
                return;
            }
        }

        // Suppress other key handling while a text / math input is focused
        const active = document.activeElement;
        if (active && (
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.isContentEditable ||
            active.tagName === 'MATH-FIELD'
        )) return;

        if (e.key === ' ' && this.currentState === this.states.TITLE) {
            e.preventDefault();
            this.launchApp();
            return;
        }
        if (this.currentState !== this.states.APP) return;

        switch (e.key) {
            case '=': case '+': e.preventDefault(); this.zoomIn(); break;
            case '-': case '_': e.preventDefault(); this.zoomOut(); break;
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'ArrowUp':
            case 'ArrowDown':
                e.preventDefault();
                this.stopViewportAnimation();
                this.pressedKeys.add(e.key);
                this.ensureAnimationLoopRunning();
                break;
        }
    }

    panBy(dxFraction, dyFraction) {
        this.stopViewportAnimation();
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
            this.stopWheelZoom();
            this.stopViewportAnimation();
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
    // Viewport transition animation
    // =========================================================================

    animateViewportTo(targetCenterX, targetCenterY, targetScale, duration = 350) {
        this.stopMousePanInertia();
        this.stopWheelZoom();

        if (Math.abs(this.viewport.centerX - targetCenterX) < 1e-6 &&
            Math.abs(this.viewport.centerY - targetCenterY) < 1e-6 &&
            Math.abs(this.viewport.scale - targetScale) < 1e-6) {
            return;
        }

        this.viewportAnimation = {
            active: true,
            fromCenterX: this.viewport.centerX,
            fromCenterY: this.viewport.centerY,
            fromScale: this.viewport.scale,
            toCenterX: targetCenterX,
            toCenterY: targetCenterY,
            toScale: targetScale,
            startTime: performance.now(),
            duration
        };
        this.ensureAnimationLoopRunning();
    }

    stopViewportAnimation() {
        this.viewportAnimation.active = false;
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
        this.stopWheelZoom();
        this.stopViewportAnimation();
        this.keyPanVelocity = { vx: 0, vy: 0 };
    }

    animationTick(timestamp) {
        this.animationId  = null;
        this.deltaTime    = Math.min(timestamp - this.lastFrameTime, 100);
        this.lastFrameTime = timestamp;

        let needsRedraw = false;
        let keepAnimating = false;

        // Smooth arrow key panning with acceleration and inertia decay
        let dirX = 0;
        let dirY = 0;
        if (this.pressedKeys.has('ArrowLeft'))  dirX -= 1;
        if (this.pressedKeys.has('ArrowRight')) dirX += 1;
        if (this.pressedKeys.has('ArrowUp'))    dirY += 1;
        if (this.pressedKeys.has('ArrowDown'))  dirY -= 1;

        const xRange = this.viewport.maxX - this.viewport.minX;
        const yRange = this.viewport.maxY - this.viewport.minY;
        // Move at ~0.9 viewport width/height per second
        const targetSpeedX = dirX * (xRange * 0.9 / 1000);
        const targetSpeedY = dirY * (yRange * 0.9 / 1000);

        const isHoldingKeys = dirX !== 0 || dirY !== 0;
        const timeConstant = isHoldingKeys ? 60 : 120;
        const blend = 1 - Math.exp(-this.deltaTime / timeConstant);

        this.keyPanVelocity.vx += (targetSpeedX - this.keyPanVelocity.vx) * blend;
        this.keyPanVelocity.vy += (targetSpeedY - this.keyPanVelocity.vy) * blend;

        const keySpeed = Math.hypot(this.keyPanVelocity.vx, this.keyPanVelocity.vy);
        if (keySpeed > 1e-6) {
            const worldDX = this.keyPanVelocity.vx * this.deltaTime;
            const worldDY = this.keyPanVelocity.vy * this.deltaTime;
            this.viewport.minX   += worldDX; this.viewport.maxX   += worldDX;
            this.viewport.minY   += worldDY; this.viewport.maxY   += worldDY;
            this.viewport.centerX = (this.viewport.minX + this.viewport.maxX) / 2;
            this.viewport.centerY = (this.viewport.minY + this.viewport.maxY) / 2;
            needsRedraw = true;
            keepAnimating = true;
        } else if (!isHoldingKeys) {
            this.keyPanVelocity.vx = 0;
            this.keyPanVelocity.vy = 0;
        }

        if (this.viewportAnimation.active) {
            const elapsed = timestamp - this.viewportAnimation.startTime;
            const progress = Math.min(Math.max(elapsed / this.viewportAnimation.duration, 0), 1);
            // Ease-out cubic for responsive deceleration
            const p = 1 - Math.pow(1 - progress, 3);

            this.viewport.centerX = this.viewportAnimation.fromCenterX + (this.viewportAnimation.toCenterX - this.viewportAnimation.fromCenterX) * p;
            this.viewport.centerY = this.viewportAnimation.fromCenterY + (this.viewportAnimation.toCenterY - this.viewportAnimation.fromCenterY) * p;

            const fromLog = Math.log(Math.max(this.viewportAnimation.fromScale, 1e-6));
            const toLog   = Math.log(Math.max(this.viewportAnimation.toScale, 1e-6));
            this.viewport.scale = Math.exp(fromLog + (toLog - fromLog) * p);

            this.updateViewport();
            needsRedraw = true;

            if (progress >= 1) {
                this.stopViewportAnimation();
            } else {
                keepAnimating = true;
            }
        }

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
                needsRedraw = true;
                keepAnimating = true;
            } else {
                this.stopMousePanInertia();
            }
        }

        if (this.wheelZoom.active) {
            const currentLog = Math.log(this.wheelZoom.targetScaleRatio);
            if (Math.abs(currentLog) < 0.001) {
                if (Math.abs(this.wheelZoom.targetScaleRatio - 1.0) > 1e-6) {
                    this.zoomAtScreenPoint(this.wheelZoom.targetScaleRatio, this.wheelZoom.cx, this.wheelZoom.cy, false);
                    needsRedraw = true;
                }
                this.stopWheelZoom();
            } else {
                // Smooth exponential easing with ~90ms time constant
                const fraction = 1 - Math.exp(-this.deltaTime / 90);
                const applyLog = currentLog * fraction;
                const stepFactor = Math.exp(applyLog);
                this.zoomAtScreenPoint(stepFactor, this.wheelZoom.cx, this.wheelZoom.cy, false);
                this.wheelZoom.targetScaleRatio = Math.exp(currentLog - applyLog);
                needsRedraw = true;
                keepAnimating = true;
            }
        }

        if (needsRedraw && this.currentState === this.states.APP) {
            this.drawCanvas();
        }

        if (keepAnimating) {
            this.animationId = requestAnimationFrame((t) => this.animationTick(t));
        }
    }

    // =========================================================================
    // Help modal
    // =========================================================================

    showHelpModal() {
        if (!this.shortcutsOverlay) return;
        this.shortcutsOverlay.classList.add('show');
    }

    hideHelpModal() {
        if (!this.shortcutsOverlay) return;
        this.shortcutsOverlay.classList.remove('show');
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
        const infoPanel = document.getElementById('complex-info-panel');
        if (infoPanel) {
            infoPanel.classList.remove('size-large', 'size-xlarge');
            if (this.sizeMode === 'large')  infoPanel.classList.add('size-large');
            if (this.sizeMode === 'xlarge') infoPanel.classList.add('size-xlarge');
        }
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
    // Expressions
    // =========================================================================

    addExpression({ skipFocus = false } = {}) {
        const id = this.nextExpressionId++;
        let color;
        if (this.expressions.length === 0) {
            color = this.expressionColors[0];
        } else {
            const prevColor = this.expressions[this.expressions.length - 1].color;
            const prevIdx   = this.expressionColors.indexOf(prevColor);
            color = this.expressionColors[(prevIdx + 1) % this.expressionColors.length];
        }
        const c = { id, color, enabled: true, latex: '', name: null, re: null, im: null, type: 'value', roots: null, equationVar: null, locus: null, hasParseError: false };
        this.expressions.push(c);
        this.createExpressionUI(c, { skipFocus });
        this.saveExpressions();
    }

    createExpressionUI(c, { skipFocus = false } = {}) {
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
                    <button class="expr-remove-btn" title="Delete" aria-label="Delete expression">
                        <svg viewBox="0 0 16 16"><path d="M4 4L12 12M12 4L4 12"/></svg>
                    </button>
                    <div class="expr-color-dot" style="background:${c.color};opacity:${c.enabled ? 1 : 0.3}" title="Toggle visibility"></div>
                </div>
            </div>
            <div class="expr-name-error"></div>
            <div class="shape-info-container">
                <div class="metadata-title-row">
                    <span class="metadata-visibility-placeholder" aria-hidden="true"></span>
                    <div class="shape-info-title"></div>
                </div>
                <div class="shape-info-value"></div>
                <div class="expr-card-roots"></div>
            </div>
            <div class="foci-info-container">
                <div class="metadata-title-row">
                    <button class="metadata-visibility-toggle foci-visibility-toggle" aria-label="Toggle foci" title="Toggle foci" tabindex="-1"></button>
                    <div class="foci-info-title">Foci</div>
                </div>
                <div class="foci-equation-list"></div>
            </div>`;

        const mathField = card.querySelector('math-field');
        const dot       = card.querySelector('.expr-color-dot');
        const removeBtn = card.querySelector('.expr-remove-btn');
        const metaBadge = card.querySelector('.shape-info-title');

        // Cycle root display format on badge click
        metaBadge.addEventListener('click', () => {
            if (c.type !== 'equation') return;
            const fmts = ['cartesian', 'exponential', 'trig'];
            c.cardRootFmt = fmts[(fmts.indexOf(c.cardRootFmt || 'cartesian') + 1) % fmts.length];
            this.updateCardMetadata(c);
        });

        mathField.addEventListener('input', () => {
            c.latex = mathField.value;
            const raw = c.latex.trim();
            const assignment = raw ? this.parseAssignment(raw) : null;
            let hasError = false;

            // Reset any previous equation state before re-evaluating
            c.type = 'value';
            c.roots = null;
            c.equationVar = null;
            c.locus = null;

            if (assignment) {
                const reserved = (assignment.name === 'i' || assignment.name === 'e');
                if (reserved) {
                    c.name = null;
                    c.re   = null;
                    c.im   = null;
                    hasError = true;
                    c.errorMessage = `'${assignment.name}' is a reserved name`;
                } else {
                    c.name = assignment.name; // keep name even if duplicate; _refreshDuplicateNameErrors handles it
                    const parsed = this.parseComplexFromLatex(assignment.valueLaTeX, this.buildExpressionScope(c.id));
                    c.re = parsed !== null ? parsed.re : null;
                    c.im = parsed !== null ? parsed.im : null;
                    hasError = parsed === null;
                    c.errorMessage = hasError ? 'Cannot evaluate expression' : '';
                }
            } else if (raw.includes('=')) {
                // Not a simple name=value assignment — try to solve as an equation
                c.name = null;
                c.re   = null;
                c.im   = null;
                const eq = this.parseEquation(raw, c.id);
                if (eq) {
                    c.type = eq.type;
                    c.roots = eq.roots ?? null;
                    c.equationVar = eq.variable;
                    c.locus = eq.locus ?? null;
                    c._locusCache = null;
                    c.errorMessage = '';
                } else {
                    hasError = true;
                    c.locus = null;
                    c._locusCache = null;
                    c.errorMessage = 'Needs exactly one undefined variable';
                }
            } else {
                c.name = null;
                const parsed = this.parseComplexFromLatex(raw, this.buildExpressionScope(c.id));
                c.re = parsed !== null ? parsed.re : null;
                c.im = parsed !== null ? parsed.im : null;
                hasError = raw.length > 0 && parsed === null;
                c.errorMessage = hasError ? 'Cannot evaluate expression' : '';
            }

            c.hasParseError = hasError;
            this.cascadeEvaluate(c.id);
            this._refreshDuplicateNameErrors();
            this.updateAllCardMetadata();
            this.saveExpressions();
            if (this.currentState === this.states.APP) this.drawCanvas();
        });

        removeBtn.addEventListener('click', () => this.removeExpression(c.id));

        const fociToggleBtn = card.querySelector('.foci-visibility-toggle');
        fociToggleBtn.addEventListener('click', () => {
            c.showFoci = (c.showFoci !== false) ? false : true;
            this.updateCardMetadata(c);
            if (this.currentState === this.states.APP) this.drawCanvas();
        });

        dot.addEventListener('click', () => {
            c.enabled = !c.enabled;
            dot.style.opacity      = c.enabled ? '1' : '0.3';
            mathField.style.opacity = c.enabled ? '1' : '0.4';
            this.updateCardMetadata(c);
            this.saveExpressions();
            if (this.currentState === this.states.APP) this.drawCanvas();
        });

        // ------ Touch-device virtual keyboard handling ------
        // On touch devices, tapping a math field should show the keyboard;
        // tapping elsewhere (canvas) should hide it and keep it hidden until
        // the user explicitly taps a field again.

        const markKeyboardReopenAllowed = () => {
            this.keyboardDismissedByCanvas = false;
            this.virtualKeyboardDismissLockUntil = 0;
            mathField.removeAttribute('data-blur-protected');
        };

        const tryShowKeyboardForField = () => {
            const isTouchLike = navigator.maxTouchPoints > 0 ||
                window.matchMedia('(hover: none), (pointer: coarse)').matches;
            if (!isTouchLike) return;
            if (this.keyboardDismissedByCanvas) return;
            if (Date.now() <= this.virtualKeyboardDismissLockUntil) return;
            if (!window.mathVirtualKeyboard || window.mathVirtualKeyboard.visible) return;

            if ('target' in window.mathVirtualKeyboard) {
                try { window.mathVirtualKeyboard.target = mathField; } catch { /* ignore */ }
            }
            setTimeout(() => {
                if (mathField.hasFocus() && !this.keyboardDismissedByCanvas &&
                    window.mathVirtualKeyboard && !window.mathVirtualKeyboard.visible) {
                    this.virtualKeyboardShowBypass = true;
                    try {
                        window.mathVirtualKeyboard.show({ animate: true });
                    } finally {
                        setTimeout(() => { this.virtualKeyboardShowBypass = false; }, 0);
                    }
                }
            }, 10);
        };

        // Any direct touch/click on the field clears the canvas-dismiss flag so the
        // keyboard can re-appear on next focus.
        mathField.addEventListener('touchstart', markKeyboardReopenAllowed, { passive: true });
        mathField.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch' || e.pointerType === 'pen') markKeyboardReopenAllowed();
        }, { passive: true });
        mathField.addEventListener('mousedown', markKeyboardReopenAllowed);

        mathField.addEventListener('focusin', () => {
            // If iOS asynchronously restores focus after a canvas tap, reject it
            if (mathField.getAttribute('data-blur-protected') === 'true') {
                mathField.blur();
                return;
            }
            this.lastEditableMathField = mathField;
            tryShowKeyboardForField();
        });
        // ---------------------------------------------------

        if (this.expressionsContainer) this.expressionsContainer.appendChild(card);

        // Apply theme after DOM insertion so MathLive's connectedCallback fires first
        requestAnimationFrame(() => {
            this.applyMathFieldTheme(mathField);
            if (!c.enabled) mathField.style.opacity = '0.4';
            if (c.latex) {
                mathField.value = c.latex;
                mathField.dispatchEvent(new Event('input'));
            }
            if (!skipFocus) {
                try { mathField.focus(); } catch { /* ignore */ }
            }
        });
    }

    removeExpression(id) {
        const idx = this.expressions.findIndex(c => c.id === id);
        if (idx !== -1) this.expressions.splice(idx, 1);
        const card = document.querySelector(`.expr-card[data-const-id="${id}"]`);
        if (card) card.remove();
        this.cascadeEvaluate(null);
        this._refreshDuplicateNameErrors();
        this.saveExpressions();
        if (this.currentState === this.states.APP) this.drawCanvas();
    }

    saveExpressions() {
        const data = {
            nextId:    this.nextExpressionId,
            expressions: this.expressions
                .filter(c => c.latex && c.latex.trim() !== '')
                .map(c => ({
                    id:      c.id,
                    color:   c.color,
                    enabled: c.enabled,
                    latex:   c.latex
                }))
        };
        localStorage.setItem('komplexiti-constants', JSON.stringify(data));
    }

    loadExpressions() {
        let hasLoaded = false;
        try {
            const raw = localStorage.getItem('komplexiti-constants');
            if (raw) {
                const data = JSON.parse(raw);
                if (data.nextId) this.nextExpressionId = data.nextId;
                const saved = data.expressions || data.constants || [];
                if (saved.length) {
                    for (const [idx, item] of saved.entries()) {
                        const color = this.expressionColors[idx % this.expressionColors.length];
                        const c = { id: item.id, color, enabled: !!item.enabled, latex: item.latex || '', name: null, re: null, im: null, type: 'value', roots: null, equationVar: null, locus: null, hasParseError: false };
                        this.expressions.push(c);
                        this.createExpressionUI(c, { skipFocus: true });
                    }
                    hasLoaded = true;
                }
            }
        } catch { /* ignore corrupt data */ }

        if (!hasLoaded) {
            // No saved data (first run or all deleted): seed with defaults
            for (const latex of ['a=1+\\sqrt{3}i', '\\left|z-a\\right|=3', 'z^3=1']) {
                this.addExpression({ skipFocus: true });
                this.expressions[this.expressions.length - 1].latex = latex;
            }
        }
        // Always keep one blank tile at the bottom
        if (!this.expressions.some(c => !c.latex || c.latex.trim() === '')) this.addExpression({ skipFocus: true });
    }

    // Returns { name, valueLaTeX } if the expression is a valid assignment, else null.
    parseAssignment(latex) {
        const m = latex.match(/^([a-zA-Z][0-9]*)=(.+)$/);
        if (!m) return null;
        return { name: m[1], valueLaTeX: m[2] };
    }

    // Returns an error string if the name is invalid, or null if it is acceptable.
    validateExpressionName(name, ownId) {
        if (name === 'i' || name === 'e') return `'${name}' is reserved`;
        for (const c of this.expressions) {
            if (c.id !== ownId && c.name === name) return `'${name}' is already used`;
        }
        return null;
    }

    _refreshDuplicateNameErrors() {
        const nameCounts = {};
        for (const c of this.expressions) {
            if (c.name) nameCounts[c.name] = (nameCounts[c.name] || 0) + 1;
        }
        const panel   = document.getElementById('sidebar-panel') || document.documentElement;
        const inputBg = getComputedStyle(panel).getPropertyValue('--input-bg').trim() || '#3A4F6A';
        for (const c of this.expressions) {
            const card = document.querySelector(`.expr-card[data-const-id="${c.id}"]`);
            if (!card) continue;
            const mathField   = card.querySelector('math-field');
            const errLabel    = card.querySelector('.expr-name-error');
            const isDuplicate = !!(c.name && nameCounts[c.name] > 1);
            const showError   = c.hasParseError || isDuplicate;
            if (errLabel) {
                if (isDuplicate) {
                    errLabel.textContent = `'${c.name}' is defined more than once`;
                    errLabel.style.display = 'block';
                } else if (c.hasParseError && c.errorMessage) {
                    errLabel.textContent = c.errorMessage;
                    errLabel.style.display = 'block';
                } else {
                    errLabel.textContent = '';
                    errLabel.style.display = 'none';
                }
            }
            if (showError) {
                mathField.classList.add('input-error');
                mathField.style.setProperty('background', 'rgba(231, 76, 60, 0.1)', 'important');
            } else {
                mathField.classList.remove('input-error');
                mathField.style.setProperty('background', inputBg, 'important');
            }
        }
    }

    // Returns a mathjs scope object containing all valid named expressions except the one with excludeId.
    buildExpressionScope(excludeId = null) {
        if (typeof math === 'undefined') return {};
        // Count names to exclude duplicates (ambiguous)
        const nameCounts = {};
        for (const c of this.expressions) {
            if (c.id !== excludeId && c.name) nameCounts[c.name] = (nameCounts[c.name] || 0) + 1;
        }
        const scope = {};
        for (const c of this.expressions) {
            if (c.id !== excludeId && c.name && nameCounts[c.name] === 1 && c.re !== null && c.im !== null) {
                scope[c.name] = math.complex(c.re, c.im);
            }
        }
        return scope;
    }

    // Re-evaluates every expression (except the one that just changed) using the updated scope.
    // Multiple passes resolve dependency chains regardless of definition order.
    cascadeEvaluate(triggererId) {
        const passes = this.expressions.length;
        for (let pass = 0; pass < passes; pass++) {
            for (const c of this.expressions) {
                if (c.id === triggererId) continue;
                const raw = c.latex.trim();
                if (!raw) continue;
                const scope      = this.buildExpressionScope(c.id);
                const assignment = this.parseAssignment(raw);
                if (assignment && c.name !== null) {
                    const parsed = this.parseComplexFromLatex(assignment.valueLaTeX, scope);
                    c.re = parsed !== null ? parsed.re : null;
                    c.im = parsed !== null ? parsed.im : null;
                    c.hasParseError = parsed === null;
                    c.errorMessage  = parsed === null ? 'Cannot evaluate expression' : '';
                } else if (!assignment && raw.includes('=')) {
                    const eq = this.parseEquation(raw, c.id);
                    if (eq) {
                        c.type = eq.type;
                        c.roots = eq.roots ?? null;
                        c.equationVar = eq.variable;
                        if (c.locus !== eq.locus) c._locusCache = null;
                        c.locus = eq.locus ?? null;
                        c.hasParseError = false;
                        c.errorMessage = '';
                    } else {
                        c.type = 'value';
                        c.roots = null;
                        c.equationVar = null;
                        c.locus = null;
                        c._locusCache = null;
                        c.hasParseError = true;
                        c.errorMessage = 'Needs exactly one undefined variable';
                    }
                } else if (!assignment) {
                    const parsed = this.parseComplexFromLatex(raw, scope);
                    c.re = parsed !== null ? parsed.re : null;
                    c.im = parsed !== null ? parsed.im : null;
                    c.hasParseError = raw.length > 0 && parsed === null;
                    c.errorMessage  = c.hasParseError ? 'Cannot evaluate expression' : '';
                }
            }
        }
    }

    // Normalises a LaTeX expression string into a JS/mathjs-evaluable string.
    latexToExpr(latex) {
        let e = latex.trim();
        // Conjugate must run first so \bar{z}/\overline{z} in frac denominators have no nested braces
        for (let p = 0; p < 3; p++) {
            e = e.replace(/\\overline\s*\{([^{}]*)\}/g, 'conj($1)');
            e = e.replace(/\\bar\s*\{([^{}]+)\}/g, 'conj($1)');
        }
        // Insert * where a variable/digit directly precedes a \function command (e.g. w\sqrt → w*\sqrt)
        e = e.replace(/([a-zA-Z0-9])\\(sqrt|sin|cos|tan|ln|log|exp|sinh|cosh|tanh|arcsin|arccos|arctan|arcsinh|arccosh|arctanh)\b/g, '$1*\\$2');
        for (let p = 0; p < 4; p++) {
            e = e.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
            // also handle \frac12 style (no braces, single-char args)
            e = e.replace(/\\frac\s*([^\s\\{])([^\s\\{])/g, '(($1)/($2))');
        }
        // Collapse purely-numeric ((a)/(b)) fractions to decimal literals so coefficient matchers
        // always receive a plain number (e.g. 1.5) rather than an expression string.
        e = e.replace(/\(\(([+-]?\d+\.?\d*(?:e[+-]?\d+)?)\)\/\(([+-]?\d+\.?\d*(?:e[+-]?\d+)?)\)\)/g, (_, n, d) => {
            const val = Number(n) / Number(d);
            return isFinite(val) ? String(val) : _;
        });
        for (let p = 0; p < 3; p++) {
            e = e.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
        }
        // \operatorname{fn} → fn (used by the keyboard for named functions)
        e = e.replace(/\\operatorname\{([^{}]+)\}/g, '$1');
        // arc* names produced by the above → mathjs equivalents
        e = e.replace(/\barcsin\b/g, 'asin').replace(/\barccos\b/g, 'acos').replace(/\barctan\b/g, 'atan');
        e = e.replace(/\barcsinh\b/g, 'asinh').replace(/\barccosh\b/g, 'acosh').replace(/\barctanh\b/g, 'atanh');
        e = e.replace(/\^\s*\{([^{}]+)\}/g, '^($1)');
        e = e.replace(/\{([^{}]*)\}/g, '($1)');
        // |expr| absolute value - both \left|...\right| (keyboard) and bare |...|
        e = e.replace(/\\left\s*\|(.+?)\\right\s*\|/g, 'abs($1)');
        e = e.replace(/\|([^|]+)\|/g, 'abs($1)');
        e = e.replace(/\\left\s*[(\[]/g, '(').replace(/\\right\s*[)\]]/g, ')');
        e = e.replace(/\\cdot|\\times/g, '*');
        e = e.replace(/\\pi/g, 'pi');
        e = e.replace(/\\cos/g, 'cos').replace(/\\sin/g, 'sin').replace(/\\tan/g, 'tan');
        e = e.replace(/\\arg\b/g, 'arg');
        e = e.replace(/\\Re\b/g, 're').replace(/\\Im\b/g, 'im');
        e = e.replace(/\\arcsin\b/g, 'asin').replace(/\\arccos\b/g, 'acos').replace(/\\arctan\b/g, 'atan');
        e = e.replace(/\\sinh\b/g, 'sinh').replace(/\\cosh\b/g, 'cosh').replace(/\\tanh\b/g, 'tanh');
        e = e.replace(/\\ln\b/g, 'log').replace(/\\log\b/g, 'log10');
        e = e.replace(/\\exp\b/g, 'exp');
        e = e.replace(/\\sqrt\s*([0-9])/g, 'sqrt($1)');
        e = e.replace(/\\sqrt\b/g, 'sqrt');
        e = e.replace(/\\imaginaryI|\\imath/g, 'i');
        e = e.replace(/\\[a-zA-Z]+\s*/g, '');
        e = e.trim();
        if (!e) return '';
        // Split consecutive letters that aren't a known name into implicit products (user vars are single-letter only)
        // Also handles variable immediately followed by function name, e.g. zconj → z*conj
        const knownFnNames = ['log10', 'sqrt', 'conj', 'arg', 'abs', 'asin', 'acos', 'atan', 'asinh', 'acosh', 'atanh', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'exp', 'log', 're', 'im', 'pi', 'Infinity', 'NaN'];
        e = e.replace(/[a-zA-Z]{2,}/g, m => {
            if (/^(sqrt|log10|log|exp|abs|conj|arg|asin|acos|atan|asinh|acosh|atanh|sin|cos|tan|sinh|cosh|tanh|re|im|pi|Infinity|NaN)$/.test(m)) return m;
            for (const fn of knownFnNames) {
                if (m.length > fn.length && m.endsWith(fn)) {
                    return m.slice(0, m.length - fn.length).split('').join('*') + '*' + fn;
                }
            }
            return m.split('').join('*');
        });
        e = e.replace(/\bi\s*(sqrt|sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|asinh|acosh|atanh|log|log10|exp|conj)\s*\(/g, 'i*$1(');
        e = e.replace(/\)\s*i\b/g, ')*i');
        // Insert * before a trailing imaginary i that directly follows a letter or digit (e.g. wi → w*i)
        e = e.replace(/([a-zA-Z0-9])i(?=[^a-zA-Z0-9]|$)/g, (match, prefix) => prefix === 'p' ? match : `${prefix}*i`);
        // Insert * where a letter directly precedes ( but is not the end of a known function name (e.g. z\left(...) → z*(...))
        e = e.replace(/([a-zA-Z])\(/g, (_, ch, offset, str) => {
            const tail = str.slice(Math.max(0, offset - 9), offset + 1);
            return /(sqrt|log10|log|exp|abs|conj|arg|asin|acos|atan|asinh|acosh|atanh|sin|cos|tan|sinh|cosh|tanh|re|im)$/.test(tail)
                ? `${ch}(` : `${ch}*(`;
        });
        return e;
    }

    parseComplexFromLatex(latex, scope = {}) {
        if (!latex || !latex.trim() || typeof math === 'undefined') return null;
        try {
            const e = this.latexToExpr(latex);
            if (!e) return null;
            const result = math.evaluate(e, scope);
            if (typeof result === 'number') return { re: result, im: 0 };
            if (result && typeof result.re === 'number') return { re: result.re, im: result.im };
            return null;
        } catch { return null; }
    }

    // =========================================================================
    // Equation solving
    // =========================================================================

    // Returns the single free variable name in expr, or null if there are 0 or >1.
    _findEquationVariable(expr, scope) {
        const reserved = new Set(['i', 'e', 'pi', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'log', 'log10', 'exp', 'abs', 'arg', 'conj', 're', 'im', 'Infinity', 'NaN']);
        const known    = new Set(Object.keys(scope));
        const free     = new Set();
        for (const [, id] of expr.matchAll(/(?<![a-zA-Z_])([a-zA-Z][a-zA-Z0-9]*)/g)) {
            if (!reserved.has(id) && !known.has(id)) free.add(id);
        }
        return free.size === 1 ? [...free][0] : null;
    }

    // Fast path for z^n = c: returns n evenly-spaced roots on the nth-root circle.
    _solveNthRootsOfC(n, cVal) {
        const cRe = typeof cVal === 'number' ? cVal : (cVal?.re ?? 0);
        const cIm = typeof cVal === 'number' ? 0    : (cVal?.im ?? 0);
        if (!isFinite(cRe) || !isFinite(cIm)) return null;
        const r      = Math.pow(Math.hypot(cRe, cIm), 1 / n);
        const theta0 = Math.atan2(cIm, cRe);
        return Array.from({ length: n }, (_, k) => {
            const angle = (theta0 + 2 * Math.PI * k) / n;
            return { re: r * Math.cos(angle), im: r * Math.sin(angle) };
        });
    }

    // Inline complex arithmetic helpers used by the solvers.
    _cAdd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
    _cSub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }
    _cMul(a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
    _cDiv(a, b) {
        const d = b.re * b.re + b.im * b.im;
        if (d === 0) return { re: NaN, im: NaN };
        return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
    }
    _cSqrt(a) {
        const r = Math.sqrt(Math.hypot(a.re, a.im));
        const t = Math.atan2(a.im, a.re) / 2;
        return { re: r * Math.cos(t), im: r * Math.sin(t) };
    }
    // Horner evaluation: coeffs = [a0, a1, ..., an], returns a0 + a1*z + ... + an*z^n
    _cPolyEval(coeffs, z) {
        let acc = { re: 0, im: 0 };
        for (let k = coeffs.length - 1; k >= 0; k--) acc = this._cAdd(this._cMul(acc, z), coeffs[k]);
        return acc;
    }

    _mathValueToComplex(value) {
        if (typeof value === 'number') return { re: value, im: 0 };
        if (value && typeof value.re === 'number' && typeof value.im === 'number') return { re: value.re, im: value.im };
        return null;
    }

    _equationDifferenceMagnitude(lhsValue, rhsValue, { angular = false } = {}) {
        const left  = this._mathValueToComplex(lhsValue);
        const right = this._mathValueToComplex(rhsValue);
        if (!left || !right) return Infinity;
        if (angular && Math.abs(left.im) < 1e-9 && Math.abs(right.im) < 1e-9) {
            const diff = left.re - right.re;
            return Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff)));
        }
        return Math.hypot(left.re - right.re, left.im - right.im);
    }

    _equationSignedDifference(lhsValue, rhsValue, { angular = false } = {}) {
        const left  = this._mathValueToComplex(lhsValue);
        const right = this._mathValueToComplex(rhsValue);
        if (!left || !right) return null;
        if (angular) {
            if (Math.abs(left.im) >= 1e-9 || Math.abs(right.im) >= 1e-9) return null;
            const diff = left.re - right.re;
            return Math.atan2(Math.sin(diff), Math.cos(diff));
        }
        if (Math.abs(left.im) >= 1e-9 || Math.abs(right.im) >= 1e-9) return null;
        return left.re - right.re;
    }

    _normaliseLinearTerm(expr, varName) {
        const trimmed = expr.replace(/\s+/g, '');
        if (trimmed === varName) return `(${varName})`;
        if (trimmed.startsWith(`${varName}+`) || trimmed.startsWith(`${varName}-`)) return `(${trimmed})`;
        return trimmed;
    }

    _matchFunctionTerm(expr, fnName, varName) {
        const normalized = this._normaliseLinearTerm(expr, varName);
        const pattern = new RegExp(`^${fnName}\\((${varName}|${varName}[+-].+)\\)$`);
        const match = normalized.match(pattern);
        if (!match) return null;
        return match[1];
    }

    _parseLinearVarOffset(expr, varName, scope) {
        const normalized = this._normaliseLinearTerm(expr, varName);
        if (!normalized.startsWith('(') || !normalized.endsWith(')')) return null;
        const inner = normalized.slice(1, -1).trim();
        if (inner === varName) return { offset: { re: 0, im: 0 } };
        if (!inner.startsWith(varName)) return null;

        const rest = inner.slice(varName.length).trim();
        if (!rest) return { offset: { re: 0, im: 0 } };
        const sign = rest[0];
        if (sign !== '+' && sign !== '-') return null;
        const constExpr = rest.slice(1).trim();
        if (!constExpr) return null;
        const parsed = this.parseComplexFromLatex(sign === '+' ? constExpr : `-(${constExpr})`, scope);
        if (!parsed) return null;
        return { offset: parsed };
    }

    _evaluateRealExpr(expr, scope) {
        try {
            const value = math.evaluate(expr, scope);
            if (typeof value === 'number') return isFinite(value) ? value : null;
            if (value && typeof value.re === 'number' && Math.abs(value.im ?? 0) < 1e-9 && isFinite(value.re)) return value.re;
            return null;
        } catch {
            return null;
        }
    }

    _matchAffineUnaryExpr(expr, fnName, varName, scope) {
        const normalized = expr.replace(/\s+/g, '');
        const needle = `${fnName}(`;
        const start = normalized.indexOf(needle);
        if (start < 0) return null;

        const openIndex = start + fnName.length;
        let depth = 0;
        let closeIndex = -1;
        for (let i = openIndex; i < normalized.length; i++) {
            const ch = normalized[i];
            if (ch === '(') depth++;
            else if (ch === ')') {
                depth--;
                if (depth === 0) {
                    closeIndex = i;
                    break;
                }
            }
        }
        if (closeIndex < 0) return null;

        const prefix = normalized.slice(0, start);
        const inner = normalized.slice(openIndex + 1, closeIndex);
        const suffix = normalized.slice(closeIndex + 1);
        if (!inner) return null;
        if (suffix && suffix[0] !== '+' && suffix[0] !== '-') return null;

        let scale = 1;
        if (prefix) {
            const coeffExpr = prefix.endsWith('*') ? prefix.slice(0, -1) : prefix;
            if (!coeffExpr) return null;
            const value = this._evaluateRealExpr(coeffExpr, scope);
            if (value === null) return null;
            scale = value;
        }
        if (!isFinite(scale) || Math.abs(scale) < 1e-12) return null;

        let offset = 0;
        if (suffix) {
            const value = this._evaluateRealExpr(suffix, scope);
            if (value === null) return null;
            offset = value;
        }

        const linear = this._parseLinearVarOffset(inner, varName, scope);
        if (!linear) return null;

        return {
            scale,
            offset,
            innerExpr: inner,
            point: { re: -linear.offset.re, im: -linear.offset.im }
        };
    }

    _matchAffineAbsExpr(expr, varName, scope) {
        const matched = this._matchAffineUnaryExpr(expr, 'abs', varName, scope);
        if (!matched) return null;
        return {
            scale: matched.scale,
            offset: matched.offset,
            innerExpr: matched.innerExpr,
            center: matched.point
        };
    }

    _matchAffineArgExpr(expr, varName, scope) {
        const matched = this._matchAffineUnaryExpr(expr, 'arg', varName, scope);
        if (!matched) return null;
        return {
            scale: matched.scale,
            offset: matched.offset,
            innerExpr: matched.innerExpr,
            origin: matched.point
        };
    }

    _tryBuildShiftedSpiral(argInfo, otherExpr, varName, scope) {
        const absInfo = this._matchAffineAbsExpr(otherExpr, varName, scope);
        if (!absInfo) return null;
        if (!isFinite(absInfo.scale) || Math.abs(absInfo.scale) < 1e-9) return null;

        return {
            kind: 'spiral-shifted',
            argOrigin: argInfo.origin,
            absCenter: absInfo.center,
            scale: absInfo.scale,
            offset: absInfo.offset
        };
    }

    _normaliseAffineAbsInfo(absInfo, scale, offset) {
        if (!absInfo || !isFinite(scale) || Math.abs(scale) < 1e-9) return null;
        return {
            scale: absInfo.scale / scale,
            offset: (absInfo.offset - offset) / scale,
            innerExpr: absInfo.innerExpr,
            center: absInfo.center
        };
    }

    _formatCanonicalReal(value) {
        if (!isFinite(value)) return null;
        if (Math.abs(value) < 1e-12) return '0';
        return `${Number(value.toPrecision(12))}`;
    }

    _buildCanonicalAffineAbsExpr(absInfo) {
        if (!absInfo?.innerExpr) return null;
        const scale = this._formatCanonicalReal(absInfo.scale);
        const offset = this._formatCanonicalReal(absInfo.offset);
        if (scale === null || offset === null) return null;
        if (Math.abs(absInfo.scale) < 1e-12) return null;
        const scalePart = Math.abs(absInfo.scale - 1) < 1e-12
            ? `abs(${absInfo.innerExpr})`
            : `(${scale})*abs(${absInfo.innerExpr})`;
        if (Math.abs(absInfo.offset) < 1e-12) return scalePart;
        return absInfo.offset > 0 ? `${scalePart}+(${offset})` : `${scalePart}-(${this._formatCanonicalReal(Math.abs(absInfo.offset))})`;
    }

    _canonicaliseAffineArgEquation(lhs, rhs, varName, scope) {
        const pairs = [
            { argExpr: lhs, otherExpr: rhs, argOnLeft: true },
            { argExpr: rhs, otherExpr: lhs, argOnLeft: false }
        ];
        for (const { argExpr, otherExpr, argOnLeft } of pairs) {
            const argInfo = this._matchAffineArgExpr(argExpr, varName, scope);
            if (!argInfo || Math.abs(argInfo.scale) < 1e-9 || !argInfo.innerExpr) continue;

            const normalizedOtherExpr = (Math.abs(argInfo.scale - 1) < 1e-9 && Math.abs(argInfo.offset) < 1e-9)
                ? otherExpr
                : `(((${otherExpr}))-(${argInfo.offset}))/(${argInfo.scale})`;
            const otherAbsInfo = this._matchAffineAbsExpr(otherExpr, varName, scope);
            const normalizedAbsInfo = this._normaliseAffineAbsInfo(otherAbsInfo, argInfo.scale, argInfo.offset);
            const canonicalAbsExpr = this._buildCanonicalAffineAbsExpr(normalizedAbsInfo);
            return {
                lhs: `arg(${argInfo.innerExpr})`,
                rhs: canonicalAbsExpr ?? normalizedOtherExpr,
                argInfo: {
                    ...argInfo,
                    scale: 1,
                    offset: 0
                },
                absInfo: normalizedAbsInfo,
                argOnLeft
            };
        }
        return null;
    }

    _traceShiftedSpiralSegments(fp, bounds) {
        const { minX, maxX, minY, maxY } = bounds;
        const principalMin = -Math.PI;
        const principalMax = Math.PI;
        const delta = {
            x: fp.absCenter.re - fp.argOrigin.re,
            y: fp.absCenter.im - fp.argOrigin.im
        };
        const delta2 = delta.x * delta.x + delta.y * delta.y;
        const corners = [
            { x: minX, y: minY },
            { x: minX, y: maxY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY }
        ];
        const maxDistance = Math.max(...corners.map(c => Math.hypot(c.x - fp.absCenter.re, c.y - fp.absCenter.im))) + 1;
        const minPhase = Math.min(fp.offset, fp.offset + fp.scale * maxDistance);
        const maxPhase = Math.max(fp.offset, fp.offset + fp.scale * maxDistance);
        let branchMin = Math.floor((minPhase - principalMax) / (2 * Math.PI)) - 1;
        let branchMax = Math.ceil((maxPhase - principalMin) / (2 * Math.PI)) + 1;

        // Cap maximum revolutions (branches) to preserve smooth zooming and avoid dense visual aliasing
        const MAX_TURNS = 16;
        branchMin = Math.max(branchMin, -MAX_TURNS);
        branchMax = Math.min(branchMax, MAX_TURNS);
        if (branchMax < branchMin) return [];

        const totalBranches = branchMax - branchMin + 1;
        const maxTotalSteps = 8000;
        const steps = Math.max(120, Math.min(1600, Math.floor(maxTotalSteps / totalBranches)));
        const segments = [];

        for (let branch = branchMin; branch <= branchMax; branch++) {
            const branchPoints = [[], []];
            for (let i = 0; i <= steps; i++) {
                const alpha = principalMin + (principalMax - principalMin) * i / steps;
                const requiredDistance = (alpha + 2 * Math.PI * branch - fp.offset) / fp.scale;
                if (!isFinite(requiredDistance) || requiredDistance < 0) {
                    branchPoints[0].push(null);
                    branchPoints[1].push(null);
                    continue;
                }

                const projection = delta.x * Math.cos(alpha) + delta.y * Math.sin(alpha);
                const disc = projection * projection - delta2 + requiredDistance * requiredDistance;
                if (disc < -1e-9) {
                    branchPoints[0].push(null);
                    branchPoints[1].push(null);
                    continue;
                }

                const root = Math.sqrt(Math.max(0, disc));
                const rayDistances = [projection - root, projection + root];
                for (let rootIndex = 0; rootIndex < branchPoints.length; rootIndex++) {
                    const rayDistance = rayDistances[rootIndex];
                    if (!isFinite(rayDistance) || rayDistance < -1e-9) {
                        branchPoints[rootIndex].push(null);
                        continue;
                    }
                    const pt = {
                        x: fp.argOrigin.re + rayDistance * Math.cos(alpha),
                        y: fp.argOrigin.im + rayDistance * Math.sin(alpha)
                    };
                    if (pt.x >= minX - 1e-9 && pt.x <= maxX + 1e-9 && pt.y >= minY - 1e-9 && pt.y <= maxY + 1e-9) {
                        branchPoints[rootIndex].push(pt);
                    } else {
                        branchPoints[rootIndex].push(null);
                    }
                }
            }

            for (const points of branchPoints) {
                for (let i = 1; i < points.length; i++) {
                    const prev = points[i - 1];
                    const curr = points[i];
                    if (!prev || !curr) continue;
                    segments.push([prev, curr]);
                }
            }
        }

        return segments;
    }

    _tryBuildFastLocus(lhs, rhs, varName, scope) {
        const canonical = this._canonicaliseAffineArgEquation(lhs, rhs, varName, scope);
        if (canonical) {
            lhs = canonical.lhs;
            rhs = canonical.rhs;
        }
        const circleSides = [
            { absExpr: lhs, otherExpr: rhs },
            { absExpr: rhs, otherExpr: lhs }
        ];
        for (const { absExpr, otherExpr } of circleSides) {
            const absInner = this._matchFunctionTerm(absExpr, 'abs', varName);
            if (!absInner) continue;

            const linear = this._parseLinearVarOffset(absInner, varName, scope);
            if (!linear) continue;

            const radius = this._evaluateRealExpr(otherExpr, scope);
            if (radius !== null && radius >= 0) {
                return {
                    lhs,
                    rhs,
                    angular: false,
                    scalar: true,
                    fastPath: {
                        kind: 'circle',
                        center: { re: -linear.offset.re, im: -linear.offset.im },
                        radius
                    }
                };
            }

            // Perpendicular bisector: |z - a| = |z - b|
            const otherAbs = this._matchFunctionTerm(otherExpr, 'abs', varName);
            if (otherAbs) {
                const otherLinear = this._parseLinearVarOffset(otherAbs, varName, scope);
                if (otherLinear) {
                    const a = { re: -linear.offset.re, im: -linear.offset.im };
                    const b = { re: -otherLinear.offset.re, im: -otherLinear.offset.im };
                    const dx = b.re - a.re;
                    const dy = b.im - a.im;
                    if (Math.hypot(dx, dy) < 1e-9) return null;
                    return {
                        lhs, rhs, angular: false, scalar: true,
                        fastPath: {
                            kind: 'line',
                            point: { re: (a.re + b.re) / 2, im: (a.im + b.im) / 2 },
                            direction: { re: -dy, im: dx },
                            focusA: a, focusB: b
                        }
                    };
                }
            }

            // Apollonius circle: |z - a| = k|z - b|, k > 0, k ≠ 1
            const otherAbsScaled = this._matchAffineAbsExpr(otherExpr, varName, scope);
            if (otherAbsScaled && Math.abs(otherAbsScaled.offset) < 1e-9 && otherAbsScaled.scale > 0 && Math.abs(otherAbsScaled.scale - 1) > 1e-6) {
                const k = otherAbsScaled.scale;
                const a = { re: -linear.offset.re, im: -linear.offset.im };
                const b = otherAbsScaled.center;
                const k2 = k * k;
                const denom = 1 - k2;
                const center = { re: (a.re - k2 * b.re) / denom, im: (a.im - k2 * b.im) / denom };
                const radius = k * Math.hypot(a.re - b.re, a.im - b.im) / Math.abs(denom);
                if (radius > 0 && isFinite(radius) && isFinite(center.re) && isFinite(center.im)) {
                    return { lhs, rhs, angular: false, scalar: true, fastPath: { kind: 'apollonius', center, radius, focusA: a, focusB: b, ratio: k } };
                }
            }
        }

        const scalarForms = [
            { fn: 're', axis: 'vertical' },
            { fn: 'im', axis: 'horizontal' }
        ];
        for (const { fn, axis } of scalarForms) {
            const pairs = [
                { fnExpr: lhs, otherExpr: rhs },
                { fnExpr: rhs, otherExpr: lhs }
            ];
            for (const { fnExpr, otherExpr } of pairs) {
                const inner = this._matchFunctionTerm(fnExpr, fn, varName);
                if (!inner) continue;
                const linear = this._parseLinearVarOffset(inner, varName, scope);
                if (!linear) continue;
                const constant = this._evaluateRealExpr(otherExpr, scope);
                if (constant === null) continue;
                return {
                    lhs,
                    rhs,
                    angular: false,
                    scalar: true,
                    fastPath: {
                        kind: 'line',
                        point: axis === 'vertical'
                            ? { re: constant - linear.offset.re, im: 0 }
                            : { re: 0, im: constant - linear.offset.im },
                        direction: axis === 'vertical' ? { re: 0, im: 1 } : { re: 1, im: 0 }
                    }
                };
            }
        }

        const argPairs = [
            { argExpr: lhs, otherExpr: rhs },
            { argExpr: rhs, otherExpr: lhs }
        ];
        for (const { argExpr, otherExpr } of argPairs) {
            const argInfo = this._matchAffineArgExpr(argExpr, varName, scope);
            if (!argInfo || Math.abs(argInfo.scale) < 1e-9) continue;
            const normalizedOtherExpr = otherExpr;
            const otherAbsInfo = this._matchAffineAbsExpr(otherExpr, varName, scope);
            const normalizedAbsInfo = otherAbsInfo;
            const theta = this._evaluateRealExpr(normalizedOtherExpr, scope);
            if (theta !== null) {
                return {
                    lhs,
                    rhs,
                    angular: true,
                    scalar: true,
                    fastPath: {
                        kind: 'ray',
                        origin: argInfo.origin,
                        angle: theta
                    }
                };
            }

            const spiral = normalizedAbsInfo ?? this._matchAffineAbsExpr(normalizedOtherExpr, varName, scope);
            if (spiral) {
                const sameCenter = Math.hypot(
                    argInfo.origin.re - spiral.center.re,
                    argInfo.origin.im - spiral.center.im
                ) < 1e-9;
                if (sameCenter) {
                    return {
                        lhs,
                        rhs,
                        angular: true,
                        scalar: true,
                        fastPath: {
                            kind: 'spiral',
                            scale: spiral.scale,
                            offset: spiral.offset,
                            origin: argInfo.origin
                        }
                    };
                }
            }

            const shiftedSpiral = spiral
                ? {
                    kind: 'spiral-shifted',
                    argOrigin: argInfo.origin,
                    absCenter: spiral.center,
                    scale: spiral.scale,
                    offset: spiral.offset
                }
                : this._tryBuildShiftedSpiral(argInfo, normalizedOtherExpr, varName, scope);
            if (shiftedSpiral) {
                return {
                    lhs,
                    rhs,
                    angular: true,
                    scalar: true,
                    fastPath: shiftedSpiral
                };
            }
        }

        const joukowski = this._matchJoukowskiLocus(lhs, rhs, varName, scope);
        if (joukowski) return joukowski;

        // Rewrite |N/D| = k as |N| = k|D| to expose geometric fast paths (e.g. |z/(z+1)| = 1 → perp bisector)
        const denCleared = this._tryDenominatorClearedFastLocus(lhs, rhs, varName, scope);
        if (denCleared) return denCleared;

        return null;
    }

    _tryDenominatorClearedFastLocus(lhs, rhs, varName, scope) {
        const sides = [{ absExpr: lhs, otherExpr: rhs }, { absExpr: rhs, otherExpr: lhs }];
        for (const { absExpr, otherExpr } of sides) {
            const inner = this._extractAbsInner(absExpr, varName);
            if (!inner || !inner.includes('/')) continue;
            // Skip if the inner contains non-polynomial ops on varName - rationalize gives nonsense
            if (/\bconj\(|\barg\(|\bre\(|\bim\(/.test(inner)) continue;
            let rat;
            try { rat = math.rationalize(inner, {}, true); } catch { continue; }
            const denStr = rat?.denominator?.toString();
            const numStr = rat?.numerator?.toString();
            if (!denStr || !numStr || denStr === '1' || !denStr.includes(varName)) continue;
            const k = this._evaluateRealExpr(otherExpr, scope);
            const clearedRhs = (k !== null && Math.abs(k - 1) < 1e-9)
                ? `abs(${denStr})`
                : `(${otherExpr})*abs(${denStr})`;
            const fast = this._tryBuildFastLocus(`abs(${numStr})`, clearedRhs, varName, scope);
            if (fast) return fast;
        }
        return null;
    }

    // Returns the content of abs(…) if expr is exactly that form, else null.
    _extractAbsInner(expr, varName) {
        const e = expr.trim();
        if (!e.startsWith('abs(') || !e.endsWith(')')) return null;
        let depth = 0;
        for (let i = 3; i < e.length; i++) {
            if (e[i] === '(') depth++;
            else if (e[i] === ')') {
                depth--;
                if (depth === 0) return i === e.length - 1 ? e.slice(4, i) : null;
            }
        }
        return null;
    }

    // Detect |z^n ± z^{-n}| = k by evaluating the inner expression numerically.
    _matchJoukowskiLocus(lhs, rhs, varName, scope) {
        const sides = [{ absExpr: lhs, kExpr: rhs }, { absExpr: rhs, kExpr: lhs }];
        for (const { absExpr, kExpr } of sides) {
            const inner = this._extractAbsInner(absExpr, varName);
            if (!inner) continue;
            const k = this._evaluateRealExpr(kExpr, scope);
            if (k === null || k < 0) continue;
            let innerNode;
            try { innerNode = math.parse(inner); } catch { continue; }
            const testPts = [
                { r: 1.5, theta: 0.7 }, { r: 2.0, theta: 1.3 },
                { r: 0.8, theta: 2.1 }, { r: 1.2, theta: 0.4 }
            ];
            for (let n = 1; n <= 6; n++) {
                // cosSign = -1 ↔ z^n - z^{-n}, cosSign = +1 ↔ z^n + z^{-n}
                for (const cosSign of [-1, 1]) {
                    let ok = true;
                    for (const { r, theta } of testPts) {
                        const z = math.complex(r * Math.cos(theta), r * Math.sin(theta));
                        try {
                            const val = innerNode.evaluate({ ...scope, [varName]: z });
                            if (!val || typeof val.re !== 'number' || !isFinite(val.re)) { ok = false; break; }
                            const rn = Math.pow(r, n), rni = Math.pow(r, -n);
                            const expRe = cosSign === -1 ? (rn - rni) * Math.cos(n * theta) : (rn + rni) * Math.cos(n * theta);
                            const expIm = cosSign === -1 ? (rn + rni) * Math.sin(n * theta) : (rn - rni) * Math.sin(n * theta);
                            if (Math.hypot(val.re - expRe, val.im - expIm) > 1e-6) { ok = false; break; }
                        } catch { ok = false; break; }
                    }
                    if (ok) return { lhs, rhs, angular: false, scalar: true, fastPath: { kind: 'joukowski', n, cosSign, k } };
                }
            }
        }
        return null;
    }

    _buildLocus(lhs, rhs, varName, scope) {
        const canonical = this._canonicaliseAffineArgEquation(lhs, rhs, varName, scope);
        if (canonical?.absInfo) {
            const { argInfo, absInfo } = canonical;
            const sameCenter = Math.hypot(
                argInfo.origin.re - absInfo.center.re,
                argInfo.origin.im - absInfo.center.im
            ) < 1e-9;
            const theta = this._evaluateRealExpr(canonical.rhs, scope);
            if (theta !== null) {
                return {
                    lhs: canonical.lhs, rhs: canonical.rhs,
                    angular: true, scalar: true,
                    fastPath: { kind: 'ray', origin: argInfo.origin, angle: theta }
                };
            }
            if (sameCenter) {
                return {
                    lhs: canonical.lhs, rhs: canonical.rhs,
                    angular: true, scalar: true,
                    fastPath: {
                        kind: 'spiral',
                        scale: absInfo.scale,
                        offset: absInfo.offset,
                        origin: argInfo.origin
                    }
                };
            }
            return {
                lhs: canonical.lhs, rhs: canonical.rhs,
                angular: true, scalar: true,
                fastPath: {
                    kind: 'spiral-shifted',
                    argOrigin: argInfo.origin,
                    absCenter: absInfo.center,
                    scale: absInfo.scale,
                    offset: absInfo.offset
                }
            };
        }
        if (canonical) {
            lhs = canonical.lhs;
            rhs = canonical.rhs;
        }
        const fastPath = this._tryBuildFastLocus(lhs, rhs, varName, scope);
        if (fastPath) return fastPath;

        const lhsNode = math.parse(lhs);
        const rhsNode = math.parse(rhs);
        const angular = /\barg\s*\(/.test(lhs) || /\barg\s*\(/.test(rhs);
        let scalar = true;
        const testPoints = [
            math.complex(0, 0),
            math.complex(1, 0),
            math.complex(0, 1),
            math.complex(-1.5, 0.75)
        ];
        let finiteCount = 0;
        for (const z of testPoints) {
            let lhsValue, rhsValue;
            try {
                const evalScope = { ...scope, [varName]: z };
                lhsValue = lhsNode.evaluate(evalScope);
                rhsValue = rhsNode.evaluate(evalScope);
            } catch {
                continue; // singularity at this test point - skip it
            }
            if (scalar && this._equationSignedDifference(lhsValue, rhsValue, { angular }) === null) scalar = false;
            const diff = this._equationDifferenceMagnitude(lhsValue, rhsValue, { angular });
            if (!isFinite(diff)) continue; // singularity - skip rather than reject the whole locus
            finiteCount++;
        }
        if (finiteCount === 0) return null;
        return { lhs, rhs, angular, scalar };
    }

    _clipInfiniteLine(point, direction) {
        const { minX, maxX, minY, maxY } = this.getVisibleWorldBounds();
        const hits = [];
        const pushHit = (t, x, y) => {
            if (!isFinite(t) || !isFinite(x) || !isFinite(y)) return;
            if (x < minX - 1e-9 || x > maxX + 1e-9 || y < minY - 1e-9 || y > maxY + 1e-9) return;
            if (hits.some(h => Math.hypot(h.x - x, h.y - y) < 1e-7)) return;
            hits.push({ t, x, y });
        };

        if (Math.abs(direction.re) > 1e-9) {
            let t = (minX - point.re) / direction.re;
            pushHit(t, minX, point.im + t * direction.im);
            t = (maxX - point.re) / direction.re;
            pushHit(t, maxX, point.im + t * direction.im);
        }
        if (Math.abs(direction.im) > 1e-9) {
            let t = (minY - point.im) / direction.im;
            pushHit(t, point.re + t * direction.re, minY);
            t = (maxY - point.im) / direction.im;
            pushHit(t, point.re + t * direction.re, maxY);
        }

        if (hits.length < 2) return null;
        hits.sort((a, b) => a.t - b.t);
        return [hits[0], hits[hits.length - 1]];
    }

    _clipSegmentToBounds(p0, p1, bounds) {
        const { minX, maxX, minY, maxY } = bounds;
        let t0 = 0;
        let t1 = 1;
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const p = [
            -dx, dx,
            -dy, dy
        ];
        const q = [
            p0.x - minX,
            maxX - p0.x,
            p0.y - minY,
            maxY - p0.y
        ];

        for (let i = 0; i < 4; i++) {
            if (p[i] === 0) {
                if (q[i] < 0) return [];
                continue;
            }
            const t = q[i] / p[i];
            if (p[i] < 0) {
                if (t > t1) return [];
                if (t > t0) t0 = t;
            } else {
                if (t < t0) return [];
                if (t < t1) t1 = t;
            }
        }

        if (t1 < t0) return [];
        const a = { x: p0.x + t0 * dx, y: p0.y + t0 * dy };
        const b = { x: p0.x + t1 * dx, y: p0.y + t1 * dy };
        return [a, b];
    }

    // Parametric tracer for |z^n ± z^{-n}| = k: two branches via r^{2n} + r^{-2n} = k² + cosSign·2cos(2nθ).
    _traceJoukowskiSegments({ n, cosSign, k }) {
        const steps = 720;
        const k2 = k * k;
        const segments = [];
        for (let branch = 0; branch < 2; branch++) {
            let prev = null;
            for (let step = 0; step <= steps; step++) {
                const theta = 2 * Math.PI * step / steps;
                const S = k2 - cosSign * 2 * Math.cos(2 * n * theta);
                if (S < 2) { prev = null; continue; }
                const disc = Math.sqrt(S * S - 4);
                const w = branch === 0 ? (S + disc) / 2 : (S - disc) / 2;
                const r = Math.pow(w, 1 / (2 * n));
                const pt = { x: r * Math.cos(theta), y: r * Math.sin(theta) };
                if (prev) segments.push([prev, pt]);
                prev = pt;
            }
        }
        return segments;
    }

    _scheduleLocusRetrace() {
        if (this._locusRetraceTimer) clearTimeout(this._locusRetraceTimer);
        this._locusRetraceTimer = setTimeout(() => {
            this._locusRetraceTimer = null;
            let retraced = false;
            const vp = this.viewport;
            for (const c of this.expressions) {
                if (c.type !== 'locus' || !c.locus || !c.equationVar || c.locus.fastPath) continue;
                const cached = c._locusCache;
                if (cached && cached.minX === vp.minX && cached.maxX === vp.maxX &&
                    cached.minY === vp.minY && cached.maxY === vp.maxY) continue;
                c._locusCache = {
                    segments: this._traceLocusSegments(c.locus, c.equationVar, c.id),
                    minX: vp.minX, maxX: vp.maxX, minY: vp.minY, maxY: vp.maxY
                };
                retraced = true;
            }
            if (retraced && this.currentState === this.states.APP) this.drawCanvas();
        }, 200);
    }

    _traceFastLocusSegments(locus) {
        const fp = locus?.fastPath;
        if (!fp) return null;

        if (fp.kind === 'circle') {
            const steps = 160;
            const segments = [];
            for (let k = 0; k < steps; k++) {
                const a0 = 2 * Math.PI * k / steps;
                const a1 = 2 * Math.PI * (k + 1) / steps;
                segments.push([
                    { x: fp.center.re + fp.radius * Math.cos(a0), y: fp.center.im + fp.radius * Math.sin(a0) },
                    { x: fp.center.re + fp.radius * Math.cos(a1), y: fp.center.im + fp.radius * Math.sin(a1) }
                ]);
            }
            return segments;
        }

        if (fp.kind === 'line') {
            const clipped = this._clipInfiniteLine({ re: fp.point.re, im: fp.point.im }, fp.direction);
            if (!clipped) return [];
            return [[{ x: clipped[0].x, y: clipped[0].y }, { x: clipped[1].x, y: clipped[1].y }]];
        }

        if (fp.kind === 'ray') {
            const direction = { re: Math.cos(fp.angle), im: Math.sin(fp.angle) };
            const clipped = this._clipInfiniteLine({ re: fp.origin.re, im: fp.origin.im }, direction);
            if (!clipped) return [];
            const forward = clipped.filter(p => p.t >= -1e-9);
            if (!forward.length) return [];
            const end = forward[forward.length - 1];
            return [[{ x: fp.origin.re, y: fp.origin.im }, { x: end.x, y: end.y }]];
        }

        if (fp.kind === 'spiral') {
            const bounds = this.getVisibleWorldBounds();
            const { minX, maxX, minY, maxY } = bounds;
            const radiusLimit = Math.max(
                Math.hypot(minX - fp.origin.re, minY - fp.origin.im),
                Math.hypot(minX - fp.origin.re, maxY - fp.origin.im),
                Math.hypot(maxX - fp.origin.re, minY - fp.origin.im),
                Math.hypot(maxX - fp.origin.re, maxY - fp.origin.im),
                1
            ) + 2;

            const MAX_TURNS = 16;
            const maxAngle = MAX_TURNS * 2 * Math.PI;
            const maxRFromTurns = Math.abs(fp.scale) > 1e-9 ? Math.abs((maxAngle - fp.offset) / fp.scale) : radiusLimit;
            const effectiveRadiusLimit = Math.min(radiusLimit, Math.max(1, maxRFromTurns));
            const totalTurns = Math.max(1, (Math.abs(fp.scale) * effectiveRadiusLimit) / (2 * Math.PI));
            const stepCount = Math.max(200, Math.min(4000, Math.round(totalTurns * 200)));
            const segments = [];
            const sample = (t) => {
                const r = t;
                const theta = fp.scale * r + fp.offset;
                return {
                    x: fp.origin.re + r * Math.cos(theta),
                    y: fp.origin.im + r * Math.sin(theta)
                };
            };

            for (let i = 1; i <= stepCount; i++) {
                const t0 = (i - 1) * effectiveRadiusLimit / stepCount;
                const t1 = i * effectiveRadiusLimit / stepCount;
                const p0 = sample(t0);
                const p1 = sample(t1);
                const clipped = this._clipSegmentToBounds(p0, p1, bounds);
                if (clipped.length === 2) {
                    segments.push([clipped[0], clipped[1]]);
                }
            }

            return segments;
        }

        if (fp.kind === 'apollonius') {
            // Apollonius circle shares geometry with the circle tracer
            const steps = 160;
            const segments = [];
            for (let k = 0; k < steps; k++) {
                const a0 = 2 * Math.PI * k / steps;
                const a1 = 2 * Math.PI * (k + 1) / steps;
                segments.push([
                    { x: fp.center.re + fp.radius * Math.cos(a0), y: fp.center.im + fp.radius * Math.sin(a0) },
                    { x: fp.center.re + fp.radius * Math.cos(a1), y: fp.center.im + fp.radius * Math.sin(a1) }
                ]);
            }
            return segments;
        }

        if (fp.kind === 'spiral-shifted') {
            return this._traceShiftedSpiralSegments(fp, this.getVisibleWorldBounds());
        }

        if (fp.kind === 'joukowski') {
            return this._traceJoukowskiSegments(fp);
        }

        return null;
    }

    _traceLocusSegments(locus, varName, ownId) {
        if (!locus || typeof math === 'undefined') return [];
        const { minX, maxX, minY, maxY } = this.getVisibleWorldBounds();
        const spanX = maxX - minX;
        const spanY = maxY - minY;
        if (!(spanX > 0) || !(spanY > 0)) return [];

        const cols = Math.max(96, Math.min(220, Math.round(this.canvas.width / 6)));
        const rows = Math.max(96, Math.min(220, Math.round(this.canvas.height / 6)));
        const dx = spanX / cols;
        const dy = spanY / rows;
        const eps = Math.max(spanX, spanY) / Math.max(cols, rows) * 0.3;
        const scope = this.buildExpressionScope(ownId);
        const lhsNode = math.parse(locus.lhs);
        const rhsNode = math.parse(locus.rhs);
        const values = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(Infinity));

        for (let iy = 0; iy <= rows; iy++) {
            const y = minY + iy * dy;
            for (let ix = 0; ix <= cols; ix++) {
                const x = minX + ix * dx;
                try {
                    const evalScope = { ...scope, [varName]: math.complex(x, y) };
                    const lhsValue = lhsNode.evaluate(evalScope);
                    const rhsValue = rhsNode.evaluate(evalScope);
                    if (locus.scalar) {
                        const signed = this._equationSignedDifference(lhsValue, rhsValue, { angular: locus.angular });
                        values[iy][ix] = signed === null ? Infinity : signed;
                    } else {
                        values[iy][ix] = this._equationDifferenceMagnitude(lhsValue, rhsValue, { angular: locus.angular });
                    }
                } catch {
                    values[iy][ix] = Infinity;
                }
            }
        }

        const interpolate = (x1, y1, v1, x2, y2, v2) => {
            const denom = locus.scalar ? (v1 - v2) : ((v1 - eps) - (v2 - eps));
            const numer = locus.scalar ? v1 : (v1 - eps);
            const t = Math.abs(denom) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, numer / denom));
            return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
        };

        const segments = [];
        for (let iy = 0; iy < rows; iy++) {
            const y0 = minY + iy * dy;
            const y1 = y0 + dy;
            for (let ix = 0; ix < cols; ix++) {
                const x0 = minX + ix * dx;
                const x1 = x0 + dx;
                const v00 = values[iy][ix];
                const v10 = values[iy][ix + 1];
                const v11 = values[iy + 1][ix + 1];
                const v01 = values[iy + 1][ix];
                if (![v00, v10, v11, v01].every(Number.isFinite)) continue;

                const crosses = (a, b) => {
                    if (locus.scalar) {
                        return (a === 0) || (b === 0) || ((a < 0) !== (b < 0));
                    }
                    return (a <= eps) !== (b <= eps);
                };

                const hits = [];
                if (crosses(v00, v10)) hits.push(interpolate(x0, y0, v00, x1, y0, v10));
                if (crosses(v10, v11)) hits.push(interpolate(x1, y0, v10, x1, y1, v11));
                if (crosses(v11, v01)) hits.push(interpolate(x1, y1, v11, x0, y1, v01));
                if (crosses(v01, v00)) hits.push(interpolate(x0, y1, v01, x0, y0, v00));

                if (hits.length === 2) {
                    segments.push([hits[0], hits[1]]);
                } else if (hits.length === 4) {
                    const cx = (x0 + x1) / 2;
                    const cy = (y0 + y1) / 2;
                    hits.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
                    for (let i = 0; i < hits.length; i += 2) {
                        if (i + 1 < hits.length) {
                            segments.push([hits[i], hits[i + 1]]);
                        }
                    }
                }
            }
        }
        return segments;
    }

    // Extract polynomial coefficients [a0..an] of h(varName) via symbolic differentiation.
    // Returns null if h is not a polynomial of degree ≤ maxDeg.
    _extractPolynomialCoeffs(hExpr, varName, scope, maxDeg = 6) {
        try {
            const factorials = [1];
            for (let k = 1; k <= maxDeg; k++) factorials.push(factorials[k - 1] * k);

            let node   = math.parse(hExpr);
            const sc0  = { ...scope, [varName]: math.complex(0, 0) };
            const coeffs = [];

            for (let k = 0; k <= maxDeg; k++) {
                if (k > 0) node = math.derivative(node, varName);
                const raw = node.evaluate(sc0);
                const re  = typeof raw === 'number' ? raw : (raw?.re ?? 0);
                const im  = typeof raw === 'number' ? 0   : (raw?.im ?? 0);
                if (!isFinite(re) || !isFinite(im)) return null; // singularity at expansion point
                coeffs.push({ re: re / factorials[k], im: im / factorials[k] });
            }
            // Trim trailing near-zero coefficients
            while (coeffs.length > 1 && Math.hypot(coeffs[coeffs.length - 1].re, coeffs[coeffs.length - 1].im) < 1e-9) {
                coeffs.pop();
            }
            return coeffs;
        } catch { return null; }
    }

    _matchesPolynomialApproximation(hExpr, coeffs, varName, scope) {
        if (!coeffs?.length) return false;
        try {
            const node = math.parse(hExpr);
            const samplePoints = [
                math.complex(0, 0),
                math.complex(1, 0),
                math.complex(0, 1),
                math.complex(-1.25, 0.5)
            ];

            for (const z of samplePoints) {
                const evalScope = { ...scope, [varName]: z };
                const exprValue = this._mathValueToComplex(node.evaluate(evalScope));
                const polyValue = this._cPolyEval(coeffs, { re: z.re, im: z.im });
                if (!exprValue) return false;
                const diff = Math.hypot(exprValue.re - polyValue.re, exprValue.im - polyValue.im);
                if (!isFinite(diff) || diff > 1e-6) return false;
            }

            return true;
        } catch {
            return false;
        }
    }

    _solveLinear(coeffs) {
        return [ this._cDiv({ re: -coeffs[0].re, im: -coeffs[0].im }, coeffs[1]) ];
    }

    _solveQuadratic(coeffs) {
        const [a0, a1, a2] = coeffs;
        const disc  = this._cSub(this._cMul(a1, a1), this._cMul({ re: 4, im: 0 }, this._cMul(a0, a2)));
        const sqrtD = this._cSqrt(disc);
        const negA1 = { re: -a1.re, im: -a1.im };
        const two2  = { re: 2 * a2.re, im: 2 * a2.im };
        return [
            this._cDiv(this._cAdd(negA1, sqrtD), two2),
            this._cDiv(this._cSub(negA1, sqrtD), two2)
        ];
    }

    // Durand-Kerner (Weierstrass) simultaneous root-finder for degree >= 3.
    _solveDurandKerner(coeffs) {
        const n = coeffs.length - 1;
        if (n < 1) return [];
        const lead  = coeffs[n];
        const monic = coeffs.map(c => this._cDiv(c, lead));
        // Cauchy bound for initial circle radius
        const bound = 1 + Math.max(...monic.slice(0, n).map(c => Math.hypot(c.re, c.im)));
        const r0    = Math.pow(bound, 1 / n);
        // Start slightly off-axis to avoid symmetry collisions with roots of unity
        let zs = Array.from({ length: n }, (_, k) => {
            const angle = 0.4 + 2 * Math.PI * k / n;
            return { re: r0 * Math.cos(angle), im: r0 * Math.sin(angle) };
        });
        for (let iter = 0; iter < 80; iter++) {
            let maxStep = 0;
            const next = zs.map((zk, k) => {
                const pz  = this._cPolyEval(monic, zk);
                let denom = { re: 1, im: 0 };
                for (let j = 0; j < n; j++) {
                    if (j !== k) denom = this._cMul(denom, this._cSub(zk, zs[j]));
                }
                const step = this._cDiv(pz, denom);
                maxStep = Math.max(maxStep, Math.hypot(step.re, step.im));
                return this._cSub(zk, step);
            });
            zs = next;
            if (maxStep < 1e-12) break;
        }
        return zs;
    }

    // Main equation parser. Returns either finite roots or a drawable complex locus.
    parseEquation(rawLatex, ownId) {
        if (typeof math === 'undefined') return null;
        try {
            const scope = this.buildExpressionScope(ownId);
            const expr  = this.latexToExpr(rawLatex);
            if (!expr) return null;

            const eqIdx = expr.indexOf('=');
            if (eqIdx < 1 || eqIdx >= expr.length - 1) return null;
            if ('!<>'.includes(expr[eqIdx - 1])) return null;   // reject !=, <=, >=

            const lhs     = expr.slice(0, eqIdx).trim();
            const rhs     = expr.slice(eqIdx + 1).trim();
            const varName = this._findEquationVariable(lhs + ' ' + rhs, scope);
            if (!varName) return null;

            // Fast path: varName^n = const_expr  (nth roots, including roots of unity)
            const stripped  = lhs.replace(/\s/g, '');
            const nthMatch  = /^([a-zA-Z]\w*)\^[(]?(\d+)[)]?$/.exec(stripped);
            if (nthMatch && nthMatch[1] === varName) {
                const n = parseInt(nthMatch[2]);
                if (n >= 1 && n <= 16) {
                    const cVal = math.evaluate(rhs, scope);
                    const roots = this._solveNthRootsOfC(n, cVal);
                    if (roots) return { type: 'equation', variable: varName, roots };
                }
            }

            // General polynomial solver via symbolic differentiation
            const hExpr  = `(${lhs}) - (${rhs})`;

            // abs/arg/conj expressions are never polynomials; skip symbolic differentiation to avoid hangs
            if (/\babs\(|\barg\(|\bconj\(/.test(hExpr)) {
                const locus = this._buildLocus(lhs, rhs, varName, scope);
                return locus ? { type: 'locus', variable: varName, roots: null, locus } : null;
            }

            let coeffs = this._extractPolynomialCoeffs(hExpr, varName, scope);
            let fromRationalize = false;

            // Discard Taylor series before trying rationalization: a degree-6 series for 1/(z+1)
            // looks non-null but fails the approximation check, blocking the rational path.
            if (coeffs && coeffs.length >= 2 && !this._matchesPolynomialApproximation(hExpr, coeffs, varName, scope)) {
                coeffs = null;
            }

            // Rationalize to find exact roots of rational equations like 1/(z+1) = 1
            if (!coeffs || coeffs.length < 2) {
                try {
                    const rat = math.rationalize(hExpr, {}, true);
                    if (rat?.numerator) {
                        coeffs = this._extractPolynomialCoeffs(rat.numerator.toString(), varName, scope);
                        fromRationalize = coeffs != null;
                    }
                } catch { /* not rationalizable */ }
            }

            if (!coeffs || coeffs.length < 2) {
                const locus = this._buildLocus(lhs, rhs, varName, scope);
                return locus ? { type: 'locus', variable: varName, roots: null, locus } : null;
            }

            const deg = coeffs.length - 1;
            let roots;
            if      (deg === 1) roots = this._solveLinear(coeffs);
            else if (deg === 2) roots = this._solveQuadratic(coeffs);
            else                roots = this._solveDurandKerner(coeffs);

            if (roots?.length) {
                let valid = roots.filter(r => isFinite(r.re) && isFinite(r.im));
                if (fromRationalize && valid.length) {
                    // Remove poles: roots where the original expression throws or isn't near zero
                    const hNode = math.parse(hExpr);
                    valid = valid.filter(r => {
                        try {
                            const val = hNode.evaluate({ ...scope, [varName]: math.complex(r.re, r.im) });
                            return this._equationDifferenceMagnitude(val, { re: 0, im: 0 }) < 0.01;
                        } catch { return false; }
                    });
                }
                if (valid.length) return { type: 'equation', variable: varName, roots: valid };
            }

            const locus = this._buildLocus(lhs, rhs, varName, scope);
            return locus ? { type: 'locus', variable: varName, roots: null, locus } : null;
        } catch { return null; }
    }

    resetAxes() {
        const h = this.viewport.height || this.canvas.height;
        const targetScale = h > 0 ? h / 10 : this.viewport.scale;
        this.animateViewportTo(0, 0, targetScale, 350);
    }

    clearAllExpressions() {
        this.expressions = [];
        if (this.expressionsContainer) {
            this.expressionsContainer.innerHTML = '';
        }
        this.addExpression({ skipFocus: true });
        this.cascadeEvaluate(null);
        this.saveExpressions();
        if (this.currentState === this.states.APP) this.drawCanvas();
    }

    loadDemoSet(setName) {
        const demoSets = {
            'complex-numbers': [
                'a=2-2i',
                'b=-4e^{\\frac{\\pi}{3}i}',
                'c=3\\left(\\cos\\left(\\frac{\\pi}{6}\\right)+i\\sin\\left(\\frac{\\pi}{6}\\right)\\right)',
                'z=\\frac{a}{b}'
            ],
            'complex-equations': [
                'z+\\frac{1}{z}=1',
                { latex: 'w^3=-27',   cardRootFmt: 'exponential' },
                { latex: 'z^3=8i',    cardRootFmt: 'exponential' }
            ],
            'loci': [
                '\\left|w\\right|=2',
                '\\arg\\left(z-2\\right)=\\frac{\\pi}{3}',
                '\\left|z-\\left(2-3i\\right)\\right|=\\left|z-1+2i\\right|',
                '\\left|z^2+\\frac{1}{z^2}\\right|=2'
            ]
        };

        const list = demoSets[setName];
        if (!list) return;

        this.expressions = [];
        if (this.expressionsContainer) {
            this.expressionsContainer.innerHTML = '';
        }

        for (const item of list) {
            const latex  = typeof item === 'string' ? item : item.latex;
            const fmt    = typeof item === 'string' ? null  : (item.cardRootFmt ?? null);
            this.addExpression({ skipFocus: true });
            const expr = this.expressions[this.expressions.length - 1];
            expr.latex = latex;
            if (fmt) expr.cardRootFmt = fmt;
            const card = document.querySelector(`.expr-card[data-const-id="${expr.id}"]`);
            if (card) {
                const mathField = card.querySelector('math-field');
                if (mathField) {
                    mathField.value = latex;
                    mathField.dispatchEvent(new Event('input'));
                }
            }
        }

        // Add a blank tile at bottom
        this.addExpression({ skipFocus: true });
        this.cascadeEvaluate(null);
        // Re-render metadata now that roots are resolved, so cardRootFmt takes effect
        this.updateAllCardMetadata();
        this.saveExpressions();
        this.resetAxes();
        if (this.currentState === this.states.APP) this.drawCanvas();
    }

    toggleAddDropdown(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const dropdown = document.getElementById('add-dropdown');
        if (!dropdown) return;
        const isOpen = dropdown.classList.contains('show');
        if (isOpen) {
            dropdown.classList.remove('show');
            return;
        }
        // Position below the top toolbar row and match its full width (from left of 1st button to right of last button)
        const toggleBtn = e?.currentTarget || document.getElementById('add-dropdown-toggle');
        const toolbarRow = toggleBtn?.closest('.top-toolbar-row') || toggleBtn?.closest('.panel-control-row') || toggleBtn;
        const rect = toolbarRow.getBoundingClientRect();
        dropdown.style.top   = (rect.bottom + 4) + 'px';
        dropdown.style.left  = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
        dropdown.classList.add('show');
    }

    toggleDisplayMode() {
        this.displayMode = this.displayMode === 'arrow' ? 'point' : 'arrow';
        const arrowIcon = document.querySelector('.mode-arrow-icon');
        const pointIcon = document.querySelector('.mode-point-icon');
        if (arrowIcon) arrowIcon.style.opacity = this.displayMode === 'arrow' ? '1' : '0.35';
        if (pointIcon) pointIcon.style.opacity = this.displayMode === 'point' ? '1' : '0.35';
        if (this.currentState === this.states.APP) this.drawCanvas();
    }

    // =========================================================================
    // Complex number info panel
    // =========================================================================

    showComplexInfoPanel(id) {
        this.activeInfoExpressionId = id;
        const panel = document.getElementById('complex-info-panel');
        if (panel) panel.style.display = '';
        this.updateComplexInfoPanel();
    }

    // =========================================================================
    // Card metadata
    // =========================================================================

    getContrastingTextColor(hex) {
        if (!hex || typeof hex !== 'string') return '#fff';
        const h = hex.replace('#', '');
        if (h.length !== 6) return '#fff';
        const r = parseInt(h.slice(0, 2), 16) / 255;
        const g = parseInt(h.slice(2, 4), 16) / 255;
        const b = parseInt(h.slice(4, 6), 16) / 255;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return luminance > 0.5 ? '#000' : '#fff';
    }

    updateAllCardMetadata() {
        for (const c of this.expressions) {
            this.updateCardMetadata(c);
        }
    }

    updateCardMetadata(c) {
        const card = document.querySelector(`.expr-card[data-const-id="${c.id}"]`);
        if (!card) return;
        const container = card.querySelector('.shape-info-container');
        if (!container) return;

        const badge   = container.querySelector('.shape-info-title');
        const valueEl = container.querySelector('.shape-info-value');
        const rootsEl = container.querySelector('.expr-card-roots');
        const fociContainer = card.querySelector('.foci-info-container');
        const fociList      = card.querySelector('.foci-equation-list');
        const fociToggle    = card.querySelector('.foci-visibility-toggle');
        const hideFoci = () => { if (fociContainer) fociContainer.classList.remove('visible'); if (fociList) fociList.innerHTML = ''; };

        const hide = () => container.classList.remove('visible');

        if (!c.latex || !c.latex.trim()) { hide(); return; }
        if (!c.enabled) { hide(); return; }
        if (c.hasParseError && c.re === null && c.im === null && !c.roots?.length && !c.locus) { hide(); return; }

        // Set badge colors from card color
        card.style.setProperty('--function-badge-bg', c.color);
        card.style.setProperty('--function-badge-fg', this.getContrastingTextColor(c.color));

        // Shared factory for read-only math-fields used by equation and constant branches
        const makeMF = (latex, fontSize = 18) => {
            const mf = document.createElement('math-field');
            mf.className = 'asymptote-equation-field asymptote-equation-item-wide';
            mf.setAttribute('read-only', 'true');
            mf.setAttribute('default-mode', 'math');
            mf.setAttribute('virtual-keyboard-mode', 'off');
            mf.setAttribute('tabindex', '-1');
            mf.setAttribute('color-scheme', 'dark');
            mf.style.setProperty('color', '#E8F4FD', 'important');
            mf.style.setProperty('--text-color', '#E8F4FD');
            mf.style.setProperty('--mf-font-size', `${fontSize}px`);
            mf.addEventListener('focus', () => mf.blur());
            mf.addEventListener('focusin', () => mf.blur());
            mf.value = latex;
            return mf;
        };

        if (c.type === 'equation' && c.roots?.length) {
            hideFoci();
            container.classList.add('is-equation');
            const fmt = c.cardRootFmt || 'cartesian';
            const fmtNames  = { cartesian: 'Cartesian', exponential: 'Exponential', trig: 'Trig' };
            badge.textContent     = 'Root format (click to change)';
            badge.title           = '';
            valueEl.style.display = '';
            valueEl.textContent   = fmtNames[fmt];
            rootsEl.style.display = 'flex';
            rootsEl.innerHTML     = '';
            for (const [k, root] of c.roots.entries()) {
                if (!isFinite(root.re) || !isFinite(root.im)) continue;
                // Full-precision tooltip in current display format
                const toSub   = n => String(n).split('').map(d => '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089'[d]).join('');
                const varName = c.equationVar || 'z';
                const tooltip = `${varName}${toSub(k + 1)} = ${this.formatComplexPlain(root.re, root.im, fmt)}`;
                const wrapper = document.createElement('div');
                wrapper.title = tooltip;

                const mfSize = fmt === 'exponential' ? 22 : 18;

                if (fmt === 'trig') {
                    const r = Math.hypot(root.re, root.im);
                    if (r < 1e-10) {
                        wrapper.appendChild(makeMF(`${varName}_{${k + 1}}=0`, mfSize));
                    } else {
                        const theta  = Math.atan2(root.im, root.re);
                        const rLatex = this.niceRealLatex(r) ?? this.formatNumberShort(r);
                        const thStr  = this.niceAngleLatex(theta) ?? this.formatNumberShort(theta);
                        const rPart  = Math.abs(r - 1) < 1e-9 ? '' : rLatex;
                        const label  = `${varName}_{${k + 1}}`;
                        wrapper.appendChild(makeMF(`${label}=${rPart}\\cos(${thStr})`, mfSize));
                        wrapper.appendChild(makeMF(`\\phantom{${label}=}+i${rPart}\\sin(${thStr})`, mfSize));
                    }
                } else {
                    wrapper.appendChild(makeMF(`${varName}_{${k + 1}}=${this.formatComplexLatex(root.re, root.im, fmt)}`, mfSize));
                }

                rootsEl.appendChild(wrapper);
            }
            container.classList.add('visible');

        } else if (c.type === 'locus' && c.locus) {
            container.classList.remove('is-equation');
            badge.textContent      = 'Locus';
            valueEl.style.display  = '';
            rootsEl.style.display  = 'none';
            rootsEl.innerHTML      = '';
            const fp = c.locus.fastPath;
            const kinds = { circle: 'circle', line: 'perpendicular bisector', ray: 'half-line', apollonius: 'Apollonius', spiral: 'Archimedean', 'spiral-shifted': 'spiral', joukowski: 'Joukowski' };
            valueEl.textContent = fp ? (kinds[fp.kind] ?? fp.kind) : 'locus';
            const hasFoci = !!(fp?.focusA && fp?.focusB);
            if (hasFoci) {
                fociContainer.classList.add('visible');
                if (fociToggle) fociToggle.classList.toggle('is-hidden', c.showFoci === false);
                fociList.innerHTML = '';
                const fmtCoord = ({ re, im }) => {
                    const a = this.niceRealLatex(re)  ?? this.formatNumberShort(re);
                    const b = this.niceRealLatex(im)  ?? this.formatNumberShort(im);
                    return `\\left(${a},\\,${b}\\right)`;
                };
                for (const focus of [fp.focusA, fp.focusB]) {
                    const wrapper = document.createElement('div');
                    wrapper.appendChild(makeMF(fmtCoord(focus), 17));
                    fociList.appendChild(wrapper);
                }
            } else {
                hideFoci();
            }
            container.classList.add('visible');

        } else if (c.type === 'value' && c.re !== null && c.im !== null) {
            hideFoci();
            container.classList.remove('is-equation');
            badge.textContent      = 'Constant';
            valueEl.style.display  = '';
            const tol = 1e-9;
            valueEl.textContent = Math.abs(c.im) < tol ? 'real' : Math.abs(c.re) < tol ? 'imaginary' : 'complex';
            // Modulus and argument as badge+value rows
            const sym   = c.name || 'z';
            const r     = Math.hypot(c.re, c.im);
            const theta = Math.atan2(c.im, c.re);
            const rLatex  = this.niceRealLatex(r)     ?? this.formatNumberShort(r);
            const thLatex = this.niceAngleLatex(theta) ?? this.formatNumberShort(theta);
            const makeMetaRow = (label, latex) => {
                const row  = document.createElement('div');
                row.style.cssText = 'display:flex;flex-direction:column;gap:2px';
                const tr   = document.createElement('div');
                tr.className = 'metadata-title-row';
                const ph   = document.createElement('span');
                ph.className = 'metadata-visibility-placeholder';
                ph.setAttribute('aria-hidden', 'true');
                const b    = document.createElement('div');
                b.className = 'shape-info-title';
                b.textContent = label;
                tr.appendChild(ph);
                tr.appendChild(b);
                row.appendChild(tr);
                const valWrap = document.createElement('div');
                valWrap.style.paddingLeft = '10px';
                valWrap.appendChild(makeMF(latex, 16));
                row.appendChild(valWrap);
                return row;
            };
            rootsEl.innerHTML = '';
            rootsEl.appendChild(makeMetaRow('Modulus', rLatex));
            rootsEl.appendChild(makeMetaRow('Argument', thLatex));
            rootsEl.style.display = 'flex';
            rootsEl.style.flexDirection = 'column';
            rootsEl.style.gap = '4px';
            container.classList.add('visible');

        } else {
            hide();
        }
    }

    updateComplexInfoPanel() {
        const panel    = document.getElementById('complex-info-panel');
        if (!panel || panel.style.display === 'none') return;
        const c = this.expressions.find(x => x.id === this.activeInfoExpressionId);
        if (!c) { panel.style.display = 'none'; return; }

        panel.style.borderLeftColor = c.color;
        const title   = document.getElementById('complex-info-title');
        const single  = document.getElementById('complex-info-single');
        const rootsEl = document.getElementById('complex-info-roots');

        if (c.type === 'equation' && c.roots?.length) {
            if (title)   title.textContent  = c.equationVar ? `${c.equationVar}:` : 'Roots';
            if (single)  single.style.display  = 'none';
            if (rootsEl) {
                rootsEl.style.display = '';
                const toSub = n => String(n).split('').map(d => '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089'[d]).join('');
                rootsEl.innerHTML = c.roots.map((root, k) => {
                    if (!isFinite(root.re) || !isFinite(root.im)) return '';
                    const r     = Math.hypot(root.re, root.im);
                    const theta = Math.atan2(root.im, root.re);
                    const label = (c.equationVar || 'z') + toSub(k + 1);
                    const val   = this.formatComplexValue(root.re, root.im, r, theta);
                    return `<div class="complex-info-row"><span class="complex-info-label">${label}</span><span class="complex-info-val">${val}</span></div>`;
                }).join('');
            }
            return;
        }

        if (c.type === 'locus' && c.locus) {
            if (title) title.textContent = c.equationVar ? `${c.equationVar} locus` : 'Locus';
            if (single) single.style.display = 'none';
            if (rootsEl) {
                rootsEl.style.display = '';
                rootsEl.innerHTML = '<div class="complex-info-row"><span class="complex-info-label">Equation</span><span class="complex-info-val">Infinite solution set</span></div>';
            }
            return;
        }

        if (single)  single.style.display  = '';
        if (rootsEl) rootsEl.style.display = 'none';
        if (title) title.textContent = c.name || 'z';

        const valEl = document.getElementById('complex-info-value');
        const modEl = document.getElementById('complex-info-modulus');
        const argEl = document.getElementById('complex-info-argument');

        if (c.re === null || c.im === null) {
            if (valEl) valEl.innerHTML = '<em>undefined</em>';
            if (modEl) modEl.textContent = '-';
            if (argEl) argEl.textContent = '-';
            return;
        }

        const r     = Math.sqrt(c.re * c.re + c.im * c.im);
        const theta = Math.atan2(c.im, c.re);

        if (valEl) valEl.innerHTML = this.formatComplexValue(c.re, c.im, r, theta);
        if (modEl) modEl.innerHTML   = this.niceRealHTML(r) ?? this.formatNumber(r);
        if (argEl) argEl.innerHTML   = this.formatArgument(theta);
    }

    // Returns a LaTeX string if value has a recognisable nice form, else null.
    niceRealLatex(value) {
        if (!isFinite(value)) return null;
        const tol = 5e-6;
        if (Math.abs(value) < tol) return '0';
        const sign = value < 0 ? -1 : 1;
        const abs  = Math.abs(value);
        const ri   = Math.round(abs);
        if (Math.abs(abs - ri) < tol) return sign < 0 ? `-${ri}` : `${ri}`;
        for (let d = 2; d <= 24; d++) {
            const n = Math.round(abs * d);
            if (n > 0 && Math.abs(abs - n / d) < tol) {
                const g = this._gcd(n, d); const sn = n / g; const sd = d / g;
                if (sd > 1 && sd <= 24) return (sign < 0 ? '-' : '') + `\\frac{${sn}}{${sd}}`;
            }
        }
        for (const k of [2, 3, 5, 6, 7]) {
            const sqK = Math.sqrt(k);
            const ratio = abs / sqK;
            for (let d = 1; d <= 12; d++) {
                const n = Math.round(ratio * d);
                if (n > 0 && Math.abs(ratio - n / d) < tol) {
                    const g = this._gcd(n, d); const sn = n / g; const sd = d / g;
                    const rad = `\\sqrt{${k}}`;
                    const neg = sign < 0 ? '-' : '';
                    if (sn === 1 && sd === 1) return `${neg}${rad}`;
                    if (sd === 1)             return `${neg}${sn}${rad}`;
                    if (sn === 1)             return `${neg}\\frac{${rad}}{${sd}}`;
                    return `${neg}\\frac{${sn}${rad}}{${sd}}`;
                }
            }
        }
        return null;
    }

    formatCartesianLatex(re, im) {
        const aStr = this.niceRealLatex(re)          ?? this.formatNumberShort(re);
        const bAbs = this.niceRealLatex(Math.abs(im)) ?? this.formatNumberShort(Math.abs(im));
        if (Math.abs(im) < 1e-10) return aStr;
        if (Math.abs(re) < 1e-10) return im < -1e-10 ? `-${bAbs}i` : `${bAbs}i`;
        const sign = im < -1e-10 ? '-' : '+';
        return `${aStr}${sign}${bAbs}i`;
    }

    // ---- Nice-number helpers (adapted from Graphiti) ----

    _gcd(a, b) { return b === 0 ? a : this._gcd(b, a % b); }

    // Returns an HTML string for value if it has a recognisable nice form, else null.
    // Recognises: integers, simple fractions (denom ≤ 24), and n/d·√k for k ∈ {2,3,5,6,7}.
    niceRealHTML(value) {
        if (!isFinite(value)) return null;
        const tol = 5e-6;
        if (Math.abs(value) < tol) return '0';
        const sign = value < 0 ? -1 : 1;
        const abs  = Math.abs(value);
        // Integer
        const ri = Math.round(abs);
        if (Math.abs(abs - ri) < tol) return sign < 0 ? `-${ri}` : `${ri}`;
        // Simple fraction
        for (let d = 2; d <= 24; d++) {
            const n = Math.round(abs * d);
            if (n > 0 && Math.abs(abs - n / d) < tol) {
                const g = this._gcd(n, d); const sn = n / g; const sd = d / g;
                if (sd > 1 && sd <= 24) return (sign < 0 ? '-' : '') + sn + '/' + sd;
            }
        }
        // Rational multiple of √k
        for (const k of [2, 3, 5, 6, 7]) {
            const sqK = Math.sqrt(k);
            const ratio = abs / sqK;
            for (let d = 1; d <= 12; d++) {
                const n = Math.round(ratio * d);
                if (n > 0 && Math.abs(ratio - n / d) < tol) {
                    const g = this._gcd(n, d); const sn = n / g; const sd = d / g;
                    const rad = `&radic;${k}`;
                    let part;
                    if      (sn === 1 && sd === 1) part = rad;
                    else if (sd === 1)              part = `${sn}${rad}`;
                    else if (sn === 1)              part = `${rad}/${sd}`;
                    else                           part = `${sn}${rad}/${sd}`;
                    return (sign < 0 ? '-' : '') + part;
                }
            }
        }
        return null;
    }

    niceAngleLatex(theta) {
        if (!isFinite(theta)) return null;
        if (Math.abs(theta) < 1e-9) return '0';
        for (let d = 1; d <= 30; d++) {
            const nd      = theta / Math.PI * d;
            const rounded = Math.round(nd);
            if (rounded === 0) continue;
            if (Math.abs(nd - rounded) < 0.002) {
                const g   = this._gcd(Math.abs(rounded), d);
                const sn  = rounded / g;
                const sd  = d / g;
                const neg = sn < 0 ? '-' : '';
                const absN = Math.abs(sn);
                if (sd === 1) return absN === 1 ? `${neg}\\pi` : `${neg}${absN}\\pi`;
                return absN === 1 ? `${neg}\\frac{\\pi}{${sd}}` : `${neg}\\frac{${absN}\\pi}{${sd}}`;
            }
        }
        return null;
    }

    formatComplexLatex(re, im, fmt) {
        const r     = Math.hypot(re, im);
        const theta = Math.atan2(im, re);
        switch (fmt) {
            case 'exponential': {
                if (r < 1e-10) return '0';
                const rStr  = this.niceRealLatex(r)              ?? this.formatNumberShort(r);
                const absθ  = Math.abs(theta);
                const thStr = this.niceAngleLatex(absθ)          ?? this.formatNumberShort(absθ);
                const sign  = theta < -1e-10 ? '-' : '';
                const rPart = Math.abs(r - 1) < 1e-9 ? '' : rStr;
                return `${rPart}e^{${sign}i${thStr}}`;
            }
            case 'trig': {
                if (r < 1e-10) return '0';
                const rStr  = this.niceRealLatex(r)              ?? this.formatNumberShort(r);
                const thStr = this.niceAngleLatex(theta)         ?? this.formatNumberShort(theta);
                const trig  = `\\cos(${thStr})+i\\sin(${thStr})`;
                return Math.abs(r - 1) < 1e-9 ? trig : `${rStr}(${trig})`;
            }
            default:
                return this.formatCartesianLatex(re, im);
        }
    }

    // Strips HTML entities/tags from niceRealHTML / niceAngleHTML output to plain text.
    deHtmlify(s) {
        return String(s)
            .replace(/&pi;/g, 'π').replace(/&radic;/g, '√').replace(/&thinsp;/g, '')
            .replace(/<sup>([^<]*)<\/sup>/g, '^($1)').replace(/<[^>]+>/g, '');
    }

    formatComplexPlain(re, im, fmt) {
        const r     = Math.hypot(re, im);
        const theta = Math.atan2(im, re);
        const rTxt  = this.deHtmlify(this.niceRealHTML(r)              ?? this.formatNumber(r));
        const rPart = Math.abs(r - 1) < 1e-9 ? '' : rTxt;
        switch (fmt) {
            case 'exponential': {
                if (r < 1e-10) return '0';
                const absθ  = Math.abs(theta);
                const thTxt = this.deHtmlify(this.niceAngleHTML(absθ)  ?? this.formatNumber(absθ));
                const sign  = theta < -1e-10 ? '-' : '';
                return `${rPart}e^(${sign}i·${thTxt})`;
            }
            case 'trig': {
                if (r < 1e-10) return '0';
                const thTxt = this.deHtmlify(this.niceAngleHTML(theta) ?? this.formatNumber(theta));
                const trig  = `cos(${thTxt}) + i·sin(${thTxt})`;
                return Math.abs(r - 1) < 1e-9 ? trig : `${rTxt}(${trig})`;
            }
            default: {
                const aStr  = this.deHtmlify(this.niceRealHTML(re)              ?? this.formatNumber(re));
                const bAbs  = this.deHtmlify(this.niceRealHTML(Math.abs(im))    ?? this.formatNumber(Math.abs(im)));
                if (Math.abs(im) < 1e-10) return aStr;
                if (Math.abs(re) < 1e-10) return `${im < 0 ? '-' : ''}${bAbs}i`;
                return `${aStr}${im < -1e-10 ? ' - ' : ' + '}${bAbs}i`;
            }
        }
    }

    // Returns an HTML string if theta (radians) is a multiple of π/24, else null.
    niceAngleHTML(theta) {
        if (!isFinite(theta)) return null;
        if (Math.abs(theta) < 1e-9) return '0';
        // Try each denominator in turn; the smallest d that works gives the canonical form.
        for (let d = 1; d <= 30; d++) {
            const nd      = theta / Math.PI * d;
            const rounded = Math.round(nd);
            if (rounded === 0) continue;
            if (Math.abs(nd - rounded) < 0.002) {
                const g    = this._gcd(Math.abs(rounded), d);
                const sn   = rounded / g;
                const sd   = d / g;
                const neg  = sn < 0 ? '-' : '';
                const absN = Math.abs(sn);
                if (sd === 1) return absN === 1 ? `${neg}&pi;` : `${neg}${absN}&pi;`;
                return absN === 1 ? `${neg}&pi;/${sd}` : `${neg}${absN}&pi;/${sd}`;
            }
        }
        return null;
    }

    // ---- Info panel format methods ----

    formatComplexValue(re, im, r, theta) {
        switch (this.infoFormat) {
            case 'exponential': {
                if (Math.abs(r) < 1e-10) return '0';
                const rStr  = this.niceRealHTML(r)              ?? this.formatNumber(r);
                const absθ  = Math.abs(theta);
                const thStr = this.niceAngleHTML(absθ)          ?? this.formatNumber(absθ);
                const sign  = theta < -1e-10 ? '-' : '';
                return `${rStr}&thinsp;e<sup>${sign}i(${thStr})</sup>`;
            }
            case 'trig': {
                if (Math.abs(r) < 1e-10) return '0';
                const rStr  = this.niceRealHTML(r)              ?? this.formatNumber(r);
                const thStr = this.niceAngleHTML(theta)         ?? this.formatNumber(theta);
                return `${rStr}(cos(${thStr}) + i&thinsp;sin(${thStr}))`;
            }
            default:
                return this.formatCartesianHTML(re, im);
        }
    }

    formatCartesianHTML(re, im) {
        const aStr = this.niceRealHTML(re)          ?? this.formatNumber(re);
        const bAbs = this.niceRealHTML(Math.abs(im)) ?? this.formatNumber(Math.abs(im));
        if (Math.abs(im) < 1e-10) return aStr;
        if (Math.abs(re) < 1e-10) return im < -1e-10 ? `-${bAbs}i` : `${bAbs}i`;
        const sign = im < -1e-10 ? ' - ' : ' + ';
        return `${aStr}${sign}${bAbs}i`;
    }

    formatArgument(theta) {
        const deg    = theta * 180 / Math.PI;
        const niceθ  = this.niceAngleHTML(theta);
        const radStr = niceθ ? `${niceθ} rad` : `${this.formatNumber(theta)} rad`;
        return `${radStr} (${this.formatNumber(deg)}&deg;)`;
    }

    drawExpressions() {
        if (!this.expressions.length) return;
        const ctx     = this.ctx;
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const fSize       = this.sizeMode === 'xlarge' ? 26 : this.sizeMode === 'large' ? 22 : 18;
        const dotR        = this.sizeMode === 'xlarge' ? 8.5 : this.sizeMode === 'large' ? 7 : 6;
        const strokeWidth = this.sizeMode === 'xlarge' ? 5  : this.sizeMode === 'large' ? 4  : 3;
        const headLen     = this.sizeMode === 'xlarge' ? 15 : this.sizeMode === 'large' ? 13 : 11;

        for (const c of this.expressions) {
            if (!c.enabled) continue;

            // --- Equation: draw each root using the global display mode ---
            if (c.type === 'equation' && c.roots?.length) {
                const toSub = n => String(n).split('').map(d => '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089'[d]).join('');
                const org   = this.worldToScreen(0, 0);
                for (let k = 0; k < c.roots.length; k++) {
                    const root = c.roots[k];
                    if (!isFinite(root.re) || !isFinite(root.im)) continue;
                    const pt = this.worldToScreen(root.re, root.im);

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
                            ctx.fillStyle = c.color;
                            ctx.beginPath();
                            ctx.moveTo(tipX, tipY);
                            ctx.lineTo(tipX - headLen * Math.cos(ang - 0.38), tipY - headLen * Math.sin(ang - 0.38));
                            ctx.lineTo(tipX - headLen * Math.cos(ang + 0.38), tipY - headLen * Math.sin(ang + 0.38));
                            ctx.closePath();
                            ctx.fill();
                            ctx.restore();
                        }
                    }

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

                    if (c.equationVar) {
                        const label = c.equationVar + toSub(k + 1);
                        ctx.save();
                        ctx.font        = `italic ${fSize}px Arial`;
                        ctx.globalAlpha = 1;
                        const lx = pt.x + dotR + 4;
                        const ly = pt.y - dotR - 2;
                        ctx.fillStyle = c.color;
                        ctx.fillText(label, lx, ly);
                        ctx.restore();
                    }
                }
                continue;
            }

            if (c.type === 'locus' && c.locus && c.equationVar) {
                const fp = c.locus.fastPath;
                const fastSegments = this._traceFastLocusSegments(c.locus);
                let segments;
                if (fastSegments !== null) {
                    segments = fastSegments;
                } else {
                    const vp = this.viewport;
                    const cached = c._locusCache;
                    const fresh = cached &&
                        cached.minX === vp.minX && cached.maxX === vp.maxX &&
                        cached.minY === vp.minY && cached.maxY === vp.maxY;
                    if (fresh) {
                        segments = cached.segments;
                    } else if (cached) {
                        segments = cached.segments; // stale during pan/zoom; retrace deferred
                        this._scheduleLocusRetrace();
                    } else {
                        segments = this._traceLocusSegments(c.locus, c.equationVar, c.id);
                        c._locusCache = { segments, minX: vp.minX, maxX: vp.maxX, minY: vp.minY, maxY: vp.maxY };
                    }
                }
                if (!segments?.length) continue;
                ctx.save();
                ctx.strokeStyle = c.color;
                ctx.lineWidth = Math.max(2, strokeWidth - 0.5);
                ctx.globalAlpha = 0.95;
                ctx.beginPath();
                for (const [start, end] of segments) {
                    const p0 = this.worldToScreen(start.x, start.y);
                    const p1 = this.worldToScreen(end.x, end.y);
                    ctx.moveTo(p0.x, p0.y);
                    ctx.lineTo(p1.x, p1.y);
                }
                ctx.stroke();
                ctx.restore();

                // Draw F₁/F₂ foci if the locus has focus points and they are enabled
                if (c.showFoci !== false && fp?.focusA && fp?.focusB) {
                    const fDotR = Math.max(3, dotR - 1.5);
                    for (const [idx, focus] of [[1, fp.focusA], [2, fp.focusB]]) {
                        const fp2 = this.worldToScreen(focus.re, focus.im);
                        ctx.save();
                        ctx.fillStyle   = c.color;
                        ctx.globalAlpha = 0.75;
                        ctx.beginPath();
                        ctx.arc(fp2.x, fp2.y, fDotR, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.strokeStyle = isLight ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.55)';
                        ctx.lineWidth   = 1.5;
                        ctx.stroke();
                        ctx.globalAlpha = 0.9;
                        ctx.font      = `italic ${fSize}px Arial`;
                        ctx.fillStyle = c.color;
                        const sub = idx === 1 ? '\u2081' : '\u2082';
                        ctx.fillText(`F${sub}`, fp2.x + fDotR + 3, fp2.y - fDotR - 2);
                        ctx.restore();
                    }
                }

                continue;
            }

            // --- Constant: existing drawing logic ---
            if (c.re === null || c.im === null) continue;
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

            // Label: only draw if the expression has a user-assigned name
            if (c.name) {
                ctx.save();
                ctx.font        = `italic ${fSize}px Arial`;
                ctx.globalAlpha = 1;
                const lx = pt.x + dotR + 4;
                const ly = pt.y - dotR - 2;
                ctx.fillStyle = c.color;
                ctx.fillText(c.name, lx, ly);
                ctx.restore();
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new Komplexiti();
});
