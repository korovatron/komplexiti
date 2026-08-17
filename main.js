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

        // ---- Complex number constants ----
        this.complexConstants = [];
        this.nextConstantId   = 1;
        this.constantColors   = [
            '#0057FF', '#00C853', '#B91C1C',
            '#C026D3', '#1ABC9C', '#00E5FF', '#A855F7',
            '#FF6B6B', '#4A90E2', '#FFD400', '#84CC16', '#F39C12'
        ];
        this.displayMode = 'arrow'; // 'arrow' | 'point'
        this.activeInfoConstantId = null;
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

        // ---- Pan inertia ----
        this.mousePanInertia = { active: false, velocityX: 0, velocityY: 0 };

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
        });
        window.addEventListener('focus', reopenPanelIfClosed);
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Panel control buttons
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) themeToggle.addEventListener('click', () => this.toggleTheme());
        const sizeModeToggle = document.getElementById('size-mode-toggle');
        if (sizeModeToggle) sizeModeToggle.addEventListener('click', () => this.toggleSizeMode());

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

        const addConstantBtn = document.getElementById('add-constant-btn');
        if (addConstantBtn) addConstantBtn.addEventListener('click', () => this.addConstant());
        const displayModeToggle = document.getElementById('display-mode-toggle');
        if (displayModeToggle) displayModeToggle.addEventListener('click', () => this.toggleDisplayMode());

        const closeInfoBtn = document.getElementById('close-complex-info-btn');
        if (closeInfoBtn) closeInfoBtn.addEventListener('click', () => {
            const panel = document.getElementById('complex-info-panel');
            if (panel) panel.style.display = 'none';
            this.activeInfoConstantId = null;
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
        this.drawComplexConstants();
        this.updateComplexInfoPanel();
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
        const c = { id, color, enabled: true, latex: '', name: null, re: null, im: null, type: 'constant', roots: null, equationVar: null };
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
                    <button class="expr-info-btn" title="Show info about this complex number" aria-label="Show complex number info">i</button>
                    <div class="expr-color-dot" style="background:${c.color};opacity:${c.enabled ? 1 : 0.3}" title="Toggle visibility"></div>
                </div>
            </div>`;

        const mathField = card.querySelector('math-field');
        const dot       = card.querySelector('.expr-color-dot');
        const removeBtn = card.querySelector('.expr-remove-btn');
        const infoBtn   = card.querySelector('.expr-info-btn');

        mathField.addEventListener('input', () => {
            c.latex = mathField.value;
            const raw = c.latex.trim();
            const assignment = raw ? this.parseAssignment(raw) : null;
            let hasError = false;

            // Reset any previous equation state before re-evaluating
            c.type = 'constant';
            c.roots = null;
            c.equationVar = null;

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
            } else if (raw.includes('=')) {
                // Not a simple name=value assignment — try to solve as an equation
                c.name = null;
                c.re   = null;
                c.im   = null;
                const eq = this.parseEquation(raw, c.id);
                if (eq) {
                    c.type = 'equation';
                    c.roots = eq.roots;
                    c.equationVar = eq.variable;
                } else {
                    hasError = true;
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
        infoBtn.addEventListener('click',   () => this.showComplexInfoPanel(c.id));

        dot.addEventListener('click', () => {
            c.enabled = !c.enabled;
            dot.style.opacity = c.enabled ? '1' : '0.3';
            if (!c.enabled && this.activeInfoConstantId === c.id) {
                const panel = document.getElementById('complex-info-panel');
                if (panel) panel.style.display = 'none';
                this.activeInfoConstantId = null;
            }
            this.saveConstants();
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
        if (this.activeInfoConstantId === id) {
            const panel = document.getElementById('complex-info-panel');
            if (panel) panel.style.display = 'none';
            this.activeInfoConstantId = null;
        }
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
                const c = { id: saved.id, color: saved.color, enabled: !!saved.enabled, latex: saved.latex || '', name: null, re: null, im: null, type: 'constant', roots: null, equationVar: null };
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
                } else if (!assignment && raw.includes('=')) {
                    const eq = this.parseEquation(raw, c.id);
                    if (eq) { c.type = 'equation'; c.roots = eq.roots; c.equationVar = eq.variable; }
                    else    { c.roots = null; }
                } else if (!assignment) {
                    const parsed = this.parseComplexFromLatex(raw, scope);
                    c.re = parsed !== null ? parsed.re : null;
                    c.im = parsed !== null ? parsed.im : null;
                }
            }
        }
    }

    // Normalises a LaTeX expression string into a JS/mathjs-evaluable string.
    latexToExpr(latex) {
        let e = latex.trim();
        for (let p = 0; p < 4; p++) {
            e = e.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
        }
        for (let p = 0; p < 3; p++) {
            e = e.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
        }
        // Conjugate: \overline{expr} → conj(expr); must run before generic {} → () stripping
        for (let p = 0; p < 3; p++) {
            e = e.replace(/\\overline\s*\{([^{}]*)\}/g, 'conj($1)');
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
        e = e.replace(/\bi\s*(sqrt|sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|asinh|acosh|atanh|log|log10|exp|conj)\s*\(/g, 'i*$1(');
        e = e.replace(/\)\s*i\b/g, ')*i');
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
        for (const [, id] of expr.matchAll(/\b([a-zA-Z][a-zA-Z0-9]*)\b/g)) {
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
                coeffs.push({ re: re / factorials[k], im: im / factorials[k] });
            }
            // Trim trailing near-zero coefficients
            while (coeffs.length > 1 && Math.hypot(coeffs[coeffs.length - 1].re, coeffs[coeffs.length - 1].im) < 1e-9) {
                coeffs.pop();
            }
            return coeffs;
        } catch { return null; }
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

    // Main equation parser. Returns { variable, roots } or null.
    parseEquation(rawLatex, ownId) {
        if (typeof math === 'undefined') return null;
        try {
            const scope = this.buildConstantScope(ownId);
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
                    if (roots) return { variable: varName, roots };
                }
            }

            // General polynomial solver via symbolic differentiation
            const hExpr  = `(${lhs}) - (${rhs})`;
            const coeffs = this._extractPolynomialCoeffs(hExpr, varName, scope);
            if (!coeffs || coeffs.length < 2) return null;

            const deg = coeffs.length - 1;
            let roots;
            if      (deg === 1) roots = this._solveLinear(coeffs);
            else if (deg === 2) roots = this._solveQuadratic(coeffs);
            else                roots = this._solveDurandKerner(coeffs);

            if (!roots?.length) return null;
            const valid = roots.filter(r => isFinite(r.re) && isFinite(r.im));
            return valid.length ? { variable: varName, roots: valid } : null;
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

    // =========================================================================
    // Complex number info panel
    // =========================================================================

    showComplexInfoPanel(id) {
        this.activeInfoConstantId = id;
        const panel = document.getElementById('complex-info-panel');
        if (panel) panel.style.display = '';
        this.updateComplexInfoPanel();
    }

    updateComplexInfoPanel() {
        const panel    = document.getElementById('complex-info-panel');
        if (!panel || panel.style.display === 'none') return;
        const c = this.complexConstants.find(x => x.id === this.activeInfoConstantId);
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

    drawComplexConstants() {
        if (!this.complexConstants.length) return;
        const ctx     = this.ctx;
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const fSize       = this.sizeMode === 'xlarge' ? 26 : this.sizeMode === 'large' ? 22 : 18;
        const dotR        = this.sizeMode === 'xlarge' ? 8.5 : this.sizeMode === 'large' ? 7 : 6;
        const strokeWidth = this.sizeMode === 'xlarge' ? 5  : this.sizeMode === 'large' ? 4  : 3;
        const headLen     = this.sizeMode === 'xlarge' ? 15 : this.sizeMode === 'large' ? 13 : 11;

        for (const c of this.complexConstants) {
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

            // Label: only draw if the constant has a user-assigned name
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
    new Komplexiti();
});
