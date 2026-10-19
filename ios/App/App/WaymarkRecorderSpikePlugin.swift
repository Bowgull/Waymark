import Foundation
import UIKit
import CoreBluetooth
import CoreLocation
import Capacitor

// PHASE 1 SPIKE (throwaway). Proves that a BLE heart-rate strap (COOSPO H9Z)
// and GPS keep recording ~1 Hz for 30+ min with the screen locked, on a free
// Apple ID sideload, and captures the strap's 0x2A37 flags (RR? contact bits?).
//
// Everything that matters runs natively: the BLE link and 0x2A37 parsing,
// CoreLocation, the 1 Hz sample clock and the JSON-lines journal in Documents.
// JS (the /dev/recorder screen) only drives the buttons and reads status; it
// is asleep while the phone is locked and is never in the sampling path.
//
// No CMAltimeter: it needs NSMotionUsageDescription, which phase 1 does not
// add. "alt" in the journal is the GPS altitude.
//
// All state is touched on the main queue only (CoreBluetooth queue nil = main,
// CLLocationManager created on main, the timer on main, plugin calls hop to main).
@objc(WaymarkRecorderSpikePlugin)
public class WaymarkRecorderSpikePlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate, CBPeripheralDelegate, CLLocationManagerDelegate {
    public let identifier = "WaymarkRecorderSpikePlugin"
    public let jsName = "WaymarkRecorderSpike"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportJournal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    // MARK: constants

    private static let restoreId = "com.joshbocas.app.recorderSpike.central"
    private static let keyPeripheralId = "waymark.recorderSpike.peripheralId"
    private static let keyPeripheralName = "waymark.recorderSpike.peripheralName"
    private static let keyLastJournal = "waymark.recorderSpike.lastJournal"
    private static let keyRecordingActive = "waymark.recorderSpike.recordingActive"
    private static let journalPrefix = "recorder-spike-"

    private let hrService = CBUUID(string: "180D")
    private let hrMeasurement = CBUUID(string: "2A37")
    private let batteryService = CBUUID(string: "180F")
    private let batteryLevel = CBUUID(string: "2A19")

    // MARK: BLE state

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var scanPending = false
    private var scanStopWork: DispatchWorkItem?
    private var found: [UUID: (peripheral: CBPeripheral, name: String, rssi: Int)] = [:]
    private var bleState = "idle"
    private var battery: Int?

    // Latest HR notification
    private var lastHr: Int?
    private var lastHrT: Double?
    private var lastFlags: UInt8?
    private var lastContact: String?
    private var lastEnergy: Int?
    private var lastRr: [Int] = []
    private var pendingRr: [Int] = []

    // MARK: location state

    private var locationManager: CLLocationManager?
    private var backgroundSession: CLBackgroundActivitySession?
    private var lastLocation: CLLocation?

    // MARK: recording state

    private var recording = false
    private var startedAt: Double?
    private var endedAt: Double?
    private var timer: DispatchSourceTimer?
    private var journal: FileHandle?
    private var journalURL: URL?
    private var samples = 0
    private var lastTickT: Double?
    private var bgSeconds: Double = 0
    private var lockedSeconds: Double = 0
    private var isBackground = false
    private var isLocked = false
    private var interruptedRun = false

    // Per-run counters
    private var hrNotifications = 0
    private var rrPackets = 0
    private var rrValues = 0
    private var flagsSeen = Set<String>()
    private var contactCounts: [String: Int] = ["unsupported": 0, "contact": 0, "noContact": 0]
    private var disconnects = 0
    private var reconnects = 0
    private var disconnectedDuringRun = false
    private var locationUpdates = 0

    // MARK: lifecycle

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(onBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(onForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(onLocked), name: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil)
        nc.addObserver(self, selector: #selector(onUnlocked), name: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil)

        // A run that was recording when the app died. Re-create the central with
        // the same restore identifier (state restoration) only in that case and
        // only when Bluetooth is already allowed, so no one else ever sees the
        // Bluetooth prompt at launch.
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: Self.keyRecordingActive) {
            interruptedRun = true
            defaults.set(false, forKey: Self.keyRecordingActive)
            if CBManager.authorization == .allowedAlways {
                DispatchQueue.main.async { [weak self] in self?.ensureCentral() }
            }
        }
    }

    @objc private func onBackground() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.isBackground = true
            self.journalEvent("background")
        }
    }

    @objc private func onForeground() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.isBackground = false
            self.journalEvent("foreground")
            self.emitStatus()
        }
    }

    @objc private func onLocked() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.isLocked = true
            self.journalEvent("locked")
        }
    }

    @objc private func onUnlocked() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.isLocked = false
            self.journalEvent("unlocked")
        }
    }

    // MARK: plugin methods

    @objc func scan(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.found.removeAll()
            self.scanPending = true
            let c = self.ensureCentral()
            if c.state == .poweredOn { self.startScanNow() }
            call.resolve(["scanning": true, "centralState": self.centralStateText()])
        }
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.stopScanNow()
            call.resolve()
        }
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let idText = call.getString("id"), let id = UUID(uuidString: idText) else {
            call.reject("Missing or invalid id")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let c = self.ensureCentral()
            var target = self.found[id]?.peripheral
            if target == nil, c.state == .poweredOn {
                target = c.retrievePeripherals(withIdentifiers: [id]).first
            }
            guard let p = target else {
                call.reject("Strap not found. Scan again.")
                return
            }
            if let old = self.peripheral, old.identifier != p.identifier {
                c.cancelPeripheralConnection(old)
            }
            self.stopScanNow()
            let name = p.name ?? self.found[id]?.name ?? "Unknown"
            UserDefaults.standard.set(p.identifier.uuidString, forKey: Self.keyPeripheralId)
            UserDefaults.standard.set(name, forKey: Self.keyPeripheralName)
            self.peripheral = p
            p.delegate = self
            self.bleState = "connecting"
            // No timeout: a pending connect waits until the strap is back.
            c.connect(p, options: nil)
            self.journalEvent("connectRequested", ["id": p.identifier.uuidString, "name": name])
            self.emitStatus()
            call.resolve(["id": p.identifier.uuidString, "name": name])
        }
    }

    @objc func forget(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            UserDefaults.standard.removeObject(forKey: Self.keyPeripheralId)
            UserDefaults.standard.removeObject(forKey: Self.keyPeripheralName)
            if let p = self.peripheral { self.central?.cancelPeripheralConnection(p) }
            self.peripheral = nil
            self.bleState = "idle"
            self.lastHr = nil
            self.lastHrT = nil
            self.battery = nil
            self.journalEvent("forget")
            self.emitStatus()
            call.resolve()
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.recording {
                call.reject("Already recording")
                return
            }
            do {
                try self.openJournal()
            } catch {
                call.reject("Could not create the journal: \(error.localizedDescription)")
                return
            }
            self.resetRunCounters()
            let now = Date().timeIntervalSince1970
            self.recording = true
            self.startedAt = now
            self.endedAt = nil
            self.lastTickT = nil
            self.isBackground = UIApplication.shared.applicationState == .background
            self.isLocked = !UIApplication.shared.isProtectedDataAvailable
            UserDefaults.standard.set(true, forKey: Self.keyRecordingActive)
            self.interruptedRun = false

            self.journalEvent("start", [
                "device": UIDevice.current.model,
                "ios": UIDevice.current.systemVersion,
                "peripheralId": Self.nn(self.savedPeripheralId()?.uuidString),
                "peripheralName": Self.nn(UserDefaults.standard.string(forKey: Self.keyPeripheralName)),
            ])

            // BLE: make sure the saved strap is (being) connected.
            let c = self.ensureCentral()
            if c.state == .poweredOn { self.connectSavedIfNeeded() }

            // GPS
            self.startLocation()

            // 1 Hz clock, native.
            let t = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
            t.schedule(deadline: .now() + 1.0, repeating: 1.0, leeway: .milliseconds(100))
            t.setEventHandler { [weak self] in self?.tick() }
            t.resume()
            self.timer = t

            self.emitStatus()
            call.resolve(["startedAt": now, "path": self.journalURL?.path ?? ""])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard self.recording else {
                call.reject("Not recording")
                return
            }
            self.timer?.cancel()
            self.timer = nil
            self.stopLocation()
            let now = Date().timeIntervalSince1970
            self.endedAt = now
            self.journalEvent("stop")
            self.recording = false
            self.closeJournal()
            UserDefaults.standard.set(false, forKey: Self.keyRecordingActive)
            self.emitStatus()
            call.resolve(self.summary())
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            call.resolve(self.statusPayload())
        }
    }

    @objc func exportJournal(_ call: CAPPluginCall) {
        let share = call.getBool("share") ?? false
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let url = self.journalURL ?? self.lastJournalURL(),
                  FileManager.default.fileExists(atPath: url.path) else {
                call.reject("No journal yet")
                return
            }
            if self.recording { try? self.journal?.synchronize() }
            if share {
                guard let vc = self.bridge?.viewController else {
                    call.reject("No view controller to present from")
                    return
                }
                let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                if let pop = sheet.popoverPresentationController {
                    pop.sourceView = vc.view
                    pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
                    pop.permittedArrowDirections = []
                }
                vc.present(sheet, animated: true)
                call.resolve(["path": url.path, "shared": true])
                return
            }
            let data = (try? Data(contentsOf: url)) ?? Data()
            let contents = String(data: data, encoding: .utf8) ?? ""
            call.resolve(["path": url.path, "bytes": data.count, "contents": contents])
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.recording {
                call.reject("Stop the recording first")
                return
            }
            var deleted = 0
            let fm = FileManager.default
            if let dir = fm.urls(for: .documentDirectory, in: .userDomainMask).first,
               let names = try? fm.contentsOfDirectory(atPath: dir.path) {
                for name in names where name.hasPrefix(Self.journalPrefix) {
                    if (try? fm.removeItem(at: dir.appendingPathComponent(name))) != nil { deleted += 1 }
                }
            }
            self.journalURL = nil
            UserDefaults.standard.removeObject(forKey: Self.keyLastJournal)
            self.samples = 0
            self.startedAt = nil
            self.endedAt = nil
            self.emitStatus()
            call.resolve(["deleted": deleted])
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
        scanPending = false
        // A strap already linked to this phone (another app) may not advertise.
        for p in c.retrieveConnectedPeripherals(withServices: [hrService]) {
            found[p.identifier] = (p, p.name ?? "Unknown", 0)
        }
        c.scanForPeripherals(withServices: [hrService], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        bleState = peripheral?.state == .connected ? "connected" : "scanning"
        scanStopWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.stopScanNow() }
        scanStopWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
        emitStatus()
    }

    private func stopScanNow() {
        scanPending = false
        scanStopWork?.cancel()
        scanStopWork = nil
        if let c = central, c.isScanning { c.stopScan() }
        if bleState == "scanning" { bleState = "idle" }
        emitStatus()
    }

    private func connectSavedIfNeeded() {
        guard let c = central, c.state == .poweredOn, let id = savedPeripheralId() else { return }
        if let p = peripheral, p.identifier == id {
            switch p.state {
            case .connected:
                if bleState != "connected" { didConnectSetup(p) }
                return
            case .connecting:
                return
            default:
                break
            }
        }
        let candidate: CBPeripheral? = (peripheral?.identifier == id) ? peripheral : c.retrievePeripherals(withIdentifiers: [id]).first
        guard let p = candidate else {
            bleState = "notFound"
            emitStatus()
            return
        }
        peripheral = p
        p.delegate = self
        bleState = "connecting"
        c.connect(p, options: nil)
        emitStatus()
    }

    private func didConnectSetup(_ p: CBPeripheral) {
        p.delegate = self
        bleState = "connected"
        p.discoverServices([hrService, batteryService])
        emitStatus()
    }

    private func centralStateText() -> String {
        guard let c = central else { return "notCreated" }
        switch c.state {
        case .poweredOn: return "poweredOn"
        case .poweredOff: return "poweredOff"
        case .unauthorized: return "unauthorized"
        case .unsupported: return "unsupported"
        case .resetting: return "resetting"
        case .unknown: return "unknown"
        @unknown default: return "other"
        }
    }

    // MARK: CBCentralManagerDelegate

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        journalEvent("centralState", ["state": centralStateText()])
        if central.state == .poweredOn {
            if scanPending { startScanNow() }
            if savedPeripheralId() != nil { connectSavedIfNeeded() }
        } else {
            bleState = centralStateText()
        }
        emitStatus()
    }

    public func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        let saved = savedPeripheralId()
        for p in restored where p.identifier == saved {
            peripheral = p
            p.delegate = self
        }
        journalEvent("restored", ["count": restored.count])
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let advName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let name = peripheral.name ?? advName ?? "Unknown"
        found[peripheral.identifier] = (peripheral, name, RSSI.intValue)
        emitStatus()
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        if recording && disconnectedDuringRun {
            reconnects += 1
            disconnectedDuringRun = false
        }
        journalEvent("connected", ["id": peripheral.identifier.uuidString, "name": Self.nn(peripheral.name)])
        didConnectSetup(peripheral)
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        journalEvent("connectFailed", ["error": Self.nn(error?.localizedDescription)])
        bleState = "connecting"
        emitStatus()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self = self, let c = self.central, c.state == .poweredOn,
                  self.savedPeripheralId() == peripheral.identifier else { return }
            c.connect(peripheral, options: nil)
        }
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        journalEvent("disconnected", ["error": Self.nn(error?.localizedDescription)])
        if recording {
            disconnects += 1
            disconnectedDuringRun = true
        }
        // Reconnect forever while this is still the remembered strap.
        if savedPeripheralId() == peripheral.identifier, central.state == .poweredOn {
            bleState = "reconnecting"
            central.connect(peripheral, options: nil)
        } else {
            bleState = "idle"
        }
        emitStatus()
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
                peripheral.setNotifyValue(true, for: ch)
            } else if ch.uuid == batteryLevel {
                peripheral.readValue(for: ch)
            }
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        if characteristic.uuid == hrMeasurement {
            journalEvent("notify", ["on": characteristic.isNotifying, "error": Self.nn(error?.localizedDescription)])
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let data = characteristic.value else { return }
        if characteristic.uuid == batteryLevel {
            if let b = data.first { battery = Int(b) }
            emitStatus()
            return
        }
        guard characteristic.uuid == hrMeasurement else { return }
        guard let m = Self.parseHeartRate(data) else { return }

        let now = Date().timeIntervalSince1970
        let hex = String(format: "0x%02X", m.flags)
        lastFlags = m.flags
        lastContact = m.contact
        lastEnergy = m.energy
        if recording {
            hrNotifications += 1
            flagsSeen.insert(hex)
            contactCounts[m.contact, default: 0] += 1
            if !m.rr.isEmpty {
                rrPackets += 1
                rrValues += m.rr.count
            }
        }
        if !m.rr.isEmpty {
            lastRr = m.rr
            pendingRr.append(contentsOf: m.rr)
        }
        // HR 0 = "no reading": keep the flags, drop the value.
        if m.hr > 0 {
            lastHr = m.hr
            lastHrT = now
        }

        if !isBackground {
            var payload: [String: Any] = ["t": now, "hr": m.hr, "flagsHex": hex, "rr": m.rr, "contact": m.contact]
            if let e = m.energy { payload["energy"] = e }
            notifyListeners("hr", data: payload)
        }
    }

    /// Heart Rate Measurement (0x2A37), Bluetooth GATT spec.
    /// flags bit0: HR uint16 (else uint8); bits1-2: sensor contact; bit3: energy
    /// expended uint16 present; bit4: RR intervals uint16 present (1/1024 s).
    static func parseHeartRate(_ data: Data) -> (flags: UInt8, hr: Int, contact: String, energy: Int?, rr: [Int])? {
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
        var energy: Int?
        if flags & 0x08 != 0, o + 1 < b.count {
            energy = Int(b[o]) | (Int(b[o + 1]) << 8)
            o += 2
        }
        var rr: [Int] = []
        if flags & 0x10 != 0 {
            while o + 1 < b.count {
                let raw = Int(b[o]) | (Int(b[o + 1]) << 8)
                rr.append(Int((Double(raw) * 1000.0 / 1024.0).rounded()))
                o += 2
            }
        }
        return (flags, hr, contact, energy, rr)
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
        if backgroundSession == nil { backgroundSession = CLBackgroundActivitySession() }
        if lm.authorizationStatus == .notDetermined {
            lm.requestWhenInUseAuthorization()
        }
        lm.startUpdatingLocation()
    }

    private func stopLocation() {
        locationManager?.stopUpdatingLocation()
        locationManager?.allowsBackgroundLocationUpdates = false
        backgroundSession?.invalidate()
        backgroundSession = nil
    }

    private func locationAuthText() -> String {
        guard let lm = locationManager else { return "unknown" }
        switch lm.authorizationStatus {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        @unknown default: return "other"
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        journalEvent("locationAuth", ["status": locationAuthText()])
        if recording, manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.startUpdatingLocation()
        }
        emitStatus()
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        lastLocation = loc
        if recording { locationUpdates += locations.count }
        if !isBackground {
            notifyListeners("location", data: [
                "t": loc.timestamp.timeIntervalSince1970,
                "lat": loc.coordinate.latitude,
                "lon": loc.coordinate.longitude,
                "hAcc": loc.horizontalAccuracy,
                "speed": loc.speed,
                "alt": loc.altitude,
            ])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        journalEvent("locationError", ["error": error.localizedDescription])
    }

    // MARK: journal

    private func documentsURL() -> URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    }

    private func lastJournalURL() -> URL? {
        guard let name = UserDefaults.standard.string(forKey: Self.keyLastJournal), let dir = documentsURL() else { return nil }
        return dir.appendingPathComponent(name)
    }

    private func openJournal() throws {
        guard let dir = documentsURL() else {
            throw NSError(domain: "WaymarkRecorderSpike", code: 1, userInfo: [NSLocalizedDescriptionKey: "No Documents folder"])
        }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyyMMdd-HHmmss"
        let name = "\(Self.journalPrefix)\(f.string(from: Date())).jsonl"
        let url = dir.appendingPathComponent(name)
        // Writable while the phone is locked (default "complete" protection is not).
        let ok = FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [
            .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
        ])
        if !ok {
            throw NSError(domain: "WaymarkRecorderSpike", code: 2, userInfo: [NSLocalizedDescriptionKey: "createFile failed"])
        }
        journal = try FileHandle(forWritingTo: url)
        journalURL = url
        UserDefaults.standard.set(name, forKey: Self.keyLastJournal)
    }

    private func closeJournal() {
        if let h = journal {
            try? h.synchronize()
            try? h.close()
        }
        journal = nil
    }

    private func appendLine(_ obj: [String: Any]) {
        guard let h = journal, JSONSerialization.isValidJSONObject(obj),
              var data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
        data.append(0x0A)
        do {
            try h.seekToEnd()
            try h.write(contentsOf: data)
        } catch {
            // Disk full or file protection: nothing sensible to do in a spike.
        }
    }

    private func journalEvent(_ name: String, _ extra: [String: Any] = [:]) {
        guard recording else { return }
        var obj: [String: Any] = ["t": Self.r3(Date().timeIntervalSince1970), "ev": name]
        for (k, v) in extra { obj[k] = v }
        appendLine(obj)
    }

    private func tick() {
        guard recording else { return }
        let now = Date().timeIntervalSince1970
        if let prev = lastTickT {
            let dt = now - prev
            if isBackground { bgSeconds += dt }
            if isLocked { lockedSeconds += dt }
        }
        lastTickT = now

        var s: [String: Any] = ["t": Self.r3(now), "seq": samples]
        if let hT = lastHrT, now - hT <= 2.5, let hr = lastHr {
            s["hr"] = hr
        } else {
            s["hr"] = NSNull()
        }
        s["hrT"] = Self.nn(lastHrT.map { Self.r3($0) })
        s["flagsHex"] = Self.nn(lastFlags.map { String(format: "0x%02X", $0) })
        s["rr"] = pendingRr
        pendingRr.removeAll()
        s["contact"] = Self.nn(lastContact)
        if let e = lastEnergy { s["energy"] = e }
        if let loc = lastLocation {
            s["lat"] = loc.coordinate.latitude
            s["lon"] = loc.coordinate.longitude
            s["hAcc"] = Self.r1(loc.horizontalAccuracy)
            s["vAcc"] = Self.r1(loc.verticalAccuracy)
            s["speed"] = Self.r2(loc.speed)
            s["alt"] = Self.r1(loc.altitude)
            s["locT"] = Self.r3(loc.timestamp.timeIntervalSince1970)
        } else {
            s["lat"] = NSNull(); s["lon"] = NSNull(); s["hAcc"] = NSNull()
            s["speed"] = NSNull(); s["alt"] = NSNull(); s["locT"] = NSNull()
        }
        s["appState"] = isBackground ? "bg" : "fg"
        s["locked"] = isLocked
        s["bleState"] = bleState
        appendLine(s)
        samples += 1
        if samples % 30 == 0 { try? journal?.synchronize() }
        if !isBackground { emitStatus() }
    }

    private func resetRunCounters() {
        samples = 0
        bgSeconds = 0
        lockedSeconds = 0
        hrNotifications = 0
        rrPackets = 0
        rrValues = 0
        flagsSeen.removeAll()
        contactCounts = ["unsupported": 0, "contact": 0, "noContact": 0]
        disconnects = 0
        reconnects = 0
        disconnectedDuringRun = false
        locationUpdates = 0
        pendingRr.removeAll()
    }

    // MARK: payloads

    private func summary() -> [String: Any] {
        var out: [String: Any] = [
            "samples": samples,
            "bgSeconds": Self.r1(bgSeconds),
            "lockedSeconds": Self.r1(lockedSeconds),
            "hrNotifications": hrNotifications,
            "rrPackets": rrPackets,
            "rrValues": rrValues,
            "flagsSeen": Array(flagsSeen).sorted(),
            "contactCounts": contactCounts,
            "disconnects": disconnects,
            "reconnects": reconnects,
            "locationUpdates": locationUpdates,
            "path": journalURL?.path ?? "",
        ]
        if let s = startedAt { out["startedAt"] = s }
        if let e = endedAt { out["endedAt"] = e }
        if let s = startedAt { out["durationSec"] = Self.r1((endedAt ?? Date().timeIntervalSince1970) - s) }
        return out
    }

    private func statusPayload() -> [String: Any] {
        let now = Date().timeIntervalSince1970
        var out = summary()
        out["recording"] = recording
        out["interruptedRun"] = interruptedRun
        out["scanning"] = central?.isScanning ?? false
        out["centralState"] = centralStateText()
        out["bleAuth"] = Self.bleAuthText()
        out["bleState"] = bleState
        out["locationAuth"] = locationAuthText()
        out["appState"] = isBackground ? "bg" : "fg"
        out["locked"] = isLocked
        out["found"] = found.values
            .sorted { $0.rssi > $1.rssi }
            .map { ["id": $0.peripheral.identifier.uuidString, "name": $0.name, "rssi": $0.rssi] as [String: Any] }
        if let id = savedPeripheralId() { out["savedId"] = id.uuidString }
        if let n = UserDefaults.standard.string(forKey: Self.keyPeripheralName) { out["savedName"] = n }
        if let b = battery { out["battery"] = b }
        if let hr = lastHr { out["hr"] = hr }
        if let t = lastHrT { out["hrAgeSec"] = Self.r1(now - t) }
        if let f = lastFlags { out["flagsHex"] = String(format: "0x%02X", f) }
        if let c = lastContact { out["contact"] = c }
        out["lastRr"] = lastRr
        if let loc = lastLocation {
            out["lat"] = loc.coordinate.latitude
            out["lon"] = loc.coordinate.longitude
            out["hAcc"] = Self.r1(loc.horizontalAccuracy)
            out["speed"] = Self.r2(loc.speed)
            out["alt"] = Self.r1(loc.altitude)
            out["locAgeSec"] = Self.r1(now - loc.timestamp.timeIntervalSince1970)
        }
        return out
    }

    private func emitStatus() {
        guard !isBackground else { return }
        notifyListeners("status", data: statusPayload())
    }

    private static func bleAuthText() -> String {
        switch CBManager.authorization {
        case .allowedAlways: return "allowed"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "other"
        }
    }

    /// nil -> NSNull for JSONSerialization (journal lines only).
    private static func nn(_ v: Any?) -> Any { v ?? NSNull() }

    private static func r1(_ v: Double) -> Double { (v * 10).rounded() / 10 }
    private static func r2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
    private static func r3(_ v: Double) -> Double { (v * 1000).rounded() / 1000 }
}
