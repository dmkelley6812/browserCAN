import { useState, useMemo } from 'react'
import type { CanIdSummary } from '../types'
import CanIdRow from './CanIdRow'

interface Props {
  summaries: CanIdSummary[]
  highlightedIds: Set<number>
  filterIds: Set<number>
}

export default function GraphView({ summaries, highlightedIds, filterIds }: Props) {
  const [expandAll, setExpandAll] = useState(false)
  const [hideStatic, setHideStatic] = useState(false)
  const [showOnlyFiltered, setShowOnlyFiltered] = useState(filterIds.size > 0)
  const [searchTerm, setSearchTerm] = useState('')
  // Track global expand key so we can reset individual row state
  const [expandKey, setExpandKey] = useState(0)

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
        ) : (
          visible.map((s) => (
            <CanIdRow
              key={`${s.id}-${expandKey}`}
              summary={s}
              isHighlighted={highlightedIds.has(s.id)}
              defaultExpanded={expandAll}
            />
          ))
        )}
      </div>
    </div>
  )
}
