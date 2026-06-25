import type { ConnectionStatus, BaudRate, SerialBaud, UseSerialCanReturn } from '../hooks/useSerialCan'
import { BAUD_RATE_OPTIONS } from '../hooks/useSerialCan'

const BAUD_LABELS: Record<BaudRate, string> = {
  125000: '125k',
  250000: '250k',
  500000: '500k',
  1000000: '1M',
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  if (status === 'connected') {
    return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
  }
  if (status === 'connecting') {
    return <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
  }
  if (status === 'error') {
    return <span className="inline-block w-2 h-2 rounded-full bg-rose-500" />
  }
  return <span className="inline-block w-2 h-2 rounded-full bg-slate-600" />
}

function statusLabel(status: ConnectionStatus): string {
  if (status === 'connected') return 'Connected'
  if (status === 'connecting') return 'Connecting...'
  if (status === 'error') return 'Error'
  return 'Disconnected'
}

interface Props {
  serial: UseSerialCanReturn
  onBack: () => void
}

export default function LiveBar({ serial, onBack }: Props) {
  const { status, isPaused, totalReceived, errorMessage, baudRate, serialBaud, sendInit } = serial
  const isConnected = status === 'connected'
  const isConnecting = status === 'connecting'

  return (
    <div className="flex items-center gap-3 px-5 py-2 border-b border-slate-800 bg-slate-900/60 flex-wrap flex-shrink-0">
      {/* Status */}
      <div className="flex items-center gap-2 text-xs">
        <StatusDot status={status} />
        <span className={isConnected ? 'text-emerald-400' : status === 'error' ? 'text-rose-400' : 'text-slate-400'}>
          {statusLabel(status)}
        </span>
        {(isConnected || isConnecting) && baudRate && serialBaud && (
          <span className="text-slate-600">
            CAN {BAUD_LABELS[baudRate]} · Serial {serialBaud >= 1000000 ? '1M' : `${serialBaud / 1000}k`}
          </span>
        )}
      </div>

      {/* Error message */}
      {errorMessage && (
        <span className="text-xs text-rose-400 border border-rose-900 rounded px-2 py-0.5 bg-rose-950/40">
          {errorMessage}
        </span>
      )}

      {/* Frame counter */}
      {isConnected && (
        <div className="flex items-center gap-1 text-xs text-slate-500 border-l border-slate-800 pl-3">
          <span className="text-slate-300">{totalReceived.toLocaleString()}</span>
          <span>frames received</span>
          {isPaused && <span className="ml-1 text-yellow-500 font-medium">· PAUSED</span>}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Pause / Resume */}
        {isConnected && (
          <button
            onClick={isPaused ? serial.resume : serial.pause}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              isPaused
                ? 'bg-yellow-600/20 border-yellow-700/50 text-yellow-300 hover:bg-yellow-600/30'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
            }`}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        )}

        {/* Clear */}
        {isConnected && (
          <button
            onClick={serial.clear}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
          >
            Clear
          </button>
        )}

        {/* Disconnect / Back */}
        {isConnected || isConnecting ? (
          <button
            onClick={() => { void serial.disconnect().then(onBack) }}
            className="text-xs px-3 py-1.5 rounded-lg bg-rose-900/30 border border-rose-800/50 text-rose-400 hover:bg-rose-900/50 hover:text-rose-300 transition-colors"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={onBack}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
          >
            Back
          </button>
        )}
      </div>

      {/* Retry panel when disconnected/errored — re-use last known settings */}
      {!isConnected && !isConnecting && baudRate && serialBaud && (
        <div className="flex items-center gap-2 border-l border-slate-800 pl-3">
          <span className="text-xs text-slate-500">Retry:</span>
          <div className="flex gap-1">
            {BAUD_RATE_OPTIONS.map((br) => (
              <button
                key={br}
                onClick={() => serial.connect(br, serialBaud as SerialBaud, sendInit)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  br === baudRate
                    ? 'bg-sky-600/20 border-sky-700/50 text-sky-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-sky-300 hover:border-sky-700'
                }`}
              >
                {BAUD_LABELS[br]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
