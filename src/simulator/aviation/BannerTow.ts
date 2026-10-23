import * as THREE from "three";

export const BANNER_LENGTH = 24;
export const BANNER_HEIGHT = 5;
export const TOW_ROPE_LENGTH = 26;
const BRIDLE_LENGTH = 4;
const HISTORY_SIZE = 96;
const HISTORY_INTERVAL = 0.08;

type BannerDesign = {
  text: string;
  background: [string, string];
  ink: string;
  outline: string;
  stripe: string;
};

// In-world advertising copy for fictional local businesses.
const BANNER_DESIGNS: BannerDesign[] = [
  { text: "SUNSET REEF CRUISES", background: ["#ff2e88", "#ff7a3d"], ink: "#fff8d6", outline: "#5a0b3a", stripe: "#ffe14d" },
  { text: "ISLAND HOPPER TOURS", background: ["#ffe12e", "#ffb100"], ink: "#0b3c8c", outline: "#ffffff", stripe: "#ff3d2e" },
  { text: "DIVE THE CORAL GARDEN", background: ["#00d1c1", "#0091ff"], ink: "#ffffff", outline: "#003b5c", stripe: "#ffef5a" },
  { text: "MANGO TANGO BEACH BAR", background: ["#8cff3a", "#ffd23a"], ink: "#d6007a", outline: "#ffffff", stripe: "#ff6a00" },
  { text: "SURF SCHOOL • DAILY", background: ["#ff4f1f", "#ffcc00"], ink: "#ffffff", outline: "#6b1a00", stripe: "#00b8ff" },
];

const vertexPatch = /* glsl */ `
  float bannerS = clamp(-position.z / uBannerLength, 0.0, 1.0);
  float bannerAmp = 0.06 + 0.62 * pow(bannerS, 1.45);
  float bannerPhase = -position.z * uBannerWaveNumber - uBannerTime * uBannerAngular;
  float bannerSlope = -bannerAmp * uBannerWaveNumber * cos(bannerPhase);
`;

/**
 * A towed advertising banner: lead pole, bridle and tow rope, plus a fabric
 * panel with a travelling flutter wave whose amplitude grows toward the free
 * tail. The banner follows the tow hook's recorded path, so it swings wide on
 * turns like a real towed banner instead of being rigidly attached.
 */
export class BannerTow {
  readonly group = new THREE.Group();
  private readonly banner: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly pole: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  private readonly rope: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly ropePositions: Float32Array;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private readonly uniforms = {
    uBannerTime: { value: 0 },
    uBannerLength: { value: BANNER_LENGTH },
    uBannerWaveNumber: { value: (Math.PI * 2) / 7.5 },
    uBannerAngular: { value: 9 },
  };
  private readonly history: THREE.Vector3[] = [];
  private historyCount = 0;
  private historyHead = 0;
  private historyTimer = 0;
  private readonly lead = new THREE.Vector3();
  private readonly tail = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly bridle = new THREE.Vector3();
  private designIndex = Math.floor(Math.random() * BANNER_DESIGNS.length);

  constructor(scene: THREE.Scene) {
    this.group.name = "Advertising_Banner_Tow";
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1024;
    this.canvas.height = Math.round((1024 * BANNER_HEIGHT) / BANNER_LENGTH);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    // PlaneGeometry lies in XY facing +Z. Rotating it about Y puts the cloth in
    // the YZ plane facing +X, and the translation runs it from the lead pole
    // (z = 0, u = 0) back to the free tail (z = -length, u = 1).
    const geometry = new THREE.PlaneGeometry(BANNER_LENGTH, BANNER_HEIGHT, 48, 6);
    geometry.rotateY(Math.PI / 2);
    geometry.translate(0, 0, -BANNER_LENGTH / 2);
    const material = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uBannerTime;\nuniform float uBannerLength;\nuniform float uBannerWaveNumber;\nuniform float uBannerAngular;",
        )
        .replace(
          "#include <beginnormal_vertex>",
          `${vertexPatch}\nvec3 objectNormal = normalize(vec3(1.0, 0.0, -bannerSlope));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif`,
        )
        .replace(
          "#include <begin_vertex>",
          "vec3 transformed = vec3(position);\ntransformed.x += bannerAmp * sin(bannerPhase);\ntransformed.y -= 0.35 * bannerS * bannerS;",
        );
    };
    material.customProgramCacheKey = () => "advertising-banner-flutter";
    this.banner = new THREE.Mesh(geometry, material);
    this.banner.name = "Advertising_Banner_Cloth";
    this.banner.frustumCulled = false;

    this.pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, BANNER_HEIGHT + 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.5, metalness: 0.6 }),
    );
    this.pole.name = "Banner_Lead_Pole";

    this.ropePositions = new Float32Array(6 * 3);
    const ropeGeometry = new THREE.BufferGeometry();
    ropeGeometry.setAttribute("position", new THREE.BufferAttribute(this.ropePositions, 3));
    this.rope = new THREE.LineSegments(
      ropeGeometry,
      new THREE.LineBasicMaterial({ color: 0x2a2620, transparent: true, opacity: 0.85 }),
    );
    this.rope.name = "Banner_Tow_Rope";
    this.rope.frustumCulled = false;

    this.group.add(this.banner, this.pole);
    scene.add(this.group, this.rope);
    for (let index = 0; index < HISTORY_SIZE; index += 1) this.history.push(new THREE.Vector3());
    this.setVisible(false);
  }

  /** Paints the next advert and mirrors it so it reads correctly from the yacht's side. */
  prepare(hook: THREE.Vector3, heading: number, observerSide: 1 | -1): void {
    this.designIndex = (this.designIndex + 1) % BANNER_DESIGNS.length;
    this.paint(BANNER_DESIGNS[this.designIndex]);
    // The cloth's front face looks along +X. A viewer on the -X side sees the
    // back face, which shows the texture mirrored, so flip U for that side.
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.repeat.set(observerSide === 1 ? 1 : -1, 1);
    this.texture.offset.set(observerSide === 1 ? 0 : 1, 0);
    this.texture.needsUpdate = true;
    // Seed the path history with a straight line behind the aircraft.
    const backX = -Math.sin(heading);
    const backZ = -Math.cos(heading);
    this.historyCount = HISTORY_SIZE;
    this.historyHead = 0;
    this.historyTimer = 0;
    for (let index = 0; index < HISTORY_SIZE; index += 1) {
      const distance = (HISTORY_SIZE - 1 - index) * 3.2;
      this.history[index].set(hook.x + backX * distance, hook.y, hook.z + backZ * distance);
    }
    this.historyHead = HISTORY_SIZE - 1;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.rope.visible = visible;
  }

  update(delta: number, hook: THREE.Vector3, speed: number): void {
    this.uniforms.uBannerTime.value += delta;
    this.uniforms.uBannerAngular.value = 6 + speed * 0.12;
    this.historyTimer += delta;
    if (this.historyTimer >= HISTORY_INTERVAL) {
      this.historyTimer = 0;
      this.historyHead = (this.historyHead + 1) % HISTORY_SIZE;
      this.history[this.historyHead].copy(hook);
      this.historyCount = Math.min(HISTORY_SIZE, this.historyCount + 1);
    }

    this.pointBehind(hook, TOW_ROPE_LENGTH + BRIDLE_LENGTH, this.lead);
    this.pointBehind(hook, TOW_ROPE_LENGTH + BRIDLE_LENGTH + BANNER_LENGTH, this.tail);
    // The weighted lead pole rides a little below the tow line.
    this.lead.y -= 2.2;
    this.tail.y = this.lead.y - 0.4;
    this.direction.subVectors(this.lead, this.tail);
    const heading = Math.atan2(this.direction.x, this.direction.z);
    this.group.position.copy(this.lead);
    this.group.rotation.set(0, heading, 0, "YXZ");
    this.pole.position.set(0, 0, 0.05);

    this.pointBehind(hook, TOW_ROPE_LENGTH, this.bridle);
    this.bridle.y = THREE.MathUtils.lerp(hook.y, this.lead.y, 0.85);
    const top = this.lead.y + BANNER_HEIGHT * 0.5;
    const bottom = this.lead.y - BANNER_HEIGHT * 0.5;
    this.writeRope(0, hook, this.bridle.x, this.bridle.y, this.bridle.z);
    this.writeRope(1, this.bridle, this.lead.x, top, this.lead.z);
    this.writeRope(2, this.bridle, this.lead.x, bottom, this.lead.z);
    this.rope.geometry.getAttribute("position").needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.rope.removeFromParent();
    this.banner.geometry.dispose();
    this.banner.material.dispose();
    this.pole.geometry.dispose();
    this.pole.material.dispose();
    this.rope.geometry.dispose();
    this.rope.material.dispose();
    this.texture.dispose();
  }

  private writeRope(segment: number, start: THREE.Vector3, endX: number, endY: number, endZ: number): void {
    const offset = segment * 6;
    this.ropePositions[offset] = start.x;
    this.ropePositions[offset + 1] = start.y;
    this.ropePositions[offset + 2] = start.z;
    this.ropePositions[offset + 3] = endX;
    this.ropePositions[offset + 4] = endY;
    this.ropePositions[offset + 5] = endZ;
  }

  /** Walks back along the recorded hook path by an arc length. */
  private pointBehind(hook: THREE.Vector3, distance: number, target: THREE.Vector3): void {
    let remaining = distance;
    let previous = hook;
    for (let step = 0; step < this.historyCount; step += 1) {
      const index = (this.historyHead - step + HISTORY_SIZE) % HISTORY_SIZE;
      const point = this.history[index];
      const length = previous.distanceTo(point);
      if (length >= remaining && length > 1e-6) {
        target.copy(previous).lerp(point, remaining / length);
        return;
      }
      remaining -= length;
      previous = point;
    }
    target.copy(previous);
  }

  private paint(design: BannerDesign): void {
    const context = this.canvas.getContext("2d");
    if (!context) return;
    const { width, height } = this.canvas;
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, design.background[0]);
    gradient.addColorStop(1, design.background[1]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = design.stripe;
    context.fillRect(0, 0, width, height * 0.085);
    context.fillRect(0, height * 0.915, width, height * 0.085);
    // Stitched hem along the lead edge.
    context.fillStyle = "rgba(0,0,0,.22)";
    context.fillRect(0, 0, width * 0.012, height);

    let fontSize = height * 0.56;
    const font = (size: number): string => `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    context.font = font(fontSize);
    const maxWidth = width * 0.92;
    const measured = context.measureText(design.text).width;
    if (measured > maxWidth) {
      fontSize *= maxWidth / measured;
      context.font = font(fontSize);
    }
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineWidth = fontSize * 0.14;
    context.strokeStyle = design.outline;
    context.strokeText(design.text, width / 2, height * 0.53);
    context.fillStyle = design.ink;
    context.fillText(design.text, width / 2, height * 0.53);
  }
}
