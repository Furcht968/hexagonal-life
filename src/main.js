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
    b245s25: { birth: [2, 4, 5], survival: [2, 5], name: 'B245/S25', type: 'totalistic' },
    b2s34: { birth: [2], survival: [3, 4], name: 'B2/S34', type: 'totalistic' },
    b2s23: { birth: [2], survival: [2, 3], name: 'B2/S23', type: 'totalistic' }
};

// ============================================
// Hexagonal INT (Isotropic Non-Totalistic) Rule Engine
// Callahan notation for hexagonal grids
// ============================================
//
// Each cell has 6 neighbors. With rotational+reflective symmetry (D6),
// neighbor counts 0,1,5,6 have only 1 isotropic class each (no letter needed).
// Counts 2,3,4 each have 3 isotropic classes:
//   o (ortho)  = neighbors are adjacent to each other
//   m (meta)   = neighbors are separated by 1 gap
//   p (para)   = neighbors are separated by 2 gaps (for 2: directly opposite)
//
// Neighbor bits 0..5 are assigned clockwise:
//   0=top-right, 1=right, 2=bottom-right, 3=bottom-left, 4=left, 5=top-left
// (actual deltas depend on row parity, but the cyclic order is consistent)
//
// Class definitions for each count:
//   Count 2:
//     o = bits are adjacent (diff=1): {0,1},{1,2},{2,3},{3,4},{4,5},{5,0}
//     m = bits are separated by 1 (diff=2): {0,2},{1,3},{2,4},{3,5},{4,0},{5,1}
//     p = bits are opposite (diff=3): {0,3},{1,4},{2,5}
//   Count 3:
//     o = three consecutive bits: {0,1,2},{1,2,3},...
//     m = one pair adjacent + one separated: gaps sorted = [1,2,3]
//     p = alternating: {0,2,4},{1,3,5} -- gaps all equal 2
//   Count 4: complement of count-2 (4 alive = 2 dead, classify dead bits)
//     o = complement of 2-o
//     m = complement of 2-m
//     p = complement of 2-p
//
// Rule string format (Callahan/Hensel style):
//   B<birth-spec>/S<survival-spec>
//   where each spec is zero or more "groups":
//     digit alone (0,1,5,6): that count is entirely included
//     digit + letters (2o, 3mp, 4-o): sub-class selection
//       - no minus: include only the listed letters
//       - with minus: include all EXCEPT the listed letters
//   Example: B2o3p/S1234-o5
// ============================================

// Precompute: for each 6-bit mask (0..63), determine its isotropic class
// Returns a string like "0", "1", "2o", "2m", "2p", "3o", "3m", "3p",
// "4o", "4m", "4p", "5", "6"
function computeHexClass(mask) {
    // Count bits
    let count = 0;
    const bits = [];
    for (let i = 0; i < 6; i++) {
        if (mask & (1 << i)) { count++; bits.push(i); }
    }
    if (count === 0) return '0';
    if (count === 1) return '1';
    if (count === 5) return '5';
    if (count === 6) return '6';

    if (count === 2) {
        const [a, b] = bits;
        const diff = (b - a + 6) % 6;
        if (diff === 1 || diff === 5) return '2o'; // adjacent
        if (diff === 2 || diff === 4) return '2m'; // meta
        if (diff === 3) return '2p'; // para (opposite)
    }

    if (count === 4) {
        // Use complement: 4 alive = 2 dead; classify the 2 dead bits
        const deadBits = [];
        for (let i = 0; i < 6; i++) {
            if (!(mask & (1 << i))) deadBits.push(i);
        }
        const [a, b] = deadBits;
        const diff = (b - a + 6) % 6;
        if (diff === 1 || diff === 5) return '4o';
        if (diff === 2 || diff === 4) return '4m';
        if (diff === 3) return '4p';
    }

    if (count === 3) {
        const [a, b, c] = bits; // already sorted ascending
        // Compute cyclic gaps between consecutive bits
        const d1 = (b - a + 6) % 6;
        const d2 = (c - b + 6) % 6;
        const d3 = (a - c + 6) % 6; // wrap-around gap
        const gaps = [d1, d2, d3].sort((x, y) => x - y);
        // Alternating: all gaps == 2 -> [2,2,2]
        if (gaps[0] === 2 && gaps[1] === 2 && gaps[2] === 2) return '3p';
        // Consecutive: two gaps of 1, one of 4 -> sorted [1,1,4]
        if (gaps[0] === 1 && gaps[1] === 1) return '3o';
        // Otherwise meta: gaps sorted [1,2,3]
        return '3m';
    }

    return String(count); // fallback
}

// Build lookup table: mask (0..63) -> class string
const HEX_CLASS = new Array(64);
for (let m = 0; m < 64; m++) {
    HEX_CLASS[m] = computeHexClass(m);
}

// Parse an INT neighbor-count spec string like "2om3-o5" into a Set of class strings.
// Each group in the spec is: digit optionally followed by modifier.
// Modifier: letters omp (include those) OR -letters (exclude those).
// Returns Set<string> of allowed class names (e.g. "2o","3m","5").
function parseINTSpec(spec) {
    const allowed = new Set();
    if (!spec) return allowed;
    // Tokenize: find each digit followed by optional (-?[omp]*)
    const re = /([0-6])(-[omp]+|[omp]*)/g;
    let match;
    while ((match = re.exec(spec)) !== null) {
        const n = match[1];
        const mod = match[2] || '';
        if (n === '0' || n === '1' || n === '5' || n === '6') {
            // Single class - no sub-types
            allowed.add(n);
        } else {
            // n is 2, 3, or 4 — has sub-classes o, m, p
            const allSubs = ['o', 'm', 'p'];
            if (mod === '') {
                // No modifier: include all sub-classes
                allSubs.forEach(s => allowed.add(n + s));
            } else if (mod.startsWith('-')) {
                // Exclude listed letters
                const excluded = mod.slice(1).split('');
                allSubs.forEach(s => {
                    if (!excluded.includes(s)) allowed.add(n + s);
                });
            } else {
                // Include only listed letters
                mod.split('').forEach(s => {
                    if (allSubs.includes(s)) allowed.add(n + s);
                });
            }
        }
    }
    return allowed;
}

// Parse an INT rule string like "B2om3p/S2om3-o5"
// Returns { birth: Set, survival: Set, type: 'int', name: str } or null
function parseINTRule(str) {
    if (!str || typeof str !== 'string') return null;
    const s = str.trim();
    // Must contain at least one INT letter (o, m, or p) to qualify as INT rule
    if (!/[omp]/i.test(s)) return null;
    // Match B<spec>/S<spec> or B<spec>S<spec>
    const m = s.match(/^[Bb]([0-6omp-]*)\/?[Ss]([0-6omp-]*)$/i);
    if (!m) return null;
    const birth = parseINTSpec(m[1].toLowerCase());
    const survival = parseINTSpec(m[2].toLowerCase());
    return { birth, survival, type: 'int', name: str };
}

// Parse totalistic rule strings like "B245/S25" -> { birth: [2,4,5], survival: [2,5] }
function parseTotalisticRule(str) {
    if (!str || typeof str !== 'string') return null;
    const s = str.toUpperCase().replace(/\s+/g, '');
    const m = s.match(/^B([0-9,]*)\/?S([0-9,]*)$/);
    if (!m) return null;
    const birth = (m[1] || '').split(',').join('').split('').filter(Boolean).map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n));
    const survival = (m[2] || '').split(',').join('').split('').filter(Boolean).map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n));
    return { birth, survival, type: 'totalistic', name: str };
}

// Auto-detect and parse rule string (INT or totalistic)
function parseRuleString(str) {
    const intRule = parseINTRule(str);
    if (intRule) return intRule;
    return parseTotalisticRule(str);
}

function getActiveRule() {
    if (state.config.rule && state.config.rule !== 'other') {
        return RULESETS[state.config.rule] || RULESETS.b245s25;
    }
    const parsed = parseRuleString(state.config.customRule || '');
    return parsed || RULESETS.b245s25;
}

// Validate a rule string — returns error message string or null if valid
function validateRuleString(str) {
    if (!str || !str.trim()) return null; // empty is ok (will use default)
    const r = parseRuleString(str.trim());
    if (!r) return '無効な形式。例: B2om3p/S1234-o (INT) または B245/S25 (合計)';
    return null;
}

// === State Management ===
const state = {
    canvas: document.querySelector('.canvas'),
    ctx: null,
    game: null,
    loopInterval: null,
    resizeTimer: null,
    inactivityTimer: null,
    rotationSnapTimer: null,
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
        customRule: '',
        torus: true,
        rotation: 0
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

    // Returns 6-bit bitmask of neighbor states.
    // Bits 0..5 are assigned to the 6 neighbors in clockwise order,
    // using a consistent labeling for even and odd rows so that
    // the cyclic symmetry is correctly captured.
    //
    // For even rows (y%2 == 0, offset cells shifted left relative to odd):
    //   Even-row neighbor deltas (dx, dy) in clockwise order:
    //     0: ( 0,-1) top-right
    //     1: ( 1, 0) right
    //     2: ( 0, 1) bottom-right
    //     3: (-1, 1) bottom-left
    //     4: (-1, 0) left
    //     5: (-1,-1) top-left
    // For odd rows (y%2 == 1):
    //     0: ( 1,-1) top-right
    //     1: ( 1, 0) right
    //     2: ( 1, 1) bottom-right
    //     3: ( 0, 1) bottom-left
    //     4: (-1, 0) left
    //     5: ( 0,-1) top-left
    getNeighborMask(x, y) {
        const cx = this.cellX;
        const cy = this.cellY;
        const wrap = state.config.torus !== false;
        let ns;
        if (y % 2 === 0) {
            ns = [[0, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
        } else {
            ns = [[1, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [0, -1]];
        }
        let mask = 0;
        for (let i = 0; i < 6; i++) {
            const nx = wrap ? (x + ns[i][0] + cx) % cx : x + ns[i][0];
            const ny = wrap ? (y + ns[i][1] + cy) % cy : y + ns[i][1];
            if (nx >= 0 && nx < cx && ny >= 0 && ny < cy && this.cell[nx][ny]) {
                mask |= (1 << i);
            }
        }
        return mask;
    }

    countNeighbors(x, y) {
        const mask = this.getNeighborMask(x, y);
        let count = 0;
        for (let i = 0; i < 6; i++) if (mask & (1 << i)) count++;
        return count;
    }

    nextGeneration() {
        const rule = getActiveRule();
        const next = Array.from({ length: this.cellX }, () => Array(this.cellY).fill(0));

        if (rule.type === 'int') {
            // INT rule: use bitmask + isotropic class lookup
            for (let x = 0; x < this.cellX; x++) {
                for (let y = 0; y < this.cellY; y++) {
                    const mask = this.getNeighborMask(x, y);
                    const cls = HEX_CLASS[mask];
                    if (this.cell[x][y] === 1) {
                        next[x][y] = rule.survival.has(cls) ? 1 : 0;
                    } else {
                        next[x][y] = rule.birth.has(cls) ? 1 : 0;
                    }
                }
            }
        } else {
            // Totalistic rule: count neighbors only
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
        this.ctx.imageSmoothingEnabled = false;
        // Apply pan/zoom/rotation view transform
        this.ctx.save();
        const view = state.view || { offsetX: 0, offsetY: 0, scale: 1 };
        const rcx = this.width / 2;
        const rcy = this.height / 2;
        this.ctx.translate(rcx, rcy);
        this.ctx.rotate((state.config.rotation || 0) * Math.PI / 180);
        this.ctx.translate(-rcx, -rcy);
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
    try { state.ctx.imageSmoothingEnabled = false; } catch (e) { }

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

    // 初期起動時のみにランダム配置、サイズ変更時は既存セルを保持
    if (action === 'random' || !prevCells) {
        state.game.fillRandom(state.config.density);
    }

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
    state.game.render();
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
        pauseBtn.setAttribute('aria-pressed', 'false');
    } else {
        pauseBtn.innerHTML = '<i class="fa fa-pause" aria-hidden="true"></i><span class="sr-only">Pause</span>';
        pauseBtn.setAttribute('aria-pressed', 'true');
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
    if (visible) {
        document.body.classList.add('controls-visible');
        controlsToggle?.setAttribute('aria-expanded', 'true');
    } else {
        document.body.classList.remove('controls-visible');
        controlsToggle?.setAttribute('aria-expanded', 'false');
    }
    try { localStorage.setItem('controlsVisible', visible ? '1' : '0'); } catch (e) { }
}

// Update the custom rule input UI: show/hide rule-type hints, badge, and error
function updateCustomRuleUI() {
    const input = document.getElementById('customRuleInput');
    const intHint = document.getElementById('intRuleHint');
    const totHint = document.getElementById('totRuleHint');
    const err = document.getElementById('ruleError');
    const badge = document.getElementById('ruleTypeBadge');
    if (!input) return;

    const val = input.value.trim();
    const errorMsg = validateRuleString(val);

    // Error display
    if (err) {
        err.textContent = errorMsg || '';
        err.style.display = errorMsg ? '' : 'none';
    }

    // Show correct hint panel and badge
    if (val && !errorMsg) {
        const parsed = parseRuleString(val);
        if (parsed) {
            const isINT = parsed.type === 'int';
            if (intHint) intHint.style.display = isINT ? '' : 'none';
            if (totHint) totHint.style.display = isINT ? 'none' : '';
            if (badge) {
                badge.textContent = isINT ? 'INT' : 'Totalistic';
                badge.className = 'rule-badge ' + (isINT ? 'badge-int' : 'badge-tot');
                badge.style.display = '';
            }
        }
    } else {
        if (intHint) intHint.style.display = 'none';
        if (totHint) totHint.style.display = 'none';
        if (badge) badge.style.display = 'none';
    }
}

// ============================================
// Pointer / Canvas Editing
// ============================================
function exportPNG() {
    if (!state.game) return;
    const g = state.game;
    const cs = g.cellSizeX;
    const sx = cs * CONSTANTS.HEX_HALF_WIDTH;
    const sy = cs * CONSTANTS.HEX_HALF_HEIGHT;
    const minX = cs / 2 - sx;
    const maxX = g.cellX * cs + sx;
    const minY = 0;
    const maxY = (g.cellY - 1) * cs * CONSTANTS.HEX_VERTICAL_SPACING + cs * CONSTANTS.HEX_HALF_HEIGHT + sy;
    const offc = document.createElement('canvas');
    offc.width = Math.ceil(maxX - minX);
    offc.height = Math.ceil(maxY - minY);
    const offctx = offc.getContext('2d');
    offctx.imageSmoothingEnabled = false;
    offctx.fillStyle = g.colors.bg;
    offctx.fillRect(0, 0, offc.width, offc.height);
    offctx.strokeStyle = g.colors.stroke;
    offctx.translate(-minX, -minY);
    const origCtx = g.ctx;
    g.ctx = offctx;
    for (let x = 0; x < g.cellX; x++) {
        for (let y = 0; y < g.cellY; y++) {
            g.hexagonDraw(x, y, true);
        }
    }
    offctx.fillStyle = g.colors.fill;
    for (let x = 0; x < g.cellX; x++) {
        for (let y = 0; y < g.cellY; y++) {
            if (g.cell[x][y] === 1) g.hexagonDraw(x, y, false);
        }
    }
    g.ctx = origCtx;
    const a = document.createElement('a');
    a.href = offc.toDataURL('image/png');
    a.download = 'hex-life-export.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function exportCSV() {
    if (!state.game) return;
    const g = state.game;
    const alive = [];
    for (let y = 0; y < g.cellY; y++) {
        for (let x = 0; x < g.cellX; x++) {
            if (g.cell[x][y] === 1) alive.push(x + ',' + y);
        }
    }
    const rule = state.config.rule === 'other' ? (state.config.customRule || 'unknown') : (RULESETS[state.config.rule]?.name || state.config.rule);
    const header = [
        '# hexagon-lifegame export',
        '# cells_x=' + g.cellX,
        '# cells_y=' + g.cellY,
        '# rule=' + rule,
        '# torus=' + (state.config.torus !== false ? 'on' : 'off')
    ].join('\n');
    const content = header + '\nx,y\n' + alive.join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hex-life-cells.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importCSV() {
    if (!state.game) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = reader.result;
            const lines = text.split(/\r?\n/).filter(l => l.trim());
            let newCellX = state.config.cellX;
            let newCellY = state.config.cellY;
            let newRule = state.config.rule;
            let newCustomRule = state.config.customRule;
            let newTorus = state.config.torus;
            let headerEnd = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line.startsWith('#')) { headerEnd = i; break; }
                const mX = line.match(/cells_x=(\d+)/);
                if (mX) newCellX = parseInt(mX[1], 10);
                const mY = line.match(/cells_y=(\d+)/);
                if (mY) newCellY = parseInt(mY[1], 10);
                const mR = line.match(/rule=(.+)/);
                if (mR) {
                    const ruleName = mR[1].trim();
                    const preset = Object.entries(RULESETS).find(([, v]) => v.name === ruleName);
                    newRule = preset ? preset[0] : 'other';
                    newCustomRule = preset ? '' : ruleName;
                }
                const mT = line.match(/torus=(on|off)/);
                if (mT) newTorus = mT[1] === 'on';
            }
            const dataLines = lines.slice(headerEnd);
            if (newCellX !== state.config.cellX || newCellY !== state.config.cellY) {
                state.config.cellX = newCellX;
                state.config.cellY = newCellY;
                initGame(newCellX, newCellY);
            }
            state.config.rule = newRule;
            state.config.customRule = newCustomRule;
            state.config.torus = newTorus;
            const torusEl = document.getElementById('torusToggle');
            if (torusEl) torusEl.checked = newTorus;
            const rs = document.getElementById('ruleSelect');
            if (rs) rs.value = newRule;
            const cl = document.getElementById('customRuleLabel');
            const ci = document.getElementById('customRuleInput');
            if (ci) ci.value = newCustomRule || '';
            if (cl) cl.style.display = (newRule === 'other' ? '' : 'none');
            const g = state.game;
            g.clear();
            for (let i = 0; i < dataLines.length; i++) {
                const line = dataLines[i];
                if (!line.trim()) continue;
                const parts = line.split(',');
                if (parts.length < 2) continue;
                const x = parseInt(parts[0].trim(), 10);
                const y = parseInt(parts[1].trim(), 10);
                if (isNaN(x) || isNaN(y)) continue;
                if (x >= 0 && x < g.cellX && y >= 0 && y < g.cellY) g.cell[x][y] = 1;
            }
            g.render();
        };
        reader.readAsText(file);
    });
    input.click();
}

function pixelToCell(px, py) {
    if (!state.game) return null;
    // Account for view (pan/zoom/rotation) so pointer maps correctly to cell coords
    const view = state.view || { offsetX: 0, offsetY: 0, scale: 1 };
    const rot = (state.config.rotation || 0) * Math.PI / 180;
    const hw = state.game.width / 2;
    const hh = state.game.height / 2;
    const dx = px - hw;
    const dy = py - hh;
    const c = Math.cos(-rot);
    const s = Math.sin(-rot);
    const rx = dx * c - dy * s + hw;
    const ry = dx * s + dy * c + hh;
    const tx = (rx - view.offsetX) / view.scale;
    const ty = (ry - view.offsetY) / view.scale;
    const csx = state.game.cellSizeX;
    const csy = state.game.cellSizeY;
    let y = Math.round((ty - csy * CONSTANTS.HEX_HALF_HEIGHT) / (csy * CONSTANTS.HEX_VERTICAL_SPACING));
    const offsetX = (y % 2) * (csx / 2);
    let x = Math.round((tx - offsetX - csx / 2) / csx);
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
    if (controls.customRuleLabel) {
        controls.customRuleLabel.style.display = (state.config.rule === 'other' ? '' : 'none');
    }

    // Value display badges
    const badges = {
        cellX: document.getElementById('cellXValue'),
        cellY: document.getElementById('cellYValue'),
        density: document.getElementById('densityValue'),
        fps: document.getElementById('fpsValue')
    };

    const updateBadges = () => {
        if (badges.cellX) badges.cellX.textContent = state.config.cellX;
        if (badges.cellY) badges.cellY.textContent = state.config.cellY;
        if (badges.density) badges.density.textContent = Math.round(state.config.density * 100) + '%';
        if (badges.fps) badges.fps.textContent = state.config.fps;
    };
    updateBadges();

    // === Restore controls panel width ===
    try {
        const savedWidth = localStorage.getItem('controlsWidth');
        if (savedWidth && controls.controlsEl) {
            controls.controlsEl.style.width = savedWidth;
        }
    } catch (err) {}

    // === Theme Toggle ===
    controls.darkToggle.addEventListener('change', (e) => {
        state.config.dark = e.target.checked;
        updateTheme();
    });

    // === Grid Size Change (cells X/Y) ===
    if (controls.cellXRange) {
        controls.cellXRange.addEventListener('input', (e) => {
            state.config.cellX = Math.max(1, Number(e.target.value));
            if (badges.cellX) badges.cellX.textContent = state.config.cellX;
        });
        controls.cellXRange.addEventListener('change', (e) => {
            initGame(state.config.cellX, state.config.cellY);
        });
    }
    if (controls.cellYRange) {
        controls.cellYRange.addEventListener('input', (e) => {
            state.config.cellY = Math.max(1, Number(e.target.value));
            if (badges.cellY) badges.cellY.textContent = state.config.cellY;
        });
        controls.cellYRange.addEventListener('change', (e) => {
            initGame(state.config.cellX, state.config.cellY);
        });
    }

    // === Density ===
    if (controls.densityRange) {
        controls.densityRange.addEventListener('input', (e) => {
            state.config.density = Number(e.target.value);
            if (badges.density) badges.density.textContent = Math.round(state.config.density * 100) + '%';
        });
    }

    // === FPS ===
    if (controls.fpsRange) {
        controls.fpsRange.addEventListener('input', (e) => {
            if (badges.fps) badges.fps.textContent = e.target.value;
        });
        controls.fpsRange.addEventListener('change', (e) => {
            setFPS(Number(e.target.value));
        });
    }

    // === Rule ===
    controls.ruleSelect.addEventListener('change', (e) => {
        state.config.rule = e.target.value;
        if (controls.customRuleLabel) {
            controls.customRuleLabel.style.display = (e.target.value === 'other' ? '' : 'none');
        }
        state.game?.render();
    });

    if (controls.customRuleInput) {
        controls.customRuleInput.addEventListener('input', (e) => {
            state.config.customRule = e.target.value;
            updateCustomRuleUI();
            // Only apply if valid
            if (!validateRuleString(e.target.value)) {
                state.game?.render();
            }
        });
        // Initial UI update
        updateCustomRuleUI();
    }

    // === Controls Panel Resizing ===
    const resizeHandle = document.getElementById('resizeHandle');
    if (resizeHandle && controls.controlsEl) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        resizeHandle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            isResizing = true;
            startX = e.clientX;
            startWidth = controls.controlsEl.getBoundingClientRect().width;
            
            resizeHandle.classList.add('active');
            document.body.classList.add('resizing');
            controls.controlsEl.classList.add('resizing');
            
            resizeHandle.setPointerCapture(e.pointerId);
        });

        resizeHandle.addEventListener('pointermove', (e) => {
            if (!isResizing) return;
            // Panel is fixed to the right side, so dragging left (X decrease) increases width
            const dx = startX - e.clientX;
            const newWidth = Math.max(200, Math.min(window.innerWidth - 40, startWidth + dx));
            controls.controlsEl.style.width = newWidth + 'px';
        });

        const stopResize = (e) => {
            if (!isResizing) return;
            isResizing = false;
            resizeHandle.classList.remove('active');
            document.body.classList.remove('resizing');
            controls.controlsEl.classList.remove('resizing');
            try {
                resizeHandle.releasePointerCapture(e.pointerId);
            } catch (err) {}
            try {
                localStorage.setItem('controlsWidth', controls.controlsEl.style.width);
            } catch (err) {}
        };

        resizeHandle.addEventListener('pointerup', stopResize);
        resizeHandle.addEventListener('pointercancel', stopResize);
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
    updateControlsVisibility(false);

    controls.controlsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const vis = !document.body.classList.contains('controls-visible');
        updateControlsVisibility(vis);
    });

    const closeControlsBtn = document.getElementById('closeControlsBtn');
    if (closeControlsBtn) {
        closeControlsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            updateControlsVisibility(false);
        });
    }

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
            state.gesture.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (state.gesture.pointers.size === 1) {
                state.isPointerDown = true;
                handlePointerSet(e);
            } else if (state.gesture.pointers.size === 2) {
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
        if (state.gesture.isPanning) {
            const dx = e.clientX - (state.gesture.panLast?.x || e.clientX);
            const dy = e.clientY - (state.gesture.panLast?.y || e.clientY);
            state.gesture.panLast = { x: e.clientX, y: e.clientY };
            state.view.offsetX += dx;
            state.view.offsetY += dy;
            state.game?.render();
            return;
        }

        if (e.pointerType === 'touch') return;

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

    CONSTANTS.POINTER_EVENTS.forEach(ev => {
        state.canvas.addEventListener(ev, (e) => {
            state.isPointerDown = false;
            if (state.gesture.isPanning) {
                state.gesture.isPanning = false;
                state.gesture.panLast = null;
                state.canvas.style.cursor = 'crosshair';
            }
            try { state.canvas.releasePointerCapture?.(e.pointerId); } catch (err) { }
            state.gesture.pointers.delete(e.pointerId);
            if (state.gesture.pointers.size < 2) state.gesture.gestureStart = null;
        });
    });

    window.addEventListener('resize', () => {
        if (state.resizeTimer) clearTimeout(state.resizeTimer);
        state.resizeTimer = setTimeout(() => {
            initGame(state.config.cellX, state.config.cellY);
        }, CONSTANTS.RESIZE_DEBOUNCE_MS);
    });

    // === Initial State ===
    updatePauseButton();
    showFadeTemporary();

    // ===== appended features =====

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function updateRotationUI() {
        const b = document.getElementById('rotationValue');
        if (b) b.textContent = Math.round(state.config.rotation || 0);
        const r = document.getElementById('rotationRange');
        if (r) r.value = Math.round(state.config.rotation || 0);
    }

    function snapRotation() {
        state.config.rotation = Math.round((state.config.rotation || 0) / 15) * 15;
        state.config.rotation = clamp(state.config.rotation, -180, 180);
        updateRotationUI();
        state.game?.render();
    }

    function syncAllUI() {
        const t = document.getElementById('torusToggle');
        if (t) t.checked = state.config.torus !== false;
        const xr = document.getElementById('cellXRange');
        const xi = document.getElementById('cellXInput');
        if (xr) xr.value = state.config.cellX;
        if (xi) xi.value = state.config.cellX;
        const yr = document.getElementById('cellYRange');
        const yi = document.getElementById('cellYInput');
        if (yr) yr.value = state.config.cellY;
        if (yi) yi.value = state.config.cellY;
        const rs = document.getElementById('ruleSelect');
        if (rs) rs.value = state.config.rule;
        const cl = document.getElementById('customRuleLabel');
        const ci = document.getElementById('customRuleInput');
        if (ci) ci.value = state.config.customRule || '';
        if (cl) cl.style.display = (state.config.rule === 'other' ? '' : 'none');
        updateCustomRuleUI();
    }

    // --- torus toggle ---
    const torusToggle = document.getElementById('torusToggle');
    if (torusToggle) {
        torusToggle.checked = state.config.torus !== false;
        torusToggle.addEventListener('change', () => {
            state.config.torus = torusToggle.checked;
            state.game?.render();
        });
    }

    // --- rotation slider ---
    const rotationRange = document.getElementById('rotationRange');
    if (rotationRange) {
        rotationRange.value = state.config.rotation || 0;
        rotationRange.addEventListener('input', () => {
            state.config.rotation = Number(rotationRange.value);
            updateRotationUI();
            state.game?.render();
        });
    }

    // --- number-input sync for sliders ---
    function bindNumInput(rangeId, inputId, min, max, configKey, onChange) {
        const rangeEl = document.getElementById(rangeId);
        const inputEl = document.getElementById(inputId);
        if (!rangeEl || !inputEl) return;
        rangeEl.addEventListener('input', () => {
            const v = Number(rangeEl.value);
            inputEl.value = v;
            state.config[configKey] = v;
        });
        rangeEl.addEventListener('change', () => { if (onChange) onChange(); });
        inputEl.addEventListener('change', () => {
            const v = clamp(Number(inputEl.value), min, max);
            inputEl.value = v;
            rangeEl.value = v;
            state.config[configKey] = v;
            if (onChange) onChange();
        });
    }

    bindNumInput('cellXRange', 'cellXInput', 4, 200, 'cellX', () => initGame(state.config.cellX, state.config.cellY));
    bindNumInput('cellYRange', 'cellYInput', 4, 200, 'cellY', () => initGame(state.config.cellX, state.config.cellY));
    bindNumInput('densityRange', 'densityInput', 0, 0.5, 'density', null);
    bindNumInput('fpsRange', 'fpsInput', 1, 60, 'fps', () => setFPS(state.config.fps));

    // --- export / import buttons ---
    document.getElementById('exportPngBtn')?.addEventListener('click', exportPNG);
    document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);
    document.getElementById('importCsvBtn')?.addEventListener('click', importCSV);

    // --- Ctrl+wheel rotation, plain wheel zoom (unified handler) ---
    state.canvas.addEventListener('wheel', function ctrlWheel(e) {
        if (document.body.classList.contains('controls-visible')) return;
        e.preventDefault();
        if (e.ctrlKey) {
            state.config.rotation = (state.config.rotation || 0) - Math.sign(e.deltaY) * 15;
            state.config.rotation = clamp(state.config.rotation, -180, 180);
            updateRotationUI();
            state.game?.render();
            if (state.rotationSnapTimer) clearTimeout(state.rotationSnapTimer);
            state.rotationSnapTimer = setTimeout(() => { snapRotation(); state.rotationSnapTimer = null; }, 500);
            return;
        }
        const rect = state.canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const delta = -e.deltaY;
        const zoomFactor = Math.exp(delta * 0.0015);
        const newScale = clamp(state.view.scale * zoomFactor, 0.2, 6);
        const worldX = (px - state.view.offsetX) / state.view.scale;
        const worldY = (py - state.view.offsetY) / state.view.scale;
        state.view.scale = newScale;
        state.view.offsetX = px - worldX * newScale;
        state.view.offsetY = py - worldY * newScale;
        state.game?.render();
    }, { passive: false });

    // --- two-finger gesture: augment gestureStart with angle + rotation ---
    state.canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        if (state.gesture.pointers.size >= 2 && state.gesture.gestureStart) {
            const pts = Array.from(state.gesture.pointers.values());
            state.gesture.gestureStart.startAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
            state.gesture.gestureStart.startRotation = state.config.rotation || 0;
        }
    });

    const origPointerMove = state.canvas.onpointermove;
    state.canvas.addEventListener('pointermove', (e) => {
        if (state.gesture.pointers.size !== 2 || !state.gesture.gestureStart) return;
        const gs = state.gesture.gestureStart;
        if (gs.startAngle === undefined) return;
        if (state.gesture.pointers.has(e.pointerId))
            state.gesture.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const pts = Array.from(state.gesture.pointers.values());
        const curDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const curAng = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
        const curMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const newScale = clamp(gs.startScale * (curDist / gs.startDist), 0.2, 6);
        const angDelta = curAng - gs.startAngle;
        const midDx = curMid.x - gs.startMid.x;
        const midDy = curMid.y - gs.startMid.y;
        const rect = state.canvas.getBoundingClientRect();
        const mx = curMid.x - rect.left;
        const my = curMid.y - rect.top;
        const wx = (gs.startMid.x - rect.left - gs.startOffset.x) / gs.startScale;
        const wy = (gs.startMid.y - rect.top - gs.startOffset.y) / gs.startScale;
        state.view.scale = newScale;
        state.view.offsetX = mx - wx * newScale + midDx;
        state.view.offsetY = my - wy * newScale + midDy;
        state.config.rotation = clamp((gs.startRotation || 0) + angDelta * (180 / Math.PI), -180, 180);
        updateRotationUI();
        state.game?.render();
    });

    CONSTANTS.POINTER_EVENTS.forEach(ev => {
        state.canvas.addEventListener(ev, () => {
            const wasPinching = state.gesture.pointers.size >= 2 && state.gesture.gestureStart;
            if (state.gesture.pointers.size < 2) {
                if (wasPinching) snapRotation();
                state.gesture.gestureStart = null;
            }
        });
    });

    CONSTANTS.POINTER_EVENTS.forEach(ev => {
        state.canvas.addEventListener(ev, () => {
            if (state.gesture.pointers.size < 2 && state.gesture.gestureStart) {
                snapRotation();
            }
        });
    });
});

// === Initialization ===
initGame();
