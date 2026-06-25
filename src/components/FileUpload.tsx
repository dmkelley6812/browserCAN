import { useRef, useState } from "react";
import type { BaudRate, SerialBaud } from "../hooks/useSerialCan";
import { BAUD_RATE_OPTIONS, SERIAL_BAUD_OPTIONS, DEFAULT_SERIAL_BAUD } from "../hooks/useSerialCan";

const BAUD_LABELS: Record<BaudRate, string> = {
  125000: "125k",
  250000: "250k",
  500000: "500k",
  1000000: "1M",
};

interface Props {
  onFile: (text: string, name: string) => void;
  onConnectLive: (baudRate: BaudRate, serialBaud: SerialBaud, sendInit: boolean) => void;
}

export default function FileUpload({ onFile, onConnectLive }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedBaud, setSelectedBaud] = useState<BaudRate>(500000);
  const [selectedSerialBaud, setSelectedSerialBaud] = useState<SerialBaud>(DEFAULT_SERIAL_BAUD);
  const [sendInit, setSendInit] = useState(false);

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => onFile(e.target?.result as string, file.name);
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  }

  const serialSupported = "serial" in navigator;

  function serialBaudLabel(b: SerialBaud): string {
    if (b >= 1000000) return "1M";
    if (b >= 1000) return `${b / 1000}k`;
    return String(b);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 p-8">
      {/* Logo / title */}
      <div className="mb-10 text-center">
        <div className="text-5xl font-bold tracking-tight text-slate-100 mb-2">
          browser<span className="text-sky-400">CAN</span>
        </div>
        <div className="text-slate-500 text-sm">
          CAN Bus Frame Analyzer — GVRET / SLCAN
        </div>
      </div>

      <div className="w-full max-w-lg flex flex-col gap-4">
        {/* Drop zone */}
        <div
          className={`
            border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer
            transition-all duration-200
            ${
              dragging
                ? "border-sky-400 bg-sky-900/20 scale-[1.02]"
                : "border-slate-700 hover:border-slate-500 bg-slate-900/50 hover:bg-slate-900"
            }
          `}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <div className="text-4xl mb-4 select-none">📡</div>
          <p className="text-slate-300 font-medium mb-2">
            Drop a GVRET CSV or SLCAN log here
          </p>
          <p className="text-slate-500 text-sm mb-6">or click to browse</p>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors">
            Choose file
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.log,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
            }}
          />
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 border-t border-slate-800" />
          <span className="text-xs text-slate-600">or connect live</span>
          <div className="flex-1 border-t border-slate-800" />
        </div>

        {/* Live connect panel */}
        <div
          className={`rounded-2xl border p-5 ${
            serialSupported
              ? "border-slate-700 bg-slate-900/50"
              : "border-slate-800 bg-slate-900/20 opacity-60"
          }`}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl select-none">🔌</span>
            <div>
              <p className="text-slate-300 font-medium text-sm">Live CAN via SLCAN</p>
              <p className="text-slate-500 text-xs">
                {serialSupported
                  ? "USBtin, Canable, PEAK, ESP32, or any SLCAN adapter"
                  : "Requires Chrome or Edge — Web Serial not available"}
              </p>
            </div>
          </div>

          {/* CAN bitrate row */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-slate-500 w-24 shrink-0">CAN bitrate</span>
            <div className="flex gap-1">
              {BAUD_RATE_OPTIONS.map((br) => (
                <button
                  key={br}
                  onClick={() => setSelectedBaud(br)}
                  disabled={!serialSupported}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    selectedBaud === br
                      ? "bg-sky-600/20 border-sky-700/50 text-sky-300"
                      : "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600"
                  } disabled:cursor-not-allowed`}
                >
                  {BAUD_LABELS[br]}
                </button>
              ))}
            </div>
          </div>

          {/* Serial baud rate row */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-slate-500 w-24 shrink-0">Serial baud</span>
            <select
              value={selectedSerialBaud}
              onChange={(e) => setSelectedSerialBaud(Number(e.target.value) as SerialBaud)}
              disabled={!serialSupported}
              className="text-xs px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 focus:outline-none focus:border-sky-700 disabled:cursor-not-allowed"
            >
              {SERIAL_BAUD_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {serialBaudLabel(b)}{b === DEFAULT_SERIAL_BAUD ? " (default)" : ""}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-600">UART speed to adapter</span>
          </div>

          {/* SLCAN init toggle */}
          <label className="flex items-center gap-2 mb-4 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={sendInit}
              onChange={e => setSendInit(e.target.checked)}
              disabled={!serialSupported}
              className="w-3.5 h-3.5 rounded accent-sky-500 disabled:cursor-not-allowed"
            />
            <span className="text-xs text-slate-500 group-hover:text-slate-400 transition-colors">
              Send SLCAN init commands (S+O)
            </span>
            <span className="text-xs text-slate-700 ml-1">— for USBtin / dedicated adapters</span>
          </label>

          <button
            onClick={() => onConnectLive(selectedBaud, selectedSerialBaud, sendInit)}
            disabled={!serialSupported}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            Connect
          </button>
        </div>
      </div>

      {/* Format hint */}
      <div className="mt-8 max-w-lg w-full rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p className="text-xs text-slate-400 font-mono mb-2">
          Expected CSV format (GVRET):
        </p>
        <pre className="text-xs text-slate-600 font-mono leading-relaxed overflow-x-auto">
          {`Time Stamp,ID,Extended,Remote Frame,DLC,D1,D2,D3,D4,D5,D6,D7,D8
9778,193,0,0,8,16,0,0,0,16,0,0,0
9779,313,0,0,8,0,64,0,0,0,0,0,0`}
        </pre>
      </div>
    </div>
  );
}
