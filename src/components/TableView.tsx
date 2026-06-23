import { useState, useMemo } from 'react'
import type { CanIdSummary } from '../types'

const BYTE_TEXT_COLORS = [
  'text-sky-400', 'text-emerald-400', 'text-violet-400', 'text-amber-400',
  'text-rose-400', 'text-cyan-400', 'text-lime-400', 'text-fuchsia-400',
]

const BIT_COLORS = [
  '#e879f9', '#818cf8', '#38bdf8', '#34d399',
  '#a3e635', '#fbbf24', '#fb923c', '#f87171',
]

// Bit grid for a single byte value — shows b7..b0 as colored squares
function ByteBitGrid({ value, byteIdx, changeMask }: { value: number; byteIdx: number; changeMask: boolean[] }) {
  return (
    <div className="flex gap-0.5 items-center">
      {Array.from({ length: 8 }, (_, pos) => {
        const bit = 7 - pos
        const isHigh = (value >> bit) & 1
        const everChanges = changeMask[byteIdx] // byte-level change indicator
        return (
          <div
            key={bit}
            title={`b${bit}: ${isHigh}`}
            className="relative group/bit"
          >
            <div
              style={{
                width: 7,
                height: 14,
                borderRadius: 2,
                background: isHigh
                  ? BIT_COLORS[pos]
                  : '#1e293b',
                opacity: (!everChanges && !isHigh) ? 0.4 : 1,
                border: `1px solid ${isHigh ? BIT_COLORS[pos] : '#334155'}`,
              }}
            />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/bit:block z-20 pointer-events-none">
              <div className="bg-slate-800 text-slate-200 text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap border border-slate-700">
                b{bit}={isHigh}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Expandable bit detail row for a single CAN ID
function BitDetailRow({ summary, bytes, maxDlc }: { summary: CanIdSummary; bytes: number[]; maxDlc: number }) {
  const byteCount = bytes.length
  return (
    <tr className="bg-slate-950/60 border-b border-slate-800/40">
      <td colSpan={8 + maxDlc} className="px-4 py-3">
        <div className="flex flex-wrap gap-4">
          {Array.from({ length: byteCount }, (_, i) => {
            const val = bytes[i] ?? 0
            const binStr = val.toString(2).padStart(8, '0')
            return (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-mono font-semibold ${BYTE_TEXT_COLORS[i % BYTE_TEXT_COLORS.length]}`}>
                    B{i + 1}
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    0x{val.toString(16).toUpperCase().padStart(2, '0')}
                  </span>
                  <span className="text-xs font-mono text-slate-600">{val}</span>
                </div>
                {/* Bit bars */}
                <ByteBitGrid value={val} byteIdx={i} changeMask={summary.byteChangeMask} />
                {/* Binary label */}
                <div className="flex gap-0.5">
                  {binStr.split('').map((bit, pos) => (
                    <span
                      key={pos}
                      className="text-[9px] font-mono w-[7px] text-center"
                      style={{ color: bit === '1' ? BIT_COLORS[pos] : '#475569' }}
                    >
                      {bit}
                    </span>
                  ))}
                </div>
                <div className="flex gap-0.5">
                  {Array.from({ length: 8 }, (_, pos) => (
                    <span key={pos} className="text-[9px] font-mono w-[7px] text-center text-slate-700">
                      {7 - pos}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </td>
    </tr>
  )
}

interface Props {
  summaries: CanIdSummary[]
  highlightedIds: Set<number>
  onToggleHighlight: (id: number) => void
  filterIds: Set<number>
  onToggleFilter: (id: number) => void
}

export default function TableView({
  summaries,
  highlightedIds,
  onToggleHighlight,
  filterIds,
  onToggleFilter,
}: Props) {
  const [hideStatic, setHideStatic] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortKey, setSortKey] = useState<'id' | 'count' | 'firstSeen'>('id')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [showOnlyFiltered, setShowOnlyFiltered] = useState(false)
  const [expandedBitRows, setExpandedBitRows] = useState<Set<number>>(new Set())

  const filtered = useMemo(() => {
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
    return [...list].sort((a, b) => {
      let av: number, bv: number
      if (sortKey === 'id') { av = a.id; bv = b.id }
      else if (sortKey === 'count') { av = a.frameCount; bv = b.frameCount }
      else { av = a.firstSeen; bv = b.firstSeen }
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [summaries, hideStatic, searchTerm, sortKey, sortDir, showOnlyFiltered, filterIds])

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  function toggleBitRow(id: number) {
    setExpandedBitRows((prev) => {
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

  const latestFrames = useMemo(() => {
    const map = new Map<number, number[]>()
    for (const s of summaries) {
      map.set(s.id, s.frames[s.frames.length - 1].bytes)
    }
    return map
  }, [summaries])

  const maxDlc = useMemo(() => {
    return summaries.reduce((max, s) => Math.max(max, s.dlc), 0)
  }, [summaries])

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-800">
        <input
          type="text"
          placeholder="Search ID (hex or decimal)…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 w-56"
        />
        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideStatic}
            onChange={(e) => setHideStatic(e.target.checked)}
            className="accent-sky-500"
          />
          Hide static IDs
        </label>
        {filterIds.size > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnlyFiltered}
              onChange={(e) => setShowOnlyFiltered(e.target.checked)}
              className="accent-sky-500"
            />
            Show selected only ({filterIds.size})
          </label>
        )}
        {expandedBitRows.size > 0 && (
          <button
            onClick={() => setExpandedBitRows(new Set())}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            Collapse all bits
          </button>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {filtered.length} / {summaries.length} IDs
        </span>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
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
                <th
                  key={i}
                  className={`px-3 py-2.5 text-left font-medium font-mono text-xs ${BYTE_TEXT_COLORS[i % BYTE_TEXT_COLORS.length]}`}
                >
                  B{i + 1}
                </th>
              ))}
              <th className="px-3 py-2.5 text-left font-medium w-16">Bits</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const isHighlighted = highlightedIds.has(s.id)
              const isPinned = filterIds.has(s.id)
              const bitsOpen = expandedBitRows.has(s.id)
              const bytes = latestFrames.get(s.id) ?? s.minBytes
              return (
                <>
                  <tr
                    key={s.id}
                    onClick={() => onToggleHighlight(s.id)}
                    className={`
                      border-b border-slate-800/60 cursor-pointer transition-colors
                      ${isHighlighted ? 'bg-sky-900/30 hover:bg-sky-900/40' : 'hover:bg-slate-800/50'}
                      ${bitsOpen ? 'border-b-0' : ''}
                    `}
                  >
                    {/* Pin */}
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onToggleFilter(s.id)}
                        title={isPinned ? 'Remove filter' : 'Filter to this ID'}
                        className={`w-6 h-6 rounded text-xs transition-colors ${
                          isPinned
                            ? 'bg-sky-500 text-white'
                            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                        }`}
                      >
                        {isPinned ? '★' : '☆'}
                      </button>
                    </td>

                    {/* CAN ID */}
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

                    {/* Status */}
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

                    {/* Per-byte columns */}
                    {Array.from({ length: maxDlc }, (_, i) => {
                      const b = bytes[i]
                      const exists = i < s.dlc
                      return (
                        <td key={i} className="px-3 py-2 font-mono">
                          {exists ? (
                            <span
                              className={`text-xs ${
                                s.byteChangeMask[i] ? BYTE_TEXT_COLORS[i % BYTE_TEXT_COLORS.length] : 'text-slate-600'
                              }`}
                              title={`B${i + 1}: ${b} (${b})`}
                            >
                              {b.toString(16).toUpperCase().padStart(2, '0')}
                            </span>
                          ) : null}
                        </td>
                      )
                    })}

                    {/* Bit expand toggle */}
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleBitRow(s.id)}
                        title="Toggle bit breakdown"
                        className={`
                          text-xs px-2 py-1 rounded-md border transition-colors
                          ${bitsOpen
                            ? 'bg-fuchsia-900/40 border-fuchsia-700 text-fuchsia-300'
                            : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                          }
                        `}
                      >
                        {bitsOpen ? '▲' : '▼'} bits
                      </button>
                    </td>
                  </tr>

                  {/* Expandable bit detail row */}
                  {bitsOpen && (
                    <BitDetailRow key={`bits-${s.id}`} summary={s} bytes={bytes} maxDlc={maxDlc} />
                  )}
                </>
              )
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-48 text-slate-500">
            No IDs match current filters
          </div>
        )}
      </div>
    </div>
  )
}
