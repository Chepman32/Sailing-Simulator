import type { SimulationSnapshot } from "../types";

export class HudController {
  private elapsed = 0;

  constructor(private readonly listener?: (snapshot: SimulationSnapshot) => void) {}

  update(delta: number, snapshot: () => SimulationSnapshot): void {
    this.elapsed += delta;
    if (this.elapsed < 0.15) return;
    this.elapsed = 0;
    this.listener?.(snapshot());
  }

  emit(snapshot: SimulationSnapshot): void {
    this.listener?.(snapshot);
  }
}
