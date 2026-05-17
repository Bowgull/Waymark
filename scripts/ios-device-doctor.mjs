import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const dir = mkdtempSync(join(tmpdir(), 'waymark-ios-devices-'))
const jsonPath = join(dir, 'devices.json')

try {
  const result = spawnSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', jsonPath, '--quiet'], {
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'devicectl failed.\n')
    process.exit(result.status ?? 1)
  }

  const data = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const devices = data.result?.devices ?? []

  if (devices.length === 0) {
    console.log('No iOS devices known to Xcode.')
    process.exit(1)
  }

  let readyCount = 0

  for (const device of devices) {
    const props = device.deviceProperties ?? {}
    const hardware = device.hardwareProperties ?? {}
    const connection = device.connectionProperties ?? {}

    const name = props.name ?? 'Unnamed device'
    const model = hardware.marketingName ?? hardware.productType ?? 'Unknown model'
    const os = props.osVersionNumber ?? 'unknown iOS'
    const identifier = device.identifier ?? 'unknown-id'
    const udid = hardware.udid ?? 'unknown-udid'
    const paired = connection.pairingState === 'paired'
    const developerMode = props.developerModeStatus === 'enabled'
    const ddiReady = props.ddiServicesAvailable === true
    const tunnelReady = connection.tunnelState && connection.tunnelState !== 'unavailable'
    const ready = paired && developerMode && ddiReady && tunnelReady

    if (ready) readyCount += 1

    console.log(`${ready ? 'READY' : 'BLOCKED'} ${name} (${model}, iOS ${os})`)
    console.log(`  CoreDevice id: ${identifier}`)
    console.log(`  UDID: ${udid}`)
    console.log(`  paired: ${paired ? 'yes' : 'no'}`)
    console.log(`  developer mode: ${developerMode ? 'enabled' : props.developerModeStatus ?? 'unknown'}`)
    console.log(`  DDI services: ${ddiReady ? 'available' : 'unavailable'}`)
    console.log(`  tunnel: ${connection.tunnelState ?? 'unknown'}`)
  }

  if (readyCount > 0) {
    console.log(`Ready devices: ${readyCount}. Xcode can attempt install.`)
    process.exit(0)
  }

  console.log('No install-ready device. Wake the phone, trust this Mac, keep the screen awake, then rerun npm run ios:doctor.')
  process.exit(1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
