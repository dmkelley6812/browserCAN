import { useState, useEffect, useRef, useCallback } from 'react'

export interface FrameBuilderSeed {
  id: number
  extended: boolean
  bytes: number[]
}

interface Props {
  seed: FrameBuilderSeed | null
  onClose: () => void
  isConnected: boolean
  sendFrame: (id: number, extended: boolean, bytes: number[]) => Promise<void>
}

const BYTE_COLORS = [
  'text-sky-400', 'text-emerald-400', 'text-violet-400', 'text-amber-400',
  'text-rose-400', 'text-cyan-400', 'text-lime-400', 'text-fuchsia-400',
]

function clampHex(s: string, max: number): string {
  const n = parseInt(s, 16)
  if (isNaN(n)) return s
  return Math.min(n, max).toString(16).toUpperCase()
}

export default function FrameBuilderModal({ seed, onClose, isConnected, sendFrame }: Props) {
  const [idStr, setIdStr] = useState('000')
  const [extended, setExtended] = useState(false)
  const [dlc, setDlc] = useState(8)
  const [byteStrs, setByteStrs] = useState<string[]>(Array(8).fill('00'))
  const [expandedByte, setExpandedByte] = useState<number | null>(null)
  const [intervalStr, setIntervalStr] = useState('100')
  const [isRepeating, setIsRepeating] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const repeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync state when seed changes (modal (re)opens)
  useEffect(() => {
    if (!seed) return
    const ext = seed.extended
    setExtended(ext)
    setIdStr(seed.id.toString(16).toUpperCase().padStart(ext ? 8 : 3, '0'))
    const bs = Array(8).fill('00')
    seed.bytes.slice(0, 8).forEach((b, i) => {
      bs[i] = b.toString(16).toUpperCase().padStart(2, '0')
    })
    setByteStrs(bs)
    setDlc(Math.max(1, Math.min(8, seed.bytes.length || 8)))
    setExpandedByte(null)
    setSendError(null)
    stopRepeat()
  }, [seed])

  // Clean up on unmount
  useEffect(() => () => { stopRepeat() }, [])

  function stopRepeat() {
    if (repeatRef.current !== null) {
      clearInterval(repeatRef.current)
      repeatRef.current = null
    }
    setIsRepeating(false)
  }

  const maxId = extended ? 0x1FFFFFFF : 0x7FF
  const idNum = parseInt(idStr, 16)
  const idValid = idStr.length > 0 && !isNaN(idNum) && idNum >= 0 && idNum <= maxId

  const parsedBytes = byteStrs.slice(0, dlc).map(s => {
    const n = parseInt(s, 16)
    return isNaN(n) ? -1 : Math.min(255, Math.max(0, n))
  })
  const bytesValid = parsedBytes.every(b => b >= 0)
  const canSend = idValid && bytesValid && isConnected

  const idDisplay = idStr.padStart(extended ? 8 : 3, '0').toUpperCase()
  const dataHex = parsedBytes
    .map(b => b < 0 ? '??' : b.toString(16).toUpperCase().padStart(2, '0'))
    .join('')
  const slcanPreview = `${extended ? 'T' : 't'}${idDisplay}${dlc}${dataHex}`

  function handleIdChange(val: string) {
    const cleaned = val.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    const maxLen = extended ? 8 : 3
    setIdStr(cleaned.slice(0, maxLen))
  }

  function handleExtendedToggle(isExt: boolean) {
    setExtended(isExt)
    const newMaxId = isExt ? 0x1FFFFFFF : 0x7FF
    const current = parseInt(idStr, 16)
    const clamped = isNaN(current) ? 0 : Math.min(current, newMaxId)
    setIdStr(clamped.toString(16).toUpperCase().padStart(isExt ? 8 : 3, '0'))
    stopRepeat()
  }

  function handleByteChange(i: number, val: string) {
    const cleaned = val.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 2)
    const next = [...byteStrs]
    next[i] = cleaned
    setByteStrs(next)
  }

  function handleByteBlur(i: number) {
    const n = parseInt(byteStrs[i], 16)
    const next = [...byteStrs]
    next[i] = isNaN(n) ? '00' : n.toString(16).toUpperCase().padStart(2, '0')
    setByteStrs(next)
  }

  function toggleBit(byteIdx: number, bitIdx: number) {
    const current = parseInt(byteStrs[byteIdx], 16) || 0
    const toggled = current ^ (1 << bitIdx)
    const next = [...byteStrs]
    next[byteIdx] = toggled.toString(16).toUpperCase().padStart(2, '0')
    setByteStrs(next)
  }

  const doSend = useCallback(async () => {
    if (!canSend) return
    try {
      await sendFrame(idNum, extended, parsedBytes)
      setSendError(null)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [canSend, idNum, extended, parsedBytes, sendFrame])

  async function handleSendOnce() {
    await doSend()
  }

  function handleStartRepeat() {
    if (!canSend) return
    stopRepeat()
    const ms = Math.max(10, parseInt(intervalStr) || 100)
    setIsRepeating(true)
    // Capture current values at start — interval captures these via closure on doSend
    repeatRef.current = setInterval(() => {
      void doSend()
    }, ms)
  }

  if (!seed) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <span className="font-semibold text-slate-200 text-sm">Frame Builder</span>
          {!isConnected && (
            <span className="text-xs text-amber-400 bg-amber-900/30 border border-amber-800/50 px-2 py-0.5 rounded">
              No live connection — send disabled
            </span>
          )}
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 transition-colors text-lg leading-none ml-4"
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5 overflow-y-auto">
          {/* ID + Frame type */}
          <div className="flex items-start gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 font-medium">CAN ID (hex)</label>
              <input
                type="text"
                value={idStr}
                onChange={e => handleIdChange(e.target.value)}
                placeholder={extended ? '00000000' : '000'}
                className={`w-32 font-mono text-sm px-3 py-1.5 rounded-lg border bg-slate-800 focus:outline-none transition-colors
                  ${idValid ? 'border-slate-700 text-slate-200 focus:border-sky-600' : 'border-rose-700 text-rose-300 focus:border-rose-600'}`}
              />
              {!idValid && idStr.length > 0 && (
                <span className="text-[10px] text-rose-400">
                  Max: {maxId.toString(16).toUpperCase()}
                </span>
              )}
            </div>

            {/* Standard / Extended toggle */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 font-medium">Frame type</label>
              <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
                <button
                  onClick={() => handleExtendedToggle(false)}
                  className={`px-3 py-1.5 transition-colors ${!extended ? 'bg-sky-600/30 text-sky-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
                >
                  Standard (11-bit)
                </button>
                <button
                  onClick={() => handleExtendedToggle(true)}
                  className={`px-3 py-1.5 border-l border-slate-700 transition-colors ${extended ? 'bg-sky-600/30 text-sky-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
                >
                  Extended (29-bit)
                </button>
              </div>
            </div>

            {/* DLC */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 font-medium">DLC</label>
              <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n, i) => (
                  <button
                    key={n}
                    onClick={() => { setDlc(n); setExpandedByte(null) }}
                    className={`px-2.5 py-1.5 transition-colors ${i > 0 ? 'border-l border-slate-700' : ''} ${dlc === n ? 'bg-sky-600/30 text-sky-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Byte editor */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-500 font-medium">Data bytes</label>
            <div className="flex gap-2 flex-wrap">
              {Array.from({ length: 8 }, (_, i) => {
                const inDlc = i < dlc
                const byteVal = parseInt(byteStrs[i], 16)
                const isExpanded = expandedByte === i
                return (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <span className={`text-[10px] font-medium ${inDlc ? BYTE_COLORS[i] : 'text-slate-700'}`}>B{i + 1}</span>
                    <input
                      type="text"
                      value={byteStrs[i]}
                      onChange={e => handleByteChange(i, e.target.value)}
                      onBlur={() => handleByteBlur(i)}
                      disabled={!inDlc}
                      maxLength={2}
                      className={`w-10 text-center font-mono text-sm px-1 py-1.5 rounded-lg border transition-colors focus:outline-none
                        ${!inDlc
                          ? 'bg-slate-900/50 border-slate-800 text-slate-700 cursor-not-allowed'
                          : isExpanded
                            ? 'bg-slate-700 border-sky-600 text-slate-100'
                            : 'bg-slate-800 border-slate-700 text-slate-200 hover:border-slate-600 focus:border-sky-600 cursor-pointer'
                        }`}
                      onClick={() => inDlc && !isExpanded && setExpandedByte(i)}
                      readOnly={!inDlc}
                    />
                    {/* Bit toggle grid */}
                    {isExpanded && inDlc && (
                      <div className="flex flex-col items-center gap-0.5 mt-1 bg-slate-800/80 border border-slate-700 rounded-lg p-1.5">
                        <div className="flex items-center justify-between w-full mb-0.5">
                          <span className="text-[9px] text-slate-600">bits</span>
                          <button
                            onClick={() => setExpandedByte(null)}
                            className="text-slate-500 hover:text-slate-200 transition-colors text-[11px] leading-none px-0.5"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="flex gap-1">
                          {[7, 6, 5, 4, 3, 2, 1, 0].map(bit => (
                            <div key={bit} className="flex flex-col items-center gap-0.5">
                              <span className="text-[9px] text-slate-600">b{bit}</span>
                              <button
                                onClick={() => toggleBit(i, bit)}
                                className={`w-5 h-5 rounded text-[10px] font-mono border transition-colors
                                  ${!isNaN(byteVal) && (byteVal >> bit) & 1
                                    ? 'bg-sky-600/40 border-sky-600 text-sky-200'
                                    : 'bg-slate-900 border-slate-600 text-slate-500 hover:border-slate-500'
                                  }`}
                              >
                                {!isNaN(byteVal) ? (byteVal >> bit) & 1 : '?'}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* SLCAN preview */}
          <div className="flex items-center gap-3 bg-slate-950/60 border border-slate-800 rounded-lg px-4 py-2.5">
            <span className="text-xs text-slate-500 shrink-0">SLCAN</span>
            <code className={`font-mono text-sm flex-1 ${canSend ? 'text-emerald-300' : 'text-slate-500'}`}>
              {slcanPreview}\r
            </code>
          </div>

          {/* Send controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleSendOnce}
              disabled={!canSend || isRepeating}
              title={!isConnected ? 'Connect to send' : undefined}
              className={`text-sm px-4 py-1.5 rounded-lg border font-medium transition-colors
                ${canSend && !isRepeating
                  ? 'bg-sky-700/30 border-sky-600/60 text-sky-300 hover:bg-sky-700/50'
                  : 'bg-slate-800/50 border-slate-700/50 text-slate-600 cursor-not-allowed'
                }`}
            >
              Send Once
            </button>

            {/* Repeat controls */}
            <div className="flex items-center gap-0">
              <button
                onClick={isRepeating ? stopRepeat : handleStartRepeat}
                disabled={!canSend}
                title={!isConnected ? 'Connect to send' : undefined}
                className={`text-sm px-4 py-1.5 rounded-l-lg border font-medium transition-colors
                  ${isRepeating
                    ? 'bg-rose-700/30 border-rose-600/60 text-rose-300 hover:bg-rose-700/50'
                    : canSend
                      ? 'bg-emerald-800/30 border-emerald-700/50 text-emerald-300 hover:bg-emerald-800/50'
                      : 'bg-slate-800/50 border-slate-700/50 text-slate-600 cursor-not-allowed'
                  }`}
              >
                {isRepeating ? '■ Stop' : '▶ Repeat'}
              </button>
              <div className="flex items-center border border-l-0 border-slate-700 rounded-r-lg overflow-hidden bg-slate-800">
                <input
                  type="number"
                  min="10"
                  value={intervalStr}
                  onChange={e => setIntervalStr(e.target.value)}
                  className="w-16 text-xs text-center font-mono px-2 py-1.5 bg-transparent text-slate-300 focus:outline-none"
                />
                <span className="text-xs text-slate-500 pr-2">ms</span>
              </div>
            </div>

            {isRepeating && (
              <span className="text-xs text-emerald-400 animate-pulse">
                Sending every {intervalStr}ms…
              </span>
            )}

            {sendError && (
              <span className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900 px-2 py-1 rounded">
                {sendError}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
