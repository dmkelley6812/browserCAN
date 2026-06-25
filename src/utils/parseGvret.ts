import Papa from 'papaparse'
import type { CanFrame, CanIdSummary } from '../types'

interface RawRow {
  'Time Stamp': string
  ID: string
  Extended: string
  'Remote Frame': string
  DLC: string
  D1: string; D2: string; D3: string; D4: string
  D5: string; D6: string; D7: string; D8: string
}

export function parseGvretCsv(text: string): CanFrame[] {
  const result = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  })

  return result.data
    .filter((row) => row['Time Stamp'] && row.ID)
    .map((row) => {
      const dlc = parseInt(row.DLC) || 0
      const bytes = [
        parseInt(row.D1) || 0,
        parseInt(row.D2) || 0,
        parseInt(row.D3) || 0,
        parseInt(row.D4) || 0,
        parseInt(row.D5) || 0,
        parseInt(row.D6) || 0,
        parseInt(row.D7) || 0,
        parseInt(row.D8) || 0,
      ]

      const id = parseInt(row.ID)
      return {
        timestamp: parseInt(row['Time Stamp']) || 0,
        id,
        idHex: id.toString(16).toUpperCase().padStart(3, '0'),
        extended: row.Extended === '1',
        remoteFrame: row['Remote Frame'] === '1',
        dlc,
        bytes,
      } satisfies CanFrame
    })
}

export function buildIdSummaries(frames: CanFrame[]): CanIdSummary[] {
  const map = new Map<number, CanFrame[]>()
  for (const frame of frames) {
    const list = map.get(frame.id) ?? []
    list.push(frame)
    map.set(frame.id, list)
  }

  const summaries: CanIdSummary[] = []
  for (const [id, idFrames] of map.entries()) {
    const dlc = idFrames[0].dlc
    const byteCount = Math.max(...idFrames.map((f) => f.bytes.length))

    const minBytes = Array(byteCount).fill(255)
    const maxBytes = Array(byteCount).fill(0)
    const byteChangeMask = Array(byteCount).fill(false)
    const firstValues = idFrames[0].bytes

    for (const frame of idFrames) {
      for (let i = 0; i < byteCount; i++) {
        const b = frame.bytes[i] ?? 0
        if (b < minBytes[i]) minBytes[i] = b
        if (b > maxBytes[i]) maxBytes[i] = b
        if (b !== (firstValues[i] ?? 0)) byteChangeMask[i] = true
      }
    }

    const isChanging = byteChangeMask.some(Boolean)

    summaries.push({
      id,
      idHex: id.toString(16).toUpperCase().padStart(3, '0'),
      dlc,
      frameCount: idFrames.length,
      firstSeen: idFrames[0].timestamp,
      lastSeen: idFrames[idFrames.length - 1].timestamp,
      frames: idFrames,
      isChanging,
      byteChangeMask,
      minBytes,
      maxBytes,
    })
  }

  return summaries.sort((a, b) => a.id - b.id)
}
