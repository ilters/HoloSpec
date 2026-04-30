import { FrameRateController } from "FrameRateController.lspkg/FrameRateController";
import {
  BrowserInputController,
  MouseInputEvent,
} from "./BrowserInputController";
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
require("LensStudio:TextInputModule");
let internetModule = require("LensStudio:InternetModule");

@component
export class RemoteBrowserClient extends BaseScriptComponent {
  // Static instance counter to detect duplicates
  private static instanceCount: number = 0;
  private instanceId: number;

  @input browserMaterial: Material;
  @input statsText: Text;

  @input
  @allowUndefined
  @label("Browser Input Controller")
  @hint("The BrowserInputController component that handles mouse/hand input")
  inputController: BrowserInputController;

  @input
  @allowUndefined
  @label("Browser Window Object")
  @hint(
    "The SceneObject that displays the browser (for scaling based on aspect ratio)",
  )
  browserWindow: SceneObject;

  @input
  @allowUndefined
  @label("Error Text")
  @hint("Optional: Text component to display connection error messages")
  errorText: Text;

  @input
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Railway (Production)", "railway"),
      new ComboBoxItem("Railway Gen UI", "railway-gen-ui"),
      new ComboBoxItem("Ngrok (Testing)", "ngrok"),
      new ComboBoxItem("Render (Backup)", "render"),
      new ComboBoxItem("Local (Development)", "local"),
    ]),
  )
  @label("Server Selection")
  @hint("Choose which server to connect to")
  serverSelection: string = "railway";

  // Frame data management - render loop pulls latest frame instead of push-based decoding
  private latestFrameData: string | null = null; // Latest base64 frame data from server
  private isDecoding: boolean = false; // Prevent concurrent decodes
  private pendingFrameCount: number = 0; // How many frames arrived but haven't been decoded yet

  private socket: WebSocket | null = null;
  private isConnecting: boolean = false; // Prevent duplicate connection attempts

  // Message buffering for fragmented WebSocket messages (Spectacles device)
  private messageBuffer: string = "";

  // Browser dimensions from server config
  private browserWidth: number = 1440;
  private browserHeight: number = 960;

  // Frame statistics
  private frameCount: number = 0;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private skippedFrameCount: number = 0;

  // FPS limiting
  private TARGET_FPS: number = 60; // Adjustable target frame rate (change this to adjust FPS limit)
  private MIN_FRAME_INTERVAL: number = 1 / 60; // Calculated from TARGET_FPS in seconds (~0.0167s for 60 FPS)
  private lastFrameStartTime: number = 0;

  // Streaming FPS tracking (how fast frames arrive from server)
  private streamingFrameCount: number = 0;
  private streamingFpsStartTime: number = 0;
  private streamingFpsFrameCount: number = 0;
  private currentStreamingFps: number = 0;

  // Render FPS tracking
  private renderFpsStartTime: number = 0;
  private renderFpsFrameCount: number = 0;
  private currentRenderFps: number = 0;
  private lastStatsUpdate: number = 0;

  // Heartbeat
  private heartbeatEvent: DelayedCallbackEvent | null = null;

  // Keyboard state
  private isKeyboardVisible: boolean = false;
  private currentText: string = "";
  private textInputSystem: TextInputSystem;

  // URL tracking
  private currentUrl: string = "";

  // Scroll tracking
  private scrollInfo: {
    scrollX: number;
    scrollY: number;
    windowWidth: number;
    windowHeight: number;
    documentWidth: number;
    documentHeight: number;
    maxScrollX: number;
    maxScrollY: number;
  } | null = null;

  // Events
  private urlChangedEvent = new Event<string>();
  public readonly onUrlChanged: PublicApi<string> =
    this.urlChangedEvent.publicApi();

  private scrollUpdateEvent = new Event<any>();
  public readonly onScrollUpdate: PublicApi<any> =
    this.scrollUpdateEvent.publicApi();

  // Server Configuration - Preset URLs
  private readonly SERVER_URLS: { [key: string]: string } = {
    railway: "wss://remote-browser-production.up.railway.app",
    "railway-gen-ui": "wss://remote-browser-gen-ui.up.railway.app",
    ngrok: "wss://brantlee-hammerless-kissably.ngrok-free.dev",
    render: "wss://remotebrowser-nl0x.onrender.com",
    local: "ws://localhost:3000",
  };

  nmrFrames: any;

  // Diagnostic counters
  private totalChunksReceived: number = 0;
  private totalMessagesProcessed: number = 0;
  private totalFramesReceived: number = 0;
  private totalDecodeAttempts: number = 0;
  private totalDecodeSuccesses: number = 0;
  private totalDecodeFailures: number = 0;
  private totalBufferOverflows: number = 0;
  private totalParseErrors: number = 0;
  private connectionStartTime: number = 0;

  // Get WebSocket URL based on current selection
  private get WEBSOCKET_URL(): string {
    return this.SERVER_URLS[this.serverSelection] || this.SERVER_URLS.railway;
  }

  public onAwake() {
    // Track instance creation
    RemoteBrowserClient.instanceCount++;
    this.instanceId = RemoteBrowserClient.instanceCount;

    // Set engine frame rate to 30, but we limit rendering to 24 FPS in handleFrame()
    FrameRateController.setFrameRate(30);

    // Initialize stats text
    if (this.statsText) {
      this.statsText.text = "Initializing...";
    }

    // Subscribe to input controller events
    if (this.inputController) {
      this.inputController.onMouseMove.add((event: MouseInputEvent) => {
        this.handleMouseMove(event.x, event.y);
      });

      this.inputController.onMouseDown.add((event: MouseInputEvent) => {
        this.handleMouseDown(event.x, event.y);
      });

      this.inputController.onMouseUp.add((event: MouseInputEvent) => {
        this.handleMouseUp(event.x, event.y);
      });
    }

    // Initialize keyboard system
    this.initializeKeyboard();

    let e = this.createEvent("DelayedCallbackEvent");
    e.bind(this.onStart.bind(this));
    e.reset(0.2);

    this.nmrFrames = 0;
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
  }

  public onStart() {
    print("[DIAG] onStart() called, serverSelection=" + this.serverSelection + " url=" + this.WEBSOCKET_URL);
    if (this.statsText) {
      this.statsText.text = "Connecting...";
    }

    this.connectToServer();
  }

  public onUpdate() {
    this.nmrFrames++;

    // Periodic diagnostic summary every 5 seconds (at ~30fps, that's ~150 frames)
    if (this.nmrFrames % 150 === 0) {
      print("[DIAG-SUMMARY] engineFrame=" + this.nmrFrames
        + " socket=" + (this.socket ? "readyState:" + this.socket.readyState : "null")
        + " chunks=" + this.totalChunksReceived
        + " msgs=" + this.totalMessagesProcessed
        + " frames=" + this.totalFramesReceived
        + " decodeOK=" + this.totalDecodeSuccesses
        + " decodeFail=" + this.totalDecodeFailures
        + " parseErr=" + this.totalParseErrors
        + " bufOverflow=" + this.totalBufferOverflows
        + " bufLen=" + this.messageBuffer.length
        + " pending=" + (this.latestFrameData !== null ? "yes" : "no")
        + " decoding=" + this.isDecoding
      );
    }

    // Render loop: Decode the latest frame if we have one and aren't already decoding
    if (this.latestFrameData !== null && !this.isDecoding) {
      this.decodeLatestFrame();
    }
  }

  public onDestroy() {
    this.cleanup();
    RemoteBrowserClient.instanceCount--;
  }

  private cleanup() {
    // Dismiss keyboard if visible
    if (this.isKeyboardVisible) {
      this.dismissKeyboard();
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Clear message buffer
    this.messageBuffer = "";

    // Close WebSocket connection properly
    if (this.socket) {
      try {
        if (this.socket.readyState === 0 || this.socket.readyState === 1) {
          this.socket.close();
        }
        this.socket = null;
      } catch (error) {
        // Silent cleanup
      }
    }
  }

  /**
   * Show error message on the UI
   */
  private showError(message: string) {
    if (this.errorText) {
      this.errorText.text = message;
      this.errorText.getSceneObject().enabled = true;
    }
  }

  /**
   * Hide error message from the UI
   */
  private hideError() {
    if (this.errorText) {
      this.errorText.getSceneObject().enabled = false;
      this.errorText.text = "";
    }
  }

  /**
   * Initialize keyboard input system
   */
  private initializeKeyboard() {
    this.textInputSystem = global.textInputSystem;
  }

  /**
   * Toggle the keyboard visibility
   */
  public toggleKeyboard() {
    if (this.isKeyboardVisible) {
      this.dismissKeyboard();
    } else {
      this.showKeyboard();
    }
  }

  /**
   * Show the keyboard
   */
  public showKeyboard() {
    if (!this.textInputSystem) {
      return;
    }

    const options = new TextInputSystem.KeyboardOptions();
    options.keyboardType = TextInputSystem.KeyboardType.Text;
    options.returnKeyType = TextInputSystem.ReturnKeyType.Done;

    // Set up text change callback
    options.onTextChanged = (newText: string, range: vec2) => {
      this.handleTextChanged(newText, range);
    };

    this.textInputSystem.requestKeyboard(options);
    this.isKeyboardVisible = true;
  }

  /**
   * Dismiss the keyboard
   */
  public dismissKeyboard() {
    if (!this.textInputSystem) {
      return;
    }

    this.textInputSystem.dismissKeyboard();
    this.isKeyboardVisible = false;
    this.currentText = "";
  }

  /**
   * Handle text changes from the keyboard
   */
  private handleTextChanged(newText: string, range: vec2) {
    const oldText = this.currentText;

    // Send keystrokes to browser
    if (newText.length > oldText.length) {
      // Text was added
      const addedText = newText.substring(oldText.length);
      for (let i = 0; i < addedText.length; i++) {
        const char = addedText.charAt(i);
        this.sendKeyPress(char);
      }
    } else if (newText.length < oldText.length) {
      // Text was deleted - send backspace
      const deletedCount = oldText.length - newText.length;
      for (let i = 0; i < deletedCount; i++) {
        this.sendKeyPress("Backspace");
      }
    } else if (newText !== oldText) {
      // Text was replaced
      this.sendType(newText);
    }

    this.currentText = newText;
  }

  /**
   * Send a single key press event
   */
  public sendKeyPress(
    key: string,
    modifiers?: {
      ctrl?: boolean;
      alt?: boolean;
      shift?: boolean;
      meta?: boolean;
    },
  ) {
    // Send both keydown and keyup to simulate a key press
    const keydownEvent: any = {
      type: "keydown",
      key: key,
    };

    const keyupEvent: any = {
      type: "keyup",
      key: key,
    };

    // Add modifiers if provided
    if (modifiers) {
      if (modifiers.ctrl) {
        keydownEvent.ctrlKey = true;
        keyupEvent.ctrlKey = true;
      }
      if (modifiers.alt) {
        keydownEvent.altKey = true;
        keyupEvent.altKey = true;
      }
      if (modifiers.shift) {
        keydownEvent.shiftKey = true;
        keyupEvent.shiftKey = true;
      }
      if (modifiers.meta) {
        keydownEvent.metaKey = true;
        keyupEvent.metaKey = true;
      }
    }

    this.sendToServer(keydownEvent);
    this.sendToServer(keyupEvent);
  }

  /**
   * Send a type event (for bulk text input)
   */
  private sendType(text: string) {
    this.sendToServer({
      type: "type",
      text: text,
    });
  }

  /**
   * Start sending periodic heartbeat pings to server
   * This keeps the connection alive and lets the server know we're still active
   */
  private startHeartbeat() {
    // Stop any existing heartbeat first
    this.stopHeartbeat();

    // Send a ping every 3 seconds
    const sendHeartbeat = () => {
      // Only send if we still have a valid socket and heartbeat hasn't been stopped
      if (!this.socket || !this.heartbeatEvent) {
        return;
      }

      this.sendToServer({ type: "ping" });

      // Schedule next heartbeat only if heartbeat is still active
      if (this.heartbeatEvent) {
        let nextEvent = this.createEvent(
          "DelayedCallbackEvent",
        ) as DelayedCallbackEvent;
        nextEvent.bind(sendHeartbeat);
        nextEvent.reset(3); // 3 seconds
        this.heartbeatEvent = nextEvent;
      }
    };

    // Create initial heartbeat event
    this.heartbeatEvent = this.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    this.heartbeatEvent.bind(sendHeartbeat);
    this.heartbeatEvent.reset(3); // 3 seconds
  }

  /**
   * Stop sending heartbeat pings
   */
  private stopHeartbeat() {
    if (this.heartbeatEvent) {
      this.heartbeatEvent = null;
    }
  }

  private connectToServer() {
    // Prevent duplicate connection attempts
    if (this.isConnecting || (this.socket && this.socket.readyState === 1)) {
      print("[DIAG] connectToServer() skipped: isConnecting=" + this.isConnecting + " readyState=" + (this.socket ? this.socket.readyState : "null"));
      return;
    }

    this.isConnecting = true;

    try {
      // Close existing connection if any
      if (this.socket) {
        try {
          if (this.socket.readyState === 0 || this.socket.readyState === 1) {
            this.socket.close();
          }
        } catch (error) {
          print("[DIAG] Error closing old socket: " + error);
        }
        this.socket = null;
      }

      // Clear message buffer for new connection
      this.messageBuffer = "";

      print("[DIAG] ==============================");
      print("[DIAG] Connecting to: " + this.WEBSOCKET_URL);
      print("[DIAG] Server selection: " + this.serverSelection);
      print("[DIAG] Instance: " + this.instanceId);
      print("[DIAG] ==============================");

      this.socket = internetModule.createWebSocket(this.WEBSOCKET_URL);

      this.socket.onopen = (event: WebSocketEvent) => {
        print("[DIAG] >>> WebSocket OPEN! Connected to " + this.WEBSOCKET_URL);
        // Clear any stale buffer from a previous failed connection
        if (this.messageBuffer.length > 0) {
          print("[DIAG] Clearing stale buffer from previous connection, len=" + this.messageBuffer.length);
          this.messageBuffer = "";
        }
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        if (this.statsText) {
          this.statsText.text = "Connected!\nWaiting for frames...";
        }
        this.hideError();
        this.startHeartbeat();
      };

      this.socket.onmessage = (event: WebSocketMessageEvent) => {
        try {
          if (event && event.data) {
            let dataStr = event.data as string;
            this.totalChunksReceived++;

            // Log first 10 chunks in detail, then every 100th
            if (this.totalChunksReceived <= 10 || this.totalChunksReceived % 100 === 0) {
              print("[DIAG] onmessage chunk #" + this.totalChunksReceived + " len=" + dataStr.length + " bufferLen=" + this.messageBuffer.length + " preview=" + dataStr.substring(0, 80));
            }

            this.processIncomingMessage(dataStr);
          } else {
            print("[DIAG] onmessage: event.data is null/undefined");
          }
        } catch (error) {
          print("[DIAG] WebSocket message error: " + error);
        }
      };

      this.socket.onclose = (event: WebSocketCloseEvent) => {
        print("[DIAG] >>> WebSocket CLOSED! code=" + event.code + " reason=" + event.reason + " wasClean=" + event.wasClean);
        this.isConnecting = false;

        if (event.wasClean) {
          if (this.statsText) {
            this.statsText.text = "Disconnected";
          }
          this.hideError();
        } else {
          if (this.statsText) {
            this.statsText.text = "Connection lost\nCode: " + event.code;
          }
          this.showError(
            "Connection Lost" + (event.reason ? "\n" + event.reason : ""),
          );
          this.attemptReconnect();
        }
      };

      this.socket.onerror = (event: WebSocketEvent) => {
        print("[DIAG] >>> WebSocket ERROR!");
        if (this.statsText) {
          this.statsText.text = "Connection error";
        }
        this.showError("Connection Error\nPlease check your connection");
      };
    } catch (error) {
      print("[DIAG] WebSocket creation error: " + error);
      this.isConnecting = false;
      this.showError("Failed to Connect\nRetrying...");
      this.attemptReconnect();
    }
  }

  /**
   * Process incoming WebSocket message, handling fragmentation on Spectacles device.
   * Messages may arrive split across multiple events, so we buffer until we have complete JSON.
   */
  private processIncomingMessage(chunk: string) {
    try {
      this.messageBuffer += chunk;

      // Try to parse complete messages from buffer
      while (this.messageBuffer.length > 0) {
        try {
          let json = JSON.parse(this.messageBuffer);
          this.totalMessagesProcessed++;
          
          if (this.totalMessagesProcessed <= 10 || this.totalMessagesProcessed % 50 === 0) {
            print("[DIAG] Message #" + this.totalMessagesProcessed + " parsed OK, type=" + json.type + " bufferWas=" + this.messageBuffer.length);
          }
          
          this.handleServerMessage(json);
          this.messageBuffer = "";
          break;
        } catch (error) {
          let errorMsg = String(error);

          if (
            errorMsg.includes("Unexpected end of input") ||
            errorMsg.includes("Unterminated string")
          ) {
            // Incomplete message - wait for more chunks (this is normal on Spectacles)
            if (this.totalChunksReceived <= 20) {
              print("[DIAG] Incomplete message, waiting for more chunks. bufferLen=" + this.messageBuffer.length);
            }
            break;
          } else if (errorMsg.includes("Unexpected token")) {
            // Could be incomplete OR corrupted/concatenated messages
            // Check if buffer starts with valid JSON opening
            let trimmed = this.messageBuffer.trimStart();
            if (trimmed.startsWith("{")) {
              // Likely incomplete - wait for more
              if (this.totalChunksReceived <= 20) {
                print("[DIAG] Unexpected token but starts with '{', waiting. bufferLen=" + this.messageBuffer.length + " last20chars='" + this.messageBuffer.substring(this.messageBuffer.length - 20) + "'");
              }
              break;
            } else {
              // Truly corrupted - clear buffer
              this.totalParseErrors++;
              print("[DIAG] Parse error (corrupted), clearing buffer. bufferLen=" + this.messageBuffer.length + " first50='" + this.messageBuffer.substring(0, 50) + "' error=" + errorMsg);
              this.messageBuffer = "";
              break;
            }
          } else {
            // Other parse error - clear buffer
            this.totalParseErrors++;
            print("[DIAG] Parse error (other), clearing buffer. error=" + errorMsg + " bufferLen=" + this.messageBuffer.length);
            this.messageBuffer = "";
            break;
          }
        }
      }

      // Safeguard: Clear buffer if too large
      if (this.messageBuffer.length > 1000000) {
        this.totalBufferOverflows++;
        print("[DIAG] !!! BUFFER OVERFLOW #" + this.totalBufferOverflows + "! bufferLen=" + this.messageBuffer.length + " Clearing.");
        this.messageBuffer = "";
      }
    } catch (error) {
      print("[DIAG] Message processing exception: " + error);
    }
  }

  private handleServerMessage(json: any) {
    try {
      switch (json.type) {
        case "connected":
          print("[DIAG] >>> SERVER 'connected' message received! width=" + json.config.width + " height=" + json.config.height + " fps=" + json.config.fps);
          print("[DIAG] >>> URL: " + json.url);
          this.connectionStartTime = getTime();

          this.browserWidth = json.config.width;
          this.browserHeight = json.config.height;

          if (this.inputController) {
            this.inputController.setBrowserDimensions(
              json.config.width,
              json.config.height,
            );
          }

          this.adjustBrowserWindowScale();

          if (this.statsText) {
            this.statsText.text =
              "Browser ready!\n" + json.config.width + "x" + json.config.height;
          }

          // Update URL state and notify listeners
          if (json.url) {
            this.currentUrl = json.url;
            this.urlChangedEvent.invoke(json.url);
          }

          // Update scroll info and notify listeners
          if (json.scrollInfo) {
            this.scrollInfo = json.scrollInfo;
            this.scrollUpdateEvent.invoke(json.scrollInfo);
          }
          break;

        case "url-changed":
          // Server is telling us the URL changed (from navigation, back, forward, clicking links, etc)
          if (json.url) {
            this.currentUrl = json.url;
            this.urlChangedEvent.invoke(json.url);
          }
          break;

        case "scroll-update":
          // Server is telling us the scroll position changed
          if (json.scrollInfo) {
            this.scrollInfo = json.scrollInfo;
            this.scrollUpdateEvent.invoke(json.scrollInfo);
          }
          break;

        case "frame":
          this.totalFramesReceived++;
          if (this.totalFramesReceived <= 5 || this.totalFramesReceived % 50 === 0) {
            print("[DIAG] Frame #" + this.totalFramesReceived + " received, dataLen=" + (json.data ? json.data.length : "null") + " elapsed=" + (getTime() - this.connectionStartTime).toFixed(1) + "s");
          }
          this.handleFrame(json.data);
          break;

        case "error":
          print("Server error: " + json.message);
          break;

        case "info":
          // Silent - info messages don't need logging
          break;

        case "pong":
          // Silent - heartbeat response
          break;

        default:
          print("Unknown message type: " + json.type);
      }
    } catch (error) {
      print("Error handling server message: " + error);
    }
  }

  /**
   * WebSocket callback: Store the latest frame data (don't decode yet)
   * This can be called multiple times per engine frame
   */
  private handleFrame(base64Data: string) {
    // Track streaming FPS (frames arriving from server)
    this.streamingFrameCount++;
    this.streamingFpsFrameCount++;

    // Initialize streaming FPS timer on first frame
    if (this.streamingFpsStartTime === 0) {
      this.streamingFpsStartTime = getTime();
    }

    // Calculate streaming FPS every 1 second
    let streamingElapsed = getTime() - this.streamingFpsStartTime;
    if (streamingElapsed >= 1.0) {
      this.currentStreamingFps = this.streamingFpsFrameCount / streamingElapsed;
      this.streamingFpsStartTime = getTime();
      this.streamingFpsFrameCount = 0;
    }

    // Store latest frame data (overwrite if multiple frames arrive in same engine frame)
    if (this.latestFrameData !== null) {
      this.skippedFrameCount++; // Previous frame was skipped
    }
    this.latestFrameData = base64Data;
    this.pendingFrameCount++;

    // Debug: Log if multiple frames arrive in the same engine frame
    if (this.pendingFrameCount > 1) {
      print(
        ">>>> " +
          this.pendingFrameCount +
          " frames arrived in engine frame " +
          this.nmrFrames,
      );
    }
  }

  /**
   * Render loop: Decode the latest available frame
   * This is called once per engine frame from onUpdate
   */
  private decodeLatestFrame() {
    if (this.latestFrameData === null) {
      return; // No frame to decode or already decoding
    }

    if (this.isDecoding) {
      print(
        ">>>> [Frame " + this.nmrFrames + "] ALREADY DECODING :" + getTime(),
      );
      return; // Already decoding
    }

    // FPS limiting: Check if enough time has passed since last frame
    let timeSinceLastFrame = getTime() - this.lastFrameStartTime;
    if (
      this.lastFrameStartTime > 0 &&
      timeSinceLastFrame < this.MIN_FRAME_INTERVAL
    ) {
      // Not enough time - keep the frame for next update
      print(
        ">>>> [Frame " +
          this.nmrFrames +
          "] SKIPPED DECODE :" +
          timeSinceLastFrame.toFixed(5) +
          "ms :" +
          getTime(),
      );
      return;
    }

    // Take the latest frame data and clear the buffer
    let frameToDecode = this.latestFrameData;
    this.latestFrameData = null;
    this.pendingFrameCount = 0;

    // Mark as decoding
    this.isDecoding = true;
    this.lastFrameStartTime = getTime();

    let decodeStartTime = getTime();
    // print(">>>> [Frame " + this.nmrFrames + "] STARTING DECODE :" + getTime());

    this.totalDecodeAttempts++;
    if (this.totalDecodeAttempts <= 5 || this.totalDecodeAttempts % 50 === 0) {
      print("[DIAG] decodeTextureAsync attempt #" + this.totalDecodeAttempts + " dataLen=" + frameToDecode.length);
    }

    // Decode base64 frame and update material texture
    Base64.decodeTextureAsync(
      frameToDecode,
      (tex) => {
        let decodeTime = getTime() * 1000 - decodeStartTime * 1000;
        this.totalDecodeSuccesses++;

        if (this.totalDecodeSuccesses <= 5 || this.totalDecodeSuccesses % 50 === 0) {
          print("[DIAG] DECODE SUCCESS #" + this.totalDecodeSuccesses + " in " + decodeTime.toFixed(1) + "ms texSize=" + tex.getWidth() + "x" + tex.getHeight());
        }

        this.browserMaterial.mainPass.baseTex = tex;
        this.isDecoding = false;

        // Count frame AFTER successful decode
        this.frameCount++;
        this.renderFpsFrameCount++;

        let now = getTime();

        // Initialize render FPS timer on first frame
        if (this.renderFpsStartTime === 0) {
          this.renderFpsStartTime = now;
        }

        // Calculate render FPS every 1 second
        let renderElapsed = now - this.renderFpsStartTime;
        if (renderElapsed >= 1.0) {
          this.currentRenderFps = this.renderFpsFrameCount / renderElapsed;
          this.renderFpsStartTime = now;
          this.renderFpsFrameCount = 0;
        }

        // Update stats display every 0.5 seconds
        if (now - this.lastStatsUpdate > 0.5) {
          if (this.statsText) {
            this.statsText.text =
              "Stream: " +
              this.currentStreamingFps.toFixed(1) +
              " FPS" +
              "\nRender: " +
              this.currentRenderFps.toFixed(1) +
              " / " +
              this.TARGET_FPS +
              " FPS" +
              "\nReceived: " +
              this.streamingFrameCount +
              "\nRendered: " +
              this.frameCount +
              "\nSkipped: " +
              this.skippedFrameCount +
              "\nDecoding: " +
              (this.isDecoding ? "Yes" : "No") +
              "\nPending: " +
              (this.latestFrameData !== null ? "1" : "0");
          }
          this.lastStatsUpdate = now;
        }
      },
      () => {
        this.totalDecodeFailures++;
        print("[DIAG] !!! DECODE FAILED #" + this.totalDecodeFailures + " frame=" + this.nmrFrames + " dataLen=" + frameToDecode.length);
        this.isDecoding = false;
      },
    );
  }

  /**
   * Adjusts the browser window scale based on aspect ratio
   * Y scale is fixed at 50, X scale is adjusted to maintain aspect ratio
   */
  private adjustBrowserWindowScale(): void {
    if (!this.browserWindow) {
      return;
    }

    const aspectRatio = this.browserWidth / this.browserHeight;
    const yScale = 30;
    const xScale = yScale * aspectRatio;

    const transform = this.browserWindow.getTransform();
    const currentScale = transform.getLocalScale();
    transform.setLocalScale(new vec3(xScale, yScale, currentScale.z));
  }

  /**
   * Handles mouse movement - sends to server
   */
  private handleMouseMove(x: number, y: number): void {
    this.sendToServer({
      type: "mousemove",
      x: x,
      y: y,
    });
  }

  /**
   * Handles mouse down - sends to server (start of click or drag)
   */
  private handleMouseDown(x: number, y: number): void {
    this.sendToServer({
      type: "mousedown",
      x: x,
      y: y,
      button: "left",
    });
  }

  /**
   * Handles mouse up - sends to server (end of click or drag)
   */
  private handleMouseUp(x: number, y: number): void {
    this.sendToServer({
      type: "mouseup",
      x: x,
      y: y,
      button: "left",
    });
  }

  private sendToServer(message: any) {
    try {
      if (this.socket && this.socket.readyState === 1) {
        this.socket.send(JSON.stringify(message));
      }
    } catch (error) {
      print("Send error: " + error);
    }
  }

  private attemptReconnect() {
    print("[DIAG] attemptReconnect() called, attempt=" + (this.reconnectAttempts + 1) + "/" + this.maxReconnectAttempts);
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.showError(
        "Reconnecting...\nAttempt " +
          this.reconnectAttempts +
          " of " +
          this.maxReconnectAttempts,
      );

      let delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
      let delayedEvent = this.createEvent(
        "DelayedCallbackEvent",
      ) as DelayedCallbackEvent;
      delayedEvent.bind(() => {
        this.connectToServer();
      });
      delayedEvent.reset(delay / 1000);
    } else {
      this.showError("Connection Failed\nMax retries reached\nPlease restart");
    }
  }

  // Public methods for browser navigation (can be called from UI or other components)
  public navigate(url: string) {
    this.sendToServer({ type: "navigate", url: url });
  }

  public goBack() {
    this.sendToServer({ type: "back" });
  }

  public goForward() {
    this.sendToServer({ type: "forward" });
  }

  public refresh() {
    this.sendToServer({ type: "refresh" });
  }

  public sendScroll(deltaX: number, deltaY: number) {
    this.sendToServer({ type: "scroll", deltaX: deltaX, deltaY: deltaY });
  }

  /**
   * Blur (unfocus) the currently active element in the browser.
   * This is useful when activating a lens-side text input to prevent
   * keyboard events from also going to the browser's focused element.
   */
  public blurActiveElement() {
    this.sendToServer({ type: "blur" });
  }

  /**
   * Get the current URL
   */
  public getCurrentUrl(): string {
    return this.currentUrl;
  }

  /**
   * Get the current server WebSocket URL (wss:// or ws://)
   * This can be used by other components to derive HTTP URLs
   */
  public getServerUrl(): string {
    return this.WEBSOCKET_URL;
  }

  /**
   * Get the current scroll info
   */
  public getScrollInfo(): any {
    return this.scrollInfo;
  }
}
