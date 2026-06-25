import type { CanFrame } from '../types'

// Standard frame: t + 3 hex ID + 1 decimal DLC + (DLC*2) hex data bytes
const STANDARD_RE = /^t([0-9A-Fa-f]{3})([0-8])([0-9A-Fa-f]*)$/
// Extended frame: T + 8 hex ID + 1 decimal DLC + (DLC*2) hex data bytes
const EXTENDED_RE = /^T([0-9A-Fa-f]{8})([0-8])([0-9A-Fa-f]*)$/

function buildFrame(match: RegExpMatchArray, extended: boolean, timestamp: number): CanFrame {
  const id = parseInt(match[1], 16)
  const dlc = parseInt(match[2], 10)
  const hexData = match[3] ?? ''
  const bytes: number[] = []
  for (let i = 0; i < dlc; i++) {
    const byteHex = hexData.slice(i * 2, i * 2 + 2)
    bytes.push(byteHex.length === 2 ? parseInt(byteHex, 16) : 0)
  }
  while (bytes.length < 8) bytes.push(0)
  return {
    timestamp,
    id,
    idHex: id.toString(16).toUpperCase().padStart(extended ? 8 : 3, '0'),
    extended,
    remoteFrame: false,
    dlc,
    bytes,
  }
}

export function parseSingleSlcanFrame(line: string): CanFrame | null {
  if (!line) return null
  const stdMatch = line.match(STANDARD_RE)
  if (stdMatch) return buildFrame(stdMatch, false, performance.now())
  const extMatch = line.match(EXTENDED_RE)
  if (extMatch) return buildFrame(extMatch, true, performance.now())
  return null
}

export function parseSlcanLog(text: string): CanFrame[] {
  const lines = text.split(/\r\n|\r|\n/)
  const frames: CanFrame[] = []
  let lineIndex = 0

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const stdMatch = line.match(STANDARD_RE)
    const extMatch = !stdMatch ? line.match(EXTENDED_RE) : null
    const match = stdMatch ?? extMatch
    if (!match) continue

    frames.push(buildFrame(match, extMatch !== null, lineIndex++))
  }

  return frames
}

export function isSlcanFormat(text: string): boolean {
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (!line) continue
    return /^[tT][0-9A-Fa-f]/.test(line)
  }
  return false
}
