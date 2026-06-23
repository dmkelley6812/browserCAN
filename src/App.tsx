import { useState, useMemo, useCallback } from "react";
import { parseGvretCsv, buildIdSummaries } from "./utils/parseGvret";
import type { CanIdSummary } from "./types";
import FileUpload from "./components/FileUpload";
import TableView from "./components/TableView";
import GraphView from "./components/GraphView";

type Tab = "table" | "graph";

export default function App() {
  const [summaries, setSummaries] = useState<CanIdSummary[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("table");
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const [filterIds, setFilterIds] = useState<Set<number>>(new Set());

  function handleFile(text: string, name: string) {
    try {
      const frames = parseGvretCsv(text);
      if (frames.length === 0) {
        setError(
          "No valid frames found. Check that the file is in GVRET CSV format.",
        );
        return;
      }
      setSummaries(buildIdSummaries(frames));
      setFileName(name);
      setError(null);
    } catch (e) {
      setError(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
    }
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
    if (!summaries) return null;
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

  if (!summaries) {
    return (
      <>
        {error && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-rose-900/80 border border-rose-700 text-rose-200 text-sm px-4 py-2 rounded-lg z-50">
            {error}
          </div>
        )}
        <FileUpload onFile={handleFile} />
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

        {/* File info */}
        <div className="flex items-center gap-2 text-xs text-slate-500 border-l border-slate-700 pl-4">
          <span className="text-slate-400">{fileName}</span>
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
            <span>
              <span className="text-slate-300">
                {(stats.durationMs / 1000).toFixed(2)}s
              </span>{" "}
              capture
            </span>
          </div>
        )}

        {/* Clear */}
        <button
          onClick={() => {
            setSummaries(null);
            setHighlightedIds(new Set());
            setFilterIds(new Set());
          }}
          className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
        >
          Load new file
        </button>
      </header>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-slate-800 flex-shrink-0 bg-slate-900/40">
        {(["table", "graph"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`
              px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize
              ${
                activeTab === tab
                  ? "bg-sky-600/20 text-sky-300 border border-sky-700/50"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
              }
            `}
          >
            {tab === "table" ? "Frame Table" : "Graph View"}
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
          <TableView
            summaries={summaries}
            highlightedIds={highlightedIds}
            onToggleHighlight={toggleHighlight}
            filterIds={filterIds}
            onToggleFilter={toggleFilter}
          />
        ) : (
          <GraphView
            summaries={summaries}
            highlightedIds={highlightedIds}
            filterIds={filterIds}
          />
        )}
      </main>
    </div>
  );
}
