import { useState, useRef, useCallback, useEffect } from 'react'
import type { CanFrame, CanIdSummary } from '../types'
import { parseSingleSlcanFrame } from '../utils/parseSlcan'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// CAN bus bitrate — sent to adapter via SLCAN 'S' command
export type BaudRate = 125000 | 250000 | 500000 | 1000000
export const BAUD_RATE_OPTIONS: BaudRate[] = [125000, 250000, 500000, 1000000]

// USB serial port speed — used by port.open(), separate from CAN bitrate
export type SerialBaud = 9600 | 19200 | 38400 | 57600 | 115200 | 230400 | 500000 | 1000000
export const SERIAL_BAUD_OPTIONS: SerialBaud[] = [9600, 19200, 38400, 57600, 115200, 230400, 500000, 1000000]
export const DEFAULT_SERIAL_BAUD: SerialBaud = 115200

const SLCAN_BAUD_CMD: Record<BaudRate, string> = {
  125000: 'S4',
  250000: 'S5',
  500000: 'S6',
  1000000: 'S8',
}

const RING_BUFFER_SIZE = 20_000
const MAX_FRAMES_PER_ID = 2000
const BATCH_INTERVAL_MS = 150
const FRAMES_UPDATE_INTERVAL_MS = 500

interface SerialCanState {
  status: ConnectionStatus
  isPaused: boolean
  frames: CanFrame[]
  summaries: CanIdSummary[]
  totalReceived: number
  errorMessage: string | null
  baudRate: BaudRate | null
  serialBaud: SerialBaud | null
  sendInit: boolean
  recentTxIds: Set<number>
}

export interface UseSerialCanReturn extends SerialCanState {
  connect: (baudRate: BaudRate, serialBaud: SerialBaud, sendInit: boolean) => void
  disconnect: () => Promise<void>
  pause: () => void
  resume: () => void
  clear: () => void
  sendFrame: (id: number, extended: boolean, bytes: number[]) => Promise<void>
}

export function useSerialCan(): UseSerialCanReturn {
  const [state, setState] = useState<SerialCanState>({
    status: 'disconnected',
    isPaused: false,
    frames: [],
    summaries: [],
    totalReceived: 0,
    errorMessage: null,
    baudRate: null,
    serialBaud: null,
    sendInit: false,
    recentTxIds: new Set(),
  })

  // Ring buffer — mutated directly, not state
  const ringBuf = useRef<CanFrame[]>([])
  const ringHead = useRef(0)
  const totalReceived = useRef(0)
  const isPausedRef = useRef(false)

  // Incremental summary map — updated per-frame, avoids O(20k) rebuild on every tick
  const summaryMapRef = useRef<Map<number, CanIdSummary>>(new Map())
  // First-frame bytes per ID — baseline for byteChangeMask (never evicted)
  const firstBytesRef = useRef<Map<number, number[]>>(new Map())
  // Tracks when frames state was last fully snapshotted (less frequent than summary updates)
  const lastFrameUpdateRef = useRef(0)

  // Serial port refs
  const portRef = useRef<SerialPort | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null)
  const batchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const encoderRef = useRef(new TextEncoder())
  // TX echo tracking — map from CAN ID to cleanup timer handle
  const recentTxTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  function pushFrame(frame: CanFrame) {
    // Global ring buffer — kept for TableView raw frame mode
    const buf = ringBuf.current
    if (buf.length < RING_BUFFER_SIZE) {
      buf.push(frame)
    } else {
      buf[ringHead.current] = frame
      ringHead.current = (ringHead.current + 1) % RING_BUFFER_SIZE
    }
    totalReceived.current++

    // Incremental summary update — O(1) per frame instead of O(all frames) per tick
    const map = summaryMapRef.current
    const existing = map.get(frame.id)
    if (!existing) {
      firstBytesRef.current.set(frame.id, [...frame.bytes])
      map.set(frame.id, {
        id: frame.id,
        idHex: frame.idHex,
        dlc: frame.dlc,
        frameCount: 1,
        firstSeen: frame.timestamp,
        lastSeen: frame.timestamp,
        frames: [frame],
        isChanging: false,
        byteChangeMask: Array(frame.bytes.length).fill(false),
        minBytes: [...frame.bytes],
        maxBytes: [...frame.bytes],
      })
    } else {
      existing.frameCount++
      existing.lastSeen = frame.timestamp

      const firstBytes = firstBytesRef.current.get(frame.id)!
      for (let i = 0; i < frame.bytes.length; i++) {
        const b = frame.bytes[i]
        if (b < (existing.minBytes[i] ?? b)) existing.minBytes[i] = b
        if (b > (existing.maxBytes[i] ?? b)) existing.maxBytes[i] = b
        if (!existing.byteChangeMask[i] && b !== (firstBytes[i] ?? b)) {
          existing.byteChangeMask[i] = true
          existing.isChanging = true
        }
      }

      // Per-ID rolling frame history for graphs — capped to avoid unbounded growth
      existing.frames.push(frame)
      if (existing.frames.length > MAX_FRAMES_PER_ID) {
        existing.frames.shift()
      }
    }
  }

  function getSnapshot(): CanFrame[] {
    const buf = ringBuf.current
    if (buf.length < RING_BUFFER_SIZE) return [...buf]
    return [...buf.slice(ringHead.current), ...buf.slice(0, ringHead.current)]
  }

  function startBatchTimer() {
    batchTimerRef.current = setInterval(() => {
      if (isPausedRef.current) return
      // Summaries are maintained incrementally — just snapshot the map (O(IDs), not O(frames))
      const summaries = Array.from(summaryMapRef.current.values())
      // Raw frame snapshot is expensive (copies 20k entries) — only update at 500ms
      const now = Date.now()
      const needsFrameSnapshot = now - lastFrameUpdateRef.current >= FRAMES_UPDATE_INTERVAL_MS
      if (needsFrameSnapshot) lastFrameUpdateRef.current = now
      setState(prev => ({
        ...prev,
        summaries,
        ...(needsFrameSnapshot ? { frames: getSnapshot() } : {}),
        totalReceived: totalReceived.current,
      }))
    }, BATCH_INTERVAL_MS)
  }

  function stopBatchTimer() {
    if (batchTimerRef.current !== null) {
      clearInterval(batchTimerRef.current)
      batchTimerRef.current = null
    }
  }

  async function readLoop(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onDone: (error?: Error) => void,
  ) {
    const decoder = new TextDecoder()
    let lineBuffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) {
          lineBuffer += decoder.decode(value, { stream: true })
          const parts = lineBuffer.split(/\r\n|\r|\n/)
          lineBuffer = parts.pop() ?? ''
          for (const part of parts) {
            const frame = parseSingleSlcanFrame(part.trim())
            if (frame) pushFrame(frame)
          }
        }
      }
      onDone()
    } catch (e) {
      onDone(e instanceof Error ? e : new Error(String(e)))
    }
  }

  async function writeCommand(cmd: string) {
    if (!writerRef.current) return
    await writerRef.current.write(encoderRef.current.encode(cmd + '\r'))
  }

  const connect = useCallback((baudRate: BaudRate, serialBaud: SerialBaud, sendInit: boolean) => {
    if (!('serial' in navigator)) {
      setState(prev => ({
        ...prev,
        status: 'error',
        errorMessage: 'Web Serial API is not supported. Use Chrome or Edge.',
      }))
      return
    }

    setState(prev => ({ ...prev, status: 'connecting', errorMessage: null, baudRate, serialBaud, sendInit }))

    ;(async () => {
      try {
        const port = await navigator.serial.requestPort()
        await port.open({ baudRate: serialBaud })
        portRef.current = port

        const writer = port.writable.getWriter()
        writerRef.current = writer
        const reader = port.readable.getReader()
        readerRef.current = reader

        // Hardware SLCAN adapters (USBtin, etc.) need S+O commands to start.
        // Streaming firmware (DIY ESP32, etc.) starts immediately — skip to avoid disruption.
        if (sendInit) {
          await writeCommand(SLCAN_BAUD_CMD[baudRate])
          await writeCommand('O')
        }

        // Reset ring buffer and incremental summary state
        ringBuf.current = []
        ringHead.current = 0
        totalReceived.current = 0
        summaryMapRef.current = new Map()
        firstBytesRef.current = new Map()
        lastFrameUpdateRef.current = 0

        setState(prev => ({
          ...prev,
          status: 'connected',
          frames: [],
          summaries: [],
          totalReceived: 0,
        }))

        startBatchTimer()

        void readLoop(reader, (error) => {
          stopBatchTimer()
          setState(prev => ({
            ...prev,
            status: error ? 'error' : 'disconnected',
            errorMessage: error?.message ?? null,
          }))
        })
      } catch (e) {
        // User cancelled port picker or port failed to open
        const msg = e instanceof Error ? e.message : String(e)
        setState(prev => ({
          ...prev,
          status: 'error',
          errorMessage: msg.includes('No port selected') ? null : msg,
        }))
      }
    })()
  }, [])

  const sendFrame = useCallback(async (id: number, extended: boolean, bytes: number[]) => {
    if (!writerRef.current) return
    const idHex = id.toString(16).toUpperCase().padStart(extended ? 8 : 3, '0')
    const dataHex = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('')
    const cmd = `${extended ? 'T' : 't'}${idHex}${bytes.length}${dataHex}`
    await writerRef.current.write(encoderRef.current.encode(cmd + '\r'))

    // Track ID as recently sent for TX echo tagging (cleared after 800ms)
    const existing = recentTxTimers.current.get(id)
    if (existing !== undefined) clearTimeout(existing)
    setState(prev => {
      const next = new Set(prev.recentTxIds)
      next.add(id)
      return { ...prev, recentTxIds: next }
    })
    const timer = setTimeout(() => {
      setState(prev => {
        const next = new Set(prev.recentTxIds)
        next.delete(id)
        return { ...prev, recentTxIds: next }
      })
      recentTxTimers.current.delete(id)
    }, 800)
    recentTxTimers.current.set(id, timer)
  }, [])

  const disconnect = useCallback(async () => {
    stopBatchTimer()
    isPausedRef.current = false

    // Clear all TX echo timers
    for (const t of recentTxTimers.current.values()) clearTimeout(t)
    recentTxTimers.current.clear()

    try { await writeCommand('C') } catch {}
    try { writerRef.current?.releaseLock(); writerRef.current = null } catch {}
    try { await readerRef.current?.cancel(); readerRef.current = null } catch {}
    try { await portRef.current?.close(); portRef.current = null } catch {}

    setState(prev => ({
      ...prev,
      status: 'disconnected',
      isPaused: false,
      errorMessage: null,
      recentTxIds: new Set(),
    }))
  }, [])

  const pause = useCallback(() => {
    isPausedRef.current = true
    setState(prev => ({ ...prev, isPaused: true }))
  }, [])

  const resume = useCallback(() => {
    isPausedRef.current = false
    setState(prev => ({ ...prev, isPaused: false }))
  }, [])

  const clear = useCallback(() => {
    ringBuf.current = []
    ringHead.current = 0
    totalReceived.current = 0
    summaryMapRef.current = new Map()
    firstBytesRef.current = new Map()
    lastFrameUpdateRef.current = 0
    setState(prev => ({ ...prev, frames: [], summaries: [], totalReceived: 0 }))
  }, [])

  useEffect(() => {
    return () => { stopBatchTimer() }
  }, [])

  return { ...state, connect, disconnect, pause, resume, clear, sendFrame }
}
