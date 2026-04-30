@component
export class SysProps extends BaseScriptComponent {
  onAwake() {
    this.createEvent("OnStartEvent").bind(this.onStart.bind(this))
  }

  private onStart() {
    if (!global.deviceInfoSystem.isEditor()) {
      print("Setting sysprops to disable input framework service")
      //@ts-ignore
      //const command = `snips_js -c 's=snap_ipc.getServiceSync("com.snap.os.lens.orchestrator.dev1p3");l=s.listRunningLensesSync();if(l.length>0)s.stopLens(l[0])'
      //adb -s 41201S2X41110007_app root
      //adb -s 41201S2X41110007_app shell setprop ctl.stop snapos_input_framework_service
      const command = "setprop ctl.stop snapos_input_framework_service"
      this.shellExecute("root")
      print("~~SET ROOT~~")
      this.shellExecute(command)
      print("~~ DISABLED INPUT FRAMEWORK SERVICE ~~")
    }
  }

  private shellExecute(command: string) {
    //@ts-ignore
    snap_ipc.getServiceSync("com.snap.os.companion").request(
      JSON.stringify({
        type: "rpc_shell",
        request: command
      }),
      null
    )
  }
}
