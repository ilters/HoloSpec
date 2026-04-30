import {RaycastInfo, RayProvider} from "SpectaclesInteractionKit.lspkg/Core/Interactor/RayProvider"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {MouseInput} from "./MouseInput"

/**
 * Constructs the {@link RaycastInfo} from the cursor position after a touch event has happened.
 */
export class BLETouchpadRayProvider implements RayProvider {
  private raycastInfo: RaycastInfo | null = null
  private cursorPosition: vec2 | null = null
  private camera = WorldCameraFinderProvider.getInstance()
  private cursorForward = vec3.forward()
  private isUsingTouchpad = false

  private touchDownCamPosition: vec3 = vec3.zero()
  private touchDownCamUp: vec3 = vec3.zero()

  private rightHand = SIK.HandInputData.getHand("right")
  private leftHand = SIK.HandInputData.getHand("left")

  constructor(script: ScriptComponent, maxRayDistance: number) {
    script.createEvent("UpdateEvent").bind(() => {
      //only allow mouse to switch off when either hand tries to target
      var isTouchpadDownThisFrame = MouseInput.instance.isTouchpadDown()
      var pitchThreshold = 35
      var isRightHandTargeting = this.rightHand.getPalmPitchAngle() > pitchThreshold // && this.rightHand.isInTargetingPose()
      var isLefttHandTargeting = this.leftHand.getPalmPitchAngle() > pitchThreshold //&& this.leftHand.isInTargetingPose()
      if (isTouchpadDownThisFrame) {
        if (!this.isUsingTouchpad) {
          this.isUsingTouchpad = true
          this.touchDownCamPosition = this.camera.getWorldPosition()
          this.touchDownCamUp = this.camera.up()
        }
      } else {
        //enable hands so we can read palm pitch angle
        if (!this.rightHand.enabled) this.rightHand.setEnabled(true)
        if (!this.leftHand.enabled) this.leftHand.setEnabled(true)
        // toggle mouse off when targeting with either hand
        if (isRightHandTargeting || isLefttHandTargeting) {
          if (this.isUsingTouchpad) {
            this.isUsingTouchpad = false
          }
        }
      }

      this.cursorPosition = MouseInput.instance.getTouchpadPosition()
      if (this.cursorPosition === null) {
        this.raycastInfo = null
      } else {
        //const yawQuat = quat.angleAxis(-this.cursorPosition.x, vec3.up())
        const yawQuat = quat.angleAxis(-this.cursorPosition.x, this.touchDownCamUp)

        const fwdAfterY = yawQuat.multiplyVec3(this.cursorForward)

        const rightAxis = this.touchDownCamUp.cross(fwdAfterY).normalize()
        //const rightAxis = vec3.up().cross(fwdAfterY).normalize()

        const pitchQuat = quat.angleAxis(this.cursorPosition.y, rightAxis)
        const dir = pitchQuat.multiplyVec3(fwdAfterY).normalize()
        //if cursor not visible on relase, reset
        if (!MouseInput.instance.isTouchpadDown()) {
          var cursPos = this.touchDownCamPosition.add(dir.uniformScale(-50))
          var isCursorVisible = this.camera.getComponent().isSphereVisible(cursPos, 5)
          if (!isCursorVisible) {
            this.resetCursorPosition()
          }
        }
        this.raycastInfo = {
          locus: this.touchDownCamPosition,
          direction: dir.uniformScale(-1)
        }
      }
    })
  }

  private resetCursorPosition() {
    //var worldCamForward = this.camera.getTransform().right.cross(vec3.up())
    this.cursorForward = this.camera.forward()
    MouseInput.instance.resetTouchpadPosition()
  }

  /** @inheritdoc */
  getRaycastInfo(): RaycastInfo {
    return (
      this.raycastInfo ?? {
        direction: vec3.zero(),
        locus: vec3.zero()
      }
    )
  }

  /** @inheritdoc */
  isAvailable(): boolean {
    return this.isUsingTouchpad
  }

  /** @inheritdoc */
  reset(): void {}
}
