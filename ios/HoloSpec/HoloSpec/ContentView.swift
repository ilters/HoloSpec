import AVFoundation
import SwiftUI

struct ContentView: View {
    @StateObject private var streamService = CameraStreamService()

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                CameraPreviewContainer(session: streamService.captureSession)
                    .frame(maxWidth: .infinity)
                    .frame(height: 360)
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .stroke(Color.white.opacity(0.12), lineWidth: 1)
                    )

                VStack(alignment: .leading, spacing: 12) {
                    Text("Relay URL")
                        .font(.headline)

                    TextField("ws://192.168.1.10:8080/ws?role=publisher", text: $streamService.endpoint)
                        .textInputAutocapitalization(.never)
                        .disableAutocorrection(true)
                        .textFieldStyle(.roundedBorder)

                    LabeledContent("Status", value: streamService.connectionStatus)
                    LabeledContent("Device", value: streamService.captureDeviceLabel)
                    Text(streamService.statusMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
                .background(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(Color(uiColor: .secondarySystemBackground))
                )

                Button(streamService.isStreaming ? "Stop Streaming" : "Start Streaming") {
                    streamService.toggleStreaming()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
            }
            .padding()
            .navigationTitle("HoloSpec Publisher")
        }
    }
}

private struct CameraPreviewContainer: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        uiView.previewLayer.session = session
    }
}

private final class PreviewView: UIView {
    override class var layerClass: AnyClass {
        AVCaptureVideoPreviewLayer.self
    }

    var previewLayer: AVCaptureVideoPreviewLayer {
        guard let layer = layer as? AVCaptureVideoPreviewLayer else {
            fatalError("Preview layer is not AVCaptureVideoPreviewLayer")
        }
        return layer
    }
}

#Preview {
    ContentView()
}

