import { useState, useMemo, useCallback } from "react";
import { parseGvretCsv, buildIdSummaries } from "./utils/parseGvret";
import { parseSlcanLog, isSlcanFormat } from "./utils/parseSlcan";
import { useSerialCan } from "./hooks/useSerialCan";
import type { BaudRate, SerialBaud } from "./hooks/useSerialCan";
import type { CanFrame, CanIdSummary } from "./types";
import FileUpload from "./components/FileUpload";
import LiveBar from "./components/LiveBar";
import TableView from "./components/TableView";
import GraphView from "./components/GraphView";
import SignalScoutView from "./components/SignalScoutView";

type Tab = "table" | "graph" | "signalscout";

export default function App() {
  // File-based data source
  const [fileFrames, setFileFrames] = useState<CanFrame[] | null>(null);
  const [fileSummaries, setFileSummaries] = useState<CanIdSummary[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);

  // Live data source
  const serial = useSerialCan();
  const [isLiveMode, setIsLiveMode] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>("table");
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const [filterIds, setFilterIds] = useState<Set<number>>(new Set());

  // Active data — whichever source is in use
  const frames = isLiveMode ? serial.frames : fileFrames;
  const summaries = isLiveMode ? serial.summaries : fileSummaries;

  function handleFile(text: string, name: string) {
    try {
      const parsed = isSlcanFormat(text) ? parseSlcanLog(text) : parseGvretCsv(text);
      if (parsed.length === 0) {
        setFileError(
          "No valid frames found. Check that the file is in SLCAN or GVRET CSV format.",
        );
        return;
      }
      setFileFrames(parsed);
      setFileSummaries(buildIdSummaries(parsed));
      setFileName(name);
      setFileError(null);
    } catch (e) {
      setFileError(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function handleConnectLive(baudRate: BaudRate, serialBaud: SerialBaud, sendInit: boolean) {
    setIsLiveMode(true);
    setHighlightedIds(new Set());
    setFilterIds(new Set());
    serial.connect(baudRate, serialBaud, sendInit);
  }

  async function handleDisconnectLive() {
    await serial.disconnect();
    setIsLiveMode(false);
  }

  function handleLoadNewFile() {
    setFileFrames(null);
    setFileSummaries(null);
    setHighlightedIds(new Set());
    setFilterIds(new Set());
  }

  const toggleHighlight = useCallback((id: number) => {
    setHighlightedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFilter = useCallback((id: number) => {
    setFilterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const stats = useMemo(() => {
    if (!summaries || summaries.length === 0) return null;
    const totalFrames = summaries.reduce((s, x) => s + x.frameCount, 0);
    const activeIds = summaries.filter((s) => s.isChanging).length;
    const tStart = Math.min(...summaries.map((s) => s.firstSeen));
    const tEnd = Math.max(...summaries.map((s) => s.lastSeen));
    return {
      totalFrames,
      activeIds,
      uniqueIds: summaries.length,
      durationMs: tEnd - tStart,
    };
  }, [summaries]);

  // Show FileUpload if not in live mode and no file loaded
  if (!isLiveMode && !fileSummaries) {
    return (
      <>
        {fileError && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-rose-900/80 border border-rose-700 text-rose-200 text-sm px-4 py-2 rounded-lg z-50">
            {fileError}
          </div>
        )}
        <FileUpload onFile={handleFile} onConnectLive={handleConnectLive} />
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center gap-4 px-5 py-3 border-b border-slate-800 flex-shrink-0 bg-slate-900/80 backdrop-blur">
        {/* Brand */}
        <span className="font-bold text-lg tracking-tight">
          browser<span className="text-sky-400">CAN</span>
        </span>

        {/* Source info */}
        <div className="flex items-center gap-2 text-xs text-slate-500 border-l border-slate-700 pl-4">
          {isLiveMode ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 font-medium">Live</span>
            </span>
          ) : (
            <span className="text-slate-400">{fileName}</span>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div className="flex items-center gap-4 text-xs text-slate-500 border-l border-slate-700 pl-4">
            <span>
              <span className="text-slate-300">{stats.uniqueIds}</span> IDs
            </span>
            <span>
              <span className="text-slate-300">{stats.activeIds}</span> active
            </span>
            <span>
              <span className="text-slate-300">
                {stats.totalFrames.toLocaleString()}
              </span>{" "}
              frames
            </span>
            {!isLiveMode && (
              <span>
                <span className="text-slate-300">
                  {(stats.durationMs / 1000).toFixed(2)}s
                </span>{" "}
                capture
              </span>
            )}
          </div>
        )}

        {/* Action button */}
        {isLiveMode ? null : (
          <button
            onClick={handleLoadNewFile}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
          >
            Load new file
          </button>
        )}

        <a href="https://www.buymeacoffee.com/dk_dev" target="_blank" rel="noreferrer" className={isLiveMode ? "ml-auto" : ""}>
          <img
            src="https://img.buymeacoffee.com/button-api/?text=Buy me a beer&emoji=🍺&slug=dk_dev&button_colour=5F7FFF&font_colour=ffffff&font_family=Arial&outline_colour=000000&coffee_colour=FFDD00"
            alt="Buy me a beer"
            style={{ height: 28 }}
          />
        </a>
      </header>

      {/* Live controls bar */}
      {isLiveMode && (
        <LiveBar serial={serial} onBack={handleDisconnectLive} />
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-slate-800 flex-shrink-0 bg-slate-900/40">
        {(["table", "graph", "signalscout"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`
              px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${
                activeTab === tab
                  ? "bg-sky-600/20 text-sky-300 border border-sky-700/50"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
              }
            `}
          >
            {tab === "table"
              ? "Frame Table"
              : tab === "graph"
                ? "Graph View"
                : "SignalScout"}
          </button>
        ))}

        {highlightedIds.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {highlightedIds.size} highlighted
            </span>
            <button
              onClick={() => setHighlightedIds(new Set())}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === "table" ? (
          summaries && summaries.length > 0 ? (
            <TableView
              frames={frames!}
              summaries={summaries}
              highlightedIds={highlightedIds}
              onToggleHighlight={toggleHighlight}
              filterIds={filterIds}
              onToggleFilter={toggleFilter}
            />
          ) : (
            <WaitingForFrames isLiveMode={isLiveMode} />
          )
        ) : activeTab === "graph" ? (
          summaries && summaries.length > 0 ? (
            <GraphView
              summaries={summaries}
              highlightedIds={highlightedIds}
              filterIds={filterIds}
            />
          ) : (
            <WaitingForFrames isLiveMode={isLiveMode} />
          )
        ) : (
          <SignalScoutView summaries={summaries ?? []} isLiveMode={isLiveMode} />
        )}
      </main>
    </div>
  );
}

function WaitingForFrames({ isLiveMode }: { isLiveMode: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
      {isLiveMode ? (
        <>
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <p className="text-sm">Waiting for CAN frames...</p>
        </>
      ) : (
        <p className="text-sm">No frames to display.</p>
      )}
    </div>
  );
}
