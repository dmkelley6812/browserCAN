# browserCAN

**A CAN bus frame analyzer that runs entirely in your browser — no install, no drivers, no backend.**

Load a log file or plug in a SLCAN adapter and start reverse engineering CAN signals immediately. Built as a personal tool for truck CAN data analysis; shared openly in case it's useful to others.

> **This is a Personal project** — open source as-is. I can't guarantee I'll be super active in responding to issues or PRs. If you find it useful, feel free to...
> 
  [![Buy Me A Beer](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20beer&emoji=%F0%9F%8D%BA&slug=dk_dev&button_colour=5F7FFF&font_colour=ffffff&font_family=Arial&outline_colour=000000&coffee_colour=FFDD00)](https://www.buymeacoffee.com/dk_dev)

---

## Screenshots

> Screenshots coming soon:
> - `docs/screenshots/upload.png` — the file/connect landing screen
> - `docs/screenshots/frame-table.png` — Frame Table view with a file loaded
> - `docs/screenshots/graph-view.png` — Graph View showing multi-byte waveforms
> - `docs/screenshots/signal-scout.png` — SignalScout in live mode with byte highlighting active
> - `docs/screenshots/frame-builder.png` — Frame Builder modal with bit-toggle open


---

## What it does

Three views for analyzing CAN traffic, designed for reverse engineering:

### Frame Table
A sortable, filterable table of every unique CAN ID seen in the capture. Shows frame count, DLC, the last byte values (with static bytes grayed out), and lets you highlight or filter down to specific IDs across all views.

### Graph View
Interactive time-series graphs of every CAN ID. Each byte gets its own colored line. Mouse-wheel to zoom, slider to pan. Expand any ID to see per-byte graphs individually. Useful for correlating byte changes against physical events (throttle input, speed changes, etc.).

### SignalScout
An overwrite-mode live table purpose-built for signal hunting. Instead of accumulating rows, it shows one row per CAN ID and updates bytes in place as new frames arrive. Changed bytes flash yellow so changes jump out immediately.

**SignalScout features:**
- **Float to top** — IDs with recent byte changes bubble to the top automatically
- **Snapshot / Delta** — freeze a baseline of all current byte values; the view then filters to only IDs that have changed from that snapshot (great for isolating what changes when you press a button)
- **Burst counter** — counts byte-change events per ID within a rolling 1/2/5/10-second window; highlights IDs spiking in activity
- **Hz filter** — show only IDs transmitting above or below a frequency threshold
- **Active only** — hide all IDs with static (never-changing) bytes
- **Favorites** — star specific IDs to keep them visible and filterable
- **Ignore** — hide noise IDs from the table without losing the data
- **Group by Hz** — organize IDs into High / Medium / Low frequency bands

### Frame Builder
A modal for constructing and transmitting CAN frames over an active SLCAN connection.

- Hex ID input with 11-bit / 29-bit (extended) toggle and range validation
- DLC selector (1–8 bytes)
- Per-byte hex inputs; click any byte to expand a bit-toggle grid for individual bit manipulation
- Live SLCAN command preview (`t1A38DEADBEEF\r`) updates as you type
- **Send Once** or **Repeat** with a configurable millisecond interval (editable while running)

---

## Currently Supported input formats

| Format | How |
|---|---|
| **GVRET CSV** | Drag & drop `.csv` files captured with a GVRET-compatible logger (e.g. ESP32RET, Macchina A0) |
| **SLCAN log** | Drag & drop `.csv` / `.txt` / `.log` files in SLCAN text format |
| **Live SLCAN** | Connect a SLCAN-compatible USB adapter via Web Serial (Chrome/Edge only) |

### Compatible live adapters

Any adapter that speaks SLCAN over USB serial should work:
- Canable / Canable Pro
- USBtin
- PEAK PCAN-USB (SLCAN firmware)
- Macchina A0
- ESP32 with SLCAN firmware (See https://github.com/mintynet/esp32-slcan)

---

## Usage

### File analysis

1. Open the app
2. Drag and drop a GVRET CSV or SLCAN log file onto the upload area
3. Switch between Frame Table, Graph View, and SignalScout tabs

### Live capture

1. Click **Connect Live**
2. Select your CAN bus baud rate (125k / 250k / 500k / 1M) and serial baud rate
3. Choose your USB adapter from the browser's port picker
4. Frames start streaming immediately into all three views

### Signal hunting workflow (SignalScout)

1. Connect live (or load a log)
2. Switch to **SignalScout**
3. Enable **Float to top** — actively changing IDs rise on each update
4. Take a **Snapshot** of the current bus state
5. Trigger whatever physical action you're investigating (press a button, move a lever)
6. Only IDs that changed from the snapshot remain visible, with differing bytes highlighted in orange
7. Star IDs of interest, ignore noise IDs, use **Burst** to catch sporadic events

### Sending frames

1. Make a live connection
2. Click **Frame Builder** in the live control bar, or click the `→` button on any SignalScout row to pre-populate it with that ID's last payload
3. Edit ID, DLC, and bytes; use bit-toggle for precision
4. Send once or repeat at a set interval

---

## Running locally

Requires Node.js 18+.

```bash
npm install
npm run dev
# → http://localhost:5173
```

Web Serial API requires Chrome or Edge. Safari and Firefox are not supported for live capture (file analysis works everywhere).

---

## Tech

- React 18 + TypeScript (strict)
- Vite 5
- Apache ECharts (via echarts-for-react) for graphs
- Tailwind CSS
- PapaParse for CSV parsing
- Web Serial API for live capture — no WebSockets, no backend, no server

Everything runs client-side. No data leaves your machine.

---

## Caveats

- No automated tests
- Large files (180k+ frames) may be slow — ECharts handles the rendering but parsing on the main thread can freeze the tab briefly
- Web Serial is Chrome/Edge only
- This was built for my own use case (truck CAN reverse engineering with a GVRET logger). Your mileage may vary with other setups.

---

## License

MIT — use it, fork it, build on it.

---

[![Buy Me A Beer](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20beer&emoji=%F0%9F%8D%BA&slug=dk_dev&button_colour=5F7FFF&font_colour=ffffff&font_family=Arial&outline_colour=000000&coffee_colour=FFDD00)](https://www.buymeacoffee.com/dk_dev)
