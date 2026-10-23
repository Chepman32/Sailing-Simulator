import * as THREE from "three";

export type LightMarker = "NavPort" | "NavStarboard" | "Beacon" | "BeaconLower" | "TailLight" | "LandingLight";

type Light = {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  kind: LightMarker;
  baseSize: number;
};

/**
 * Anti-collision strobe pattern: a double white flash every 1.2 s. Returns
 * flash intensity in [0, 1]. Pure so the timing is testable.
 */
export function strobeFlash(time: number): number {
  const phase = ((time % 1.2) + 1.2) % 1.2;
  const pulse = (center: number) => Math.max(0, 1 - Math.abs(phase - center) / 0.035);
  return Math.min(1, pulse(0.035) + pulse(0.165));
}

/** Rotating red beacon: a short bright sweep about once a second. */
export function beaconFlash(time: number): number {
  return Math.max(0, Math.sin(time * Math.PI * 2 * 0.95)) ** 8;
}

/** Glare of a forward-facing landing light seen from a direction (cosine to the nose). */
export function landingLightGlare(cosineToViewer: number): number {
  return Math.max(0, cosineToViewer) ** 10;
}

export function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.12, "rgba(255,255,255,0.9)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.28)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    // Faint cross-shaped diffraction spikes for the strobe and landing light.
    context.globalCompositeOperation = "lighter";
    context.fillStyle = "rgba(255,255,255,0.18)";
    context.fillRect(0, 31, 64, 2);
    context.fillRect(31, 0, 2, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const COLORS: Record<LightMarker, number> = {
  NavPort: 0xff2a1a,
  NavStarboard: 0x2dff7a,
  TailLight: 0xffffff,
  Beacon: 0xff2414,
  BeaconLower: 0xff2414,
  LandingLight: 0xfff3d6,
};

/**
 * Sprite-based exterior lights attached to an aircraft's named marker nodes.
 * Navigation lights glow steadily (faint by day), wingtip strobes double
 * flash, beacons sweep red, and the landing light flares toward the viewer.
 * Sizes are meters in the aircraft's own frame.
 */
export class AircraftLights {
  private readonly lights: Light[] = [];
  private readonly forward = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private readonly world = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();

  constructor(
    model: THREE.Object3D,
    texture: THREE.Texture,
    private readonly scale: number,
    private readonly phase = Math.random() * 1.2,
  ) {
    const add = (kind: LightMarker, baseSize: number) => {
      const marker = model.getObjectByName(kind);
      if (!marker) return;
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: COLORS[kind],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.name = `${kind}_Glow`;
      sprite.position.copy(marker.position);
      // Markers sit in the model's frame; keep glow size in that frame too.
      marker.parent?.add(sprite);
      this.lights.push({ sprite, material, kind, baseSize: baseSize * scale });
    };
    add("NavPort", 0.9);
    add("NavStarboard", 0.9);
    add("TailLight", 0.7);
    add("Beacon", 1.1);
    add("BeaconLower", 1.1);
    add("LandingLight", 1.6);
  }

  update(time: number, nightFactor: number, root: THREE.Object3D, camera: THREE.Camera, visibility = 1): void {
    const night = THREE.MathUtils.smoothstep(nightFactor, 0.15, 0.85);
    const strobe = strobeFlash(time + this.phase);
    const beacon = beaconFlash(time + this.phase * 0.7);
    this.forward.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(this.orientation));
    this.lights.forEach((light) => {
      let opacity = 0;
      let size = light.baseSize;
      switch (light.kind) {
        case "NavPort":
        case "NavStarboard":
          // Steady position light, with the strobe sharing the wingtip unit.
          opacity = 0.22 + night * 0.78;
          if (strobe > 0) {
            // Over 1: the HDR bloom pass makes the xenon flash flare.
            light.material.color.setRGB(5, 5, 5);
            opacity = Math.max(opacity, strobe);
            size *= 1 + strobe * 2.6;
          } else {
            light.material.color.setHex(COLORS[light.kind]);
          }
          break;
        case "TailLight":
          opacity = 0.15 + night * 0.85;
          break;
        case "Beacon":
        case "BeaconLower":
          opacity = beacon * (0.55 + night * 0.45);
          size *= 1 + beacon * 0.6;
          light.material.color.setHex(COLORS[light.kind]).multiplyScalar(1 + beacon * 2.5);
          break;
        case "LandingLight": {
          light.sprite.getWorldPosition(this.world);
          this.toCamera.copy(camera.position).sub(this.world).normalize();
          const glare = landingLightGlare(this.forward.dot(this.toCamera));
          opacity = 0.18 + night * 0.4 + glare * 0.9;
          size *= 1 + glare * 4;
          break;
        }
      }
      light.material.opacity = Math.min(1, opacity) * visibility;
      light.sprite.scale.setScalar(size);
      light.sprite.visible = light.material.opacity > 0.01;
    });
  }

  dispose(): void {
    this.lights.forEach((light) => {
      light.sprite.removeFromParent();
      light.material.dispose();
    });
    this.lights.length = 0;
  }
}
