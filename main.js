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

        // ---- Temporary session flag (set when loaded from a shared link) ----
        this.tempSession = false;

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
        this.checkAndApplySharedState();
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
                                    { latex: 'z', label: 'z' },
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
                                    {
                                        latex: '<', label: '<',
                                        shift: { latex: '\\leq', label: '≤' }
                                    },
                                    {
                                        latex: '>', label: '>',
                                        shift: { latex: '\\geq', label: '≥' }
                                    },
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
                                        latex: '=',
                                        label: '=',
                                        shift: { latex: '.', label: '.' }
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

        this.setupShareMenu();

        // Export overlay controls
        const exportOverlay = document.getElementById('export-overlay');
        const exportCancelButton = document.getElementById('export-cancel-button');
        const exportGenerateButton = document.getElementById('export-generate-button');
        const exportImageBtn = document.getElementById('export-image-btn');

        if (exportImageBtn) {
            exportImageBtn.addEventListener('click', () => this.toggleExportOverlay(true));
        }

        if (exportOverlay) {
            exportOverlay.addEventListener('click', (e) => {
                if (e.target === exportOverlay) this.toggleExportOverlay(false);
            });
            exportOverlay.addEventListener('change', (e) => {
                const target = e.target;
                if (!target?.matches('input, select')) return;
                if (target.name === 'export-format' ||
                    target.id === 'export-include-axes' ||
                    target.id === 'export-include-axis-labels') {
                    this.updateExportFormatUI();
                } else {
                    this.requestExportPreviewUpdate();
                }
            });
        }

        if (exportCancelButton) {
            exportCancelButton.addEventListener('click', () => this.toggleExportOverlay(false));
        }

        if (exportGenerateButton) {
            exportGenerateButton.addEventListener('click', () => this.exportCurrentViewFromModal());
        }

        window.addEventListener('hashchange', () => {
            const state = this.checkForSharedState();
            if (!state) return;
            this.tempSession = true;
            if (this.currentState !== this.states.APP) this.launchApp();
            this.applySharedState(state);
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
        this.toggleExportOverlay(false);

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
        this._drawIntersectionBadges(ctx);
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

        this.canvas.addEventListener('mousemove', (e) => {
            if (this.currentState !== this.states.APP) return;
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            // Cursor: pointer when hovering an intersection dot or badge close button
            const onDot   = this._locusIntersectionHits?.some(t => Math.hypot(mx - t.x, my - t.y) < t.hitR);
            const onClose = this._intersectionBadges?.some(b => b.closeBtn &&
                mx >= b.closeBtn.x && mx <= b.closeBtn.x + b.closeBtn.w &&
                my >= b.closeBtn.y && my <= b.closeBtn.y + b.closeBtn.h);
            this.canvas.style.cursor = (onDot || onClose) ? 'pointer' : '';
            const tooltip = document.getElementById('extrema-tooltip');
            if (!tooltip || !this._extremaHitTargets?.length) { if (tooltip) tooltip.style.display = 'none'; return; }
            const hit = this._extremaHitTargets.find(t => Math.hypot(mx - t.x, my - t.y) < t.r);
            if (hit) {
                tooltip.textContent = hit.text;
                const pad = 16, tw = 250;
                let tx = e.clientX + pad;
                let ty = e.clientY - pad - 40;
                if (tx + tw > window.innerWidth)  tx = e.clientX - tw - pad;
                if (ty < 4) ty = e.clientY + pad;
                tooltip.style.left    = tx + 'px';
                tooltip.style.top     = ty + 'px';
                tooltip.style.display = 'block';
            } else {
                tooltip.style.display = 'none';
            }
        });
        this.canvas.addEventListener('mouseleave', () => {
            const tooltip = document.getElementById('extrema-tooltip');
            if (tooltip) tooltip.style.display = 'none';
            this.canvas.style.cursor = '';
        });
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
        if (!this.input.dragging) {
            const mx = this.input.mouse.x, my = this.input.mouse.y;
            // Close button hit takes priority
            if (this._intersectionBadges?.length) {
                const closeHit = this._intersectionBadges.find(b => b.closeBtn &&
                    mx >= b.closeBtn.x && mx <= b.closeBtn.x + b.closeBtn.w &&
                    my >= b.closeBtn.y && my <= b.closeBtn.y + b.closeBtn.h);
                if (closeHit) {
                    this._intersectionBadges = this._intersectionBadges.filter(b => b !== closeHit);
                    this.input.mouse.down = false;
                    this.input.dragging = false;
                    this.input.viewportPanActive = false;
                    this.drawCanvas();
                    return;
                }
            }
            // Toggle badge on intersection dot click
            if (this._locusIntersectionHits?.length) {
                const hit = this._locusIntersectionHits.find(t => Math.hypot(mx - t.x, my - t.y) < t.hitR);
                if (hit) {
                    this._showIntersectionBadge(hit.re, hit.im, hit.exprIds);
                    this.drawCanvas();
                }
            }
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
            const exportOverlay = document.getElementById('export-overlay');
            if (exportOverlay?.classList.contains('show')) {
                this.toggleExportOverlay(false);
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
        document.querySelectorAll('.expr-card math-field:not(.asymptote-equation-field)').forEach(f => this.applyMathFieldTheme(f));
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
            </div>
            <div class="extrema-info-container">
                <div class="metadata-title-row">
                    <button class="metadata-visibility-toggle extrema-visibility-toggle" aria-label="Toggle extrema" title="Toggle extrema on diagram" tabindex="-1"></button>
                    <div class="extrema-info-title">Extrema</div>
                </div>
                <div class="extrema-info-list"></div>
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
            c.compoundParts = null;

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
            } else if (raw.includes('=') || /[<>]/.test(raw) || /\\leq|\\geq|\\le(?![a-zA-Z])|\\ge(?![a-zA-Z])|\\lt(?![a-zA-Z])|\\gt(?![a-zA-Z])/.test(raw)) {
                // Not a simple name=value assignment — try to solve as an equation or inequality
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
                    if (eq.type === 'compound-locus') {
                        c.compoundParts = eq.loci.map(locus => ({
                            locus, equationVar: eq.variable, id: c.id, color: c.color, _locusCache: null, enabled: true,
                        }));
                    }
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
            this._intersectionBadges = [];
            if (this.currentState === this.states.APP) this.drawCanvas();
        });

        removeBtn.addEventListener('click', () => this.removeExpression(c.id));

        const fociToggleBtn = card.querySelector('.foci-visibility-toggle');
        fociToggleBtn.addEventListener('click', () => {
            c.showFoci = (c.showFoci !== false) ? false : true;
            this.updateCardMetadata(c);
            if (this.currentState === this.states.APP) this.drawCanvas();
        });

        const extremaToggleBtn = card.querySelector('.extrema-visibility-toggle');
        extremaToggleBtn.addEventListener('click', () => {
            c.showExtrema = (c.showExtrema !== false) ? false : true;
            this.updateCardMetadata(c);
            if (this.currentState === this.states.APP) this.drawCanvas();
        });

        dot.addEventListener('click', () => {
            c.enabled = !c.enabled;
            dot.style.opacity      = c.enabled ? '1' : '0.3';
            mathField.style.opacity = c.enabled ? '1' : '0.4';
            this.updateCardMetadata(c);
            this.saveExpressions();
            this._intersectionBadges = (this._intersectionBadges || []).filter(b => !b.exprIds?.includes(c.id));
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
            mathField.inlineShortcuts = {
                ...mathField.inlineShortcuts,
                abs:  { mode: 'math', value: '\\left|#?\\right|' },
                mod:  { mode: 'math', value: '\\left|#?\\right|' },
                conj: { mode: 'math', value: '\\overline{#?}' }
            };
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
        this._intersectionBadges = [];
        if (this.currentState === this.states.APP) this.drawCanvas();
    }

    saveExpressions() {
        if (this.tempSession) return; // never overwrite saved state during a shared session
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
            for (const latex of ['a=\\sqrt{2}\\left(1-i\\right)', 'z^3=1', '\\left|z-\\sqrt{2}\\left(1+i\\right)\\right|=1']) {
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
                } else if (!assignment && (raw.includes('=') || /[<>]/.test(raw) || /\\leq|\\geq|\\le(?![a-zA-Z])|\\ge(?![a-zA-Z])|\\lt(?![a-zA-Z])|\\gt(?![a-zA-Z])/.test(raw))) {
                    const eq = this.parseEquation(raw, c.id);
                    if (eq) {
                        c.type = eq.type;
                        c.roots = eq.roots ?? null;
                        c.equationVar = eq.variable;
                        if (c.locus !== eq.locus) c._locusCache = null;
                        c.locus = eq.locus ?? null;
                        c.hasParseError = false;
                        c.errorMessage = '';
                        if (eq.type === 'compound-locus') {
                            c.compoundParts = eq.loci.map(locus => ({
                                locus, equationVar: eq.variable, id: c.id, color: c.color, _locusCache: null, enabled: true,
                            }));
                        } else {
                            c.compoundParts = null;
                        }
                    } else {
                        c.type = 'value';
                        c.roots = null;
                        c.equationVar = null;
                        c.locus = null;
                        c.compoundParts = null;
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
        // Negative lookbehind prevents matching a letter that is itself part of a LaTeX command (e.g. 'e' in \le\arctan).
        e = e.replace(/(?<![a-zA-Z])([a-zA-Z0-9])\\(sqrt|sin|cos|tan|ln|log|exp|sinh|cosh|tanh|arcsin|arccos|arctan|arcsinh|arccosh|arctanh)\b/g, '$1*\\$2');
        for (let p = 0; p < 4; p++) {
            // Flatten exponent braces first so a braced exponent inside a \frac argument
            // (e.g. \frac{1}{z^{-2}}) doesn't defeat the [^{}]* nested-brace-free match below.
            e = e.replace(/\^\s*\{([^{}]+)\}/g, '^($1)');
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
        // Convert LaTeX inequality operators before abs replacement to prevent \le concatenating with abs
        e = e.replace(/\\leq(?![a-zA-Z])/g, '<=');
        e = e.replace(/\\geq(?![a-zA-Z])/g, '>=');
        e = e.replace(/\\le(?![a-zA-Z])/g, '<=');
        e = e.replace(/\\ge(?![a-zA-Z])/g, '>=');
        e = e.replace(/\\lt(?![a-zA-Z])/g, '<');
        e = e.replace(/\\gt(?![a-zA-Z])/g, '>');
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
        // Parse the full rest expression directly so multi-term offsets like -1+2i
        // are evaluated as (-1+2i) rather than -(1+2i).
        const parsed = this.parseComplexFromLatex(rest, scope);
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

    // Extract the inner expression of "arg(...)" when it occupies the entire expr string.
    _extractArgInner(expr) {
        const e = expr.replace(/\s+/g, '');
        if (!e.startsWith('arg(')) return null;
        let depth = 0, closeIdx = -1;
        for (let i = 3; i < e.length; i++) {
            if (e[i] === '(') depth++;
            else if (e[i] === ')') { depth--; if (depth === 0) { closeIdx = i; break; } }
        }
        return closeIdx === e.length - 1 ? e.slice(4, closeIdx) : null;
    }

    // Match "A/B" (slash at depth 0) where A and B are each affine in varName.
    _tryExtractLinearFraction(inner, varName, scope) {
        let e = inner.replace(/\s+/g, '');
        // Strip outer matched-paren wrappers so "((z-1)/(z+1))" → "(z-1)/(z+1)"
        while (e.startsWith('(') && e.endsWith(')')) {
            let d = 0, wraps = true;
            for (let k = 0; k < e.length - 1; k++) {
                if (e[k] === '(') d++;
                else if (e[k] === ')') { d--; if (d === 0) { wraps = false; break; } }
            }
            if (!wraps) break;
            e = e.slice(1, -1);
        }
        let depth = 0, slashAt = -1;
        for (let i = 0; i < e.length; i++) {
            if (e[i] === '(') depth++;
            else if (e[i] === ')') depth--;
            else if (e[i] === '/' && depth === 0) { slashAt = i; break; }
        }
        if (slashAt < 0) return null;
        const zeroA = this._extractLinearZero(e.slice(0, slashAt), varName, scope);
        const zeroB = this._extractLinearZero(e.slice(slashAt + 1), varName, scope);
        if (!zeroA || !zeroB) return null;
        return { a: zeroA, b: zeroB };
    }

    // Return the zero of a linear expression az+b in varName, or null if not linear.
    _extractLinearZero(expr, varName, scope) {
        try {
            const node = math.parse(expr);
            const ev = z => this._mathValueToComplex(node.evaluate({ ...scope, [varName]: math.complex(z, 0) }));
            const v0 = ev(0), v1 = ev(1), v2 = ev(2);
            if (!v0 || !v1 || !v2) return null;
            const aRe = v1.re - v0.re, aIm = v1.im - v0.im;
            if (Math.hypot(aRe, aIm) < 1e-9) return null; // constant - no zero
            // Verify linearity
            if (Math.abs(v2.re - (2*v1.re - v0.re)) > 1e-6 || Math.abs(v2.im - (2*v1.im - v0.im)) > 1e-6) return null;
            const den = aRe*aRe + aIm*aIm;
            return { re: -(v0.re*aRe + v0.im*aIm) / den, im: -(v0.im*aRe - v0.re*aIm) / den };
        } catch { return null; }
    }

    // Match "arg(A) - arg(B)" where A and B are each affine in varName.
    _tryExtractArgDifferencePair(expr, varName, scope) {
        const e = expr.replace(/\s+/g, '');
        if (!e.startsWith('arg(')) return null;
        let depth = 1, i = 4;
        for (; i < e.length && depth > 0; i++) {
            if (e[i] === '(') depth++; else if (e[i] === ')') depth--;
        }
        const innerA = e.slice(4, i - 1);
        const rest = e.slice(i);
        if (!rest.startsWith('-arg(') || !rest.endsWith(')')) return null;
        const argBStr = rest.slice(1);
        let d2 = 1, closeB = -1;
        for (let j = 4; j < argBStr.length; j++) {
            if (argBStr[j] === '(') d2++;
            else if (argBStr[j] === ')') { d2--; if (d2 === 0) { closeB = j; break; } }
        }
        if (closeB !== argBStr.length - 1) return null;
        const innerB = argBStr.slice(4, closeB);
        const zeroA = this._extractLinearZero(innerA, varName, scope);
        const zeroB = this._extractLinearZero(innerB, varName, scope);
        if (!zeroA || !zeroB) return null;
        return { a: zeroA, b: zeroB };
    }

    // Build inscribed-arc fast path for arg(z-a) - arg(z-b) = theta.
    // Center and radius are derived from the inscribed-angle theorem.
    _buildInscribedArcFastPath(a, b, theta, lhs, rhs) {
        const dx = a.re - b.re, dy = a.im - b.im;
        const chordLen = Math.hypot(dx, dy);
        if (chordLen < 1e-9) return null;
        const sinTheta = Math.sin(theta);
        if (Math.abs(sinTheta) < 1e-9) return null; // theta = 0 or ±π: degenerate
        const mid = { re: (a.re + b.re) / 2, im: (a.im + b.im) / 2 };
        // C = midpoint + cot(theta)/2 * left_normal(a-b), left_normal(dx,dy) = (-dy, dx)
        const cotFactor = Math.cos(theta) / (2 * sinTheta);
        const center = { re: mid.re + cotFactor * (-dy), im: mid.im + cotFactor * dx };
        const radius  = chordLen / (2 * Math.abs(sinTheta));
        return { lhs, rhs, angular: true, scalar: true,
            fastPath: { kind: 'inscribed-arc', a, b, theta, center, radius } };
    }

    // Detect k*arg(z-a) - k*arg(z-b) = theta  and  k*arg((z-a)/(z-b)) = theta.
    // Also handles a leading coefficient k on the arg side (e.g. 4*arg(...) = pi).
    _tryBuildInscribedArcLocus(lhs, rhs, varName, scope) {
        for (const [side, thetaSide] of [[lhs, rhs], [rhs, lhs]]) {
            const thetaRaw = this._evaluateRealExpr(thetaSide, scope);
            if (thetaRaw === null || !isFinite(thetaRaw)) continue;

            // Strip an optional leading coefficient: k*arg(...) or karg(...) → argExpr=arg(...), theta=thetaRaw/k
            let argExpr = side.replace(/\s+/g, '');
            let theta = thetaRaw;
            if (!argExpr.startsWith('arg(')) {
                const argIdx = argExpr.indexOf('arg(');
                if (argIdx > 0) {
                    // Accept both "4*arg(" and "4arg(" by stripping a trailing * if present
                    const prefix = argExpr[argIdx - 1] === '*' ? argExpr.slice(0, argIdx - 1) : argExpr.slice(0, argIdx);
                    const scale = this._evaluateRealExpr(prefix, scope);
                    if (scale !== null && Math.abs(scale) > 1e-9) {
                        theta = thetaRaw / scale;
                        argExpr = argExpr.slice(argIdx);
                    }
                }
            }

            if (Math.abs(theta) < 1e-9 || Math.abs(Math.abs(theta) - Math.PI) < 1e-9) continue;

            const diffPair = this._tryExtractArgDifferencePair(argExpr, varName, scope);
            if (diffPair) return this._buildInscribedArcFastPath(diffPair.a, diffPair.b, theta, lhs, rhs);
            const argInner = this._extractArgInner(argExpr);
            if (argInner) {
                const fracPair = this._tryExtractLinearFraction(argInner, varName, scope);
                if (fracPair) return this._buildInscribedArcFastPath(fracPair.a, fracPair.b, theta, lhs, rhs);
            }
        }
        return null;
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
        // Also handle ratio form: abs(z-a)/abs(z-b) = k  (equivalent Apollonius)
        const stripOuterParens = (s) => {
            let e = s.replace(/\s+/g, '');
            for (;;) {
                if (!e.startsWith('(') || !e.endsWith(')')) break;
                let d = 0, wraps = true;
                for (let i = 0; i < e.length - 1; i++) {
                    if (e[i] === '(') d++;
                    else if (e[i] === ')') { d--; if (d === 0) { wraps = false; break; } }
                }
                if (!wraps) break;
                e = e.slice(1, -1);
            }
            return e;
        };
        for (const [ratioSide, kSide] of [[lhs, rhs], [rhs, lhs]]) {
            const e = stripOuterParens(ratioSide);
            let depth = 0, slashAt = -1;
            for (let i = 0; i < e.length; i++) {
                if (e[i] === '(') depth++;
                else if (e[i] === ')') depth--;
                else if (e[i] === '/' && depth === 0) { slashAt = i; break; }
            }
            if (slashAt < 0) continue;
            const numInner = this._matchFunctionTerm(stripOuterParens(e.slice(0, slashAt)), 'abs', varName);
            const denInner = this._matchFunctionTerm(stripOuterParens(e.slice(slashAt + 1)), 'abs', varName);
            if (!numInner || !denInner) continue;
            const numLinear = this._parseLinearVarOffset(numInner, varName, scope);
            const denLinear = this._parseLinearVarOffset(denInner, varName, scope);
            if (!numLinear || !denLinear) continue;
            const k = this._evaluateRealExpr(kSide, scope);
            if (k === null || k <= 0 || Math.abs(k - 1) < 1e-6) continue;
            const a = { re: -numLinear.offset.re, im: -numLinear.offset.im };
            const b = { re: -denLinear.offset.re, im: -denLinear.offset.im };
            const k2 = k * k, denom = 1 - k2;
            if (Math.abs(denom) < 1e-9) continue;
            const center = { re: (a.re - k2 * b.re) / denom, im: (a.im - k2 * b.im) / denom };
            const radius = k * Math.hypot(a.re - b.re, a.im - b.im) / Math.abs(denom);
            if (radius > 0 && isFinite(radius) && isFinite(center.re) && isFinite(center.im))
                return { lhs, rhs, angular: false, scalar: true, fastPath: { kind: 'apollonius', center, radius, focusA: a, focusB: b, ratio: k } };
        }
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
                            focusA: a, focusB: b,
                            perpBisector: true
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
                const pt = axis === 'vertical'
                    ? { re: constant - linear.offset.re, im: 0 }
                    : { re: 0, im: constant - linear.offset.im };
                // focusA: where lhs < rhs (dir=-1); focusB: where lhs > rhs (dir=1)
                const grad = axis === 'vertical' ? { re: 1, im: 0 } : { re: 0, im: 1 };
                return {
                    lhs,
                    rhs,
                    angular: false,
                    scalar: true,
                    fastPath: {
                        kind: 'line',
                        point: pt,
                        direction: axis === 'vertical' ? { re: 0, im: 1 } : { re: 1, im: 0 },
                        focusA: { re: pt.re - grad.re, im: pt.im - grad.im },
                        focusB: { re: pt.re + grad.re, im: pt.im + grad.im }
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

        const inscribedArc = this._tryBuildInscribedArcLocus(lhs, rhs, varName, scope);
        if (inscribedArc) return inscribedArc;

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

    // For equations whose LHS-RHS is complex-valued (scalar=false), the zero set is
    // generically a finite set of isolated points, not a curve.  Sample a coarse grid,
    // find local minima of |h|, and refine each via 2-D Newton.  Returns the roots, or
    // null if there are too many candidates (suggesting a 1-D solution curve instead).
    _findComplexEquationRootsNumerically(lhs, rhs, varName, scope) {
        const hExpr = `(${lhs}) - (${rhs})`;
        let hNode;
        try { hNode = math.parse(hExpr); } catch { return null; }

        const evalH = (x, y) => {
            try {
                const v = hNode.evaluate({ ...scope, [varName]: math.complex(x, y) });
                if (typeof v === 'number') return { re: v, im: 0 };
                return { re: v.re ?? 0, im: v.im ?? 0 };
            } catch { return null; }
        };
        const mag = v => v ? Math.hypot(v.re, v.im) : Infinity;

        // Coarse grid over [-10,10]^2; step=0.5 keeps integer coordinates on exact grid points
        const R = 10, step = 0.5, N = Math.ceil(2 * R / step);
        const grid = [];
        for (let iy = 0; iy <= N; iy++) {
            grid.push([]);
            for (let ix = 0; ix <= N; ix++) {
                const x = -R + ix * step, y = -R + iy * step;
                grid[iy].push({ x, y, m: mag(evalH(x, y)) });
            }
        }

        // Collect strict local minima (smaller than all 8 neighbours)
        const candidates = [];
        for (let iy = 1; iy < N; iy++) {
            for (let ix = 1; ix < N; ix++) {
                const m = grid[iy][ix].m;
                if (!isFinite(m)) continue;
                let isMin = true;
                outer: for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        if ((grid[iy + dy]?.[ix + dx]?.m ?? Infinity) <= m) { isMin = false; break outer; }
                    }
                }
                if (isMin) candidates.push(grid[iy][ix]);
            }
        }

        // Many local minima indicates a 1-D zero set (curve) - defer to locus tracer
        if (candidates.length > 25) return null;

        // 2-D Newton refinement for each candidate
        const roots = [];
        for (const cand of candidates) {
            let { x, y } = cand;
            for (let iter = 0; iter < 50; iter++) {
                const h = evalH(x, y);
                if (!h || !isFinite(h.re) || !isFinite(h.im)) break;
                if (Math.hypot(h.re, h.im) < 1e-10) break;
                const d = 1e-6;
                const hxp = evalH(x + d, y), hxm = evalH(x - d, y);
                const hyp = evalH(x, y + d), hym = evalH(x, y - d);
                if (!hxp || !hxm || !hyp || !hym) break;
                const dRe_dx = (hxp.re - hxm.re) / (2 * d);
                const dRe_dy = (hyp.re - hym.re) / (2 * d);
                const dIm_dx = (hxp.im - hxm.im) / (2 * d);
                const dIm_dy = (hyp.im - hym.im) / (2 * d);
                const det = dRe_dx * dIm_dy - dRe_dy * dIm_dx;
                if (Math.abs(det) < 1e-12) break;
                const stepX = (h.re * dIm_dy - h.im * dRe_dy) / det;
                const stepY = (h.im * dRe_dx - h.re * dIm_dx) / det;
                x -= stepX; y -= stepY;
                if (Math.hypot(stepX, stepY) < 1e-10) break;
            }
            if (mag(evalH(x, y)) > 1e-6) continue;
            const isDup = roots.some(r => Math.hypot(r.re - x, r.im - y) < 1e-4);
            if (!isDup) roots.push({ re: x, im: y });
        }
        return roots.length > 0 ? roots : null;
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
                if (c.type === 'compound-locus' && c.compoundParts) {
                    const parts = c.compoundParts;
                    const anyStale = parts.some(p => {
                        const cc = p._locusCache;
                        return !(cc && cc.minX === vp.minX && cc.maxX === vp.maxX && cc.minY === vp.minY && cc.maxY === vp.maxY);
                    });
                    if (anyStale) {
                        const combined = parts.length === 2 && parts[0].locus.lhs === parts[1].locus.lhs
                            ? this._traceCompoundPartsWithShade(parts[0].locus, parts[1].locus, parts[0].equationVar, parts[0].id)
                            : null;
                        if (combined) {
                            for (let i = 0; i < 2; i++) {
                                parts[i]._locusCache = { ...combined[i], minX: vp.minX, maxX: vp.maxX, minY: vp.minY, maxY: vp.maxY };
                            }
                        } else {
                            for (const part of parts) {
                                part._locusCache = {
                                    segments: this._traceLocusSegments(part.locus, part.equationVar, part.id),
                                    shadeGrid: this._buildLocusShadeGrid(part.locus, part.equationVar, part.id),
                                    minX: vp.minX, maxX: vp.maxX, minY: vp.minY, maxY: vp.maxY
                                };
                            }
                        }
                        retraced = true;
                    }
                }
                if (c.type !== 'locus' || !c.locus || !c.equationVar) continue;
                const cached = c._locusCache;
                if (cached && cached.minX === vp.minX && cached.maxX === vp.maxX &&
                    cached.minY === vp.minY && cached.maxY === vp.maxY) continue;
                if (c.locus.fastPath) {
                    // Fast-path loci need a shade grid rebuild only (segments come from geometry)
                    if (!c.locus.inequality) continue;
                    const fpKind = c.locus.fastPath.kind;
                    if (fpKind === 'circle' || fpKind === 'apollonius' || fpKind === 'ray' || fpKind === 'line' || fpKind === 'inscribed-arc') continue;
                    c._locusCache = {
                        segments: null,
                        shadeGrid: this._buildLocusShadeGrid(c.locus, c.equationVar, c.id),
                        minX: vp.minX, maxX: vp.maxX, minY: vp.minY, maxY: vp.maxY
                    };
                } else {
                    c._locusCache = {
                        segments: this._traceLocusSegments(c.locus, c.equationVar, c.id),
                        shadeGrid: c.locus.inequality
                            ? this._buildLocusShadeGrid(c.locus, c.equationVar, c.id)
                            : null,
                        minX: vp.minX, maxX: vp.maxX, minY: vp.minY, maxY: vp.maxY
                    };
                }
                retraced = true;
            }
            if (retraced) {
                this.updateAllCardMetadata();
                if (this.currentState === this.states.APP) this.drawCanvas();
            }
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

        if (fp.kind === 'inscribed-arc') {
            const { b, theta, center, radius } = fp;
            // Arc span = 2π - 2|theta|; direction: CW in world for theta>0, CCW for theta<0
            const arcAngle = 2 * Math.PI - 2 * Math.abs(theta);
            const steps = Math.max(60, Math.round(arcAngle / (2 * Math.PI) * 240));
            const alphaB = Math.atan2(b.im - center.im, b.re - center.re);
            const dir = theta > 0 ? -1 : 1;
            const segments = [];
            for (let k = 0; k < steps; k++) {
                const ang0 = alphaB + dir * (k / steps) * arcAngle;
                const ang1 = alphaB + dir * ((k + 1) / steps) * arcAngle;
                segments.push([
                    { x: center.re + radius * Math.cos(ang0), y: center.im + radius * Math.sin(ang0) },
                    { x: center.re + radius * Math.cos(ang1), y: center.im + radius * Math.sin(ang1) }
                ]);
            }
            return segments;
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
                        if (a === 0 || b === 0) return true;
                        if ((a < 0) !== (b < 0)) {
                            // Suppress ±π wrapping artefact: residual jumps from ≈+π to ≈-π
                            // across a false arc (e.g. lower arc of arg(z-1)-arg(z+1)=π/4).
                            if (locus.angular && Math.abs(a) > Math.PI / 2 && Math.abs(b) > Math.PI / 2) return false;
                            return true;
                        }
                        return false;
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

    // Compute a boolean grid (in world coordinates) flagging cells that fall inside the shaded
    // region of an inequality locus. Uses the same resolution as _traceLocusSegments.
    _buildLocusShadeGrid(locus, varName, ownId) {
        if (!locus.scalar || !locus.inequality) return null;
        const { minX, maxX, minY, maxY } = this.getVisibleWorldBounds();
        const spanX = maxX - minX;
        const spanY = maxY - minY;
        if (!(spanX > 0) || !(spanY > 0)) return null;

        const cols = Math.max(96, Math.min(220, Math.round(this.canvas.width / 6)));
        const rows = Math.max(96, Math.min(220, Math.round(this.canvas.height / 6)));
        const dx = spanX / cols;
        const dy = spanY / rows;
        const scope = this.buildExpressionScope(ownId);
        const { dir } = locus.inequality;
        let lhsNode, rhsNode;
        try {
            lhsNode = math.parse(locus.lhs);
            rhsNode = math.parse(locus.rhs);
        } catch { return null; }

        // Store signed-difference values at cell corners (rows+1 × cols+1) for smooth fill.
        const grid = Array.from({ length: rows + 1 }, () => new Float32Array(cols + 1));
        for (let iy = 0; iy <= rows; iy++) {
            const y = minY + iy * dy;
            for (let ix = 0; ix <= cols; ix++) {
                const x = minX + ix * dx;
                try {
                    const evalScope = { ...scope, [varName]: math.complex(x, y) };
                    const lv = lhsNode.evaluate(evalScope);
                    const rv = rhsNode.evaluate(evalScope);
                    const signed = this._equationSignedDifference(lv, rv, { angular: false });
                    grid[iy][ix] = (signed !== null && isFinite(signed)) ? signed * dir : 0;
                } catch { /* skip */ }
            }
        }
        return { grid, cols, rows, dx, dy, originX: minX, originY: minY };
    }

    // Evaluate both compound parts in one grid pass, sharing the single LHS expression evaluation.
    // Reduces 4 full evaluations (2 trace + 2 shade) to 1, giving ~4x speedup after pan/zoom.
    _traceCompoundPartsWithShade(locus0, locus1, varName, ownId) {
        if (typeof math === 'undefined') return null;
        const { minX, maxX, minY, maxY } = this.getVisibleWorldBounds();
        const spanX = maxX - minX, spanY = maxY - minY;
        if (!(spanX > 0) || !(spanY > 0)) return null;
        const cols = Math.max(96, Math.min(220, Math.round(this.canvas.width / 6)));
        const rows = Math.max(96, Math.min(220, Math.round(this.canvas.height / 6)));
        const dx = spanX / cols, dy = spanY / rows;
        const scope = this.buildExpressionScope(ownId);
        let lhsNode, rhs0Node, rhs1Node;
        try {
            lhsNode  = math.parse(locus0.lhs);
            rhs0Node = math.parse(locus0.rhs);
            rhs1Node = math.parse(locus1.rhs);
        } catch { return null; }
        let rhs0Val, rhs1Val;
        try {
            rhs0Val = rhs0Node.evaluate({ ...scope });
            rhs1Val = rhs1Node.evaluate({ ...scope });
        } catch { return null; }
        const dir0 = locus0.inequality.dir,  dir1 = locus1.inequality.dir;
        const ang0 = locus0.angular ?? false, ang1 = locus1.angular ?? false;
        const v0  = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(Infinity));
        const v1  = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(Infinity));
        const sg0 = Array.from({ length: rows + 1 }, () => new Float32Array(cols + 1));
        const sg1 = Array.from({ length: rows + 1 }, () => new Float32Array(cols + 1));
        for (let iy = 0; iy <= rows; iy++) {
            const y = minY + iy * dy;
            for (let ix = 0; ix <= cols; ix++) {
                const x = minX + ix * dx;
                try {
                    const evalScope = { ...scope, [varName]: math.complex(x, y) };
                    const lhsVal = lhsNode.evaluate(evalScope);
                    const s0 = this._equationSignedDifference(lhsVal, rhs0Val, { angular: ang0 });
                    const s1 = this._equationSignedDifference(lhsVal, rhs1Val, { angular: ang1 });
                    v0[iy][ix] = s0 === null ? Infinity : s0;
                    v1[iy][ix] = s1 === null ? Infinity : s1;
                    const f0 = this._equationSignedDifference(lhsVal, rhs0Val, { angular: false });
                    const f1 = this._equationSignedDifference(lhsVal, rhs1Val, { angular: false });
                    sg0[iy][ix] = (f0 !== null && isFinite(f0)) ? f0 * dir0 : 0;
                    sg1[iy][ix] = (f1 !== null && isFinite(f1)) ? f1 * dir1 : 0;
                } catch { /* leave Infinity */ }
            }
        }
        const buildSegs = (vals, angular) => {
            const segs = [];
            const interp = (x1, y1, a, x2, y2, b) => {
                const t = Math.abs(a - b) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, a / (a - b)));
                return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
            };
            for (let iy = 0; iy < rows; iy++) {
                const y0 = minY + iy * dy, y1 = y0 + dy;
                for (let ix = 0; ix < cols; ix++) {
                    const x0 = minX + ix * dx, x1 = x0 + dx;
                    const a = vals[iy][ix], b = vals[iy][ix+1], cv = vals[iy+1][ix+1], d = vals[iy+1][ix];
                    if (![a, b, cv, d].every(Number.isFinite)) continue;
                    const cross = (p, q) => {
                        if (p === 0 || q === 0) return true;
                        if ((p < 0) !== (q < 0)) {
                            if (angular && Math.abs(p) > Math.PI / 2 && Math.abs(q) > Math.PI / 2) return false;
                            return true;
                        }
                        return false;
                    };
                    const hits = [];
                    if (cross(a, b))  hits.push(interp(x0, y0, a, x1, y0, b));
                    if (cross(b, cv)) hits.push(interp(x1, y0, b, x1, y1, cv));
                    if (cross(cv, d)) hits.push(interp(x1, y1, cv, x0, y1, d));
                    if (cross(d, a))  hits.push(interp(x0, y1, d, x0, y0, a));
                    if (hits.length === 2) {
                        segs.push([hits[0], hits[1]]);
                    } else if (hits.length === 4) {
                        const cx = (x0+x1)/2, cy = (y0+y1)/2;
                        hits.sort((p, q) => Math.atan2(p.y-cy, p.x-cx) - Math.atan2(q.y-cy, q.x-cx));
                        segs.push([hits[0], hits[1]]);
                        segs.push([hits[2], hits[3]]);
                    }
                }
            }
            return segs;
        };
        const meta = { cols, rows, dx, dy, originX: minX, originY: minY };
        return [
            { segments: buildSegs(v0, ang0), shadeGrid: { ...meta, grid: sg0 } },
            { segments: buildSegs(v1, ang1), shadeGrid: { ...meta, grid: sg1 } },
        ];
    }

    // Draw the shaded region for an inequality locus. Call before drawing the boundary curve.
    // Stitch marching-squares segment pairs into continuous chains so dashes flow
    // naturally across the whole curve rather than resetting at each short segment.
    _stitchSegmentsToChains(segments) {
        if (!segments?.length) return [];
        const n = segments.length;
        const used = new Uint8Array(n);
        // Round to 9 d.p. to absorb the 1-ULP float mismatch between shared-edge
        // crossing points computed from opposite sides of adjacent cells.
        const key = p => `${p.x.toFixed(9)},${p.y.toFixed(9)}`;

        // Map endpoint key → packed list of (segIdx<<1 | ptIdx)
        const map = new Map();
        for (let i = 0; i < n; i++) {
            for (let pi = 0; pi < 2; pi++) {
                const k = key(segments[i][pi]);
                if (!map.has(k)) map.set(k, []);
                map.get(k).push((i << 1) | pi);
            }
        }

        const chains = [];
        for (let start = 0; start < n; start++) {
            if (used[start]) continue;
            used[start] = 1;
            const chain = [segments[start][0], segments[start][1]];

            const extend = (getTail, addPt) => {
                for (;;) {
                    const nbrs = map.get(key(getTail()));
                    let ok = false;
                    if (nbrs) {
                        for (const packed of nbrs) {
                            const si = packed >> 1, pi = packed & 1;
                            if (used[si]) continue;
                            used[si] = 1;
                            addPt(pi === 0 ? segments[si][1] : segments[si][0]);
                            ok = true;
                            break;
                        }
                    }
                    if (!ok) break;
                }
            };

            extend(() => chain[chain.length - 1], p => chain.push(p));
            if (key(chain[0]) !== key(chain[chain.length - 1]))
                extend(() => chain[0], p => chain.unshift(p));

            chains.push(chain);
        }
        return chains;
    }

    // Marching-squares polygon fill for a shade grid (corner float values, positive = inside).
    _renderShadeGrid(sg, ctx) {
        const { grid, rows, cols, dx, dy, originX, originY } = sg;
        const scx = new Float64Array(cols + 1);
        const scy = new Float64Array(rows + 1);
        for (let ix = 0; ix <= cols; ix++) scx[ix] = this.worldToScreen(originX + ix * dx, 0).x;
        for (let iy = 0; iy <= rows; iy++) scy[iy] = this.worldToScreen(0, originY + iy * dy).y;
        const li = (a, b) => Math.abs(a - b) < 1e-9 ? 0.5 : a / (a - b); // lerp param [0,1]
        ctx.beginPath();
        for (let iy = 0; iy < rows; iy++) {
            const y0 = scy[iy], y1 = scy[iy + 1]; // y0 = screen-bottom (larger y), y1 = screen-top
            let runStart = -1; // run-length batch for fully-interior k=15 cells
            for (let ix = 0; ix < cols; ix++) {
                const vBL = grid[iy][ix], vBR = grid[iy][ix + 1];
                const vTL = grid[iy + 1][ix], vTR = grid[iy + 1][ix + 1];
                const k = (vBL > 0 ? 1 : 0) | (vBR > 0 ? 2 : 0) | (vTR > 0 ? 4 : 0) | (vTL > 0 ? 8 : 0);
                if (k === 15) { if (runStart < 0) runStart = ix; continue; }
                // flush any pending interior run before handling this cell
                if (runStart >= 0) { ctx.rect(scx[runStart], y1, scx[ix] - scx[runStart], y0 - y1); runStart = -1; }
                if (k === 0) continue;
                const x0 = scx[ix], x1 = scx[ix + 1];
                const cbx = x0 + li(vBL, vBR) * (x1 - x0);        // bottom edge crossing x
                const cry = y0 + li(vBR, vTR) * (y1 - y0);         // right  edge crossing y
                const tpx = x0 + li(vTL, vTR) * (x1 - x0);        // top    edge crossing x
                const cly = y0 + li(vBL, vTL) * (y1 - y0);        // left   edge crossing y
                switch (k) {
                    case  1: ctx.moveTo(x0,y0);  ctx.lineTo(cbx,y0);  ctx.lineTo(x0,cly);  ctx.closePath(); break;
                    case  2: ctx.moveTo(cbx,y0); ctx.lineTo(x1,y0);   ctx.lineTo(x1,cry);  ctx.closePath(); break;
                    case  3: ctx.moveTo(x0,y0);  ctx.lineTo(x1,y0);   ctx.lineTo(x1,cry);  ctx.lineTo(x0,cly); ctx.closePath(); break;
                    case  4: ctx.moveTo(x1,cry); ctx.lineTo(x1,y1);   ctx.lineTo(tpx,y1);  ctx.closePath(); break;
                    case  5: ctx.moveTo(x0,y0);  ctx.lineTo(cbx,y0);  ctx.lineTo(x0,cly);  ctx.closePath();
                             ctx.moveTo(x1,cry); ctx.lineTo(x1,y1);   ctx.lineTo(tpx,y1);  ctx.closePath(); break;
                    case  6: ctx.moveTo(cbx,y0); ctx.lineTo(x1,y0);   ctx.lineTo(x1,y1);   ctx.lineTo(tpx,y1); ctx.closePath(); break;
                    case  7: ctx.moveTo(x0,y0);  ctx.lineTo(x1,y0);   ctx.lineTo(x1,y1);   ctx.lineTo(tpx,y1); ctx.lineTo(x0,cly); ctx.closePath(); break;
                    case  8: ctx.moveTo(x0,cly); ctx.lineTo(x0,y1);   ctx.lineTo(tpx,y1);  ctx.closePath(); break;
                    case  9: ctx.moveTo(x0,y0);  ctx.lineTo(x0,y1);   ctx.lineTo(tpx,y1);  ctx.lineTo(cbx,y0); ctx.closePath(); break;
                    case 10: ctx.moveTo(cbx,y0); ctx.lineTo(x1,y0);   ctx.lineTo(x1,cry);  ctx.closePath();
                             ctx.moveTo(x0,cly); ctx.lineTo(x0,y1);   ctx.lineTo(tpx,y1);  ctx.closePath(); break;
                    case 11: ctx.moveTo(x0,y0);  ctx.lineTo(x1,y0);   ctx.lineTo(x1,cry);  ctx.lineTo(tpx,y1); ctx.lineTo(x0,y1); ctx.closePath(); break;
                    case 12: ctx.moveTo(x0,y1);  ctx.lineTo(x1,y1);   ctx.lineTo(x1,cry);  ctx.lineTo(x0,cly); ctx.closePath(); break;
                    case 13: ctx.moveTo(x0,y0);  ctx.lineTo(cbx,y0);  ctx.lineTo(x1,cry);  ctx.lineTo(x1,y1); ctx.lineTo(x0,y1); ctx.closePath(); break;
                    case 14: ctx.moveTo(x0,cly); ctx.lineTo(x0,y1);   ctx.lineTo(x1,y1);   ctx.lineTo(x1,y0); ctx.lineTo(cbx,y0); ctx.closePath(); break;
                }
            }
            // flush any run that reached the end of the row
            if (runStart >= 0) { ctx.rect(scx[runStart], y1, scx[cols] - scx[runStart], y0 - y1); }
        }
        ctx.fill();
    }

    _drawLocusShade(c, ctx) {
        const ineq = c.locus.inequality;
        if (!ineq) return;
        const fp = c.locus.fastPath;
        const SHADE_ALPHA = 0.18;

        // Geometric fill for circle / Apollonius circle (interior or exterior)
        if (fp?.kind === 'circle' || fp?.kind === 'apollonius') {
            const sc = this.worldToScreen(fp.center.re, fp.center.im);
            const se = this.worldToScreen(fp.center.re + fp.radius, fp.center.im);
            const sr = Math.abs(se.x - sc.x);
            const cw = this.canvas.width;
            const ch = this.canvas.height;
            ctx.save();
            ctx.fillStyle = c.color;
            ctx.globalAlpha = SHADE_ALPHA;
            ctx.beginPath();
            if (ineq.dir < 0) {
                ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
            } else {
                // Exterior: canvas rect (clockwise) + circle (anticlockwise) → non-zero fill leaves interior unfilled
                ctx.moveTo(0, 0);
                ctx.lineTo(cw, 0);
                ctx.lineTo(cw, ch);
                ctx.lineTo(0, ch);
                ctx.closePath();
                ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2, true);
            }
            ctx.fill();
            ctx.restore();
            return;
        }

        // Ray fast path: smooth polygon fill (no staircase)
        if (fp?.kind === 'ray') {
            ctx.save();
            ctx.fillStyle = c.color;
            ctx.globalAlpha = SHADE_ALPHA;
            if (this._fillRayRegion(fp, ineq.dir, ctx)) { ctx.restore(); return; }
            ctx.restore();
        }

        // Perpendicular-bisector fast path: smooth polygon fill (no staircase)
        if (fp?.kind === 'line') {
            ctx.save();
            ctx.fillStyle = c.color;
            ctx.globalAlpha = SHADE_ALPHA;
            if (this._fillLineRegion(fp, ineq.dir, ctx)) { ctx.restore(); return; }
            ctx.restore();
        }

        // Inscribed-arc fast path: smooth circular-segment fill (no staircase)
        if (fp?.kind === 'inscribed-arc') {
            const { a, b, theta, center, radius } = fp;
            const sc   = this.worldToScreen(center.re, center.im);
            const scE  = this.worldToScreen(center.re + radius, center.im);
            const sr   = Math.abs(scE.x - sc.x);
            const sA   = this.worldToScreen(a.re, a.im);
            const sB   = this.worldToScreen(b.re, b.im);
            const angB = Math.atan2(sB.y - sc.y, sB.x - sc.x);
            const angA = Math.atan2(sA.y - sc.y, sA.x - sc.x);
            // CW in world (theta>0) → anticlockwise=false in canvas (y-flip reverses visual spin)
            const arcCCW = theta < 0;
            // "simple segment": the cap between arc and chord on the arc's side of the chord
            const isSimpleSegment = (ineq.dir > 0) === (theta > 0);
            const cw = this.canvas.width, ch = this.canvas.height;
            ctx.save();
            ctx.fillStyle  = c.color;
            ctx.globalAlpha = SHADE_ALPHA;
            ctx.beginPath();
            if (isSimpleSegment) {
                ctx.moveTo(sB.x, sB.y);
                ctx.arc(sc.x, sc.y, sr, angB, angA, arcCCW);
                ctx.closePath();
            } else {
                // Viewport rect + same-winding segment → evenodd leaves segment unfilled
                ctx.moveTo(0, 0); ctx.lineTo(cw, 0); ctx.lineTo(cw, ch); ctx.lineTo(0, ch);
                ctx.closePath();
                ctx.moveTo(sB.x, sB.y);
                ctx.arc(sc.x, sc.y, sr, angB, angA, arcCCW);
                ctx.closePath();
            }
            ctx.fill('evenodd');
            ctx.restore();
            return;
        }

        // Smooth marching-squares fill for all other loci
        const sg = c._locusCache?.shadeGrid;
        if (!sg) return;
        ctx.save();
        ctx.fillStyle = c.color;
        ctx.globalAlpha = SHADE_ALPHA;
        this._renderShadeGrid(sg, ctx);
        ctx.restore();
    }

    // Fill the half-plane for a ray inequality using a canvas polygon (no staircase).
    // Traces: origin → ray-exit-point → viewport-boundary-walk → branch-cut-exit → close.
    // Returns false if the geometry is degenerate (caller falls back to shade grid).
    _fillRayRegion(fp, ineqDir, targetCtx) {
        const cw = this.canvas.width, ch = this.canvas.height;
        const o  = fp.origin;
        const rayHits    = this._clipInfiniteLine(o, { re: Math.cos(fp.angle), im: Math.sin(fp.angle) });
        if (!rayHits || rayHits.length < 2) {
            // Line misses viewport entirely: whole viewport is in one half-plane of the ray.
            const nx = -Math.sin(fp.angle), ny = Math.cos(fp.angle);
            const { minX, minY } = this.getVisibleWorldBounds();
            const cornerDot = (minX - o.re) * nx + (minY - o.im) * ny;
            if ((ineqDir > 0) === (cornerDot > 0)) targetCtx.fillRect(0, 0, cw, ch);
            return true;
        }

        const { minX, maxX, minY, maxY } = this.getVisibleWorldBounds();
        const originInViewport = o.re >= minX - 1e-6 && o.re <= maxX + 1e-6 &&
                                  o.im >= minY - 1e-6 && o.im <= maxY + 1e-6;

        // Viewport boundary t-parameterisation (CW screen: TL→TR→BR→BL, t ∈ [0,4))
        const eps = 0.5;
        const vt = (sx, sy) => {
            if (sy <= eps)      return sx / cw;
            if (sx >= cw - eps) return 1 + sy / ch;
            if (sy >= ch - eps) return 2 + (cw - sx) / cw;
            return 3 + (ch - sy) / ch;
        };
        const corners = [[0,0],[cw,0],[cw,ch],[0,ch]];
        const walkMid = (t0, t1, ccw) => {
            const mid = [];
            if (ccw) {
                let te = t1; if (te >= t0) te -= 4;
                for (let ci = Math.floor(t0); ci > te; ci--) mid.push(corners[((ci % 4) + 4) % 4]);
            } else {
                let te = t1; if (te <= t0) te += 4;
                for (let ci = Math.floor(t0) + 1; ci <= Math.floor(te); ci++) mid.push(corners[ci % 4]);
            }
            return mid;
        };

        if (originInViewport) {
            // Origin inside viewport: polygon is origin → ray-exit → [walk] → branch-cut-exit
            const branchHits = this._clipInfiniteLine(o, { re: -1, im: 0 });
            if (!branchHits || branchHits.length < 2) return false;
            if (rayHits[1].t < -1e-9) return false;
            const P_theta  = this.worldToScreen(rayHits[1].x,    rayHits[1].y);
            const P_branch = this.worldToScreen(branchHits[1].x, branchHits[1].y);
            const sc       = this.worldToScreen(o.re, o.im);
            const t0 = vt(P_theta.x, P_theta.y), t1 = vt(P_branch.x, P_branch.y);
            const mid = walkMid(t0, t1, ineqDir > 0);
            targetCtx.beginPath();
            targetCtx.moveTo(sc.x, sc.y);
            targetCtx.lineTo(P_theta.x, P_theta.y);
            for (const [x, y] of mid) targetCtx.lineTo(x, y);
            targetCtx.lineTo(P_branch.x, P_branch.y);
            targetCtx.closePath();
        } else {
            // Origin outside viewport: polygon is ray-entry → ray-exit → [walk] → (close)
            // Both hits must have t > 0 (ray actually reaches the viewport)
            if (rayHits[0].t < -1e-9 || rayHits[1].t < -1e-9) {
                // Ray points away from viewport; check if viewport is fully inside the half-plane.
                const { minX, minY } = this.getVisibleWorldBounds();
                const nx = -Math.sin(fp.angle), ny = Math.cos(fp.angle); // CCW normal to ray
                const cornerDot = (minX - o.re) * nx + (minY - o.im) * ny;
                if ((ineqDir > 0) === (cornerDot > 0)) targetCtx.fillRect(0, 0, cw, ch);
                return true;
            }
            const E_theta = this.worldToScreen(rayHits[0].x, rayHits[0].y);
            const P_theta = this.worldToScreen(rayHits[1].x, rayHits[1].y);
            const t0 = vt(P_theta.x, P_theta.y), t1 = vt(E_theta.x, E_theta.y);
            const mid = walkMid(t0, t1, ineqDir > 0);
            targetCtx.beginPath();
            targetCtx.moveTo(E_theta.x, E_theta.y);
            targetCtx.lineTo(P_theta.x, P_theta.y);
            for (const [x, y] of mid) targetCtx.lineTo(x, y);
            targetCtx.closePath();
        }
        targetCtx.fill();
        return true;
    }

    // Fill the half-plane for a perpendicular-bisector inequality using a canvas polygon.
    // Clips the infinite line to the viewport, determines the shaded side from focusA/focusB,
    // then closes via the viewport boundary walk. Returns false if the line misses the viewport.
    _fillLineRegion(fp, ineqDir, targetCtx) {
        const hits = this._clipInfiniteLine(fp.point, fp.direction);
        if (!hits || hits.length < 2) {
            // Line misses viewport: entire viewport is on one side of the bisector.
            // Normal (nx,ny) ⟂ direction; same sign as the focus → viewport is on the shaded side.
            const { minX, minY } = this.getVisibleWorldBounds();
            const nx = -fp.direction.im, ny = fp.direction.re;
            const shade = ineqDir < 0 ? fp.focusA : fp.focusB;
            const cornerDot = (minX - fp.point.re) * nx + (minY - fp.point.im) * ny;
            const focusDot  = (shade.re - fp.point.re) * nx + (shade.im  - fp.point.im) * ny;
            if (cornerDot * focusDot > 0) targetCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            return true;
        }
        const cw = this.canvas.width, ch = this.canvas.height;
        const P1 = this.worldToScreen(hits[0].x, hits[0].y);
        const P2 = this.worldToScreen(hits[1].x, hits[1].y);
        // dir=-1: shade focusA side (|z-a| ≤ |z-b|, closer to a); dir=1: shade focusB side
        const sf = ineqDir < 0 ? fp.focusA : fp.focusB;
        const sp = this.worldToScreen(sf.re, sf.im);
        // Cross product (P2-P1)×(sp-P1) > 0 → sp is to the LEFT of P1→P2 in screen coords
        // Left of P1→P2 = walk CW screen from P2 to P1 to enclose that side
        const cross = (P2.x-P1.x)*(sp.y-P1.y) - (P2.y-P1.y)*(sp.x-P1.x);
        const eps = 0.5;
        const vt = (sx, sy) => {
            if (sy <= eps)      return sx / cw;
            if (sx >= cw - eps) return 1 + sy / ch;
            if (sy >= ch - eps) return 2 + (cw - sx) / cw;
            return 3 + (ch - sy) / ch;
        };
        const corners = [[0,0],[cw,0],[cw,ch],[0,ch]];
        const t2 = vt(P2.x, P2.y), t1 = vt(P1.x, P1.y);
        const cwWalk = cross > 0;
        const mid = [];
        if (cwWalk) {
            let te = t1; if (te <= t2) te += 4;
            for (let ci = Math.floor(t2) + 1; ci <= Math.floor(te); ci++) mid.push(corners[ci % 4]);
        } else {
            let te = t1; if (te >= t2) te -= 4;
            for (let ci = Math.floor(t2); ci > te; ci--) mid.push(corners[((ci % 4) + 4) % 4]);
        }
        targetCtx.beginPath();
        targetCtx.moveTo(P1.x, P1.y);
        targetCtx.lineTo(P2.x, P2.y);
        for (const [x, y] of mid) targetCtx.lineTo(x, y);
        targetCtx.closePath();
        targetCtx.fill();
        return true;
    }

    // Draw the intersection of 2+ enabled inequality loci using destination-in compositing.
    // Each region is rendered white to an off-screen canvas; successive destination-in passes
    // leave only the area common to all of them, which is then tinted and drawn to ctx.
    _drawInequalityIntersection(ineqLoci, ctx) {
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        if (!cw || !ch) return;

        const offscreens = [];
        for (const c of ineqLoci) {
            const fp   = c.locus.fastPath;
            const ineq = c.locus.inequality;
            const off  = document.createElement('canvas');
            off.width  = cw;
            off.height = ch;
            const offCtx = off.getContext('2d', { alpha: true });
            offCtx.imageSmoothingEnabled = false;
            offCtx.fillStyle = '#ffffff';

            if (fp?.kind === 'circle' || fp?.kind === 'apollonius') {
                const sc = this.worldToScreen(fp.center.re, fp.center.im);
                const se = this.worldToScreen(fp.center.re + fp.radius, fp.center.im);
                const sr = Math.abs(se.x - sc.x);
                offCtx.beginPath();
                if (ineq.dir < 0) {
                    offCtx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
                } else {
                    offCtx.moveTo(0, 0); offCtx.lineTo(cw, 0); offCtx.lineTo(cw, ch); offCtx.lineTo(0, ch);
                    offCtx.closePath();
                    offCtx.arc(sc.x, sc.y, sr, 0, Math.PI * 2, true);
                }
                offCtx.fill();
            } else if ((fp?.kind === 'ray'  && this._fillRayRegion (fp, ineq.dir, offCtx)) ||
                       (fp?.kind === 'line' && this._fillLineRegion(fp, ineq.dir, offCtx))) {
                // geometric fill succeeded
            } else {
                let sg = c._locusCache?.shadeGrid ?? null;
                if (!sg) {
                    sg = this._buildLocusShadeGrid(c.locus, c.equationVar, c.id);
                    if (!sg) continue;
                    // Only update an existing cache; if no cache yet, leave null so the
                    // per-expression loop builds it with segments without interference.
                    if (c._locusCache) c._locusCache = { ...c._locusCache, shadeGrid: sg };
                } else {
                    // Stale cache: use the existing grid this frame, rebuild after panning settles
                    const { minX, maxX, minY, maxY } = this.viewport;
                    const cc = c._locusCache;
                    if (cc.minX !== minX || cc.maxX !== maxX || cc.minY !== minY || cc.maxY !== maxY) {
                        this._scheduleLocusRetrace();
                    }
                }
                this._renderShadeGrid(sg, offCtx);
            }
            offscreens.push(off);
        }

        if (offscreens.length < 2) return;

        // Intersect all regions via successive destination-in passes
        const composite = document.createElement('canvas');
        composite.width  = cw;
        composite.height = ch;
        const compCtx = composite.getContext('2d', { alpha: true });
        compCtx.imageSmoothingEnabled = false;
        compCtx.drawImage(offscreens[0], 0, 0);
        for (let i = 1; i < offscreens.length; i++) {
            compCtx.globalCompositeOperation = 'destination-in';
            compCtx.drawImage(offscreens[i], 0, 0);
        }

        // Tint: use the shared card colour for a compound inequality, otherwise a neutral accent
        const tintColor = ineqLoci.every(c => c.color === ineqLoci[0].color) ? ineqLoci[0].color : '#9932CC';
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width  = cw;
        colorCanvas.height = ch;
        const colorCtx = colorCanvas.getContext('2d', { alpha: true });
        colorCtx.fillStyle = tintColor;
        colorCtx.fillRect(0, 0, cw, ch);
        colorCtx.globalCompositeOperation = 'destination-in';
        colorCtx.drawImage(composite, 0, 0);

        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.drawImage(colorCanvas, 0, 0);
        ctx.restore();
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

    // Substitute u = sqrt(varName), varName = u*u to clear a sqrt(varName) term and solve as a polynomial.
    _trySqrtSubstitution(lhs, rhs, varName, scope) {
        const sqrtVar = `sqrt(${varName})`;
        if (!lhs.includes(sqrtVar) && !rhs.includes(sqrtVar)) return null;
        // Use a letter-starting name not already in scope (math.derivative requires valid JS-style identifiers)
        let u = 'sqrtSub';
        if (scope.hasOwnProperty(u)) u = 'sqrtSubVar';
        if (scope.hasOwnProperty(u)) return null;
        const sqrtRe = new RegExp(`sqrt\\(${varName}\\)`, 'g');
        const varRe  = new RegExp(`\\b${varName}\\b`, 'g');
        const sub    = (e) => e.replace(sqrtRe, u).replace(varRe, `(${u}*${u})`);
        const hSub   = `(${sub(lhs)}) - (${sub(rhs)})`;
        // Rationalize first (pure algebra, no derivative) to get a clean polynomial form
        let coeffs = null;
        try {
            const rat = math.rationalize(hSub, {}, true);
            if (rat?.numerator) coeffs = this._extractPolynomialCoeffs(rat.numerator.toString(), u, scope);
        } catch {}
        if (!coeffs || coeffs.length < 2)
            coeffs = this._extractPolynomialCoeffs(hSub, u, scope);
        if (!coeffs || coeffs.length < 2) return null;
        const deg = coeffs.length - 1;
        let uRoots;
        if      (deg === 1) uRoots = this._solveLinear(coeffs);
        else if (deg === 2) uRoots = this._solveQuadratic(coeffs);
        else                uRoots = this._solveDurandKerner(coeffs);
        if (!uRoots?.length) return null;
        let lhsNode, rhsNode;
        try { lhsNode = math.parse(lhs); rhsNode = math.parse(rhs); } catch { return null; }
        const valid = [];
        for (const uVal of uRoots) {
            if (!isFinite(uVal.re) || !isFinite(uVal.im)) continue;
            const z = this._cMul(uVal, uVal);
            try {
                const ev   = { ...scope, [varName]: math.complex(z.re, z.im) };
                const diff = this._equationDifferenceMagnitude(lhsNode.evaluate(ev), rhsNode.evaluate(ev));
                if (diff < 0.01 && valid.every(r => Math.hypot(r.re - z.re, r.im - z.im) > 1e-4)) valid.push(z);
            } catch { /* skip */ }
        }
        return valid.length > 0 ? valid : null;
    }

    // Main equation parser. Returns either finite roots or a drawable complex locus.
    parseEquation(rawLatex, ownId) {
        if (typeof math === 'undefined') return null;
        try {
            const scope = this.buildExpressionScope(ownId);
            const expr  = this.latexToExpr(rawLatex);
            if (!expr) return null;

            // Detect compound inequality: bound op1 expr op2 bound (e.g. -pi/6 <= arg(z) < pi/2)
            {
                const cmpRe = /^([\s\S]*?)(<=|>=|<(?!=)|>(?!=))([\s\S]+?)(<=|>=|<(?!=)|>(?!=))([\s\S]*)$/;
                const cm = cmpRe.exec(expr);
                if (cm) {
                    const bound1 = cm[1].trim(), op1 = cm[2], middle = cm[3].trim(), op2 = cm[4], bound2 = cm[5].trim();
                    if (bound1 && middle && bound2) {
                        const varName = this._findEquationVariable(middle, scope);
                        if (varName) {
                            const locus1 = this._buildLocus(middle, bound1, varName, scope);
                            const locus2 = this._buildLocus(middle, bound2, varName, scope);
                            if (locus1?.scalar && locus2?.scalar) {
                                // bound1 op1 middle → middle flipOp(op1) bound1; preserve strictness
                                locus1.inequality = { dir: (op1 === '<' || op1 === '<=') ? 1 : -1, strict: (op1 === '<' || op1 === '>') };
                                locus2.inequality = { dir: (op2 === '<' || op2 === '<=') ? -1 : 1, strict: (op2 === '<' || op2 === '>') };
                                return { type: 'compound-locus', variable: varName, loci: [locus1, locus2] };
                            }
                        }
                    }
                }
            }

            // Detect operator: inequality or equality
            let lhs, rhs, inequalityDir = 0, inequalityStrict = false;
            {
                const ineqMatch = /^([\s\S]*?)(<=|>=|<(?!=)|>(?!=))([\s\S]*)$/.exec(expr);
                if (ineqMatch) {
                    lhs = ineqMatch[1].trim();
                    const op = ineqMatch[2];
                    rhs = ineqMatch[3].trim();
                    inequalityDir = (op === '<' || op === '<=') ? -1 : 1;
                    inequalityStrict = (op === '<' || op === '>');
                } else {
                    const eqIdx = expr.indexOf('=');
                    if (eqIdx < 1 || eqIdx >= expr.length - 1) return null;
                    if (expr[eqIdx - 1] === '!') return null;   // reject !=
                    lhs = expr.slice(0, eqIdx).trim();
                    rhs = expr.slice(eqIdx + 1).trim();
                }
            }
            if (!lhs || !rhs) return null;
            const varName = this._findEquationVariable(lhs + ' ' + rhs, scope);
            if (!varName) return null;

            // Inequalities go directly to the locus builder - a region, not discrete roots
            if (inequalityDir !== 0) {
                // Normalise: if the variable is only on the rhs (e.g. "π/6 ≤ arg(z)"), swap
                // sides and negate dir so _buildLocus always receives the canonical lhs = expr(z) form.
                if (!this._findEquationVariable(lhs, scope) && this._findEquationVariable(rhs, scope)) {
                    [lhs, rhs] = [rhs, lhs];
                    inequalityDir = -inequalityDir;
                }
                const locus = this._buildLocus(lhs, rhs, varName, scope);
                if (!locus || !locus.scalar) return null;
                locus.inequality = { dir: inequalityDir, strict: inequalityStrict };
                return { type: 'locus', variable: varName, roots: null, locus };
            }

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
            // Use (?<![a-zA-Z]) rather than \b so that e.g. 2conj( is also matched (digits precede no \b).
            if (/(?<![a-zA-Z])(?:abs|arg|conj)\(/.test(hExpr)) {
                const locus = this._buildLocus(lhs, rhs, varName, scope);
                if (!locus) return null;
                // A non-scalar locus has a complex-valued LHS-RHS, so its zero set is
                // generically 0-dimensional (isolated points).  Try to find them directly
                // before falling back to the contour tracer.
                if (!locus.scalar) {
                    // conj(z) = f(z) → multiply both sides by z: |z|² = z·f(z), which is often real-valued
                    const conjPat = new RegExp(`^conj\\(${varName}\\)$`);
                    if (conjPat.test(lhs) && !/(?<![a-zA-Z])conj\(/.test(rhs)) {
                        const rew = this._buildLocus(`abs(${varName})^2`, `(${varName}) * (${rhs})`, varName, scope);
                        if (rew?.scalar) return { type: 'locus', variable: varName, roots: null, locus: rew };
                    } else if (conjPat.test(rhs) && !/(?<![a-zA-Z])conj\(/.test(lhs)) {
                        const rew = this._buildLocus(`abs(${varName})^2`, `(${varName}) * (${lhs})`, varName, scope);
                        if (rew?.scalar) return { type: 'locus', variable: varName, roots: null, locus: rew };
                    }
                    const roots = this._findComplexEquationRootsNumerically(lhs, rhs, varName, scope);
                    if (roots) return { type: 'equation', variable: varName, roots };
                }
                return { type: 'locus', variable: varName, roots: null, locus };
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
                if (/\bsqrt\(/.test(hExpr)) {
                    const sqrtRoots = this._trySqrtSubstitution(lhs, rhs, varName, scope);
                    if (sqrtRoots?.length) return { type: 'equation', variable: varName, roots: sqrtRoots };
                }
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
            if (locus && !locus.scalar) {
                const roots = this._findComplexEquationRootsNumerically(lhs, rhs, varName, scope);
                if (roots) return { type: 'equation', variable: varName, roots };
            }
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
                { latex: 'z^3=8i',    cardRootFmt: 'trig' }
            ],
            'loci': [
                '\\left|w\\right|=2',
                '\\arg\\left(\\frac{z-1}{z+1}\\right)=\\frac{\\pi}{4}',
                '\\left|z^2+\\frac{1}{z^2}\\right|=2'
            ],
            'line-loci': [
                'a=-2-2i',
                'im\\left(z\\right)=3',
                're\\left(z\\right)=\\frac{3}{2}',
                '\\left|z-\\left(2-3i\\right)\\right|=\\left|z-1+2i\\right|',
                '\\arg\\left(z-a\\right)=\\frac{\\pi}{3}'
            ],
            'conjugate-equations': [
                { latex: '\\overline{2z-\\overline{z}}=z^2', cardRootFmt: 'cartesian' }
            ],
            'conjugate-loci': [
                'z+\\overline{z}=4',
                '\\left|z\\overline{z}+z\\right|=2',
                '\\left|z^2+\\overline{z}\\right|=1'
            ],
            'inequalities': [
                '\\frac{\\pi}{6}\\le\\arg\\left(w+2i\\right)\\le\\frac{\\pi}{3}',
                '\\left|z-\\left(1-i\\right)\\right|<2',
                '\\left|z+i\\right|<\\left|z-2\\right|'
            ],
            'extrema': [
                '\\left|z-\\sqrt{2}\\left(1+i\\right)\\right|=1'
            ]
        };

        const list = demoSets[setName];
        if (!list) return;

        if (window.goatcounter?.count) {
            window.goatcounter.count({ path: 'Komplexiti - Demo Set Opened', event: true });
        }

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
        dropdown.scrollTop = 0;
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

    // ---- Locus intersection geometry ----------------------------------------

    _fastPathIntersections() {
        const shapes = [];
        const addFp = (fp, exprId) => {
            if (!fp) return;
            if (fp.kind === 'circle' || fp.kind === 'apollonius') {
                shapes.push({ kind: 'circular', cx: fp.center.re, cy: fp.center.im, r: fp.radius, exprId });
            } else if (fp.kind === 'inscribed-arc') {
                shapes.push({ kind: 'arc', cx: fp.center.re, cy: fp.center.im, r: fp.radius, fp, exprId });
            } else if (fp.kind === 'line') {
                shapes.push({ kind: 'linear', px: fp.point.re, py: fp.point.im, dx: fp.direction.re, dy: fp.direction.im, tMin: -Infinity, exprId });
            } else if (fp.kind === 'ray') {
                shapes.push({ kind: 'linear', px: fp.origin.re, py: fp.origin.im, dx: Math.cos(fp.angle), dy: Math.sin(fp.angle), tMin: 0, exprId });
            }
        };
        for (const c of this.expressions) {
            if (!c.enabled) continue;
            if (c.type === 'compound-locus' && c.compoundParts) {
                for (const part of c.compoundParts) addFp(part.locus?.fastPath, c.id);
            } else {
                addFp(c.locus?.fastPath, c.id);
            }
        }
        const pts = [];
        for (let i = 0; i < shapes.length - 1; i++) {
            for (let j = i + 1; j < shapes.length; j++) {
                for (const p of this._intersectShapes(shapes[i], shapes[j])) {
                    if (pts.every(q => Math.hypot(q.re - p.re, q.im - p.im) > 1e-6))
                        pts.push({ ...p, exprIds: [shapes[i].exprId, shapes[j].exprId] });
                }
            }
        }
        return pts;
    }

    _intersectShapes(a, b) {
        const aC = a.kind === 'circular' || a.kind === 'arc';
        const bC = b.kind === 'circular' || b.kind === 'arc';
        let pts;
        if (aC && bC)        pts = this._circleCircleIntersect(a, b);
        else if (aC && !bC)  pts = this._circleLineIntersect(a, b);
        else if (!aC && bC)  pts = this._circleLineIntersect(b, a);
        else                 pts = this._lineLineIntersect(a, b);
        if (a.kind === 'arc') pts = pts.filter(p => this._isOnArc(p, a.fp));
        if (b.kind === 'arc') pts = pts.filter(p => this._isOnArc(p, b.fp));
        return pts;
    }

    _isOnArc({ re, im }, { b, theta, center, radius }) {
        if (Math.abs(Math.hypot(re - center.re, im - center.im) - radius) > radius * 1e-4 + 1e-9) return false;
        const alphaB   = Math.atan2(b.im - center.im, b.re - center.re);
        const dir       = theta > 0 ? -1 : 1;
        const arcAngle  = 2 * Math.PI - 2 * Math.abs(theta);
        const alphaP    = Math.atan2(im - center.im, re - center.re);
        const dAngle    = ((dir * (alphaP - alphaB)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        return dAngle <= arcAngle + 1e-9;
    }

    _circleCircleIntersect({ cx: cx1, cy: cy1, r: r1 }, { cx: cx2, cy: cy2, r: r2 }) {
        const dx = cx2 - cx1, dy = cy2 - cy1;
        const d  = Math.hypot(dx, dy);
        if (d < 1e-9 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
        const a  = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
        const h  = Math.sqrt(Math.max(0, r1 * r1 - a * a));
        const mx = cx1 + a * dx / d, my = cy1 + a * dy / d;
        const px = -dy / d * h,      py =  dx / d * h;
        if (h < 1e-9) return [{ re: mx, im: my }];
        return [{ re: mx + px, im: my + py }, { re: mx - px, im: my - py }];
    }

    _circleLineIntersect({ cx, cy, r }, { px, py, dx, dy, tMin }) {
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-18) return [];
        const vx = cx - px, vy = cy - py;
        const tC  = (vx * dx + vy * dy) / len2;
        const dist2 = vx * vx + vy * vy - tC * tC * len2;
        if (dist2 > r * r + 1e-9) return [];
        const dt = Math.sqrt(Math.max(0, r * r - dist2)) / Math.sqrt(len2);
        return (dt < 1e-9 ? [tC] : [tC - dt, tC + dt])
            .filter(t => t >= tMin - 1e-9)
            .map(t => ({ re: px + t * dx, im: py + t * dy }));
    }

    _lineLineIntersect({ px: p1x, py: p1y, dx: d1x, dy: d1y, tMin: tMin1 },
                       { px: p2x, py: p2y, dx: d2x, dy: d2y, tMin: tMin2 }) {
        const cross = d1x * d2y - d1y * d2x;
        if (Math.abs(cross) < 1e-12) return [];
        const rx = p2x - p1x, ry = p2y - p1y;
        const t1 = (rx * d2y - ry * d2x) / cross;
        const t2 = (rx * d1y - ry * d1x) / cross;
        if (t1 < tMin1 - 1e-9 || t2 < tMin2 - 1e-9) return [];
        return [{ re: p1x + t1 * d1x, im: p1y + t1 * d1y }];
    }

    // ---- Intersection badges (canvas-drawn, persistent, graphiti-style) ------

    _showIntersectionBadge(re, im, exprIds) {
        if (!this._intersectionBadges) this._intersectionBadges = [];
        const key = `${re.toFixed(10)},${im.toFixed(10)}`;
        const idx = this._intersectionBadges.findIndex(b => b.key === key);
        if (idx !== -1) {
            this._intersectionBadges.splice(idx, 1); // toggle off
        } else {
            this._intersectionBadges.push({ re, im, key, exprIds: exprIds ?? [], closeBtn: null });
        }
    }

    _drawIntersectionBadges(ctx) {
        if (!this._intersectionBadges?.length) return;
        const color      = '#D63384';
        const outline    = '#852052'; // #D63384 * 0.62
        const textClr    = this.getContrastingTextColor(color);
        const fontSize   = this.sizeMode === 'xlarge' ? 24 : this.sizeMode === 'large' ? 20 : 16;
        const fontWeight = this.sizeMode === 'normal' ? 'normal' : 'bold';
        const padding    = 6;
        const closeSize  = 16;
        const closeMargin = 6;

        ctx.save();
        ctx.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;

        for (const badge of this._intersectionBadges) {
            const sp        = this.worldToScreen(badge.re, badge.im);
            const labelText = `z = ${this.formatComplexPlain(badge.re, badge.im, 'cartesian')}`;
            const tw        = ctx.measureText(labelText).width;
            const th        = fontSize;
            const labelX    = sp.x + 15;
            const labelY    = sp.y - 10;
            const totalW    = tw + 2 * padding + closeSize + closeMargin + 4;
            const boxH      = th + 2 * padding;
            const boxY      = labelY - th - padding;

            // Background
            ctx.fillStyle   = color;
            ctx.strokeStyle = outline;
            ctx.lineWidth   = 1.4;
            ctx.beginPath();
            ctx.roundRect(labelX - padding, boxY, totalW, boxH, 3);
            ctx.fill();
            ctx.stroke();

            // Label text
            ctx.fillStyle    = textClr;
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(labelText, labelX, boxY + boxH * 0.7);

            // Close button
            const closeX  = labelX + tw + padding + closeMargin;
            const closeY  = labelY - th;
            const closeCX = closeX + closeSize / 2;
            const closeCY = closeY + closeSize / 2;

            ctx.fillStyle   = 'rgba(0,0,0,0.15)';
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth   = 1;
            ctx.beginPath();
            ctx.roundRect(closeX, closeY, closeSize, closeSize, 2);
            ctx.fill();
            ctx.stroke();

            ctx.strokeStyle = textClr;
            ctx.lineWidth   = 2;
            const xH = 5;
            ctx.beginPath();
            ctx.moveTo(closeCX - xH, closeCY - xH);
            ctx.lineTo(closeCX + xH, closeCY + xH);
            ctx.moveTo(closeCX + xH, closeCY - xH);
            ctx.lineTo(closeCX - xH, closeCY + xH);
            ctx.stroke();

            badge.closeBtn = { x: closeX, y: closeY, w: closeSize, h: closeSize };
        }
        ctx.restore();
    }

    _computeLocusExtrema(c) {
        if (c.type !== 'locus' || !c.locus) return null;
        const fp = c.locus.fastPath;

        if (fp?.kind === 'circle' || fp?.kind === 'apollonius') {
            const { center, radius } = fp;
            const cMod = Math.hypot(center.re, center.im);
            const modMin = Math.abs(cMod - radius);
            const modMax = cMod + radius;
            let modMinPt, modMaxPt;
            if (cMod < 1e-10) {
                modMinPt = modMaxPt = { re: radius, im: 0 };
            } else {
                const ux = center.re / cMod, uy = center.im / cMod;
                modMinPt = { re: center.re - radius * ux, im: center.im - radius * uy };
                modMaxPt = { re: center.re + radius * ux, im: center.im + radius * uy };
            }
            const originInside = cMod < radius - 1e-9;
            let argMin = null, argMax = null, argMinPt = null, argMaxPt = null;
            if (!originInside && cMod > 1e-10) {
                const phi  = Math.atan2(center.im, center.re);
                const delta = Math.acos(Math.max(-1, Math.min(1, -radius / cMod)));
                const t1 = phi + delta, t2 = phi - delta;
                const pt1 = { re: center.re + radius * Math.cos(t1), im: center.im + radius * Math.sin(t1) };
                const pt2 = { re: center.re + radius * Math.cos(t2), im: center.im + radius * Math.sin(t2) };
                const a1 = Math.atan2(pt1.im, pt1.re), a2 = Math.atan2(pt2.im, pt2.re);
                if (a1 <= a2) { argMin = a1; argMinPt = pt1; argMax = a2; argMaxPt = pt2; }
                else           { argMin = a2; argMinPt = pt2; argMax = a1; argMaxPt = pt1; }
            }
            return { modMin, modMax, modMinPt, modMaxPt, argMin, argMax, argMinPt, argMaxPt, fullArgRange: originInside, approximate: false };
        }

        if (fp?.kind === 'inscribed-arc') {
            const { a, b, theta, center, radius } = fp;
            const alphaB   = Math.atan2(b.im - center.im, b.re - center.re);
            const arcAngle = 2 * Math.PI - 2 * Math.abs(theta);
            const dir      = theta > 0 ? -1 : 1;
            const TWO_PI   = 2 * Math.PI;
            // True if the angle `ang` (around center) lies on the arc
            const isOnArc  = (ang) => {
                const delta = (((ang - alphaB) * dir) % TWO_PI + TWO_PI) % TWO_PI;
                return delta <= arcAngle + 1e-9;
            };
            // Candidates: always the two endpoints, plus any circle-level geometric extrema that land on the arc
            const candidates = [];
            const addPt = (pt) => { if (Math.hypot(pt.re, pt.im) >= 1e-9) candidates.push(pt); };
            addPt(a); addPt(b);
            const cMod = Math.hypot(center.re, center.im);
            if (cMod > 1e-10) {
                const ux = center.re / cMod, uy = center.im / cMod;
                // Circle's closest/farthest points from origin
                const pNear = { re: center.re - radius * ux, im: center.im - radius * uy };
                const pFar  = { re: center.re + radius * ux, im: center.im + radius * uy };
                if (isOnArc(Math.atan2(pNear.im - center.im, pNear.re - center.re))) addPt(pNear);
                if (isOnArc(Math.atan2(pFar.im  - center.im, pFar.re  - center.re))) addPt(pFar);
                // Circle's arg-extremal tangent points from origin (only when origin is outside circle)
                if (cMod > radius + 1e-9) {
                    const phi   = Math.atan2(center.im, center.re);
                    const delta = Math.acos(Math.max(-1, Math.min(1, -radius / cMod)));
                    for (const sign of [-1, 1]) {
                        const t  = phi + sign * delta;
                        const pt = { re: center.re + radius * Math.cos(t), im: center.im + radius * Math.sin(t) };
                        if (isOnArc(t)) addPt(pt);
                    }
                }
            }
            let modMin = Infinity, modMax = -Infinity, argMin = Infinity, argMax = -Infinity;
            let modMinPt = null, modMaxPt = null, argMinPt = null, argMaxPt = null;
            for (const pt of candidates) {
                const m = Math.hypot(pt.re, pt.im), ag = Math.atan2(pt.im + 0, pt.re);
                if (m  < modMin) { modMin = m;  modMinPt = pt; }
                if (m  > modMax) { modMax = m;  modMaxPt = pt; }
                if (ag < argMin) { argMin = ag; argMinPt = pt; }
                if (ag > argMax) { argMax = ag; argMaxPt = pt; }
            }
            if (!modMinPt) return null;
            return { modMin, modMax, modMinPt, modMaxPt, argMin: isFinite(argMin) ? argMin : null, argMax: isFinite(argMax) ? argMax : null, argMinPt, argMaxPt, fullArgRange: false, approximate: false };
        }

        if (fp?.kind === 'line' && fp.perpBisector) {
            const { point, direction } = fp;
            const dx = direction.re, dy = direction.im;
            const dLen2 = dx * dx + dy * dy;
            if (dLen2 < 1e-18) return null;
            const t = (-point.re * dx - point.im * dy) / dLen2;
            const foot = { re: point.re + t * dx, im: point.im + t * dy };
            return { modMin: Math.hypot(foot.re, foot.im), modMax: null, modMinPt: foot, modMaxPt: null, argMin: null, argMax: null, argMinPt: null, argMaxPt: null, fullArgRange: false, approximate: false };
        }

        // General numeric locus: approximate extrema from cached segment endpoints
        const segs = c._locusCache?.segments;
        if (!segs?.length) return null;
        let modMin = Infinity, modMax = -Infinity, argMin = Infinity, argMax = -Infinity;
        let modMinPt = null, modMaxPt = null, argMinPt = null, argMaxPt = null;
        for (const seg of segs) {
            for (const { x: re, y: im } of seg) {
                if (Math.hypot(re, im) < 1e-9) continue;
                const m = Math.hypot(re, im), ag = Math.atan2(im, re);
                if (m  < modMin) { modMin = m;  modMinPt = { re, im }; }
                if (m  > modMax) { modMax = m;  modMaxPt = { re, im }; }
                if (ag < argMin) { argMin = ag; argMinPt = { re, im }; }
                if (ag > argMax) { argMax = ag; argMaxPt = { re, im }; }
            }
        }
        if (!modMinPt) return null;
        return { modMin, modMax, modMinPt, modMaxPt, argMin: isFinite(argMin) ? argMin : null, argMax: isFinite(argMax) ? argMax : null, argMinPt, argMaxPt, fullArgRange: false, approximate: true };
    }

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
        const fociTitle     = card.querySelector('.foci-info-title');
        const hideFoci = () => { if (fociContainer) fociContainer.classList.remove('visible'); if (fociList) fociList.innerHTML = ''; };
        const extremaContainer = card.querySelector('.extrema-info-container');
        const extremaList      = card.querySelector('.extrema-info-list');
        const extremaToggle    = card.querySelector('.extrema-visibility-toggle');
        const hideExtrema = () => { if (extremaContainer) extremaContainer.classList.remove('visible'); if (extremaList) extremaList.innerHTML = ''; };

        const hide = () => { container.classList.remove('visible'); hideFoci(); hideExtrema(); };

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
            hideFoci(); hideExtrema();
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
                        wrapper.appendChild(makeMF(`\\phantom{${label}=}+${rPart}i\\sin(${thStr})`, mfSize));
                    }
                } else {
                    wrapper.appendChild(makeMF(`${varName}_{${k + 1}}=${this.formatComplexLatex(root.re, root.im, fmt)}`, mfSize));
                }

                rootsEl.appendChild(wrapper);
            }
            container.classList.add('visible');

        } else if (c.type === 'compound-locus' && c.compoundParts) {
            container.classList.remove('is-equation');
            badge.textContent      = 'Compound Inequality';
            valueEl.style.display  = '';
            rootsEl.style.display  = 'none';
            rootsEl.innerHTML      = '';
            valueEl.textContent    = 'region';
            hideFoci(); hideExtrema();
            container.classList.add('visible');

        } else if (c.type === 'locus' && c.locus) {
            container.classList.remove('is-equation');
            badge.textContent      = c.locus.inequality ? 'Inequality' : 'Locus';
            valueEl.style.display  = '';
            rootsEl.style.display  = 'none';
            rootsEl.innerHTML      = '';
            const fp = c.locus.fastPath;
            const lineLabel = fp?.kind === 'line' ? (fp.perpBisector ? 'perpendicular bisector' : 'line') : null;
            const joukowskiLabel = fp?.kind === 'joukowski' ? `Joukowski (n=${fp.n}, ${fp.cosSign === -1 ? '\u2212' : '+'})` : null;
            const kinds = { circle: 'circle', line: lineLabel, ray: 'half-line', apollonius: 'Apollonius', spiral: 'Archimedean', 'spiral-shifted': 'spiral', joukowski: joukowskiLabel, 'inscribed-arc': 'inscribed arc' };
            valueEl.textContent = fp ? (kinds[fp.kind] ?? fp.kind) : 'locus';
            const hasFoci = fp?.kind === 'circle' || !!(fp?.focusA && fp?.focusB && (fp?.perpBisector || fp?.kind === 'apollonius'));
            if (hasFoci) {
                fociContainer.classList.add('visible');
                if (fociToggle) fociToggle.classList.toggle('is-hidden', c.showFoci === false);
                if (fociTitle) fociTitle.textContent = fp.kind === 'circle' ? 'Centre' : 'Foci';
                fociList.innerHTML = '';
                const fmtCoord = ({ re, im }) => {
                    const a = this.niceRealLatex(re)  ?? this.formatNumberShort(re);
                    const b = this.niceRealLatex(im)  ?? this.formatNumberShort(im);
                    return `\\left(${a},\\,${b}\\right)`;
                };
                if (fp.focusA && fp.focusB) {
                    for (const focus of [fp.focusA, fp.focusB]) {
                        const wrapper = document.createElement('div');
                        wrapper.appendChild(makeMF(fmtCoord(focus), 17));
                        fociList.appendChild(wrapper);
                    }
                }
                if (fp.kind === 'apollonius' && fp.ratio != null) {
                    const kStr = this.niceRealLatex(fp.ratio) ?? this.formatNumberShort(fp.ratio);
                    const wrapper = document.createElement('div');
                    wrapper.appendChild(makeMF(`k=${kStr}`, 17));
                    fociList.appendChild(wrapper);
                }
                if (fp.center && (fp.kind === 'circle' || fp.kind === 'apollonius')) {
                    const cWrapper = document.createElement('div');
                    cWrapper.appendChild(makeMF(`C=${fmtCoord(fp.center)}`, 17));
                    fociList.appendChild(cWrapper);
                    const rStr = this.niceRealLatex(fp.radius) ?? this.formatNumberShort(fp.radius);
                    const rWrapper = document.createElement('div');
                    rWrapper.appendChild(makeMF(`r=${rStr}`, 17));
                    fociList.appendChild(rWrapper);
                }
            } else {
                hideFoci();
            }
            const extrema = this._computeLocusExtrema(c);
            if (extrema) {
                if (extremaContainer) extremaContainer.classList.add('visible');
                if (extremaToggle) extremaToggle.classList.toggle('is-hidden', c.showExtrema === false);
                if (extremaList) extremaList.innerHTML = '';
                const ap  = extrema.approximate ? '\\approx ' : '';
                const rel = extrema.approximate ? '\\approx ' : '=';
                const fmtVal = v => this.niceRealLatex(v) ?? this.formatNumberShort(v);
                if (extrema.modMin !== null && extremaList)
                    extremaList.appendChild(makeMF(`|z|_{\\min}${rel}${fmtVal(extrema.modMin)}`, 15));
                if (extrema.modMax !== null && extremaList)
                    extremaList.appendChild(makeMF(`|z|_{\\max}${rel}${fmtVal(extrema.modMax)}`, 15));
                if (extrema.fullArgRange && extremaList) {
                    extremaList.appendChild(makeMF('\\arg(z)\\in(-\\pi,\\,\\pi]', 15));
                } else if (extrema.argMin !== null && extrema.argMax !== null && extremaList) {
                    const amin = this.niceAngleLatex(extrema.argMin) ?? this.formatNumberShort(extrema.argMin);
                    const amax = this.niceAngleLatex(extrema.argMax) ?? this.formatNumberShort(extrema.argMax);
                    extremaList.appendChild(makeMF(`\\arg(z)\\in[${ap}${amin},\\,${ap}${amax}]`, 15));
                }
            } else {
                hideExtrema();
            }
            container.classList.add('visible');

        } else if (c.type === 'value' && c.re !== null && c.im !== null) {
            hideFoci(); hideExtrema(); hideExtrema();
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
        for (const k of [2, 3, 5, 6, 7, 10, 11, 13, 14, 15]) {
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
        // Try integer + rational*√k forms: e.g. √2-1, 1+√2, 3+2√3
        for (const k of [2, 3, 5, 6, 7, 10, 11, 13, 14, 15]) {
            const sqK = Math.sqrt(k);
            for (let ai = -8; ai <= 8; ai++) {
                if (ai === 0) continue;
                const residual = value - ai;
                if (Math.abs(residual) < tol) continue;
                const ratio = residual / sqK;
                for (let d = 1; d <= 6; d++) {
                    const n = Math.round(ratio * d);
                    if (n === 0 || Math.abs(ratio - n / d) > tol) continue;
                    const g = this._gcd(Math.abs(n), d); const sn = n / g, sd = d / g;
                    if (sd > 6) continue;
                    const absN = Math.abs(sn);
                    const sqrtFrac = sd === 1
                        ? (absN === 1 ? `\\sqrt{${k}}` : `${absN}\\sqrt{${k}}`)
                        : (absN === 1 ? `\\frac{\\sqrt{${k}}}{${sd}}` : `\\frac{${absN}\\sqrt{${k}}}{${sd}}`);
                    if (ai < 0 && sn > 0) return `${sqrtFrac}${ai}`;
                    if (ai > 0 && sn > 0) return `${ai}+${sqrtFrac}`;
                    return `${ai}${sn > 0 ? '+' : '-'}${sqrtFrac}`;
                }
            }
        }
        return null;
    }

    formatCartesianLatex(re, im) {
        const aStr = this.niceRealLatex(re)          ?? this.formatNumberShort(re);
        const bAbs = this.niceRealLatex(Math.abs(im)) ?? this.formatNumberShort(Math.abs(im));
        const bStr = bAbs === '1' ? '' : bAbs;
        if (Math.abs(im) < 1e-10) return aStr;
        if (Math.abs(re) < 1e-10) return im < -1e-10 ? `-${bStr}i` : `${bStr}i`;
        const sign = im < -1e-10 ? '-' : '+';
        return `${aStr}${sign}${bStr}i`;
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
        for (const k of [2, 3, 5, 6, 7, 10, 11, 13, 14, 15]) {
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
        const bStr = bAbs === '1' ? '' : bAbs;
        if (Math.abs(im) < 1e-10) return aStr;
        if (Math.abs(re) < 1e-10) return im < -1e-10 ? `-${bStr}i` : `${bStr}i`;
        const sign = im < -1e-10 ? ' - ' : ' + ';
        return `${aStr}${sign}${bStr}i`;
    }

    formatArgument(theta) {
        const deg    = theta * 180 / Math.PI;
        const niceθ  = this.niceAngleHTML(theta);
        const radStr = niceθ ? `${niceθ} rad` : `${this.formatNumber(theta)} rad`;
        return `${radStr} (${this.formatNumber(deg)}&deg;)`;
    }

    drawExpressions() {
        if (!this.expressions.length) return;
        this._extremaHitTargets    = [];
        this._locusIntersectionHits = [];
        const ctx     = this.ctx;
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const fSize       = this.sizeMode === 'xlarge' ? 26 : this.sizeMode === 'large' ? 22 : 18;
        const dotR        = this.sizeMode === 'xlarge' ? 8.5 : this.sizeMode === 'large' ? 7 : 6;
        const strokeWidth = this.sizeMode === 'xlarge' ? 5  : this.sizeMode === 'large' ? 4  : 3;
        const headLen     = this.sizeMode === 'xlarge' ? 15 : this.sizeMode === 'large' ? 13 : 11;

        const ineqLoci = [];
        for (const _c of this.expressions) {
            if (!_c.enabled) continue;
            if (_c.type === 'locus' && _c.locus?.inequality && _c.equationVar) {
                ineqLoci.push(_c);
            } else if (_c.type === 'compound-locus' && _c.compoundParts) {
                for (const part of _c.compoundParts) ineqLoci.push(part);
            }
        }
        if (ineqLoci.length >= 2) this._drawInequalityIntersection(ineqLoci, ctx);

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
                    // For fast-path inequality loci, build/cache shade grid where needed
                    if (c.locus.inequality) {
                        const fpKind = fp?.kind;
                        if (fpKind !== 'circle' && fpKind !== 'apollonius' && fpKind !== 'ray' && fpKind !== 'line' && fpKind !== 'inscribed-arc') {
                            const vp = this.viewport;
                            const cached = c._locusCache;
                            const fresh = cached && cached.minX === vp.minX && cached.maxX === vp.maxX &&
                                cached.minY === vp.minY && cached.maxY === vp.maxY;
                            if (!fresh) {
                                if (!cached) {
                                    const shadeGrid = this._buildLocusShadeGrid(c.locus, c.equationVar, c.id);
                                    c._locusCache = { segments: null, shadeGrid, minX: vp.minX, maxX: vp.maxX, minY: vp.minY, maxY: vp.maxY };
                                } else {
                                    this._scheduleLocusRetrace();
                                }
                            }
                        }
                    }
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
                        const shadeGrid = c.locus.inequality
                            ? this._buildLocusShadeGrid(c.locus, c.equationVar, c.id)
                            : null;
                        c._locusCache = { segments, shadeGrid, minX: vp.minX, maxX: vp.maxX, minY: vp.minY, maxY: vp.maxY };
                        // Cache just built for the first time: refresh card metadata so extrema appear
                        clearTimeout(this._metadataRefreshTimer);
                        this._metadataRefreshTimer = setTimeout(() => this.updateAllCardMetadata(), 0);
                    }
                }
                // Draw shading before the boundary so the curve renders on top
                if (c.locus.inequality && ineqLoci.length < 2) this._drawLocusShade(c, ctx);
                if (!segments?.length) continue;
                ctx.save();
                ctx.strokeStyle = c.color;
                ctx.lineWidth = Math.max(2, strokeWidth - 0.5);
                ctx.globalAlpha = 0.95;
                const chains = this._stitchSegmentsToChains(segments);
                if (c.locus.inequality?.strict) {
                    ctx.setLineDash([8, 5]);
                    let dashAcc = 0;
                    for (const chain of chains) {
                        if (!chain.length) continue;
                        const pts = chain.map(p => this.worldToScreen(p.x, p.y));
                        ctx.lineDashOffset = dashAcc % 13;
                        ctx.beginPath();
                        ctx.moveTo(pts[0].x, pts[0].y);
                        for (let ci = 1; ci < pts.length; ci++) ctx.lineTo(pts[ci].x, pts[ci].y);
                        ctx.stroke();
                        for (let ci = 1; ci < pts.length; ci++)
                            dashAcc += Math.hypot(pts[ci].x - pts[ci - 1].x, pts[ci].y - pts[ci - 1].y);
                    }
                } else {
                    ctx.beginPath();
                    for (const chain of chains) {
                        if (!chain.length) continue;
                        const p0 = this.worldToScreen(chain[0].x, chain[0].y);
                        ctx.moveTo(p0.x, p0.y);
                        for (let ci = 1; ci < chain.length; ci++) {
                            const pt = this.worldToScreen(chain[ci].x, chain[ci].y);
                            ctx.lineTo(pt.x, pt.y);
                        }
                    }
                    ctx.stroke();
                }
                ctx.restore();

                // Draw F₁/F₂ foci if the locus has focus points and they are enabled
                if (c.showFoci !== false && fp?.focusA && fp?.focusB && (fp?.perpBisector || fp?.kind === 'apollonius')) {
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

                // Dotted line between the foci with a right-angle marker where it crosses the perpendicular bisector
                if (c.showFoci !== false && fp?.perpBisector && fp?.focusA && fp?.focusB) {
                    const aPt = this.worldToScreen(fp.focusA.re, fp.focusA.im);
                    const bPt = this.worldToScreen(fp.focusB.re, fp.focusB.im);
                    ctx.save();
                    ctx.strokeStyle = c.color;
                    ctx.lineWidth   = 1;
                    ctx.globalAlpha = 0.6;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(aPt.x, aPt.y);
                    ctx.lineTo(bPt.x, bPt.y);
                    ctx.stroke();
                    ctx.restore();

                    // Right-angle marker at the midpoint, the point where the segment crosses the locus
                    const midX  = (fp.focusA.re + fp.focusB.re) / 2, midY = (fp.focusA.im + fp.focusB.im) / 2;
                    const midPt = this.worldToScreen(midX, midY);
                    const ulen  = Math.hypot(bPt.x - aPt.x, bPt.y - aPt.y) || 1;
                    const ux    = (bPt.x - aPt.x) / ulen, uy = (bPt.y - aPt.y) / ulen;
                    const px    = -uy, py = ux;
                    const s     = Math.max(12, dotR + 3);
                    ctx.save();
                    ctx.strokeStyle = c.color;
                    ctx.lineWidth   = 2.5;
                    ctx.globalAlpha = 0.9;
                    ctx.beginPath();
                    ctx.moveTo(midPt.x + ux * s, midPt.y + uy * s);
                    ctx.lineTo(midPt.x + ux * s + px * s, midPt.y + uy * s + py * s);
                    ctx.lineTo(midPt.x + px * s, midPt.y + py * s);
                    ctx.stroke();
                    ctx.restore();
                }

                // Draw centre C for circle and Apollonius
                if (c.showFoci !== false && fp?.center && (fp.kind === 'circle' || fp.kind === 'apollonius')) {
                    const cPt   = this.worldToScreen(fp.center.re, fp.center.im);
                    const cDotR = Math.max(3, dotR - 1.5);
                    ctx.save();
                    ctx.fillStyle   = c.color;
                    ctx.globalAlpha = 0.75;
                    ctx.beginPath();
                    ctx.arc(cPt.x, cPt.y, cDotR, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = isLight ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.55)';
                    ctx.lineWidth   = 1.5;
                    ctx.stroke();
                    ctx.globalAlpha = 0.9;
                    ctx.font      = `italic ${fSize}px Arial`;
                    ctx.fillStyle = c.color;
                    ctx.fillText('C', cPt.x + cDotR + 3, cPt.y - cDotR - 2);
                    ctx.restore();
                }

                if (c.showExtrema !== false) {
                    const ex = this._computeLocusExtrema(c);
                    if (ex) {
                        const markerR = Math.max(2.5, dotR - 2);
                        const org     = this.worldToScreen(0, 0);
                        const near    = (p1, p2) => p1 && p2 && Math.hypot(p1.re - p2.re, p1.im - p2.im) < 1e-6;
                        const drawExtrema = (pt, label, isArg, tooltipText) => {
                            if (!pt) return;
                            const sp = this.worldToScreen(pt.re, pt.im);
                            ctx.save();
                            ctx.strokeStyle = c.color;
                            ctx.lineWidth   = 1;
                            ctx.globalAlpha = 0.6;
                            ctx.setLineDash([4, 4]);
                            ctx.beginPath();
                            ctx.moveTo(org.x, org.y);
                            ctx.lineTo(sp.x, sp.y);
                            ctx.stroke();
                            ctx.setLineDash([]);
                            ctx.globalAlpha = 0.9;
                            ctx.beginPath();
                            ctx.arc(sp.x, sp.y, markerR, 0, Math.PI * 2);
                            if (isArg) {
                                ctx.strokeStyle = c.color;
                                ctx.lineWidth   = 1.5;
                                ctx.stroke();
                            } else {
                                ctx.fillStyle = c.color;
                                ctx.fill();
                            }
                            ctx.font      = `${fSize - 4}px Arial`;
                            ctx.fillStyle = c.color;
                            ctx.fillText(label, sp.x + markerR + 3, sp.y - markerR - 1);
                            ctx.restore();
                            if (tooltipText) this._extremaHitTargets.push({ x: sp.x, y: sp.y, r: markerR + 8, text: tooltipText });
                        };
                        drawExtrema(ex.modMinPt, '|z| min', false, 'Closest point to the origin on this locus - the minimum value of |z|.');
                        if (!near(ex.modMaxPt, ex.modMinPt)) drawExtrema(ex.modMaxPt, '|z| max', false, 'Farthest point from the origin on this locus - the maximum value of |z|.');
                        if (!ex.fullArgRange) {
                            if (!near(ex.argMinPt, ex.modMinPt) && !near(ex.argMinPt, ex.modMaxPt))
                                drawExtrema(ex.argMinPt, 'arg min', true, 'Tangent point from the origin - the ray from O at this angle just grazes the locus from below. All other points on this locus have a larger argument.');
                            if (!near(ex.argMaxPt, ex.modMinPt) && !near(ex.argMaxPt, ex.modMaxPt) && !near(ex.argMaxPt, ex.argMinPt))
                                drawExtrema(ex.argMaxPt, 'arg max', true, 'Tangent point from the origin - the ray from O at this angle just grazes the locus from above. All other points on this locus have a smaller argument.');
                        }
                    }
                }

                continue;
            }

            // --- Compound inequality: draw each boundary curve in the card colour ---
            if (c.type === 'compound-locus' && c.compoundParts) {
                // On initial build, share the LHS evaluation - skip if all parts have geometric fast paths
                {
                    const _pp = c.compoundParts, _vp = this.viewport;
                    const _geomKinds = new Set(['ray', 'line', 'circle', 'apollonius']);
                    const _allGeom = _pp.every(p => _geomKinds.has(p.locus.fastPath?.kind));
                    if (!_allGeom && _pp.length === 2 && _pp[0].locus.lhs === _pp[1].locus.lhs &&
                        !_pp[0]._locusCache && !_pp[1]._locusCache) {
                        const _res = this._traceCompoundPartsWithShade(_pp[0].locus, _pp[1].locus, _pp[0].equationVar, _pp[0].id);
                        if (_res) for (let i = 0; i < 2; i++) {
                            _pp[i]._locusCache = { ..._res[i], minX: _vp.minX, maxX: _vp.maxX, minY: _vp.minY, maxY: _vp.maxY };
                        }
                    }
                }
                for (const part of c.compoundParts) {
                    const fastSegs = this._traceFastLocusSegments(part.locus);
                    let segs;
                    if (fastSegs !== null) {
                        segs = fastSegs;
                        const fpKind = part.locus.fastPath?.kind;
                        if (fpKind !== 'circle' && fpKind !== 'apollonius' && fpKind !== 'ray' && fpKind !== 'line' && fpKind !== 'inscribed-arc') {
                            const vp = this.viewport;
                            const cc = part._locusCache;
                            const fresh = cc && cc.minX === vp.minX && cc.maxX === vp.maxX && cc.minY === vp.minY && cc.maxY === vp.maxY;
                            if (!fresh) {
                                if (!cc) {
                                    part._locusCache = { segments: null, shadeGrid: this._buildLocusShadeGrid(part.locus, part.equationVar, part.id), ...vp };
                                } else {
                                    this._scheduleLocusRetrace();
                                }
                            }
                        }
                    } else {
                        const vp = this.viewport;
                        const cc = part._locusCache;
                        const fresh = cc && cc.minX === vp.minX && cc.maxX === vp.maxX && cc.minY === vp.minY && cc.maxY === vp.maxY;
                        if (fresh) {
                            segs = cc.segments;
                        } else if (cc) {
                            segs = cc.segments;
                            this._scheduleLocusRetrace();
                        } else {
                            segs = this._traceLocusSegments(part.locus, part.equationVar, part.id);
                            part._locusCache = { segments: segs, shadeGrid: this._buildLocusShadeGrid(part.locus, part.equationVar, part.id), minX: vp.minX, maxX: vp.maxX, minY: vp.minY, maxY: vp.maxY };
                        }
                    }
                    if (!segs?.length) continue;
                    ctx.save();
                    ctx.strokeStyle = c.color;
                    ctx.lineWidth = Math.max(2, strokeWidth - 0.5);
                    ctx.globalAlpha = 0.95;
                    const chains = this._stitchSegmentsToChains(segs);
                    if (part.locus.inequality?.strict) {
                        ctx.setLineDash([8, 5]);
                        let dashAcc = 0;
                        for (const chain of chains) {
                            if (!chain.length) continue;
                            const pts = chain.map(p => this.worldToScreen(p.x, p.y));
                            ctx.lineDashOffset = dashAcc % 13;
                            ctx.beginPath();
                            ctx.moveTo(pts[0].x, pts[0].y);
                            for (let ci = 1; ci < pts.length; ci++) ctx.lineTo(pts[ci].x, pts[ci].y);
                            ctx.stroke();
                            for (let ci = 1; ci < pts.length; ci++)
                                dashAcc += Math.hypot(pts[ci].x - pts[ci - 1].x, pts[ci].y - pts[ci - 1].y);
                        }
                    } else {
                        ctx.beginPath();
                        for (const chain of chains) {
                            if (!chain.length) continue;
                            const p0 = this.worldToScreen(chain[0].x, chain[0].y);
                            ctx.moveTo(p0.x, p0.y);
                            for (let ci = 1; ci < chain.length; ci++) {
                                const pt = this.worldToScreen(chain[ci].x, chain[ci].y);
                                ctx.lineTo(pt.x, pt.y);
                            }
                        }
                        ctx.stroke();
                    }
                    ctx.restore();
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

        // Draw intersection dots for all enabled fast-path loci pairs
        const ipts = this._fastPathIntersections();
        if (ipts.length) {
            const iDotR = strokeWidth / 2;
            const iEdge = 2.5;
            const hitR  = Math.max(14, iDotR + iEdge + 6);
            const outerFill = isLight ? '#000000' : '#ffffff';
            const innerFill = isLight ? '#ffffff' : '#000000';
            for (const p of ipts) {
                const sp = this.worldToScreen(p.re, p.im);
                ctx.save();
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, iDotR + iEdge, 0, Math.PI * 2);
                ctx.fillStyle = outerFill;
                ctx.fill();
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, iDotR, 0, Math.PI * 2);
                ctx.fillStyle = innerFill;
                ctx.fill();
                ctx.restore();
                this._locusIntersectionHits.push({ x: sp.x, y: sp.y, re: p.re, im: p.im, hitR, exprIds: p.exprIds });
            }
        }
    }

    // =========================================================================
    // Sharing
    // =========================================================================

    encodeShareState() {
        const state = {
            v: 1,
            expressions: this.expressions
                .filter(c => c.latex && c.latex.trim() !== '')
                .map(c => ({
                    latex:       c.latex,
                    color:       c.color,
                    cardRootFmt: c.cardRootFmt || 'cartesian'
                }))
        };
        return JSON.stringify(state);
    }

    decodeShareState(compressed) {
        try {
            const json  = LZString.decompressFromEncodedURIComponent(compressed);
            const state = JSON.parse(json);
            if (state.v !== 1) return null;
            return state;
        } catch {
            return null;
        }
    }

    checkForSharedState() {
        const hash = window.location.hash;
        if (!hash.startsWith('#v=')) return null;
        return this.decodeShareState(hash.slice(3));
    }

    checkAndApplySharedState() {
        const state = this.checkForSharedState();
        if (!state) return;
        this.tempSession = true;
        // Auto-launch directly into the app, bypassing the title screen
        requestAnimationFrame(() => {
            this.launchApp();
            this.applySharedState(state);
        });
    }

    applySharedState(state) {
        // Replace all expressions with the shared ones (enabled=true, metadata toggles at defaults)
        this.expressions = [];
        this.nextExpressionId = 1;
        if (this.expressionsContainer) this.expressionsContainer.innerHTML = '';

        const exprs = Array.isArray(state.expressions) ? state.expressions : [];
        for (const item of exprs) {
            if (!item.latex || !item.latex.trim()) continue;
            const id    = this.nextExpressionId++;
            const color = item.color || this.expressionColors[(id - 1) % this.expressionColors.length];
            const c     = {
                id, color, enabled: true, latex: item.latex,
                cardRootFmt: item.cardRootFmt || 'cartesian',
                name: null, re: null, im: null, type: 'value',
                roots: null, equationVar: null, locus: null, hasParseError: false
            };
            this.expressions.push(c);
            this.createExpressionUI(c, { skipFocus: true });
        }

        // Ensure there is always a blank tile at the bottom
        if (!this.expressions.some(c => !c.latex || c.latex.trim() === '')) {
            this.addExpression({ skipFocus: true });
        }

        this.cascadeEvaluate(null);
        this.updateAllCardMetadata();
        this.resetAxes();
        if (this.currentState === this.states.APP) this.drawCanvas();
        this.showTempSessionBanner();
    }

    showTempSessionBanner() {
        const banner = document.getElementById('temp-session-banner');
        if (!banner) return;
        banner.style.display = 'block';
        banner.onclick = () => {
            window.location.hash = '';
            window.location.reload();
        };
    }

    async shareGraphLink() {
        try {
            if (typeof LZString === 'undefined') {
                alert('Compression library not loaded. Please refresh the page.');
                return;
            }
            const compressed = LZString.compressToEncodedURIComponent(this.encodeShareState());
            const baseUrl  = window.location.origin + window.location.pathname;
            const shareUrl = `${baseUrl}#v=${compressed}`;

            const isIOS    = /iPhone|iPad|iPod/i.test(navigator.userAgent);
            const isIPad   = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
            const isMobile = isIOS || isIPad || /Android/i.test(navigator.userAgent);

            if (isMobile && navigator.share) {
                try {
                    await navigator.share({ url: shareUrl });
                    this._showShareTooltipNearButton('Link shared');
                    return;
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    // fall through to clipboard
                }
            }

            if (navigator.clipboard && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(shareUrl);
                    this._showShareTooltipNearButton('Link copied to clipboard');
                    return;
                } catch {
                    // fall through
                }
            }

            // Last resort: prompt
            const result = prompt('Copy this link to share your expressions:', shareUrl);
            if (result !== null) this._showShareTooltipNearButton('Link ready to copy');
        } catch (err) {
            console.error('Failed to share link:', err);
            alert('Failed to share link. Please try again.');
        }
    }

    async shareQRCode() {
        try {
            if (typeof QRious === 'undefined') {
                alert('QR code library not loaded. Please refresh the page.');
                return;
            }
            if (typeof LZString === 'undefined') {
                alert('Compression library not loaded. Please refresh the page.');
                return;
            }
            const compressed = LZString.compressToEncodedURIComponent(this.encodeShareState());
            const baseUrl  = window.location.origin + window.location.pathname;
            const shareUrl = `${baseUrl}#v=${compressed}`;

            const qr  = new QRious({ value: shareUrl, size: 512, level: 'M' });
            const blob = await new Promise((resolve, reject) => {
                qr.canvas.toBlob(b => b ? resolve(b) : reject(new Error('Failed to create QR image')), 'image/png');
            });

            const isIOS    = /iPhone|iPad|iPod/i.test(navigator.userAgent);
            const isIPad   = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
            const isMobile = isIOS || isIPad || /Android/i.test(navigator.userAgent);

            if (isMobile && navigator.share && navigator.canShare) {
                const file = new File([blob], 'komplexiti-qr.png', { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({ files: [file] });
                        this._showShareTooltipNearButton('QR code shared');
                        return;
                    } catch (err) {
                        if (err.name === 'AbortError') return;
                        // fall through
                    }
                }
            }

            if (navigator.clipboard && navigator.clipboard.write) {
                try {
                    const item = new ClipboardItem({ 'image/png': blob });
                    await navigator.clipboard.write([item]);
                    this._showShareTooltipNearButton('QR code copied to clipboard');
                    return;
                } catch {
                    // fall through to download
                }
            }

            // Fallback: download the QR image
            const url = URL.createObjectURL(blob);
            const a   = document.createElement('a');
            a.href     = url;
            a.download = 'komplexiti-qr.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this._showShareTooltipNearButton('QR code downloaded');
        } catch (err) {
            console.error('Failed to share QR code:', err);
            alert('Failed to share QR code. Please try again.');
        }
    }

    _showShareTooltipNearButton(text) {
        const btn = document.getElementById('share-button');
        if (!btn) return;
        const rect   = btn.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top;
        this.showShareTooltip(text, centerX, centerY);
    }

    showShareTooltip(text, x, y) {
        const tooltip = document.createElement('div');
        tooltip.textContent = text;
        tooltip.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y - 50}px;
            transform: translateX(-50%);
            font-size: 13px;
            font-family: Inter, system-ui, sans-serif;
            background: rgba(42, 63, 90, 0.95);
            color: #E8F4FD;
            padding: 8px;
            border-radius: 4px;
            border: 1px solid rgba(74, 144, 226, 0.5);
            z-index: 10000;
            pointer-events: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            animation: shareTooltipFade 2s ease-in-out;
            white-space: nowrap;
        `;
        if (!document.getElementById('share-tooltip-style')) {
            const style = document.createElement('style');
            style.id = 'share-tooltip-style';
            style.textContent = `
                @keyframes shareTooltipFade {
                    0%   { opacity: 0; transform: translate(-50%, -5px); }
                    15%  { opacity: 1; transform: translate(-50%, 0); }
                    85%  { opacity: 1; transform: translate(-50%, 0); }
                    100% { opacity: 0; transform: translate(-50%, -5px); }
                }
            `;
            document.head.appendChild(style);
        }
        document.body.appendChild(tooltip);
        setTimeout(() => tooltip.remove(), 2000);
    }

    setupShareMenu() {
        const shareButton = document.getElementById('share-button');
        const shareMenu   = document.getElementById('share-menu');
        const menuLink    = document.getElementById('share-menu-link');
        const menuQR      = document.getElementById('share-menu-qr');

        if (!shareButton || !shareMenu) return;

        const closeMenu = () => {
            shareMenu.style.display = 'none';
            shareButton.setAttribute('aria-expanded', 'false');
        };
        const openMenu = () => {
            shareMenu.style.display = 'block';
            shareButton.setAttribute('aria-expanded', 'true');
        };
        this.closeShareMenu = closeMenu;

        // On touch devices a single tap should share directly rather than open a sub-menu
        shareButton.addEventListener('touchend', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeMenu();
            try { await this.shareGraphLink(); } catch (err) { console.error(err); }
        }, { passive: false });

        shareButton.addEventListener('click', (e) => {
            e.stopPropagation();
            shareMenu.style.display === 'block' ? closeMenu() : openMenu();
        });

        shareMenu.addEventListener('click', (e) => e.stopPropagation());

        document.addEventListener('click', closeMenu);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

        if (menuLink) {
            menuLink.addEventListener('click', async () => {
                closeMenu();
                try { await this.shareGraphLink(); } catch (err) { console.error(err); }
            });
        }
        if (menuQR) {
            menuQR.addEventListener('click', async () => {
                closeMenu();
                try { await this.shareQRCode(); } catch (err) { console.error(err); }
            });
        }
    }

    // =========================================================================
    // Export
    // =========================================================================

    toggleExportOverlay(forceOpen = null) {
        const overlay = document.getElementById('export-overlay');
        if (!overlay) return;
        const shouldOpen = forceOpen === null
            ? !overlay.classList.contains('show')
            : !!forceOpen;
        if (shouldOpen) {
            overlay.classList.add('show');
            this.applyDefaultExportFormat();
            this.updateExportFormatUI();
        } else {
            overlay.classList.remove('show');
            this.cancelExportPreviewUpdate();
            if (document.activeElement) document.activeElement.blur();
        }
    }

    isTouchExportDevice() {
        const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
        const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        return this.isMobileDevice?.() || (coarsePointer && hasTouch);
    }

    getSelectedExportFormat() {
        const formatInput = document.querySelector('input[name="export-format"]:checked');
        return formatInput ? formatInput.value : 'svg';
    }

    applyDefaultExportFormat() {
        const defaultFormat = this.isTouchExportDevice() ? 'png' : 'svg';
        const defaultInput = document.querySelector(`input[name="export-format"][value="${defaultFormat}"]`);
        if (defaultInput) defaultInput.checked = true;
    }

    updateExportFormatUI() {
        const format = this.getSelectedExportFormat();
        const svgOnlyGroups = document.querySelectorAll('.export-svg-only');
        const generateButton = document.getElementById('export-generate-button');
        const includeAxesInput   = document.getElementById('export-include-axes');
        const includeLabelsInput = document.getElementById('export-include-axis-labels');
        const axisTicksGroup     = document.getElementById('export-axis-ticks-group');
        const axisLabelDensityGroup = document.getElementById('export-axis-label-density-group');

        for (const group of svgOnlyGroups) {
            group.classList.toggle('export-hidden', format !== 'svg');
        }

        if (axisTicksGroup) {
            const show = format === 'svg' && (!includeAxesInput || includeAxesInput.checked);
            axisTicksGroup.classList.toggle('export-hidden', !show);
        }

        if (axisLabelDensityGroup) {
            const show = format === 'svg' && (!includeLabelsInput || includeLabelsInput.checked);
            axisLabelDensityGroup.classList.toggle('export-hidden', !show);
        }

        if (generateButton) {
            generateButton.textContent = format === 'png'
                ? (this.isTouchExportDevice() ? 'Share PNG' : 'Download PNG')
                : 'Download SVG';
        }

        this.requestExportPreviewUpdate();
    }

    exportCurrentViewFromModal() {
        const format = this.getSelectedExportFormat();
        if (format === 'png') {
            this.exportCurrentViewAsPNG();
        } else {
            this.exportCurrentViewAsSVG();
        }
    }

    requestExportPreviewUpdate() {
        if (this.exportPreviewFrameRequestId) return;
        this.exportPreviewFrameRequestId = requestAnimationFrame(() => {
            this.exportPreviewFrameRequestId = null;
            const overlay = document.getElementById('export-overlay');
            if (!overlay?.classList.contains('show')) return;
            this.updateExportFramePreview();
        });
    }

    cancelExportPreviewUpdate() {
        if (this.exportPreviewFrameRequestId) {
            cancelAnimationFrame(this.exportPreviewFrameRequestId);
            this.exportPreviewFrameRequestId = null;
        }
        if (this.exportPreviewSvgUrl) {
            URL.revokeObjectURL(this.exportPreviewSvgUrl);
            this.exportPreviewSvgUrl = null;
        }
    }

    getExportFrameRect(sourceWidth, sourceHeight, frameShape = 'original') {
        const width  = Math.max(1, Math.round(sourceWidth));
        const height = Math.max(1, Math.round(sourceHeight));
        let targetRatio = null;
        if (frameShape === '1:1')  targetRatio = 1;
        if (frameShape === '4:3')  targetRatio = 4 / 3;
        if (frameShape === '16:9') targetRatio = 16 / 9;
        if (!targetRatio) return { x: 0, y: 0, width, height, ratioLabel: 'Original' };

        const sourceRatio = width / height;
        let cropWidth, cropHeight;
        if (sourceRatio > targetRatio) {
            cropHeight = height;
            cropWidth  = Math.round(height * targetRatio);
        } else {
            cropWidth  = width;
            cropHeight = Math.round(width / targetRatio);
        }
        cropWidth  = Math.max(1, Math.min(width,  cropWidth));
        cropHeight = Math.max(1, Math.min(height, cropHeight));
        return {
            x: Math.round((width  - cropWidth)  / 2),
            y: Math.round((height - cropHeight) / 2),
            width:  cropWidth,
            height: cropHeight,
            ratioLabel: frameShape
        };
    }

    updateExportFramePreview() {
        const previewStage   = document.getElementById('export-preview-stage');
        const previewCanvas  = document.getElementById('export-preview-canvas');
        const previewSvg     = document.getElementById('export-preview-svg');
        const previewFrame   = document.getElementById('export-preview-frame');
        const previewCaption = document.getElementById('export-preview-caption');
        const shapeInput     = document.getElementById('export-frame-shape');
        if (!previewStage || !previewCanvas || !previewSvg || !previewFrame || !shapeInput) return;

        const format = this.getSelectedExportFormat();
        const sourceWidth  = Math.max(1, Math.round(this.viewport.width  || this.canvas.width  || 1));
        const sourceHeight = Math.max(1, Math.round(this.viewport.height || this.canvas.height || 1));
        const frame = this.getExportFrameRect(sourceWidth, sourceHeight, shapeInput.value || 'original');

        const stageBounds = previewStage.getBoundingClientRect();
        const stageWidth  = Math.max(1, stageBounds.width);
        const maxPreviewH = 150;
        const sourceRatio = sourceWidth / sourceHeight;

        let pw = stageWidth;
        let ph = pw / sourceRatio;
        if (ph > maxPreviewH) { ph = maxPreviewH; pw = ph * sourceRatio; }

        const stageHeight = Math.max(120, ph);
        previewStage.style.height = `${stageHeight}px`;

        const surfaceOffX = Math.max(0, (stageWidth - pw) / 2);
        const surfaceOffY = Math.max(0, (stageHeight - ph) / 2);
        const scaleX = pw / sourceWidth;
        const scaleY = ph / sourceHeight;

        previewFrame.style.left      = `${surfaceOffX + frame.x * scaleX}px`;
        previewFrame.style.top       = `${surfaceOffY + frame.y * scaleY}px`;
        previewFrame.style.width     = `${frame.width  * scaleX}px`;
        previewFrame.style.height    = `${frame.height * scaleY}px`;
        previewFrame.style.boxShadow = '0 0 0 9999px rgba(0, 0, 0, 0.38)';

        if (format === 'svg') {
            previewCanvas.classList.add('export-hidden');
            previewSvg.classList.remove('export-hidden');
            previewSvg.style.left   = `${surfaceOffX}px`;
            previewSvg.style.top    = `${surfaceOffY}px`;
            previewSvg.style.width  = `${pw}px`;
            previewSvg.style.height = `${ph}px`;
            try {
                const svgOptions = this.getExportOptionsFromModal();
                svgOptions.previewStrokeScale = Math.min(pw / sourceWidth, ph / sourceHeight);
                const svgString  = this.buildSVGExport({ ...svgOptions, frameShape: 'original' });
                if (svgString) {
                    const blob    = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                    const nextUrl = URL.createObjectURL(blob);
                    if (this.exportPreviewSvgUrl) URL.revokeObjectURL(this.exportPreviewSvgUrl);
                    this.exportPreviewSvgUrl = nextUrl;
                    previewSvg.src = nextUrl;
                }
            } catch (e) {
                console.error('SVG preview failed:', e);
            }
            if (previewCaption) {
                previewCaption.textContent = `Live SVG preview - ${frame.ratioLabel} (${frame.width}\u00d7${frame.height})`;
            }
            return;
        }

        previewSvg.classList.add('export-hidden');
        previewCanvas.classList.remove('export-hidden');
        if (this.exportPreviewSvgUrl) {
            URL.revokeObjectURL(this.exportPreviewSvgUrl);
            this.exportPreviewSvgUrl = null;
        }

        previewCanvas.style.left   = `${surfaceOffX}px`;
        previewCanvas.style.top    = `${surfaceOffY}px`;
        previewCanvas.style.width  = `${pw}px`;
        previewCanvas.style.height = `${ph}px`;

        const dpr = window.devicePixelRatio || 1;
        const pixW = Math.max(1, Math.round(pw * dpr));
        const pixH = Math.max(1, Math.round(ph * dpr));
        if (previewCanvas.width !== pixW || previewCanvas.height !== pixH) {
            previewCanvas.width  = pixW;
            previewCanvas.height = pixH;
        }

        const ctx = previewCanvas.getContext('2d');
        if (ctx) {
            ctx.save();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, pw, ph);
            ctx.drawImage(this.canvas, 0, 0, sourceWidth, sourceHeight, 0, 0, pw, ph);
            ctx.restore();
        }

        if (previewCaption) {
            previewCaption.textContent = `${frame.ratioLabel} - ${frame.width}\u00d7${frame.height}`;
        }
    }

    getExportOptionsFromModal() {
        const formatInput        = document.querySelector('input[name="export-format"]:checked');
        const colorModeInput     = document.querySelector('input[name="export-color-mode"]:checked');
        const gridModeInput      = document.getElementById('export-grid-mode');
        const textSizeInput      = document.getElementById('export-text-size');
        const lineWidthInput     = document.getElementById('export-line-width');
        const frameShapeInput    = document.getElementById('export-frame-shape');
        const includeAxesInput        = document.getElementById('export-include-axes');
        const includeAxisTicksInput  = document.getElementById('export-include-axis-ticks');
        const includeLabelsInput     = document.getElementById('export-include-axis-labels');
        const axisLabelDensityInput  = document.querySelector('input[name="export-axis-label-density"]:checked');
        const includeExtremaInput       = document.getElementById('export-include-extrema');
        const includeIntersectionsInput = document.getElementById('export-include-intersections');
        return {
            format:               formatInput        ? formatInput.value        : 'svg',
            colorMode:            colorModeInput     ? colorModeInput.value     : 'keep',
            gridMode:             gridModeInput      ? gridModeInput.value      : 'both',
            textSize:             textSizeInput      ? textSizeInput.value      : 'large',
            strokeWidth:          lineWidthInput     ? lineWidthInput.value     : 'small',
            frameShape:           frameShapeInput    ? frameShapeInput.value    : 'original',
            includeAxes:          includeAxesInput      ? includeAxesInput.checked      : true,
            includeAxisTicks:     includeAxisTicksInput ? includeAxisTicksInput.checked : true,
            includeAxisLabels:    includeLabelsInput    ? includeLabelsInput.checked    : true,
            axisLabelDensity:     axisLabelDensityInput ? axisLabelDensityInput.value   : 'all',
            includeExtrema:       includeExtremaInput       ? includeExtremaInput.checked       : true,
            includeIntersections: includeIntersectionsInput ? includeIntersectionsInput.checked : true
        };
    }

    async exportCurrentViewAsPNG() {
        try {
            const options      = this.getExportOptionsFromModal();
            const sourceWidth  = Math.max(1, Math.round(this.viewport.width  || this.canvas.width  || 1));
            const sourceHeight = Math.max(1, Math.round(this.viewport.height || this.canvas.height || 1));
            const frame = this.getExportFrameRect(sourceWidth, sourceHeight, options.frameShape || 'original');

            const cropCanvas = document.createElement('canvas');
            cropCanvas.width  = frame.width;
            cropCanvas.height = frame.height;
            const cropCtx = cropCanvas.getContext('2d');
            if (!cropCtx) throw new Error('Could not prepare PNG export canvas');

            cropCtx.drawImage(
                this.canvas,
                frame.x, frame.y, frame.width, frame.height,
                0, 0, frame.width, frame.height
            );

            const blob = await new Promise((resolve, reject) => {
                cropCanvas.toBlob((b) => { if (b) resolve(b); else reject(new Error('Failed to create PNG')); }, 'image/png');
            });

            if (this.isTouchExportDevice() && navigator.share) {
                try {
                    const file = new File([blob], 'komplexiti-diagram.png', { type: 'image/png' });
                    if (navigator.canShare?.({ files: [file] })) {
                        await navigator.share({ files: [file], title: 'Komplexiti Diagram' });
                        this.toggleExportOverlay(false);
                        return;
                    }
                } catch (shareError) {
                    if (shareError.name === 'AbortError') return;
                }
            }

            const url  = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href     = url;
            link.download = 'komplexiti-diagram.png';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            this.toggleExportOverlay(false);
        } catch (error) {
            console.error('PNG export failed:', error);
            alert('PNG export failed: ' + error.message);
        }
    }

    exportCurrentViewAsSVG() {
        try {
            const options   = this.getExportOptionsFromModal();
            const svgString = this.buildSVGExport(options);
            if (!svgString) throw new Error('Could not generate SVG');

            const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const url  = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href     = url;
            link.download = 'komplexiti-diagram.svg';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            this.toggleExportOverlay(false);
        } catch (error) {
            console.error('SVG export failed:', error);
            alert('SVG export failed: ' + error.message);
        }
    }

    // Build a complete SVG string for the current viewport state.
    buildSVGExport(options) {
        const sn = v => parseFloat(v.toFixed(2)).toString();
        const W = this.viewport.width;
        const H = this.viewport.height;
        const exportFrame = this.getExportFrameRect(W, H, options.frameShape || 'original');

        const allBlack = options.colorMode === 'black';

        const bgColor        = '#FDFDFD';
        const axisColor      = '#000000';
        const majorGridColor = allBlack ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.18)';
        const minorGridColor = allBlack ? 'rgba(0,0,0,0.1)'  : 'rgba(0,0,0,0.08)';
        const labelColor     = '#000000';
        const titleColor     = allBlack ? '#000000' : '#1566c0';
        const dotOutline     = 'rgba(255,255,255,0.9)';

        const fontSizeMap    = { small: 12, medium: 16, large: 20, xl: 24, xxl: 28 };
        const strokeWidthMap = { small: 2.5, medium: 3.5, large: 4.5, xl: 5.5, xxl: 6.5 };
        const fSize      = fontSizeMap[options.textSize]    || 20;
        const baseStroke = strokeWidthMap[options.strokeWidth] || 2.5;
        const prevScale  = (Number.isFinite(options.previewStrokeScale) && options.previewStrokeScale > 0)
            ? options.previewStrokeScale : 1;
        const sw         = (w) => sn(w * prevScale);
        const dotR       = baseStroke * 2.2;
        const headLen    = baseStroke * 4;
        const locusW     = Math.max(2, baseStroke - 0.5);
        // Dash/gap scale with stroke width so gaps remain visible at all sizes
        const strictDash = `${sw(Math.max(8, locusW * 3.2))} ${sw(Math.max(5, locusW * 2))}`;

        const exprColor = (c) => allBlack ? '#000000' : c.color;

        const lines = [];
        const defs  = [];

        lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${sn(exportFrame.width)}" height="${sn(exportFrame.height)}" viewBox="${sn(exportFrame.x)} ${sn(exportFrame.y)} ${sn(exportFrame.width)} ${sn(exportFrame.height)}">`);
        lines.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bgColor}"/>`);

        // Grid
        if (options.gridMode !== 'none') {
            const labelSpacing = this.getLabelSpacing();
            const subdiv       = 5;
            const minorSpacing = labelSpacing / subdiv;
            const drawMinor    = options.gridMode !== 'major' && (minorSpacing * this.viewport.scale) >= 9;

            if (drawMinor) {
                const mLines = [];
                const sx0 = Math.floor(this.viewport.minX / minorSpacing) * minorSpacing;
                for (let x = sx0; x <= this.viewport.maxX + minorSpacing * 0.5; x += minorSpacing) {
                    if (Math.abs(x / labelSpacing - Math.round(x / labelSpacing)) < 1e-6) continue;
                    const cx = this.worldToScreen(x, 0).x;
                    mLines.push(`<line x1="${sn(cx)}" y1="0" x2="${sn(cx)}" y2="${H}" stroke="${minorGridColor}" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.58"/>`);
                }
                const sy0 = Math.floor(this.viewport.minY / minorSpacing) * minorSpacing;
                for (let y = sy0; y <= this.viewport.maxY + minorSpacing * 0.5; y += minorSpacing) {
                    if (Math.abs(y / labelSpacing - Math.round(y / labelSpacing)) < 1e-6) continue;
                    const cy = this.worldToScreen(0, y).y;
                    mLines.push(`<line x1="0" y1="${sn(cy)}" x2="${W}" y2="${sn(cy)}" stroke="${minorGridColor}" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.58"/>`);
                }
                if (mLines.length) lines.push(mLines.join('\n'));
            }

            const MLines = [];
            const mx0 = Math.floor(this.viewport.minX / labelSpacing) * labelSpacing;
            for (let x = mx0; x <= this.viewport.maxX + labelSpacing * 0.5; x += labelSpacing) {
                const cx = this.worldToScreen(x, 0).x;
                MLines.push(`<line x1="${sn(cx)}" y1="0" x2="${sn(cx)}" y2="${H}" stroke="${majorGridColor}" stroke-width="1.15" vector-effect="non-scaling-stroke"/>`);
            }
            const my0 = Math.floor(this.viewport.minY / labelSpacing) * labelSpacing;
            for (let y = my0; y <= this.viewport.maxY + labelSpacing * 0.5; y += labelSpacing) {
                const cy = this.worldToScreen(0, y).y;
                MLines.push(`<line x1="0" y1="${sn(cy)}" x2="${W}" y2="${sn(cy)}" stroke="${majorGridColor}" stroke-width="1.15" vector-effect="non-scaling-stroke"/>`);
            }
            if (MLines.length) lines.push(MLines.join('\n'));
        }

        // Axes
        if (options.includeAxes) {
            if (this.viewport.minY <= 0 && this.viewport.maxY >= 0) {
                const y = this.worldToScreen(0, 0).y;
                lines.push(`<line x1="0" y1="${sn(y)}" x2="${W}" y2="${sn(y)}" stroke="${axisColor}" stroke-width="2.2" vector-effect="non-scaling-stroke"/>`);
            }
            if (this.viewport.minX <= 0 && this.viewport.maxX >= 0) {
                const x = this.worldToScreen(0, 0).x;
                lines.push(`<line x1="${sn(x)}" y1="0" x2="${sn(x)}" y2="${H}" stroke="${axisColor}" stroke-width="2.2" vector-effect="non-scaling-stroke"/>`);
            }
        }

        // Axis labels and ticks
        if (options.includeAxes && options.includeAxisLabels) {
            const labelSpacing  = this.getLabelSpacing();
            const includeTicks  = options.includeAxisTicks !== false;
            const reducedDensity = options.axisLabelDensity === 'reduced';
            const tickLen       = includeTicks ? 7 : 0;
            const tickSW        = 2.1;
            const xLabelOffY    = tickLen + fSize + 4;
            const yLabelOffX    = includeTicks ? tickLen + 4 : 7;
            const tLines = [];
            const fontAttr = `font-family="Arial, sans-serif" font-size="${fSize}px" font-weight="bold"`;

            // Skip every other label when reduced density is selected
            const shouldRender = (v, spacing) => {
                if (!reducedDensity) return true;
                const nearest = Math.round(v / spacing);
                return Math.abs(nearest % 2) === 0;
            };

            if (this.viewport.minY <= 0 && this.viewport.maxY >= 0) {
                const axisY = this.worldToScreen(0, 0).y;
                const x0 = Math.floor(this.viewport.minX / labelSpacing) * labelSpacing;
                for (let x = x0; x <= this.viewport.maxX; x += labelSpacing) {
                    if (Math.abs(x) < 1e-9) continue;
                    if (!shouldRender(x, labelSpacing)) continue;
                    const sp = this.worldToScreen(x, 0);
                    if (sp.x < 20 || sp.x > W - 20) continue;
                    if (includeTicks) {
                        tLines.push(`<line x1="${sn(sp.x)}" y1="${sn(axisY)}" x2="${sn(sp.x)}" y2="${sn(axisY + tickLen)}" stroke="${axisColor}" stroke-width="${tickSW}" vector-effect="non-scaling-stroke"/>`);
                    }
                    const ly = axisY + xLabelOffY;
                    if (ly < H - 6) {
                        tLines.push(`<text x="${sn(sp.x)}" y="${sn(ly)}" fill="${labelColor}" ${fontAttr} text-anchor="middle" dominant-baseline="alphabetic">${this.formatNumber(x)}</text>`);
                    }
                }
            }

            if (this.viewport.minX <= 0 && this.viewport.maxX >= 0) {
                const axisX = this.worldToScreen(0, 0).x;
                const y0 = Math.floor(this.viewport.minY / labelSpacing) * labelSpacing;
                for (let y = y0; y <= this.viewport.maxY; y += labelSpacing) {
                    if (Math.abs(y) < 1e-9) continue;
                    if (!shouldRender(y, labelSpacing)) continue;
                    const sp = this.worldToScreen(0, y);
                    if (sp.y < 20 || sp.y > H - 20) continue;
                    if (includeTicks) {
                        tLines.push(`<line x1="${sn(axisX)}" y1="${sn(sp.y)}" x2="${sn(axisX - tickLen)}" y2="${sn(sp.y)}" stroke="${axisColor}" stroke-width="${tickSW}" vector-effect="non-scaling-stroke"/>`);
                    }
                    const lx = axisX - yLabelOffX;
                    if (lx > 15) {
                        tLines.push(`<text x="${sn(lx)}" y="${sn(sp.y)}" fill="${labelColor}" ${fontAttr} text-anchor="end" dominant-baseline="middle">${this.formatNumber(y)}</text>`);
                    }
                }
            }

            if (this.viewport.minX <= 0 && this.viewport.maxX >= 0 &&
                this.viewport.minY <= 0 && this.viewport.maxY >= 0) {
                const o = this.worldToScreen(0, 0);
                tLines.push(`<text x="${sn(o.x - yLabelOffX)}" y="${sn(o.y + xLabelOffY)}" fill="${labelColor}" ${fontAttr} text-anchor="end" dominant-baseline="alphabetic">0</text>`);
            }

            const titleFontAttr = `font-family="Arial, sans-serif" font-size="${fSize - 2}px" font-weight="bold"`;
            if (this.viewport.minY <= 0 && this.viewport.maxY >= 0) {
                const axisY = this.worldToScreen(0, 0).y;
                tLines.push(`<text x="${sn(W - 6)}" y="${sn(axisY - 6)}" fill="${titleColor}" ${titleFontAttr} text-anchor="end" dominant-baseline="auto">Re</text>`);
            }
            if (this.viewport.minX <= 0 && this.viewport.maxX >= 0) {
                const axisX = this.worldToScreen(0, 0).x;
                tLines.push(`<text x="${sn(axisX + 6)}" y="${sn(6)}" fill="${titleColor}" ${titleFontAttr} text-anchor="start" dominant-baseline="hanging">Im</text>`);
            }

            if (tLines.length) lines.push(tLines.join('\n'));
        }

        // Helper: convert chains of world-coord points to SVG path d attribute
        const chainsToDPath = (chains) => {
            const parts = [];
            for (const chain of chains) {
                if (!chain.length) continue;
                const pts = chain.map(p => this.worldToScreen(p.x, p.y));
                parts.push(`M ${sn(pts[0].x)},${sn(pts[0].y)}`);
                for (let i = 1; i < pts.length; i++) {
                    parts.push(`L ${sn(pts[i].x)},${sn(pts[i].y)}`);
                }
            }
            return parts.join(' ');
        };

        // Helper: get segment data for a locus expression (fast-path or cached)
        const getSegs = (c) => {
            const fast = this._traceFastLocusSegments(c.locus);
            if (fast !== null) return fast;
            return c._locusCache?.segments || null;
        };

        // Helper: add shading SVG for an inequality locus
        const addLocusShade = (c, color) => {
            const ineq = c.locus?.inequality;
            if (!ineq) return;
            const fp = c.locus.fastPath;
            const ALPHA = 0.18;

            if (fp?.kind === 'circle' || fp?.kind === 'apollonius') {
                const sc = this.worldToScreen(fp.center.re, fp.center.im);
                const se = this.worldToScreen(fp.center.re + fp.radius, fp.center.im);
                const sr = Math.abs(se.x - sc.x);
                if (ineq.dir < 0) {
                    lines.push(`<circle cx="${sn(sc.x)}" cy="${sn(sc.y)}" r="${sn(sr)}" fill="${color}" fill-opacity="${ALPHA}"/>`);
                } else {
                    const mid = `mask-${defs.length}`;
                    defs.push(`<mask id="${mid}"><rect x="0" y="0" width="${W}" height="${H}" fill="white"/><circle cx="${sn(sc.x)}" cy="${sn(sc.y)}" r="${sn(sr)}" fill="black"/></mask>`);
                    lines.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${color}" fill-opacity="${ALPHA}" mask="url(#${mid})"/>`);
                }
                return;
            }

            if (fp?.kind === 'line') {
                const d = this._svgLineHalfPlane(fp, ineq.dir, W, H, sn);
                if (d) lines.push(`<path d="${d}" fill="${color}" fill-opacity="${ALPHA}"/>`);
                return;
            }

            if (fp?.kind === 'ray') {
                const d = this._svgRayRegion(fp, ineq.dir, W, H, sn);
                if (d) lines.push(`<path d="${d}" fill="${color}" fill-opacity="${ALPHA}"/>`);
                return;
            }

            if (fp?.kind === 'inscribed-arc') {
                const d = this._svgArcRegion(fp, ineq, W, H, sn);
                if (d) lines.push(`<path d="${d}" fill="${color}" fill-opacity="${ALPHA}" fill-rule="evenodd"/>`);
                return;
            }

            // Grid-based shade: rasterise to an off-screen canvas and embed as PNG
            const sg = c._locusCache?.shadeGrid;
            if (sg) {
                const off = document.createElement('canvas');
                off.width  = W;
                off.height = H;
                const octx = off.getContext('2d');
                octx.fillStyle   = c.color;
                octx.globalAlpha = ALPHA;
                this._renderShadeGrid(sg, octx);
                try {
                    lines.push(`<image x="0" y="0" width="${W}" height="${H}" href="${off.toDataURL('image/png')}" preserveAspectRatio="none"/>`);
                } catch { /* cross-origin guard */ }
            }
        };

        // Collect enabled inequality loci (mirrors the canvas drawExpressions logic)
        const ineqLoci = [];
        for (const _c of this.expressions) {
            if (!_c.enabled) continue;
            if (_c.type === 'locus' && _c.locus?.inequality && _c.equationVar) {
                ineqLoci.push(_c);
            } else if (_c.type === 'compound-locus' && _c.compoundParts) {
                for (const part of _c.compoundParts) {
                    if (part.locus?.inequality) ineqLoci.push(part);
                }
            }
        }

        // Draw shading - use destination-in compositing for 2+ inequalities (matches canvas)
        if (ineqLoci.length >= 2) {
            try {
                const tmp = document.createElement('canvas');
                tmp.width  = W;
                tmp.height = H;
                this._drawInequalityIntersection(ineqLoci, tmp.getContext('2d'));
                lines.push(`<image x="0" y="0" width="${W}" height="${H}" href="${tmp.toDataURL('image/png')}" preserveAspectRatio="none"/>`);
            } catch { /* cross-origin guard */ }
        } else {
            for (const c of this.expressions) {
                if (!c.enabled) continue;
                const color = exprColor(c);
                if (c.type === 'locus' && c.locus?.inequality && c.equationVar) {
                    addLocusShade(c, color);
                } else if (c.type === 'compound-locus' && c.compoundParts) {
                    for (const part of c.compoundParts) {
                        if (part.locus?.inequality) addLocusShade(part, color);
                    }
                }
            }
        }

        // Draw expressions
        const toSub = n => String(n).split('').map(d2 => '&#x208' + d2 + ';').join('');

        for (const c of this.expressions) {
            if (!c.enabled) continue;
            const color = exprColor(c);

            // Equation roots
            if (c.type === 'equation' && c.roots?.length) {
                const org = this.worldToScreen(0, 0);
                for (let k = 0; k < c.roots.length; k++) {
                    const root = c.roots[k];
                    if (!isFinite(root.re) || !isFinite(root.im)) continue;
                    const pt = this.worldToScreen(root.re, root.im);
                    if (this.displayMode === 'arrow') {
                        const dx = pt.x - org.x, dy = pt.y - org.y;
                        const len = Math.hypot(dx, dy);
                        if (len > dotR + 2) {
                            const ang  = Math.atan2(dy, dx);
                            const tipX = pt.x - dotR * Math.cos(ang);
                            const tipY = pt.y - dotR * Math.sin(ang);
                            lines.push(`<line x1="${sn(org.x)}" y1="${sn(org.y)}" x2="${sn(tipX)}" y2="${sn(tipY)}" stroke="${color}" stroke-width="${sw(baseStroke)}" vector-effect="non-scaling-stroke" opacity="0.9"/>`);
                            lines.push(`<polygon points="${sn(tipX)},${sn(tipY)} ${sn(tipX - headLen * Math.cos(ang - 0.38))},${sn(tipY - headLen * Math.sin(ang - 0.38))} ${sn(tipX - headLen * Math.cos(ang + 0.38))},${sn(tipY - headLen * Math.sin(ang + 0.38))}" fill="${color}"/>`);
                        }
                    }
                    lines.push(`<circle cx="${sn(pt.x)}" cy="${sn(pt.y)}" r="${sn(dotR)}" fill="${color}" stroke="${dotOutline}" stroke-width="1.5"/>`);
                    if (c.equationVar) {
                        lines.push(`<text x="${sn(pt.x + dotR + 4)}" y="${sn(pt.y - dotR - 2)}" fill="${color}" font-family="Arial, sans-serif" font-size="${fSize}px" font-style="italic" dominant-baseline="auto">${c.equationVar}${toSub(k + 1)}</text>`);
                    }
                }
                continue;
            }

            // Locus
            if (c.type === 'locus' && c.locus && c.equationVar) {
                const segs = getSegs(c);
                if (segs?.length) {
                    const d = chainsToDPath(this._stitchSegmentsToChains(segs));
                    if (d) {
                        const dashAttr = c.locus.inequality?.strict ? ` stroke-dasharray="${strictDash}"` : '';
                        lines.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw(locusW)}"${dashAttr} stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity="0.95"/>`);
                    }
                }

                const fp2 = c.locus.fastPath;

                // Foci markers
                if (c.showFoci !== false && fp2?.focusA && fp2?.focusB && (fp2?.perpBisector || fp2?.kind === 'apollonius')) {
                    const fDotR = Math.max(3, dotR - 1.5);
                    for (const [idx, focus] of [[1, fp2.focusA], [2, fp2.focusB]]) {
                        const fs = this.worldToScreen(focus.re, focus.im);
                        const sub = idx === 1 ? '\u2081' : '\u2082';
                        lines.push(`<circle cx="${sn(fs.x)}" cy="${sn(fs.y)}" r="${sn(fDotR)}" fill="${color}" opacity="0.75" stroke="${dotOutline}" stroke-width="1.5"/>`);
                        lines.push(`<text x="${sn(fs.x + fDotR + 3)}" y="${sn(fs.y - fDotR - 2)}" fill="${color}" font-family="Arial, sans-serif" font-size="${fSize}px" font-style="italic" opacity="0.9" dominant-baseline="auto">F${sub}</text>`);
                    }
                }

                // Dotted line between the foci with a right-angle marker where it crosses the perpendicular bisector
                if (c.showFoci !== false && fp2?.perpBisector && fp2?.focusA && fp2?.focusB) {
                    const aPt = this.worldToScreen(fp2.focusA.re, fp2.focusA.im);
                    const bPt = this.worldToScreen(fp2.focusB.re, fp2.focusB.im);
                    lines.push(`<line x1="${sn(aPt.x)}" y1="${sn(aPt.y)}" x2="${sn(bPt.x)}" y2="${sn(bPt.y)}" stroke="${color}" stroke-width="${sw(1)}" vector-effect="non-scaling-stroke" opacity="0.6" stroke-dasharray="${sw(4)} ${sw(4)}"/>`);

                    const midX  = (fp2.focusA.re + fp2.focusB.re) / 2, midY = (fp2.focusA.im + fp2.focusB.im) / 2;
                    const midPt = this.worldToScreen(midX, midY);
                    const ulen  = Math.hypot(bPt.x - aPt.x, bPt.y - aPt.y) || 1;
                    const ux    = (bPt.x - aPt.x) / ulen, uy = (bPt.y - aPt.y) / ulen;
                    const px    = -uy, py = ux;
                    const s     = Math.max(12, dotR + 3);
                    const p1x = midPt.x + ux * s, p1y = midPt.y + uy * s;
                    const p2x = p1x + px * s, p2y = p1y + py * s;
                    const p3x = midPt.x + px * s, p3y = midPt.y + py * s;
                    lines.push(`<polyline points="${sn(p1x)},${sn(p1y)} ${sn(p2x)},${sn(p2y)} ${sn(p3x)},${sn(p3y)}" fill="none" stroke="${color}" stroke-width="${sw(2.5)}" vector-effect="non-scaling-stroke" opacity="0.9"/>`);
                }

                // Centre marker
                if (c.showFoci !== false && fp2?.center && (fp2.kind === 'circle' || fp2.kind === 'apollonius')) {
                    const cPt   = this.worldToScreen(fp2.center.re, fp2.center.im);
                    const cDotR = Math.max(3, dotR - 1.5);
                    lines.push(`<circle cx="${sn(cPt.x)}" cy="${sn(cPt.y)}" r="${sn(cDotR)}" fill="${color}" opacity="0.75" stroke="${dotOutline}" stroke-width="1.5"/>`);
                    lines.push(`<text x="${sn(cPt.x + cDotR + 3)}" y="${sn(cPt.y - cDotR - 2)}" fill="${color}" font-family="Arial, sans-serif" font-size="${fSize}px" font-style="italic" opacity="0.9" dominant-baseline="auto">C</text>`);
                }

                // Extrema markers
                if (options.includeExtrema && c.showExtrema !== false) {
                    const ex  = this._computeLocusExtrema(c);
                    if (ex) {
                        const markerR = Math.max(2.5, dotR - 2);
                        const org     = this.worldToScreen(0, 0);
                        const near    = (p1, p2) => p1 && p2 && Math.hypot(p1.re - p2.re, p1.im - p2.im) < 1e-6;
                        const addEx   = (pt, label, isArg) => {
                            if (!pt) return;
                            const sp = this.worldToScreen(pt.re, pt.im);
                            lines.push(`<line x1="${sn(org.x)}" y1="${sn(org.y)}" x2="${sn(sp.x)}" y2="${sn(sp.y)}" stroke="${color}" stroke-width="${sw(1)}" vector-effect="non-scaling-stroke" opacity="0.6" stroke-dasharray="${sw(4)} ${sw(4)}"/>`);
                            if (isArg) {
                                lines.push(`<circle cx="${sn(sp.x)}" cy="${sn(sp.y)}" r="${sn(markerR)}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.9"/>`);
                            } else {
                                lines.push(`<circle cx="${sn(sp.x)}" cy="${sn(sp.y)}" r="${sn(markerR)}" fill="${color}" opacity="0.9"/>`);
                            }
                            lines.push(`<text x="${sn(sp.x + markerR + 3)}" y="${sn(sp.y - markerR - 1)}" fill="${color}" font-family="Arial, sans-serif" font-size="${Math.max(8, fSize - 4)}px" dominant-baseline="auto">${label}</text>`);
                        };
                        addEx(ex.modMinPt, '|z| min', false);
                        if (!near(ex.modMaxPt, ex.modMinPt)) addEx(ex.modMaxPt, '|z| max', false);
                        if (!ex.fullArgRange) {
                            if (!near(ex.argMinPt, ex.modMinPt) && !near(ex.argMinPt, ex.modMaxPt)) addEx(ex.argMinPt, 'arg min', true);
                            if (!near(ex.argMaxPt, ex.modMinPt) && !near(ex.argMaxPt, ex.modMaxPt) && !near(ex.argMaxPt, ex.argMinPt)) addEx(ex.argMaxPt, 'arg max', true);
                        }
                    }
                }
                continue;
            }

            // Compound-locus
            if (c.type === 'compound-locus' && c.compoundParts) {
                for (const part of c.compoundParts) {
                    const segs = getSegs(part);
                    if (!segs?.length) continue;
                    const d = chainsToDPath(this._stitchSegmentsToChains(segs));
                    if (d) {
                        const dashAttr = part.locus?.inequality?.strict ? ` stroke-dasharray="${strictDash}"` : '';
                        lines.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw(locusW)}"${dashAttr} stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity="0.95"/>`);
                    }
                }
                continue;
            }

            // Constant complex value
            if (c.re === null || c.im === null || !isFinite(c.re) || !isFinite(c.im)) continue;
            const pt  = this.worldToScreen(c.re, c.im);
            const org = this.worldToScreen(0, 0);

            if (this.displayMode === 'arrow') {
                const dx = pt.x - org.x, dy = pt.y - org.y;
                const len = Math.hypot(dx, dy);
                if (len > dotR + 2) {
                    const ang  = Math.atan2(dy, dx);
                    const tipX = pt.x - dotR * Math.cos(ang);
                    const tipY = pt.y - dotR * Math.sin(ang);
                    lines.push(`<line x1="${sn(org.x)}" y1="${sn(org.y)}" x2="${sn(tipX)}" y2="${sn(tipY)}" stroke="${color}" stroke-width="${sw(baseStroke)}" vector-effect="non-scaling-stroke" opacity="0.9"/>`);
                    lines.push(`<polygon points="${sn(tipX)},${sn(tipY)} ${sn(tipX - headLen * Math.cos(ang - 0.38))},${sn(tipY - headLen * Math.sin(ang - 0.38))} ${sn(tipX - headLen * Math.cos(ang + 0.38))},${sn(tipY - headLen * Math.sin(ang + 0.38))}" fill="${color}"/>`);
                }
            }

            lines.push(`<circle cx="${sn(pt.x)}" cy="${sn(pt.y)}" r="${sn(dotR)}" fill="${color}" stroke="${dotOutline}" stroke-width="1.5"/>`);
            if (c.name) {
                lines.push(`<text x="${sn(pt.x + dotR + 4)}" y="${sn(pt.y - dotR - 2)}" fill="${color}" font-family="Arial, sans-serif" font-size="${fSize}px" font-style="italic" dominant-baseline="auto">${c.name}</text>`);
            }
        }

        // Intersection dots
        if (options.includeIntersections) {
            const ipts   = this._fastPathIntersections();
            const iDotR  = baseStroke / 2;
            const iEdge  = 2.5;
            const outer  = '#000000';
            const inner  = '#ffffff';
            for (const p of ipts) {
                const sp = this.worldToScreen(p.re, p.im);
                lines.push(`<circle cx="${sn(sp.x)}" cy="${sn(sp.y)}" r="${sn(iDotR + iEdge)}" fill="${outer}"/>`);
                lines.push(`<circle cx="${sn(sp.x)}" cy="${sn(sp.y)}" r="${sn(iDotR)}" fill="${inner}"/>`);
            }
        }

        // Intersection badges (shown when user has tapped an intersection point)
        if (this._intersectionBadges?.length) {
            const badgeColor   = '#D63384';
            const badgeOutline = '#852052';
            const badgeTextClr = this.getContrastingTextColor(badgeColor);
            const padding      = 6;
            const fontWeight   = 'bold';
            // Use a temp canvas to measure text width at the export font size
            const measurer = document.createElement('canvas').getContext('2d');
            measurer.font  = `${fontWeight} ${fSize}px Arial, sans-serif`;
            for (const badge of this._intersectionBadges) {
                const sp        = this.worldToScreen(badge.re, badge.im);
                const labelText = `z = ${this.formatComplexPlain(badge.re, badge.im, 'cartesian')}`;
                const tw        = measurer.measureText(labelText).width;
                const boxH      = fSize + 2 * padding;
                const labelX    = sp.x + 15;
                const labelY    = sp.y - 10;
                const boxY      = labelY - fSize - padding;
                const totalW    = tw + 2 * padding;
                lines.push(`<rect x="${sn(labelX - padding)}" y="${sn(boxY)}" width="${sn(totalW)}" height="${sn(boxH)}" rx="3" fill="${badgeColor}" stroke="${badgeOutline}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`);
                lines.push(`<text x="${sn(labelX)}" y="${sn(boxY + boxH * 0.7)}" fill="${badgeTextClr}" font-family="Arial, sans-serif" font-size="${fSize}px" font-weight="${fontWeight}" dominant-baseline="alphabetic">${labelText}</text>`);
            }
        }

        if (defs.length > 0) {
            lines.splice(1, 0, `<defs>${defs.join('')}</defs>`);
        }

        lines.push('</svg>');
        return lines.join('\n');
    }

    // SVG path for a perpendicular-bisector (line) half-plane inequality.
    _svgLineHalfPlane(fp, ineqDir, W, H, sn) {
        const hits = this._clipInfiniteLine(fp.point, fp.direction);
        if (!hits || hits.length < 2) {
            const { minX, minY } = this.getVisibleWorldBounds();
            const nx     = -fp.direction.im, ny = fp.direction.re;
            const shade  = ineqDir < 0 ? fp.focusA : fp.focusB;
            const cDot   = (minX - fp.point.re) * nx + (minY - fp.point.im) * ny;
            const fDot   = (shade.re - fp.point.re) * nx + (shade.im - fp.point.im) * ny;
            return (cDot * fDot > 0) ? `M0,0 H${W} V${H} H0 Z` : null;
        }
        const P1 = this.worldToScreen(hits[0].x, hits[0].y);
        const P2 = this.worldToScreen(hits[1].x, hits[1].y);
        const sf = ineqDir < 0 ? fp.focusA : fp.focusB;
        const sp = this.worldToScreen(sf.re, sf.im);
        const cross = (P2.x - P1.x) * (sp.y - P1.y) - (P2.y - P1.y) * (sp.x - P1.x);
        return this._svgViewportPolygon([P1, P2], cross > 0, W, H, sn);
    }

    // SVG path for a ray-argument half-plane inequality.
    _svgRayRegion(fp, ineqDir, W, H, sn) {
        const o = fp.origin;
        const rayHits = this._clipInfiniteLine(o, { re: Math.cos(fp.angle), im: Math.sin(fp.angle) });
        if (!rayHits || rayHits.length < 2) {
            const nx = -Math.sin(fp.angle), ny = Math.cos(fp.angle);
            const { minX, minY } = this.getVisibleWorldBounds();
            const cDot = (minX - o.re) * nx + (minY - o.im) * ny;
            return ((ineqDir > 0) === (cDot > 0)) ? `M0,0 H${W} V${H} H0 Z` : null;
        }
        const { minX, maxX, minY, maxY } = this.getVisibleWorldBounds();
        const inVP = o.re >= minX - 1e-6 && o.re <= maxX + 1e-6 && o.im >= minY - 1e-6 && o.im <= maxY + 1e-6;

        if (inVP) {
            const branchHits = this._clipInfiniteLine(o, { re: -1, im: 0 });
            if (!branchHits || branchHits.length < 2 || rayHits[1].t < -1e-9) return null;
            const P_r  = this.worldToScreen(rayHits[1].x, rayHits[1].y);
            const P_b  = this.worldToScreen(branchHits[1].x, branchHits[1].y);
            const org  = this.worldToScreen(o.re, o.im);
            const cross = (P_r.x - org.x) * (P_b.y - org.y) - (P_r.y - org.y) * (P_b.x - org.x);
            const pts  = [{ x: org.x, y: org.y }, { x: P_r.x, y: P_r.y }];
            const tail = this._svgViewportWalk(P_r, P_b, (ineqDir > 0) !== (cross > 0), W, H);
            tail.forEach(p => pts.push(p));
            pts.push({ x: P_b.x, y: P_b.y });
            return `M ${pts.map(p => `${sn(p.x)},${sn(p.y)}`).join(' L ')} Z`;
        } else {
            if (rayHits[0].t < -1e-9 || rayHits[1].t < -1e-9) {
                const nx = -Math.sin(fp.angle), ny = Math.cos(fp.angle);
                const { minX: mx, minY: my } = this.getVisibleWorldBounds();
                const cDot = (mx - o.re) * nx + (my - o.im) * ny;
                return ((ineqDir > 0) === (cDot > 0)) ? `M0,0 H${W} V${H} H0 Z` : null;
            }
            const E = this.worldToScreen(rayHits[0].x, rayHits[0].y);
            const P = this.worldToScreen(rayHits[1].x, rayHits[1].y);
            return this._svgViewportPolygon([E, P], ineqDir > 0, W, H, sn);
        }
    }

    // SVG path for an inscribed-arc inequality region.
    _svgArcRegion(fp, ineq, W, H, sn) {
        const { a, b, theta, center, radius } = fp;
        const sc  = this.worldToScreen(center.re, center.im);
        const scE = this.worldToScreen(center.re + radius, center.im);
        const sr  = Math.abs(scE.x - sc.x);
        const sA  = this.worldToScreen(a.re, a.im);
        const sB  = this.worldToScreen(b.re, b.im);
        const angB = Math.atan2(sB.y - sc.y, sB.x - sc.x);
        const angA = Math.atan2(sA.y - sc.y, sA.x - sc.x);
        // arcCCW = theta < 0 in canvas; CW in canvas = sweep-flag 1 in SVG
        const sweepFlag = theta > 0 ? 1 : 0;
        // Angular span in the direction of travel (always kept positive)
        let angSpan = sweepFlag === 1 ? (angA - angB) : (angB - angA);
        while (angSpan < 0) angSpan += 2 * Math.PI;
        const largeArc = angSpan > Math.PI ? 1 : 0;
        const x1 = sc.x + sr * Math.cos(angB);
        const y1 = sc.y + sr * Math.sin(angB);
        const x2 = sc.x + sr * Math.cos(angA);
        const y2 = sc.y + sr * Math.sin(angA);
        const arcPath = `M ${sn(x1)},${sn(y1)} A ${sn(sr)},${sn(sr)} 0 ${largeArc} ${sweepFlag} ${sn(x2)},${sn(y2)} Z`;
        const isSimple = (ineq.dir > 0) === (theta > 0);
        return isSimple ? arcPath : `M0,0 H${W} V${H} H0 Z ${arcPath}`;
    }

    // Build an SVG path that encloses one side of a line defined by [startPt, endPt],
    // walking the viewport boundary to close the polygon.
    _svgViewportPolygon(edgePts, cwWalk, W, H, sn) {
        const P1 = edgePts[0], P2 = edgePts[1];
        const mid = this._svgViewportWalk(P2, P1, cwWalk, W, H);
        const all = [P1, P2, ...mid];
        return `M ${all.map(p => `${sn(p.x)},${sn(p.y)}`).join(' L ')} Z`;
    }

    // Walk the viewport boundary from point 'from' to point 'to', clockwise or anti-clockwise.
    _svgViewportWalk(from, to, cwWalk, W, H) {
        const eps = 0.5;
        const vt  = (sx, sy) => {
            if (sy <= eps)       return sx / W;
            if (sx >= W - eps)   return 1 + sy / H;
            if (sy >= H - eps)   return 2 + (W - sx) / W;
            return 3 + (H - sy) / H;
        };
        const corners = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
        const t0 = vt(from.x, from.y), t1 = vt(to.x, to.y);
        const mid = [];
        if (cwWalk) {
            let te = t1; if (te <= t0) te += 4;
            for (let ci = Math.floor(t0) + 1; ci <= Math.floor(te); ci++) mid.push(corners[ci % 4]);
        } else {
            let te = t1; if (te >= t0) te -= 4;
            for (let ci = Math.floor(t0); ci > te; ci--) mid.push(corners[((ci % 4) + 4) % 4]);
        }
        return mid;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new Komplexiti();
});
