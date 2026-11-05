import Foundation
import Carbon

let maximumLineBytes = 65_536
var revision = 0

func property<T>(_ source: TISInputSource, _ key: CFString) -> T? {
    guard let pointer = TISGetInputSourceProperty(source, key) else { return nil }
    return Unmanaged<AnyObject>.fromOpaque(pointer).takeUnretainedValue() as? T
}
func text(_ value: String, maximum: Int, allowEmpty: Bool = false) -> Bool {
    return value.utf16.count <= maximum &&
        (allowEmpty || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) &&
        !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
}
func describe(_ source: TISInputSource) -> [String: Any]? {
    guard let id: String = property(source, kTISPropertyInputSourceID), text(id, maximum: 1024) else { return nil }
    let name: String = property(source, kTISPropertyLocalizedName) ?? id
    guard text(name, maximum: 1024) else { return nil }
    let languages: [String] = property(source, kTISPropertyInputSourceLanguages) ?? []
    // Carbon documents the first language as primary; ABC can list many supported languages.
    let primary = languages.first.map { [$0.replacingOccurrences(of: "_", with: "-")] } ?? []
    guard primary.allSatisfy({ text($0, maximum: 64, allowEmpty: true) }) else { return nil }
    return ["id": id, "name": name, "languages": primary]
}
func sources() -> [TISInputSource]? {
    let filter = [
        kTISPropertyInputSourceCategory as String: kTISCategoryKeyboardInputSource as String,
        kTISPropertyInputSourceIsEnabled as String: true,
        kTISPropertyInputSourceIsSelectCapable as String: true
    ] as CFDictionary
    guard let list = TISCreateInputSourceList(filter, false)?.takeRetainedValue() as? [TISInputSource],
          list.count <= 256 else { return nil }
    return list
}
func currentSource() -> TISInputSource? {
    return TISCopyCurrentKeyboardInputSource()?.takeRetainedValue()
}
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
          data.count <= maximumLineBytes else {
        FileHandle.standardOutput.write(Data("{\"type\":\"error\",\"code\":\"unavailable\"}\n".utf8))
        return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}
func failure(_ code: String, _ id: String? = nil) {
    var value: [String: Any] = ["type": "error", "code": code]
    if let id = id { value["id"] = id }
    emit(value)
}
func snapshot(_ id: String? = nil) {
    guard let list = sources() else { failure("unavailable", id); return }
    let descriptions = list.compactMap(describe)
    guard descriptions.count == list.count else { failure("unavailable", id); return }
    revision += 1
    var value: [String: Any] = [
        "type": "state", "revision": revision,
        "current": currentSource().flatMap(describe) as Any? ?? NSNull(),
        "sources": descriptions
    ]
    if let id = id { value["id"] = id }
    emit(value)
}
func handle(_ data: Data) {
    guard let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let id = value["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
          let command = value["command"] as? String else { failure("invalid_command"); return }
    if command == "snapshot" { snapshot(id); return }
    guard command == "select", let sourceID = value["sourceId"] as? String, text(sourceID, maximum: 1024),
          value.keys.contains("expectedCurrentId"),
          value["expectedCurrentId"] is String || value["expectedCurrentId"] is NSNull else { failure("invalid_command", id); return }
    let expected = value["expectedCurrentId"] as? String
    if let expected = expected, !text(expected, maximum: 1024) { failure("invalid_command", id); return }
    let actual: String? = currentSource().flatMap { property($0, kTISPropertyInputSourceID) as String? }
    guard expected == actual else { snapshot(); failure("conflict", id); return }
    // Re-query enabled/selectable keyboard sources immediately before the absolute selection.
    guard let list = sources() else { failure("unavailable", id); return }
    guard let selected = list.first(where: { (property($0, kTISPropertyInputSourceID) as String?) == sourceID }) else {
        snapshot(); failure("select_failed", id); return
    }
    let result = TISSelectInputSource(selected)
    if result != noErr { snapshot(); failure("select_failed", id); return }
    let readback: String? = currentSource().flatMap { property($0, kTISPropertyInputSourceID) as String? }
    if readback != sourceID { snapshot(); failure("select_failed", id); return }
    snapshot(id)
}

if CommandLine.arguments.contains("--snapshot") {
    snapshot()
} else {
    let center = DistributedNotificationCenter.default()
    let names = [kTISNotifySelectedKeyboardInputSourceChanged, kTISNotifyEnabledKeyboardInputSourcesChanged]
    var observers: [NSObjectProtocol] = []
    for rawName in names {
        guard let rawName = rawName else { continue }
        let observer = center.addObserver(forName: Notification.Name(rawName as String), object: nil, queue: .main) { _ in snapshot() }
        observers.append(observer)
    }
    snapshot()
    DispatchQueue.global(qos: .utility).async {
        var buffer = Data()
        while true {
            let chunk = FileHandle.standardInput.availableData
            if chunk.isEmpty { DispatchQueue.main.async { exit(0) }; return }
            for byte in chunk {
                if byte == 10 {
                    let line = buffer
                    buffer.removeAll(keepingCapacity: true)
                    DispatchQueue.main.async { handle(line) }
                } else {
                    buffer.append(byte)
                    if buffer.count > maximumLineBytes {
                        DispatchQueue.main.async { failure("invalid_command"); exit(1) }
                        return
                    }
                }
            }
        }
    }
    CFRunLoopRun()
    for observer in observers { center.removeObserver(observer) }
}
