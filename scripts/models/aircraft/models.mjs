// Aircraft builders. Geometry is parametric (see geometry.mjs); every visible
// skin is UV-mapped and painted in paint.mjs with colour, normal (panel seams,
// rivets, hinge lines) and roughness/metalness layers. Liveries and
// registrations are fictional.

import * as THREE from "three";
import {
  bodyOfRevolution,
  disc,
  lathe,
  liftingSurface,
  marker,
  mesh,
  propellerBlades,
  thetaForHeightFraction,
  tube,
  wheel,
} from "./geometry.mjs";
import { finish, Surface } from "./paint.mjs";

const TAU = Math.PI * 2;

function fuselageMapping(tailZ, noseZ, exponent) {
  return {
    u: (z) => (z - tailZ) / (noseZ - tailZ),
    // Height fraction f in [-1, 1] of the local half-height (1 = top).
    vStarboard: (f) => thetaForHeightFraction(f, exponent) / TAU,
    vPort: (f) => 1 - thetaForHeightFraction(f, exponent) / TAU,
  };
}

/** Paints a band between two height-fraction curves on both sides of a fuselage. */
function sideBand(surface, map, u0, u1, topF, bottomF, style) {
  surface.band(u0, u1, (u) => map.vStarboard(topF(u)), (u) => map.vStarboard(bottomF(u)), style);
  surface.band(u0, u1, (u) => map.vPort(bottomF(u)), (u) => map.vPort(topF(u)), style);
}

/** Paints readable text on both fuselage sides. */
function sideText(surface, map, text, z, f, height, options) {
  surface.text(text, map.u(z), map.vStarboard(f), height, { ...options, mirrorU: true });
  surface.text(text, map.u(z), map.vPort(f), height, { ...options, mirrorV: true });
}

function framesAndRivets(surface, map, zFrom, zTo, pitch, rivetSpacing) {
  for (let z = zFrom; z <= zTo; z += pitch) {
    surface.seamU(map.u(z), 0.01, 0.99, 0.05);
    if (rivetSpacing) surface.rivetsU(map.u(z), 0.01, 0.99, rivetSpacing);
  }
}

/** Wing / tail skin with hinge lines, ribs and a painted tip. */
function wingSurface({ span, chord, base, tip, tipFrom = 0.88, hingeX = 0.74, controlFrom = 0.05, ribPitch = 0.32, roughness = 0.32, size = [1024, 256], lower }) {
  const surface = new Surface(size[0], size[1], span, chord * 2, { base, roughness });
  if (lower) surface.rect(0, 0.5, 1, 1, lower);
  if (tip) surface.rect(tipFrom, 0, 1, 1, tip);
  // Control-surface hinge lines on both skins.
  const upperHinge = 0.5 * (1 - hingeX);
  const lowerHinge = 0.5 + 0.5 * hingeX;
  [upperHinge, lowerHinge].forEach((v) => surface.seamV(v, controlFrom, 0.97, 0.18));
  surface.seamU(0.55, 0, upperHinge, 0.12);
  surface.seamU(0.55, lowerHinge, 1, 0.12);
  for (let u = ribPitch / span; u < 0.99; u += ribPitch / span) {
    surface.seamU(u, 0.02, 0.98, 0.04);
    surface.rivetsU(u, 0.03, 0.97, 0.05);
  }
  // Spar line rivets.
  [0.5 * (1 - 0.25), 0.5 + 0.5 * 0.25].forEach((v) => surface.seamV(v, 0, 1, 0.03));
  return surface;
}

// ---------------------------------------------------------------------------
// Light aircraft (tourist floatplane and banner-tow bush plane)
// ---------------------------------------------------------------------------

export function buildLightAircraft(variant) {
  const seaplane = variant === "seaplane";
  const root = new THREE.Group();
  root.name = seaplane ? "Tourist_Seaplane" : "Banner_Tow_Plane";
  const exponent = 2.6;
  const length = seaplane ? 1 : 0.82;
  const fuselageKeys = [
    [4.08 * length, 0.34, 0.36, 0.06],
    [3.7 * length, 0.5, 0.52, 0.04],
    [2.7 * length, 0.6, 0.66, 0.08],
    [1.9 * length, 0.62, 0.78, 0.18],
    [0.8 * length, 0.62, 0.8, 0.2],
    [-0.6 * length, 0.57, 0.71, 0.17],
    [-1.9 * length, 0.4, 0.5, 0.24],
    [-3.3 * length, 0.2, 0.3, 0.4],
    [-4.45 * length, 0.07, 0.19, 0.5],
    [-4.62 * length, 0.03, 0.12, 0.52],
  ];
  const tailZ = -4.62 * length;
  const noseZ = 4.08 * length;
  const map = fuselageMapping(tailZ, noseZ, exponent);

  const palette = seaplane
    ? { base: "#f4f6f5", primary: "#0aa3b2", accent: "#ff6a4d", ink: "#0b3c4a", tip: "#ff6a4d" }
    : { base: "#ffcf1f", primary: "#141414", accent: "#c8231d", ink: "#141414", tip: "#c8231d" };

  // --- Fuselage livery ---------------------------------------------------
  const skin = new Surface(1024, 512, noseZ - tailZ, 4.4, { base: palette.base, roughness: 0.26 });
  if (seaplane) {
    // A turquoise waist stripe that sweeps up and fills the tail cone.
    sideBand(skin, map, 0, 0.92, (u) => THREE.MathUtils.lerp(0.95, 0.04, THREE.MathUtils.smoothstep(u, 0.08, 0.42)), (u) => THREE.MathUtils.lerp(-0.2, -0.16, u), palette.primary);
    sideBand(skin, map, 0.04, 0.9, (u) => THREE.MathUtils.lerp(-0.27, -0.22, u), (u) => THREE.MathUtils.lerp(-0.34, -0.29, u), palette.accent);
    // Matte anti-glare panel ahead of the windshield.
    const glareTop = map.vStarboard(0.62);
    skin.rect(map.u(2.5), 0, map.u(3.85), glareTop, "#1d2427");
    skin.rect(map.u(2.5), 1 - glareTop, map.u(3.85), 1, "#1d2427");
    skin.setFinish(map.u(2.5), 0, map.u(3.85), glareTop, 0.85);
    skin.setFinish(map.u(2.5), 1 - glareTop, map.u(3.85), 1, 0.85);
  } else {
    // Classic bush-plane black stripe with a lightning-bolt kink.
    const bolt = (u, offset) => {
      const kink = THREE.MathUtils.smoothstep(u, 0.42, 0.5) - THREE.MathUtils.smoothstep(u, 0.52, 0.6);
      return offset - kink * 0.28;
    };
    sideBand(skin, map, 0.12, 0.97, (u) => bolt(u, 0.12), (u) => bolt(u, -0.02), palette.primary);
    sideBand(skin, map, 0.12, 0.97, (u) => bolt(u, -0.05), (u) => bolt(u, -0.09), palette.accent);
  }
  // Window frames painted behind the separate glass panes.
  const windowFrames = seaplane
    ? [[-0.85 * length, -0.2 * length], [-0.1 * length, 0.65 * length], [0.75 * length, 1.6 * length]]
    : [[-0.15 * length, 0.6 * length], [0.7 * length, 1.62 * length]];
  windowFrames.forEach(([z0, z1]) => {
    sideBand(skin, map, map.u(z0 - 0.05), map.u(z1 + 0.05), () => 0.72, () => 0.08, "#2b3136");
  });
  sideBand(skin, map, map.u(1.7 * length), map.u(2.5 * length), () => 1, () => 0.52, "#2b3136");
  // Cabin door outline, handle and step marking.
  const doorZ = [windowFrames[0][1] + 0.04, windowFrames[1][1] + 0.02];
  [map.vStarboard, map.vPort].forEach((v) => {
    skin.seamU(map.u(doorZ[0]), v(0.7), v(-0.55), 0.35);
    skin.seamU(map.u(doorZ[1]), v(0.7), v(-0.55), 0.35);
    skin.seamV(v(-0.55), map.u(doorZ[0]), map.u(doorZ[1]), 0.35);
  });
  // Engine exhaust soot streaks along the lower cowling.
  [map.vStarboard, map.vPort].forEach((v) => {
    const top = Math.min(v(-0.5), v(-0.82));
    const bottom = Math.max(v(-0.5), v(-0.82));
    const gradient = skin.color.createLinearGradient(skin.x(map.u(2.45 * length)), 0, skin.x(map.u(0.6 * length)), 0);
    gradient.addColorStop(0, "rgba(30,26,22,0.42)");
    gradient.addColorStop(1, "rgba(30,26,22,0)");
    skin.color.fillStyle = gradient;
    skin.color.fillRect(skin.x(map.u(0.6 * length)), skin.y(top), skin.x(map.u(2.45 * length)) - skin.x(map.u(0.6 * length)), skin.y(bottom) - skin.y(top));
    skin.setFinish(map.u(0.6 * length), top, map.u(2.45 * length), bottom, 0.55);
  });
  framesAndRivets(skin, map, tailZ + 0.5, -0.9 * length, 0.55, 0.06);
  [2.62 * length, 2.78 * length, 3.72 * length].forEach((z) => skin.seamU(map.u(z), 0, 1, 0.15));
  skin.seamV(0.25, map.u(tailZ + 0.3), map.u(-0.9 * length), 0.04);
  skin.seamV(0.75, map.u(tailZ + 0.3), map.u(-0.9 * length), 0.04);
  sideText(skin, map, seaplane ? "ISL-208" : "BNR-18", -2.45 * length, seaplane ? -0.5 : 0.42, 0.26, { style: palette.ink });
  if (seaplane) sideText(skin, map, "ISLAND AIR TOURS", 0.15, 0.52, 0.1, { style: palette.ink, font: "700" });
  const skinMaterial = skin.material("Fuselage_Paint", { normalStrength: 2.4 });

  // --- Wings, tail and floats -----------------------------------------------
  const wingY = 0.97;
  const wingSpan = seaplane ? 5.5 : 5.3;
  const wingChord = seaplane ? 1.62 : 1.6;
  const wingLeadingZ = 1.85 * length;
  const dihedral = THREE.MathUtils.degToRad(1.7);
  const wingSkin = wingSurface({ span: wingSpan, chord: wingChord, base: palette.base, tip: palette.tip, roughness: 0.28 });
  // Fuel filler caps on the upper skin near the root.
  wingSkin.roundedRect(0.12, 0.36, 0.12, 0.12, 0.06, "#8d9298", [wingSkin.color]);
  wingSkin.roundedRect(0.12, 0.36, 0.12, 0.12, 0.06, "rgb(150,150,150)", [wingSkin.bump]);
  const wingMaterial = wingSkin.material("Wing_Paint", { normalStrength: 2 });

  const finSpan = seaplane ? 1.55 : 1.3;
  const finSkin = new Surface(512, 512, finSpan, 2.9, { base: seaplane ? palette.primary : palette.base, roughness: 0.26 });
  if (seaplane) {
    finSkin.rect(0.3, 0, 0.44, 1, palette.accent);
    finSkin.rect(0.47, 0, 0.52, 1, palette.base);
  } else {
    finSkin.rect(0.84, 0, 1, 1, palette.accent);
    finSkin.rect(0.3, 0, 0.42, 1, palette.primary);
  }
  [0.5 * (1 - 0.68), 0.5 + 0.5 * 0.68].forEach((v) => finSkin.seamV(v, 0.02, 0.98, 0.2));
  const finMaterial = finSkin.material("Tail_Paint", { normalStrength: 2 });

  const wings = [1, -1].map((side) =>
    liftingSurface({
      rootOffset: 0,
      span: wingSpan,
      rootChord: wingChord,
      tipChord: seaplane ? 1.18 : wingChord * 0.98,
      leadingEdgeZ: wingLeadingZ,
      sweep: seaplane ? 0.02 : 0,
      dihedral,
      baseY: wingY,
      thickness: 0.13,
      stations: 18,
      side,
    }),
  );
  const stabilizers = [1, -1].map((side) =>
    liftingSurface({
      rootOffset: 0,
      span: seaplane ? 1.75 : 1.55,
      rootChord: 1.05,
      tipChord: 0.68,
      leadingEdgeZ: tailZ + 1.15,
      sweep: 0.12,
      baseY: 0.47,
      thickness: 0.09,
      camber: 0,
      stations: 8,
      side,
    }),
  );
  const fin = liftingSurface({
    rootOffset: 0,
    span: finSpan,
    rootChord: 1.45,
    tipChord: 0.72,
    leadingEdgeZ: tailZ + 1.55,
    sweep: 0.62,
    baseY: 0.55,
    thickness: 0.1,
    camber: 0,
    stations: 9,
    vertical: true,
  });
  const dorsal = liftingSurface({
    rootOffset: 0,
    span: 0.35,
    rootChord: 1.2,
    tipChord: 0.25,
    leadingEdgeZ: tailZ + 2.5,
    sweep: 1.15,
    baseY: 0.5,
    thickness: 0.08,
    camber: 0,
    stations: 3,
    vertical: true,
  });

  // --- Metal, glass and small parts -------------------------------------------
  const aluminium = finish("Strut_Aluminium", 0xc4c9ce, 0.28, 0.85);
  const rubber = finish("Tire_Rubber", 0x161616, 0.9, 0);
  const glass = finish("Cabin_Glass", 0x0b1822, 0.035, 0.72, { envMapIntensity: 1.8 });
  const darkMetal = finish("Exhaust_Steel", 0x3a3532, 0.55, 0.8);
  const lensRed = finish("Nav_Lens_Red", 0xff2a1e, 0.1, 0.1, { emissive: 0xff1a10, emissiveIntensity: 0.55 });
  const lensGreen = finish("Nav_Lens_Green", 0x22ff6a, 0.1, 0.1, { emissive: 0x10ff50, emissiveIntensity: 0.55 });
  const lensClear = finish("Landing_Light_Lens", 0xf2f6ff, 0.05, 0.3, { emissive: 0xfff4d8, emissiveIntensity: 0.25 });

  const struts = [];
  [1, -1].forEach((side) => {
    struts.push(tube(new THREE.Vector3(side * 0.52, -0.38, 1.1 * length), new THREE.Vector3(side * 2.55, wingY + 0.02, 1.32 * length), 0.045, 10, 2.2));
    struts.push(tube(new THREE.Vector3(side * 0.52, -0.38, 0.95 * length), new THREE.Vector3(side * 2.45, wingY + 0.02, 0.62 * length), 0.04, 10, 2.2));
    // Jury strut between the main struts.
    struts.push(tube(new THREE.Vector3(side * 1.6, 0.35, 1.2 * length), new THREE.Vector3(side * 1.6, wingY - 0.02, 1.0 * length), 0.018, 6));
  });
  const exhaust = [1, -1].map((side) => tube(new THREE.Vector3(side * 0.28, -0.42, 2.9 * length), new THREE.Vector3(side * 0.34, -0.55, 2.42 * length), 0.045, 12));
  const antenna = tube(new THREE.Vector3(0, 0.98, -0.6 * length), new THREE.Vector3(0, 1.32, -0.85 * length), 0.012, 6);
  const pitot = tube(new THREE.Vector3(-2.6, wingY - 0.12, wingLeadingZ - 0.2), new THREE.Vector3(-2.6, wingY - 0.12, wingLeadingZ + 0.25), 0.012, 6);
  const tipY = wingY + Math.tan(dihedral) * wingSpan;
  const lensGeometry = (x) => {
    const geometry = new THREE.SphereGeometry(0.06, 12, 8);
    geometry.scale(1, 0.7, 1.6);
    geometry.translate(x, tipY, wingLeadingZ - 0.35);
    return geometry;
  };
  const landingLight = disc(new THREE.Vector3(-1.9, wingY + 0.01, wingLeadingZ + 0.005), 0.07, 0.02, "z", 16);

  const floatsAndGear = [];
  const tires = [];
  let floatMaterial;
  if (seaplane) {
    const floatSkin = new Surface(512, 256, 6.75, 2.3, { base: palette.base, roughness: 0.3 });
    const floatMap = fuselageMapping(-3.0, 3.75, 2.2);
    sideBand(floatSkin, floatMap, 0.05, 0.97, () => 0.05, () => -0.12, palette.primary);
    // Anti-fouling below the waterline.
    sideBand(floatSkin, floatMap, 0, 1, () => -0.45, () => -1, "#4f5960");
    floatSkin.setFinish(0, 0.32, 1, 0.68, 0.55);
    for (let z = -2.6; z < 3.4; z += 0.6) floatSkin.seamU(floatMap.u(z), 0.05, 0.95, 0.06);
    floatMaterial = floatSkin.material("Float_Paint", { normalStrength: 2 });
    [1, -1].forEach((side) => {
      const x = side * 1.32;
      const floatKeys = [
        [3.75, 0.05, 0.08, -1.48],
        [3.3, 0.26, 0.22, -1.52],
        [2.2, 0.36, 0.3, -1.6],
        [0.3, 0.38, 0.32, -1.62],
        [-0.6, 0.36, 0.3, -1.6],
        [-2.2, 0.24, 0.22, -1.56],
        [-3.0, 0.06, 0.1, -1.54],
      ];
      const pontoon = bodyOfRevolution(floatKeys, { stations: 36, segments: 28, exponent: 2.2 });
      pontoon.translate(x, 0, 0);
      floatsAndGear.push(pontoon);
      struts.push(tube(new THREE.Vector3(x, -1.32, 1.85), new THREE.Vector3(side * 0.45, -0.42, 1.95), 0.045, 10, 2));
      struts.push(tube(new THREE.Vector3(x, -1.32, 0.15), new THREE.Vector3(side * 0.45, -0.42, 0.35), 0.045, 10, 2));
      struts.push(tube(new THREE.Vector3(x, -1.32, 1.85), new THREE.Vector3(side * 0.45, -0.42, 0.35), 0.03, 8, 1.5));
      // Retractable water rudder at each float heel.
      struts.push(tube(new THREE.Vector3(x, -1.55, -2.95), new THREE.Vector3(x, -1.95, -3.15), 0.02, 6, 5));
    });
    struts.push(tube(new THREE.Vector3(-1.32, -1.34, 1.2), new THREE.Vector3(1.32, -1.34, 1.2), 0.035, 8, 1.8));
    struts.push(tube(new THREE.Vector3(-1.32, -1.34, -0.1), new THREE.Vector3(1.32, -1.34, -0.1), 0.035, 8, 1.8));
  } else {
    [1, -1].forEach((side) => {
      const axle = new THREE.Vector3(side * 0.95, -1.18, 1.85 * length);
      struts.push(tube(new THREE.Vector3(side * 0.35, -0.5, 2.2 * length), axle, 0.035, 8));
      struts.push(tube(new THREE.Vector3(side * 0.35, -0.5, 1.25 * length), axle, 0.035, 8));
      struts.push(tube(new THREE.Vector3(side * 0.12, -0.62, 1.8 * length), axle.clone().setX(side * 0.82), 0.03, 8));
      tires.push(wheel(axle, 0.33, 0.24));
      struts.push(disc(axle, 0.12, 0.26, "x"));
    });
    const tailWheel = new THREE.Vector3(0, 0.12, tailZ + 0.35);
    struts.push(tube(new THREE.Vector3(0, 0.36, tailZ + 0.6), tailWheel, 0.025, 6));
    tires.push(wheel(tailWheel, 0.09, 0.06, 16));
  }

  // Separate glass panes so frames and posts stay painted on the fuselage.
  const panes = windowFrames.flatMap(([z0, z1]) => [
    bodyOfRevolution(fuselageKeys, { stations: 8, segments: 6, exponent, thetaStart: thetaForHeightFraction(0.66, exponent), thetaEnd: thetaForHeightFraction(0.14, exponent), inflate: 0.007, zStart: z0, zEnd: z1 }),
    bodyOfRevolution(fuselageKeys, { stations: 8, segments: 6, exponent, thetaStart: TAU - thetaForHeightFraction(0.14, exponent), thetaEnd: TAU - thetaForHeightFraction(0.66, exponent), inflate: 0.007, zStart: z0, zEnd: z1 }),
  ]);
  const windshield = bodyOfRevolution(fuselageKeys, { stations: 12, segments: 20, exponent, thetaStart: -thetaForHeightFraction(0.56, exponent), thetaEnd: thetaForHeightFraction(0.56, exponent), inflate: 0.008, zStart: 1.76 * length, zEnd: 2.45 * length });
  // Skylight under the wing for sightseeing passengers.
  const skylight = bodyOfRevolution(fuselageKeys, { stations: 6, segments: 8, exponent, thetaStart: -0.32, thetaEnd: 0.32, inflate: 0.006, zStart: 0.2 * length, zEnd: 1.2 * length });

  const fuselage = bodyOfRevolution(fuselageKeys, { stations: 56, segments: 56, exponent });
  root.add(mesh("Fuselage", [fuselage], skinMaterial));
  root.add(mesh("Wings", [...wings, ...stabilizers], wingMaterial));
  root.add(mesh("Tail_Fin", [fin, dorsal], finMaterial));
  root.add(mesh("Cabin_Glazing", [...panes, windshield, ...(seaplane ? [skylight] : [])], glass));
  root.add(mesh("Struts", [...struts, antenna, pitot], aluminium));
  root.add(mesh("Exhaust_Stacks", exhaust, darkMetal));
  root.add(mesh("Nav_Light_Port", [lensGeometry(-wingSpan - 0.03)], lensRed));
  root.add(mesh("Nav_Light_Starboard", [lensGeometry(wingSpan + 0.03)], lensGreen));
  root.add(mesh("Landing_Light", [landingLight], lensClear));
  if (seaplane) root.add(mesh("Floats", floatsAndGear, floatMaterial));
  if (tires.length > 0) root.add(mesh("Tires", tires, rubber));

  // Propeller node spins about +Z at runtime.
  const propeller = new THREE.Group();
  propeller.name = "Propeller";
  propeller.position.set(0, 0.06, noseZ + 0.05);
  const spinner = lathe([
    [0.0, 0.52],
    [0.07, 0.48],
    [0.15, 0.36],
    [0.2, 0.18],
    [0.21, 0.0],
    [0.0, 0.0],
  ]);
  const blades = propellerBlades({ radius: seaplane ? 1.0 : 0.95, rootChord: 0.2, tipChord: 0.11, rootPitch: 0.95, tipPitch: 0.32, hubRadius: 0.16 });
  blades.translate(0, 0, 0.16);
  const bladeSkin = new Surface(256, 64, 1, 0.4, { base: "#202326", roughness: 0.55 });
  bladeSkin.rect(0.88, 0, 1, 1, "#f4c400");
  bladeSkin.rect(0.82, 0, 0.88, 1, "#f2f2f2");
  propeller.add(mesh("Propeller_Spinner", [spinner], finish("Spinner_Paint", seaplane ? 0xff6a4d : 0xc8231d, 0.22, 0.15)));
  propeller.add(mesh("Propeller_Blades", [blades], bladeSkin.material("Propeller_Paint", { normalStrength: 0 })));
  root.add(propeller);

  root.add(marker("NavPort", -wingSpan - 0.05, tipY, wingLeadingZ - 0.35));
  root.add(marker("NavStarboard", wingSpan + 0.05, tipY, wingLeadingZ - 0.35));
  root.add(marker("Beacon", 0, 0.55 + finSpan + 0.05, tailZ + 0.9));
  root.add(marker("TailLight", 0, 0.5, tailZ - 0.02));
  root.add(marker("LandingLight", -1.9, wingY + 0.01, wingLeadingZ + 0.02));
  root.add(marker("TowHook", 0, 0.22, tailZ - 0.05));
  return root;
}

// ---------------------------------------------------------------------------
// Narrow-body airliner
// ---------------------------------------------------------------------------

export function buildAirliner() {
  const root = new THREE.Group();
  root.name = "Narrowbody_Airliner";
  const exponent = 2.05;
  const tailZ = -18.9;
  const noseZ = 18.9;
  const fuselageKeys = [
    [18.9, 0.12, 0.12, -0.15],
    [18.2, 1.05, 1.1, -0.18],
    [16.8, 1.72, 1.82, 0],
    [15.0, 1.98, 2.08, 0.05],
    [12.0, 2.0, 2.1, 0.05],
    [-8.0, 2.0, 2.1, 0.05],
    [-12.0, 1.72, 1.78, 0.3],
    [-16.0, 0.95, 1.05, 0.9],
    [-18.6, 0.28, 0.4, 1.35],
    [-18.9, 0.12, 0.2, 1.42],
  ];
  const map = fuselageMapping(tailZ, noseZ, exponent);
  const navy = "#0b3a7e";
  const sunset = "#ff9a1f";
  const coral = "#ff5a4a";

  const skin = new Surface(2048, 512, noseZ - tailZ, 13.2, { base: "#f5f7f9", roughness: 0.24 });
  // Grey belly fairing band.
  sideBand(skin, map, map.u(-12), map.u(16.2), () => -0.62, () => -1, "#b4bbc3");
  skin.setFinish(0, map.vStarboard(-0.62), 1, map.vPort(-0.62), 0.42);
  // Swoosh livery rising from the belly to the tail.
  const swoosh = (u) => THREE.MathUtils.smoothstep(1 - u, 0.42, 0.93);
  sideBand(skin, map, 0, 0.62, (u) => THREE.MathUtils.lerp(-0.62, 0.98, swoosh(u)), () => -1, navy);
  sideBand(skin, map, 0, 0.64, (u) => THREE.MathUtils.lerp(-0.5, 1.0, swoosh(u * 0.97)), (u) => THREE.MathUtils.lerp(-0.6, 0.97, swoosh(u)), sunset);
  sideBand(skin, map, 0, 0.66, (u) => THREE.MathUtils.lerp(-0.42, 1.0, swoosh(u * 0.94)), (u) => THREE.MathUtils.lerp(-0.47, 0.99, swoosh(u * 0.965)), coral);
  sideText(skin, map, "CORAL AIR", 7.2, 0.5, 0.8, { style: navy });
  sideText(skin, map, "CA-SUN", -14.6, 0.32, 0.32, { style: "#f5f7f9" });

  // Cabin windows at a 0.53 m pitch, skipping doors and overwing exits.
  const doors = [[14.4, 15.25], [0.35, 0.85], [1.05, 1.55], [-14.1, -13.25]];
  const inDoor = (z) => doors.some(([a, b]) => z > a - 0.25 && z < b + 0.25);
  const windowF = 0.22;
  for (let z = -12.9; z <= 13.6; z += 0.53) {
    if (inDoor(z)) continue;
    [map.vStarboard, map.vPort].forEach((v) => {
      skin.roundedRect(map.u(z), v(windowF), 0.3, 0.42, 0.12, "#c9ced3");
      skin.roundedRect(map.u(z), v(windowF), 0.23, 0.34, 0.1, "#141b22");
      skin.setFinish(map.u(z - 0.12), v(windowF) - 0.012, map.u(z + 0.12), v(windowF) + 0.012, 0.05, 0.4);
    });
  }
  // Door outlines and handles.
  doors.forEach(([z0, z1], index) => {
    const overwing = index === 1 || index === 2;
    const top = overwing ? 0.45 : 0.55;
    const bottom = overwing ? -0.05 : -0.42;
    [map.vStarboard, map.vPort].forEach((v) => {
      skin.seamU(map.u(z0), v(top), v(bottom), 0.4);
      skin.seamU(map.u(z1), v(top), v(bottom), 0.4);
      skin.seamV(v(top), map.u(z0), map.u(z1), 0.4);
      skin.seamV(v(bottom), map.u(z0), map.u(z1), 0.4);
      skin.roundedRect(map.u((z0 + z1) / 2), v((top + bottom) / 2), 0.16, 0.05, 0.02, "#7a8188");
    });
  });
  // Cockpit glazing as slanted panes in (z, height-fraction) space: windshield,
  // first and second side windows, separated by painted posts.
  const pane = (corners) =>
    [map.vStarboard, map.vPort].forEach((v) => {
      skin.color.fillStyle = "#0f171f";
      skin.color.beginPath();
      corners.forEach(([z, f], index) => (index === 0 ? skin.color.moveTo : skin.color.lineTo).call(skin.color, skin.x(map.u(z)), skin.y(v(f))));
      skin.color.closePath();
      skin.color.fill();
      const us = corners.map(([z]) => map.u(z));
      const vs = corners.map(([, f]) => v(f));
      skin.setFinish(Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs), 0.04, 0.5);
    });
  pane([[17.62, 0.5], [17.62, 0.9], [17.12, 0.84], [17.12, 0.46]]);
  pane([[17.02, 0.46], [17.02, 0.82], [16.5, 0.74], [16.5, 0.43]]);
  pane([[16.4, 0.43], [16.4, 0.7], [15.95, 0.64], [15.95, 0.42]]);
  // Fuselage frames, lap joints, radome and tail-cone seams.
  for (let z = -16; z <= 16; z += 1.06) skin.seamU(map.u(z), 0.01, 0.99, 0.035);
  [0.5, -0.1, -0.62].forEach((f) => {
    skin.seamV(map.vStarboard(f), map.u(-16), map.u(16.5), 0.03);
    skin.seamV(map.vPort(f), map.u(-16), map.u(16.5), 0.03);
  });
  [17.7, -16.8].forEach((z) => skin.seamU(map.u(z), 0, 1, 0.12));
  const skinMaterial = skin.material("Fuselage_Livery", { normalStrength: 1.6 });

  // Wings: upper skin light grey, walkway, slats, flaps and ailerons.
  const sweep = THREE.MathUtils.degToRad(25);
  const wingSkin = wingSurface({ span: 15.6, chord: 6.4, base: "#dfe3e7", lower: "#c4cad0", ribPitch: 0.9, hingeX: 0.76, size: [1024, 512], roughness: 0.38 });
  [0.5 * (1 - 0.13), 0.5 + 0.5 * 0.13].forEach((v) => wingSkin.seamV(v, 0.03, 0.98, 0.15));
  wingSkin.rect(0.04, 0.18, 0.2, 0.19, "#2d3136");
  wingSkin.rect(0.04, 0.3, 0.2, 0.31, "#2d3136");
  const wingMaterial = wingSkin.material("Wing_Skin", { normalStrength: 1.8 });

  const finSkin = new Surface(1024, 1024, 5.6, 10.8, { base: navy, roughness: 0.26 });
  // Sun-and-waves tail logo on both sides of the fin.
  const logo = (v) =>
    finSkin.inMeters(0.55, v, false, false, (context) => {
      context.rotate(Math.PI / 2);
      context.fillStyle = sunset;
      context.beginPath();
      context.arc(0, 0, 1.15, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = coral;
      context.beginPath();
      context.arc(0, 0, 0.78, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#f5f7f9";
      context.lineWidth = 0.18;
      [-0.35, 0.05, 0.45].forEach((y) => {
        context.beginPath();
        for (let x = -1.6; x <= 1.6; x += 0.05) context.lineTo(x, y + Math.sin(x * 3.2) * 0.12);
        context.stroke();
      });
    });
  logo(0.27);
  logo(0.73);
  [0.5 * (1 - 0.72), 0.5 + 0.5 * 0.72].forEach((v) => finSkin.seamV(v, 0.05, 0.98, 0.25));
  const finMaterial = finSkin.material("Tail_Livery", { normalStrength: 1.6 });

  const wings = [1, -1].map((side) =>
    liftingSurface({ rootOffset: 1.6, span: 15.6, rootChord: 6.4, tipChord: 1.6, leadingEdgeZ: 4.6, sweep, dihedral: THREE.MathUtils.degToRad(5), baseY: -1.15, thickness: 0.12, stations: 16, side }),
  );
  const winglets = [1, -1].map((side) => {
    const geometry = liftingSurface({
      rootOffset: 0,
      span: 2.3,
      rootChord: 1.6,
      tipChord: 0.6,
      leadingEdgeZ: 4.6 - Math.tan(sweep) * 15.6,
      sweep: 0.75,
      baseY: -1.15 + Math.tan(THREE.MathUtils.degToRad(5)) * 15.6,
      thickness: 0.09,
      camber: 0,
      stations: 5,
      vertical: true,
    });
    geometry.translate(side * 17.2, 0, 0);
    return geometry;
  });
  const fairing = bodyOfRevolution(
    [
      [6.5, 0.3, 0.3, -1.7],
      [4.0, 1.9, 0.9, -1.55],
      [-3.5, 1.9, 0.9, -1.55],
      [-6.5, 0.3, 0.3, -1.5],
    ],
    { stations: 18, segments: 24, exponent: 2.2 },
  );
  const stabilizers = [1, -1].map((side) =>
    liftingSurface({ rootOffset: 0.5, span: 6.0, rootChord: 3.7, tipChord: 1.3, leadingEdgeZ: -13.6, sweep: THREE.MathUtils.degToRad(30), dihedral: THREE.MathUtils.degToRad(6), baseY: 0.9, thickness: 0.1, camber: 0, stations: 8, side }),
  );
  const fin = liftingSurface({ rootOffset: 1.4, span: 5.6, rootChord: 5.4, tipChord: 1.8, leadingEdgeZ: -11.8, sweep: THREE.MathUtils.degToRad(38), baseY: 0, thickness: 0.1, camber: 0, stations: 9, vertical: true });
  // Flap-track fairings under the trailing edge.
  const flapTracks = [];
  [1, -1].forEach((side) => {
    [0.25, 0.48, 0.7].forEach((t) => {
      const spanX = 1.6 + 15.6 * t;
      const leading = 4.6 - Math.tan(sweep) * 15.6 * t;
      const chord = THREE.MathUtils.lerp(6.4, 1.6, t);
      const y = -1.15 + Math.tan(THREE.MathUtils.degToRad(5)) * 15.6 * t;
      const track = bodyOfRevolution(
        [
          [0, 0.02, 0.02, 0],
          [-0.3, 0.13, 0.2, -0.08],
          [-1.2, 0.12, 0.18, -0.1],
          [-1.9, 0.02, 0.04, -0.06],
        ],
        { stations: 10, segments: 10, exponent: 2.2 },
      );
      track.translate(side * spanX, y - 0.15, leading - chord * 0.62);
      flapTracks.push(track);
    });
  });

  const nacelleWhite = finish("Nacelle_Paint", 0xeef1f4, 0.24, 0.1);
  const lipMetal = finish("Inlet_Lip_Polished", 0xd8dde2, 0.14, 1);
  const fanDark = finish("Fan_Face", 0x1a1d21, 0.45, 0.7);
  const coreMetal = finish("Exhaust_Core", 0x6a7077, 0.32, 0.9);
  const spinnerSkin = new Surface(256, 256, 1, 1, { base: "#2a2e33", roughness: 0.3, metalness: 0.4 });
  spinnerSkin.color.strokeStyle = "#f2f4f6";
  spinnerSkin.color.lineWidth = 14;
  spinnerSkin.color.beginPath();
  for (let step = 0; step <= 64; step += 1) {
    const t = step / 64;
    spinnerSkin.color.lineTo(spinnerSkin.x((t * 0.75) % 1), spinnerSkin.y(t));
  }
  spinnerSkin.color.stroke();
  const nacelles = [];
  const lips = [];
  const fans = [];
  const spinners = [];
  const cores = [];
  const pylons = [];
  [1, -1].forEach((side) => {
    const x = side * 5.8;
    const place = (geometry) => geometry.translate(x, -2.25, 4.7);
    nacelles.push(place(lathe([[1.0, 2.75], [1.12, 2.45], [1.13, 1.5], [1.02, -0.6], [0.74, -1.4]], 40)));
    lips.push(place(lathe([[0.9, 2.62], [0.97, 2.98], [1.02, 2.92], [1.0, 2.75]], 40)));
    fans.push(place(disc(new THREE.Vector3(0, 0, 2.55), 0.9, 0.04, "z", 36)));
    spinners.push(place(lathe([[0.3, 2.56], [0.2, 2.75], [0.02, 2.95]], 24)));
    cores.push(place(lathe([[0.62, -1.3], [0.44, -2.0], [0.05, -2.45]], 24)));
    pylons.push(liftingSurface({ rootOffset: -2.0, span: 1.05, rootChord: 4.2, tipChord: 3.6, leadingEdgeZ: 6.5, sweep: -0.35, thickness: 0.14, camber: 0, stations: 2, vertical: true, roundTip: false }).translate(x, 0, 0));
  });

  root.add(mesh("Fuselage", [fuselageMeshOf(fuselageKeys, exponent)], skinMaterial));
  root.add(mesh("Wing_Body_Fairing", [[fairing, [0.5, 0.45]]], skinMaterial));
  root.add(mesh("Wings", [...wings, ...stabilizers, ...pylons], wingMaterial));
  root.add(mesh("Flap_Track_Fairings", flapTracks, finish("Fairing_Grey", 0xc4cad0, 0.4, 0.1)));
  root.add(mesh("Tail_Fin", [fin], finMaterial));
  root.add(mesh("Winglets", winglets, finish("Winglet_Livery", 0xff9a1f, 0.28, 0.05)));
  root.add(mesh("Engine_Nacelles", nacelles, nacelleWhite));
  root.add(mesh("Engine_Inlet_Lips", lips, lipMetal));
  root.add(mesh("Engine_Fan_Faces", fans, fanDark));
  root.add(mesh("Engine_Spinners", spinners, spinnerSkin.material("Spinner_Spiral", { normalStrength: 0 })));
  root.add(mesh("Engine_Exhaust", cores, coreMetal));

  const tipX = 1.6 + 15.6;
  const tipY = -1.15 + Math.tan(THREE.MathUtils.degToRad(5)) * 15.6;
  const tipZ = 4.6 - Math.tan(sweep) * 15.6 - 0.8;
  root.add(marker("NavPort", -tipX, tipY, tipZ));
  root.add(marker("NavStarboard", tipX, tipY, tipZ));
  root.add(marker("Beacon", 0, 2.2, -2));
  root.add(marker("BeaconLower", 0, -2.1, 2));
  root.add(marker("TailLight", 0, 1.4, -18.95));
  root.add(marker("EngineExhaustPort", -5.8, -2.25, 2.2));
  root.add(marker("EngineExhaustStarboard", 5.8, -2.25, 2.2));
  return root;
}

function fuselageMeshOf(keys, exponent) {
  return bodyOfRevolution(keys, { stations: 72, segments: 56, exponent });
}
