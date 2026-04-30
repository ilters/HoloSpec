export abstract class Singleton extends BaseScriptComponent {
  private static registry = new Map<Function, any>()
  static get instance(): any {
    const ctor = this as any as Function
    const inst = Singleton.registry.get(ctor)
    if (!inst) {
      throw new Error(`${(this as any).name} singleton not initialized`)
    }
    return inst
  }

  onAwake() {
    const ctor = this.constructor as Function
    if (Singleton.registry.has(ctor)) {
      this.enabled = false
    } else {
      Singleton.registry.set(ctor, this)
    }
  }
}
