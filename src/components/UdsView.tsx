import { useState, useCallback, useRef, useEffect } from 'react'
import type { CanFrame } from '../types'
import { useSessionState } from '../hooks/useSessionState'
import {
  encodeIsoTp, IsoTpReceiver, FC_CONTINUE,
  parseUdsResponse, bytesToHex, hexToBytes,
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
  /** UDS payload bytes (not ISO-TP wrapped) */
  requestBytes: number[]
  requestCanId: number
  responseCanId: number
  status: EntryStatus
  /** Reassembled UDS response payload */
  responseBytes: number[]
  parsedResponse: string
}

interface Props {
  isConnected: boolean
  sendFrame: (id: number, extended: boolean, bytes: number[]) => Promise<void>
  addFrameListener: (cb: (frame: CanFrame) => void) => () => void
}

// Default CAN IDs for common configurations
const DEFAULT_REQUEST_ID = '7E0'  // Physical addressing to ECU #1
const DEFAULT_RESPONSE_ID = '7E8' // ECU #1 response (request + 8)
const OBD2_REQUEST_ID = '7DF'     // OBD-II functional broadcast
const OBD2_RESPONSE_ID = '7E8'    // OBD-II response (first ECU)

const RESPONSE_TIMEOUT_MS = 3000

// ---------------------------------------------------------------------------
// Helper: build a unique entry ID
// ---------------------------------------------------------------------------
let _entrySeq = 0
function makeEntryId(): string {
  return `uds-${Date.now()}-${++_entrySeq}`
}

// ---------------------------------------------------------------------------
// Sub-component: Parameter form field
// ---------------------------------------------------------------------------
function ParamField({
  param,
  value,
  onChange,
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
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {param.description && (
          <span className="text-[10px] text-slate-600">{param.description}</span>
        )}
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
      // Allow spaces and hex chars
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
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {param.description && (
        <span className="text-[10px] text-slate-600">{param.description}</span>
      )}
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

  return (
    <div
      className={`border rounded-lg transition-colors cursor-pointer select-none ${statusColor}`}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Summary row */}
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
          <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{entry.parsedResponse}</p>
        </div>
        <span className="text-slate-600 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-slate-800/60 pt-2 flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div>
              <span className="text-slate-500">Request ID: </span>
              <span className="font-mono text-slate-300">
                0x{entry.requestCanId.toString(16).toUpperCase().padStart(3, '0')}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Response ID: </span>
              <span className="font-mono text-slate-300">
                0x{entry.responseCanId.toString(16).toUpperCase().padStart(3, '0')}
              </span>
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
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main UDS View
// ---------------------------------------------------------------------------
export default function UdsView({ isConnected, sendFrame, addFrameListener }: Props) {
  // --- ECU configuration (persisted across tab switches) ---
  const [category, setCategory] = useSessionState<UdsCategory>('uds-category', 'session')
  const [commandId, setCommandId] = useSessionState<string>('uds-command-id', 'diagnosticSessionControl')
  const [requestIdStr, setRequestIdStr] = useSessionState('uds-req-id', DEFAULT_REQUEST_ID)
  const [responseIdStr, setResponseIdStr] = useSessionState('uds-resp-id', DEFAULT_RESPONSE_ID)
  const [useExtended, setUseExtended] = useSessionState('uds-extended', false)
  const [paramValues, setParamValues] = useSessionState<Record<string, string>>('uds-params', {})

  // --- Session history (persisted across tab switches) ---
  const [history, setHistory] = useSessionState<UdsHistoryEntry[]>('uds-history', [])

  // --- Transient send state ---
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const pendingEntryId = useRef<string | null>(null)
  const isoTpReceiver = useRef(new IsoTpReceiver())
  const timeoutHandle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  const selectedCommand: UdsCommandDef | undefined =
    UDS_COMMANDS.find(c => c.id === commandId)

  const commandsInCategory = UDS_COMMANDS.filter(c => c.category === category)

  // Auto-fill OBD-II CAN IDs when switching to obd2 category
  useEffect(() => {
    if (category === 'obd2') {
      setRequestIdStr(OBD2_REQUEST_ID)
      setResponseIdStr(OBD2_RESPONSE_ID)
    }
  }, [category]) // eslint-disable-line react-hooks/exhaustive-deps

  // Switch to first command in category when category changes
  useEffect(() => {
    const first = UDS_COMMANDS.find(c => c.category === category)
    if (first && (!selectedCommand || selectedCommand.category !== category)) {
      setCommandId(first.id)
    }
  }, [category]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize params when command changes
  useEffect(() => {
    if (!selectedCommand) return
    const defaults: Record<string, string> = {}
    for (const p of selectedCommand.params) {
      if (p.default !== undefined) defaults[p.key] = p.default
    }
    setParamValues(prev => {
      // Keep any already-set values so switching back doesn't reset user edits
      const merged: Record<string, string> = { ...defaults }
      for (const k of Object.keys(prev)) {
        if (k in merged) merged[k] = prev[k]
      }
      return merged
    })
  }, [commandId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build preview of the UDS request bytes
  const requestBytes: number[] = (() => {
    if (!selectedCommand) return []
    try {
      return selectedCommand.buildRequest(paramValues)
    } catch {
      return []
    }
  })()

  const requestCanId = parseInt(requestIdStr, 16) || 0x7E0
  const responseCanId = parseInt(responseIdStr, 16) || 0x7E8

  // Derived UI state
  const canSend = isConnected && !isSending && requestBytes.length > 0 && requestCanId > 0

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
    setHistory(prev => [entry, ...prev].slice(0, 100)) // cap at 100 entries
    setIsSending(true)

    // Encode request into ISO-TP CAN frames
    const isoTpFrames = encodeIsoTp(requestBytes)

    try {
      // For multi-frame requests, we'd need to wait for FC between FF and CFs.
      // In practice all current commands fit in a single frame so we send all at once.
      for (const frameData of isoTpFrames) {
        await sendFrame(requestCanId, useExtended, frameData)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSendError(msg)
      updateEntry(entryId, { status: 'error', parsedResponse: `Send error: ${msg}` })
      setIsSending(false)
      pendingEntryId.current = null
      return
    }

    // Listen for response frames on the expected response CAN ID
    isoTpReceiver.current.reset()

    const unsubscribe = addFrameListener((frame: CanFrame) => {
      if (frame.id !== responseCanId) return
      if (pendingEntryId.current !== entryId) return

      const result = isoTpReceiver.current.processFrame(frame.bytes)

      if (result.type === 'needsFlowControl') {
        // Send Flow Control to allow the ECU to continue sending Consecutive Frames
        void sendFrame(requestCanId, useExtended, FC_CONTINUE).catch(() => {})
        return
      }

      if (result.type === 'complete') {
        const parsed = parseUdsResponse(result.payload, requestBytes[0] ?? 0)
        updateEntry(entryId, {
          status: parsed.kind === 'positive' ? 'success' : parsed.kind === 'negative' ? 'negative' : 'error',
          responseBytes: result.payload,
          parsedResponse: parsed.summary,
        })
        cancelPending()
      }
      // 'partial' and 'error' from ISO-TP just keep waiting (error will hit timeout)
    })

    unsubscribeRef.current = unsubscribe

    // Timeout watchdog
    timeoutHandle.current = setTimeout(() => {
      if (pendingEntryId.current === entryId) {
        updateEntry(entryId, {
          status: 'timeout',
          parsedResponse: `No response within ${RESPONSE_TIMEOUT_MS / 1000}s`,
        })
        cancelPending()
      }
    }, RESPONSE_TIMEOUT_MS)
  }, [canSend, selectedCommand, requestBytes, requestCanId, responseCanId, useExtended, sendFrame, addFrameListener]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => () => { cancelPending() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const requestHex = requestBytes.length > 0 ? bytesToHex(requestBytes) : '—'

  return (
    <div className="flex h-full overflow-hidden bg-slate-950">
      {/* ===== Left Panel — Command Builder ===== */}
      <div className="flex flex-col w-80 min-w-64 border-r border-slate-800 overflow-y-auto bg-slate-900/40">
        {/* ECU Settings */}
        <div className="px-4 pt-4 pb-3 border-b border-slate-800">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
            ECU Settings
          </h2>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] text-slate-500 font-medium block mb-1">
                  Request ID (hex)
                </label>
                <input
                  type="text"
                  value={requestIdStr}
                  onChange={e => setRequestIdStr(e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 8))}
                  placeholder="7E0"
                  className="w-full font-mono text-sm px-2 py-1 rounded-md border border-slate-700 bg-slate-800 text-slate-200 focus:outline-none focus:border-sky-600 text-center"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-slate-500 font-medium block mb-1">
                  Response ID (hex)
                </label>
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

            {/* Quick ID presets */}
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
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
            Service
          </h2>
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
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Parameters */}
        {selectedCommand && (
          <div className="px-4 pt-3 pb-4 flex flex-col gap-3">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {selectedCommand.description}
            </p>

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

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={!canSend}
              title={!isConnected ? 'Connect to a live CAN interface to send UDS commands' : undefined}
              className={`w-full mt-1 py-2 rounded-lg border font-semibold text-sm transition-all
                ${canSend
                  ? 'bg-sky-600/25 border-sky-600/60 text-sky-300 hover:bg-sky-600/40 active:scale-95'
                  : 'bg-slate-800/50 border-slate-700/50 text-slate-600 cursor-not-allowed'
                }`}
            >
              {isSending ? 'Waiting for response…' : isConnected ? 'Send Command' : 'No Connection'}
            </button>

            {sendError && (
              <p className="text-xs text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded px-2 py-1">
                {sendError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ===== Right Panel — Response History ===== */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 bg-slate-900/40 shrink-0">
          <h2 className="text-sm font-semibold text-slate-300">Response History</h2>
          {history.length > 0 && (
            <>
              <span className="text-xs text-slate-600">
                {history.length} {history.length === 1 ? 'entry' : 'entries'}
              </span>
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

        {/* History list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-700">
              <div className="text-4xl">📡</div>
              <p className="text-sm text-center max-w-xs leading-relaxed">
                No commands sent yet. Select a service from the left panel and click{' '}
                <span className="text-slate-500">Send Command</span>.
              </p>
              {!isConnected && (
                <p className="text-xs text-amber-600/70 text-center max-w-xs">
                  Connect a live CAN interface first via the Live CAN button on the home screen.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {history.map(entry => (
                <HistoryEntry key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>

        {/* ISO-TP / UDS Quick Reference Footer */}
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
