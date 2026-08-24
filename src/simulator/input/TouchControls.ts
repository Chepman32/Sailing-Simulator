export type TouchCameraActions = {
  orbit: (deltaX: number, deltaY: number) => void;
  zoom: (delta: number) => void;
  recenter: () => void;
};

type PointerPoint = { x: number; y: number };

export class TouchControls {
  private readonly pointers = new Map<number, PointerPoint>();
  private pinchDistance = 0;
  private lastTap = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly actions: TouchCameraActions,
  ) {
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinchDistance();
    const now = performance.now();
    if (now - this.lastTap < 300 && this.pointers.size === 1) this.actions.recenter();
    this.lastTap = now;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.actions.orbit(event.clientX - previous.x, event.clientY - previous.y);
    } else if (this.pointers.size === 2) {
      const distance = this.currentPinchDistance();
      if (this.pinchDistance > 0) this.actions.zoom(this.pinchDistance - distance);
      this.pinchDistance = distance;
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.pinchDistance = this.pointers.size === 2 ? this.currentPinchDistance() : 0;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.actions.zoom(event.deltaY * 0.3);
  };

  private currentPinchDistance(): number {
    const points = [...this.pointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }
}
