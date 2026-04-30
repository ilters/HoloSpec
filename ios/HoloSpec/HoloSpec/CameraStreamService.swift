import AVFoundation
import CoreImage
import Foundation
import UIKit

final class CameraStreamService: NSObject, ObservableObject {
    struct ColorPayload: Encodable {
        let encoding: String
        let width: Int
        let height: Int
        let data: String
    }

    struct DepthPayload: Encodable {
        let encoding: String
        let width: Int
        let height: Int
        let bytesPerRow: Int
        let data: String
        let units: String
        let intrinsics: [Float]?
        let referenceDimensions: [Int]?
        let isFiltered: Bool
    }

    struct FrameEnvelope: Encodable {
        let type: String
        let streamId: String
        let timestamp: TimeInterval
        let color: ColorPayload
        let depth: DepthPayload
    }

    @Published var endpoint = "wss://holo-speccc.up.railway.app/ws?role=publisher"
    @Published private(set) var isStreaming = false
    @Published private(set) var connectionStatus = "Idle"
    @Published private(set) var statusMessage = "Point the app at your relay URL, then start streaming."
    @Published private(set) var captureDeviceLabel = "Searching for TrueDepth camera"
    @Published private(set) var colorResolutionLabel = "-"
    @Published private(set) var depthResolutionLabel = "-"

    let captureSession = AVCaptureSession()

    private let videoOutput = AVCaptureVideoDataOutput()
    private let depthOutput = AVCaptureDepthDataOutput()
    private let processingQueue = DispatchQueue(label: "com.holospec.processing")
    private let sessionQueue = DispatchQueue(label: "com.holospec.capture")
    private let ciContext = CIContext()
    private let streamId = UUID().uuidString
    private let jsonEncoder = JSONEncoder()
    private let targetFrameInterval: TimeInterval = 0.25

    private var configured = false
    private var outputSynchronizer: AVCaptureDataOutputSynchronizer?
    private var webSocketTask: URLSessionWebSocketTask?
    private var webSocketSession: URLSession?
    private var lastFrameTime = CACurrentMediaTime()

    func toggleStreaming() {
        if isStreaming {
            stopStreaming()
            return
        }

        Task {
            await startStreaming()
        }
    }

    private func startStreaming() async {
        guard await authorizeCameraIfNeeded() else {
            await updateUI(
                connectionStatus: "Permission denied",
                statusMessage: "Camera access is required to capture RGB and depth frames."
            )
            return
        }

        do {
            try await configureCaptureSessionIfNeeded()
            try connectWebSocket()
            sessionQueue.async {
                if !self.captureSession.isRunning {
                    self.captureSession.startRunning()
                }
            }
            await MainActor.run {
                self.isStreaming = true
                self.connectionStatus = "Streaming"
                self.statusMessage = "Publishing synchronized RGB + depth frames."
            }
        } catch {
            await updateUI(
                connectionStatus: "Failed",
                statusMessage: error.localizedDescription
            )
        }
    }

    private func stopStreaming() {
        sessionQueue.async {
            if self.captureSession.isRunning {
                self.captureSession.stopRunning()
            }
        }
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        webSocketSession?.invalidateAndCancel()
        webSocketSession = nil

        Task { @MainActor in
            isStreaming = false
            connectionStatus = "Stopped"
            statusMessage = "Streaming stopped."
        }
    }

    private func authorizeCameraIfNeeded() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video)
        default:
            return false
        }
    }

    private func configureCaptureSessionIfNeeded() async throws {
        if configured {
            return
        }

        try await withCheckedThrowingContinuation { continuation in
            sessionQueue.async {
                do {
                    try self.configureCaptureSession()
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func configureCaptureSession() throws {
        guard !configured else {
            return
        }

        captureSession.beginConfiguration()
        captureSession.sessionPreset = .vga640x480

        guard let device = AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front) else {
            captureSession.commitConfiguration()
            throw StreamError.trueDepthUnavailable
        }

        let deviceInput = try AVCaptureDeviceInput(device: device)
        guard captureSession.canAddInput(deviceInput) else {
            captureSession.commitConfiguration()
            throw StreamError.failedToAddInput
        }
        captureSession.addInput(deviceInput)

        try device.lockForConfiguration()
        if let depthFormat = device.activeFormat.supportedDepthDataFormats.first(where: {
            CMFormatDescriptionGetMediaSubType($0.formatDescription) == kCVPixelFormatType_DepthFloat32
        }) {
            device.activeDepthDataFormat = depthFormat
        }
        device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 15)
        device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 15)
        device.unlockForConfiguration()

        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)
        ]

        guard captureSession.canAddOutput(videoOutput) else {
            captureSession.commitConfiguration()
            throw StreamError.failedToAddVideoOutput
        }
        captureSession.addOutput(videoOutput)

        depthOutput.isFilteringEnabled = false
        guard captureSession.canAddOutput(depthOutput) else {
            captureSession.commitConfiguration()
            throw StreamError.failedToAddDepthOutput
        }
        captureSession.addOutput(depthOutput)

        if let videoConnection = videoOutput.connection(with: .video) {
            videoConnection.videoOrientation = .portrait
            if videoConnection.isVideoMirroringSupported {
                videoConnection.isVideoMirrored = true
            }
        }

        if let depthConnection = depthOutput.connection(with: .depthData) {
            depthConnection.videoOrientation = .portrait
            if depthConnection.isVideoMirroringSupported {
                depthConnection.isVideoMirrored = true
            }
        }

        outputSynchronizer = AVCaptureDataOutputSynchronizer(dataOutputs: [videoOutput, depthOutput])
        outputSynchronizer?.setDelegate(self, queue: processingQueue)

        configured = true
        captureSession.commitConfiguration()

        Task { @MainActor in
            captureDeviceLabel = device.localizedName
            statusMessage = "TrueDepth capture configured."
        }
    }

    private func connectWebSocket() throws {
        guard let url = URL(string: endpoint) else {
            throw StreamError.invalidWebSocketURL
        }

        webSocketSession?.invalidateAndCancel()
        webSocketSession = URLSession(configuration: .default)
        webSocketTask = webSocketSession?.webSocketTask(with: url)
        webSocketTask?.resume()
        receiveMessages()

        let helloMessage = [
            "type": "hello",
            "role": "publisher",
            "streamId": streamId,
            "source": "ios-truedepth"
        ]
        let data = try JSONSerialization.data(withJSONObject: helloMessage)
        guard let string = String(data: data, encoding: .utf8) else {
            throw StreamError.invalidHelloPayload
        }
        webSocketTask?.send(.string(string)) { [weak self] error in
            if let error {
                Task {
                    await self?.updateUI(
                        connectionStatus: "Socket error",
                        statusMessage: error.localizedDescription
                    )
                }
            }
        }
    }

    private func receiveMessages() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .success(.string(let message)):
                Task {
                    await self.handleServerMessage(message)
                }
                self.receiveMessages()
            case .success(.data):
                self.receiveMessages()
            case .failure(let error):
                Task {
                    await self.updateUI(
                        connectionStatus: "Socket closed",
                        statusMessage: error.localizedDescription
                    )
                }
            @unknown default:
                break
            }
        }
    }

    @MainActor
    private func handleServerMessage(_ message: String) {
        guard let data = message.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else {
            return
        }

        if type == "hello_ack" {
            connectionStatus = "Connected"
            statusMessage = "Relay acknowledged publisher connection."
        }
    }

    @MainActor
    private func updateUI(connectionStatus: String, statusMessage: String) {
        self.connectionStatus = connectionStatus
        self.statusMessage = statusMessage
        self.isStreaming = connectionStatus == "Streaming" || connectionStatus == "Connected"
    }

    @MainActor
    private func updateFrameLabels(color: ColorPayload, depth: DepthPayload) {
        colorResolutionLabel = "\(color.width) x \(color.height)"
        depthResolutionLabel = "\(depth.width) x \(depth.height) (\(depth.bytesPerRow) B/row)"
    }

    private func sendFrame(color: ColorPayload, depth: DepthPayload, timestamp: TimeInterval) {
        let envelope = FrameEnvelope(
            type: "frame",
            streamId: streamId,
            timestamp: timestamp,
            color: color,
            depth: depth
        )

        guard let data = try? jsonEncoder.encode(envelope),
              let string = String(data: data, encoding: .utf8) else {
            return
        }

        webSocketTask?.send(.string(string)) { [weak self] error in
            if let error {
                Task {
                    await self?.updateUI(
                        connectionStatus: "Socket error",
                        statusMessage: error.localizedDescription
                    )
                }
            }
        }
    }

    private func makeColorPayload(from pixelBuffer: CVPixelBuffer) -> ColorPayload? {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let rect = CGRect(
            x: 0,
            y: 0,
            width: CVPixelBufferGetWidth(pixelBuffer),
            height: CVPixelBufferGetHeight(pixelBuffer)
        )

        guard let cgImage = ciContext.createCGImage(ciImage, from: rect) else {
            return nil
        }

        let image = UIImage(cgImage: cgImage)
        guard let jpegData = image.jpegData(compressionQuality: 0.65) else {
            return nil
        }

        return ColorPayload(
            encoding: "jpeg-base64",
            width: cgImage.width,
            height: cgImage.height,
            data: jpegData.base64EncodedString()
        )
    }

    private func makeDepthPayload(from depthData: AVDepthData) -> DepthPayload? {
        let converted = depthData.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        let pixelBuffer = converted.depthDataMap

        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer {
            CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly)
        }

        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
            return nil
        }

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let byteCount = bytesPerRow * height
        let data = Data(bytes: baseAddress, count: byteCount)

        var intrinsics: [Float]?
        var referenceDimensions: [Int]?
        if let calibration = converted.cameraCalibrationData {
            let matrix = calibration.intrinsicMatrix
            intrinsics = [
                matrix.columns.0.x, matrix.columns.0.y, matrix.columns.0.z,
                matrix.columns.1.x, matrix.columns.1.y, matrix.columns.1.z,
                matrix.columns.2.x, matrix.columns.2.y, matrix.columns.2.z
            ]
            let dimensions = calibration.intrinsicMatrixReferenceDimensions
            referenceDimensions = [Int(dimensions.width), Int(dimensions.height)]
        }

        return DepthPayload(
            encoding: "depth-float32-base64",
            width: width,
            height: height,
            bytesPerRow: bytesPerRow,
            data: data.base64EncodedString(),
            units: "meters",
            intrinsics: intrinsics,
            referenceDimensions: referenceDimensions,
            isFiltered: converted.isDepthDataFiltered
        )
    }
}

extension CameraStreamService: AVCaptureDataOutputSynchronizerDelegate {
    func dataOutputSynchronizer(
        _ synchronizer: AVCaptureDataOutputSynchronizer,
        didOutput synchronizedDataCollection: AVCaptureSynchronizedDataCollection
    ) {
        let now = CACurrentMediaTime()
        guard now - lastFrameTime >= targetFrameInterval else {
            return
        }

        guard let syncedVideo = synchronizedDataCollection.synchronizedData(for: videoOutput)
                as? AVCaptureSynchronizedSampleBufferData,
              !syncedVideo.sampleBufferWasDropped,
              let syncedDepth = synchronizedDataCollection.synchronizedData(for: depthOutput)
                as? AVCaptureSynchronizedDepthData,
              !syncedDepth.depthDataWasDropped,
              let pixelBuffer = CMSampleBufferGetImageBuffer(syncedVideo.sampleBuffer),
              let colorPayload = makeColorPayload(from: pixelBuffer),
              let depthPayload = makeDepthPayload(from: syncedDepth.depthData) else {
            return
        }

        lastFrameTime = now
        let timestamp = Date().timeIntervalSince1970
        Task { @MainActor in
            updateFrameLabels(color: colorPayload, depth: depthPayload)
        }
        sendFrame(color: colorPayload, depth: depthPayload, timestamp: timestamp)
    }
}

private enum StreamError: LocalizedError {
    case trueDepthUnavailable
    case failedToAddInput
    case failedToAddVideoOutput
    case failedToAddDepthOutput
    case invalidWebSocketURL
    case invalidHelloPayload

    var errorDescription: String? {
        switch self {
        case .trueDepthUnavailable:
            return "No front-facing TrueDepth camera is available on this device."
        case .failedToAddInput:
            return "Unable to add the TrueDepth camera input to the capture session."
        case .failedToAddVideoOutput:
            return "Unable to add the RGB video output."
        case .failedToAddDepthOutput:
            return "Unable to add the depth output."
        case .invalidWebSocketURL:
            return "The relay URL is not a valid WebSocket URL."
        case .invalidHelloPayload:
            return "Failed to serialize the WebSocket hello packet."
        }
    }
}
