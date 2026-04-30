export class FrameRateController {
  private static _initialized: boolean = false;

  private static readonly DEFAULT_FPS: number = 60;
  private static readonly MIN_FPS: number = 1;
  private static readonly MAX_FPS: number = 60;

  private static initialize(): void {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    if (global.deviceInfoSystem.isEditor()) {
      return;
    }

    global.scene.compositor.deviceConfig = SnapOS.DeviceConfig.create();
  }

  public static setFrameRate(fps: number): void {
    this.initialize();

    if (global.deviceInfoSystem.isEditor()) {
      return;
    }

    const clampedFps = Math.max(this.MIN_FPS, Math.min(this.MAX_FPS, fps));
    global.scene.compositor.deviceConfig.frameRate = clampedFps;
  }

  public static resetToDefaultFPS(): void {
    this.setFrameRate(this.DEFAULT_FPS);
  }
}
