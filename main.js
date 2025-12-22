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
    b2s34: { birth: [2], survival: [3, 4], name: 'B2/S34' },
    b245s25: { birth: [2, 4, 5], survival: [2, 5], name: 'B245/S25' }
};

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
        cellPixelSize: 50,
        density: 0.50,
        fps: 10,
        dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        rule: 'b245s25',
        onSettingChange: 'preserve'  // 'preserve', 'clear', 'randomize'
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
        const rule = RULESETS[state.config.rule] || RULESETS.b2s34;
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
        this.ctx.fillStyle = this.colors.bg;
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.ctx.strokeStyle = this.colors.stroke;
        for (let x = 0; x < this.cellX; x++) {
            for (let y = 0; y < this.cellY; y++) {
                this.hexagonDraw(x, y, true);
            }
        }
        this.ctx.fillStyle = this.colors.fill;
        for (let x = 0; x < this.cellX; x++) {
            for (let y = 0; y < this.cellY; y++) {
                if (this.cell[x][y] === 1) {
                    this.hexagonDraw(x, y, false);
                }
            }
        }
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
function computeLayout(cellPixelSize) {
    const width = window.innerWidth;
    const cellX = Math.max(1, Math.ceil(width / cellPixelSize));
    const cellSizeX = width / cellX;
    const cellSizeY = cellSizeX;
    const availableHeight = window.innerHeight;
    const cellY = Math.max(1, Math.ceil((availableHeight - cellSizeY * CONSTANTS.HEX_HALF_HEIGHT) / (cellSizeY * CONSTANTS.HEX_VERTICAL_SPACING)));
    const height = Math.ceil(cellY * (cellSizeY * CONSTANTS.HEX_VERTICAL_SPACING) + cellSizeY * CONSTANTS.HEX_HALF_HEIGHT);
    return { width: Math.ceil(width), height, cellX, cellY, cellSizeX, cellSizeY };
}

function initGame(cellPixelSize = CONSTANTS.DEFAULT_CELL_PIXEL, action = null) {
    if (state.loopInterval) {
        clearInterval(state.loopInterval);
        state.loopInterval = null;
    }

    const layout = computeLayout(cellPixelSize);
    
    // 既存のセル配列を保存（preserve 時に使用）
    const prevCells = state.game ? state.game.cell : null;
    const prevCellX = state.game ? state.game.cellX : null;
    const prevCellY = state.game ? state.game.cellY : null;

    state.canvas.width = layout.width;
    state.canvas.height = layout.height;

    // 新しいゲームインスタンスを作成
    state.game = new GameOfLife(state.ctx, state.canvas.width, state.canvas.height, layout.cellX, layout.cellY);
    state.game.cellSizeX = layout.cellSizeX;
    state.game.cellSizeY = layout.cellSizeY;

    updateTheme();

    // action が null の場合は onSettingChange の設定を使う
    const finalAction = action ?? state.config.onSettingChange;

    if (finalAction === 'clear') {
        state.game.clear();
    } else if (finalAction === 'randomize') {
        // ランダマイズ
        state.game.fillRandom(state.config.density);
    } else if (finalAction === 'preserve' && prevCells) {
        // セルを保持する場合、既存のセル配列から新しいサイズへコピー
        for (let x = 0; x < Math.min(layout.cellX, prevCellX); x++) {
            for (let y = 0; y < Math.min(layout.cellY, prevCellY); y++) {
                state.game.cell[x][y] = prevCells[x][y];
            }
        }
    } else {
        // デフォルト: ランダマイズ（prevCells が無い場合）
        state.game.fillRandom(state.config.density);
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
    const csx = state.game.cellSizeX;
    const csy = state.game.cellSizeY;
    let y = Math.round((py - csy * CONSTANTS.HEX_HALF_HEIGHT) / (csy * CONSTANTS.HEX_VERTICAL_SPACING));
    y = Math.max(0, Math.min(y, state.game.cellY - 1));
    const offsetX = (y % 2) * (csx / 2);
    let x = Math.round((px - offsetX - csx / 2) / csx);
    x = Math.max(0, Math.min(x, state.game.cellX - 1));
    return { x, y };
}

function handlePointerSet(e) {
    if (document.body.classList.contains('controls-visible')) return;
    if (!state.game) return;
    const rect = state.canvas.getBoundingClientRect();
    const c = pixelToCell(e.clientX - rect.left, e.clientY - rect.top);
    if (!c) return;
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
        sizeRange: document.getElementById('sizeRange'),
        densityRange: document.getElementById('densityRange'),
        fpsRange: document.getElementById('fpsRange'),
        ruleSelect: document.getElementById('ruleSelect'),
        onSettingChange: document.getElementById('onSettingChange'),
        pauseToggle: document.getElementById('pauseToggle'),
        clearBtn: document.getElementById('clearBtn'),
        stepBtn: document.getElementById('stepBtn'),
        randomizeBtn: document.getElementById('randomize'),
        controlsToggle: document.getElementById('controlsToggle'),
        controlsEl: document.getElementById('controls')
    };

    // === Initialize UI values ===
    controls.darkToggle.checked = state.config.dark;
    controls.sizeRange.value = state.config.cellPixelSize;
    controls.densityRange.value = state.config.density;
    controls.fpsRange.value = state.config.fps;
    controls.ruleSelect.value = state.config.rule;
    controls.onSettingChange.value = state.config.onSettingChange;

    // === Theme Toggle ===
    controls.darkToggle.addEventListener('change', (e) => {
        state.config.dark = e.target.checked;
        updateTheme();
    });

    // === Size Change ===
    controls.sizeRange.addEventListener('change', (e) => {
        state.config.cellPixelSize = Number(e.target.value);
        initGame(state.config.cellPixelSize);
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
    });

    // === On Setting Change ===
    controls.onSettingChange.addEventListener('change', (e) => {
        state.config.onSettingChange = e.target.value;
    });

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
    const stored = localStorage.getItem('controlsVisible');
    updateControlsVisibility(stored === '1');

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

    state.canvas.addEventListener('pointerdown', (e) => {
        if (document.body.classList.contains('controls-visible')) return;
        state.canvas.setPointerCapture?.(e.pointerId);
        state.isPointerDown = true;
        handlePointerSet(e);
    }, { passive: true });

    state.canvas.addEventListener('pointermove', (e) => {
        if (!state.isPointerDown || !state.game) return;
        if (document.body.classList.contains('controls-visible')) {
            state.isPointerDown = false;
            return;
        }
        const rect = state.canvas.getBoundingClientRect();
        const c = pixelToCell(e.clientX - rect.left, e.clientY - rect.top);
        if (!c) return;
        if (state.game.cell[c.x][c.y] !== state.pointerDrawValue) {
            state.game.cell[c.x][c.y] = state.pointerDrawValue;
            state.game.render();
        }
    }, { passive: true });

    CONSTANTS.POINTER_EVENTS.forEach(ev => {
        state.canvas.addEventListener(ev, (e) => {
            state.isPointerDown = false;
            try { state.canvas.releasePointerCapture?.(e.pointerId); } catch (err) {}
        });
    });

    // === Window Events ===
    window.addEventListener('resize', () => {
        if (state.resizeTimer) clearTimeout(state.resizeTimer);
        state.resizeTimer = setTimeout(() => {
            initGame(state.config.cellPixelSize);
        }, CONSTANTS.RESIZE_DEBOUNCE_MS);
    });

    // === Initial State ===
    updatePauseButton();
    showFadeTemporary();
});

// === Initialization ===
initGame();
