import * as THREE from "three";
import { HELM_STATION_SHIFT, HELM_X } from "./HelmStation";

/**
 * The yacht's decor, bought from the island traders and each with its own
 * physics:
 *
 * - a flag on a staff at the port stern, streaming downwind of the apparent
 *   wind (it turns on its staff), its cloth rippling in travelling waves that
 *   quicken and deepen with the wind, drooping in a calm;
 * - a charm hanging from the arch over the helm on a short cord: a point
 *   mass on a string, swung by the yacht's roll, pitch and every change of
 *   speed or course;
 * - a bobblehead on the instrument pod whose oversized head sits on a
 *   stiff spring and nods and wobbles with the waves and the yacht's
 *   accelerations.
 *
 * Everything is in the yacht's frame (vessel space: +Z the bow, +X the
 * starboard hull, the deck of the hulls at 0.62 m).
 */

export type FlagDesign = "flag-jolly" | "flag-tropic" | "flag-signal" | "flag-rainbow" | "flag-dragon";
export type CharmDesign = "charm-shell" | "charm-anchor" | "charm-dreamcatcher" | "charm-pearl";
export type BobbleDesign = "bobble-hula" | "bobble-captain" | "bobble-parrot" | "bobble-shark";

const FLAG_STAFF = new THREE.Vector3(-1.72, 0.62, -3.82);
const STAFF_HEIGHT = 1.75;
const FLAG_LENGTH = 0.66;
const FLAG_HEIGHT = 0.42;
/** The charm hangs from the stainless arch over the wheel. */
const CHARM_PIVOT = new THREE.Vector3(HELM_X + 0.13, 2.075, -3.36 + HELM_STATION_SHIFT);
const CHARM_CORD = 0.17;
/** The bobblehead stands on the instrument pod's top, left of the compass. */
const BOBBLE_BASE = new THREE.Vector3(HELM_X - 0.19, 2.005, -3.43 + HELM_STATION_SHIFT);

// --- Flags -----------------------------------------------------------------------------

function flagTexture(design: FlagDesign): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const c = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  if (design === "flag-jolly") {
    c.fillStyle = "#111214";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#f2efe6";
    c.strokeStyle = "#f2efe6";
    // Crossed bones.
    c.lineWidth = 26;
    c.lineCap = "round";
    for (const [x0, y0, x1, y1] of [
      [150, 215, 362, 285],
      [150, 285, 362, 215],
    ]) {
      c.beginPath();
      c.moveTo(x0!, y0!);
      c.lineTo(x1!, y1!);
      c.stroke();
      for (const [x, y] of [
        [x0!, y0!],
        [x1!, y1!],
      ]) {
        c.beginPath();
        c.arc(x! - 6, y! - 8, 15, 0, Math.PI * 2);
        c.arc(x! + 6, y! + 8, 15, 0, Math.PI * 2);
        c.fill();
      }
    }
    // The skull.
    c.beginPath();
    c.ellipse(256, 130, 78, 84, 0, 0, Math.PI * 2);
    c.fill();
    c.fillRect(214, 170, 84, 52);
    c.fillStyle = "#111214";
    c.beginPath();
    c.ellipse(225, 128, 22, 26, 0, 0, Math.PI * 2);
    c.ellipse(287, 128, 22, 26, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(256, 160);
    c.lineTo(244, 184);
    c.lineTo(268, 184);
    c.fill();
    for (let tooth = 0; tooth < 4; tooth += 1) c.fillRect(222 + tooth * 20, 202, 6, 20);
  } else if (design === "flag-tropic") {
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#ff8a3d");
    sky.addColorStop(0.55, "#ffd166");
    sky.addColorStop(0.56, "#13b5b1");
    sky.addColorStop(1, "#0a6f8a");
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#fff4c2";
    c.beginPath();
    c.arc(330, 176, 70, Math.PI, 0);
    c.fill();
    // A palm in silhouette.
    c.strokeStyle = "#1b2a20";
    c.fillStyle = "#1b2a20";
    c.lineWidth = 14;
    c.beginPath();
    c.moveTo(150, 300);
    c.quadraticCurveTo(170, 180, 140, 90);
    c.stroke();
    for (let leaf = 0; leaf < 7; leaf += 1) {
      const angle = -Math.PI + (leaf / 6) * Math.PI;
      c.beginPath();
      c.moveTo(140, 90);
      c.quadraticCurveTo(140 + Math.cos(angle) * 60, 90 + Math.sin(angle) * 40 - 30, 140 + Math.cos(angle) * 110, 90 + Math.sin(angle) * 40 + 40);
      c.quadraticCurveTo(140 + Math.cos(angle) * 60, 90 + Math.sin(angle) * 40 - 10, 140, 96);
      c.fill();
    }
  } else if (design === "flag-signal") {
    // Code flag "A" (diver down, keep clear): white at the hoist, blue swallowtail.
    c.fillStyle = "#f6f6f2";
    c.fillRect(0, 0, w / 2, h);
    c.fillStyle = "#1747a6";
    c.beginPath();
    c.moveTo(w / 2, 0);
    c.lineTo(w, 0);
    c.lineTo(w * 0.72, h / 2);
    c.lineTo(w, h);
    c.lineTo(w / 2, h);
    c.closePath();
    c.fill();
  } else if (design === "flag-rainbow") {
    const colors = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#5e35b1"];
    colors.forEach((color, index) => {
      c.fillStyle = color;
      c.fillRect(0, (index * h) / colors.length, w, h / colors.length + 1);
    });
  } else {
    // A gold dragon on red: a sinuous body, a spined back, a horned head.
    c.fillStyle = "#a3141c";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#f5c242";
    c.fillStyle = "#f5c242";
    c.lineWidth = 22;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(70, 240);
    c.bezierCurveTo(150, 120, 230, 300, 300, 180);
    c.bezierCurveTo(340, 110, 400, 120, 420, 150);
    c.stroke();
    for (let spine = 0; spine < 9; spine += 1) {
      const t = spine / 9;
      const x = 80 + t * 300;
      const y = 240 - Math.sin(t * Math.PI * 1.6) * 70;
      c.beginPath();
      c.moveTo(x - 12, y - 8);
      c.lineTo(x, y - 40);
      c.lineTo(x + 12, y - 8);
      c.fill();
    }
    c.beginPath();
    c.ellipse(440, 150, 40, 26, -0.3, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(430, 128);
    c.lineTo(410, 80);
    c.lineTo(450, 126);
    c.fill();
    c.fillStyle = "#a3141c";
    c.beginPath();
    c.arc(452, 142, 6, 0, Math.PI * 2);
    c.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** The flag's cloth: travelling waves from the staff to the fly, deeper toward the fly. */
function flagMaterial(texture: THREE.Texture, uniforms: { uTime: THREE.IUniform<number>; uWind: THREE.IUniform<number> }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlagTime = uniforms.uTime;
    shader.uniforms.uFlagWind = uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uFlagTime;\nuniform float uFlagWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          // x runs from the staff (0) to the fly (FLAG_LENGTH); y up the hoist.
          float along = clamp(position.x / ${FLAG_LENGTH.toFixed(3)}, 0.0, 1.0);
          float wind = clamp(uFlagWind, 0.0, 1.0);
          float speed = 5.0 + wind * 9.0;
          float wave = sin(position.x * 13.0 - uFlagTime * speed + position.y * 2.0)
            + 0.45 * sin(position.x * 23.0 - uFlagTime * speed * 1.7 + 1.3);
          transformed.z += wave * along * (0.025 + wind * 0.045);
          // In a calm the fly hangs down along the staff.
          float droop = (1.0 - wind) * along * along;
          transformed.y -= droop * position.x * 0.9;
          transformed.x -= droop * position.x * 0.45;
        }`,
      );
    // The normal follows the wave a little, so the folds shade.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      "#include <normal_fragment_begin>\nnormal = normalize(normal + vec3(0.0, 0.0, 0.25 * sin(vViewPosition.x * 20.0)));",
    );
  };
  material.customProgramCacheKey = () => "yacht-flag-v1";
  return material;
}

// --- Charms --------------------------------------------------------------------------------

function standard(color: number, roughness = 0.5, metalness = 0, emissive = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive: new THREE.Color(emissive) });
}

function charmModel(design: CharmDesign): THREE.Group {
  const group = new THREE.Group();
  if (design === "charm-shell") {
    const shell = new THREE.CircleGeometry(0.035, 16, 0, Math.PI);
    const position = shell.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      position.setZ(index, Math.abs(Math.sin(Math.atan2(y, x) * 8)) * 0.004 + (x * x + y * y) * 2);
    }
    shell.computeVertexNormals();
    shell.rotateZ(Math.PI);
    const mesh = new THREE.Mesh(shell, new THREE.MeshStandardMaterial({ color: 0xf3c9a8, roughness: 0.4, side: THREE.DoubleSide }));
    group.add(mesh);
  } else if (design === "charm-anchor") {
    const metal = standard(0xc9ced3, 0.3, 0.9);
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 6), metal);
    shank.position.y = -0.03;
    const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 6), metal);
    stock.rotation.z = Math.PI / 2;
    stock.position.y = -0.008;
    const arms = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, 6, 16, Math.PI), metal);
    arms.rotation.z = Math.PI;
    arms.position.y = -0.045;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.007, 0.0025, 6, 12), metal);
    ring.position.y = 0.004;
    group.add(shank, stock, arms, ring);
  } else if (design === "charm-dreamcatcher") {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.003, 6, 28), standard(0x8a5a2c, 0.8));
    ring.position.y = -0.04;
    const web = new THREE.Mesh(new THREE.CircleGeometry(0.038, 8), new THREE.MeshStandardMaterial({ color: 0xf2e6cc, wireframe: true }));
    web.position.y = -0.04;
    group.add(ring, web);
    for (let feather = 0; feather < 3; feather += 1) {
      const geometry = new THREE.PlaneGeometry(0.014, 0.05);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: [0x2f7fb8, 0xe9e2d0, 0xc0392b][feather], side: THREE.DoubleSide, roughness: 0.9 }));
      mesh.position.set((feather - 1) * 0.022, -0.1 - (feather === 1 ? 0.01 : 0), 0);
      group.add(mesh);
    }
  } else {
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.002, 6, 16), standard(0xd8b04a, 0.25, 1));
    cage.position.y = -0.022;
    const cage2 = cage.clone();
    cage2.rotation.y = Math.PI / 2;
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.016, 18, 14), new THREE.MeshStandardMaterial({ color: 0xf6f0ea, roughness: 0.18, metalness: 0.1, emissive: 0x1a1a22 }));
    pearl.position.y = -0.022;
    group.add(cage, cage2, pearl);
  }
  return group;
}

// --- Bobbleheads ------------------------------------------------------------------------------

/** Body (fixed to the pod) and head (on its spring) of a bobblehead. */
function bobbleModel(design: BobbleDesign): { body: THREE.Group; head: THREE.Group } {
  const body = new THREE.Group();
  const head = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.012, 20), standard(0x2b2b2e, 0.6));
  base.position.y = 0.006;
  body.add(base);
  const skin = standard(0xd9a07a, 0.55);
  if (design === "bobble-hula") {
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.04, 12), skin);
    torso.position.y = 0.06;
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.04, 16, 1, true), standard(0x5aa13a, 0.9));
    skirt.position.y = 0.032;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), standard(0xe23d6d, 0.6));
    top.position.y = 0.072;
    top.scale.set(1.2, 0.6, 1);
    body.add(torso, skirt, top);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.026, 18, 14), skin);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.0275, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), standard(0x1a120c, 0.7));
    hair.rotation.x = -0.35;
    const flower = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), standard(0xff6f91, 0.5));
    flower.position.set(0.02, 0.014, 0.01);
    head.add(face, hair, flower);
  } else if (design === "bobble-captain") {
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, 0.06, 12), standard(0x1c2d55, 0.7));
    coat.position.y = 0.042;
    const buttons = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.04, 0.004), standard(0xd8b04a, 0.3, 1));
    buttons.position.set(0, 0.045, 0.019);
    body.add(coat, buttons);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.026, 18, 14), skin);
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), standard(0xeeeeea, 0.9));
    beard.position.set(0, -0.004, 0.006);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.026, 0.016, 18), standard(0xf5f5f2, 0.5));
    cap.position.y = 0.022;
    const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.003, 18, 1, false, 0, Math.PI), standard(0x111111, 0.4));
    peak.position.set(0, 0.016, 0.014);
    peak.rotation.y = -Math.PI / 2;
    head.add(face, beard, cap, peak);
  } else if (design === "bobble-parrot") {
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.03, 4, 10), standard(0x2e9e48, 0.6));
    torso.position.y = 0.04;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.04, 6), standard(0x2f6fd1, 0.6));
    tail.position.set(0, 0.02, -0.018);
    tail.rotation.x = -2.6;
    body.add(torso, tail);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.024, 18, 14), standard(0xd8322e, 0.6));
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 8), standard(0xf2d36b, 0.5));
    beak.position.set(0, -0.004, 0.026);
    beak.rotation.x = Math.PI / 2 + 0.5;
    const eyes = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), standard(0xffffff, 0.3));
    eyes.position.set(0.012, 0.008, 0.018);
    const eyes2 = eyes.clone();
    eyes2.position.x = -0.012;
    head.add(face, beak, eyes, eyes2);
  } else {
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.032, 4, 10), standard(0x6f7f8f, 0.55));
    torso.position.y = 0.042;
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.025, 4), standard(0x6f7f8f, 0.55));
    fin.position.set(0, 0.05, -0.016);
    fin.rotation.x = -0.5;
    body.add(torso, fin);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.027, 18, 14), standard(0x7a8a9a, 0.5));
    face.scale.set(1, 0.9, 1.25);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), standard(0xeeeeea, 0.6));
    belly.position.set(0, -0.004, 0.01);
    const teeth = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 4, 16, Math.PI), standard(0xffffff, 0.3));
    teeth.position.set(0, -0.008, 0.026);
    teeth.rotation.set(-0.3, 0, Math.PI);
    head.add(face, belly, teeth);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.02, 6), standard(0x999999, 0.4, 0.8));
  neck.position.y = 0.086;
  body.add(neck);
  return { body, head };
}

// --- The decor ------------------------------------------------------------------------------------

export type DecorMotion = {
  /** The yacht's velocity (world, m/s), her true wind (world, m/s) and her axes. */
  velocity: THREE.Vector3;
  wind: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
};

export class YachtDecor {
  private readonly staff: THREE.Group;
  private readonly flagPivot = new THREE.Group();
  private flagMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null;
  private readonly flagUniforms = { uTime: { value: 0 }, uWind: { value: 0.5 } };
  private readonly flagGeometry = new THREE.PlaneGeometry(FLAG_LENGTH, FLAG_HEIGHT, 24, 8).translate(FLAG_LENGTH / 2, -FLAG_HEIGHT / 2, 0);
  private flagHeading = 0;
  private readonly charmPivot = new THREE.Group();
  private charm: THREE.Group | null = null;
  private readonly cord: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  /** The charm's bob relative to its pivot (vessel space) and its velocity. */
  private readonly bob = new THREE.Vector3(0, -CHARM_CORD, 0);
  private readonly bobVelocity = new THREE.Vector3();
  private readonly bobbleGroup = new THREE.Group();
  private bobbleHead: THREE.Group | null = null;
  /** Head tilt about X and Z (rad) and its rates: a stiff, lightly damped spring. */
  private readonly tilt = new THREE.Vector2();
  private readonly tiltRate = new THREE.Vector2();
  private readonly lastVelocity = new THREE.Vector3();
  private readonly lastQuaternion = new THREE.Quaternion();
  private readonly inverse = new THREE.Quaternion();
  private readonly accel = new THREE.Vector3();
  private readonly gravity = new THREE.Vector3();
  private readonly air = new THREE.Vector3();
  private readonly spin = new THREE.Vector3();
  private readonly deltaQuaternion = new THREE.Quaternion();
  private primed = false;
  private time = 0;
  private flagDesign: string | null = null;
  private charmDesign: string | null = null;
  private bobbleDesign: string | null = null;

  constructor(private readonly root: THREE.Object3D) {
    this.staff = new THREE.Group();
    this.staff.name = "DecorFlagStaff";
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, STAFF_HEIGHT, 10), standard(0xd8dde0, 0.3, 0.9));
    pole.position.y = STAFF_HEIGHT / 2;
    const truck = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), standard(0xd8b04a, 0.3, 1));
    truck.position.y = STAFF_HEIGHT + 0.015;
    this.staff.add(pole, truck);
    this.staff.position.copy(FLAG_STAFF);
    // Raked aft a little, as a stern staff is.
    this.staff.rotation.x = -0.12;
    this.flagPivot.position.y = STAFF_HEIGHT - 0.03;
    this.staff.add(this.flagPivot);
    this.staff.visible = false;
    root.add(this.staff);

    this.charmPivot.position.copy(CHARM_PIVOT);
    this.charmPivot.name = "DecorCharm";
    const cordGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -CHARM_CORD, 0)]);
    this.cord = new THREE.Line(cordGeometry, new THREE.LineBasicMaterial({ color: 0x3a2e24 }));
    this.charmPivot.add(this.cord);
    this.charmPivot.visible = false;
    root.add(this.charmPivot);

    this.bobbleGroup.position.copy(BOBBLE_BASE);
    this.bobbleGroup.rotation.y = 0.35;
    this.bobbleGroup.name = "DecorBobblehead";
    this.bobbleGroup.visible = false;
    root.add(this.bobbleGroup);
  }

  /** Hangs, flies and stands the chosen decor (null takes it down). */
  setDecor(flag: string | null, charm: string | null, bobble: string | null): void {
    if (flag !== this.flagDesign) {
      this.flagDesign = flag;
      if (this.flagMesh) {
        this.flagPivot.remove(this.flagMesh);
        this.flagMesh.material.map?.dispose();
        this.flagMesh.material.dispose();
        this.flagMesh = null;
      }
      if (flag) {
        this.flagMesh = new THREE.Mesh(this.flagGeometry, flagMaterial(flagTexture(flag as FlagDesign), this.flagUniforms));
        this.flagMesh.castShadow = true;
        this.flagPivot.add(this.flagMesh);
      }
      this.staff.visible = flag !== null;
    }
    if (charm !== this.charmDesign) {
      this.charmDesign = charm;
      if (this.charm) {
        this.charmPivot.remove(this.charm);
        disposeTree(this.charm);
        this.charm = null;
      }
      if (charm) {
        this.charm = charmModel(charm as CharmDesign);
        this.charmPivot.add(this.charm);
      }
      this.charmPivot.visible = charm !== null;
    }
    if (bobble !== this.bobbleDesign) {
      this.bobbleDesign = bobble;
      for (const child of [...this.bobbleGroup.children]) {
        this.bobbleGroup.remove(child);
        disposeTree(child);
      }
      this.bobbleHead = null;
      if (bobble) {
        const { body, head } = bobbleModel(bobble as BobbleDesign);
        head.position.y = 0.118;
        this.bobbleGroup.add(body, head);
        this.bobbleHead = head;
      }
      this.bobbleGroup.visible = bobble !== null;
    }
  }

  /** One frame of the cloth, the cord and the spring. */
  update(delta: number, motion: DecorMotion): void {
    const dt = Math.min(0.05, Math.max(0, delta));
    if (dt <= 0) return;
    this.time += dt;
    this.root.updateMatrixWorld();
    const quaternion = this.root.getWorldQuaternion(this.deltaQuaternion);
    this.inverse.copy(quaternion).invert();
    if (!this.primed) {
      this.primed = true;
      this.lastVelocity.copy(motion.velocity);
      this.lastQuaternion.copy(quaternion);
    }
    // The yacht's acceleration and the gravity felt aboard, in her own frame.
    this.accel.subVectors(motion.velocity, this.lastVelocity).divideScalar(dt);
    this.accel.clampLength(0, 12);
    this.lastVelocity.copy(motion.velocity);
    this.gravity.set(0, -9.81, 0).sub(this.accel).applyQuaternion(this.inverse);
    // Her turn rate (roll, pitch, yaw) in her own frame.
    const turn = this.lastQuaternion.invert().multiply(quaternion);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
    const s = Math.sqrt(Math.max(1e-9, 1 - turn.w * turn.w));
    this.spin.set(turn.x / s, turn.y / s, turn.z / s).multiplyScalar((Math.sign(turn.w || 1) * angle) / dt);
    if (!Number.isFinite(this.spin.x)) this.spin.set(0, 0, 0);
    this.lastQuaternion.copy(quaternion);

    // --- Flag: streams down the apparent wind, which she feels in her own frame.
    if (this.flagMesh) {
      const airForward = motion.wind.dot(motion.forward) - motion.velocity.dot(motion.forward);
      const airRight = motion.wind.dot(motion.right) - motion.velocity.dot(motion.right);
      const speed = Math.hypot(airForward, airRight);
      // The cloth points where the air goes (local +X is starboard, +Z the bow).
      if (speed > 0.4) {
        const goal = Math.atan2(-airForward, airRight);
        const difference = Math.atan2(Math.sin(goal - this.flagHeading), Math.cos(goal - this.flagHeading));
        this.flagHeading += difference * (1 - Math.exp(-dt * (1.5 + speed * 0.4)));
      }
      this.flagPivot.rotation.y = this.flagHeading;
      this.flagUniforms.uTime.value = this.time;
      this.flagUniforms.uWind.value += (Math.min(1, speed / 9) - this.flagUniforms.uWind.value) * (1 - Math.exp(-dt * 2));
    }

    // --- Charm: a point mass on a cord, under the gravity felt aboard.
    if (this.charm) {
      const bob = this.bob;
      const velocity = this.bobVelocity;
      velocity.addScaledVector(this.gravity, dt);
      velocity.multiplyScalar(Math.exp(-dt * 0.9));
      bob.addScaledVector(velocity, dt);
      // The cord holds it at its length (and never above the pivot).
      bob.setLength(CHARM_CORD);
      if (bob.y > -0.02) bob.y = -0.02;
      bob.setLength(CHARM_CORD);
      // What is left of the velocity is the swing round the pivot.
      const radial = velocity.dot(bob) / (CHARM_CORD * CHARM_CORD);
      velocity.addScaledVector(bob, -radial);
      this.charm.position.copy(bob);
      // Turned along its cord, spinning slowly on it.
      this.charm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.air.copy(bob).normalize());
      this.charm.rotateY(Math.sin(this.time * 0.7) * 0.8);
      const positions = this.cord.geometry.getAttribute("position") as THREE.BufferAttribute;
      positions.setXYZ(1, bob.x, bob.y, bob.z);
      positions.needsUpdate = true;
    }

    // --- Bobblehead: a heavy head on a stiff spring, pushed by her motion.
    if (this.bobbleHead) {
      const stiffness = 120;
      const damping = 3.2;
      // Felt gravity off the vertical tips the head; her pitch and roll rates whip it.
      const pushX = -this.gravity.z * 0.11 + this.spin.x * 0.35;
      const pushZ = this.gravity.x * 0.11 + this.spin.z * 0.35;
      const steps = 4;
      const h = dt / steps;
      for (let index = 0; index < steps; index += 1) {
        this.tiltRate.x += (-stiffness * this.tilt.x - damping * this.tiltRate.x + pushX * stiffness) * h;
        this.tiltRate.y += (-stiffness * this.tilt.y - damping * this.tiltRate.y + pushZ * stiffness) * h;
        this.tilt.x += this.tiltRate.x * h;
        this.tilt.y += this.tiltRate.y * h;
      }
      this.tilt.clampScalar(-0.6, 0.6);
      this.bobbleHead.rotation.set(this.tilt.x, Math.sin(this.time * 0.5) * 0.05, this.tilt.y);
    }
  }

  dispose(): void {
    this.setDecor(null, null, null);
    this.flagGeometry.dispose();
    disposeTree(this.staff);
    this.cord.geometry.dispose();
    this.cord.material.dispose();
    this.staff.removeFromParent();
    this.charmPivot.removeFromParent();
    this.bobbleGroup.removeFromParent();
  }
}

function disposeTree(object: THREE.Object3D): void {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        (material as THREE.MeshStandardMaterial).map?.dispose();
        material.dispose();
      }
    }
  });
}
