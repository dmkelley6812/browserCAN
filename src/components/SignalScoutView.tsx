import { useState, useRef, useMemo, useEffect } from 'react'
import type { CanIdSummary } from '../types'

type SortField = 'id' | 'hz' | 'count' | 'activity' | 'burst'
type SortDir = 'asc' | 'desc'
type BurstWindow = 1 | 2 | 5 | 10

const BURST_WINDOWS: BurstWindow[] = [1, 2, 5, 10]

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

  // Feature 2: Snapshot / delta mode
  const [snapshot, setSnapshot] = useState<Map<number, number[]> | null>(null)

  // Feature 3: Burst counter
  const [burstEnabled, setBurstEnabled] = useState(false)
  const [burstWindowSec, setBurstWindowSec] = useState<BurstWindow>(2)

  // Ignore list: hide individual IDs from the table
  const [ignoredIds, setIgnoredIds] = useState<Set<number>>(new Set())

  const prevBytesRef = useRef<Map<number, number[]>>(new Map())
  // Feature 1: tracks when each ID last had a byte change (for float-to-top sort)
  const lastChangedAtMap = useRef<Map<number, number>>(new Map())
  // Feature 3: ring of change-event timestamps per ID for burst counting
  const burstHistory = useRef<Map<number, number[]>>(new Map())

  // Compute per-byte change flags for live flash highlighting
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

  // After commit: update prevBytes, lastChangedAt, and burstHistory
  useEffect(() => {
    const now = Date.now()
    for (const s of summaries) {
      const last = s.frames[s.frames.length - 1]
      if (!last) continue
      const prev = prevBytesRef.current.get(s.id)
      if (prev && last.bytes.some((b, i) => b !== prev[i])) {
        lastChangedAtMap.current.set(s.id, now)
        const hist = burstHistory.current.get(s.id) ?? []
        hist.push(now)
        burstHistory.current.set(s.id, hist)
      }
      prevBytesRef.current.set(s.id, [...last.bytes])
    }
  }, [summaries])

  const summariesWithHz = useMemo<SummaryWithHz[]>(() => {
    return summaries.map(s => {
      const dMs = s.lastSeen - s.firstSeen
      const hz = isLiveMode && dMs > 100 ? s.frameCount / (dMs / 1000) : 0
      return { ...s, hz }
    })
  }, [summaries, isLiveMode])

  // Feature 2: per-byte diff against snapshot baseline
  const snapshotDiffMap = useMemo(() => {
    if (!snapshot) return new Map<number, boolean[]>()
    const map = new Map<number, boolean[]>()
    for (const s of summaries) {
      const snapped = snapshot.get(s.id)
      if (!snapped) continue
      const last = s.frames[s.frames.length - 1]
      if (!last) continue
      map.set(s.id, last.bytes.map((b, i) => snapped[i] !== undefined && b !== snapped[i]))
    }
    return map
  }, [summaries, snapshot])

  // Feature 3: count change events within the rolling window; prune old entries as a side effect
  const burstMap = useMemo(() => {
    const now = Date.now()
    const windowMs = burstWindowSec * 1000
    const map = new Map<number, number>()
    for (const s of summaries) {
      const hist = burstHistory.current.get(s.id) ?? []
      const recent = hist.filter(t => t > now - windowMs)
      burstHistory.current.set(s.id, recent)
      map.set(s.id, recent.length)
    }
    return map
  }, [summaries, burstWindowSec])

  const filtered = useMemo(() => {
    let r = summariesWithHz
    const lo = parseFloat(minHz)
    const hi = parseFloat(maxHz)
    r = r.filter(s => !ignoredIds.has(s.id))
    if (isLiveMode && !isNaN(lo)) r = r.filter(s => s.hz >= lo)
    if (isLiveMode && !isNaN(hi)) r = r.filter(s => s.hz <= hi)
    if (changingOnly) r = r.filter(s => s.isChanging)
    if (snapshot) {
      r = r.filter(s => {
        const snapped = snapshot.get(s.id)
        // IDs that appeared after the snapshot are new — show them
        if (!snapped) return true
        const last = s.frames[s.frames.length - 1]
        if (!last) return false
        return last.bytes.some((b, i) => b !== snapped[i])
      })
    }
    return r
  }, [summariesWithHz, minHz, maxHz, changingOnly, isLiveMode, snapshot])

  const sorted = useMemo(() => {
    // Activity sort reads lastChangedAtMap ref — re-runs whenever filtered changes (each frame batch)
    if (sortField === 'activity') {
      return [...filtered].sort((a, b) =>
        (lastChangedAtMap.current.get(b.id) ?? 0) - (lastChangedAtMap.current.get(a.id) ?? 0)
      )
    }
    if (sortField === 'burst') {
      return [...filtered].sort((a, b) => (burstMap.get(b.id) ?? 0) - (burstMap.get(a.id) ?? 0))
    }
    const f = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortField === 'hz') return f * (a.hz - b.hz)
      if (sortField === 'count') return f * (a.frameCount - b.frameCount)
      return f * (a.id - b.id)
    })
  }, [filtered, sortField, sortDir, burstMap])

  function handleSort(field: SortField) {
    if (sortField === field && field !== 'activity' && field !== 'burst') {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'id' ? 'asc' : 'desc')
    }
  }

  function toggleIgnore(id: number) {
    setIgnoredIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function takeSnapshot() {
    const map = new Map<number, number[]>()
    for (const s of summaries) {
      const last = s.frames[s.frames.length - 1]
      if (last) map.set(s.id, [...last.bytes])
    }
    setSnapshot(map)
  }

  const snapshotChangedCount = snapshot
    ? summaries.filter(s => {
        const snapped = snapshot.get(s.id)
        if (!snapped) return false
        const last = s.frames[s.frames.length - 1]
        if (!last) return false
        return last.bytes.some((b, i) => b !== snapped[i])
      }).length
    : 0

  function SortArrow({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="text-slate-700 ml-0.5">↕</span>
    if (field === 'activity' || field === 'burst') return <span className="text-sky-400 ml-0.5">↓</span>
    return <span className="text-sky-400 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  function formatHz(hz: number): string {
    if (!isLiveMode) return '—'
    if (hz === 0) return '—'
    if (hz >= 1000) return `${(hz / 1000).toFixed(1)}k`
    if (hz >= 1) return hz.toFixed(1)
    return `${(hz * 1000).toFixed(0)}m`
  }

  function burstHeatClass(count: number): string {
    if (count === 0) return 'text-slate-600'
    if (count < 3) return 'text-yellow-500'
    if (count < 8) return 'text-orange-400'
    return 'text-red-400'
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Control bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 bg-slate-900/40 flex-shrink-0 flex-wrap">
        <span className="text-xs text-slate-500">
          <span className="text-slate-300">{sorted.length}</span>
          {summaries.length !== sorted.length && (
            <span className="text-slate-600"> / {summaries.length}</span>
          )}{' '}
          IDs
        </span>

        {ignoredIds.size > 0 && (
          <div className="flex items-center">
            <span className="text-xs px-2 py-1 rounded-l-lg border border-r-0 bg-slate-800 border-slate-700 text-slate-500">
              {ignoredIds.size} hidden
            </span>
            <button
              onClick={() => setIgnoredIds(new Set())}
              title="Unhide all ignored IDs"
              className="text-xs px-2 py-1 rounded-r-lg bg-slate-800 border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-900 transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        {/* Hz range filter */}
        {isLiveMode && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Hz</span>
            <input
              type="number" min="0" placeholder="min" value={minHz}
              onChange={e => setMinHz(e.target.value)}
              className="w-16 text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-sky-700"
            />
            <span className="text-slate-700">–</span>
            <input
              type="number" min="0" placeholder="max" value={maxHz}
              onChange={e => setMaxHz(e.target.value)}
              className="w-16 text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-sky-700"
            />
          </div>
        )}

        {/* Active only */}
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

        {/* Feature 1: Float to top */}
        <button
          onClick={() => handleSort('activity')}
          title="Sort by most-recently-changed — active IDs float to top on each update"
          className={`text-xs px-3 py-1 rounded-lg border transition-colors ${
            sortField === 'activity'
              ? 'bg-emerald-600/20 border-emerald-700/50 text-emerald-300'
              : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
          }`}
        >
          Float to top
        </button>

        {/* Feature 2: Snapshot / delta mode */}
        {snapshot ? (
          <div className="flex items-center">
            <span className={`text-xs font-mono px-2 py-1 rounded-l-lg border border-r-0 ${
              snapshotChangedCount > 0
                ? 'bg-orange-500/15 border-orange-700/50 text-orange-300'
                : 'bg-slate-800 border-slate-700 text-slate-500'
            }`}>
              {snapshotChangedCount > 0 ? `${snapshotChangedCount} Δ` : 'no Δ'}
            </span>
            <button
              onClick={takeSnapshot}
              title="Re-snapshot current state as new baseline"
              className="text-xs px-2 py-1 bg-slate-800 border border-r-0 border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              ↺
            </button>
            <button
              onClick={() => setSnapshot(null)}
              title="Clear snapshot and exit delta mode"
              className="text-xs px-2 py-1 rounded-r-lg bg-slate-800 border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-900 transition-colors"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={takeSnapshot}
            title="Capture current byte values — delta mode then shows only IDs that change from this baseline"
            className="text-xs px-3 py-1 rounded-lg border bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors"
          >
            ⊙ Snapshot
          </button>
        )}

        {/* Feature 3: Burst counter window selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500 mr-0.5">Burst</span>
          <button
            onClick={() => setBurstEnabled(false)}
            className={`text-xs px-2 py-1 rounded-l-lg border border-r-0 transition-colors ${
              !burstEnabled
                ? 'bg-violet-600/20 border-violet-700/50 text-violet-300'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
            }`}
          >
            Off
          </button>
          {BURST_WINDOWS.map((w, i) => (
            <button
              key={w}
              onClick={() => { setBurstEnabled(true); setBurstWindowSec(w) }}
              className={`text-xs px-2 py-1 border border-r-0 transition-colors ${
                i === BURST_WINDOWS.length - 1 ? 'rounded-r-lg border-r' : ''
              } ${
                burstEnabled && burstWindowSec === w
                  ? 'bg-violet-600/20 border-violet-700/50 text-violet-300'
                  : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              {w}s
            </button>
          ))}
        </div>

        {/* Legend */}
        {isLiveMode && (
          <span className="ml-auto flex items-center gap-2 text-xs text-slate-600">
            <span className="inline-block w-3 h-3 rounded-sm bg-yellow-500/30 border border-yellow-600/30" />
            live Δ
            {snapshot && <>
              <span className="inline-block w-3 h-3 rounded-sm bg-orange-500/30 border border-orange-600/30 ml-1" />
              snap Δ
            </>}
            <span className="inline-block w-3 h-3 rounded-sm bg-slate-800 border border-slate-700 ml-1" />
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
              {burstEnabled && (
                <th
                  className="px-3 py-2 text-right font-medium cursor-pointer hover:text-slate-300 border-b border-slate-800 whitespace-nowrap select-none text-violet-500/70"
                  onClick={() => handleSort('burst')}
                >
                  Burst <SortArrow field="burst" />
                </th>
              )}
              {Array.from({ length: 8 }, (_, i) => (
                <th
                  key={i}
                  className={`px-2 py-2 text-center font-medium border-b border-slate-800 w-10 ${BYTE_COLORS[i]}/40`}
                >
                  D{i}
                </th>
              ))}
              <th className="px-3 py-2 border-b border-slate-800 w-14" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => {
              const last = s.frames[s.frames.length - 1]
              const bytes = last?.bytes ?? Array(8).fill(0)
              const changed = changedMap.get(s.id) ?? Array(8).fill(false)
              const snapDiff = snapshotDiffMap.get(s.id) ?? Array(8).fill(false)
              const burstCount = burstMap.get(s.id) ?? 0

              return (
                <tr
                  key={s.id}
                  className="hover:bg-slate-800/30 transition-colors group border-b border-slate-800/40"
                >
                  <td className="px-4 py-1.5 font-mono text-sky-300 whitespace-nowrap border-b border-slate-800/30">
                    {s.idHex}
                    {s.frames[0]?.extended && (
                      <span className="ml-1.5 text-[10px] text-slate-600 font-normal">ext</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center font-mono text-slate-600 border-b border-slate-800/30">
                    {s.dlc}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-b border-slate-800/30 ${s.isChanging && isLiveMode ? 'text-slate-300' : 'text-slate-600'}`}>
                    {formatHz((s as SummaryWithHz).hz)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-b border-slate-800/30">
                    {s.frameCount.toLocaleString()}
                  </td>
                  {burstEnabled && (
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-b border-slate-800/30 ${burstHeatClass(burstCount)}`}>
                      {burstCount > 0 ? burstCount : '—'}
                    </td>
                  )}
                  {Array.from({ length: 8 }, (_, i) => {
                    const b = bytes[i] ?? 0
                    const isLiveChanged = isLiveMode && changed[i]
                    const isSnapDiff = !!snapshot && snapDiff[i]
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
                            : isSnapDiff
                              ? 'bg-orange-500/20 text-orange-200 font-semibold'
                              : isLiveChanged
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
                  <td className="px-2 py-1.5 border-b border-slate-800/30">
                    <div className="flex items-center gap-1">
                      <button
                        title="Ignore — hide this ID from SignalScout"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-rose-400 px-1.5 py-0.5 rounded border border-transparent hover:border-rose-900 text-[11px] leading-none"
                        onClick={() => toggleIgnore(s.id)}
                      >
                        ⊘
                      </button>
                      <button
                        title="Frame Builder — coming soon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-sky-400 px-1.5 py-0.5 rounded border border-transparent hover:border-sky-900 text-[11px] leading-none"
                        onClick={() => {}}
                      >
                        →
                      </button>
                    </div>
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
              : snapshot
                ? <span>No IDs changed since snapshot.</span>
                : <span>No IDs match the current filters.</span>
            }
          </div>
        )}
      </div>
    </div>
  )
}
