import { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle";
import { RemoteBrowserClient } from "./RemoteBrowserManager";

/**
 * Visual scrollbar component for RemoteBrowser.
 * Shows a vertical scrollbar indicating the current scroll position
 * and the visible portion of the document.
 * 
 * Setup:
 * 1. Create a scrollbar track (RoundedRectangle)
 * 2. Create a scrollbar thumb (RoundedRectangle) as child
 * 3. Wire up both components to this script
 * 4. Wire up the RemoteBrowserClient
 */
@component
export class BrowserScrollbarUI extends BaseScriptComponent {
  
  @input
  @label("Browser Client")
  @hint("The RemoteBrowserClient to listen to for scroll updates")
  browserClient: RemoteBrowserClient;
  
  @input
  @label("Scrollbar Thumb")
  @hint("The thumb indicator that moves within the track")
  scrollbarThumb: RoundedRectangle;
  
  @input
  @allowUndefined
  @label("Scrollbar Track")
  @hint("The background track that contains the thumb")
  scrollbarTrack: RoundedRectangle;
  
  @input
  @label("Min Thumb Height")
  @hint("Minimum height of the scrollbar thumb in world units")
  minThumbHeight: number = 2.0;
  
  @input
  @label("Auto Hide When No Scroll")
  @hint("Hide the scrollbar when the document doesn't need scrolling")
  autoHide: boolean = true;
  
  @input
  @label("Fade Delay (seconds)")
  @hint("How long to wait before fading out the scrollbar after scrolling stops (0 = no fade)")
  fadeDelay: number = 1.5;
  
  private thumbTransform: Transform;
  private trackHeight: number = 0;
  private thumbHeight: number = 0;
  private scrollbarEnabled: boolean = true;
  private lastScrollTime: number = 0;
  private isVisible: boolean = true;
  private targetAlpha: number = 1.0;
  private currentAlpha: number = 1.0;
  
  // Materials for alpha control (optional)
  private thumbMaterial: Material | null = null;
  private trackMaterial: Material | null = null;
  
  onAwake() {
    if (!this.browserClient) {
      print("BrowserScrollbarUI: Missing browser client reference");
      return;
    }
    
    if (!this.scrollbarThumb) {
      print("BrowserScrollbarUI: Missing scrollbar thumb reference");
      return;
    }
    
    // Setup thumb and track using RoundedRectangle sizes
    this.thumbTransform = this.scrollbarThumb.getSceneObject().getTransform();
    this.thumbHeight = this.scrollbarThumb.size.y;
    
    // Get the track's height from its RoundedRectangle size
    if (this.scrollbarTrack) {
      this.trackHeight = this.scrollbarTrack.size.y;
      print(`Scrollbar - Track height: ${this.trackHeight}, Thumb height: ${this.thumbHeight}`);
    } else {
      print("Warning: No scrollbar track specified - using default");
      this.trackHeight = 50.0;
    }
    
    // Try to get materials for alpha control (optional)
    const thumbRenderMeshVisual = this.scrollbarThumb.getSceneObject().getComponent("Component.RenderMeshVisual");
    if (thumbRenderMeshVisual) {
      const visual = thumbRenderMeshVisual as RenderMeshVisual;
      this.thumbMaterial = visual.mainMaterial;
    }
    
    // Get track material for fading as well
    if (this.scrollbarTrack) {
      const trackRenderMeshVisual = this.scrollbarTrack.getSceneObject().getComponent("Component.RenderMeshVisual");
      if (trackRenderMeshVisual) {
        const visual = trackRenderMeshVisual as RenderMeshVisual;
        this.trackMaterial = visual.mainMaterial;
      }
    }
    
    // Subscribe to scroll updates
    this.browserClient.onScrollUpdate.add(this.onScrollUpdate.bind(this));
    
    // Update loop for fade animation
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
    
    print("BrowserScrollbarUI initialized");
  }
  
  private onScrollUpdate(scrollInfo: any) {
    if (!scrollInfo) {
      return;
    }
    
    this.lastScrollTime = getTime();
    this.targetAlpha = 1.0;
    
    const {
      scrollY,
      windowHeight,
      documentHeight,
      maxScrollY
    } = scrollInfo;
    
    // Check if document needs scrolling
    const needsScroll = documentHeight > windowHeight;
    
    if (!needsScroll && this.autoHide) {
      // Hide entire scrollbar if no scrolling is needed
      this.scrollbarThumb.getSceneObject().enabled = false;
      if (this.scrollbarTrack) {
        this.scrollbarTrack.getSceneObject().enabled = false;
      }
      this.isVisible = false;
      return;
    }
    
    // Show scrollbar (always ensure it's visible when we get scroll updates)
    const thumbObj = this.scrollbarThumb.getSceneObject();
    if (!thumbObj.enabled || !this.isVisible) {
      thumbObj.enabled = true;
      
      // Also show the track
      if (this.scrollbarTrack) {
        this.scrollbarTrack.getSceneObject().enabled = true;
      }
      
      this.isVisible = true;
      this.currentAlpha = 1.0;
      this.targetAlpha = 1.0;
      
      // Reset material alphas to full when re-showing
      if (this.thumbMaterial) {
        const baseColor = this.thumbMaterial.mainPass.baseColor;
        this.thumbMaterial.mainPass.baseColor = new vec4(
          baseColor.r,
          baseColor.g,
          baseColor.b,
          1.0
        );
      }
      
      if (this.trackMaterial) {
        const baseColor = this.trackMaterial.mainPass.baseColor;
        this.trackMaterial.mainPass.baseColor = new vec4(
          baseColor.r,
          baseColor.g,
          baseColor.b,
          1.0
        );
      }
    }
    
    // Update thumb position based on scroll progress
    if (this.thumbTransform && this.trackHeight > 0) {
      // Calculate scroll progress (0 to 1)
      const scrollProgress = maxScrollY > 0 ? scrollY / maxScrollY : 0;
      
      // Calculate available space for thumb movement within the track
      const availableHeight = this.trackHeight - this.thumbHeight;
      
      // At local position (0, 0), the thumb would be centered in the scrollbar
      // Calculate position range from center:
      // Top position: +availableHeight/2 (thumb at top of track, positive Y)
      // Bottom position: -availableHeight/2 (thumb at bottom of track, negative Y)
      const topPosition = +availableHeight / 2;
      
      // Map scroll progress (0 to 1) to position range
      // At 0% scroll (top of page): localY = topPosition
      // At 100% scroll (bottom of page): localY = -topPosition
      const localY = topPosition - (scrollProgress * availableHeight);
      
      const currentPos = this.thumbTransform.getLocalPosition();
      const newPosition = new vec3(
        currentPos.x,
        localY,
        currentPos.z
      );
      
      this.thumbTransform.setLocalPosition(newPosition);
      
      // Debug logging (optional)
      // print(`Scrollbar: ${(scrollProgress * 100).toFixed(1)}% | Y: ${localY.toFixed(2)}`);
    }
  }
  
  private onUpdate() {
    // Handle fade out after scroll stops
    if (this.fadeDelay > 0 && this.isVisible) {
      const timeSinceScroll = getTime() - this.lastScrollTime;
      
      if (timeSinceScroll > this.fadeDelay) {
        this.targetAlpha = 0.0;
      } else {
        this.targetAlpha = 1.0;
      }
      
      // Smooth alpha transition
      const alphaSpeed = 3.0; // Adjust for faster/slower fade
      this.currentAlpha = this.currentAlpha + (this.targetAlpha - this.currentAlpha) * getDeltaTime() * alphaSpeed;
      
      // Update material alphas for both thumb and track
      if (this.thumbMaterial) {
        const baseColor = this.thumbMaterial.mainPass.baseColor;
        this.thumbMaterial.mainPass.baseColor = new vec4(
          baseColor.r,
          baseColor.g,
          baseColor.b,
          this.currentAlpha
        );
      }
      
      if (this.trackMaterial) {
        const baseColor = this.trackMaterial.mainPass.baseColor;
        this.trackMaterial.mainPass.baseColor = new vec4(
          baseColor.r,
          baseColor.g,
          baseColor.b,
          this.currentAlpha
        );
      }
      
      // Hide completely when fully faded
      if (this.currentAlpha < 0.01) {
        this.scrollbarThumb.getSceneObject().enabled = false;
        if (this.scrollbarTrack) {
          this.scrollbarTrack.getSceneObject().enabled = false;
        }
        this.isVisible = false;
      }
    }
  }
  
  /**
   * Manually show the scrollbar
   */
  public show() {
    this.scrollbarThumb.getSceneObject().enabled = true;
    if (this.scrollbarTrack) {
      this.scrollbarTrack.getSceneObject().enabled = true;
    }
    this.isVisible = true;
    this.targetAlpha = 1.0;
    this.lastScrollTime = getTime();
  }
  
  /**
   * Manually hide the scrollbar
   */
  public hide() {
    this.scrollbarThumb.getSceneObject().enabled = false;
    if (this.scrollbarTrack) {
      this.scrollbarTrack.getSceneObject().enabled = false;
    }
    this.isVisible = false;
    this.targetAlpha = 0.0;
  }
}

