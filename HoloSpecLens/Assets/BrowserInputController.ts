import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand";
import { HandInteractor } from "SpectaclesInteractionKit.lspkg/Core/HandInteractor/HandInteractor";
import { MouseInteractor } from "SpectaclesInteractionKit.lspkg/Core/MouseInteractor/MouseInteractor";
import { Interactor, InteractorTriggerType } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { InteractorCursor } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorCursor/InteractorCursor";
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { TouchpadInteractor } from "./Peripherals/TouchpadInteractor";
import { MouseInput } from "./Peripherals/MouseInput";
import { CursorController } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorCursor/CursorController";

/**
 * Mouse input event data
 */
export interface MouseInputEvent {
  x: number;
  y: number;
}

/**
 * Handles browser input (mouse/hand) and converts to pixel coordinates
 */
@component
export class BrowserInputController extends BaseScriptComponent {
  @input
  @allowUndefined
  @label("Hand Interactor (Device Only)")
  @hint("Wire up the right hand interactor for mouse input on device")
  handInteractor: HandInteractor;
  
  @input
  @allowUndefined
  @label("Touchpad Interactor (Device Only)")
  @hint("Optional: Wire up the touchpad interactor for Spectacles Peripheral support")
  touchpadInteractor: TouchpadInteractor;
  
  @input
  @allowUndefined
  @label("Mouse Interactor (Editor Only)")
  @hint("Wire up the mouse interactor for testing in editor")
  mouseInteractor: MouseInteractor;
  
  @input
  @allowUndefined
  @label("Browser Window Scene Object")
  @hint("The scene object that displays the browser")
  browserWindow: SceneObject;
  
  @input
  @allowUndefined
  @label("Debug Text")
  @hint("Optional text component to display debug information")
  debugText: Text;
  
  @input
  @allowUndefined
  @label("Trigger Down Sound")
  @hint("Audio component to play when trigger is pressed down")
  triggerDownSound: AudioComponent;
  
  @input
  @allowUndefined
  @label("Trigger Up Sound")
  @hint("Audio component to play when trigger is released")
  triggerUpSound: AudioComponent;
  
  @input
  @allowUndefined
  @label("Cursor Image")
  @hint("Scene object with the cursor image to show when targeting the browser")
  cursorImg: SceneObject;
  
  @input
  @allowUndefined
  @label("Interactor Cursor")
  @hint("The InteractorCursor component to hide when targeting the browser")
  interactorCursor: CursorController;
  
  // Browser dimensions (set by parent)
  private browserWidth: number = 1280;
  private browserHeight: number = 720;
  
  // Hand tracking
  private handInputData: HandInputData | null = null;
  private trackedHand: TrackedHand | null = null;
  
  // State tracking
  private wasPinching: boolean = false;
  private wasTouchpadActive: boolean = false;
  private wasTouchpadDragging: boolean = false;
  private wasMouseActive: boolean = false;
  private lastSentMouseX: number = -1;
  private lastSentMouseY: number = -1;
  private lastMouseMoveTime: number = 0;
  private mouseMoveThrottle: number = 36; // milliseconds (~60 FPS, reduced from 50ms for better responsiveness)
  
  // Events
  private mouseMoveEvent = new Event<MouseInputEvent>();
  public readonly onMouseMove: PublicApi<MouseInputEvent> = this.mouseMoveEvent.publicApi();
  
  private mouseDownEvent = new Event<MouseInputEvent>();
  public readonly onMouseDown: PublicApi<MouseInputEvent> = this.mouseDownEvent.publicApi();
  
  private mouseUpEvent = new Event<MouseInputEvent>();
  public readonly onMouseUp: PublicApi<MouseInputEvent> = this.mouseUpEvent.publicApi();
  
  onAwake() {
    // Initialize hand tracking on device (not in editor)
    if (!global.deviceInfoSystem.isEditor()) {
      this.handInputData = HandInputData.getInstance();
      this.trackedHand = this.handInputData.getHand("right");
      print("BrowserInputController: Hand tracking initialized for right hand");
    }
    
    // Setup update event
    this.createEvent("UpdateEvent").bind(() => {
      this.onUpdate();
    });
  }
  
  /**
   * Sets the browser dimensions for coordinate conversion
   */
  public setBrowserDimensions(width: number, height: number): void {
    this.browserWidth = width;
    this.browserHeight = height;
    print("BrowserInputController: Dimensions set to " + width + "x" + height);
  }
  
  /**
   * Main update loop
   */
  private onUpdate(): void {
    if (global.deviceInfoSystem.isEditor()) {
      this.handleEditorMode();
    } else {
      this.handleDeviceMode();
    }
  }
  
  /**
   * Handles mouse interaction in editor mode
   */
  private handleEditorMode(): void {
    if (!this.mouseInteractor || !this.browserWindow) {
      return;
    }
    
    const currentInteractable = this.mouseInteractor.currentInteractable;
    
    if (!currentInteractable) {
      this.setDebugText("Not targeting anything");
      
      if (this.wasMouseActive) {
        this.triggerMouseUp();
        this.wasMouseActive = false;
      }
      
      // Hide cursor image when not targeting anything
      this.hideCursorImg(this.mouseInteractor);
      return;
    }
    
    const interactableObject = currentInteractable.sceneObject;
    const isBrowserWindow = this.isBrowserWindowOrChild(interactableObject);
    
    print("Editor: Targeting object: " + interactableObject.name + ", isBrowserWindow: " + isBrowserWindow);
    
    if (!isBrowserWindow) {
      this.setDebugText("Targeting: " + interactableObject.name);
      
      if (this.wasMouseActive) {
        this.triggerMouseUp();
        this.wasMouseActive = false;
      }
      
      // Hide cursor image when not targeting browser
      this.hideCursorImg(this.mouseInteractor);
      return;
    }
    
    const hitInfo = this.mouseInteractor.targetHitInfo;
    
    if (!hitInfo) {
      this.setDebugText("No hit info");
      this.hideCursorImg(this.mouseInteractor);
      return;
    }
    
    const coords = this.getCoordinatesFromHitInfo(hitInfo);
    const isTriggering = this.mouseInteractor.currentTrigger !== InteractorTriggerType.None;
    
    // Show and position cursor image when targeting browser
    this.showAndPositionCursorImg(hitInfo.hit.position, this.mouseInteractor);
    
    this.setDebugText(
      "Editor Mode\n" +
      "UV: " + coords.uvX.toFixed(3) + ", " + coords.uvY.toFixed(3) + "\n" +
      "Pixel: " + coords.pixelX + ", " + coords.pixelY + "\n" +
      "Trigger: " + (isTriggering ? "YES" : "NO")
    );
    
    if (isTriggering && !this.wasMouseActive) {
      this.triggerMouseDown(coords.pixelX, coords.pixelY);
      this.wasMouseActive = true;
    } else if (!isTriggering && this.wasMouseActive) {
      this.triggerMouseUp();
      this.wasMouseActive = false;
    } else {
      this.triggerMouseMove(coords.pixelX, coords.pixelY);
    }
  }
  
  /**
   * Handles hand and touchpad interaction in device mode
   */
  private handleDeviceMode(): void {
    if (!this.browserWindow) {
      return;
    }
    
    // Check which interactor is actually targeting the browser window
    const handTargetingBrowser = this.isHandTargetingBrowser();
    const touchpadTargetingBrowser = this.isTouchpadTargetingBrowser();
    
    // Prioritize hand when both are targeting the browser
    if (handTargetingBrowser) {
      this.handleHandMode();
    } else if (touchpadTargetingBrowser) {
      this.handleTouchpadMode();
    } else {
      // Nothing is targeting the browser - clear any active states
      this.setDebugText("No input active");
      
      if (this.wasPinching) {
        this.triggerMouseUp();
        this.wasPinching = false;
      }
      if (this.wasTouchpadActive) {
        this.triggerMouseUp();
        this.wasTouchpadActive = false;
      }
      
      // Hide cursor image when not targeting browser
      this.hideCursorImg(this.handInteractor);
    }
  }
  
  /**
   * Checks if hand interactor is targeting the browser window
   */
  private isHandTargetingBrowser(): boolean {
    if (!this.handInteractor || !this.trackedHand || !this.trackedHand.isTracked()) {
      return false;
    }
    
    const currentInteractable = this.handInteractor.currentInteractable;
    if (!currentInteractable) {
      return false;
    }
    
    return this.isBrowserWindowOrChild(currentInteractable.sceneObject);
  }
  
  /**
   * Checks if touchpad interactor is targeting the browser window
   */
  private isTouchpadTargetingBrowser(): boolean {
    if (!this.touchpadInteractor || !this.touchpadInteractor.isActive()) {
      return false;
    }
    
    const currentInteractable = this.touchpadInteractor.currentInteractable;
    if (!currentInteractable) {
      return false;
    }
    
    return this.isBrowserWindowOrChild(currentInteractable.sceneObject);
  }
  
  /**
   * Handles touchpad interactor input
   */
  private handleTouchpadMode(): void {
    const currentInteractable = this.touchpadInteractor!.currentInteractable;
    
    if (!currentInteractable) {
      this.setDebugText("Touchpad: Not targeting");
      
      if (this.wasTouchpadActive) {
        this.triggerMouseUp();
        this.wasTouchpadActive = false;
      }
      
      this.hideCursorImg(this.touchpadInteractor);
      return;
    }
    
    const interactableObject = currentInteractable.sceneObject;
    const isBrowserWindow = this.isBrowserWindowOrChild(interactableObject);
    
    if (!isBrowserWindow) {
      this.setDebugText("Touchpad: Targeting " + interactableObject.name);
      
      if (this.wasTouchpadActive) {
        this.triggerMouseUp();
        this.wasTouchpadActive = false;
      }
      
      this.hideCursorImg(this.touchpadInteractor);
      return;
    }
    
    const hitInfo = this.touchpadInteractor!.targetHitInfo;
    
    if (!hitInfo) {
      this.setDebugText("Touchpad: No hit info");
      this.hideCursorImg(this.touchpadInteractor);
      return;
    }
    
    const coords = this.getCoordinatesFromHitInfo(hitInfo);
    
    // Show and position cursor image when targeting browser
    this.showAndPositionCursorImg(hitInfo.hit.position, this.touchpadInteractor);
    

    const isTriggering = this.touchpadInteractor!.currentTrigger !== InteractorTriggerType.None;
    
    this.setDebugText(
      "Touchpad Mode\n" +
      "UV: " + coords.uvX.toFixed(3) + ", " + coords.uvY.toFixed(3) + "\n" +
      "Pixel: " + coords.pixelX + ", " + coords.pixelY + "\n" +
      "Trigger: " + (isTriggering ? "YES" : "NO")
    );
    
    let isDragging = MouseInput.instance.getIsDragging();
    // If we are dragging (two-finger swipe for scrolling), skip click logic
    if (isDragging) {
      this.wasTouchpadDragging = true;
      this.triggerMouseMove(coords.pixelX, coords.pixelY);
      return;
    }
    
    // If we just finished dragging, skip this frame to avoid triggering a click
    if (this.wasTouchpadDragging) {
      this.wasTouchpadDragging = false;
      return;
    }

    if (isTriggering && !this.wasTouchpadActive) {
      this.triggerMouseDown(coords.pixelX, coords.pixelY);
      this.wasTouchpadActive = true;
    } else if (!isTriggering && this.wasTouchpadActive) {
      this.triggerMouseUp();
      this.wasTouchpadActive = false;
    } else {
      this.triggerMouseMove(coords.pixelX, coords.pixelY);
    }
  }
  
  /**
   * Handles hand interactor input
   */
  private handleHandMode(): void {
    const currentInteractable = this.handInteractor!.currentInteractable;
    
    if (!currentInteractable) {
      this.setDebugText("Hand: Not targeting");
      
      if (this.wasPinching) {
        this.triggerMouseUp();
        this.wasPinching = false;
      }
      
      this.hideCursorImg(this.handInteractor);
      return;
    }
    
    const interactableObject = currentInteractable.sceneObject;
    const isBrowserWindow = this.isBrowserWindowOrChild(interactableObject);
    
    if (!isBrowserWindow) {
      this.setDebugText("Hand: Targeting " + interactableObject.name);
      
      if (this.wasPinching) {
        this.triggerMouseUp();
        this.wasPinching = false;
      }
      
      this.hideCursorImg(this.handInteractor);
      return;
    }
    
    const hitInfo = this.handInteractor!.targetHitInfo;
    
    if (!hitInfo) {
      this.setDebugText("Hand: No hit info");
      this.hideCursorImg(this.handInteractor);
      return;
    }
    
    const coords = this.getCoordinatesFromHitInfo(hitInfo);
    const isNotTargetingUI = this.handInteractor!.currentInteractable === null || isBrowserWindow;
    const isPinching = this.trackedHand ? this.trackedHand.isPinching() && isNotTargetingUI : false;
    
    // Show and position cursor image when targeting browser
    this.showAndPositionCursorImg(hitInfo.hit.position, this.handInteractor);
    
    this.setDebugText(
      "Hand Mode\n" +
      "UV: " + coords.uvX.toFixed(3) + ", " + coords.uvY.toFixed(3) + "\n" +
      "Pixel: " + coords.pixelX + ", " + coords.pixelY + "\n" +
      "Pinch: " + (isPinching ? "YES" : "NO")
    );
    
    if (isPinching && !this.wasPinching) {
      this.triggerMouseDown(coords.pixelX, coords.pixelY);
      this.wasPinching = true;
    } else if (!isPinching && this.wasPinching) {
      this.triggerMouseUp();
      this.wasPinching = false;
    } else {
      this.triggerMouseMove(coords.pixelX, coords.pixelY);
    }
  }
  
  /**
   * Converts hit info to pixel coordinates
   */
  private getCoordinatesFromHitInfo(hitInfo: any): { uvX: number, uvY: number, pixelX: number, pixelY: number } {
    const hitPosition = hitInfo.hit.position;
    const browserTransform = this.browserWindow!.getTransform();
    const localHitPosition = browserTransform.getInvertedWorldTransform().multiplyPoint(hitPosition);
    
    // Assuming the plane is centered and spans from -0.5 to 0.5 in local space
    const uvX = localHitPosition.x + 0.5;
    const uvY = 0.5 - localHitPosition.y; // Flip Y axis
    
    // Convert UV to pixel coordinates
    const pixelX = Math.floor(uvX * this.browserWidth);
    const pixelY = Math.floor(uvY * this.browserHeight);
    
    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(this.browserWidth - 1, pixelX));
    const clampedY = Math.max(0, Math.min(this.browserHeight - 1, pixelY));
    
    return { uvX, uvY, pixelX: clampedX, pixelY: clampedY };
  }
  
  /**
   * Checks if a scene object is the browser window or a child of it
   */
  private isBrowserWindowOrChild(obj: SceneObject): boolean {
    if (!this.browserWindow) {
      return false;
    }
    
    let current: SceneObject | null = obj;
    while (current) {
      if (current === this.browserWindow || current.name === "BrowserWindow") {
        return true;
      }
      current = current.getParent();
    }
    return false;
  }
  
  /**
   * Triggers mouse move event (with throttling)
   */
  private triggerMouseMove(x: number, y: number): void {
    // Check if position actually changed
    if (x === this.lastSentMouseX && y === this.lastSentMouseY) {
      return;
    }
    
    // Throttle mouse move events
    const now = Date.now();
    if (now - this.lastMouseMoveTime < this.mouseMoveThrottle) {
      return;
    }
    
    this.lastMouseMoveTime = now;
    this.lastSentMouseX = x;
    this.lastSentMouseY = y;
    
    this.mouseMoveEvent.invoke({ x, y });
  }
  
  /**
   * Triggers mouse down event
   */
  private triggerMouseDown(x: number, y: number): void {
    this.lastSentMouseX = x;
    this.lastSentMouseY = y;
    this.mouseDownEvent.invoke({ x, y });
    
    // Play trigger down sound
    if (this.triggerDownSound) {
      this.triggerDownSound.stop(false);
      this.triggerDownSound.play(1);
      print("Playing trigger DOWN sound");
    }
  }
  
  /**
   * Triggers mouse up event
   */
  private triggerMouseUp(): void {
    // Play trigger up sound (always, regardless of mouse position)
    if (this.triggerUpSound) {
      //this.triggerDownSound.stop(false);
      //this.triggerUpSound.stop(false);
      this.triggerUpSound.play(1);
      print("Playing trigger UP sound");
    }
    
    if (this.lastSentMouseX === -1 || this.lastSentMouseY === -1) {
      return;
    }
    
    this.mouseUpEvent.invoke({ 
      x: this.lastSentMouseX, 
      y: this.lastSentMouseY 
    });
  }
  
  /**
   * Sets debug text
   */
  private setDebugText(text: string): void {
    if (this.debugText) {
      this.debugText.text = text;
    }
  }
  
  /**
   * Shows and positions the cursor image at the given world position
   * Also hides the interactor cursor using the proper API
   */
  private showAndPositionCursorImg(worldPosition: vec3, interactor: Interactor): void {
    if (!this.cursorImg) {
      print("WARNING: CursorImg not assigned in inspector!");
      return;
    }
    
    try {
      // Enable the cursor image
      this.cursorImg.enabled = true;
      
      // Position it at the hit point with a small Z offset so it appears above the surface
      const transform = this.cursorImg.getTransform();
      const offsetPosition = new vec3(worldPosition.x, worldPosition.y, worldPosition.z + 0.5);
      transform.setWorldPosition(offsetPosition);
      
      // Hide the interactor cursor using its hide() method
      if (this.interactorCursor && this.interactorCursor.getCursorByInteractor(interactor)) {
        this.interactorCursor.getCursorByInteractor(interactor).hide(0.1); // 0.1 second fade out
      }
    } catch (error) {
      print("Error showing cursor: " + error);
    }
  }
  
  /**
   * Hides the cursor image and shows the interactor cursor
   */
  private hideCursorImg(interactor: Interactor): void {
    try {
      if (this.cursorImg) {
        this.cursorImg.enabled = false;
      }
      
      // Show the interactor cursor using its show() method
      if (this.interactorCursor && this.interactorCursor.getCursorByInteractor(interactor)) {
        this.interactorCursor.getCursorByInteractor(interactor).show(0.1); // 0.1 second fade in
      }
    } catch (error) {
      print("Error hiding cursor: " + error);
    }
  }
}

