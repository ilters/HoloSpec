import {Singleton} from "./Singleton"

@component
export class MouseInput extends Singleton {
  private lastAbsPos: vec2 = vec2.zero()
  private lastAbsDrag: vec2 = vec2.zero()

  private touchPadDown: boolean = false
  private isLeftDown: boolean = false
  private isDragging: boolean = false
  private dragAmount: vec3 = vec3.zero()
  private lastFrameDragDelta: vec3 = vec3.zero()

  onAwake() {
    super.onAwake()
  }

  onTouchPadStateChagned() {
    this.lastAbsPos = vec2.zero()
    this.lastAbsDrag = vec2.zero()
  }

  setDragPosition(absDragPos: vec2) {
    //set touch state t0 zero if we are dragging
    this.lastAbsPos = vec2.zero()
    if (this.lastAbsDrag.distance(vec2.zero()) < 0.0001) {
      this.lastAbsDrag = absDragPos
      this.lastFrameDragDelta = vec3.zero()
      return // first touch, no delta
    }

    const delta = absDragPos.sub(this.lastAbsDrag)
    this.lastAbsDrag = absDragPos

    const sensitivity = 0.05
    const moveX = delta.x * sensitivity
    const moveY = -delta.y * sensitivity

    // Store the per-frame delta for scroll consumption
    this.lastFrameDragDelta = new vec3(moveX, moveY, 0)
    
    this.dragAmount = this.dragAmount.add(this.lastFrameDragDelta)
  }

  setTouchpadDown(isDown: boolean) {
    this.touchPadDown = isDown
  }

  isTouchpadDown(): boolean {
    return this.touchPadDown
  }

  isLeftClickDown(): boolean {
    return this.isLeftDown
  }

  setMouseState(isLeftDown: boolean, isRightDown: boolean) {
    this.isLeftDown = isLeftDown
  }

  getTouchpadPosition(): vec2 {
    return this.cursorLocalPos
  }

  resetTouchpadPosition() {
    this.cursorLocalPos = vec2.zero()
  }

  setDragState(dragging: boolean) {
    if (!dragging && this.isDragging) {
      // Dragging just stopped - reset deltas
      this.lastFrameDragDelta = vec3.zero()
    }
    this.isDragging = dragging
  }

  getIsDragging(): boolean {
    return this.isDragging
  }

  getDragPosition(): vec3 {
    return this.dragAmount
  }
  
  /**
   * Get the per-frame drag delta (for scrolling)
   * This resets each frame and doesn't accumulate
   */
  getLastFrameDragDelta(): vec3 {
    return this.lastFrameDragDelta
  }
  
  /**
   * Reset the per-frame drag delta (call after consuming it)
   */
  resetLastFrameDragDelta() {
    this.lastFrameDragDelta = vec3.zero()
  }

  private cursorLocalPos: vec2 = new vec2(0, 0)
  updateMousePosition(absMousePos: vec2) {
    //this.sendDragStart = true
    if (this.lastAbsPos.distance(vec2.zero()) < 0.0001) {
      this.lastAbsPos = absMousePos
      return // first touch, no delta
    }

    const delta = absMousePos.sub(this.lastAbsPos)
    this.lastAbsPos = absMousePos

    const sensitivity = 0.00025
    const moveX = delta.x * sensitivity
    const moveY = -delta.y * sensitivity

    this.cursorLocalPos = new vec2(this.cursorLocalPos.x + moveX, this.cursorLocalPos.y + moveY)
  }
}
