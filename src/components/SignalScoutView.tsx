import { useState, useRef, useMemo, useEffect } from 'react'
import type { CanIdSummary } from '../types'

type SortField = 'id' | 'hz' | 'count'
type SortDir = 'asc' | 'desc'

// Same color mapping as TableView so byte columns feel consistent
const BYTE_COLORS = [
  'text-sky-400', 'text-emerald-400', 'text-violet-400', 'text-amber-400',
  'text-rose-400', 'text-cyan-400', 'text-lime-400', 'text-fuchsia-400',
]

interface SummaryWithHz extends CanIdSummary {
  hz: number
}

interface Props {
  summaries: CanIdSummary[]
  isLiveMode: boolean
}

export default function SignalScoutView({ summaries, isLiveMode }: Props) {
  const [sortField, setSortField] = useState<SortField>('id')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [minHz, setMinHz] = useState('')
  const [maxHz, setMaxHz] = useState('')
  const [changingOnly, setChangingOnly] = useState(false)

  // Read prev bytes during render, write after commit — clean React pattern
  const prevBytesRef = useRef<Map<number, number[]>>(new Map())

  const changedMap = useMemo(() => {
    const map = new Map<number, boolean[]>()
    for (const s of summaries) {
      const last = s.frames[s.frames.length - 1]
      if (!last) continue
      const prev = prevBytesRef.current.get(s.id)
      if (prev) {
        map.set(s.id, last.bytes.map((b, i) => b !== prev[i]))
      }
    }
    return map
  }, [summaries])

  useEffect(() => {
    for (const s of summaries) {
      const last = s.frames[s.frames.length - 1]
      if (last) prevBytesRef.current.set(s.id, [...last.bytes])
    }
  }, [summaries])

  const summariesWithHz = useMemo<SummaryWithHz[]>(() => {
    return summaries.map(s => {
      // Hz only meaningful in live mode (file timestamps may be sequential integers)
      const dMs = s.lastSeen - s.firstSeen
      const hz = isLiveMode && dMs > 100 ? s.frameCount / (dMs / 1000) : 0
      return { ...s, hz }
    })
  }, [summaries, isLiveMode])

  const filtered = useMemo(() => {
    let r = summariesWithHz
    const lo = parseFloat(minHz)
    const hi = parseFloat(maxHz)
    if (isLiveMode && !isNaN(lo)) r = r.filter(s => s.hz >= lo)
    if (isLiveMode && !isNaN(hi)) r = r.filter(s => s.hz <= hi)
    if (changingOnly) r = r.filter(s => s.isChanging)
    return r
  }, [summariesWithHz, minHz, maxHz, changingOnly, isLiveMode])

  const sorted = useMemo(() => {
    const f = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortField === 'hz') return f * (a.hz - b.hz)
      if (sortField === 'count') return f * (a.frameCount - b.frameCount)
      return f * (a.id - b.id)
    })
  }, [filtered, sortField, sortDir])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'id' ? 'asc' : 'desc')
    }
  }

  function SortArrow({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="text-slate-700 ml-0.5">↕</span>
    return <span className="text-sky-400 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  function formatHz(hz: number): string {
    if (!isLiveMode) return '—'
    if (hz === 0) return '—'
    if (hz >= 1000) return `${(hz / 1000).toFixed(1)}k`
    if (hz >= 1) return hz.toFixed(1)
    return `${(hz * 1000).toFixed(0)}m`
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter / control bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-slate-800 bg-slate-900/40 flex-shrink-0 flex-wrap">
        <span className="text-xs text-slate-500">
          <span className="text-slate-300">{sorted.length}</span>
          {summaries.length !== sorted.length && (
            <span className="text-slate-600"> / {summaries.length}</span>
          )}{' '}
          IDs
        </span>

        {/* Hz range filter — only meaningful in live mode */}
        {isLiveMode && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Hz</span>
            <input
              type="number"
              min="0"
              placeholder="min"
              value={minHz}
              onChange={e => setMinHz(e.target.value)}
              className="w-16 text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-sky-700"
            />
            <span className="text-slate-700">–</span>
            <input
              type="number"
              min="0"
              placeholder="max"
              value={maxHz}
              onChange={e => setMaxHz(e.target.value)}
              className="w-16 text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-sky-700"
            />
          </div>
        )}

        {/* Active only toggle */}
        <button
          onClick={() => setChangingOnly(c => !c)}
          className={`text-xs px-3 py-1 rounded-lg border transition-colors ${
            changingOnly
              ? 'bg-sky-600/20 border-sky-700/50 text-sky-300'
              : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
          }`}
        >
          Active only
        </button>

        {/* Live legend */}
        {isLiveMode && (
          <span className="ml-auto flex items-center gap-2 text-xs text-slate-600">
            <span className="inline-block w-3 h-3 rounded-sm bg-yellow-500/30 border border-yellow-600/30" />
            changed
            <span className="inline-block w-3 h-3 rounded-sm bg-slate-800 border border-slate-700 ml-2" />
            static
          </span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-900 text-slate-500">
              <th
                className="px-4 py-2 text-left font-medium cursor-pointer hover:text-slate-300 border-b border-slate-800 whitespace-nowrap select-none"
                onClick={() => handleSort('id')}
              >
                CAN ID <SortArrow field="id" />
              </th>
              <th className="px-3 py-2 text-center font-medium border-b border-slate-800 text-slate-600 whitespace-nowrap">
                DLC
              </th>
              <th
                className="px-3 py-2 text-right font-medium cursor-pointer hover:text-slate-300 border-b border-slate-800 whitespace-nowrap select-none"
                onClick={() => handleSort('hz')}
              >
                Hz <SortArrow field="hz" />
              </th>
              <th
                className="px-3 py-2 text-right font-medium cursor-pointer hover:text-slate-300 border-b border-slate-800 whitespace-nowrap select-none"
                onClick={() => handleSort('count')}
              >
                Count <SortArrow field="count" />
              </th>
              {Array.from({ length: 8 }, (_, i) => (
                <th
                  key={i}
                  className={`px-2 py-2 text-center font-medium border-b border-slate-800 w-10 ${BYTE_COLORS[i]}/40`}
                >
                  D{i}
                </th>
              ))}
              <th className="px-3 py-2 border-b border-slate-800 w-8" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => {
              const last = s.frames[s.frames.length - 1]
              const bytes = last?.bytes ?? Array(8).fill(0)
              const changed = changedMap.get(s.id) ?? Array(8).fill(false)

              return (
                <tr
                  key={s.id}
                  className="hover:bg-slate-800/30 transition-colors group border-b border-slate-800/40"
                >
                  {/* ID */}
                  <td className="px-4 py-1.5 font-mono text-sky-300 whitespace-nowrap border-b border-slate-800/30">
                    {s.idHex}
                    {s.frames[0]?.extended && (
                      <span className="ml-1.5 text-[10px] text-slate-600 font-normal">ext</span>
                    )}
                  </td>

                  {/* DLC */}
                  <td className="px-3 py-1.5 text-center font-mono text-slate-600 border-b border-slate-800/30">
                    {s.dlc}
                  </td>

                  {/* Hz */}
                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-b border-slate-800/30 ${s.isChanging && isLiveMode ? 'text-slate-300' : 'text-slate-600'}`}>
                    {formatHz((s as SummaryWithHz).hz)}
                  </td>

                  {/* Frame count */}
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-b border-slate-800/30">
                    {s.frameCount.toLocaleString()}
                  </td>

                  {/* Byte cells */}
                  {Array.from({ length: 8 }, (_, i) => {
                    const b = bytes[i] ?? 0
                    const isActive = isLiveMode && changed[i]
                    const isStatic = !s.byteChangeMask[i]
                    const inRange = i < s.dlc

                    return (
                      <td
                        key={i}
                        className={`
                          px-1 py-1.5 text-center font-mono tabular-nums w-10
                          transition-colors duration-100 border-b border-slate-800/30
                          ${!inRange
                            ? 'text-slate-800'
                            : isActive
                              ? 'bg-yellow-500/20 text-yellow-100 font-semibold'
                              : isStatic
                                ? 'text-slate-700'
                                : BYTE_COLORS[i]
                          }
                        `}
                      >
                        {inRange ? b.toString(16).toUpperCase().padStart(2, '0') : '··'}
                      </td>
                    )
                  })}

                  {/* Stub builder button — visible on row hover */}
                  <td className="px-2 py-1.5 border-b border-slate-800/30">
                    <button
                      title="Frame Builder — coming soon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-sky-400 px-1.5 py-0.5 rounded border border-transparent hover:border-sky-900 text-[11px] leading-none"
                      onClick={() => {/* wired up when Frame Builder is implemented */}}
                    >
                      →
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-600 text-sm">
            {summaries.length === 0
              ? isLiveMode
                ? <>
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Waiting for CAN frames...</span>
                  </>
                : <span>No CAN data loaded.</span>
              : <span>No IDs match the current filters.</span>
            }
          </div>
        )}
      </div>
    </div>
  )
}
