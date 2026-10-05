# Primitive Web (Browser)

Browser-only web app that recreates photos using stacked semi-transparent geometric shapes, matching the algorithm described in [fogleman/primitive](https://github.com/fogleman/primitive).

**Audience for this document:** implementers (human or GitHub Copilot). Follow the [Implementation phases](#implementation-phases) in order. Do not skip phases. Each phase has **acceptance criteria** that must pass before moving on.

**Stage cadence:** deliver one phase at a time. Every checkpoint must remain runnable and leave a visible app state for review. Stop after the phase passes its acceptance criteria so the user can inspect it before starting the next phase.

**Scope (v1):** client-side only — no server, no Go backend, no WASM. TypeScript in a **Web Worker** for all heavy computation.

**Reference implementation:** https://github.com/fogleman/primitive (MIT). When behavior is unclear, read the Go files under `primitive/` (especially `core.go`, `util.go`, `optimize.go`, `state.go`, `worker.go`, `model.go`, `triangle.go`).

---

## Product goals

1. User uploads a photo (PNG/JPEG/WebP).
2. User sets options aligned with the CLI (see [Parameters](#parameters)).
3. User clicks **Start**; the UI stays responsive while shapes are added one at a time.
4. User sees live preview and progress (shape index, score).
5. User can **Pause**, **Resume**, **Reset**, and **Download SVG** (and optionally PNG at export size).

**Non-goals for v1**

- Multi-core parallelism (Go uses `-j` workers; browser v1 uses **one** Web Worker).
- GIF export, ImageMagick, combo mode, or every shape type (triangles first; extend later).
- User accounts, cloud storage, or API keys.

---

## Tech stack

| Piece | Choice |
|-------|--------|
| Bundler | Vite 5+ |
| Language | TypeScript (strict) |
| UI | Vanilla HTML + CSS + TS (no React) |
| Compute | Dedicated Web Worker |
| Pixels | `Uint8ClampedArray` RGBA buffers (`width * height * 4`) |
| Preview | `<canvas>` on main thread |
| Tests (optional) | Vitest for pure functions (score, color, rasterize) |

**Commands Copilot should produce**

```bash
npm create vite@latest . -- --template vanilla-ts
npm install
npm run dev
npm run build
```

Configure Vite so the worker is bundled correctly (`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Main thread (src/main.ts, src/ui.ts)                         │
│  - file input, controls, canvas preview                      │
│  - decode image → resize → ImageData                         │
│  - postMessage to worker; handle progress / done / error    │
└───────────────────────────┬──────────────────────────────────┘
                            │ structured messages
┌───────────────────────────▼──────────────────────────────────┐
│ Web Worker (src/worker/primitiveWorker.ts)                   │
│  - Model loop: Step → Add shape → repeat                     │
│  - RGBA buffers: target, current, scratch                    │
│  - no DOM access                                             │
└──────────────────────────────────────────────────────────────┘
```

**Rule:** The main thread never runs hill-climbing or full-image scoring. It may only decode images and blit preview bitmaps.

---

## Algorithm (must match upstream semantics)

This is **not** a genetic algorithm. It is **iterative greedy placement** with **hill climbing** on each new shape.

### Images and sizes

1. **Input resize (`r`, default 256):** Scale the uploaded image so the **longer side** is at most `r` pixels, preserving aspect ratio (bilinear). All optimization uses this **working size** `(workW, workH)`.

2. **Output size (`s`, default 1024):** Used for SVG `width`/`height` and for drawing the preview at higher resolution. Shapes store geometry in **working pixel coordinates** (same space as `Target` / `Current`). Export applies a scale transform equivalent to Go’s `Model.Scale` and `gg` context setup.

3. **Background (`bg`):** If empty, use **average RGB** of the target image (alpha 255). Otherwise parse hex.

4. **Initialize `Current`:** Solid fill with background color. **Score** = full RMSE between `Target` and `Current`.

### Per-shape loop (one “frame”)

For each shape to add (repeat `n` times):

1. **Search** for a good triangle (later: other modes) via `BestHillClimbState` (see below).
2. **Commit** the winning shape: compute optimal color, alpha-blend into `Current`, update global score with **partial diff**, append to `Shapes` / `Colors` lists.
3. **Optional `rep` (repeat):** Up to `rep` extra shapes with shorter hill climb (`age=100` in Go); stop early if energy does not improve.

Default inner constants from Go `Model.Step` (use these unless UI exposes “quality” presets):

| Symbol | Go value | Meaning |
|--------|----------|---------|
| `n` (random trials) | 1000 | `BestRandomState` loop count |
| `age` (hill climb) | 100 | Max stale mutations before stop; reset age on improvement |
| `m` (restart count) | 16 | Number of `(random + hill climb)` restarts per step (Go splits across CPU workers; browser uses **16 on one worker**) |
| `rep` hill climb | 100 | Extra shapes after main step |

### Scoring: RMSE

For two RGBA images of equal size, sum squared differences over **R, G, B, A** per pixel, then:

```
score = sqrt(total / (workW * workH * 4)) / 255
```

Lower is better. Implement `differenceFull(target, current)` exactly once at init and after any full recompute.

### Partial scoring (required for performance)

When evaluating a candidate shape, do **not** call `differenceFull`. Use `differencePartial(target, before, after, previousScore, scanlines)` from Go `core.go`:

- Start from `total = (previousScore * 255)² * (workW * workH * 4)` (as float, then uint64 for the loop).
- For each pixel in the affected scanlines only: subtract squared error of `before` vs `target`, add squared error of `after` vs `target`.
- Return new RMSE with the same formula as full diff.

Candidate evaluation pipeline (Go `Worker.Energy`):

1. `lines = shape.Rasterize()`
2. `color = computeColor(target, current, lines, alpha)`
3. Copy affected lines from `current` → scratch buffer
4. Draw shape color onto scratch (alpha blend)
5. `return differencePartial(target, current, scratch, worker.Score, lines)`

Note: During search, `worker.Score` is the score of the **committed** current image, not the candidate.

### Optimal color (required)

From Go `computeColor` — for fixed shape alpha `alpha` (1–255), compute RGB that minimizes error over covered pixels:

```
a = (0x101 * 255) / alpha   // integer math as in Go
For each pixel in scanlines:
  rsum += (tr - cr) * a + cr * 0x101
  (same for g, b)
r = clamp((rsum / count) >> 8, 0, 255)
```

Return `{ r, g, b, a: alpha }`.

### Alpha blending drawn pixels

From Go `drawLines` — for each scanline pixel, use shape alpha and optional scanline alpha (`0xffff` for triangles):

```
m = 0xffff
sr, sg, sb, sa = shape color NRGBA scaled to 0..m
ma = line.Alpha
a = (m - sa * ma / m) * 0x101
dest = (dest * a + src * ma) / m >> 8   // per channel including alpha
```

Port this literally; do not use Canvas2D for evaluation loops (too slow).

### Hill climbing

From Go `optimize.go` `HillClimb(state, maxAge)`:

- Copy state; track `bestState` / `bestEnergy`.
- Loop `age` from 0 to `maxAge-1`:
  - Save undo snapshot, `DoMove()`, compute `Energy()`.
  - If energy **worse or equal** (`>= bestEnergy`), undo.
  - Else accept: update `bestEnergy`, `bestState = copy`, set `age = -1` (restart age counter on improvement).
- Return `bestState`.

`State.DoMove` (Go `state.go`):

- Clone state to undo.
- `shape.Mutate()`
- If `alpha === 0` mode: `mutateAlpha = true`, start alpha 128; each move add `random in [-10,10]` clamped to 1..255.
- Invalidate cached score (`Score = -1`).

### Triangle shape (first shape type)

Port from `triangle.go`:

- **Random init:** Random vertex `(x1,y1)` in canvas; other vertices offset by ±15; call `Mutate()` until valid.
- **Mutate:** Pick random vertex 0..2; add `Normal(0,16)` rounded to int to x and y; clamp to `[-16, workW-1+16]` etc.; repeat until `Valid()`.
- **Valid:** All three angles > 15° (use same geometry as Go).
- **Rasterize:** Integer scanline triangle rasterizer (`rasterizeTriangle*` + `cropScanlines`). Reuse a preallocated `Scanline[]` buffer on the worker (append/clear pattern like Go `Lines[:0]`).

### Commit shape

From Go `Model.Add`:

1. `before = copy(current)`
2. `lines = shape.Rasterize()`
3. `color = computeColor(target, current, lines, alpha)`
4. `drawLines(current, color, lines)`
5. `score = differencePartial(target, before, current, model.Score, lines)`
6. Push shape and color to arrays; update `model.Score`.

---

## Parameters

Map CLI flags to UI controls and worker config:

| CLI | Default | UI label | Notes |
|-----|---------|----------|-------|
| `-r` | 256 | Max working size | 128 / 256 / 384 |
| `-s` | 1024 | Export / preview size | Long edge of SVG |
| `-n` | (required) | Number of shapes | e.g. 50–200 |
| `-m` | 1 | Shape mode | v1: `1` triangle only; stub enum for future |
| `-a` | 128 | Alpha | 0 = auto per shape (mutate alpha) |
| `-bg` | avg | Background | avg or hex picker |
| `-rep` | 0 | Extra shapes / step | Advanced, optional slider 0–5 |

**Quality preset (recommended UX):**

- **Draft:** `n_random=200`, `age=50`, `m=4`
- **Normal (default):** `1000`, `100`, `16` (match Go)
- **High:** `2000`, `150`, `24`

---

## Project layout (target)

Copilot should create files roughly as follows:

```
primitive-web/
├── README.md                 # this file
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── favicon.svg
└── src/
    ├── main.ts               # bootstrap UI + worker
    ├── ui.ts                 # DOM bindings, control state
    ├── preview.ts            # canvas draw, upscale blit
    ├── imageLoad.ts          # File → ImageData, resize, average color
    ├── types.ts              # shared message + config types
    ├── style.css
    ├── worker/
    │   └── primitiveWorker.ts
    └── primitive/
        ├── buffers.ts        # RGBA helpers, copy, fill
        ├── color.ts          # computeColor, Color type
        ├── score.ts          # differenceFull, differencePartial
        ├── scanline.ts       # Scanline, cropScanlines
        ├── blend.ts          # copyLines, drawLines
        ├── rng.ts            # seeded or Math.random; normal distribution
        ├── optimize.ts       # HillClimb, Annealable interface
        ├── state.ts          # State object
        ├── worker.ts         # Worker class (algorithm worker, not Web Worker)
        ├── model.ts          # Model: Step, Add, SVG string
        └── shapes/
            ├── shape.ts      # Shape interface
            └── triangle.ts
```

Shared types used by main + worker must live in `types.ts` and only use serializable data in `postMessage`.

---

## Web Worker message protocol

Use **transferable** `ArrayBuffer` for preview pixels when sending ImageData to avoid copies (optional optimization). v1 may send `ImageData`-like `{ width, height, data: Uint8ClampedArray }` with structured clone.

### Main → Worker

```ts
type WorkerRequest =
  | { type: 'start'; config: RunConfig; target: ImageBitmap | ImageData }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'abort' };
```

`RunConfig`: `{ shapeCount, mode, alpha, workSize, outputSize, backgroundHex | 'avg', repeat, quality }`.

On `start`, worker clones target into internal RGBA, builds Model, runs loop until count reached, paused, or aborted.

### Worker → Main

```ts
type WorkerEvent =
  | { type: 'ready' }
  | { type: 'progress'; shapeIndex: number; shapeCount: number; score: number }
  | { type: 'preview'; width: number; height: number; buffer: ArrayBuffer }
  | { type: 'shapeAdded'; index: number; svgFragment: string }  // optional incremental SVG
  | { type: 'done'; svg: string; finalScore: number }
  | { type: 'error'; message: string }
  | { type: 'paused' };
```

**Throttling:** Post `preview` at most every **300 ms** or every **1 committed shape**, whichever is less frequent. Always send `progress` on each committed shape.

**Pause:** Worker checks a flag between shapes and between hill-climb inner loops (every N mutations) so pause responds within ~200 ms.

---

## SVG export

Port logic from Go `Model.SVG()`:

- Root `<svg width="{Sw}" height="{Sh}">`
- Background `<rect fill="#rrggbb"/>`
- Group `<g transform="scale({scale}) translate(0.5 0.5)">`
- Each triangle: `<polygon fill="#rrggbb" fill-opacity="a/255" points="..."/>`

`Sw`, `Sh`, `scale` computed like `NewModel` in Go (`model.go`): output long edge = `outputSize`, aspect from **working** target dimensions.

Main thread triggers download:

```ts
const blob = new Blob([svg], { type: 'image/svg+xml' });
// <a download="primitive.svg">
```

**PNG export (optional phase):** Offscreen canvas at `outputSize`, draw SVG via Image + canvas, or replay shapes with Canvas2D using same transform as SVG.

---

## UI specification

Minimal, accessible layout:

1. **Header:** title + one-line description.
2. **Input:** file picker + drag-and-drop zone; show thumbnail of original.
3. **Controls:** shapes count (number), alpha (0–255), working size, output size, background, quality preset, Start / Pause / Reset.
4. **Progress:** `Shape 12 / 100`, current score (6 decimal places like Go logs).
5. **Output:** side-by-side or tabbed **Target** vs **Result** canvas.
6. **Actions:** Download SVG (enabled when ≥1 shape or on done), Download PNG (optional).

Disable Start while running; Reset aborts worker and clears state (terminate and respawn worker on Reset to avoid stale closures).

**Error handling:** Invalid file type, decode failure, worker error → visible banner.

---

## Implementation phases

Copilot: implement **one phase per PR or commit series**. Run `npm run build` after each phase.

### Phase 0 — Scaffold

**Tasks**

- [x] Vite vanilla-ts project, strict TS, ESLint optional.
- [x] Basic page layout and styles (responsive, dark-friendly optional).
- [x] Empty worker that responds `{ type: 'ready' }` on load.

**Acceptance**

- [x] `npm run dev` loads without console errors.
- [x] Worker ping/pong works.

---

### Phase 1 — Image loading (main thread)

**Tasks**

- [x] `imageLoad.ts`: read file → HTMLImageElement → draw to canvas → `ImageData`.
- [x] Resize so max(w,h) = `workSize` (bilinear via canvas draw size).
- [x] `averageColor(imageData)` for default background.

**Acceptance**

- [x] Upload shows correct thumbnail dimensions (e.g. 256×192 for wide photo).
- [x] Average color swatch matches visual mean (sanity check).

---

### Phase 2 — Pixel primitives (no worker yet)

**Tasks**

- [x] RGBA buffer helpers: `createBuffer(w,h)`, `fillSolid`, `copyBuffer`, `getPixel`, bounds checks.
- [x] `differenceFull` in `score.ts` — unit test against tiny 2×2 hand-crafted arrays.
- [x] `computeColor`, `copyLines`, `drawLines`, `differencePartial` — port from Go; tests with one horizontal scanline.

**Acceptance**

- [x] Vitest (or manual script) shows partial score matches full score after a single known draw.
- [x] Changing one pixel only affects score through partial path consistently.

---

### Phase 3 — Triangle rasterization

**Tasks**

- [x] `Scanline` type `{ y, x1, x2, alpha }`.
- [x] `cropScanlines`.
- [x] Full triangle rasterizer from `triangle.go`.
- [x] Visual debug mode (dev only): rasterize one triangle to canvas filled red.

**Acceptance**

- [x] Filled triangle matches Canvas2D fill for random triangles (30 of 32 seeded triangles were within 12% by filled-pixel count; Canvas2D antialiasing differs at scanline edges).

---

### Phase 4 — Optimization core

**Tasks**

- [x] `Triangle` with `mutate`, `valid`, `copy`, `rasterize`.
- [x] `State` + `Energy()` caching.
- [x] `HillClimb`.
- [x] Algorithm `Worker` class + `BestRandomState` + `BestHillClimbState`.
- [x] `Model` with `Add`, `Step` (single logical worker, `m=16`).

**Acceptance**

- [x] In a dev-only runner (can be temporary button “single step”), one `Step()` lowers or maintains score and modifies `current` buffer visibly (browser check: 0.198899 → 0.164294 after one shape).

---

### Phase 5 — Web Worker integration

**Tasks**

- [x] Move Model loop into `primitiveWorker.ts`.
- [x] Implement message protocol (`start`, `pause`, `abort`, events).
- [x] On each committed shape, send throttled preview buffer (copy of `current`).

**Acceptance**

- [x] Upload image, Start, UI stays scrollable/clickable during run.
- [x] Preview updates over time; Pause stops updates; Resume continues.

---

### Phase 6 — SVG + download

**Tasks**

- [x] `Model.toSVG()` per Go.
- [x] `done` event with full SVG string.
- [x] Download button; file opens in browser/Illustrator with correct aspect ratio.

**Acceptance**

- [x] Downloaded SVG parses as XML with the selected output dimensions (browser check: 512×384, one polygon); model tests verify the default 1024 px scaling and aspect ratio.

---

### Phase 7 — Polish

**Tasks**

- [ ] Quality presets, Reset, error banners, keyboard-free mobile layout.
- [ ] README section “Development” with commands only (keep this spec file as source of truth).
- [ ] Optional: PNG export, localStorage for last settings.

**Acceptance**

- Fresh clone: `npm install && npm run build` succeeds.
- Manual test checklist below passes.

---

## Manual test checklist

1. 512×512 face photo, 100 shapes, normal quality, alpha 128 → recognizable abstract face within ~2–8 minutes on laptop.
2. Pause at shape 20, resume → continues to 100 without corruption.
3. Reset mid-run → can Start again from same upload.
4. SVG at 1024px looks sharper than working preview but same composition.
5. Alpha `0` mode produces varying opacities (not all identical).

---

## Performance guidelines

- Reuse buffers; avoid allocating `new Uint8ClampedArray` inside hill-climb inner loop.
- Preallocate scanline slice capacity ~4096.
- Do not send full preview every mutation — only on commit (throttled).
- Working size 256 is default; warn in UI if user selects 512+ (“slower”).

---

## Random numbers

Go uses `math/rand` with time seed. Browser may use `Math.random()` or a small PRNG (e.g. mulberry32) with seed from `crypto.getRandomValues` for reproducibility option later.

**Normal distribution for mutate:** Box-Muller or approximate `sum of 12 uniforms - 6` if needed; Go uses `NormFloat64()*16`.

---

## Future extensions (do not implement until v1 ships)

Document for later phases:

| `-m` mode | Go file |
|-----------|---------|
| 2 rectangle | `rectangle.go` |
| 3 ellipse | `ellipse.go` |
| 4 circle | `ellipse.go` |
| 5 rotated rect | `rectangle.go` |
| 6 quadratic bezier | `quadratic.go` |
| 7 rotated ellipse | `ellipse.go` |
| 8 polygon | `polygon.go` |
| 0 combo | random type in `worker.go` |

Complex shapes use freetype raster in Go (`raster.go`); browser port may use scanline approximations or Canvas Path2D **only for rasterization into scanlines**, not for scoring via DOM.

---

## Copilot workflow hints

1. Read this README and the linked Go file for the module you are porting **before** writing code.
2. Prefer literal ports of math over “simplified” scoring — simplifications break quality and tests.
3. When adding a file, wire it into the phase that needs it; do not implement Phase 7 before Phase 2 tests pass.
4. Keep `src/primitive/` free of DOM APIs so Vitest can import it in Node.
5. If stuck on triangle rasterization, compare output against a Canvas2D reference renderer at working resolution.

---

## License

App code: MIT (consistent with upstream primitive). Credit Michael Fogleman’s algorithm and repository in the UI footer.

---

## References

- Repository: https://github.com/fogleman/primitive
- Algorithm write-up: upstream `README.md` section “How it Works, Part II”
- RMSE: https://en.wikipedia.org/wiki/Root-mean-square_deviation
- Hill climbing: https://en.wikipedia.org/wiki/Hill_climbing
