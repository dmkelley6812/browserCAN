import { useState, useMemo, useRef } from 'react'
import { useSessionState } from '../hooks/useSessionState'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { CanFrame, CanIdSummary } from '../types'

type ViewMode = 'raw' | 'condensed'

const BYTE_TEXT_COLORS = [
  'text-sky-400', 'text-emerald-400', 'text-violet-400', 'text-amber-400',
  'text-rose-400', 'text-cyan-400', 'text-lime-400', 'text-fuchsia-400',
]

function FrameSubTable({ frames, maxDlc }: { frames: CanFrame[]; maxDlc: number }) {
  return (
    <tr className="bg-slate-950/60 border-b border-slate-800/40">
      <td colSpan={100} className="px-4 py-2">
        <div className="max-h-48 overflow-y-auto border border-slate-800 rounded">
          <table className="w-full text-xs font-mono border-collapse">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="text-slate-500">
                <th className="text-left px-2 py-1 font-medium">Time (ms)</th>
                {Array.from({ length: maxDlc }, (_, i) => (
                  <th key={i} className={`text-left px-2 py-1 font-medium ${BYTE_TEXT_COLORS[i % BYTE_TEXT_COLORS.length]}`}>
                    B{i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {frames.map((f, i) => (
                <tr key={i} className={`border-t border-slate-800/30 hover:bg-slate-800/20 ${i % 2 !== 0 ? 'bg-slate-900/20' : ''}`}>
                  <td className="px-2 py-0.5 text-slate-400">{f.timestamp.toLocaleString()}</td>
                  {Array.from({ length: maxDlc }, (_, bi) => (
                    <td key={bi} className={`px-2 py-0.5 ${bi < f.dlc ? BYTE_TEXT_COLORS[bi % BYTE_TEXT_COLORS.length] : 'text-slate-700'}`}>
                      {f.bytes[bi].toString(16).toUpperCase().padStart(2, '0')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-slate-600 mt-1">{frames.length.toLocaleString()} frames</div>
      </td>
    </tr>
  )
}

interface Props {
  frames: CanFrame[]
  summaries: CanIdSummary[]
  highlightedIds: Set<number>
  onToggleHighlight: (id: number) => void
  filterIds: Set<number>
  onToggleFilter: (id: number) => void
  onOpenBuilder: (seed: { id: number; extended: boolean; bytes: number[] }) => void
}

export default function TableView({
  frames,
  summaries,
  highlightedIds,
  onToggleHighlight,
  filterIds,
  onToggleFilter,
  onOpenBuilder,
}: Props) {
  const [viewMode, setViewMode] = useSessionState<ViewMode>('canvision-table-viewmode', 'raw')
  const [searchTerm, setSearchTerm] = useSessionState('canvision-table-search', '')
  const [showOnlyFiltered, setShowOnlyFiltered] = useSessionState('canvision-table-show-filtered', false)
  // Condensed-mode state
  const [hideStatic, setHideStatic] = useSessionState('canvision-table-hide-static', false)
  const [sortKey, setSortKey] = useSessionState<'id' | 'count' | 'firstSeen'>('canvision-table-sortkey', 'id')
  const [sortDir, setSortDir] = useSessionState<'asc' | 'desc'>('canvision-table-sortdir', 'asc')
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [groupByFreq, setGroupByFreq] = useSessionState('canvision-table-groupbyfreq', false)
  const [collapsedFreqGroups, setCollapsedFreqGroups] = useState<Set<'high' | 'medium' | 'low'>>(new Set())

  const maxDlc = useMemo(() => summaries.reduce((max, s) => Math.max(max, s.dlc), 0), [summaries])

  const filteredFrames = useMemo(() => {
    if (viewMode !== 'raw') return []
    let list = frames
    if (showOnlyFiltered && filterIds.size > 0)
      list = list.filter(f => filterIds.has(f.id))
    if (searchTerm) {
      const t = searchTerm.toLowerCase()
      list = list.filter(f => f.idHex.toLowerCase().includes(t) || f.id.toString().includes(t))
    }
    return list
  }, [viewMode, frames, searchTerm, showOnlyFiltered, filterIds])

  const filteredSummaries = useMemo(() => {
    if (viewMode !== 'condensed') return []
    let list = summaries
    if (hideStatic) list = list.filter(s => s.isChanging)
    if (showOnlyFiltered && filterIds.size > 0)
      list = list.filter(s => filterIds.has(s.id))
    if (searchTerm) {
      const t = searchTerm.toLowerCase()
      list = list.filter(s => s.idHex.toLowerCase().includes(t) || s.id.toString().includes(t))
    }
    return [...list].sort((a, b) => {
      let av: number, bv: number
      if (sortKey === 'id') { av = a.id; bv = b.id }
      else if (sortKey === 'count') { av = a.frameCount; bv = b.frameCount }
      else { av = a.firstSeen; bv = b.firstSeen }
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [viewMode, summaries, hideStatic, searchTerm, sortKey, sortDir, showOnlyFiltered, filterIds])

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function toggleExpand(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function SortIcon({ k }: { k: typeof sortKey }) {
    if (sortKey !== k) return <span className="ml-1 opacity-30">↕</span>
    return <span className="ml-1 text-sky-400">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: filteredFrames.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 15,
  })

  function getGroupHz(s: CanIdSummary): number {
    const dMs = s.lastSeen - s.firstSeen
    return dMs > 100 ? s.frameCount / (dMs / 1000) : 0
  }
  function freqBand(hz: number): 'high' | 'medium' | 'low' {
    if (hz >= 10) return 'high'
    if (hz >= 1) return 'medium'
    return 'low'
  }
  function toggleFreqGroup(g: 'high' | 'medium' | 'low') {
    setCollapsedFreqGroups(prev => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })
  }

  const FREQ_BANDS = [
    { key: 'high' as const, label: 'High  ≥10 Hz', color: 'text-red-400' },
    { key: 'medium' as const, label: 'Medium  1–10 Hz', color: 'text-amber-400' },
    { key: 'low' as const, label: 'Low  <1 Hz', color: 'text-slate-400' },
  ]

  function renderSummaryRow(s: CanIdSummary) {
    const isHighlighted = highlightedIds.has(s.id)
    const isPinned = filterIds.has(s.id)
    const isExpanded = expandedIds.has(s.id)
    const latestBytes = s.frames[s.frames.length - 1].bytes
    const rows = [
      <tr
        key={s.id}
        onClick={() => onToggleHighlight(s.id)}
        className={`border-b border-slate-800/60 cursor-pointer transition-colors
          ${isHighlighted ? 'bg-sky-900/30 hover:bg-sky-900/40' : 'hover:bg-slate-800/50'}
          ${isExpanded ? 'border-b-0' : ''}
        `}
      >
        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onToggleFilter(s.id)}
            title={isPinned ? 'Remove filter' : 'Filter to this ID'}
            className={`w-6 h-6 rounded text-xs transition-colors ${isPinned ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
          >
            {isPinned ? '★' : '☆'}
          </button>
        </td>
        <td className="px-3 py-2 font-mono">
          <span className={`font-semibold ${isHighlighted ? 'text-sky-300' : 'text-slate-200'}`}>
            {s.idHex}
          </span>
          <span className="ml-2 text-slate-500 text-xs">({s.id})</span>
        </td>
        <td className="px-3 py-2 font-mono text-slate-300">{s.dlc}</td>
        <td className="px-3 py-2 font-mono text-slate-300">{s.frameCount.toLocaleString()}</td>
        <td className="px-3 py-2 font-mono text-slate-400 text-xs">{s.firstSeen.toLocaleString()}</td>
        <td className="px-3 py-2 font-mono text-slate-400 text-xs">{s.lastSeen.toLocaleString()}</td>
        <td className="px-3 py-2">
          {s.isChanging ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-900/50 text-emerald-400 border border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-800 text-slate-500 border border-slate-700">
              static
            </span>
          )}
        </td>
        {Array.from({ length: maxDlc }, (_, i) => {
          const b = latestBytes[i]
          const exists = i < s.dlc
          return (
            <td key={i} className="px-3 py-2 font-mono">
              {exists ? (
                <span
                  className={`text-xs ${s.byteChangeMask[i] ? BYTE_TEXT_COLORS[i % BYTE_TEXT_COLORS.length] : 'text-slate-600'}`}
                  title={`B${i + 1}: 0x${b.toString(16).toUpperCase().padStart(2, '0')} (${b})`}
                >
                  {b.toString(16).toUpperCase().padStart(2, '0')}
                </span>
              ) : null}
            </td>
          )
        })}
        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleExpand(s.id)}
              title="Show all frames for this ID"
              className={`text-xs px-2 py-1 rounded-md border transition-colors ${isExpanded
                ? 'bg-sky-900/40 border-sky-700 text-sky-300'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'
              }`}
            >
              {isExpanded ? '▲' : '▼'}
            </button>
            <button
              onClick={() => onOpenBuilder({ id: s.id, extended: s.frames[0]?.extended ?? false, bytes: s.frames[s.frames.length - 1].bytes })}
              title="Open in Frame Builder"
              className="text-xs px-2 py-1 rounded-md border bg-slate-800 border-slate-700 text-slate-500 hover:text-violet-400 hover:border-violet-900 transition-colors"
            >
              →
            </button>
          </div>
        </td>
      </tr>,
    ]
    if (isExpanded) {
      rows.push(<FrameSubTable key={`sub-${s.id}`} frames={s.frames} maxDlc={maxDlc} />)
    }
    return rows
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-800">
        {/* View mode toggle */}
        <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
          <button
            onClick={() => setViewMode('raw')}
            className={`px-3 py-1.5 transition-colors ${viewMode === 'raw' ? 'bg-sky-600/30 text-sky-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
          >
            All Frames
          </button>
          <button
            onClick={() => setViewMode('condensed')}
            className={`px-3 py-1.5 border-l border-slate-700 transition-colors ${viewMode === 'condensed' ? 'bg-sky-600/30 text-sky-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
          >
            By ID
          </button>
        </div>

        <input
          type="text"
          placeholder="Search ID (hex or decimal)…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 w-56"
        />

        {viewMode === 'condensed' && (
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideStatic}
              onChange={e => setHideStatic(e.target.checked)}
              className="accent-sky-500"
            />
            Hide static IDs
          </label>
        )}

        {filterIds.size > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnlyFiltered}
              onChange={e => setShowOnlyFiltered(e.target.checked)}
              className="accent-sky-500"
            />
            Show selected only ({filterIds.size})
          </label>
        )}

        {viewMode === 'condensed' && expandedIds.size > 0 && (
          <button
            onClick={() => setExpandedIds(new Set())}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            Collapse all
          </button>
        )}

        {viewMode === 'condensed' && (
          <button
            onClick={() => setGroupByFreq(g => !g)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              groupByFreq
                ? 'bg-indigo-600/20 border-indigo-700/50 text-indigo-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
            }`}
          >
            Group by Hz
          </button>
        )}

        <span className="ml-auto text-xs text-slate-500">
          {viewMode === 'raw'
            ? `${filteredFrames.length.toLocaleString()} / ${frames.length.toLocaleString()} frames`
            : `${filteredSummaries.length} / ${summaries.length} IDs`
          }
        </span>
      </div>

      {/* Table */}
      <div ref={scrollRef} className="overflow-auto flex-1">
        {viewMode === 'raw' ? (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-900 text-slate-400">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium text-slate-600 w-16">#</th>
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Time (ms)</th>
                <th className="px-3 py-2.5 text-left font-medium">CAN ID</th>
                <th className="px-3 py-2.5 text-left font-medium">DLC</th>
                {Array.from({ length: maxDlc }, (_, i) => (
                  <th key={i} className={`px-3 py-2.5 text-left font-medium font-mono text-xs ${BYTE_TEXT_COLORS[i % BYTE_TEXT_COLORS.length]}`}>
                    B{i + 1}
                  </th>
                ))}
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {(() => {
                const items = virtualizer.getVirtualItems()
                const paddingTop = items.length > 0 ? items[0].start : 0
                const paddingBottom = items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0
                const colSpan = 4 + maxDlc
                return (
                  <>
                    {paddingTop > 0 && <tr><td style={{ height: paddingTop }} colSpan={colSpan} /></tr>}
                    {items.map(vi => {
                      const f = filteredFrames[vi.index]
                      const isHighlighted = highlightedIds.has(f.id)
                      return (
                        <tr
                          key={vi.index}
                          onClick={() => onToggleHighlight(f.id)}
                          className={`group border-b border-slate-800/40 cursor-pointer transition-colors
                            ${isHighlighted ? 'bg-sky-900/20 hover:bg-sky-900/30' : 'hover:bg-slate-800/30'}
                          `}
                        >
                          <td className="px-3 py-1.5 font-mono text-slate-600 text-xs">{vi.index + 1}</td>
                          <td className="px-3 py-1.5 font-mono text-slate-400 text-xs">{f.timestamp.toLocaleString()}</td>
                          <td className="px-3 py-1.5 font-mono">
                            <span className={`font-semibold ${isHighlighted ? 'text-sky-300' : 'text-slate-200'}`}>
                              {f.idHex}
                            </span>
                            <span className="ml-2 text-slate-600 text-xs">({f.id})</span>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-slate-400">{f.dlc}</td>
                          {Array.from({ length: maxDlc }, (_, bi) => (
                            <td key={bi} className="px-3 py-1.5 font-mono">
                              {bi < f.bytes.length ? (
                                <span className={`text-xs ${bi < f.dlc ? BYTE_TEXT_COLORS[bi % BYTE_TEXT_COLORS.length] : 'text-slate-600'}`}
                                  title={bi >= f.dlc ? 'beyond DLC — CSV padding' : undefined}>
                                  {f.bytes[bi].toString(16).toUpperCase().padStart(2, '0')}
                                </span>
                              ) : null}
                            </td>
                          ))}
                          <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => onOpenBuilder({ id: f.id, extended: f.extended, bytes: f.bytes.slice(0, f.dlc) })}
                              title="Open in Frame Builder"
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-violet-400 px-1.5 py-0.5 rounded border border-transparent hover:border-violet-900 text-[11px] leading-none"
                            >
                              →
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    {paddingBottom > 0 && <tr><td style={{ height: paddingBottom }} colSpan={colSpan} /></tr>}
                  </>
                )
              })()}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-900 text-slate-400">
              <tr>
                <th className="w-10 px-3 py-2.5 text-left font-medium">Pin</th>
                <th
                  className="px-3 py-2.5 text-left font-medium cursor-pointer hover:text-slate-200 whitespace-nowrap"
                  onClick={() => toggleSort('id')}
                >
                  CAN ID <SortIcon k="id" />
                </th>
                <th className="px-3 py-2.5 text-left font-medium">DLC</th>
                <th
                  className="px-3 py-2.5 text-left font-medium cursor-pointer hover:text-slate-200 whitespace-nowrap"
                  onClick={() => toggleSort('count')}
                >
                  Frames <SortIcon k="count" />
                </th>
                <th
                  className="px-3 py-2.5 text-left font-medium cursor-pointer hover:text-slate-200 whitespace-nowrap"
                  onClick={() => toggleSort('firstSeen')}
                >
                  First (ms) <SortIcon k="firstSeen" />
                </th>
                <th className="px-3 py-2.5 text-left font-medium">Last (ms)</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
                {Array.from({ length: maxDlc }, (_, i) => (
                  <th key={i} className={`px-3 py-2.5 text-left font-medium font-mono text-xs ${BYTE_TEXT_COLORS[i % BYTE_TEXT_COLORS.length]}`}>
                    B{i + 1}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-left font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {(groupByFreq
                ? FREQ_BANDS.flatMap(({ key, label, color }) => {
                    const items = filteredSummaries.filter(s => freqBand(getGroupHz(s)) === key)
                    if (items.length === 0) return []
                    const collapsed = collapsedFreqGroups.has(key)
                    return [
                      <tr key={`grp-${key}`}>
                        <td colSpan={100} className="px-3 py-1.5 bg-slate-950/60 border-b border-slate-800/60">
                          <button
                            onClick={() => toggleFreqGroup(key)}
                            className="flex items-center gap-2 text-xs w-full text-left hover:text-slate-200 transition-colors select-none"
                          >
                            <span className="text-slate-600 text-[10px]">{collapsed ? '▶' : '▼'}</span>
                            <span className={`font-semibold ${color}`}>{label}</span>
                            <span className="text-slate-600">· {items.length} ID{items.length !== 1 ? 's' : ''}</span>
                          </button>
                        </td>
                      </tr>,
                      ...(collapsed ? [] : items.flatMap(renderSummaryRow)),
                    ]
                  })
                : filteredSummaries.flatMap(renderSummaryRow)
              )}
            </tbody>
          </table>
        )}

        {viewMode === 'raw' && filteredFrames.length === 0 && (
          <div className="flex items-center justify-center h-48 text-slate-500">
            No frames match current filters
          </div>
        )}
        {viewMode === 'condensed' && filteredSummaries.length === 0 && (
          <div className="flex items-center justify-center h-48 text-slate-500">
            No IDs match current filters
          </div>
        )}
      </div>
    </div>
  )
}
