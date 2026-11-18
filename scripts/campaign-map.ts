/**
 * Draws docs/campaign/map.svg from the campaign's own data: the sectors and
 * the quarantine line as the game reads them, the islands as the procedural
 * sea lays them, and the story's places where the game finds them. Run with
 * `npm run campaign:map` after moving a border or a place.
 */
import { writeFileSync } from "node:fs";
import { islandsInCell, WORLD_CELL } from "../src/simulator/environment/IslandMath";
import { buildAtlas, resolvePlace, ringPoints } from "../src/simulator/story/AtlasMath";
import { CAMPAIGN } from "../src/simulator/story/content";

const MARGIN = 900;
const zone = ringPoints(CAMPAIGN, CAMPAIGN.quarantine);
const east = zone.map((point) => point[0]);
const north = zone.map((point) => point[1]);
const minE = Math.min(...east) - MARGIN - 600;
const maxE = Math.max(...east) + MARGIN;
const minN = Math.min(...north) - MARGIN;
const maxN = Math.max(...north) + MARGIN;
const SCALE = 0.07; // px per metre
const width = Math.round((maxE - minE) * SCALE);
const height = Math.round((maxN - minN) * SCALE);
const px = (e: number) => ((e - minE) * SCALE).toFixed(1);
const py = (n: number) => ((maxN - n) * SCALE).toFixed(1);
const path = (points: readonly (readonly [number, number])[]) => `M${points.map((p) => `${px(p[0])},${py(p[1])}`).join("L")}Z`;
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Inter, Segoe UI, sans-serif">`);
parts.push(`<rect width="100%" height="100%" fill="#0e2a3a"/>`);
// Sectors.
const atlas = buildAtlas(CAMPAIGN);
for (const { sector } of atlas.sectors) {
  const points = ringPoints(CAMPAIGN, sector.ring);
  const dash = sector.status === "planned" ? ` stroke-dasharray="2 4"` : "";
  parts.push(`<path d="${path(points)}" fill="${sector.color}" fill-opacity="0.2" stroke="${sector.color}" stroke-width="1.5"${dash}/>`);
}
// Islands.
const cells = (min: number, max: number) => [Math.floor(min / WORLD_CELL) - 1, Math.ceil(max / WORLD_CELL) + 1] as const;
const [c0, c1] = cells(-maxE, -minE);
const [r0, r1] = cells(minN, maxN);
for (let column = c0; column <= c1; column += 1) {
  for (let row = r0; row <= r1; row += 1) {
    for (const island of islandsInCell(column, row)) {
      const e = -island.centerX;
      const n = island.centerZ;
      if (e < minE || e > maxE || n < minN || n > maxN) continue;
      const rx = Math.max(1.4, island.beachRadius * SCALE);
      const ry = Math.max(1.4, island.beachRadius * island.scaleZ * SCALE);
      parts.push(`<ellipse cx="${px(e)}" cy="${py(n)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${island.volcano ? "#5a2f2a" : "#d9c79a"}" stroke="#f3e6c4" stroke-opacity="0.35" stroke-width="0.6"/>`);
    }
  }
}
// The quarantine line.
parts.push(`<path d="${path(zone)}" fill="none" stroke="#e5484d" stroke-width="2.4" stroke-dasharray="10 6"/>`);
// Sector names.
for (const { sector } of atlas.sectors) {
  const [ce, cn] = sector.label;
  parts.push(`<text x="${px(ce)}" y="${py(cn)}" fill="#f4efe2" font-size="15" font-weight="700" text-anchor="middle" letter-spacing="1.5">${escape(sector.name.ru.toUpperCase())}</text>`);
  parts.push(`<text x="${px(ce)}" y="${(Number(py(cn)) + 16).toFixed(1)}" fill="#f4efe2" fill-opacity="0.7" font-size="11" text-anchor="middle">${escape(sector.subtitle.ru)}${sector.status === "planned" ? " · в разработке" : ""}</text>`);
}
// Places: solid where the story already goes, hollow where it will.
const used = new Set<string>();
for (const rule of CAMPAIGN.world) for (const presence of rule.presence) if (presence.kind === "drones") used.add(presence.group.at);
for (const mission of CAMPAIGN.missions) {
  if (mission.status !== "playable") continue;
  for (const step of mission.steps) {
    const objective = step.objective;
    if (objective.kind === "reach") used.add(objective.at);
    if (objective.kind === "hull" && objective.at) used.add(objective.at);
    if (step.marker && !step.marker.startsWith("@")) used.add(step.marker);
    if (step.checkpoint) used.add(step.checkpoint.yacht);
  }
}
// A name too near one already written (a wreck beside its shoal) is left to the mark alone.
const written: { e: number; n: number }[] = [...atlas.sectors.map(({ sector }) => ({ e: sector.label[0], n: sector.label[1] }))];
const marked: { e: number; n: number }[] = [];
for (const location of CAMPAIGN.locations) {
  const place = resolvePlace(location);
  const e = -place.x;
  const n = place.z;
  // A spot within a stone's throw of a place already marked (the wreck off its shoal) shares its mark.
  if (marked.some((other) => Math.hypot(other.e - e, other.n - n) < 400)) continue;
  marked.push({ e, n });
  const live = used.has(location.id);
  parts.push(
    live
      ? `<circle cx="${px(e)}" cy="${py(n)}" r="4.5" fill="#ffd166" stroke="#0e2a3a" stroke-width="1.5"/>`
      : `<rect x="${(Number(px(e)) - 4).toFixed(1)}" y="${(Number(py(n)) - 4).toFixed(1)}" width="8" height="8" fill="none" stroke="#f4efe2" stroke-width="1.4" transform="rotate(45 ${px(e)} ${py(n)})"/>`,
  );
  if (written.some((other) => Math.abs(other.e - e) < 1500 && Math.abs(other.n - n) < 420)) continue;
  written.push({ e, n });
  parts.push(`<text x="${(Number(px(e)) + 8).toFixed(1)}" y="${(Number(py(n)) + 4).toFixed(1)}" fill="${live ? "#ffd166" : "#f4efe2"}" font-size="10.5">${escape(location.name.ru)}</text>`);
}
// The start.
const [se, sn] = CAMPAIGN.start.yacht;
parts.push(`<path d="M${px(se)},${py(sn)} m-7,-6 l14,6 l-14,6 z" fill="#ffffff"/>`);
parts.push(`<text x="${px(se)}" y="${(Number(py(sn)) - 12).toFixed(1)}" fill="#ffffff" font-size="10.5" text-anchor="middle">Начало кампании</text>`);
// Scale and north.
const bar = 2000 * SCALE;
parts.push(`<g transform="translate(24 ${height - 30})"><rect width="${bar}" height="5" fill="#f4efe2"/><rect width="${bar / 2}" height="5" fill="#0e2a3a" stroke="#f4efe2"/><text y="-6" fill="#f4efe2" font-size="10.5">0</text><text x="${bar}" y="-6" fill="#f4efe2" font-size="10.5" text-anchor="end">2 км</text></g>`);
parts.push(`<g transform="translate(${width - 34} 40)"><path d="M0,-18 L7,8 L0,3 L-7,8 Z" fill="#f4efe2"/><text y="24" fill="#f4efe2" font-size="12" text-anchor="middle" font-weight="700">С</text></g>`);
// Legend.
parts.push(
  `<g transform="translate(24 24)" font-size="11" fill="#f4efe2"><rect x="-10" y="-14" width="250" height="78" rx="6" fill="#0e2a3a" fill-opacity="0.82"/>` +
    `<line x1="0" y1="0" x2="22" y2="0" stroke="#e5484d" stroke-width="2.4" stroke-dasharray="8 4"/><text x="30" y="4">Линия карантина «Аквилона»</text>` +
    `<circle cx="11" cy="20" r="4.5" fill="#ffd166"/><text x="30" y="24">Места, куда уже ведёт сюжет</text>` +
    `<rect x="7" y="36" width="8" height="8" fill="none" stroke="#f4efe2" transform="rotate(45 11 40)"/><text x="30" y="44">Базы будущих глав</text></g>`,
);
parts.push(`</svg>`);
writeFileSync(new URL("../docs/campaign/map.svg", import.meta.url), parts.join("\n"));
console.log(`docs/campaign/map.svg ${width}×${height}`);
