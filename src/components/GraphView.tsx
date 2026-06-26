import { useState, useMemo } from 'react'
import { useSessionState } from '../hooks/useSessionState'
import type { CanIdSummary } from '../types'
import CanIdRow from './CanIdRow'

interface Props {
  summaries: CanIdSummary[]
  highlightedIds: Set<number>
  filterIds: Set<number>
  onOpenBuilder: (seed: { id: number; extended: boolean; bytes: number[] }) => void
}

export default function GraphView({ summaries, highlightedIds, filterIds, onOpenBuilder }: Props) {
  const [expandAll, setExpandAll] = useState(false)
  const [hideStatic, setHideStatic] = useSessionState('canvision-graph-hide-static', false)
  const [showOnlyFiltered, setShowOnlyFiltered] = useState(filterIds.size > 0)
  const [searchTerm, setSearchTerm] = useSessionState('canvision-graph-search', '')
  // Track global expand key so we can reset individual row state
  const [expandKey, setExpandKey] = useState(0)
  const [groupByFreq, setGroupByFreq] = useSessionState('canvision-graph-groupbyfreq', false)
  const [collapsedFreqGroups, setCollapsedFreqGroups] = useState<Set<'high' | 'medium' | 'low'>>(new Set())

  const visible = useMemo(() => {
    let list = summaries
    if (hideStatic) list = list.filter((s) => s.isChanging)
    if (showOnlyFiltered && filterIds.size > 0)
      list = list.filter((s) => filterIds.has(s.id))
    if (searchTerm) {
      const t = searchTerm.toLowerCase()
      list = list.filter(
        (s) => s.idHex.toLowerCase().includes(t) || s.id.toString().includes(t),
      )
    }
    return list
  }, [summaries, hideStatic, showOnlyFiltered, filterIds, searchTerm])

  function handleExpandAll() {
    setExpandAll(true)
    setExpandKey((k) => k + 1)
  }

  function handleCollapseAll() {
    setExpandAll(false)
    setExpandKey((k) => k + 1)
  }

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

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-800 flex-shrink-0">
        <input
          type="text"
          placeholder="Search ID…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-accent-500 w-48"
        />

        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideStatic}
            onChange={(e) => setHideStatic(e.target.checked)}
            className="accent-sky-500"
          />
          Hide static
        </label>

        {filterIds.size > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnlyFiltered}
              onChange={(e) => setShowOnlyFiltered(e.target.checked)}
              className="accent-sky-500"
            />
            Pinned only ({filterIds.size})
          </label>
        )}

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

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-500">{visible.length} IDs</span>
          <button
            onClick={handleExpandAll}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
          >
            Expand all
          </button>
          <button
            onClick={handleCollapseAll}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
          >
            Collapse all
          </button>
        </div>
      </div>

      {/* Scrollable rows */}
      <div className="overflow-y-auto flex-1 p-4">
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-slate-500">
            No IDs match current filters
          </div>
        ) : groupByFreq ? (
          FREQ_BANDS.flatMap(({ key, label, color }) => {
            const items = visible.filter(s => freqBand(getGroupHz(s)) === key)
            if (items.length === 0) return []
            const collapsed = collapsedFreqGroups.has(key)
            return [
              <div
                key={`grp-${key}`}
                className="flex items-center gap-2 px-1 py-2 mb-1 border-b border-slate-800/60 cursor-pointer hover:bg-slate-800/20 transition-colors select-none"
                onClick={() => toggleFreqGroup(key)}
              >
                <span className="text-slate-600 text-[10px]">{collapsed ? '▶' : '▼'}</span>
                <span className={`text-sm font-semibold ${color}`}>{label}</span>
                <span className="text-xs text-slate-600">· {items.length} ID{items.length !== 1 ? 's' : ''}</span>
              </div>,
              ...(collapsed
                ? []
                : items.map(s => (
                    <CanIdRow
                      key={`${s.id}-${expandKey}`}
                      summary={s}
                      isHighlighted={highlightedIds.has(s.id)}
                      defaultExpanded={expandAll}
                      onOpenBuilder={onOpenBuilder}
                    />
                  ))
              ),
            ]
          })
        ) : (
          visible.map((s) => (
            <CanIdRow
              key={`${s.id}-${expandKey}`}
              summary={s}
              isHighlighted={highlightedIds.has(s.id)}
              defaultExpanded={expandAll}
              onOpenBuilder={onOpenBuilder}
            />
          ))
        )}
      </div>
    </div>
  )
}
