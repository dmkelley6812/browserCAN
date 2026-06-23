# CANvision

CAN bus frame analyzer for reverse engineering — parses GVRET CSV logs and visualizes them with a table view and interactive graphs.

## Tech Stack
- Language/runtime: TypeScript + React 18
- Key frameworks/libraries: ECharts (echarts-for-react), PapaParse, Tailwind CSS
- Build tool: Vite 5
- Test framework: (none yet)

## File Structure
src/
  App.tsx              — top-level: file state, tab routing, highlight/filter state
  main.tsx             — React entry point
  index.css            — Tailwind + global styles
  types.ts             — CanFrame, CanIdSummary interfaces
  utils/
    parseGvret.ts      — CSV parsing (PapaParse) + buildIdSummaries aggregator
  components/
    FileUpload.tsx     — drag-and-drop / click-to-browse file intake screen
    TableView.tsx      — sortable/filterable table of all CAN IDs
    GraphView.tsx      — scrollable list of CanIdRow components
    CanIdRow.tsx       — single CAN ID: main graph + per-byte expand, byte toggles
    ByteGraph.tsx      — ECharts line graph with dataZoom (scroll + slider)

## Key Logic Locations
- CSV parsing:         src/utils/parseGvret.ts
- Data types:          src/types.ts
- Highlight/filter:    src/App.tsx (highlightedIds, filterIds state)
- Graph rendering:     src/components/ByteGraph.tsx

## Build & Run Commands
- Install:  npm install
- Dev:      npm run dev   → http://localhost:5173
- Build:    npm run build
- Preview:  npm run preview

## Architecture Notes
- All processing is client-side — no backend. Files are read with FileReader API.
- `buildIdSummaries` groups frames by CAN ID, computes byteChangeMask (which bytes ever change), min/max per byte, and flags `isChanging`.
- `ByteGraph` accepts `singleByte` prop to render individual byte graphs in expanded mode, or renders all `visibleBytes` in combined mode.
- ECharts `dataZoom` provides both inside (mouse-wheel) and slider zoom on all graphs.
- `CanIdRow` uses `expandKey` prop trick (remounted on expand-all/collapse-all) to reset local expand state.
- GVRET IDs are in decimal; displayed as 3-digit hex (padStart 3 '0').

## Known Issues
- Static bytes shown as grayed-out hex in the table; toggling them in CanIdRow is allowed but their graph line is flat.

## Roadmap

### Live CAN Data (Web Serial API)
Stream live frames from an Arduino or other USB serial device directly in the browser.
- Use `navigator.serial.requestPort()` to open the port (Chrome/Edge only — acceptable limitation)
- Parse incoming lines with the existing `parseGvretCsv` logic (Arduino sends GVRET-format text over UART)
- Ring buffer capped at a configurable frame count (e.g. 20k frames) with 100–200ms batched UI updates to avoid thrashing on fast buses
- "Live" mode flag switches the data source from file → serial buffer; existing Table/Graph views are unchanged
- Controls needed: Connect / Disconnect / Pause (freeze display without stopping capture) / Clear
- X-axis in graph view should auto-follow the newest timestamp in live mode (oscilloscope style)

### Performance — Large File Handling
Relevant at ~180k+ frames (10-min drive cycle at ~300 frames/sec). Three fixes in priority order:

**1. LTTB graph downsampling (2 lines, highest impact)**
Add `sampling: 'lttb'` to every series definition in `ByteGraph.tsx`. ECharts applies
Largest Triangle Three Buckets downsampling automatically, reducing e.g. 50k points to a
visually identical ~2k without losing signal shape.
- Auto-apply when a CAN ID's frame count exceeds a threshold (suggested: 2,000 frames)
- Per-ID toggle in `CanIdRow` lets the user disable downsampling for a specific ID when
  they need to inspect every raw data point (e.g. chasing a brief glitch)
- The toggle state lives in `CanIdRow` local state; no global changes needed
- When downsampling is off, warn in the UI if frame count is very high (>20k) since
  ECharts render time will be noticeable

**2. Web Worker CSV parsing (medium effort, fixes frozen tab on large files)**
Offload PapaParse to a background thread so the UI stays responsive during parse.
- PapaParse has native `worker: true` support; main change is the call site in App.tsx
- Show a progress indicator (PapaParse streams progress callbacks in worker mode)
- `buildIdSummaries` runs after parse completes, still on main thread (fast enough)

**3. Typed array frame storage (only needed at 500k+ frames)**
Replace per-frame JS objects with columnar typed arrays to cut memory ~5–10x.
Suggested layout:
```
timestamps: Float64Array   // one entry per frame
ids:        Uint16Array    // one entry per frame
dlcs:       Uint8Array     // one entry per frame
data:       Uint8Array     // frameCount × 8, row-major
```
`CanIdSummary.frames` would become index ranges into these global arrays rather than
arrays of frame objects. Requires updating all consumers (ByteGraph, BitGraph, TableView).
Only pursue this if the Web Worker fix isn't enough — it's the biggest refactor.

### GitHub Pages Deployment
- Add `.github/workflows/deploy.yml` — build on push to main, deploy `dist/` to `gh-pages` branch
- Add a proper README with screenshots, GIF of graph view, GVRET format description
