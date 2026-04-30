import {MouseInput} from "./MouseInput"
import {TouchpadInteractor} from "./TouchpadInteractor"

const HID_SERVICE_UUID = "0x1812" // Bluetooth HID Service UUID

@component
export class BLEService extends BaseScriptComponent {
  @input bluetoothModule: Bluetooth.BluetoothCentralModule
  @input screenText: Text
  
  @input
  @allowUndefined
  @label("Touchpad Interactor")
  @hint("Optional: TouchpadInteractor component for touchpad input")
  touchpadInteractor: TouchpadInteractor
  
  @input
  @allowUndefined
  @label("Mouse Input")
  @hint("Optional: MouseInput component for mouse/touchpad handling")
  mouseInput: MouseInput

  private scanFilter = new Bluetooth.ScanFilter()
  private scanSetting = new Bluetooth.ScanSettings()

  onAwake() {
    this.scanFilter.serviceUUID = HID_SERVICE_UUID
    this.scanSetting.uniqueDevices = true
    this.scanSetting.timeoutSeconds = 10000
    this.createEvent("OnStartEvent").bind(this.onStart.bind(this))
  }

  private onStart() {
    this.scanForDevices()
  }

  private async scanForDevices() {
    this.screenText.text = "Looking for device..."
    this.log("starting scan...")

    try {
      const scanResult = await this.bluetoothModule.startScan(
        [this.scanFilter],
        this.scanSetting,
        (result) => {
          const deviceName = result.deviceName ?? ""
          return deviceName.includes("Touch")
        },
      )

      if (!scanResult) {
        this.log("no matching touchpad device found")
        this.screenText.text = "No touchpad found"
        return
      }

      const deviceName = scanResult.deviceName ?? "Unknown device"
      this.log("Found device: " + deviceName)
      this.screenText.text = "Found device!\n" + deviceName
      await this.connectGATT(scanResult)
      this.log("scan complete...")
    } catch (error) {
      this.log("scan failed: " + error)
      this.screenText.text = "Scan failed"
    }
  }

  async connectGATT(scanResult: Bluetooth.ScanResult) {
    this.log("Attempting connection~~~")
    let gatt = await this.bluetoothModule.connectGatt(scanResult.deviceAddress)
    this.log("connected~~~")

    gatt.onDisconnectedEvent.add(() => {
      this.log("device disconnected")
    })

    const deviceName = scanResult.deviceName ?? ""
    const services = gatt.getServices()

    for (let i = 0; i < services.length; i++) {
      const service = services[i]
      if (service.uuid == HID_SERVICE_UUID) {
        this.log("Found HID Service index: " + i)
        for (const char of service.getCharacteristics()) {
          await char.registerNotifications((buf) => {
            if (deviceName.includes("Touch")) {
              this.HandleTouchPadMakeRelative(buf)
            }
          })
          this.log("registered for notifications on: " + char.uuid)
        }
      }
    }
  }

  private HandleTouchPadMakeRelative(pkt: Uint8Array) {
    if (!this.mouseInput) {
      return; // Skip touchpad handling if mouseInput is not assigned
    }
    
    var isDragging = pkt[5] == 7
    this.mouseInput.setDragState(isDragging)
    var isTouchpadDown = pkt[0] == 3
    this.mouseInput.setTouchpadDown(isTouchpadDown)

    if (pkt[0] == 1) {
      // VirtualInputField.instance.clearAllText()
      this.mouseInput.onTouchPadStateChagned()
      return
    } else if (isTouchpadDown) {
      if (isDragging) {
        const scrollPos = new vec2(((pkt[8] & 0x0f) << 8) | pkt[7], (pkt[9] << 4) | (pkt[8] >> 4))
        this.mouseInput.setDragPosition(scrollPos)
      } else {
        const currPos = new vec2(((pkt[3] & 0x0f) << 8) | pkt[2], (pkt[4] << 4) | (pkt[3] >> 4))
        this.mouseInput.updateMousePosition(currPos)

        const flags = pkt[15]
        const isPressed = (flags & 0x80) !== 0
        const contactCount = flags & 0x7f
        var isLeftDown = contactCount === 1 && isPressed
        var isRightDown = contactCount === 2 && isPressed
        this.mouseInput.setMouseState(isLeftDown, isRightDown)
      }
    }
  }

  private log(message: string) {
    print("BLE TEST: " + message)
  }
}
