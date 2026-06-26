# CANvision

CAN bus frame analyzer for reverse engineering — parses GVRET CSV logs and SLCAN files, supports live capture via Web Serial API, and visualizes data with a table view and interactive graphs.

## Tech Stack

- Language/runtime: TypeScript + React 18
- Key frameworks/libraries: ECharts (echarts-for-react), PapaParse, Tailwind CSS
- Build tool: Vite 5
- Test framework: (none yet)

## File Structure

src/
App.tsx — top-level: file/live mode state, tab routing, highlight/filter state
main.tsx — React entry point
index.css — Tailwind + global styles
types.ts — CanFrame, CanIdSummary interfaces
webserial.d.ts — minimal Web Serial API type declarations (not in TS DOM lib)
hooks/
useSerialCan.ts — Web Serial hook: connect/disconnect/pause/clear, 20k ring buffer, 150ms batched updates
utils/
parseGvret.ts — CSV parsing (PapaParse) + buildIdSummaries aggregator
parseSlcan.ts — SLCAN log file parser + parseSingleSlcanFrame() for live use
components/
FileUpload.tsx — drag-and-drop file intake + Live CAN connect panel (baud rate select)
LiveBar.tsx — live mode controls: status, pause/resume, clear, disconnect
SignalScoutView.tsx — overwrite-mode live signal table: per-byte change highlighting, Hz/count sort, Hz filter
TableView.tsx — sortable/filterable table of all CAN IDs
GraphView.tsx — scrollable list of CanIdRow components
CanIdRow.tsx — single CAN ID: main graph + per-byte expand, byte toggles
ByteGraph.tsx — ECharts line graph with dataZoom (scroll + slider)

## Key Logic Locations

- CSV parsing: src/utils/parseGvret.ts
- Data types: src/types.ts
- Highlight/filter: src/App.tsx (highlightedIds, filterIds state)
- Graph rendering: src/components/ByteGraph.tsx

## Build & Run Commands

- Install: npm install
- Dev: npm run dev → http://localhost:5173
- Build: npm run build
- Preview: npm run preview

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

### Live CAN Data (Web Serial API — SLCAN)

Stream live frames from a SLCAN-compatible adapter (e.g. USBtin, Canable, PEAK) directly in the browser.

- Protocol: SLCAN (Serial Line CAN). Incoming frame format: `tIIILDD...DD\r` (standard) / `TIIIIIIIILDD...DD\r` (extended). Timestamps optional (`Z` command).
- Use `navigator.serial.requestPort()` to open the port (Chrome/Edge only — acceptable limitation)
- Write a dedicated `parseSlcan.ts` parser — do NOT reuse `parseGvretCsv`
  - Parse `t`/`T` data frames; ignore `r`/`R` RTR frames and adapter echo/status lines
  - Convert SLCAN hex ID + hex data bytes → internal `CanFrame` structure (same shape as file-parsed frames)
  - Assign a monotonic timestamp (performance.now()) on arrival since SLCAN doesn't mandate wall-clock time
- Ring buffer capped at a configurable frame count (e.g. 20k frames) with 100–200ms batched UI updates to avoid thrashing on fast buses
- "Live" mode flag switches the data source from file → serial buffer; existing Table/Graph views are unchanged
- Controls needed: Connect / Disconnect / Pause (freeze display without stopping capture) / Clear
- X-axis in graph view should auto-follow the newest timestamp in live mode (oscilloscope style)
- Baud rate selection UI (common rates: 125k, 250k, 500k, 1M) sent to adapter via SLCAN `S` command on connect
- Overwite mode similar to SavvyCAN (use a different name though) that is on by default. Instead of adding new rows for each CAN Frame, only add new rows for Unique CAN IDs and then only update the bytes as new frames come in (allows for signal reverse engineering/spotting changes)
- Live data should be sortable via a variety of conditions
- Filters: Filter what signals are displayed by filtering/hiding signals by signal change frequency (greater than or less than Xhz or something). Perhaps other filters that would be useful for CAN reverse engineering?
- There should be some way for user to send a CAN ID/Frame to the future CAN message replay/signal builder. This isn't implemented yet, but perhaps at least implement the UI button or whatever and we'll wire up the function later.

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

### CAN Message Replay & Builder

Send frames back onto the bus via the same SLCAN serial connection used for live capture.

**Three entry points for building a frame to send:**

1. **Replay** — select any frame from the table or graph view and send it as-is (one-shot or repeat at a configurable interval)
2. **Template** — select an existing frame as a starting point, then edit ID, DLC, and individual bytes/bits before sending
3. **From scratch** — open the builder with a blank frame; enter ID (hex), DLC (1–8), and payload bytes manually

**Builder UI (modal or side panel):**

- ID field: hex input, validated against standard (11-bit, max 0x7FF) or extended (29-bit, max 0x1FFFFFFF) range; toggle between the two
- DLC selector: 1–8
- Byte editor: 8 hex byte fields; clicking a byte expands a bit-toggle row (8 checkboxes) so individual bits can be flipped
- Live preview of the SLCAN command string that will be sent (e.g. `t1A38DEADBEEF\r`)
- Send Once / Send Repeat (with ms interval input) / Stop buttons
- Repeat sends use `setInterval`; interval is editable while running

**Implementation notes:**

- Transmit path: serialize frame → SLCAN `t`/`T` string → `writer.write()` on the open serial port's writable stream
- Requires an active serial connection; builder UI is disabled (with tooltip) when not connected
- Received echo of sent frame (most adapters loop back) should be visually distinguished in the live table (e.g. dimmed or tagged "TX")
- No queueing/scheduler needed in v1 — single active repeat job at a time is sufficient

### GitHub Pages Deployment

- Add `.github/workflows/deploy.yml` — build on push to main, deploy `dist/` to `gh-pages` branch
- Add a proper README with screenshots, GIF of graph view, GVRET format description

### Minor Features/Bug Fixes (Cross off once implemented)
