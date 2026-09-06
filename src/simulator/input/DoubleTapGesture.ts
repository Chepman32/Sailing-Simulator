type Tap = { x: number; y: number; time: number };
type Press = Tap & { pointerId: number };

const TAP_DURATION_MS = 300;
const DOUBLE_TAP_INTERVAL_MS = 350;
const TAP_MOVEMENT_PX = 8;
const DOUBLE_TAP_DISTANCE_PX = 24;

/** Recognizes completed taps, never drags, long presses, or multi-touch gestures. */
export class DoubleTapGesture {
  private press?: Press;
  private previous?: Tap;

  down(pointerId: number, x: number, y: number, time: number): void {
    this.press = { pointerId, x, y, time };
  }

  move(pointerId: number, x: number, y: number): void {
    if (this.press?.pointerId === pointerId &&
        Math.hypot(x - this.press.x, y - this.press.y) > TAP_MOVEMENT_PX) {
      this.cancel();
    }
  }

  up(pointerId: number, x: number, y: number, time: number): boolean {
    this.move(pointerId, x, y);
    const press = this.press;
    this.press = undefined;
    if (!press || press.pointerId !== pointerId || time - press.time > TAP_DURATION_MS) {
      this.previous = undefined;
      return false;
    }
    const previous = this.previous;
    const doubleTap = Boolean(previous && time - previous.time <= DOUBLE_TAP_INTERVAL_MS &&
      Math.hypot(x - previous.x, y - previous.y) <= DOUBLE_TAP_DISTANCE_PX);
    this.previous = doubleTap ? undefined : { x, y, time };
    return doubleTap;
  }

  cancel(): void {
    this.press = undefined;
    this.previous = undefined;
  }
}
