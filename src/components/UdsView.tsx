import { useState, useCallback, useRef, useEffect } from 'react'
import ReactECharts from 'echarts-for-react'
import type { CanFrame } from '../types'
import { useSessionState } from '../hooks/useSessionState'
import {
  encodeIsoTp, IsoTpReceiver, FC_CONTINUE,
  parseUdsResponse, bytesToHex, hexToBytes,
  type DtcEntry,
} from '../utils/udsProtocol'
import {
  UDS_COMMANDS, CATEGORIES, CATEGORY_LABELS,
  type UdsCategory, type UdsCommandDef, type UdsCommandParam,
} from '../utils/udsCommands'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntryStatus = 'pending' | 'success' | 'negative' | 'timeout' | 'error'

interface UdsHistoryEntry {
  id: string
  timestamp: number
  commandName: string
  requestBytes: number[]
  requestCanId: number
  responseCanId: number
  status: EntryStatus
  responseBytes: number[]
  parsedResponse: string
  dtcList?: DtcEntry[]
}

interface PollReading {
  timestamp: number
  value: number | null
  display: string
  unit?: string
}

interface Props {
  isConnected: boolean
  sendFrame: (id: number, extended: boolean, bytes: number[]) => Promise<void>
  addFrameListener: (cb: (frame: CanFrame) => void) => () => void
}

const DEFAULT_REQUEST_ID = '7E0'
const DEFAULT_RESPONSE_ID = '7E8'
const OBD2_REQUEST_ID = '7DF'
const OBD2_RESPONSE_ID = '7E8'
const RESPONSE_TIMEOUT_MS = 3000
const POLL_HISTORY_MAX = 120

let _entrySeq = 0
function makeEntryId(): string {
  return `uds-${Date.now()}-${++_entrySeq}`
}

// ---------------------------------------------------------------------------
// Sub-component: Parameter form field
// ---------------------------------------------------------------------------
function ParamField({
  param, value, onChange,
}: {
  param: UdsCommandParam
  value: string
  onChange: (val: string) => void
}) {
  const baseInput =
    'w-full font-mono text-sm px-3 py-1.5 rounded-lg border bg-slate-800 border-slate-700 text-slate-200 focus:outline-none focus:border-sky-600 transition-colors'

  if (param.type === 'select') {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 font-medium">{param.label}</label>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className={baseInput}
        >
          {(param.options ?? []).map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {param.description && <span className="text-[10px] text-slate-600">{param.description}</span>}
      </div>
    )
  }

  const maxLen =
    param.type === 'hex-byte' ? 2
    : param.type === 'hex-word' ? 4
    : param.type === 'hex-3bytes' ? 6
    : undefined

  function handleChange(raw: string) {
    if (param.type === 'hex-bytes') {
      onChange(raw.replace(/[^0-9a-fA-F\s]/g, '').toUpperCase())
    } else {
      onChange(raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, maxLen))
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-slate-500 font-medium">{param.label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => handleChange(e.target.value)}
          placeholder={param.placeholder}
          maxLength={maxLen}
          className={`${baseInput} ${param.presets ? 'flex-1' : 'w-full'}`}
        />
        {param.presets && param.presets.length > 0 && (
          <select
            value=""
            onChange={e => {
              if (e.target.value) {
                const num = parseInt(e.target.value)
                const hexStr = num.toString(16).toUpperCase().padStart(maxLen ?? 4, '0')
                onChange(hexStr)
              }
            }}
            className="text-xs px-2 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-400 focus:outline-none focus:border-sky-600"
          >
            <option value="">Presets</option>
            {param.presets.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
      </div>
      {param.description && <span className="text-[10px] text-slate-600">{param.description}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: DTC Badge
// ---------------------------------------------------------------------------
function DtcStatusBadge({ flag }: { flag: string }) {
  const colors: Record<string, string> = {
    MIL:                'bg-red-900/60 text-red-300 border-red-700/50',
    active:             'bg-red-900/40 text-red-400 border-red-800/40',
    confirmed:          'bg-amber-900/40 text-amber-400 border-amber-800/40',
    pending:            'bg-yellow-900/30 text-yellow-400 border-yellow-800/40',
    failedSinceCleared: 'bg-orange-900/30 text-orange-400 border-orange-800/40',
    stored:             'bg-slate-800 text-slate-400 border-slate-700',
  }
  const cls = colors[flag] ?? 'bg-slate-800 text-slate-400 border-slate-700'
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${cls}`}>
      {flag.toUpperCase()}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: DTC Card List
// ---------------------------------------------------------------------------
function DtcCardList({ dtcs }: { dtcs: DtcEntry[] }) {
  if (dtcs.length === 0) {
    return <p className="text-xs text-slate-500 italic px-1">No DTCs found</p>
  }
  return (
    <div className="flex flex-col gap-2 mt-2">
      {dtcs.map((dtc, i) => (
        <div
          key={i}
          className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2 flex flex-col gap-1"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono font-bold text-sm text-slate-100">{dtc.code}</code>
            <div className="flex gap-1 flex-wrap">
              {dtc.statusFlags.length > 0
                ? dtc.statusFlags.map(f => <DtcStatusBadge key={f} flag={f} />)
                : <DtcStatusBadge flag="inactive" />}
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">{dtc.description}</p>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: History entry row
// ---------------------------------------------------------------------------
function HistoryEntry({ entry }: { entry: UdsHistoryEntry }) {
  const [expanded, setExpanded] = useState(false)

  const statusColor =
    entry.status === 'success' ? 'text-emerald-400 border-emerald-800/50 bg-emerald-950/20'
    : entry.status === 'negative' ? 'text-amber-400 border-amber-800/50 bg-amber-950/20'
    : entry.status === 'pending' ? 'text-sky-400 border-sky-800/50 bg-sky-950/20'
    : 'text-rose-400 border-rose-800/50 bg-rose-950/20'

  const statusIcon =
    entry.status === 'success' ? '✓'
    : entry.status === 'negative' ? '⚠'
    : entry.status === 'pending' ? '⋯'
    : '✗'

  const timeStr = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false })
  const reqHex = bytesToHex(entry.requestBytes)
  const respHex = entry.responseBytes.length > 0 ? bytesToHex(entry.responseBytes) : '—'
  const hasDtcs = entry.dtcList && entry.dtcList.length > 0

  return (
    <div
      className={`border rounded-lg transition-colors cursor-pointer select-none ${statusColor}`}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-start gap-3 px-3 py-2">
        <span className={`font-mono text-sm shrink-0 w-4 text-center ${entry.status === 'pending' ? 'animate-pulse' : ''}`}>
          {statusIcon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs text-slate-400 shrink-0">{timeStr}</span>
            <span className="text-sm font-medium text-slate-200 truncate">{entry.commandName}</span>
            <span className="text-xs font-mono text-slate-500">
              ID {entry.requestCanId.toString(16).toUpperCase().padStart(3, '0')}
            </span>
          </div>
          {!hasDtcs && (
            <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{entry.parsedResponse}</p>
          )}
          {hasDtcs && (
            <p className="text-xs text-slate-400 mt-0.5">{entry.parsedResponse}</p>
          )}
        </div>
        <span className="text-slate-600 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-slate-800/60 pt-2 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div>
              <span className="text-slate-500">Request ID: </span>
              <span className="font-mono text-slate-300">0x{entry.requestCanId.toString(16).toUpperCase().padStart(3, '0')}</span>
            </div>
            <div>
              <span className="text-slate-500">Response ID: </span>
              <span className="font-mono text-slate-300">0x{entry.responseCanId.toString(16).toUpperCase().padStart(3, '0')}</span>
            </div>
          </div>
          <div className="text-xs">
            <span className="text-slate-500">Request bytes: </span>
            <code className="font-mono text-slate-300">{reqHex}</code>
          </div>
          {entry.responseBytes.length > 0 && (
            <div className="text-xs">
              <span className="text-slate-500">Response bytes: </span>
              <code className="font-mono text-slate-300">{respHex}</code>
            </div>
          )}
          {entry.dtcList !== undefined && (
            <DtcCardList dtcs={entry.dtcList} />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: Live Poll Panel
// ---------------------------------------------------------------------------
function LivePollPanel({
  readings, commandName, unit,
}: {
  readings: PollReading[]
  commandName: string
  unit?: string
}) {
  const latest = readings[readings.length - 1]
  const numericReadings = readings.filter(r => r.value !== null)
  const hasNumeric = numericReadings.length >= 2

  const chartOption = hasNumeric ? {
    animation: false,
    grid: { top: 8, right: 8, bottom: 24, left: 52 },
    xAxis: {
      type: 'category' as const,
      data: numericReadings.map((_, i) => i),
      axisLabel: { show: false },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { fontSize: 10, color: '#64748b', formatter: (v: number) => `${v}${unit ? ' ' + unit : ''}` },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series: [{
      type: 'line' as const,
      data: numericReadings.map(r => r.value),
      smooth: 0.3,
      symbol: 'none',
      lineStyle: { color: '#38bdf8', width: 2 },
      areaStyle: { color: 'rgba(56,189,248,0.08)' },
    }],
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      textStyle: { color: '#cbd5e1', fontSize: 11 },
      formatter: (params: { value: number }[]) => `${params[0]?.value ?? '—'} ${unit ?? ''}`,
    },
  } : null

  return (
    <div className="mx-5 mb-4 rounded-xl border border-sky-800/40 bg-sky-950/20 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-sky-800/30">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          <span className="text-xs font-semibold text-sky-300">Live — {commandName}</span>
        </div>
        <span className="text-[10px] text-slate-500">{readings.length} readings</span>
      </div>

      {latest && (
        <div className="px-4 py-3">
          {latest.value !== null ? (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono text-sky-200 tabular-nums">
                {latest.value}
              </span>
              {unit && <span className="text-base text-sky-400/70">{unit}</span>}
            </div>
          ) : (
            <p className="text-sm text-slate-300">{latest.display}</p>
          )}
          <p className="text-[10px] text-slate-600 mt-0.5">
            {new Date(latest.timestamp).toLocaleTimeString('en-US', { hour12: false })}
          </p>
        </div>
      )}

      {chartOption && (
        <div className="px-1 pb-1">
          <ReactECharts
            option={chartOption}
            style={{ height: 130 }}
            opts={{ renderer: 'canvas' }}
            notMerge={false}
            lazyUpdate={true}
          />
        </div>
      )}

      {!latest && (
        <div className="flex items-center justify-center h-16 text-slate-600 text-xs">
          Waiting for first response…
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main UDS View
// ---------------------------------------------------------------------------
export default function UdsView({ isConnected, sendFrame, addFrameListener }: Props) {
  const [category, setCategory] = useSessionState<UdsCategory>('uds-category', 'session')
  const [commandId, setCommandId] = useSessionState<string>('uds-command-id', 'diagnosticSessionControl')
  const [requestIdStr, setRequestIdStr] = useSessionState('uds-req-id', DEFAULT_REQUEST_ID)
  const [responseIdStr, setResponseIdStr] = useSessionState('uds-resp-id', DEFAULT_RESPONSE_ID)
  const [useExtended, setUseExtended] = useSessionState('uds-extended', false)
  const [paramValues, setParamValues] = useSessionState<Record<string, string>>('uds-params', {})
  const [history, setHistory] = useSessionState<UdsHistoryEntry[]>('uds-history', [])

  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // Polling state
  const [isPollActive, setIsPollActive] = useState(false)
  const [pollIntervalMs, setPollIntervalMs] = useSessionState('uds-poll-interval', 500)
  const [pollReadings, setPollReadings] = useState<PollReading[]>([])
  const [pollUnit, setPollUnit] = useState<string | undefined>(undefined)

  const pendingEntryId = useRef<string | null>(null)
  const isoTpReceiver = useRef(new IsoTpReceiver())
  const timeoutHandle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollPendingRef = useRef(false)
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedCommand: UdsCommandDef | undefined = UDS_COMMANDS.find(c => c.id === commandId)
  const commandsInCategory = UDS_COMMANDS.filter(c => c.category === category)

  useEffect(() => {
    if (category === 'obd2') {
      setRequestIdStr(OBD2_REQUEST_ID)
      setResponseIdStr(OBD2_RESPONSE_ID)
    }
  }, [category]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const first = UDS_COMMANDS.find(c => c.category === category)
    if (first && (!selectedCommand || selectedCommand.category !== category)) {
      setCommandId(first.id)
    }
  }, [category]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedCommand) return
    const defaults: Record<string, string> = {}
    for (const p of selectedCommand.params) {
      if (p.default !== undefined) defaults[p.key] = p.default
    }
    setParamValues(prev => {
      const merged: Record<string, string> = { ...defaults }
      for (const k of Object.keys(prev)) {
        if (k in merged) merged[k] = prev[k]
      }
      return merged
    })
    stopPolling()
  }, [commandId]) // eslint-disable-line react-hooks/exhaustive-deps

  const requestBytes: number[] = (() => {
    if (!selectedCommand) return []
    try { return selectedCommand.buildRequest(paramValues) } catch { return [] }
  })()

  const requestCanId = parseInt(requestIdStr, 16) || 0x7E0
  const responseCanId = parseInt(responseIdStr, 16) || 0x7E8

  const canSend = isConnected && !isSending && !isPollActive && requestBytes.length > 0 && requestCanId > 0

  function updateEntry(id: string, update: Partial<UdsHistoryEntry>) {
    setHistory(prev => prev.map(e => e.id === id ? { ...e, ...update } : e))
  }

  function cancelPending() {
    if (timeoutHandle.current) { clearTimeout(timeoutHandle.current); timeoutHandle.current = null }
    if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null }
    isoTpReceiver.current.reset()
    pendingEntryId.current = null
    setIsSending(false)
  }

  function stopPolling() {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null }
    if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null }
    if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null }
    pollPendingRef.current = false
    setIsPollActive(false)
  }

  // Single poll execution — does NOT add to history
  const executePoll = useCallback(async (
    reqBytes: number[],
    reqId: number,
    respId: number,
    extended: boolean,
    cmd: UdsCommandDef,
    intervalMs: number,
  ) => {
    if (pollPendingRef.current) return
    pollPendingRef.current = true

    const isoTpFrames = encodeIsoTp(reqBytes)
    try {
      for (const frameData of isoTpFrames) await sendFrame(reqId, extended, frameData)
    } catch {
      pollPendingRef.current = false
      return
    }

    const receiver = new IsoTpReceiver()
    let done = false

    const unsub = addFrameListener((frame: CanFrame) => {
      if (frame.id !== respId || done) return
      const result = receiver.processFrame(frame.bytes)
      if (result.type === 'needsFlowControl') {
        void sendFrame(reqId, extended, FC_CONTINUE).catch(() => {})
        return
      }
      if (result.type === 'complete') {
        done = true
        if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null }
        unsub()
        pollPendingRef.current = false
        const parsed = parseUdsResponse(result.payload, reqBytes[0] ?? 0)
        setPollUnit(parsed.unit)
        setPollReadings(prev => {
          const next = [...prev, {
            timestamp: Date.now(),
            value: parsed.numericValue ?? null,
            display: parsed.summary,
            unit: parsed.unit,
          }]
          return next.slice(-POLL_HISTORY_MAX)
        })
      }
    })

    pollTimeoutRef.current = setTimeout(() => {
      if (!done) {
        done = true
        unsub()
        pollPendingRef.current = false
      }
    }, Math.min(intervalMs - 10, 2500))
  }, [sendFrame, addFrameListener]) // eslint-disable-line react-hooks/exhaustive-deps

  function startPolling() {
    if (!selectedCommand || requestBytes.length === 0) return
    const reqBytes = [...requestBytes]
    const reqId = requestCanId
    const respId = responseCanId
    const extended = useExtended
    const cmd = selectedCommand
    const intervalMs = pollIntervalMs

    setPollReadings([])
    setIsPollActive(true)

    // Fire immediately, then on interval
    void executePoll(reqBytes, reqId, respId, extended, cmd, intervalMs)
    pollIntervalRef.current = setInterval(
      () => void executePoll(reqBytes, reqId, respId, extended, cmd, intervalMs),
      intervalMs,
    )
  }

  const handleSend = useCallback(async () => {
    if (!canSend || !selectedCommand) return
    cancelPending()
    setSendError(null)

    const entryId = makeEntryId()
    pendingEntryId.current = entryId

    const entry: UdsHistoryEntry = {
      id: entryId,
      timestamp: Date.now(),
      commandName: selectedCommand.name,
      requestBytes,
      requestCanId,
      responseCanId,
      status: 'pending',
      responseBytes: [],
      parsedResponse: 'Waiting for response…',
    }
    setHistory(prev => [entry, ...prev].slice(0, 100))
    setIsSending(true)

    const isoTpFrames = encodeIsoTp(requestBytes)
    try {
      for (const frameData of isoTpFrames) await sendFrame(requestCanId, useExtended, frameData)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSendError(msg)
      updateEntry(entryId, { status: 'error', parsedResponse: `Send error: ${msg}` })
      setIsSending(false)
      pendingEntryId.current = null
      return
    }

    isoTpReceiver.current.reset()

    const unsubscribe = addFrameListener((frame: CanFrame) => {
      if (frame.id !== responseCanId) return
      if (pendingEntryId.current !== entryId) return

      const result = isoTpReceiver.current.processFrame(frame.bytes)

      if (result.type === 'needsFlowControl') {
        void sendFrame(requestCanId, useExtended, FC_CONTINUE).catch(() => {})
        return
      }

      if (result.type === 'complete') {
        const parsed = parseUdsResponse(result.payload, requestBytes[0] ?? 0)
        updateEntry(entryId, {
          status: parsed.kind === 'positive' ? 'success' : parsed.kind === 'negative' ? 'negative' : 'error',
          responseBytes: result.payload,
          parsedResponse: parsed.summary,
          dtcList: parsed.dtcList,
        })
        cancelPending()
      }
    })

    unsubscribeRef.current = unsubscribe

    timeoutHandle.current = setTimeout(() => {
      if (pendingEntryId.current === entryId) {
        updateEntry(entryId, { status: 'timeout', parsedResponse: `No response within ${RESPONSE_TIMEOUT_MS / 1000}s` })
        cancelPending()
      }
    }, RESPONSE_TIMEOUT_MS)
  }, [canSend, selectedCommand, requestBytes, requestCanId, responseCanId, useExtended, sendFrame, addFrameListener]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { cancelPending(); stopPolling() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const requestHex = requestBytes.length > 0 ? bytesToHex(requestBytes) : '—'
  const isPollable = selectedCommand?.pollable === true

  return (
    <div className="flex h-full overflow-hidden bg-slate-950">
      {/* ===== Left Panel — Command Builder ===== */}
      <div className="flex flex-col w-80 min-w-64 border-r border-slate-800 overflow-y-auto bg-slate-900/40">
        {/* ECU Settings */}
        <div className="px-4 pt-4 pb-3 border-b border-slate-800">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">ECU Settings</h2>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] text-slate-500 font-medium block mb-1">Request ID (hex)</label>
                <input
                  type="text"
                  value={requestIdStr}
                  onChange={e => setRequestIdStr(e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 8))}
                  placeholder="7E0"
                  className="w-full font-mono text-sm px-2 py-1 rounded-md border border-slate-700 bg-slate-800 text-slate-200 focus:outline-none focus:border-sky-600 text-center"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-slate-500 font-medium block mb-1">Response ID (hex)</label>
                <input
                  type="text"
                  value={responseIdStr}
                  onChange={e => setResponseIdStr(e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 8))}
                  placeholder="7E8"
                  className="w-full font-mono text-sm px-2 py-1 rounded-md border border-slate-700 bg-slate-800 text-slate-200 focus:outline-none focus:border-sky-600 text-center"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useExtended}
                onChange={e => setUseExtended(e.target.checked)}
                className="accent-sky-500"
              />
              <span className="text-xs text-slate-400">29-bit extended IDs</span>
            </label>
            <div className="flex flex-wrap gap-1 mt-1">
              {[
                { label: 'ECU 1', req: '7E0', resp: '7E8' },
                { label: 'ECU 2', req: '7E1', resp: '7E9' },
                { label: 'ECU 3', req: '7E2', resp: '7EA' },
                { label: 'OBD-II', req: '7DF', resp: '7E8' },
              ].map(preset => (
                <button
                  key={preset.label}
                  onClick={() => { setRequestIdStr(preset.req); setResponseIdStr(preset.resp) }}
                  className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="px-4 pt-3 pb-2 border-b border-slate-800">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Service</h2>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors
                  ${category === cat
                    ? 'bg-sky-600/20 text-sky-300 border-sky-700/50'
                    : 'text-slate-500 hover:text-slate-300 border-transparent hover:border-slate-700'
                  }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        {/* Command List */}
        <div className="px-4 pt-3 pb-2 border-b border-slate-800">
          <div className="flex flex-col gap-1">
            {commandsInCategory.map(cmd => (
              <button
                key={cmd.id}
                onClick={() => setCommandId(cmd.id)}
                className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors
                  ${commandId === cmd.id
                    ? 'bg-sky-600/15 border-sky-700/40 text-sky-200'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] text-slate-500 shrink-0">
                    0x{cmd.sid.toString(16).toUpperCase().padStart(2, '0')}
                  </span>
                  <span className="font-medium">{cmd.name}</span>
                  {cmd.pollable && (
                    <span className="ml-auto text-[9px] text-sky-600 font-semibold shrink-0">LIVE</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Parameters + Actions */}
        {selectedCommand && (
          <div className="px-4 pt-3 pb-4 flex flex-col gap-3">
            <p className="text-[11px] text-slate-500 leading-relaxed">{selectedCommand.description}</p>

            {selectedCommand.params.map(param => (
              <ParamField
                key={param.key}
                param={param}
                value={paramValues[param.key] ?? param.default ?? ''}
                onChange={val => setParamValues(prev => ({ ...prev, [param.key]: val }))}
              />
            ))}

            {/* Request preview */}
            <div className="mt-1 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
              <div className="text-[10px] text-slate-600 mb-1 font-medium">UDS Request Bytes</div>
              <code className="font-mono text-xs text-emerald-400">{requestHex}</code>
            </div>

            {selectedCommand.responseNote && (
              <div className="flex items-start gap-2 bg-amber-950/20 border border-amber-800/40 rounded-lg px-3 py-2">
                <span className="text-amber-500 text-xs shrink-0">⚠</span>
                <p className="text-[11px] text-amber-400/80">{selectedCommand.responseNote}</p>
              </div>
            )}

            {/* Poll interval — only shown for pollable commands */}
            {isPollable && (
              <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
                <span className="text-[10px] text-slate-500 shrink-0">Poll interval</span>
                <input
                  type="number"
                  min={100}
                  max={10000}
                  step={100}
                  value={pollIntervalMs}
                  onChange={e => setPollIntervalMs(Math.max(100, parseInt(e.target.value) || 500))}
                  disabled={isPollActive}
                  className="w-20 font-mono text-xs px-2 py-1 rounded border border-slate-700 bg-slate-800 text-slate-200 focus:outline-none focus:border-sky-600 disabled:opacity-50 text-center"
                />
                <span className="text-[10px] text-slate-500">ms</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-2">
              {/* Send Once */}
              <button
                onClick={handleSend}
                disabled={!canSend}
                title={!isConnected ? 'Connect to a live CAN interface to send UDS commands' : undefined}
                className={`w-full py-2 rounded-lg border font-semibold text-sm transition-all
                  ${canSend
                    ? 'bg-sky-600/25 border-sky-600/60 text-sky-300 hover:bg-sky-600/40 active:scale-95'
                    : 'bg-slate-800/50 border-slate-700/50 text-slate-600 cursor-not-allowed'
                  }`}
              >
                {isSending ? 'Waiting for response…' : isConnected ? 'Send Once' : 'No Connection'}
              </button>

              {/* Start / Stop Polling */}
              {isPollable && (
                <button
                  onClick={isPollActive ? stopPolling : startPolling}
                  disabled={!isConnected || (isSending)}
                  className={`w-full py-2 rounded-lg border font-semibold text-sm transition-all
                    ${isPollActive
                      ? 'bg-red-600/20 border-red-600/50 text-red-300 hover:bg-red-600/30 active:scale-95'
                      : isConnected && !isSending && requestBytes.length > 0
                        ? 'bg-emerald-600/20 border-emerald-600/50 text-emerald-300 hover:bg-emerald-600/30 active:scale-95'
                        : 'bg-slate-800/50 border-slate-700/50 text-slate-600 cursor-not-allowed'
                    }`}
                >
                  {isPollActive
                    ? `Stop Polling (${(pollIntervalMs / 1000).toFixed(1)}s)`
                    : 'Start Live Poll'}
                </button>
              )}
            </div>

            {sendError && (
              <p className="text-xs text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded px-2 py-1">
                {sendError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ===== Right Panel — Live Data + Response History ===== */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 bg-slate-900/40 shrink-0">
          <h2 className="text-sm font-semibold text-slate-300">Response History</h2>
          {history.length > 0 && (
            <>
              <span className="text-xs text-slate-600">{history.length} {history.length === 1 ? 'entry' : 'entries'}</span>
              <button
                onClick={() => setHistory([])}
                className="ml-auto text-xs text-slate-600 hover:text-slate-400 transition-colors px-2 py-1 rounded border border-transparent hover:border-slate-700"
              >
                Clear History
              </button>
            </>
          )}
          {!isConnected && (
            <div className="ml-auto flex items-center gap-1.5 text-xs text-amber-500/70">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500/70" />
              No live connection — sending disabled
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto py-4">
          {/* Live poll panel (above history when active) */}
          {isPollActive && (
            <LivePollPanel
              readings={pollReadings}
              commandName={selectedCommand?.name ?? ''}
              unit={pollUnit}
            />
          )}

          {/* History */}
          <div className="px-5 flex flex-col gap-2">
            {history.length === 0 && !isPollActive ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-700">
                <div className="text-4xl">📡</div>
                <p className="text-sm text-center max-w-xs leading-relaxed">
                  No commands sent yet. Select a service from the left panel and click{' '}
                  <span className="text-slate-500">Send Once</span>.
                </p>
                {!isConnected && (
                  <p className="text-xs text-amber-600/70 text-center max-w-xs">
                    Connect a live CAN interface first via the Live CAN button on the home screen.
                  </p>
                )}
              </div>
            ) : (
              history.map(entry => (
                <HistoryEntry key={entry.id} entry={entry} />
              ))
            )}
          </div>
        </div>

        {/* Quick Reference Footer */}
        <div className="shrink-0 px-5 py-2 border-t border-slate-800 bg-slate-900/20">
          <details className="group">
            <summary className="text-[10px] text-slate-600 cursor-pointer hover:text-slate-400 transition-colors list-none flex items-center gap-1">
              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
              UDS / ISO-TP Quick Reference
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[10px] text-slate-600 pb-1">
              {[
                ['0x10', 'Diagnostic Session Control'],
                ['0x11', 'ECU Reset'],
                ['0x14', 'Clear DTC Information'],
                ['0x19', 'Read DTC Information'],
                ['0x22', 'Read Data By Identifier'],
                ['0x23', 'Read Memory By Address'],
                ['0x27', 'Security Access (seed/key)'],
                ['0x28', 'Communication Control'],
                ['0x2E', 'Write Data By Identifier'],
                ['0x31', 'Routine Control'],
                ['0x3E', 'Tester Present'],
                ['0x7F', 'Negative Response Code'],
                ['0x85', 'Control DTC Setting'],
                ['SID+0x40', 'Positive response byte'],
              ].map(([code, desc]) => (
                <div key={code} className="flex gap-2">
                  <code className="text-slate-500 shrink-0 w-12">{code}</code>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
