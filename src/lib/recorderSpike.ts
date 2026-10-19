// Phase 1 run-recorder spike (throwaway): the JS face of the native
// WaymarkRecorderSpike plugin (ios/App/App/WaymarkRecorderSpikePlugin.swift).
// iOS only; on web every call rejects. Sampling and the journal are native, so
// nothing here runs while the phone is locked.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface SpikePeripheral {
  id: string
  name: string
  rssi: number
}

export interface SpikeNativeSummary {
  samples: number
  bgSeconds: number
  lockedSeconds: number
  hrNotifications: number
  rrPackets: number
  rrValues: number
  flagsSeen: string[]
  contactCounts: { unsupported: number; contact: number; noContact: number }
  disconnects: number
  reconnects: number
  locationUpdates: number
  path: string
  startedAt?: number
  endedAt?: number
  durationSec?: number
}

export interface SpikeStatus extends SpikeNativeSummary {
  recording: boolean
  interruptedRun: boolean
  scanning: boolean
  centralState: string
  bleAuth: string
  bleState: string
  locationAuth: string
  appState: 'fg' | 'bg'
  locked: boolean
  found: SpikePeripheral[]
  savedId?: string
  savedName?: string
  battery?: number
  hr?: number
  hrAgeSec?: number
  flagsHex?: string
  contact?: string
  lastRr: number[]
  lat?: number
  lon?: number
  hAcc?: number
  speed?: number
  alt?: number
  locAgeSec?: number
}

export interface SpikeHrEvent {
  t: number
  hr: number
  flagsHex: string
  rr: number[]
  contact: string
  energy?: number
}

export interface SpikeLocationEvent {
  t: number
  lat: number
  lon: number
  hAcc: number
  speed: number
  alt: number
}

interface RecorderSpikePlugin {
  scan(): Promise<{ scanning: boolean; centralState: string }>
  stopScan(): Promise<void>
  connect(options: { id: string }): Promise<{ id: string; name: string }>
  forget(): Promise<void>
  start(): Promise<{ startedAt: number; path: string }>
  stop(): Promise<SpikeNativeSummary>
  status(): Promise<SpikeStatus>
  exportJournal(options: { share?: boolean }): Promise<{ path: string; bytes?: number; contents?: string; shared?: boolean }>
  clear(): Promise<{ deleted: number }>
  addListener(eventName: 'hr', listener: (e: SpikeHrEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'location', listener: (e: SpikeLocationEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'status', listener: (e: SpikeStatus) => void): Promise<PluginListenerHandle>
}

const unsupported = () => Promise.reject(new Error('The recorder spike only runs in the iPhone app.'))

const webStub: RecorderSpikePlugin = {
  scan: unsupported,
  stopScan: unsupported,
  connect: unsupported,
  forget: unsupported,
  start: unsupported,
  stop: unsupported,
  status: unsupported,
  exportJournal: unsupported,
  clear: unsupported,
  addListener: unsupported,
}

export const isRecorderSpikeAvailable = Capacitor.getPlatform() === 'ios'

export const recorderSpike: RecorderSpikePlugin = isRecorderSpikeAvailable
  ? registerPlugin<RecorderSpikePlugin>('WaymarkRecorderSpike')
  : webStub
