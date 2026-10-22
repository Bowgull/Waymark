import Foundation
import UIKit
import CoreBluetooth
import CoreLocation
import ActivityKit
import Capacitor

// The run recorder (mockup page 74, approved; plan: waymark-research
// built-in-run-recording.md + ble-strap-deep-dive.md). Grown from the phase 1
// spike (WaymarkRecorderSpikePlugin): the same BLE + GPS core, hardened.
//
// Everything that matters runs natively, never in the WebView (asleep while
// the phone is locked):
//   - the heart-rate strap (COOSPO H9Z) over CoreBluetooth: the standard Heart
//     Rate Service 0x180D / Heart Rate Measurement 0x2A37. Remembered by its
//     identifier, linked by itself when a run starts, reconnected forever after
//     a drop (a CoreBluetooth connect never times out), state restoration, and a
//     "connected but silent" watchdog (no heart rate for 10 s: re-subscribe;
//     20 s: reconnect);
//   - GPS distance with CoreLocation in the background (When In Use, started in
//     the foreground, allowsBackgroundLocationUpdates, a CLBackgroundActivitySession
//     held for the whole run, no auto-pause), with accuracy, staleness, speed
//     and drift filters;
//   - the 1 Hz sample clock and the journal on the phone (Application Support,
//     JSON lines, writable while locked), so a killed app resumes the run;
//   - the Live Activity's heart rate, zone colour and distance while locked
//     (local ActivityKit updates, throttled: on a zone change, or every 5 s at
//     most when the number moved).
// JS gets throttled ticks while the app is open, and the finished recording.
//
// Licence note: no third-party code is copied here. The GPS filter follows the
// public guidance in Apple's CoreLocation docs; FreePace (MIT) and OpenTracks
// (Apache-2.0) were read for patterns only. No GPL/AGPL source was used.
//
// All state is touched on the main queue only (CoreBluetooth queue nil = main,
// CLLocationManager created on main, the timers on main, plugin calls hop to main).
@objc(WaymarkRunRecorderPlugin)
public class WaymarkRunRecorderPlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate, CBPeripheralDelegate, CLLocationManagerDelegate {
    public let identifier = "WaymarkRunRecorderPlugin"
    public let jsName = "WaymarkRunRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "strapStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connectStrap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forgetStrap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unfinished", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ackUploaded", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
    ]

    // MARK: constants

    // The spike's keys, kept so a strap paired in the spike stays remembered.
    private static let restoreId = "com.joshbocas.app.recorderSpike.central"
    private static let keyPeripheralId = "waymark.recorderSpike.peripheralId"
    private static let keyPeripheralName = "waymark.recorderSpike.peripheralName"
    private static let keyActiveRun = "waymark.runRecorder.activeRunId"
    private static let keyFinishedRun = "waymark.runRecorder.finishedRunId"
    private static let journalDir = "run-recordings"

    private static let silentResubscribeSec: Double = 10
    private static let silentReconnectSec: Double = 20
    private static let connectSearchSec: Double = 20
    private static let laMinIntervalSec: Double = 5
    private static let laDistanceIntervalSec: Double = 15
    private static let goldBand = 5
    private static let overSec: Double = 30

    private let hrService = CBUUID(string: "180D")
    private let hrMeasurement = CBUUID(string: "2A37")
    private let batteryService = CBUUID(string: "180F")
    private let batteryLevel = CBUUID(string: "2A19")

    // MARK: BLE state

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var hrCharacteristic: CBCharacteristic?
    private var link = "none"            // none | saved | searching | connected | silent
    private var battery: Int?
    private var lastHr: Int?
    private var lastHrT: Double?
    private var connectedAt: Double?
    private var silentSince: Double?
    private var searching = false
    private var searchCalls: [CAPPluginCall] = []
    private var searchWork: DispatchWorkItem?
    private var found: [UUID: (peripheral: CBPeripheral, name: String, rssi: Int)] = [:]
    private var watchdog: DispatchSourceTimer?

    // MARK: location state

    private var locationManager: CLLocationManager?
    private var backgroundSession: CLBackgroundActivitySession?
    private var anchor: CLLocation?
    private var acceptedFixes = 0

    // MARK: the run

    private struct Run {
        var runId: String
        var sessionId: String
        var runSessionId: String
        var outdoor: Bool
        var ceiling: Int?
        var startedAt: Double   // unix s
        var paused = false
        var t: [Int] = []
        var hr: [Int?] = []
        var moving: [Int] = []
        var distM: [Double] = []
        var distance: Double = 0
    }

    private var run: Run?
    private var finished: Run?
    private var finishedEndedAt: Double?
    private var clock: DispatchSourceTimer?
    private var journal: FileHandle?
    private var isBackground = false

    // zone (src/lib/hrZoneState.ts, the same numbers)
    private var zone = "none"
    private var overSince: Double?

    // Live Activity throttle
    private var laLastAt: Double = 0
    private var laLastHr: Int?
    private var laLastZone = ""
    private var laSeq = 0

    // MARK: lifecycle

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(onBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(onForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        if savedPeripheralId() != nil { link = "saved" }

        // A run that was recording when the app died: reload it from the journal,
        // and re-create the central (state restoration) only when Bluetooth is
        // already allowed, so nobody sees the Bluetooth prompt at launch.
        let defaults = UserDefaults.standard
        if let id = defaults.string(forKey: Self.keyActiveRun), let r = readJournal(id) {
            run = r.run
            run?.paused = true   // paused where it was until the app rejoins it
            if CBManager.authorization == .allowedAlways {
                DispatchQueue.main.async { [weak self] in self?.ensureCentral() }
            }
        } else if let id = defaults.string(forKey: Self.keyFinishedRun), let r = readJournal(id) {
            finished = r.run
            finishedEndedAt = r.endedAt
        }
    }

    @objc private func onBackground() {
        DispatchQueue.main.async { [weak self] in self?.isBackground = true }
    }

    @objc private func onForeground() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.isBackground = false
            self.emitStrap()
        }
    }

    // MARK: plugin methods: the strap

    @objc func strapStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            call.resolve(self.strapPayload())
        }
    }

    /// Settings' CONNECT HEART RATE STRAP: look for a heart-rate strap, link the
    /// strongest one heard in the first seconds (or one already linked to the
    /// phone), remember it. Resolves once linked; rejects after 20 s with none.
    @objc func connectStrap(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.searchCalls.append(call)
            if self.searching { return }
            self.searching = true
            self.found.removeAll()
            self.setLink("searching")
            let c = self.ensureCentral()
            if c.state == .poweredOn { self.startScanNow() }
            let work = DispatchWorkItem { [weak self] in self?.finishSearch(error: "No strap found. Wet the strap, put it on, and try again.") }
            self.searchWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.connectSearchSec, execute: work)
        }
    }

    @objc func forgetStrap(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            UserDefaults.standard.removeObject(forKey: Self.keyPeripheralId)
            UserDefaults.standard.removeObject(forKey: Self.keyPeripheralName)
            if let p = self.peripheral { self.central?.cancelPeripheralConnection(p) }
            self.peripheral = nil
            self.hrCharacteristic = nil
            self.lastHr = nil
            self.lastHrT = nil
            self.battery = nil
            self.stopScanNow()
            self.setLink("none")
            call.resolve()
        }
    }

    // MARK: plugin methods: the run

    @objc func start(_ call: CAPPluginCall) {
        guard let runId = call.getString("runId"), !runId.isEmpty else {
            call.reject("Missing runId")
            return
        }
        let sessionId = call.getString("sessionId") ?? ""
        let runSessionId = call.getString("runSessionId") ?? ""
        let outdoor = call.getBool("outdoor") ?? true
        let ceiling = call.getInt("ceilingBpm")
        let startedAtMs = call.getDouble("startedAtMs") ?? Date().timeIntervalSince1970 * 1000
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if var r = self.run, r.runId == runId {
                // The same run (the app came back, or relaunched after a kill): rejoin it.
                r.paused = false
                r.ceiling = ceiling
                // Seconds lost while the app was dead: kept as time gone (the run clock
                // counted them), with no heart rate and no distance.
                self.openJournalForAppend(runId)
                let expected = min(6 * 3600, Int(Date().timeIntervalSince1970 - r.startedAt))
                while r.t.count < expected {
                    r.t.append(r.t.count)
                    r.hr.append(nil)
                    r.moving.append(1)
                    r.distM.append(r.outdoor ? r.distance : 0)
                    self.appendLine(["i": r.t.count - 1, "m": 1, "d": (r.distance * 10).rounded() / 10, "h": NSNull()])
                }
                self.run = r
                self.startEngines(outdoor: r.outdoor)
                call.resolve(["rejoined": true])
                return
            }
            if self.run != nil { self.finishRun(keep: false) }
            self.finished = nil
            self.finishedEndedAt = nil
            var r = Run(runId: runId, sessionId: sessionId, runSessionId: runSessionId, outdoor: outdoor, ceiling: ceiling, startedAt: startedAtMs / 1000)
            r.paused = false
            self.run = r
            self.zone = "none"
            self.overSince = nil
            self.anchor = nil
            self.acceptedFixes = 0
            do {
                try self.createJournal(r)
            } catch {
                self.run = nil
                call.reject("Could not create the journal: \(error.localizedDescription)")
                return
            }
            UserDefaults.standard.set(runId, forKey: Self.keyActiveRun)
            UserDefaults.standard.removeObject(forKey: Self.keyFinishedRun)
            self.startEngines(outdoor: outdoor)
            call.resolve(["rejoined": false])
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.run?.paused = true
            self?.anchor = nil
            call.resolve()
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.run?.paused = false
            call.resolve()
        }
    }

    @objc func snapshot(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let r = self.run { call.resolve(["recording": self.payload(r, endedAt: Date().timeIntervalSince1970)]) }
            else if let f = self.finished { call.resolve(["recording": self.payload(f, endedAt: self.finishedEndedAt ?? Date().timeIntervalSince1970)]) }
            else { call.resolve(["recording": NSNull()]) }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let r = self.run else {
                if let f = self.finished { call.resolve(["recording": self.payload(f, endedAt: self.finishedEndedAt ?? Date().timeIntervalSince1970)]) }
                else { call.resolve(["recording": NSNull()]) }
                return
            }
            let endedAt = Date().timeIntervalSince1970
            self.appendLine(["ev": "stop", "endedAt": endedAt])
            self.finishRun(keep: true)
            self.finished = r
            self.finishedEndedAt = endedAt
            UserDefaults.standard.set(r.runId, forKey: Self.keyFinishedRun)
            call.resolve(["recording": self.payload(r, endedAt: endedAt)])
        }
    }

    @objc func unfinished(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let r = self.run { call.resolve(["recording": self.payload(r, endedAt: Date().timeIntervalSince1970), "active": true]) }
            else if let f = self.finished { call.resolve(["recording": self.payload(f, endedAt: self.finishedEndedAt ?? Date().timeIntervalSince1970), "active": false]) }
            else { call.resolve(["recording": NSNull(), "active": false]) }
        }
    }

    /// The server has the recording: the journal can go.
    @objc func ackUploaded(_ call: CAPPluginCall) {
        let runId = call.getString("runId") ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.finished?.runId == runId {
                self.finished = nil
                self.finishedEndedAt = nil
                UserDefaults.standard.removeObject(forKey: Self.keyFinishedRun)
            }
            if self.run?.runId != runId { self.deleteJournal(runId) }
            call.resolve()
        }
    }

    /// DISCARD: stop, and nothing of this run is kept.
    @objc func discard(_ call: CAPPluginCall) {
        let runId = call.getString("runId")
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let r = self.run, runId == nil || r.runId == runId {
                self.finishRun(keep: false)
                self.deleteJournal(r.runId)
            }
            if let f = self.finished, runId == nil || f.runId == runId {
                self.deleteJournal(f.runId)
                self.finished = nil
                self.finishedEndedAt = nil
                UserDefaults.standard.removeObject(forKey: Self.keyFinishedRun)
            }
            call.resolve()
        }
    }

    // MARK: the run's engines

    private func startEngines(outdoor: Bool) {
        let c = ensureCentral()
        if c.state == .poweredOn { connectSavedIfNeeded() }
        if outdoor { startLocation() }
        if clock == nil {
            let t = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
            t.schedule(deadline: .now() + 1.0, repeating: 1.0, leeway: .milliseconds(100))
            t.setEventHandler { [weak self] in self?.tick() }
            t.resume()
            clock = t
        }
        startWatchdog()
    }

    private func finishRun(keep: Bool) {
        clock?.cancel()
        clock = nil
        stopLocation()
        closeJournal()
        if let id = run?.runId, !keep { deleteJournal(id) }
        run = nil
        UserDefaults.standard.removeObject(forKey: Self.keyActiveRun)
        zone = "none"
        overSince = nil
    }

    private func tick() {
        guard var r = run else { return }
        let now = Date().timeIntervalSince1970
        var hr: Int? = nil
        if let h = lastHr, let ht = lastHrT, now - ht <= 2.5, link == "connected" { hr = h }
        r.t.append(r.t.count)
        r.hr.append(hr)
        r.moving.append(r.paused ? 0 : 1)
        r.distM.append(r.outdoor ? r.distance : 0)
        run = r
        var line: [String: Any] = ["i": r.t.count - 1, "m": r.paused ? 0 : 1, "d": (r.distance * 10).rounded() / 10]
        line["h"] = Self.nn(hr)
        appendLine(line)
        if r.t.count % 30 == 0 { try? journal?.synchronize() }

        stepZone(hr: hr, now: now)
        if !isBackground {
            var tick: [String: Any] = ["t": now * 1000, "elapsedSec": Int((now - r.startedAt).rounded()), "movingSec": r.moving.reduce(0, +), "distanceM": r.outdoor ? r.distance : 0, "link": link, "zone": zone]
            tick["hr"] = Self.nn(hr)
            notifyListeners("tick", data: tick)
        }
        updateLiveActivity(hr: hr, now: now, distanceM: r.outdoor ? r.distance : nil)
    }

    private func stepZone(hr: Int?, now: Double) {
        guard let h = hr, h > 0 else { zone = "none"; overSince = nil; return }
        guard let ceiling = run?.ceiling, ceiling > 0 else { zone = "in"; overSince = nil; return }
        if h > ceiling {
            let since = overSince ?? now
            overSince = since
            zone = now - since >= Self.overSec ? "over" : "gold"
        } else {
            overSince = nil
            zone = h >= ceiling - Self.goldBand ? "gold" : "in"
        }
    }

    // MARK: Live Activity (the lock screen and the island, while JS sleeps)

    private func updateLiveActivity(hr: Int?, now: Double, distanceM: Double?) {
        let zoneChanged = zone != laLastZone
        var hrMoved = false
        if let h = hr {
            if let l = laLastHr { hrMoved = abs(h - l) >= 2 } else { hrMoved = true }
        } else {
            hrMoved = laLastHr != nil
        }
        let since = now - laLastAt
        // A zone change at once; a moved number every 5 s at most; distance alone every 15 s.
        guard zoneChanged || (hrMoved && since >= Self.laMinIntervalSec) || (distanceM != nil && since >= Self.laDistanceIntervalSec) else { return }
        laLastAt = now
        laLastHr = hr
        laLastZone = zone
        laSeq += 1
        let seq = laSeq
        let z = zone
        let km = distanceM.map { ($0 / 10).rounded() / 100 }
        Task {
            guard let activity = Activity<WaymarkActivityAttributes>.activities.first else { return }
            var state = activity.content.state
            guard state.phase != "complete" else { return }
            state.hr = hr
            state.hrZone = z
            state.hrSeq = seq
            if let km = km { state.distanceKm = km }
            await activity.update(ActivityContent(state: state, staleDate: state.timerStaleDate))
        }
    }

    // MARK: BLE helpers

    @discardableResult
    private func ensureCentral() -> CBCentralManager {
        if let c = central { return c }
        let c = CBCentralManager(delegate: self, queue: nil, options: [
            CBCentralManagerOptionRestoreIdentifierKey: Self.restoreId,
            CBCentralManagerOptionShowPowerAlertKey: true,
        ])
        central = c
        return c
    }

    private func savedPeripheralId() -> UUID? {
        guard let s = UserDefaults.standard.string(forKey: Self.keyPeripheralId) else { return nil }
        return UUID(uuidString: s)
    }

    private func startScanNow() {
        guard let c = central, c.state == .poweredOn else { return }
        // A strap already linked to this phone (another app) may not advertise.
        for p in c.retrieveConnectedPeripherals(withServices: [hrService]) {
            found[p.identifier] = (p, p.name ?? "Heart rate strap", 0)
        }
        c.scanForPeripherals(withServices: [hrService], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        // Give the room two seconds, then link the strongest one heard.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in self?.pickFound() }
    }

    private func pickFound() {
        guard searching else { return }
        guard let best = found.values.max(by: { $0.rssi < $1.rssi }) else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in self?.pickFound() }
            return
        }
        stopScanNow()
        let p = best.peripheral
        if let old = peripheral, old.identifier != p.identifier { central?.cancelPeripheralConnection(old) }
        UserDefaults.standard.set(p.identifier.uuidString, forKey: Self.keyPeripheralId)
        UserDefaults.standard.set(best.name, forKey: Self.keyPeripheralName)
        peripheral = p
        p.delegate = self
        if p.state == .connected { didConnectSetup(p) } else { central?.connect(p, options: nil) }
    }

    private func finishSearch(error: String?) {
        guard searching else { return }
        searching = false
        searchWork?.cancel()
        searchWork = nil
        stopScanNow()
        let calls = searchCalls
        searchCalls.removeAll()
        if let e = error {
            if savedPeripheralId() == nil { setLink("none") } else if link == "searching" { setLink("saved") }
            for c in calls { c.reject(e) }
        } else {
            let payload = strapPayload()
            for c in calls { c.resolve(payload) }
        }
    }

    private func stopScanNow() {
        if let c = central, c.isScanning { c.stopScan() }
    }

    private func connectSavedIfNeeded() {
        guard let c = central, c.state == .poweredOn, let id = savedPeripheralId() else { return }
        if let p = peripheral, p.identifier == id {
            switch p.state {
            case .connected:
                if link != "connected" && link != "silent" { didConnectSetup(p) }
                return
            case .connecting:
                return
            default:
                break
            }
        }
        let candidate: CBPeripheral? = (peripheral?.identifier == id) ? peripheral : c.retrievePeripherals(withIdentifiers: [id]).first
        guard let p = candidate else { return }
        peripheral = p
        p.delegate = self
        if link == "none" || link == "saved" { setLink("searching") }
        // No timeout: a pending connect waits until the strap is back on skin.
        c.connect(p, options: nil)
    }

    private func didConnectSetup(_ p: CBPeripheral) {
        p.delegate = self
        connectedAt = Date().timeIntervalSince1970
        silentSince = nil
        p.discoverServices([hrService, batteryService])
    }

    private func setLink(_ l: String) {
        guard l != link else { return }
        link = l
        emitStrap()
    }

    private func strapPayload() -> [String: Any] {
        var out: [String: Any] = ["link": link]
        out["name"] = Self.nn(UserDefaults.standard.string(forKey: Self.keyPeripheralName))
        if let b = battery { out["battery"] = b }
        if link == "connected", let h = lastHr { out["hr"] = h }
        return out
    }

    private func emitStrap() {
        guard !isBackground else { return }
        notifyListeners("strap", data: strapPayload())
    }

    // "Connected but silent": no heart rate for 10 s while linked → re-subscribe;
    // 20 s → drop the link and reconnect (the pending connect waits for the strap).
    private func startWatchdog() {
        guard watchdog == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
        t.schedule(deadline: .now() + 2.0, repeating: 2.0, leeway: .milliseconds(200))
        t.setEventHandler { [weak self] in self?.checkSilent() }
        t.resume()
        watchdog = t
    }

    private func checkSilent() {
        guard run != nil || searching else {
            watchdog?.cancel()
            watchdog = nil
            return
        }
        guard let p = peripheral, p.state == .connected else { return }
        let now = Date().timeIntervalSince1970
        let heard = max(lastHrT ?? 0, connectedAt ?? 0)
        let quiet = now - heard
        if quiet >= Self.silentReconnectSec {
            central?.cancelPeripheralConnection(p)   // didDisconnect reconnects
            silentSince = nil
        } else if quiet >= Self.silentResubscribeSec {
            if silentSince == nil {
                silentSince = now
                setLink("silent")
                if let ch = hrCharacteristic {
                    p.setNotifyValue(false, for: ch)
                    p.setNotifyValue(true, for: ch)
                }
            }
        }
    }

    // MARK: CBCentralManagerDelegate

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            if searching { startScanNow() }
            if savedPeripheralId() != nil && !searching { connectSavedIfNeeded() }
        } else if central.state == .unauthorized || central.state == .poweredOff {
            if searching { finishSearch(error: central.state == .poweredOff ? "Bluetooth is off." : "Waymark isn't allowed to use Bluetooth. Turn it on in Settings.") }
        }
    }

    public func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        let saved = savedPeripheralId()
        for p in restored where p.identifier == saved {
            peripheral = p
            p.delegate = self
        }
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let advName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let name = peripheral.name ?? advName ?? "Heart rate strap"
        found[peripheral.identifier] = (peripheral, name, RSSI.intValue)
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        didConnectSetup(peripheral)
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self = self, let c = self.central, c.state == .poweredOn,
                  self.savedPeripheralId() == peripheral.identifier else { return }
            c.connect(peripheral, options: nil)
        }
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        hrCharacteristic = nil
        // Reconnect forever while this is still the remembered strap.
        if savedPeripheralId() == peripheral.identifier, central.state == .poweredOn {
            setLink(run != nil ? "searching" : "saved")
            central.connect(peripheral, options: nil)
        } else {
            setLink(savedPeripheralId() == nil ? "none" : "saved")
        }
    }

    // MARK: CBPeripheralDelegate

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        for s in peripheral.services ?? [] {
            if s.uuid == hrService {
                peripheral.discoverCharacteristics([hrMeasurement], for: s)
            } else if s.uuid == batteryService {
                peripheral.discoverCharacteristics([batteryLevel], for: s)
            }
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for ch in service.characteristics ?? [] {
            if ch.uuid == hrMeasurement {
                hrCharacteristic = ch
                peripheral.setNotifyValue(true, for: ch)
            } else if ch.uuid == batteryLevel {
                peripheral.readValue(for: ch)
            }
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard characteristic.uuid == hrMeasurement, characteristic.isNotifying, error == nil else { return }
        if link != "silent" { setLink("connected") }
        if searching { finishSearch(error: nil) }
        startWatchdog()
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let data = characteristic.value else { return }
        if characteristic.uuid == batteryLevel {
            if let b = data.first { battery = Int(b) }
            emitStrap()
            return
        }
        guard characteristic.uuid == hrMeasurement, let m = Self.parseHeartRate(data) else { return }
        // HR 0 = "no reading"; a strap that reports "not in contact" has nothing either.
        guard m.hr > 0, m.contact != "noContact" else { return }
        lastHr = m.hr
        lastHrT = Date().timeIntervalSince1970
        silentSince = nil
        if link != "connected" { setLink("connected") }
    }

    /// Heart Rate Measurement (0x2A37), Bluetooth GATT spec.
    /// flags bit0: HR uint16 (else uint8); bits1-2: sensor contact; bit3: energy
    /// expended uint16 present; bit4: RR intervals uint16 present (1/1024 s).
    static func parseHeartRate(_ data: Data) -> (flags: UInt8, hr: Int, contact: String, rr: [Int])? {
        let b = [UInt8](data)
        guard b.count >= 2 else { return nil }
        let flags = b[0]
        var o = 1
        var hr = 0
        if flags & 0x01 != 0 {
            guard b.count >= 3 else { return nil }
            hr = Int(b[1]) | (Int(b[2]) << 8)
            o = 3
        } else {
            hr = Int(b[1])
            o = 2
        }
        let contactBits = (flags >> 1) & 0x03
        let contact: String
        switch contactBits {
        case 0x03: contact = "contact"
        case 0x02: contact = "noContact"
        default: contact = "unsupported"
        }
        if flags & 0x08 != 0, o + 1 < b.count { o += 2 }
        var rr: [Int] = []
        if flags & 0x10 != 0 {
            while o + 1 < b.count {
                let raw = Int(b[o]) | (Int(b[o + 1]) << 8)
                rr.append(Int((Double(raw) * 1000.0 / 1024.0).rounded()))
                o += 2
            }
        }
        return (flags, hr, contact, rr)
    }

    // MARK: location

    private func startLocation() {
        let lm = locationManager ?? CLLocationManager()
        locationManager = lm
        lm.delegate = self
        lm.activityType = .fitness
        lm.desiredAccuracy = kCLLocationAccuracyBest
        lm.distanceFilter = kCLDistanceFilterNone
        lm.pausesLocationUpdatesAutomatically = false
        lm.allowsBackgroundLocationUpdates = true
        lm.showsBackgroundLocationIndicator = true
        // Held for the whole run, pauses included (never invalidated mid-run).
        if backgroundSession == nil { backgroundSession = CLBackgroundActivitySession() }
        if lm.authorizationStatus == .notDetermined { lm.requestWhenInUseAuthorization() }
        lm.startUpdatingLocation()
    }

    private func stopLocation() {
        locationManager?.stopUpdatingLocation()
        locationManager?.allowsBackgroundLocationUpdates = false
        backgroundSession?.invalidate()
        backgroundSession = nil
        anchor = nil
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if run?.outdoor == true, manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.startUpdatingLocation()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard var r = run, r.outdoor else { return }
        let now = Date()
        for loc in locations {
            // Filters: a real fix, fresh (not cached), after the start, accurate
            // enough (30 m while it settles in the first minute, then 20 m).
            let age = now.timeIntervalSince(loc.timestamp)
            let sinceStart = loc.timestamp.timeIntervalSince1970 - r.startedAt
            let maxAcc: Double = sinceStart < 60 ? 30 : 20
            guard loc.horizontalAccuracy >= 0, loc.horizontalAccuracy <= maxAcc, age <= 10, sinceStart >= 0 else { continue }
            acceptedFixes += 1
            // The first fixes after a start or a resume are a warm-up.
            if acceptedFixes <= 2 || r.paused { anchor = r.paused ? nil : loc; continue }
            guard let a = anchor else { anchor = loc; continue }
            let d = loc.distance(from: a)
            let dt = loc.timestamp.timeIntervalSince(a.timestamp)
            guard dt > 0 else { continue }
            // Impossible for a runner: a jump, drop it and keep the anchor.
            if d / dt > 8 { continue }
            // Standing still (a red light): GPS wander inside the accuracy is not distance.
            let moving = loc.speed >= 0.6 || d >= max(loc.horizontalAccuracy, a.horizontalAccuracy)
            if moving {
                r.distance += d
                anchor = loc
            }
        }
        run = r
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    // MARK: journal (Application Support/run-recordings/<runId>.jsonl)

    private func journalURL(_ runId: String) -> URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let dir = base.appendingPathComponent(Self.journalDir, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [
            .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
        ])
        let safe = runId.replacingOccurrences(of: "/", with: "_")
        return dir.appendingPathComponent("\(safe).jsonl")
    }

    private func createJournal(_ r: Run) throws {
        guard let url = journalURL(r.runId) else {
            throw NSError(domain: "WaymarkRunRecorder", code: 1, userInfo: [NSLocalizedDescriptionKey: "No Application Support folder"])
        }
        // Writable while the phone is locked (default "complete" protection is not).
        let ok = FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [
            .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
        ])
        if !ok {
            throw NSError(domain: "WaymarkRunRecorder", code: 2, userInfo: [NSLocalizedDescriptionKey: "createFile failed"])
        }
        journal = try FileHandle(forWritingTo: url)
        var head: [String: Any] = [
            "ev": "start", "runId": r.runId, "sessionId": r.sessionId, "runSessionId": r.runSessionId,
            "outdoor": r.outdoor, "startedAt": r.startedAt,
        ]
        head["ceiling"] = Self.nn(r.ceiling)
        head["strap"] = Self.nn(UserDefaults.standard.string(forKey: Self.keyPeripheralName))
        appendLine(head)
    }

    private func openJournalForAppend(_ runId: String) {
        guard journal == nil, let url = journalURL(runId), FileManager.default.fileExists(atPath: url.path) else { return }
        journal = try? FileHandle(forWritingTo: url)
    }

    private func closeJournal() {
        if let h = journal {
            try? h.synchronize()
            try? h.close()
        }
        journal = nil
    }

    private func deleteJournal(_ runId: String) {
        guard let url = journalURL(runId) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    private func appendLine(_ obj: [String: Any]) {
        guard let h = journal, JSONSerialization.isValidJSONObject(obj),
              var data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
        data.append(0x0A)
        do {
            try h.seekToEnd()
            try h.write(contentsOf: data)
        } catch {
            // Disk full or file protection: the in-memory series still holds the run.
        }
    }

    /// The run back from its journal (crash-resume, or a finished run never uploaded).
    private func readJournal(_ runId: String) -> (run: Run, endedAt: Double?)? {
        guard let url = journalURL(runId), let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) else { return nil }
        var r: Run?
        var endedAt: Double?
        for line in text.split(separator: "\n") {
            guard let d = line.data(using: .utf8),
                  let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { continue }
            if let ev = obj["ev"] as? String {
                if ev == "start" {
                    r = Run(runId: obj["runId"] as? String ?? runId,
                            sessionId: obj["sessionId"] as? String ?? "",
                            runSessionId: obj["runSessionId"] as? String ?? "",
                            outdoor: obj["outdoor"] as? Bool ?? true,
                            ceiling: obj["ceiling"] as? Int,
                            startedAt: (obj["startedAt"] as? NSNumber)?.doubleValue ?? Date().timeIntervalSince1970)
                } else if ev == "stop" {
                    endedAt = (obj["endedAt"] as? NSNumber)?.doubleValue
                }
                continue
            }
            guard r != nil else { continue }
            r!.t.append(r!.t.count)
            r!.hr.append(obj["h"] as? Int)
            r!.moving.append((obj["m"] as? Int) ?? 1)
            let dist = (obj["d"] as? NSNumber)?.doubleValue ?? r!.distance
            r!.distM.append(dist)
            r!.distance = dist
        }
        guard let run = r else { return nil }
        return (run, endedAt)
    }

    // MARK: payloads

    /// nil -> NSNull for JSON and the bridge.
    private static func nn(_ v: Any?) -> Any { v ?? NSNull() }

    private func payload(_ r: Run, endedAt: Double) -> [String: Any] {
        let strap = UserDefaults.standard.string(forKey: Self.keyPeripheralName)
        return [
            "runId": r.runId,
            "sessionId": r.sessionId,
            "runSessionId": r.runSessionId,
            "startedAt": Int(r.startedAt),
            "endedAt": Int(endedAt),
            "outdoor": r.outdoor,
            "strapName": Self.nn(strap),
            "series": [
                "t": r.t,
                "hr": r.hr.map { Self.nn($0) },
                "moving": r.moving,
                "distM": r.distM.map { ($0 * 10).rounded() / 10 },
            ] as [String: Any],
        ]
    }
}
