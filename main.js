// ============================================
// Hexagonal Game of Life
// ============================================

// === Constants ===
const CONSTANTS = {
    DEFAULT_CELL_PIXEL: 50,
    RESIZE_DEBOUNCE_MS: 150,
    AUTO_HIDE_MS: 3000,
    HEX_VERTICAL_SPACING: 0.75,
    HEX_HALF_WIDTH: 0.59,
    HEX_HALF_HEIGHT: 0.5,
    ACTIVITY_EVENTS: ['mousemove', 'touchstart', 'keydown'],
    POINTER_EVENTS: ['pointerup', 'pointercancel'],
    COLORS: {
        light: {
            bg: '#fff',
            fill: '#000',
            stroke: '#ccc'
        },
        dark: {
            bg: '#111',
            fill: '#fff',
            stroke: 'rgba(255,255,255,0.08)'
        }
    }
};

// === Rule Definitions ===
const RULESETS = {
    b245s25: { birth: [2, 4, 5], survival: [2, 5], name: 'B245/S25' },
    b2s34: { birth: [2], survival: [3, 4], name: 'B2/S34' },
    b2s23: { birth: [2], survival: [2, 3], name: 'B2/S23' }
};

// Parse custom rule strings like "B245/S25" -> { birth: [2,4,5], survival: [2,5] }
function parseRuleString(str) {
    if (!str || typeof str !== 'string') return null;
    const s = str.toUpperCase().replace(/\s+/g, '');
    const m = s.match(/^B([0-9,]+)\/S([0-9,]+)$/);
    if (!m) return null;
    const birth = (m[1] || '').split(',').join('').split('').filter(Boolean).map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n));
    const survival = (m[2] || '').split(',').join('').split('').filter(Boolean).map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n));
    return { birth, survival, name: str };
}

function getActiveRule() {
    if (state.config.rule && state.config.rule !== 'other') return RULESETS[state.config.rule] || RULESETS.b245s25;
    const parsed = parseRuleString(state.config.customRule || '');
    return parsed || RULESETS.b245s25;
}

// === State Management ===
const state = {
    canvas: document.querySelector('.canvas'),
    ctx: null,
    game: null,
    loopInterval: null,
    resizeTimer: null,
    inactivityTimer: null,
    paused: false,
    isPointerDown: false,
    pointerDrawValue: 1,
    config: {
        // Number of cells horizontally and vertically
        cellX: Math.max(4, Math.ceil(window.innerWidth / 50)),
        cellY: Math.max(4, Math.ceil(window.innerHeight / 50)),
        density: 0.50,
        fps: 10,
        dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        rule: 'b245s25',
        customRule: ''
    },
    // view / interaction state for pan & zoom
    view: {
        offsetX: 0,
        offsetY: 0,
        scale: 1
    },
    // gesture helpers
    gesture: {
        isPanning: false,
        panLast: null,
        pointers: new Map(),
        gestureStart: null
    }
};

state.ctx = state.canvas.getContext('2d');

// ============================================
// Game of Life Class
// ============================================
class GameOfLife {
    constructor(ctx, width, height, cellX, cellY) {
        this.ctx = ctx;
        this.width = width;
        this.height = height;
        this.cellX = cellX;
        this.cellY = cellY;
        this.cellSizeX = width / cellX;
        this.cellSizeY = height / cellY;
        this.cell = Array.from({ length: cellX }, () => Array(cellY).fill(0));
        this.colors = { fill: '#000', stroke: '#ccc', bg: '#fff' };
    }

    countNeighbors(x, y) {
        let count = 0;
        const diagDx = (y % 2 === 0 ? -1 : 1);
        const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1], [diagDx, 1], [diagDx, -1]];
        for (const [dx, dy] of neighbors) {
            count += this.cell[(x + dx + this.cellX) % this.cellX][(y + dy + this.cellY) % this.cellY];
        }
        return count;
    }

    nextGeneration() {
        const rule = getActiveRule();
        const next = Array.from({ length: this.cellX }, () => Array(this.cellY).fill(0));
        for (let x = 0; x < this.cellX; x++) {
            for (let y = 0; y < this.cellY; y++) {
                const neighbors = this.countNeighbors(x, y);
                if (this.cell[x][y] === 1) {
                    next[x][y] = rule.survival.includes(neighbors) ? 1 : 0;
                } else {
                    next[x][y] = rule.birth.includes(neighbors) ? 1 : 0;
                }
            }
        }
        this.cell = next;
    }

    hexagonDraw(x, y, gridOnly = false) {
        const sizeX = this.cellSizeX * CONSTANTS.HEX_HALF_WIDTH;
        const sizeY = this.cellSizeY * CONSTANTS.HEX_HALF_HEIGHT;
        const offsetX = (y % 2) * (this.cellSizeX / 2);
        const centerX = x * this.cellSizeX + this.cellSizeX / 2 + offsetX;
        const centerY = y * (this.cellSizeY * CONSTANTS.HEX_VERTICAL_SPACING) + this.cellSizeY * CONSTANTS.HEX_HALF_HEIGHT;

        this.ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const px = centerX + sizeX * Math.cos(angle);
            const py = centerY + sizeY * Math.sin(angle);
            if (i === 0) this.ctx.moveTo(px, py);
            else this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
        if (gridOnly) this.ctx.stroke();
        else this.ctx.fill();
    }

    render() {
        // Background
        this.ctx.fillStyle = this.colors.bg;
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.ctx.strokeStyle = this.colors.stroke;
        // Apply pan/zoom view transform
        this.ctx.save();
        const view = state.view || { offsetX: 0, offsetY: 0, scale: 1 };
        this.ctx.translate(view.offsetX, view.offsetY);
        this.ctx.scale(view.scale, view.scale);
        // Grid (strokes)
        for (let x = 0; x < this.cellX; x++) {
            for (let y = 0; y < this.cellY; y++) {
                this.hexagonDraw(x, y, true);
            }
        }
        // Cells (fill)
        this.ctx.fillStyle = this.colors.fill;
        for (let x = 0; x < this.cellX; x++) {
            for (let y = 0; y < this.cellY; y++) {
                if (this.cell[x][y] === 1) this.hexagonDraw(x, y, false);
            }
        }
        this.ctx.restore();
    }

    fillRandom(density) {
        for (let x = 0; x < this.cellX; x++) {
            for (let y = 0; y < this.cellY; y++) {
                this.cell[x][y] = Math.random() < density ? 1 : 0;
            }
        }
    }

    clear() {
        for (let x = 0; x < this.cellX; x++) {
            for (let y = 0; y < this.cellY; y++) {
                this.cell[x][y] = 0;
            }
        }
    }

    setColor(colors) {
        this.colors = { ...colors };
    }
}

// ============================================
// Layout & Initialization
// ============================================
function computeLayout(cellCountX, cellCountY) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const cellX = Math.max(1, Math.floor(cellCountX));
    const cellY = Math.max(1, Math.floor(cellCountY));
    const cellSizeX = width / cellX;
    const cellSizeY = height / cellY;
    return { width: Math.ceil(width), height: Math.ceil(height), cellX, cellY, cellSizeX, cellSizeY };
}

function initGame(cellCountX = state.config.cellX, cellCountY = state.config.cellY, action = null) {
    if (state.loopInterval) {
        clearInterval(state.loopInterval);
        state.loopInterval = null;
    }

    const layout = computeLayout(cellCountX, cellCountY);
    
    // 既存のセル配列を保存（preserve 時に使用）
    const prevCells = state.game ? state.game.cell : null;
    const prevCellX = state.game ? state.game.cellX : null;
    const prevCellY = state.game ? state.game.cellY : null;

    // Handle high-DPI / devicePixelRatio so canvas looks sharp on mobile
    const dpr = window.devicePixelRatio || 1;
    state.canvas.style.width = layout.width + 'px';
    state.canvas.style.height = layout.height + 'px';
    state.canvas.width = Math.max(1, Math.floor(layout.width * dpr));
    state.canvas.height = Math.max(1, Math.floor(layout.height * dpr));
    // Reset transform and scale so drawing uses CSS pixels coordinates
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Disable smoothing for crisper vector edges if any bitmap smoothing occurs
    try { state.ctx.imageSmoothingEnabled = false; } catch (e) {}

    // 新しいゲームインスタンスを作成（幅/高さはCSSピクセル単位で渡す）
    state.game = new GameOfLife(state.ctx, layout.width, layout.height, layout.cellX, layout.cellY);
    state.game.cellSizeX = layout.cellSizeX;
    state.game.cellSizeY = layout.cellSizeY;

    // Ensure square cells to avoid distortion when layout X/Y ratios are extreme.
    // Use the smaller of the two cell sizes so hexes keep correct proportions,
    // then center the grid inside the canvas if the view is at its default.
    const unifiedCellSize = Math.min(layout.cellSizeX, layout.cellSizeY);
    state.game.cellSizeX = unifiedCellSize;
    state.game.cellSizeY = unifiedCellSize;

    // reflect actual grid counts
    state.config.cellX = layout.cellX;
    state.config.cellY = layout.cellY;

    // footprint of the grid in CSS pixels (accounting for hex vertical spacing)
    const gridPixelWidth = unifiedCellSize * layout.cellX;
    const gridPixelHeight = unifiedCellSize * (layout.cellY * CONSTANTS.HEX_VERTICAL_SPACING + CONSTANTS.HEX_HALF_HEIGHT);

    // If user hasn't panned/zoomed, center the grid by default to avoid edge-clipping
    if (state.view && state.view.scale === 1 && state.view.offsetX === 0 && state.view.offsetY === 0) {
        state.view.offsetX = Math.round((layout.width - gridPixelWidth) / 2);
        state.view.offsetY = Math.round((layout.height - gridPixelHeight) / 2);
    }

    updateTheme();

    state.game.fillRandom(state.config.density);
    
    // セルを保持する場合、既存のセル配列から新しいサイズへコピー
    for (let x = 0; x < Math.min(layout.cellX, prevCellX); x++) {
        for (let y = 0; y < Math.min(layout.cellY, prevCellY); y++) {
            state.game.cell[x][y] = prevCells[x][y];
        }
    }

    setFPS(state.config.fps);
}

function updateTheme() {
    if (!state.game) return;
    const colors = state.config.dark ? CONSTANTS.COLORS.dark : CONSTANTS.COLORS.light;
    state.game.setColor(colors);
    if (state.config.dark) {
        document.body.classList.add('dark');
    } else {
        document.body.classList.remove('dark');
    }
}

function setFPS(fps) {
    state.config.fps = fps;
    if (state.loopInterval) {
        clearInterval(state.loopInterval);
        state.loopInterval = null;
    }
    if (state.paused) return;
    state.loopInterval = setInterval(() => {
        if (!state.game) return;
        state.game.render();
        state.game.nextGeneration();
    }, 1000 / state.config.fps);
}

// ============================================
// UI Helpers
// ============================================
function updatePauseButton() {
    const pauseBtn = document.getElementById('pauseToggle');
    if (!pauseBtn) return;
    if (state.paused) {
        pauseBtn.innerHTML = '<i class="fa fa-play" aria-hidden="true"></i><span class="sr-only">Resume</span>';
        pauseBtn.setAttribute('aria-pressed', 'true');
    } else {
        pauseBtn.innerHTML = '<i class="fa fa-pause" aria-hidden="true"></i><span class="sr-only">Pause</span>';
        pauseBtn.setAttribute('aria-pressed', 'false');
    }
}

function togglePause() {
    state.paused = !state.paused;
    if (state.paused) {
        if (state.loopInterval) { clearInterval(state.loopInterval); state.loopInterval = null; }
    } else {
        setFPS(state.config.fps);
    }
    updatePauseButton();
}

function showFadeTemporary() {
    document.body.classList.remove('controls-faded');
    if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); state.inactivityTimer = null; }
    state.inactivityTimer = setTimeout(() => {
        document.body.classList.add('controls-faded');
    }, CONSTANTS.AUTO_HIDE_MS);
}

function updateControlsVisibility(visible) {
    const controlsToggle = document.getElementById('controlsToggle');
    const controlsEl = document.getElementById('controls');
    if (visible) {
        document.body.classList.add('controls-visible');
        controlsToggle?.setAttribute('aria-expanded', 'true');
    } else {
        document.body.classList.remove('controls-visible');
        controlsToggle?.setAttribute('aria-expanded', 'false');
    }
    try { localStorage.setItem('controlsVisible', visible ? '1' : '0'); } catch(e) {}
}

// ============================================
// Pointer / Canvas Editing
// ============================================
function pixelToCell(px, py) {
    if (!state.game) return null;
    // Account for view (pan/zoom) so pointer maps correctly to cell coords
    const view = state.view || { offsetX: 0, offsetY: 0, scale: 1 };
    const tx = (px - view.offsetX) / view.scale;
    const ty = (py - view.offsetY) / view.scale;
    const csx = state.game.cellSizeX;
    const csy = state.game.cellSizeY;
    let y = Math.round((ty - csy * CONSTANTS.HEX_HALF_HEIGHT) / (csy * CONSTANTS.HEX_VERTICAL_SPACING));
    //y = Math.max(0, Math.min(y, state.game.cellY - 1));
    const offsetX = (y % 2) * (csx / 2);
    let x = Math.round((tx - offsetX - csx / 2) / csx);
    //x = Math.max(0, Math.min(x, state.game.cellX - 1));
    return { x, y };
}

function handlePointerSet(e) {
    if (document.body.classList.contains('controls-visible')) return;
    if (!state.game) return;
    const rect = state.canvas.getBoundingClientRect();
    const c = pixelToCell(e.clientX - rect.left, e.clientY - rect.top);
    if (!c) return;
    if (c.x < 0 || c.x >= state.game.cellX || c.y < 0 || c.y >= state.game.cellY) return;
    state.pointerDrawValue = state.game.cell[c.x][c.y] ? 0 : 1;
    state.game.cell[c.x][c.y] = state.pointerDrawValue;
    state.game.render();
}

// ============================================
// Event Handlers
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Get all UI elements
    const controls = {
        darkToggle: document.getElementById('darkToggle'),
        cellXRange: document.getElementById('cellXRange'),
        cellYRange: document.getElementById('cellYRange'),
        densityRange: document.getElementById('densityRange'),
        fpsRange: document.getElementById('fpsRange'),
        ruleSelect: document.getElementById('ruleSelect'),
        customRuleLabel: document.getElementById('customRuleLabel'),
        customRuleInput: document.getElementById('customRuleInput'),
        pauseToggle: document.getElementById('pauseToggle'),
        clearBtn: document.getElementById('clearBtn'),
        stepBtn: document.getElementById('stepBtn'),
        randomizeBtn: document.getElementById('randomize'),
        controlsToggle: document.getElementById('controlsToggle'),
        controlsEl: document.getElementById('controls')
    };

    // === Initialize UI values ===
    controls.darkToggle.checked = state.config.dark;
    if (controls.cellXRange) controls.cellXRange.value = state.config.cellX;
    if (controls.cellYRange) controls.cellYRange.value = state.config.cellY;
    controls.densityRange.value = state.config.density;
    controls.fpsRange.value = state.config.fps;
    controls.ruleSelect.value = state.config.rule;
    if (controls.customRuleInput) controls.customRuleInput.value = state.config.customRule || '';
    if (controls.customRuleLabel) controls.customRuleLabel.style.display = (state.config.rule === 'other' ? '' : 'none');

    // === Theme Toggle ===
    controls.darkToggle.addEventListener('change', (e) => {
        state.config.dark = e.target.checked;
        updateTheme();
    });

    // === Grid Size Change (cells X/Y) ===
    if (controls.cellXRange) controls.cellXRange.addEventListener('change', (e) => {
        state.config.cellX = Math.max(1, Number(e.target.value));
        initGame(state.config.cellX, state.config.cellY);
    });
    if (controls.cellYRange) controls.cellYRange.addEventListener('change', (e) => {
        state.config.cellY = Math.max(1, Number(e.target.value));
        initGame(state.config.cellX, state.config.cellY);
    });

    // === Density ===
    controls.densityRange.addEventListener('input', (e) => {
        state.config.density = Number(e.target.value);
    });

    // === FPS ===
    controls.fpsRange.addEventListener('change', (e) => {
        setFPS(Number(e.target.value));
    });

    // === Rule ===
    controls.ruleSelect.addEventListener('change', (e) => {
        state.config.rule = e.target.value;
        if (controls.customRuleLabel) controls.customRuleLabel.style.display = (e.target.value === 'other' ? '' : 'none');
        state.game?.render();
    });

    if (controls.customRuleInput) {
        controls.customRuleInput.addEventListener('input', (e) => {
            state.config.customRule = e.target.value;
            state.game?.render();
        });
    }

    // === Game Controls ===
    controls.clearBtn.addEventListener('click', () => {
        if (!state.game) return;
        state.game.clear();
        state.game.render();
    });

    controls.stepBtn.addEventListener('click', () => {
        if (!state.game) return;
        state.game.nextGeneration();
        state.game.render();
    });

    controls.randomizeBtn.addEventListener('click', () => {
        if (!state.game) return;
        state.game.fillRandom(state.config.density);
        state.game.render();
    });

    controls.pauseToggle.addEventListener('click', togglePause);

    // === Activity Fade ===
    CONSTANTS.ACTIVITY_EVENTS.forEach(evt => {
        document.addEventListener(evt, showFadeTemporary, { passive: true });
    });

    // === Menu Toggle ===
    // Restore controls visibility only if explicitly remembered.
    // Default to closed to avoid unexpected auto-open on load.
    const stored = localStorage.getItem('controlsVisible');
    updateControlsVisibility(false);

    controls.controlsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const vis = !document.body.classList.contains('controls-visible');
        updateControlsVisibility(vis);
    });

    if (controls.controlsEl) {
        controls.controlsEl.addEventListener('mouseenter', () => {
            if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); state.inactivityTimer = null; }
        });
        controls.controlsEl.addEventListener('mouseleave', () => {
            if (document.body.classList.contains('controls-visible')) showFadeTemporary();
        });
    }

    document.addEventListener('click', (e) => {
        if (!document.body.classList.contains('controls-visible')) return;
        if (!controls.controlsEl.contains(e.target) && e.target !== controls.controlsToggle) {
            updateControlsVisibility(false);
        }
    });

    // === Canvas Pointer Events ===
    state.canvas.style.touchAction = 'none';
    state.canvas.style.cursor = 'crosshair';

    // --- Pointer / Gesture handling: drawing, pan (middle-button / two-finger), pinch-zoom ---
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    state.canvas.addEventListener('pointerdown', (e) => {
        if (document.body.classList.contains('controls-visible')) return;
        state.canvas.setPointerCapture?.(e.pointerId);

        if (e.pointerType === 'mouse' && e.button === 1) {
            // Middle-button -> pan
            state.gesture.isPanning = true;
            state.gesture.panLast = { x: e.clientX, y: e.clientY };
            state.canvas.style.cursor = 'grabbing';
            return;
        }

        if (e.pointerType === 'touch') {
            // track touch pointers for pinch/drag
            state.gesture.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (state.gesture.pointers.size === 1) {
                state.isPointerDown = true;
                handlePointerSet(e);
            } else if (state.gesture.pointers.size === 2) {
                // start gesture
                const pts = Array.from(state.gesture.pointers.values());
                const startDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
                state.gesture.gestureStart = {
                    startDist,
                    startScale: state.view.scale,
                    startMid: mid,
                    startOffset: { x: state.view.offsetX, y: state.view.offsetY }
                };
            }
            return;
        }

        // Left mouse / pen -> draw
        state.isPointerDown = true;
        handlePointerSet(e);
    }, { passive: false });

    state.canvas.addEventListener('pointermove', (e) => {
        if (document.body.classList.contains('controls-visible')) return;
        // Middle-button panning
        if (state.gesture.isPanning) {
            const dx = e.clientX - (state.gesture.panLast?.x || e.clientX);
            const dy = e.clientY - (state.gesture.panLast?.y || e.clientY);
            state.gesture.panLast = { x: e.clientX, y: e.clientY };
            state.view.offsetX += dx;
            state.view.offsetY += dy;
            state.game?.render();
            return;
        }

        if (e.pointerType === 'touch') {
            // update pointer position
            if (state.gesture.pointers.has(e.pointerId)) {
                state.gesture.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            }
            if (state.gesture.pointers.size === 2 && state.gesture.gestureStart) {
                const pts = Array.from(state.gesture.pointers.values());
                const curDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                const curMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
                const gs = state.gesture.gestureStart;
                const newScale = clamp(gs.startScale * (curDist / gs.startDist), 0.2, 6);
                // keep midpoint stable
                const rect = state.canvas.getBoundingClientRect();
                const midCanvasX = curMid.x - rect.left;
                const midCanvasY = curMid.y - rect.top;
                const worldX = (gs.startMid.x - rect.left - gs.startOffset.x) / gs.startScale;
                const worldY = (gs.startMid.y - rect.top - gs.startOffset.y) / gs.startScale;
                state.view.scale = newScale;
                state.view.offsetX = midCanvasX - worldX * newScale;
                state.view.offsetY = midCanvasY - worldY * newScale;
                state.game?.render();
                return;
            }
        }

        // Drawing with left mouse / single touch
        if (!state.isPointerDown || !state.game) return;
        const rect = state.canvas.getBoundingClientRect();
        const c = pixelToCell(e.clientX - rect.left, e.clientY - rect.top);
        if (!c) return;
        if (c.x < 0 || c.x >= state.game.cellX || c.y < 0 || c.y >= state.game.cellY) return;
        if (state.game.cell[c.x][c.y] !== state.pointerDrawValue) {
            state.game.cell[c.x][c.y] = state.pointerDrawValue;
            state.game.render();
        }
    }, { passive: false });

    // pointerup / cancel
    CONSTANTS.POINTER_EVENTS.forEach(ev => {
        state.canvas.addEventListener(ev, (e) => {
            state.isPointerDown = false;
            // release panning if any
            if (state.gesture.isPanning) {
                state.gesture.isPanning = false;
                state.gesture.panLast = null;
                state.canvas.style.cursor = 'crosshair';
            }
            // remove pointer from touch map
            try { state.canvas.releasePointerCapture?.(e.pointerId); } catch (err) {}
            state.gesture.pointers.delete(e.pointerId);
            if (state.gesture.pointers.size < 2) state.gesture.gestureStart = null;
        });
    });

    // Wheel to zoom (mouse)
    state.canvas.addEventListener('wheel', (e) => {
        if (document.body.classList.contains('controls-visible')) return;
        e.preventDefault();
        const rect = state.canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const delta = -e.deltaY;
        const zoomFactor = Math.exp(delta * 0.0015);
        const newScale = clamp(state.view.scale * zoomFactor, 0.2, 6);
        // keep pointer position stable during zoom
        const worldX = (px - state.view.offsetX) / state.view.scale;
        const worldY = (py - state.view.offsetY) / state.view.scale;
        state.view.scale = newScale;
        state.view.offsetX = px - worldX * newScale;
        state.view.offsetY = py - worldY * newScale;
        state.game?.render();
    }, { passive: false });

    // === Window Events ===
    window.addEventListener('resize', () => {
        if (state.resizeTimer) clearTimeout(state.resizeTimer);
        state.resizeTimer = setTimeout(() => {
            initGame(state.config.cellX, state.config.cellY);
        }, CONSTANTS.RESIZE_DEBOUNCE_MS);
    });

    // === Initial State ===
    updatePauseButton();
    showFadeTemporary();
});

// === Initialization ===
initGame();
