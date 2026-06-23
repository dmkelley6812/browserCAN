export interface CanFrame {
  timestamp: number
  id: number
  idHex: string
  extended: boolean
  remoteFrame: boolean
  dlc: number
  bytes: number[]
}

export interface CanIdSummary {
  id: number
  idHex: string
  dlc: number
  frameCount: number
  firstSeen: number
  lastSeen: number
  frames: CanFrame[]
  isChanging: boolean
  byteChangeMask: boolean[] // which bytes ever change
  minBytes: number[]
  maxBytes: number[]
}
