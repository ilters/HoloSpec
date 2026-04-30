import { BaseButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton";
import { FrameRateController } from "FrameRateController.lspkg/FrameRateController";

@component
export class FrameRateExample extends BaseScriptComponent {
  @input
  fps30Button: BaseButton;
  @input
  fps45Button: BaseButton;
  @input
  fps60Button: BaseButton;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this.fps30Button.onTriggerDown.add(() => {
        FrameRateController.setFrameRate(30);
      });
      this.fps45Button.onTriggerDown.add(() => {
        FrameRateController.setFrameRate(45);
      });
      this.fps60Button.onTriggerDown.add(() => {
        FrameRateController.setFrameRate(60);
      });
    });
  }
}
