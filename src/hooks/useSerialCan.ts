import { useState, useRef, useCallback, useEffect } from 'react'
import type { CanFrame, CanIdSummary } from '../types'
import { buildIdSummaries } from '../utils/parseGvret'
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
const BATCH_INTERVAL_MS = 150

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
}

export interface UseSerialCanReturn extends SerialCanState {
  connect: (baudRate: BaudRate, serialBaud: SerialBaud, sendInit: boolean) => void
  disconnect: () => Promise<void>
  pause: () => void
  resume: () => void
  clear: () => void
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
  })

  // Ring buffer — mutated directly, not state
  const ringBuf = useRef<CanFrame[]>([])
  const ringHead = useRef(0)
  const totalReceived = useRef(0)
  const isPausedRef = useRef(false)

  // Serial port refs
  const portRef = useRef<SerialPort | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null)
  const batchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const encoderRef = useRef(new TextEncoder())

  function pushFrame(frame: CanFrame) {
    const buf = ringBuf.current
    if (buf.length < RING_BUFFER_SIZE) {
      buf.push(frame)
    } else {
      buf[ringHead.current] = frame
      ringHead.current = (ringHead.current + 1) % RING_BUFFER_SIZE
    }
    totalReceived.current++
  }

  function getSnapshot(): CanFrame[] {
    const buf = ringBuf.current
    if (buf.length < RING_BUFFER_SIZE) return [...buf]
    return [...buf.slice(ringHead.current), ...buf.slice(0, ringHead.current)]
  }

  function startBatchTimer() {
    batchTimerRef.current = setInterval(() => {
      if (isPausedRef.current) return
      const snapshot = getSnapshot()
      const summaries = snapshot.length > 0 ? buildIdSummaries(snapshot) : []
      setState(prev => ({
        ...prev,
        frames: snapshot,
        summaries,
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

        // Reset ring buffer
        ringBuf.current = []
        ringHead.current = 0
        totalReceived.current = 0

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

  const disconnect = useCallback(async () => {
    stopBatchTimer()
    isPausedRef.current = false

    try { await writeCommand('C') } catch {}
    try { writerRef.current?.releaseLock(); writerRef.current = null } catch {}
    try { await readerRef.current?.cancel(); readerRef.current = null } catch {}
    try { await portRef.current?.close(); portRef.current = null } catch {}

    setState(prev => ({
      ...prev,
      status: 'disconnected',
      isPaused: false,
      errorMessage: null,
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
    setState(prev => ({ ...prev, frames: [], summaries: [], totalReceived: 0 }))
  }, [])

  useEffect(() => {
    return () => { stopBatchTimer() }
  }, [])

  return { ...state, connect, disconnect, pause, resume, clear }
}
