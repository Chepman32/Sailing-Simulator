/**
 * The numbers the helm instruments show, as pure functions: the chart
 * plotter's projection and range, the wind and compass needles, the engine
 * revolutions. `HelmStation` draws them; nothing here touches the DOM.
 */

/** Chart ranges the plotter steps through, metres from the yacht to the top edge. */
export const CHART_RANGES = [300, 600, 1200, 2400] as const;

/**
 * Range for a speed: about four minutes of sailing ahead, never less than
 * the closest range. Hysteresis keeps it from flicking between two ranges.
 */
export function chartRange(speedMetresPerSecond: number, current: number = CHART_RANGES[1]): number {
  const wanted = Math.max(0, speedMetresPerSecond) * 240;
  let index = CHART_RANGES.findIndex((range) => range === current);
  if (index < 0) index = 1;
  while (index < CHART_RANGES.length - 1 && wanted > CHART_RANGES[index]! * 0.95) index += 1;
  while (index > 0 && wanted < CHART_RANGES[index - 1]! * 0.7) index -= 1;
  return CHART_RANGES[index]!;
}

/**
 * Head-up projection: the yacht sits at (`originX`, `originY`) in screen
 * pixels with her bow pointing up the screen, `range` metres reach from her
 * to the top edge (`originY` pixels above).
 *
 * Looking along +Z in the renderer's right-handed frame, world +X is on the
 * left of the screen; the chart is drawn the same way round, so an island
 * left of the bow in the view is left of the bow on the plotter.
 */
export function chartProject(
  dx: number,
  dz: number,
  heading: number,
  range: number,
  originX: number,
  originY: number,
  target: { x: number; y: number },
): { x: number; y: number } {
  const scale = originY / Math.max(1, range);
  const cosine = Math.cos(heading);
  const sine = Math.sin(heading);
  // Rotate the world so the heading points up the screen (+X to the left).
  const across = dz * sine - dx * cosine;
  const along = dx * sine + dz * cosine;
  target.x = originX + across * scale;
  target.y = originY - along * scale;
  return target;
}

/**
 * Needle angle of the apparent-wind dial, radians clockwise from the top
 * (bow). Wind over the +X side comes from the left of the view (see
 * `chartProject`), and the needle points there.
 */
export function windNeedleAngle(apparentWindAngle: number): number {
  return Number.isFinite(apparentWindAngle) ? -apparentWindAngle : 0;
}

/** Engine revolutions for the tachometer from the shaft (−1…1 of full speed). */
export const ENGINE_IDLE_RPM = 850;
export const ENGINE_MAX_RPM = 3200;

export function engineRpm(shaft: number, running: boolean): number {
  if (!running) return 0;
  const load = Math.min(1, Math.abs(Number.isFinite(shaft) ? shaft : 0));
  return ENGINE_IDLE_RPM + (ENGINE_MAX_RPM - ENGINE_IDLE_RPM) * load;
}

/** Compass card rotation about the vessel's up axis: the card stays on north while the yacht turns. */
export function compassCardAngle(heading: number): number {
  const angle = -heading % (Math.PI * 2);
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

/** Heading in whole degrees, 000–359, as the displays print it. */
export function formatBearing(heading: number): string {
  let degrees = Math.round(((heading * 180) / Math.PI) % 360);
  if (degrees < 0) degrees += 360;
  if (degrees === 360) degrees = 0;
  return String(degrees).padStart(3, "0");
}

/** Throttle lever angle, radians: forward of upright ahead, aft of it astern. */
export const LEVER_THROW = 0.75;

export function leverAngle(throttle: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(throttle) ? throttle : 0)) * LEVER_THROW;
}
