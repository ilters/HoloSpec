require("LensStudio:TextInputModule");
const internetModule = require("LensStudio:InternetModule");

type HoloSpecColorPayload = {
  encoding: string;
  width: number;
  height: number;
  data: string;
};

type HoloSpecDepthPayload = {
  encoding: string;
  width: number;
  height: number;
  bytesPerRow: number;
  data: string;
  units?: string;
};

type HoloSpecFrameMessage = {
  type: string;
  streamId?: string;
  timestamp?: number;
  color?: HoloSpecColorPayload;
  depth?: HoloSpecDepthPayload;
};

type HoloSpecBinaryFrame = {
  streamId: string;
  timestamp: number;
  colorWidth: number;
  colorHeight: number;
  depthWidth: number;
  depthHeight: number;
  depthBytesPerRow: number;
  colorBytes: Uint8Array;
  depthBytes: Uint8Array;
  intrinsics: Float32Array;
  referenceWidth: number;
  referenceHeight: number;
  isFiltered: boolean;
};

const FRAME_MAGIC = "HSF1";
const FIXED_HEADER_LENGTH = 80;

@component
export class HoloSpecDualFrameClient extends BaseScriptComponent {
  @input
  @label("Server URL")
  @hint("WebSocket subscriber endpoint for the HoloSpec relay")
  serverUrl: string = "wss://holo-speccc.up.railway.app/ws?role=subscriber";

  @input
  @label("RGB Window")
  @hint("Scene object whose RenderMeshVisual should display the RGB stream")
  rgbWindow: SceneObject;

  @input
  @label("Depth Window")
  @hint("Scene object whose RenderMeshVisual should display the depth preview")
  depthWindow: SceneObject;

  @input
  @allowUndefined
  @label("RGB Status Text")
  @hint("Optional text component used for the RGB frame label and status")
  rgbStatusText: Text;

  @input
  @allowUndefined
  @label("Depth Status Text")
  @hint("Optional text component used for the depth frame label and status")
  depthStatusText: Text;

  @input
  @label("Reconnect Delay")
  @hint("Seconds to wait before reconnecting after disconnect")
  reconnectDelaySeconds: number = 2.0;

  @input
  @label("Depth Near")
  @hint("Meters mapped to the hottest/closest depth preview color")
  depthNearMeters: number = 0.2;

  @input
  @label("Depth Far")
  @hint("Meters mapped to the coolest/farthest depth preview color")
  depthFarMeters: number = 1.2;

  @input
  @label("Max Reasonable Depth")
  @hint("Depth values beyond this range are treated as invalid")
  maxReasonableDepthMeters: number = 2.0;

  private socket: WebSocket | null = null;
  private reconnectEvent: DelayedCallbackEvent | null = null;
  private shouldReconnect: boolean = true;
  private isConnecting: boolean = false;

  private rgbVisual: RenderMeshVisual | null = null;
  private depthVisual: RenderMeshVisual | null = null;
  private rgbMaterial: Material | null = null;
  private depthMaterial: Material | null = null;

  private pendingFrame: HoloSpecFrameMessage | HoloSpecBinaryFrame | null = null;
  private isDecodingColor: boolean = false;
  private binaryMessageSequence: number = 0;

  private depthTexture: Texture | null = null;
  private depthTextureProvider: ProceduralTextureProvider | null = null;
  private depthTextureWidth: number = 0;
  private depthTextureHeight: number = 0;

  private frameCount: number = 0;
  private streamId: string = "-";
  private lastTimestamp: number = 0;
  private connectionStatus: string = "Initializing";
  private hasLoggedEditorPreviewWarning: boolean = false;

  onAwake() {
    this.rgbVisual = this.getRenderMeshVisual(this.rgbWindow, "RGB");
    this.depthVisual = this.getRenderMeshVisual(this.depthWindow, "Depth");

    if (!this.rgbVisual || !this.depthVisual) {
      this.connectionStatus = "Missing frame visuals";
      this.refreshStatusText();
      return;
    }

    this.rgbMaterial = this.rgbVisual.mainMaterial.clone();
    this.rgbVisual.mainMaterial = this.rgbMaterial;

    this.depthMaterial = this.depthVisual.mainMaterial.clone();
    this.depthVisual.mainMaterial = this.depthMaterial;
    this.applyPlaceholderTextures();

    this.reconnectEvent = this.createEvent("DelayedCallbackEvent");
    this.reconnectEvent.bind(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    });

    this.refreshStatusText();
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
    this.connect();
  }

  onDestroy() {
    this.shouldReconnect = false;
    if (this.reconnectEvent) {
      this.reconnectEvent.enabled = false;
    }
    this.closeSocket();
  }

  private onUpdate(): void {
    if (!this.pendingFrame || this.isDecodingColor) {
      return;
    }

    const frame = this.pendingFrame;
    this.pendingFrame = null;
    this.renderFrame(frame);
  }

  private connect(): void {
    if (this.isConnecting || !this.serverUrl) {
      return;
    }

    if (global.deviceInfoSystem.isEditor()) {
      this.connectionStatus = "Use wearable runtime";
      if (!this.hasLoggedEditorPreviewWarning) {
        this.hasLoggedEditorPreviewWarning = true;
        print(
          "HoloSpecDualFrameClient: WebSocket streaming is not supported in Lens Studio desktop Preview. Run this lens in a wearable runtime to receive frames.",
        );
      }
      this.refreshStatusText();
      return;
    }

    this.closeSocket();
    this.isConnecting = true;
    this.connectionStatus = "Connecting";
    this.refreshStatusText();

    try {
      this.socket = internetModule.createWebSocket(this.serverUrl);
      this.socket.binaryType = "blob";
    } catch (error) {
      this.isConnecting = false;
      this.connectionStatus = "Socket create failed";
      print("HoloSpecDualFrameClient: failed to create WebSocket: " + error);
      this.refreshStatusText();
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = (_event: WebSocketEvent) => {
      this.isConnecting = false;
      this.connectionStatus = "Connected";
      this.refreshStatusText();
      this.sendHello();
    };

    this.socket.onmessage = (event: WebSocketMessageEvent) => {
      this.handleMessage(event);
    };

    this.socket.onerror = (_event: WebSocketEvent) => {
      this.isConnecting = false;
      this.connectionStatus = "Socket error";
      this.refreshStatusText();
    };

    this.socket.onclose = (event: WebSocketCloseEvent) => {
      this.isConnecting = false;
      this.socket = null;
      this.connectionStatus = "Disconnected";
      print(
        "HoloSpecDualFrameClient: socket closed code=" +
          event.code +
          " reason=" +
          event.reason,
      );
      this.refreshStatusText();
      this.scheduleReconnect();
    };
  }

  private applyPlaceholderTextures(): void {
    if (this.rgbMaterial) {
      this.rgbMaterial.mainPass.baseTex = this.createSolidTexture([
        28, 34, 48, 255,
      ]);
    }

    if (this.depthMaterial) {
      this.depthMaterial.mainPass.baseTex = this.createSolidTexture([
        12, 18, 32, 255,
      ]);
    }
  }

  private createSolidTexture(color: number[]): Texture {
    const texture = ProceduralTextureProvider.createWithFormat(
      2,
      2,
      TextureFormat.RGBA8Unorm,
    );
    const provider = texture.control as ProceduralTextureProvider;
    const pixels = new Uint8Array(2 * 2 * 4);

    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index + 0] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }

    provider.setPixels(0, 0, 2, 2, pixels);
    return texture;
  }

  private closeSocket(): void {
    if (!this.socket) {
      return;
    }

    try {
      if (this.socket.readyState === 0 || this.socket.readyState === 1) {
        this.socket.close();
      }
    } catch (error) {
      print("HoloSpecDualFrameClient: error while closing socket: " + error);
    }

    this.socket = null;
  }

  private sendHello(): void {
    if (!this.socket || this.socket.readyState !== 1) {
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: "hello",
        role: "subscriber",
      }),
    );
  }

  private handleMessage(event: WebSocketMessageEvent): void {
    if (typeof event.data !== "string") {
      this.handleBinaryMessage(event.data as Blob);
      return;
    }

    let message: HoloSpecFrameMessage;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      print("HoloSpecDualFrameClient: failed to parse message: " + error);
      return;
    }

    if (message.type === "frame") {
      if (!message.color || !message.depth) {
        return;
      }
      this.pendingFrame = message;
      return;
    }

    if (message.type === "hello_ack") {
      this.connectionStatus = "Subscribed";
      this.refreshStatusText();
      return;
    }

    if (message.type === "error") {
      this.connectionStatus = "Server error";
      print("HoloSpecDualFrameClient: server error: " + event.data);
      this.refreshStatusText();
    }
  }

  private handleBinaryMessage(blob: Blob): void {
    const sequence = ++this.binaryMessageSequence;

    blob.bytes()
      .then((bytes: Uint8Array) => {
        if (sequence !== this.binaryMessageSequence) {
          return;
        }

        const frame = this.parseBinaryFrame(bytes);
        if (!frame) {
          return;
        }

        this.pendingFrame = frame;
      })
      .catch((error: string) => {
        print("HoloSpecDualFrameClient: failed to read binary frame: " + error);
      });
  }

  private renderFrame(frame: HoloSpecFrameMessage | HoloSpecBinaryFrame): void {
    if (!this.rgbMaterial || !this.depthMaterial) {
      return;
    }

    this.frameCount += 1;
    this.streamId = this.isBinaryFrame(frame)
      ? frame.streamId
      : frame.streamId || "default";
    this.lastTimestamp = this.isBinaryFrame(frame)
      ? frame.timestamp
      : frame.timestamp || 0;
    this.connectionStatus = "Streaming";

    this.isDecodingColor = true;
    let colorBase64: string;

    if (this.isBinaryFrame(frame)) {
      this.applyAspectRatio(this.rgbWindow, frame.colorWidth, frame.colorHeight);
      this.applyAspectRatio(this.depthWindow, frame.depthWidth, frame.depthHeight);
      this.updateDepthTexture(
        frame.depthWidth,
        frame.depthHeight,
        frame.depthBytesPerRow,
        frame.depthBytes,
      );
      colorBase64 = Base64.encode(frame.colorBytes);
    } else {
      if (!frame.color || !frame.depth) {
        this.isDecodingColor = false;
        return;
      }

      this.applyAspectRatio(this.rgbWindow, frame.color.width, frame.color.height);
      this.applyAspectRatio(this.depthWindow, frame.depth.width, frame.depth.height);
      this.updateDepthTexture(
        frame.depth.width,
        frame.depth.height,
        frame.depth.bytesPerRow,
        Base64.decode(frame.depth.data),
      );
      colorBase64 = frame.color.data;
    }

    Base64.decodeTextureAsync(
      colorBase64,
      (decodedTexture: Texture) => {
        if (this.rgbMaterial) {
          this.rgbMaterial.mainPass.baseTex = decodedTexture;
        }
        this.isDecodingColor = false;
        this.refreshStatusText(frame);
      },
      () => {
        this.isDecodingColor = false;
        this.connectionStatus = "RGB decode failed";
        print("HoloSpecDualFrameClient: failed to decode RGB texture");
        this.refreshStatusText(frame);
      },
    );
  }

  private updateDepthTexture(
    width: number,
    height: number,
    bytesPerRow: number,
    depthBytes: Uint8Array,
  ): void {
    if (!this.depthMaterial) {
      return;
    }

    if (
      !this.depthTexture ||
      !this.depthTextureProvider ||
      this.depthTextureWidth !== width ||
      this.depthTextureHeight !== height
    ) {
      this.depthTexture = ProceduralTextureProvider.createWithFormat(
        width,
        height,
        TextureFormat.RGBA8Unorm,
      );
      this.depthTextureProvider = this.depthTexture
        .control as ProceduralTextureProvider;
      this.depthTextureWidth = width;
      this.depthTextureHeight = height;
      this.depthMaterial.mainPass.baseTex = this.depthTexture;
    }

    const view = new DataView(
      depthBytes.buffer,
      depthBytes.byteOffset,
      depthBytes.byteLength,
    );
    const rgbaPixels = new Uint8Array(width * height * 4);
    const range = Math.max(this.depthFarMeters - this.depthNearMeters, 0.0001);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = y * bytesPerRow + x * 4;
        const depthValue = view.getFloat32(sourceOffset, true);
        const targetIndex = ((height - 1 - y) * width + x) * 4;

        if (
          !isFinite(depthValue) ||
          depthValue <= 0 ||
          depthValue >= this.maxReasonableDepthMeters
        ) {
          rgbaPixels[targetIndex + 0] = 8;
          rgbaPixels[targetIndex + 1] = 10;
          rgbaPixels[targetIndex + 2] = 18;
          rgbaPixels[targetIndex + 3] = 255;
          continue;
        }

        const normalized = 1.0 - this.clamp(
          (depthValue - this.depthNearMeters) / range,
          0.0,
          1.0,
        );
        const color = this.turboColor(normalized);
        rgbaPixels[targetIndex + 0] = color[0];
        rgbaPixels[targetIndex + 1] = color[1];
        rgbaPixels[targetIndex + 2] = color[2];
        rgbaPixels[targetIndex + 3] = 255;
      }
    }

    this.depthTextureProvider.setPixels(0, 0, width, height, rgbaPixels);
  }

  private turboColor(normalized: number): number[] {
    const x = this.clamp(normalized, 0.0, 1.0);
    const red =
      34.61 +
      x *
        (1172.33 +
          x *
            (-10793.56 +
              x * (33300.12 + x * (-38394.49 + x * 14825.05))));
    const green =
      23.31 +
      x * (557.33 + x * (1225.33 + x * (-3574.96 + x * (2036.17 + x * -376.04))));
    const blue =
      27.2 +
      x * (3211.1 + x * (-15327.97 + x * (27814.0 + x * (-22569.18 + x * 6838.66))));

    return [
      Math.round(this.clamp(red, 0.0, 255.0)),
      Math.round(this.clamp(green, 0.0, 255.0)),
      Math.round(this.clamp(blue, 0.0, 255.0)),
    ];
  }

  private applyAspectRatio(
    windowObject: SceneObject,
    width: number,
    height: number,
  ): void {
    if (!windowObject || width <= 0 || height <= 0) {
      return;
    }

    const aspectRatio = width / height;
    const targetHeight = 30.0;
    const targetWidth = targetHeight * aspectRatio;
    const transform = windowObject.getTransform();
    const currentScale = transform.getLocalScale();
    transform.setLocalScale(new vec3(targetWidth, targetHeight, currentScale.z));
  }

  private getRenderMeshVisual(
    sceneObject: SceneObject,
    label: string,
  ): RenderMeshVisual | null {
    if (!sceneObject) {
      print("HoloSpecDualFrameClient: missing " + label + " scene object");
      return null;
    }

    const component = sceneObject.getComponent("Component.RenderMeshVisual");
    if (!component) {
      print(
        "HoloSpecDualFrameClient: " +
          label +
          " window is missing a RenderMeshVisual component",
      );
      return null;
    }

    return component as RenderMeshVisual;
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || !this.reconnectEvent) {
      return;
    }

    this.reconnectEvent.reset(Math.max(this.reconnectDelaySeconds, 0.25));
  }

  private refreshStatusText(frame?: HoloSpecFrameMessage | HoloSpecBinaryFrame): void {
    const rgbLines = [
      "RGB",
      this.connectionStatus,
      this.streamId,
      global.deviceInfoSystem.isEditor() ? "Desktop Preview has no WebSocket" : "",
      this.formatFrameInfo(frame, false),
    ];
    const depthLines = [
      "Depth",
      this.connectionStatus,
      this.streamId,
      global.deviceInfoSystem.isEditor() ? "Run on wearable device" : "",
      this.formatFrameInfo(frame, true),
    ];

    if (this.rgbStatusText) {
      this.rgbStatusText.text = rgbLines.filter((line) => line.length > 0).join("\n");
    }

    if (this.depthStatusText) {
      this.depthStatusText.text = depthLines.filter((line) => line.length > 0).join("\n");
    }
  }

  private formatFrameInfo(
    frame: HoloSpecFrameMessage | HoloSpecBinaryFrame | undefined,
    useDepthDimensions: boolean,
  ): string {
    if (!frame) {
      return this.frameCount > 0 ? "frame " + this.frameCount : "waiting";
    }

    let width = 0;
    let height = 0;

    if (this.isBinaryFrame(frame)) {
      width = useDepthDimensions ? frame.depthWidth : frame.colorWidth;
      height = useDepthDimensions ? frame.depthHeight : frame.colorHeight;
    } else {
      const payload = useDepthDimensions ? frame.depth : frame.color;
      if (!payload) {
        return this.frameCount > 0 ? "frame " + this.frameCount : "waiting";
      }
      width = payload.width;
      height = payload.height;
    }

    let suffix = width + "x" + height;
    if (this.lastTimestamp > 0) {
      suffix += " @" + Math.round(this.lastTimestamp);
    }
    return suffix;
  }

  private isBinaryFrame(
    frame: HoloSpecFrameMessage | HoloSpecBinaryFrame,
  ): frame is HoloSpecBinaryFrame {
    return (frame as HoloSpecBinaryFrame).colorBytes !== undefined;
  }

  private parseBinaryFrame(bytes: Uint8Array): HoloSpecBinaryFrame | null {
    if (bytes.byteLength < FIXED_HEADER_LENGTH) {
      return null;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = this.bytesToString(bytes.subarray(0, 4));
    if (magic !== FRAME_MAGIC) {
      return null;
    }

    const version = view.getUint8(4);
    const messageType = view.getUint8(5);
    const headerLength = view.getUint16(6, true);
    const timestamp = view.getFloat64(8, true);
    const colorWidth = view.getUint16(16, true);
    const colorHeight = view.getUint16(18, true);
    const depthWidth = view.getUint16(20, true);
    const depthHeight = view.getUint16(22, true);
    const depthBytesPerRow = view.getUint32(24, true);
    const colorLength = view.getUint32(28, true);
    const depthLength = view.getUint32(32, true);
    const streamIdLength = view.getUint16(36, true);
    const referenceWidth = view.getUint16(38, true);
    const referenceHeight = view.getUint16(40, true);
    const flags = view.getUint16(42, true);
    const intrinsics = new Float32Array(9);

    if (version !== 1 || messageType !== 1 || headerLength !== FIXED_HEADER_LENGTH + streamIdLength) {
      return null;
    }

    if (bytes.byteLength !== headerLength + colorLength + depthLength) {
      return null;
    }

    for (let index = 0; index < 9; index += 1) {
      intrinsics[index] = view.getFloat32(44 + index * 4, true);
    }

    const streamId = this.bytesToString(
      bytes.subarray(FIXED_HEADER_LENGTH, headerLength),
    ) || "default";
    const colorBytes = bytes.slice(headerLength, headerLength + colorLength);
    const depthBytes = bytes.slice(
      headerLength + colorLength,
      headerLength + colorLength + depthLength,
    );

    return {
      streamId,
      timestamp,
      colorWidth,
      colorHeight,
      depthWidth,
      depthHeight,
      depthBytesPerRow,
      colorBytes,
      depthBytes,
      intrinsics,
      referenceWidth,
      referenceHeight,
      isFiltered: (flags & 1) === 1,
    };
  }

  private bytesToString(bytes: Uint8Array): string {
    let result = "";
    for (let index = 0; index < bytes.length; index += 1) {
      result += String.fromCharCode(bytes[index]);
    }
    return result;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
