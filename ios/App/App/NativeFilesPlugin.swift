import Foundation
import UIKit
import UniformTypeIdentifiers
import Capacitor

@objc(NativeFilesPlugin)
final class NativeFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    let identifier = "NativeFilesPlugin"
    let jsName = "NativeFiles"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "beginSave", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeSaveChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openTextFile", returnType: CAPPluginReturnPromise)
    ]

    private static let maximumTextBytes = 4096

    private struct PendingOutput {
        let url: URL
        let handle: FileHandle
    }

    private enum PickerRequest {
        case open(CAPPluginCall)
        case export(CAPPluginCall, URL)
    }

    private var outputs: [String: PendingOutput] = [:]
    private var pickerRequests: [ObjectIdentifier: PickerRequest] = [:]

    @objc func beginSave(_ call: CAPPluginCall) {
        do {
            let requested = call.options["name"] as? String ?? "file"
            let component = (requested as NSString).lastPathComponent
            let name = component.isEmpty || component == "." || component == ".." ? "file" : component
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("SoftRoomExports", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(name, isDirectory: false)
            FileManager.default.createFile(atPath: url.path, contents: nil)
            let token = UUID().uuidString
            outputs[token] = PendingOutput(url: url, handle: try FileHandle(forWritingTo: url))
            call.resolve(["token": token])
        } catch {
            call.resolve(["error": "Unable to prepare the output file"])
        }
    }

    @objc func writeSaveChunk(_ call: CAPPluginCall) {
        guard let token = call.options["token"] as? String,
              let encoded = call.options["data"] as? String,
              let output = outputs[token],
              let bytes = Data(base64Encoded: encoded) else {
            call.resolve(["error": "Invalid output file"])
            return
        }

        do {
            if !bytes.isEmpty { try output.handle.write(contentsOf: bytes) }
            guard call.options["final"] as? Bool == true else {
                call.resolve()
                return
            }
            try output.handle.synchronize()
            try output.handle.close()
            outputs.removeValue(forKey: token)
            presentExport(url: output.url, call: call)
        } catch {
            outputs.removeValue(forKey: token)
            try? output.handle.close()
            removeTemporaryFile(output.url)
            call.resolve(["error": "Unable to save file"])
        }
    }

    @objc func openTextFile(_ call: CAPPluginCall) {
        guard pickerRequests.isEmpty else {
            call.resolve(["error": "A file picker is already open"])
            return
        }
        let picker = UIDocumentPickerViewController(
            forOpeningContentTypes: [.json, .plainText, .data],
            asCopy: true
        )
        picker.delegate = self
        picker.allowsMultipleSelection = false
        pickerRequests[ObjectIdentifier(picker)] = .open(call)
        present(picker, call: call)
    }

    private func presentExport(url: URL, call: CAPPluginCall) {
        guard pickerRequests.isEmpty else {
            removeTemporaryFile(url)
            call.resolve(["error": "A file picker is already open"])
            return
        }
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        picker.delegate = self
        pickerRequests[ObjectIdentifier(picker)] = .export(call, url)
        present(picker, call: call)
    }

    private func present(_ picker: UIDocumentPickerViewController, call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.presenter() else {
                self?.pickerRequests.removeValue(forKey: ObjectIdentifier(picker))
                call.resolve(["error": "Unable to open the file picker"])
                return
            }
            presenter.present(picker, animated: true)
        }
    }

    private func presenter() -> UIViewController? {
        let root = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?.rootViewController
        var visible = root
        while let presented = visible?.presentedViewController { visible = presented }
        return visible
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishPicker(controller, urls: nil)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finishPicker(controller, urls: urls)
    }

    private func finishPicker(_ picker: UIDocumentPickerViewController, urls: [URL]?) {
        guard let request = pickerRequests.removeValue(forKey: ObjectIdentifier(picker)) else { return }
        switch request {
        case .export(let call, let temporaryURL):
            removeTemporaryFile(temporaryURL)
            call.resolve(["cancelled": urls?.isEmpty != false])
        case .open(let call):
            guard let url = urls?.first else {
                call.resolve(["cancelled": true])
                return
            }
            let accessing = url.startAccessingSecurityScopedResource()
            defer { if accessing { url.stopAccessingSecurityScopedResource() } }
            do {
                let values = try url.resourceValues(forKeys: [.fileSizeKey])
                if let size = values.fileSize, size > Self.maximumTextBytes {
                    call.resolve(["error": "Input file is too large"])
                    return
                }
                let data = try Data(contentsOf: url, options: [.mappedIfSafe])
                guard data.count <= Self.maximumTextBytes,
                      let text = String(data: data, encoding: .utf8) else {
                    call.resolve(["error": "Unable to read file"])
                    return
                }
                call.resolve(["text": text])
            } catch {
                call.resolve(["error": "Unable to read file"])
            }
        }
    }

    private func removeTemporaryFile(_ url: URL) {
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }
}
