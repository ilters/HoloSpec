import { HandInteractor } from "SpectaclesInteractionKit.lspkg/Core/HandInteractor/HandInteractor";
import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { InteractorInputType } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { SIK } from "SpectaclesInteractionKit.lspkg/SIK";
import { RemoteBrowserClient } from "./RemoteBrowserManager";
import { TouchpadInteractor } from "./Peripherals/TouchpadInteractor";
import { MouseInput } from "./Peripherals/MouseInput";

/**
 * Scroll input controller for RemoteBrowser.
 * Handles scroll input from hand gestures and touchpad two-finger swipe.
 * 
 * Hand Usage:
 * 1. Pinch (not targeting any element)
 * 2. Hold for a brief moment
 * 3. Move hand up/down to scroll
 * 4. Release pinch to stop
 * 
 * Touchpad Usage:
 * 1. Two-finger swipe up/down on touchpad to scroll
 */
@component
export class BrowserScrollController extends BaseScriptComponent {
  
  @input
  @label("Browser Client")
  @hint("The RemoteBrowserClient to send scroll events to")
  browserClient: RemoteBrowserClient;
  
  @input
  @allowUndefined
  @label("Touchpad Interactor")
  @hint("Optional: Wire up touchpad interactor for two-finger swipe scrolling")
  touchpadInteractor: TouchpadInteractor;
  
  @input
  @allowUndefined
  @label("Browser Window Object")
  @hint("The SceneObject that displays the browser. If targeting this or its children, universal scrolling will be disabled to allow for mouse interaction.")
  browserWindow: SceneObject;

  scrollSpeed: number = 400.0;
  
  touchpadScrollSpeed: number = 250.0;
  
  @input
  @label("Activation Delay")
  @hint("How long to hold pinch before scroll mode activates (seconds)")
  activationDelay: number = 0.15;
  
  @input
  @label("Movement Threshold")
  @hint("Maximum hand movement allowed during activation delay (cm)")
  movementThreshold: number = 2.0;
  
  // Hand tracking
  private handInputData = SIK.HandInputData;
  private rightHand = this.handInputData.getHand('right');
  private rightHandInteractor: HandInteractor;
  
  // Gesture state
  private gestureModule: GestureModule = require('LensStudio:GestureModule');
  private isPinchDown: boolean = false;
  private isScrollModeActive: boolean = false;
  private pinchDownTime: number = 0;
  private pinchStartPosition: vec3 = vec3.zero();
  private currentPinchPosition: vec3 = vec3.zero();
  private previousPinchPosition: vec3 = vec3.zero();
  
  // Scroll tracking
  private scrollStartY: number = 0;
  private scrollVelocity: number = 0;
  private velocityWindow: number[] = [];
  private velocityFrameIndex: number = 1;
  
  // Gizmo
  private gizmoTransform: Transform;
  
  // Editor testing (mouse/touch simulation)
  private mouseInteractor: any;
  private editorPinchPosition: vec3 = vec3.zero();
  
  // Touchpad scrolling
  private wasTouchpadDragging: boolean = false;

  onAwake() {
    // Get hand interactor
    const interactionManager = InteractionManager.getInstance();
    const interactors = interactionManager.getInteractorsByType(InteractorInputType.RightHand);
    if (interactors.length > 0) {
      this.rightHandInteractor = interactors[0] as HandInteractor;
    }
    
    // Get mouse interactor for editor testing
    const mouseInteractors = interactionManager.getInteractorsByType(InteractorInputType.Mouse);
    if (mouseInteractors.length > 0) {
      this.mouseInteractor = mouseInteractors[0];
    }
    

    // Setup gesture events
    this.gestureModule.getPinchDownEvent(GestureModule.HandType.Right).add(this.onPinchDown.bind(this));
    this.gestureModule.getPinchUpEvent(GestureModule.HandType.Right).add(this.onPinchUp.bind(this));
    
    // Update loop
    this.createEvent("UpdateEvent").bind(this.updateEvent.bind(this));
    
    // Editor testing support
    if (global.deviceInfoSystem.isEditor()) {
      this.createEvent("TouchStartEvent").bind(this.onTouchDown.bind(this));
      this.createEvent("TouchMoveEvent").bind(this.onTouchMove.bind(this));
      this.createEvent("TouchEndEvent").bind(this.onTouchUp.bind(this));
    }
    
    print("BrowserScrollController initialized");
  }
  
  private onPinchDown() {
    // Only activate if not targeting any UI element that should handle its own input
    if (this.rightHandInteractor && this.rightHandInteractor.currentInteractable) {
      const targetObject = this.rightHandInteractor.currentInteractable.getSceneObject();
      const targetName = targetObject.name;
      
      // Check if we are targeting the browser window or its children
      const isBrowserTarget = this.isBrowserWindowOrChild(targetObject);
      
      // If we're targeting the browser window, we should NOT activate universal scrolling
      // as that space is reserved for mouse interactions (clicking/dragging)
      if (isBrowserTarget) {
        print("BrowserScrollController: Targeting browser window, universal scrolling disabled");
        return;
      }
      
      // Allow activation only if targeting background/nothing important
      if (targetName !== "BackPlane") {
        return;
      }
    }
    
    this.isPinchDown = true;
    this.pinchDownTime = getTime();
    
    this.pinchStartPosition = this.getPinchPosition();
    this.currentPinchPosition = this.pinchStartPosition;
    this.previousPinchPosition = this.pinchStartPosition;
    
    // Interrupt any ongoing velocity
    this.scrollVelocity = 0;
  }
  
  private onPinchUp() {
    this.isPinchDown = false;
    this.deactivateScrollMode();
  }
  
  // Editor testing support
  private onTouchDown(eventData) {
    if (this.mouseInteractor && this.mouseInteractor.currentInteractable) {
      return;
    }
    
    this.isPinchDown = true;
    this.pinchDownTime = getTime();
    this.editorPinchPosition = new vec3(
      eventData.getTouchPosition().x * 20, 
      -eventData.getTouchPosition().y * 20, 
      0
    );
    
    this.pinchStartPosition = this.getPinchPosition();
    this.currentPinchPosition = this.pinchStartPosition;
    this.previousPinchPosition = this.pinchStartPosition;
  }
  
  private onTouchMove(eventData) {
    this.editorPinchPosition = new vec3(
      eventData.getTouchPosition().x * 20, 
      -eventData.getTouchPosition().y * 20, 
      0
    );
  }
  
  private onTouchUp(eventData) {
    this.isPinchDown = false;
    this.deactivateScrollMode();
  }
  
  private getPinchPosition(): vec3 {
    if (global.deviceInfoSystem.isEditor()) {
      return this.editorPinchPosition;
    }
    return this.rightHand.thumbTip.position;
  }
  
  private activateScrollMode() {
    if (!this.isScrollModeActive) {
      this.isScrollModeActive = true;
      
      // Reset scroll tracking
      this.scrollStartY = this.pinchStartPosition.y;
      this.pinchStartPosition = this.getPinchPosition();
      this.currentPinchPosition = this.pinchStartPosition;
      this.previousPinchPosition = this.pinchStartPosition;
      this.velocityWindow = [];
    }
  }
  
  private deactivateScrollMode() {
    if (this.isScrollModeActive) {
      this.isScrollModeActive = false;
      
      this.velocityWindow = [];
    }
  }

  /**
   * Checks if a scene object is the browser window or a child of it
   */
  private isBrowserWindowOrChild(obj: SceneObject): boolean {
    if (!this.browserWindow) {
      // Fallback to name check if input is not assigned
      let current: SceneObject | null = obj;
      while (current) {
        if (current.name === "BrowserWindow") {
          return true;
        }
        current = current.getParent();
      }
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
  
  private updateEvent() {
    if (!this.browserClient) {
      return;
    }
    
    const deltaTime = getDeltaTime();
    if (deltaTime <= 0) return;
    
    const currentTime = getTime();
    
    // Check if touchpad is currently targeting anything (active in the scene)
    const isTouchpadActive = this.touchpadInteractor && this.touchpadInteractor.isActive();
    
    // Disable hand pinch scrolling when touchpad is targeting the browser
    if (isTouchpadActive) {
      // If hand scroll was active, deactivate it
      if (this.isScrollModeActive) {
        this.deactivateScrollMode();
      }
      // Reset pinch state
      if (this.isPinchDown) {
        this.isPinchDown = false;
      }
    } else {
      // Only handle hand pinch scrolling when touchpad is not active
      
      // Check if we should activate scroll mode
      if (this.isPinchDown && !this.isScrollModeActive) {
        this.currentPinchPosition = this.getPinchPosition();
        
        // Calculate movement from initial pinch position
        const diff = this.currentPinchPosition.sub(this.pinchStartPosition);
        const movementDistance = Math.sqrt(diff.x * diff.x + diff.y * diff.y + diff.z * diff.z);
        
        // Activate if:
        // 1. Held for long enough
        // 2. Hand hasn't moved too much
        if (currentTime - this.pinchDownTime >= this.activationDelay && 
            movementDistance < this.movementThreshold) {
          this.activateScrollMode();
        }
      }
      
      // Handle scrolling when scroll mode is active
      if (this.isScrollModeActive) {
        this.previousPinchPosition = this.currentPinchPosition;
        this.currentPinchPosition = this.getPinchPosition();
        
        // Calculate vertical movement (Y axis)
        const frameVerticalDelta = this.currentPinchPosition.y - this.previousPinchPosition.y;
        
        // Convert to scroll delta
        const scrollDelta = frameVerticalDelta * this.scrollSpeed;
        
        // Send scroll event to browser if there's meaningful movement
        if (Math.abs(scrollDelta) > 0.1) {
          this.browserClient.sendScroll(0, scrollDelta);
          
          // Track velocity for potential inertia
          this.scrollVelocity = scrollDelta / deltaTime;
          this.velocityWindow.unshift(this.scrollVelocity);
          if (this.velocityWindow.length > 10) {
            this.velocityWindow.pop();
          }
        }
        
        // Update gizmo position to follow hand
        if (this.gizmoTransform) {
          this.gizmoTransform.setWorldPosition(this.currentPinchPosition);
        }
      }
    }
    
    // Handle touchpad two-finger swipe scrolling
    this.handleTouchpadScrolling(deltaTime);
  }
  
  /**
   * Handles touchpad two-finger swipe scrolling
   */
  private handleTouchpadScrolling(deltaTime: number) {
    if (!this.touchpadInteractor || !this.browserClient) {
      return;
    }
    
    // Check if touchpad is in drag mode (two-finger swipe)
    const isDragging = MouseInput.instance.getIsDragging();
    
    if (isDragging) {
      // Get the per-frame drag delta from MouseInput
      const dragDelta = MouseInput.instance.getLastFrameDragDelta();
      
      // Convert Y drag to scroll (swipe down = scroll down)
      const scrollDelta = dragDelta.y * this.touchpadScrollSpeed;
      
      // Send scroll event if there's meaningful movement
      if (Math.abs(scrollDelta) > 0.1) {
        this.browserClient.sendScroll(0, scrollDelta);
      }
      
      // Reset the delta after consuming it
      MouseInput.instance.resetLastFrameDragDelta();
      
      this.wasTouchpadDragging = true;
    } else {
      // Not dragging - reset state
      if (this.wasTouchpadDragging) {
        this.wasTouchpadDragging = false;
      }
    }
  }
}
