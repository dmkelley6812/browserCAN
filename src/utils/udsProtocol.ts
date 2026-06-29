/**
 * UDS (ISO 14229) over ISO-TP (ISO 15765-2) — Protocol Utilities
 *
 * ISO-TP handles segmentation of UDS messages across multiple CAN frames.
 * Frame types are identified by the high nibble of data byte 0:
 *   0x0N  Single Frame (SF)      — full message fits in one frame, N bytes
 *   0x1N  First Frame (FF)       — multi-frame message starts here, total length = 0xNNN
 *   0x2N  Consecutive Frame (CF) — continuation, N = rolling sequence counter (1–F)
 *   0x3N  Flow Control (FC)      — receiver sends this to throttle multi-frame TX
 */

// ---------------------------------------------------------------------------
// ISO-TP Encoding (for sending UDS requests)
// ---------------------------------------------------------------------------

/**
 * Wrap a UDS payload in ISO-TP CAN frame(s).
 * Returns an array of 8-byte data arrays, each representing one CAN frame to send.
 * For payloads ≤ 7 bytes this is always a single frame; longer payloads produce
 * a First Frame followed by Consecutive Frames (FC from the ECU is handled by the
 * receiver — caller must wait for FC before sending CFs).
 */
export function encodeIsoTp(payload: number[]): number[][] {
  if (payload.length === 0) return []

  if (payload.length <= 7) {
    // Single Frame: [0x0N, ...payload] padded to 8 bytes
    const frame = [payload.length, ...payload]
    while (frame.length < 8) frame.push(0x00)
    return [frame]
  }

  // Multi-frame: First Frame + Consecutive Frames
  const frames: number[][] = []
  const totalLen = payload.length

  // First Frame: [0x1H 0xLL, first 6 bytes of payload]
  // H = high nibble of 12-bit length, LL = low byte
  frames.push([
    0x10 | ((totalLen >> 8) & 0x0F),
    totalLen & 0xFF,
    ...payload.slice(0, 6),
  ])

  // Consecutive Frames: [0x2N, up to 7 bytes of payload] — N wraps 1–F→0→1…
  let offset = 6
  let seqNum = 1
  while (offset < totalLen) {
    const chunk = payload.slice(offset, offset + 7)
    const cf: number[] = [0x20 | (seqNum & 0x0F), ...chunk]
    while (cf.length < 8) cf.push(0x00)
    frames.push(cf)
    offset += 7
    seqNum = (seqNum & 0x0F) === 0x0F ? 0 : seqNum + 1
  }

  return frames
}

/** Flow Control "Continue To Send" frame — send this after receiving a First Frame. */
export const FC_CONTINUE: number[] = [0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]

// ---------------------------------------------------------------------------
// ISO-TP Receiver — processes incoming CAN frames, reassembles UDS payload
// ---------------------------------------------------------------------------

export type IsoTpReceiverResult =
  | { type: 'complete'; payload: number[] }
  | { type: 'needsFlowControl' }
  | { type: 'partial' }
  | { type: 'error'; reason: string }

export class IsoTpReceiver {
  private totalLength = 0
  private buffer: number[] = []
  private expectSeq = 1
  private active = false

  reset() {
    this.totalLength = 0
    this.buffer = []
    this.expectSeq = 1
    this.active = false
  }

  processFrame(data: number[]): IsoTpReceiverResult {
    if (data.length === 0) return { type: 'error', reason: 'empty frame' }
    const frameType = (data[0] >> 4) & 0x0F

    if (frameType === 0x0) {
      // Single Frame — complete in one shot
      const len = data[0] & 0x0F
      if (len === 0 || len > 7) return { type: 'error', reason: `invalid SF length ${len}` }
      this.reset()
      return { type: 'complete', payload: data.slice(1, 1 + len) }
    }

    if (frameType === 0x1) {
      // First Frame — start of multi-frame sequence
      this.totalLength = ((data[0] & 0x0F) << 8) | (data[1] ?? 0)
      this.buffer = data.slice(2, 8)
      this.expectSeq = 1
      this.active = true
      if (this.buffer.length >= this.totalLength) {
        // Edge case: total fits in the FF itself (shouldn't happen per spec, but handle it)
        this.active = false
        return { type: 'complete', payload: this.buffer.slice(0, this.totalLength) }
      }
      return { type: 'needsFlowControl' }
    }

    if (frameType === 0x2) {
      // Consecutive Frame
      if (!this.active) return { type: 'error', reason: 'CF without FF' }
      const seq = data[0] & 0x0F
      if (seq !== this.expectSeq) {
        this.reset()
        return { type: 'error', reason: `out-of-order CF (expected ${this.expectSeq}, got ${seq})` }
      }
      const remaining = this.totalLength - this.buffer.length
      this.buffer.push(...data.slice(1, 1 + Math.min(7, remaining)))
      this.expectSeq = (this.expectSeq & 0x0F) === 0x0F ? 0 : this.expectSeq + 1

      if (this.buffer.length >= this.totalLength) {
        const payload = this.buffer.slice(0, this.totalLength)
        this.reset()
        return { type: 'complete', payload }
      }
      return { type: 'partial' }
    }

    // FC (0x3) or unknown — ignore silently
    return { type: 'partial' }
  }
}

// ---------------------------------------------------------------------------
// UDS Response Parsing
// ---------------------------------------------------------------------------

/** Negative Response Codes (NRC) per ISO 14229-1 Table A-1 */
const NRC_DESCRIPTIONS: Record<number, string> = {
  0x10: 'General reject',
  0x11: 'Service not supported',
  0x12: 'Sub-function not supported',
  0x13: 'Incorrect message length or invalid format',
  0x14: 'Response too long',
  0x21: 'Busy — repeat request',
  0x22: 'Conditions not correct',
  0x24: 'Request sequence error',
  0x25: 'No response from subnet component',
  0x26: 'Failure prevents execution of requested action',
  0x31: 'Request out of range',
  0x33: 'Security access denied',
  0x35: 'Invalid key',
  0x36: 'Exceeded number of attempts',
  0x37: 'Required time delay not expired',
  0x70: 'Upload/download not accepted',
  0x71: 'Transfer data suspended',
  0x72: 'General programming failure',
  0x73: 'Wrong block sequence counter',
  0x78: 'Request correctly received — response pending',
  0x7E: 'Sub-function not supported in active session',
  0x7F: 'Service not supported in active session',
  0x81: 'RPM too high',
  0x82: 'RPM too low',
  0x83: 'Engine is running',
  0x84: 'Engine is not running',
  0x85: 'Engine run time too low',
  0x86: 'Temperature too high',
  0x87: 'Temperature too low',
  0x88: 'Vehicle speed too high',
  0x89: 'Vehicle speed too low',
  0x8A: 'Throttle/pedal too high',
  0x8B: 'Throttle/pedal too low',
  0x8C: 'Transmission range not in neutral',
  0x8D: 'Transmission range not in gear',
  0x8F: 'Brake switch(es) not closed',
  0x90: 'Shifter lever not in park',
  0x91: 'Torque converter clutch locked',
  0x92: 'Voltage too high',
  0x93: 'Voltage too low',
}

export function describeNrc(nrc: number): string {
  return NRC_DESCRIPTIONS[nrc] ?? `Unknown NRC 0x${nrc.toString(16).toUpperCase().padStart(2, '0')}`
}

export type UdsResponseKind = 'positive' | 'negative' | 'unknown'

export interface ParsedUdsResponse {
  kind: UdsResponseKind
  /** Service ID from the request that this is a response to */
  requestSid: number
  /** Raw bytes of the UDS PDU (after ISO-TP reassembly) */
  bytes: number[]
  /** Human-readable summary */
  summary: string
}

/** Parse ISO-TP-reassembled UDS response bytes into a structured result. */
export function parseUdsResponse(bytes: number[], requestSid: number): ParsedUdsResponse {
  if (bytes.length === 0) {
    return { kind: 'unknown', requestSid, bytes, summary: 'Empty response' }
  }

  const responseByte = bytes[0]

  // Negative Response: 0x7F [requestSID] [NRC]
  if (responseByte === 0x7F) {
    const sid = bytes[1] ?? 0x00
    const nrc = bytes[2] ?? 0x00
    const desc = describeNrc(nrc)
    const nrcHex = `0x${nrc.toString(16).toUpperCase().padStart(2, '0')}`
    return {
      kind: 'negative',
      requestSid: sid,
      bytes,
      summary: `Negative response (NRC ${nrcHex}): ${desc}`,
    }
  }

  // Positive response: first byte = requestSID | 0x40
  const expectedPositive = (requestSid | 0x40) & 0xFF
  if (responseByte !== expectedPositive) {
    return {
      kind: 'unknown',
      requestSid,
      bytes,
      summary: `Unexpected response byte 0x${responseByte.toString(16).toUpperCase()}`,
    }
  }

  const summary = buildPositiveSummary(requestSid, bytes)
  return { kind: 'positive', requestSid, bytes, summary }
}

function buildPositiveSummary(sid: number, bytes: number[]): string {
  switch (sid) {
    case 0x10: { // Diagnostic Session Control
      const sessionNames: Record<number, string> = {
        0x01: 'Default Session',
        0x02: 'Programming Session',
        0x03: 'Extended Diagnostic Session',
      }
      const session = bytes[1] ?? 0
      const name = sessionNames[session] ?? `Session 0x${session.toString(16).toUpperCase()}`
      const p2ms = bytes.length >= 4 ? ((bytes[2] << 8) | bytes[3]) : null
      const p2stMs = bytes.length >= 6 ? (((bytes[4] << 8) | bytes[5]) * 10) : null
      const timing = p2ms !== null ? ` — P2=${p2ms}ms, P2*=${p2stMs}ms` : ''
      return `${name} active${timing}`
    }

    case 0x11: { // ECU Reset
      const resetNames: Record<number, string> = {
        0x01: 'Hard Reset initiated',
        0x02: 'Key Off/On Reset initiated',
        0x03: 'Soft Reset initiated',
      }
      const type = bytes[1] ?? 0
      return resetNames[type] ?? `Reset type 0x${type.toString(16).toUpperCase()} initiated`
    }

    case 0x14: // Clear DTC Information
      return 'DTCs cleared successfully'

    case 0x19: { // Read DTC Information
      const sub = bytes[1] ?? 0
      if (sub === 0x01) {
        // reportNumberOfDTCByStatusMask
        const count = bytes.length >= 6 ? ((bytes[4] << 8) | bytes[5]) : '?'
        return `${count} DTC(s) found`
      }
      if (sub === 0x02 || sub === 0x0A) {
        // reportDTCByStatusMask / reportSupportedDTC
        const dtcs = parseDtcList(bytes.slice(3)) // skip SID, sub, statusAvailMask
        if (dtcs.length === 0) return 'No DTCs found'
        return dtcs.map(d => `${d.code} [${d.status}]`).join('  ')
      }
      if (sub === 0x0F) {
        // reportFirstTestFailedDTC
        if (bytes.length < 7) return 'No first test failed DTC'
        return `First failed: ${formatDtcCode(bytes[3], bytes[4])}`
      }
      return `DTC response (sub 0x${sub.toString(16).toUpperCase()}) — ${bytes.length - 1} bytes`
    }

    case 0x22: { // Read Data By Identifier
      const did = bytes.length >= 3 ? ((bytes[1] << 8) | bytes[2]) : 0
      const data = bytes.slice(3)
      const didHex = `0x${did.toString(16).toUpperCase().padStart(4, '0')}`

      // Try to decode well-known DIDs
      if (did === 0xF190) {
        // VIN — 17 ASCII chars
        const vin = data.map(b => String.fromCharCode(b)).join('').replace(/[^\x20-\x7E]/g, '?')
        return `VIN: ${vin}`
      }
      if (did === 0xF186) {
        const sessionNames: Record<number, string> = {
          0x01: 'Default Session',
          0x02: 'Programming Session',
          0x03: 'Extended Diagnostic Session',
        }
        return `Active session: ${sessionNames[data[0] ?? 0] ?? `0x${(data[0] ?? 0).toString(16).toUpperCase()}`}`
      }

      // Generic: try ASCII, fall back to hex
      const asAscii = data.map(b => String.fromCharCode(b))
      const isPrintable = asAscii.every(c => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) <= 0x7E)
      if (isPrintable && data.length > 0) {
        return `DID ${didHex}: "${asAscii.join('')}"`
      }
      return `DID ${didHex}: ${data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`
    }

    case 0x27: { // Security Access
      const sub = bytes[1] ?? 0
      if (sub % 2 === 1) {
        // Odd sub-functions = seed response
        const seed = bytes.slice(2).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
        return `Seed received: ${seed || '(empty)'} — send key with sub-function 0x${(sub + 1).toString(16).toUpperCase().padStart(2, '0')}`
      }
      return 'Security access granted'
    }

    case 0x28: { // Communication Control
      const sub = bytes[1] ?? 0
      const names: Record<number, string> = {
        0x00: 'Rx + Tx enabled',
        0x01: 'Rx enabled, Tx disabled',
        0x02: 'Rx disabled, Tx enabled',
        0x03: 'Rx + Tx disabled',
      }
      return names[sub] ?? `Communication control confirmed (sub 0x${sub.toString(16).toUpperCase()})`
    }

    case 0x2E: { // Write Data By Identifier
      const did = bytes.length >= 3 ? ((bytes[1] << 8) | bytes[2]) : 0
      return `Write to DID 0x${did.toString(16).toUpperCase().padStart(4, '0')} confirmed`
    }

    case 0x31: { // Routine Control
      const sub = bytes[1] ?? 0
      const rid = bytes.length >= 4 ? ((bytes[2] << 8) | bytes[3]) : 0
      const subNames: Record<number, string> = {
        0x01: 'Routine started',
        0x02: 'Routine stopped',
        0x03: 'Routine results',
      }
      const result = bytes.slice(4)
      const extra = result.length > 0
        ? `: ${result.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`
        : ''
      return `${subNames[sub] ?? 'Routine response'} — ID 0x${rid.toString(16).toUpperCase().padStart(4, '0')}${extra}`
    }

    case 0x3E: // Tester Present
      return 'Tester Present acknowledged'

    case 0x85: { // Control DTC Setting
      const sub = bytes[1] ?? 0
      return sub === 0x01 ? 'DTC setting enabled' : 'DTC setting disabled'
    }

    default: {
      const responseHex = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
      return `Response: ${responseHex}`
    }
  }
}

// ---------------------------------------------------------------------------
// DTC Helpers
// ---------------------------------------------------------------------------

/** Format two DTC bytes into a code like "P0300". Uses ISO 15031-6 encoding. */
export function formatDtcCode(byte1: number, byte2: number): string {
  const system = ['P', 'C', 'B', 'U'][(byte1 >> 6) & 0x03]
  const d1 = (byte1 >> 4) & 0x03   // 0–3, always decimal
  const d2 = (byte1 & 0x0F).toString(16).toUpperCase()
  const d3 = ((byte2 >> 4) & 0x0F).toString(16).toUpperCase()
  const d4 = (byte2 & 0x0F).toString(16).toUpperCase()
  return `${system}${d1}${d2}${d3}${d4}`
}

/** Decode the 8-bit DTC status byte into human-readable flags. */
export function decodeDtcStatus(status: number): string {
  const flags: string[] = []
  if (status & 0x80) flags.push('MIL')
  if (status & 0x20) flags.push('failedSinceCleared')
  if (status & 0x08) flags.push('confirmed')
  if (status & 0x04) flags.push('pending')
  if (status & 0x01) flags.push('active')
  return flags.length ? flags.join(', ') : 'inactive'
}

interface DtcEntry {
  code: string
  status: string
  bytes: number[]
}

/** Parse a flat array of [B1, B2, B3_failureType, statusByte, ...] DTC records. */
export function parseDtcList(bytes: number[]): DtcEntry[] {
  const dtcs: DtcEntry[] = []
  // UDS DTCs are 3 bytes + 1 status byte = 4 bytes per record
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    dtcs.push({
      code: formatDtcCode(bytes[i], bytes[i + 1]),
      status: decodeDtcStatus(bytes[i + 3]),
      bytes: [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]],
    })
  }
  return dtcs
}

// ---------------------------------------------------------------------------
// Hex Utilities
// ---------------------------------------------------------------------------

export function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

export function hexToBytes(hex: string): number[] {
  // Accept "AA BB CC" or "AABBCC" formats
  const cleaned = hex.replace(/\s+/g, '').replace(/[^0-9a-fA-F]/g, '')
  const out: number[] = []
  for (let i = 0; i < cleaned.length - 1; i += 2) {
    out.push(parseInt(cleaned.slice(i, i + 2), 16))
  }
  return out
}
