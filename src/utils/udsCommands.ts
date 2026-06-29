/**
 * UDS Command Catalog — ISO 14229-1 Service Definitions
 *
 * Each entry defines one UDS service: its ID, human-readable name, description,
 * the parameters the user must fill in, and how to build the raw UDS request bytes.
 *
 * HOW TO ADD A NEW COMMAND:
 *   1. Define a new UdsCommandDef object with a unique `id` string.
 *   2. Set `sid` to the UDS Service Identifier (see ISO 14229-1 Annex A).
 *   3. Add it to the UDS_COMMANDS array below.
 *   4. If the response needs special parsing, update buildPositiveSummary() in udsProtocol.ts.
 *
 * PARAMETER TYPES:
 *   'select'      — dropdown; provide `options` array
 *   'hex-byte'    — single byte hex input (00–FF)
 *   'hex-word'    — two-byte hex input (0000–FFFF)
 *   'hex-3bytes'  — three-byte hex input (000000–FFFFFF)
 *   'hex-bytes'   — arbitrary hex string (space-separated or continuous)
 *   'number'      — integer input
 */

export type ParamType = 'select' | 'hex-byte' | 'hex-word' | 'hex-3bytes' | 'hex-bytes' | 'number'

export interface SelectOption {
  value: number
  label: string
}

export interface UdsCommandParam {
  key: string
  label: string
  type: ParamType
  /** For 'select' type — the dropdown choices */
  options?: SelectOption[]
  /** For hex inputs — preset shortcuts shown in a secondary dropdown */
  presets?: SelectOption[]
  default?: string
  placeholder?: string
  description?: string
}

export type UdsCategory =
  | 'session'    // Session management and ECU reset
  | 'data'       // Read/Write data
  | 'dtc'        // DTC management
  | 'security'   // Security access and communication control
  | 'routine'    // Routine control
  | 'obd2'       // OBD-II mode commands (separate protocol, different CAN IDs)

export interface UdsCommandDef {
  /** Unique identifier used as React key and session storage key */
  id: string
  /** UDS Service Identifier (SID) byte. OBD-II mode byte for obd2 category. */
  sid: number
  /** Short display name */
  name: string
  /** Longer description shown in the UI */
  description: string
  category: UdsCategory
  /** Parameters the user fills in before sending */
  params: UdsCommandParam[]
  /**
   * Builds the UDS request payload bytes from user-entered param values.
   * Returns the raw UDS bytes (NOT ISO-TP wrapped — that is done in the transport layer).
   */
  buildRequest: (params: Record<string, string>) => number[]
  /**
   * Optional note about the response (e.g. "ECU will reboot — no response expected").
   * Displayed as a hint in the UI.
   */
  responseNote?: string
  /**
   * Whether this command returns data that makes sense to poll on a timer.
   * Enables the "Live Poll" button in the UI.
   */
  pollable?: boolean
}

// ---------------------------------------------------------------------------
// SESSION & CONTROL  (SID 0x10, 0x11, 0x3E)
// ---------------------------------------------------------------------------

const diagnosticSessionControl: UdsCommandDef = {
  id: 'diagnosticSessionControl',
  sid: 0x10,
  name: 'Diagnostic Session Control',
  description:
    'Switches the ECU into a different diagnostic session. Extended and Programming sessions '
    + 'unlock additional services. The ECU returns to Default Session if no Tester Present is sent within P3.',
  category: 'session',
  params: [
    {
      key: 'sessionType',
      label: 'Session Type',
      type: 'select',
      options: [
        { value: 0x01, label: '0x01 — Default Session' },
        { value: 0x02, label: '0x02 — Programming Session' },
        { value: 0x03, label: '0x03 — Extended Diagnostic Session' },
        // Manufacturers may define 0x04–0x7F as proprietary sessions
        { value: 0x60, label: '0x60 — System Supplier Specific (common)' },
      ],
      default: '3',
    },
  ],
  buildRequest: (p) => [0x10, parseInt(p.sessionType ?? '1')],
}

const ecuReset: UdsCommandDef = {
  id: 'ecuReset',
  sid: 0x11,
  name: 'ECU Reset',
  description:
    'Commands the ECU to perform a hardware or software reset. Hard Reset is equivalent to a '
    + 'power cycle. Soft Reset preserves non-volatile data and resets only the software stack.',
  category: 'session',
  params: [
    {
      key: 'resetType',
      label: 'Reset Type',
      type: 'select',
      options: [
        { value: 0x01, label: '0x01 — Hard Reset (power cycle equivalent)' },
        { value: 0x02, label: '0x02 — Key Off / Key On Reset' },
        { value: 0x03, label: '0x03 — Soft Reset (software reboot only)' },
      ],
      default: '1',
    },
  ],
  buildRequest: (p) => [0x11, parseInt(p.resetType ?? '1')],
  responseNote: 'ECU may not send a response before resetting (especially Hard Reset).',
}

const testerPresent: UdsCommandDef = {
  id: 'testerPresent',
  sid: 0x3E,
  name: 'Tester Present',
  description:
    'Heartbeat message that keeps the ECU in its current session. Must be sent within P3 '
    + '(typically 5 s) to prevent the ECU from reverting to Default Session.',
  category: 'session',
  params: [],
  buildRequest: () => [0x3E, 0x00], // sub-function 0x00 = respond
}

// ---------------------------------------------------------------------------
// DATA  (SID 0x22, 0x23, 0x2E)
// ---------------------------------------------------------------------------

const readDataByIdentifier: UdsCommandDef = {
  id: 'readDataByIdentifier',
  sid: 0x22,
  pollable: true,
  name: 'Read Data By Identifier',
  description:
    'Reads a data record identified by a 2-byte Data Identifier (DID). '
    + 'Standardized DIDs start at 0xF100; manufacturer-specific DIDs vary by OEM.',
  category: 'data',
  params: [
    {
      key: 'did',
      label: 'Data Identifier (2 bytes hex)',
      type: 'hex-word',
      placeholder: 'F190',
      default: 'F190',
      description: 'Select a preset or type any 4-hex-digit DID.',
      // Common standardized DIDs per ISO 14229-1 Table C.1
      presets: [
        { value: 0xF186, label: 'F186 — Active Diagnostic Session' },
        { value: 0xF187, label: 'F187 — Spare Part Number' },
        { value: 0xF188, label: 'F188 — Programming Date' },
        { value: 0xF189, label: 'F189 — Diagnostic Spec Version' },
        { value: 0xF18A, label: 'F18A — ECU Hardware Version' },
        { value: 0xF18B, label: 'F18B — ECU Manufacture Date' },
        { value: 0xF18C, label: 'F18C — ECU Serial Number' },
        { value: 0xF18E, label: 'F18E — Software Calibration Numbers' },
        { value: 0xF190, label: 'F190 — VIN (Vehicle ID Number)' },
        { value: 0xF191, label: 'F191 — ECU Hardware Number' },
        { value: 0xF192, label: 'F192 — System Supplier Software Number' },
        { value: 0xF193, label: 'F193 — System Supplier Software Version' },
        { value: 0xF194, label: 'F194 — System Supplier Identifier' },
        { value: 0xF197, label: 'F197 — System Name / Engine Type' },
        { value: 0xF199, label: 'F199 — Programming Date' },
        { value: 0xF1A0, label: 'F1A0 — Deployed SW Identifiers (GM common)' },
      ],
    },
  ],
  buildRequest: (p) => {
    const did = parseInt(p.did ?? 'F190', 16) || 0xF190
    return [0x22, (did >> 8) & 0xFF, did & 0xFF]
  },
}

const readMemoryByAddress: UdsCommandDef = {
  id: 'readMemoryByAddress',
  sid: 0x23,
  name: 'Read Memory By Address',
  description:
    'Reads raw memory from the ECU at a specific address. Not all ECUs support this service; '
    + 'it is often locked behind security access.',
  category: 'data',
  params: [
    {
      key: 'address',
      label: 'Memory Address (4 bytes hex)',
      type: 'hex-bytes',
      placeholder: '00 00 80 00',
      default: '00 00 80 00',
      description: 'Start address as 4 hex bytes (big-endian).',
    },
    {
      key: 'length',
      label: 'Read Length (1 byte hex)',
      type: 'hex-byte',
      placeholder: '10',
      default: '10',
      description: 'Number of bytes to read (0x01–0xFF).',
    },
  ],
  buildRequest: (p) => {
    // addressAndLengthFormatIdentifier: 0x14 = 1 byte size, 4 byte address
    const addrBytes = (p.address ?? '00008000')
      .replace(/\s+/g, '').match(/.{1,2}/g)
      ?.map(h => parseInt(h, 16)) ?? [0x00, 0x00, 0x80, 0x00]
    const len = parseInt(p.length ?? '10', 16) || 0x10
    return [0x23, 0x14, ...addrBytes.slice(0, 4), len]
  },
}

const writeDataByIdentifier: UdsCommandDef = {
  id: 'writeDataByIdentifier',
  sid: 0x2E,
  name: 'Write Data By Identifier',
  description:
    'Writes a value to a DID. Usually requires Extended Diagnostic Session and/or Security Access. '
    + 'Use with caution — incorrect values may render ECU inoperable.',
  category: 'data',
  params: [
    {
      key: 'did',
      label: 'Data Identifier (2 bytes hex)',
      type: 'hex-word',
      placeholder: 'F190',
    },
    {
      key: 'data',
      label: 'Data Bytes (hex)',
      type: 'hex-bytes',
      placeholder: '01 02 03 04',
      description: 'Space-separated hex bytes to write.',
    },
  ],
  buildRequest: (p) => {
    const did = parseInt(p.did ?? '0000', 16) || 0
    const dataBytes = (p.data ?? '').replace(/\s+/g, '').match(/.{1,2}/g)
      ?.map(h => parseInt(h, 16)) ?? []
    return [0x2E, (did >> 8) & 0xFF, did & 0xFF, ...dataBytes]
  },
}

// ---------------------------------------------------------------------------
// DTC MANAGEMENT  (SID 0x14, 0x19, 0x85)
// ---------------------------------------------------------------------------

const clearDtcInformation: UdsCommandDef = {
  id: 'clearDtcInformation',
  sid: 0x14,
  name: 'Clear DTC Information',
  description:
    'Clears stored DTCs and associated data. 0xFFFFFF clears all groups. '
    + 'Specific group codes allow clearing only powertrain (0x000000), '
    + 'chassis (0x400000), body (0x800000), or network (0xC00000) DTCs.',
  category: 'dtc',
  params: [
    {
      key: 'groupOfDtc',
      label: 'Group of DTC (3 bytes hex)',
      type: 'hex-3bytes',
      placeholder: 'FFFFFF',
      default: 'FFFFFF',
      description: '0xFFFFFF = all DTCs. See ISO 14229-1 Table 195 for group codes.',
    },
  ],
  buildRequest: (p) => {
    const g = parseInt((p.groupOfDtc ?? 'FFFFFF').replace(/\s+/g, ''), 16) || 0xFFFFFF
    return [0x14, (g >> 16) & 0xFF, (g >> 8) & 0xFF, g & 0xFF]
  },
  responseNote: 'ECU returns a positive response only after all DTCs in the group are cleared.',
}

const readDtcInformation: UdsCommandDef = {
  id: 'readDtcInformation',
  sid: 0x19,
  name: 'Read DTC Information',
  description:
    'Reads DTC counts, codes, snapshots, or extended data records. '
    + 'The sub-function selects the type of DTC data to return.',
  category: 'dtc',
  params: [
    {
      key: 'subFunction',
      label: 'Sub-Function',
      type: 'select',
      options: [
        { value: 0x01, label: '0x01 — Report Number of DTCs by Status Mask' },
        { value: 0x02, label: '0x02 — Report DTCs by Status Mask' },
        { value: 0x04, label: '0x04 — Report DTC Snapshot Identifications' },
        { value: 0x06, label: '0x06 — Report DTC Snapshot Record by DTC Number' },
        { value: 0x09, label: '0x09 — Report DTC Extended Data by DTC Number' },
        { value: 0x0A, label: '0x0A — Report Supported DTCs' },
        { value: 0x0F, label: '0x0F — Report First Test Failed DTC' },
        { value: 0x11, label: '0x11 — Report First Confirmed DTC' },
        { value: 0x12, label: '0x12 — Report Most Recent Test Failed DTC' },
        { value: 0x13, label: '0x13 — Report Most Recent Confirmed DTC' },
        { value: 0x17, label: '0x17 — Report User Def Memory DTC by Status Mask' },
      ],
      default: '2',
    },
    {
      key: 'statusMask',
      label: 'DTC Status Mask (hex byte)',
      type: 'hex-byte',
      placeholder: 'FF',
      default: 'FF',
      // Status mask bit definitions per ISO 14229-1 Table D.1:
      // Bit 0: testFailed (currently active)
      // Bit 1: testFailedThisMonitoringCycle
      // Bit 2: pendingDTC
      // Bit 3: confirmedDTC
      // Bit 4: testNotCompletedSinceLastClear
      // Bit 5: testFailedSinceLastClear
      // Bit 6: testNotCompletedThisMonitoringCycle
      // Bit 7: warningIndicatorRequested (MIL on)
      description: '0xFF = all status bits. Bit 3 = confirmed, Bit 0 = currently active.',
    },
  ],
  buildRequest: (p) => {
    const sub = parseInt(p.subFunction ?? '2')
    const mask = parseInt(p.statusMask ?? 'FF', 16) || 0xFF
    return [0x19, sub, mask]
  },
}

const controlDtcSetting: UdsCommandDef = {
  id: 'controlDtcSetting',
  sid: 0x85,
  name: 'Control DTC Setting',
  description:
    'Enables or disables DTC detection. Disabling prevents the ECU from setting new DTCs '
    + '— useful during programming or calibration to avoid spurious codes.',
  category: 'dtc',
  params: [
    {
      key: 'dtcSetting',
      label: 'DTC Setting',
      type: 'select',
      options: [
        { value: 0x01, label: '0x01 — Enable DTC Setting (on)' },
        { value: 0x02, label: '0x02 — Disable DTC Setting (off)' },
      ],
      default: '1',
    },
  ],
  buildRequest: (p) => [0x85, parseInt(p.dtcSetting ?? '1')],
}

// ---------------------------------------------------------------------------
// SECURITY  (SID 0x27, 0x28)
// ---------------------------------------------------------------------------

const securityAccess: UdsCommandDef = {
  id: 'securityAccess',
  sid: 0x27,
  name: 'Security Access',
  description:
    'Two-step challenge-response process. Step 1: send odd sub-function to request a seed. '
    + 'Step 2: compute the key from the seed (algorithm is manufacturer-specific) and send it '
    + 'with sub-function + 1 (even). Incorrect keys may trigger a lockout.',
  category: 'security',
  params: [
    {
      key: 'subFunction',
      label: 'Sub-Function',
      type: 'select',
      options: [
        { value: 0x01, label: '0x01 — Request Seed (Level 1)' },
        { value: 0x02, label: '0x02 — Send Key (Level 1)' },
        { value: 0x03, label: '0x03 — Request Seed (Level 2)' },
        { value: 0x04, label: '0x04 — Send Key (Level 2)' },
        { value: 0x11, label: '0x11 — Request Seed (Programming Level)' },
        { value: 0x12, label: '0x12 — Send Key (Programming Level)' },
      ],
      default: '1',
    },
    {
      key: 'keyBytes',
      label: 'Key Bytes (hex, only for Send Key steps)',
      type: 'hex-bytes',
      placeholder: 'AA BB CC DD',
      default: '',
      description: 'Leave empty when requesting a seed (odd sub-functions).',
    },
  ],
  buildRequest: (p) => {
    const sub = parseInt(p.subFunction ?? '1')
    const isKeyStep = sub % 2 === 0
    if (isKeyStep && p.keyBytes) {
      const keyBytes = (p.keyBytes).replace(/\s+/g, '').match(/.{1,2}/g)
        ?.map(h => parseInt(h, 16)) ?? []
      return [0x27, sub, ...keyBytes]
    }
    return [0x27, sub]
  },
}

const communicationControl: UdsCommandDef = {
  id: 'communicationControl',
  sid: 0x28,
  name: 'Communication Control',
  description:
    'Enables or disables transmission/reception of specific message types. '
    + 'Used during programming to suppress normal bus traffic and avoid flooding.',
  category: 'security',
  params: [
    {
      key: 'controlType',
      label: 'Control Type',
      type: 'select',
      options: [
        { value: 0x00, label: '0x00 — Enable Rx and Tx' },
        { value: 0x01, label: '0x01 — Enable Rx, Disable Tx' },
        { value: 0x02, label: '0x02 — Disable Rx, Enable Tx' },
        { value: 0x03, label: '0x03 — Disable Rx and Tx' },
      ],
      default: '1',
    },
    {
      key: 'communicationType',
      label: 'Communication Type',
      type: 'select',
      options: [
        { value: 0x01, label: '0x01 — Normal Messages (application)' },
        { value: 0x02, label: '0x02 — NM (Network Management) Messages' },
        { value: 0x03, label: '0x03 — Network Management + Normal Messages' },
      ],
      default: '1',
    },
  ],
  buildRequest: (p) => [0x28, parseInt(p.controlType ?? '1'), parseInt(p.communicationType ?? '1')],
}

// ---------------------------------------------------------------------------
// ROUTINE CONTROL  (SID 0x31)
// ---------------------------------------------------------------------------

const routineControl: UdsCommandDef = {
  id: 'routineControl',
  sid: 0x31,
  name: 'Routine Control',
  description:
    'Starts, stops, or requests results of a routine identified by a 2-byte Routine ID. '
    + 'Routines are manufacturer-defined; common examples include memory erase, checksum verify, '
    + 'and actuator tests.',
  category: 'routine',
  params: [
    {
      key: 'subFunction',
      label: 'Sub-Function',
      type: 'select',
      options: [
        { value: 0x01, label: '0x01 — Start Routine' },
        { value: 0x02, label: '0x02 — Stop Routine' },
        { value: 0x03, label: '0x03 — Request Routine Results' },
      ],
      default: '1',
    },
    {
      key: 'routineId',
      label: 'Routine Identifier (2 bytes hex)',
      type: 'hex-word',
      placeholder: 'FF00',
      default: 'FF00',
      // Common standardized routine IDs:
      // 0xFF00 — Erase Memory
      // 0xFF01 — Check Memory (checksum verification)
      // 0xFF02 — Check Programming Dependencies
      // 0x0202 — Check Programming Preconditions
      // 0x0203 — Check Programming Pre-Conditions (GM)
      presets: [
        { value: 0xFF00, label: 'FF00 — Erase Memory' },
        { value: 0xFF01, label: 'FF01 — Check Memory (checksum)' },
        { value: 0xFF02, label: 'FF02 — Check Programming Dependencies' },
        { value: 0x0202, label: '0202 — Check Programming Preconditions' },
      ],
    },
    {
      key: 'optParams',
      label: 'Optional Parameters (hex)',
      type: 'hex-bytes',
      placeholder: '',
      default: '',
      description: 'Additional bytes appended after the Routine ID (routine-specific).',
    },
  ],
  buildRequest: (p) => {
    const sub = parseInt(p.subFunction ?? '1')
    const rid = parseInt(p.routineId ?? 'FF00', 16) || 0xFF00
    const opt = (p.optParams ?? '').replace(/\s+/g, '').match(/.{1,2}/g)
      ?.map(h => parseInt(h, 16)) ?? []
    return [0x31, sub, (rid >> 8) & 0xFF, rid & 0xFF, ...opt]
  },
}

// ---------------------------------------------------------------------------
// OBD-II (ISO 15031 / SAE J1979)
// These use different CAN IDs (0x7DF request, 0x7E8–0x7EF responses)
// and a different frame format from UDS proper.
// ---------------------------------------------------------------------------

const obdCurrentData: UdsCommandDef = {
  id: 'obdCurrentData',
  sid: 0x01,
  pollable: true,
  name: 'OBD-II Mode 01 — Current Data',
  description:
    'Request real-time vehicle data (OBD-II). Uses broadcast ID 0x7DF; responses come from '
    + '0x7E8–0x7EF. Standard PIDs are defined in SAE J1979/ISO 15031-5.',
  category: 'obd2',
  params: [
    {
      key: 'pid',
      label: 'PID',
      type: 'select',
      options: [
        { value: 0x00, label: '0x00 — Supported PIDs 01–20' },
        { value: 0x01, label: '0x01 — Monitor Status Since DTCs Cleared' },
        { value: 0x04, label: '0x04 — Calculated Engine Load (%)' },
        { value: 0x05, label: '0x05 — Engine Coolant Temperature (°C)' },
        { value: 0x06, label: '0x06 — Short Term Fuel Trim Bank 1 (%)' },
        { value: 0x07, label: '0x07 — Long Term Fuel Trim Bank 1 (%)' },
        { value: 0x0B, label: '0x0B — Intake Manifold Absolute Pressure (kPa)' },
        { value: 0x0C, label: '0x0C — Engine Speed (RPM)' },
        { value: 0x0D, label: '0x0D — Vehicle Speed (km/h)' },
        { value: 0x0E, label: '0x0E — Timing Advance (°)' },
        { value: 0x0F, label: '0x0F — Intake Air Temperature (°C)' },
        { value: 0x10, label: '0x10 — MAF Air Flow Rate (g/s)' },
        { value: 0x11, label: '0x11 — Throttle Position (%)' },
        { value: 0x1C, label: '0x1C — OBD Standard Supported' },
        { value: 0x1F, label: '0x1F — Run Time Since Engine Start (s)' },
        { value: 0x20, label: '0x20 — Supported PIDs 21–40' },
        { value: 0x2F, label: '0x2F — Fuel Tank Level Input (%)' },
        { value: 0x31, label: '0x31 — Distance Since DTCs Cleared (km)' },
        { value: 0x33, label: '0x33 — Barometric Pressure (kPa)' },
        { value: 0x40, label: '0x40 — Supported PIDs 41–60' },
        { value: 0x42, label: '0x42 — Control Module Voltage (V)' },
        { value: 0x46, label: '0x46 — Ambient Air Temperature (°C)' },
        { value: 0x4D, label: '0x4D — Time Run with MIL On (min)' },
        { value: 0x4E, label: '0x4E — Time Since DTCs Cleared (min)' },
        { value: 0x5C, label: '0x5C — Engine Oil Temperature (°C)' },
        { value: 0x5E, label: '0x5E — Engine Fuel Rate (L/h)' },
        { value: 0x60, label: '0x60 — Supported PIDs 61–80' },
      ],
      default: '12', // 0x0C = RPM
    },
  ],
  buildRequest: (p) => {
    const pid = parseInt(p.pid ?? '12')
    // OBD-II single-frame request: [0x02, mode, pid] (0x02 = ISO-TP SF length)
    return [0x01, pid]
  },
}

const obdStoredDtcs: UdsCommandDef = {
  id: 'obdStoredDtcs',
  sid: 0x03,
  name: 'OBD-II Mode 03 — Stored DTCs',
  description: 'Request stored (confirmed) emission-related Diagnostic Trouble Codes.',
  category: 'obd2',
  params: [],
  buildRequest: () => [0x03],
}

const obdClearDtcs: UdsCommandDef = {
  id: 'obdClearDtcs',
  sid: 0x04,
  name: 'OBD-II Mode 04 — Clear DTCs',
  description:
    'Clears emission-related DTCs and resets readiness monitors. '
    + 'Equivalent to UDS 0x14 but for OBD-II emission systems only.',
  category: 'obd2',
  params: [],
  buildRequest: () => [0x04],
}

const obdPendingDtcs: UdsCommandDef = {
  id: 'obdPendingDtcs',
  sid: 0x07,
  name: 'OBD-II Mode 07 — Pending DTCs',
  description: 'Returns pending (not yet confirmed) emission-related DTCs detected in the current cycle.',
  category: 'obd2',
  params: [],
  buildRequest: () => [0x07],
}

const obdVehicleInfo: UdsCommandDef = {
  id: 'obdVehicleInfo',
  sid: 0x09,
  name: 'OBD-II Mode 09 — Vehicle Info',
  description: 'Read vehicle-level identifiers like VIN and calibration IDs.',
  category: 'obd2',
  params: [
    {
      key: 'infotype',
      label: 'Info Type',
      type: 'select',
      options: [
        { value: 0x00, label: '0x00 — Supported Info Types' },
        { value: 0x02, label: '0x02 — VIN (Vehicle Identification Number)' },
        { value: 0x04, label: '0x04 — Calibration ID' },
        { value: 0x06, label: '0x06 — CVN (Calibration Verification Number)' },
        { value: 0x0A, label: '0x0A — ECU Name' },
      ],
      default: '2',
    },
  ],
  buildRequest: (p) => [0x09, parseInt(p.infotype ?? '2')],
}

// ---------------------------------------------------------------------------
// Master Catalog
// To add a new command: create a UdsCommandDef above and append it here.
// ---------------------------------------------------------------------------

export const UDS_COMMANDS: UdsCommandDef[] = [
  // Session & Control
  diagnosticSessionControl,
  ecuReset,
  testerPresent,
  // Data
  readDataByIdentifier,
  readMemoryByAddress,
  writeDataByIdentifier,
  // DTC Management
  readDtcInformation,
  clearDtcInformation,
  controlDtcSetting,
  // Security
  securityAccess,
  communicationControl,
  // Routine
  routineControl,
  // OBD-II
  obdCurrentData,
  obdStoredDtcs,
  obdPendingDtcs,
  obdClearDtcs,
  obdVehicleInfo,
]

export const CATEGORY_LABELS: Record<UdsCategory, string> = {
  session:  'Session / Reset',
  data:     'Data',
  dtc:      'DTCs',
  security: 'Security',
  routine:  'Routine',
  obd2:     'OBD-II',
}

export const CATEGORIES: UdsCategory[] = ['session', 'data', 'dtc', 'security', 'routine', 'obd2']
