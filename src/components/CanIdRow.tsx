import { useState } from 'react'
import type { CanIdSummary } from '../types'
import ByteGraph from './ByteGraph'
import BitGraph from './BitGraph'

const BYTE_COLORS = [
  'bg-sky-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-lime-500', 'bg-fuchsia-500',
]
const BYTE_TEXT_COLORS = [
  'text-sky-400', 'text-emerald-400', 'text-violet-400', 'text-amber-400',
  'text-rose-400', 'text-cyan-400', 'text-lime-400', 'text-fuchsia-400',
]

interface Props {
  summary: CanIdSummary
  isHighlighted: boolean
  defaultExpanded?: boolean
  onOpenBuilder?: (seed: { id: number; extended: boolean; bytes: number[] }) => void
}

export default function CanIdRow({ summary, isHighlighted, defaultExpanded = false, onOpenBuilder }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [expandedBytes, setExpandedBytes] = useState(false)
  const [autoScale, setAutoScale] = useState(true)
  const [downsample, setDownsample] = useState(true)
  const [expandedBitBytes, setExpandedBitBytes] = useState<Set<number>>(new Set())

  const byteCount = Math.max(summary.dlc, summary.frames[0].bytes.length)
  const [visibleBytes, setVisibleBytes] = useState<Set<number>>(
    () => new Set(Array.from({ length: byteCount }, (_, i) => i).filter((i) => summary.byteChangeMask[i]))
  )

  function toggleByte(i: number) {
    setVisibleBytes((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function toggleBitExpand(i: number) {
    setExpandedBitBytes((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const lastFrame = summary.frames[summary.frames.length - 1]
  const durationMs = summary.lastSeen - summary.firstSeen
  const hz = durationMs > 0 ? ((summary.frameCount / durationMs) * 1000).toFixed(1) : '—'

  return (
    <div
      className={`
        rounded-xl border transition-colors mb-3
        ${isHighlighted ? 'border-sky-700/60 bg-sky-950/20' : 'border-slate-800 bg-slate-900/40'}
      `}
    >
      {/* Row header */}
      <div
        className="group flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className={`text-slate-500 text-sm transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>
          ▶
        </span>

        <div className="flex items-baseline gap-2 min-w-[120px]">
          <span className={`font-mono font-bold text-base ${isHighlighted ? 'text-sky-300' : 'text-slate-200'}`}>
            0x{summary.idHex}
          </span>
          <span className="text-slate-500 text-xs font-mono">({summary.id})</span>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>DLC <span className="text-slate-300">{summary.dlc}</span></span>
          <span><span className="text-slate-300">{summary.frameCount.toLocaleString()}</span> frames</span>
          <span>~<span className="text-slate-300">{hz}</span> Hz</span>
          {summary.isChanging ? (
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
              active
            </span>
          ) : (
            <span className="text-slate-600">static</span>
          )}
        </div>

        <div className="ml-auto flex gap-1 items-center">
          {lastFrame.bytes.map((b, i) => (
            <span
              key={i}
              className={`font-mono text-xs ${
                summary.byteChangeMask[i] ? BYTE_TEXT_COLORS[i % BYTE_TEXT_COLORS.length] : 'text-slate-700'
              }`}
            >
              {b.toString(16).toUpperCase().padStart(2, '0')}
            </span>
          ))}
          {onOpenBuilder && (
            <button
              title="Open in Frame Builder"
              onClick={e => {
                e.stopPropagation()
                onOpenBuilder({ id: summary.id, extended: lastFrame.extended, bytes: lastFrame.bytes })
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity ml-2 text-slate-600 hover:text-violet-400 px-1.5 py-0.5 rounded border border-transparent hover:border-violet-900 text-[11px] leading-none"
            >
              →
            </button>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-800 px-4 pb-4 pt-3">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs text-slate-500 mr-1">Bytes:</span>
            {Array.from({ length: byteCount }, (_, i) => (
              <button
                key={i}
                onClick={() => toggleByte(i)}
                className={`
                  flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono border transition-all
                  ${visibleBytes.has(i)
                    ? `${BYTE_COLORS[i % BYTE_COLORS.length]} border-transparent text-white`
                    : 'bg-transparent border-slate-700 text-slate-600 hover:border-slate-600'
                  }
                  ${!summary.byteChangeMask[i] ? 'opacity-40' : ''}
                `}
                title={summary.byteChangeMask[i] ? undefined : 'This byte is static'}
              >
                B{i + 1}
                {!summary.byteChangeMask[i] && <span className="text-[10px]">~</span>}
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setVisibleBytes(
                  new Set(Array.from({ length: byteCount }, (_, i) => i).filter((i) => summary.byteChangeMask[i]))
                )}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Reset
              </button>

              {/* LTTB downsampling toggle — only shown when frame count is high enough to matter */}
              {summary.frames.length > 500 && (
                <>
                  {!downsample && summary.frames.length > 2000 && (
                    <span className="text-xs text-amber-500/80">
                      ⚠ {summary.frames.length.toLocaleString()} pts
                    </span>
                  )}
                  <button
                    onClick={() => setDownsample(d => !d)}
                    title={downsample
                      ? 'LTTB downsampling active — graph shows a visually equivalent reduction of the raw points. Click to disable and render every point.'
                      : 'Downsampling disabled — every raw point is rendered. Click to re-enable LTTB.'}
                    className={`
                      text-xs px-2.5 py-1 rounded-lg border transition-colors
                      ${downsample
                        ? 'bg-teal-900/40 border-teal-700 text-teal-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                      }
                    `}
                  >
                    LTTB {downsample ? 'on' : 'off'}
                  </button>
                </>
              )}

              {/* Auto-scale toggle */}
              <button
                onClick={() => setAutoScale((a) => !a)}
                title="Toggle auto Y-axis scaling"
                className={`
                  text-xs px-3 py-1 rounded-lg border transition-colors
                  ${autoScale
                    ? 'bg-amber-900/40 border-amber-700 text-amber-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                  }
                `}
              >
                Auto Y
              </button>

              {/* Expand bytes toggle */}
              <button
                onClick={() => setExpandedBytes((e) => !e)}
                className={`
                  text-xs px-3 py-1 rounded-lg border transition-colors
                  ${expandedBytes
                    ? 'bg-violet-900/40 border-violet-700 text-violet-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                  }
                `}
              >
                {expandedBytes ? 'Collapse bytes' : 'Expand bytes'}
              </button>
            </div>
          </div>

          {/* Combined graph */}
          {!expandedBytes && (
            <div className="rounded-lg overflow-hidden bg-slate-950/50 border border-slate-800">
              <ByteGraph
                frames={summary.frames}
                visibleBytes={visibleBytes}
                byteCount={byteCount}
                height={220}
                autoScale={autoScale}
                downsample={downsample}
              />
            </div>
          )}

          {/* Per-byte expanded graphs + bit expansion */}
          {expandedBytes && (
            <div className="flex flex-col gap-3">
              {Array.from({ length: byteCount }, (_, i) => i)
                .filter((i) => visibleBytes.has(i))
                .map((i) => {
                const bitsExpanded = expandedBitBytes.has(i)
                return (
                  <div key={i} className="rounded-lg border overflow-hidden border-slate-700">
                    {/* Byte header with Bits toggle */}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/60 border-b border-slate-800">
                      <span className={`text-xs font-mono font-semibold ${BYTE_TEXT_COLORS[i % BYTE_TEXT_COLORS.length]}`}>
                        Byte {i + 1}
                      </span>
                      <span className="text-slate-600 text-xs font-mono">
                        {!summary.byteChangeMask[i] ? '(static)' : `range ${summary.minBytes[i]}–${summary.maxBytes[i]}`}
                      </span>
                      <button
                        onClick={() => toggleBitExpand(i)}
                        className={`
                          ml-auto text-xs px-2.5 py-0.5 rounded-md border transition-colors
                          ${bitsExpanded
                            ? 'bg-fuchsia-900/40 border-fuchsia-700 text-fuchsia-300'
                            : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                          }
                        `}
                      >
                        {bitsExpanded ? '▲ Bits' : '▼ Bits'}
                      </button>
                    </div>

                    {/* Byte value graph */}
                    <div className="bg-slate-950/50">
                      <ByteGraph
                        frames={summary.frames}
                        visibleBytes={visibleBytes}
                        byteCount={byteCount}
                        height={150}
                        singleByte={i}
                        autoScale={autoScale}
                        downsample={downsample}
                      />
                    </div>

                    {/* Bit expansion — digital logic analyzer style */}
                    {bitsExpanded && (
                      <div className="border-t border-slate-800 bg-slate-950/80">
                        <div className="px-3 pt-2 pb-0.5 flex items-center gap-2">
                          <span className="text-xs text-slate-600 font-mono">
                            b7 (MSB) → b0 (LSB)
                          </span>
                        </div>
                        <BitGraph frames={summary.frames} byteIndex={i} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Range footer */}
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            {Array.from({ length: byteCount }, (_, i) => (
              <span key={i} className={BYTE_TEXT_COLORS[i % BYTE_TEXT_COLORS.length]}>
                B{i + 1}:{' '}
                <span className="text-slate-500">
                  {summary.minBytes[i]}–{summary.maxBytes[i]}
                  {' '}(0x{summary.minBytes[i].toString(16).toUpperCase()}–0x{summary.maxBytes[i].toString(16).toUpperCase()})
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
