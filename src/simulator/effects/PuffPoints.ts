import * as THREE from "three";

/**
 * A pool of soft, lumpy puffs drawn as point sprites: smoke, ash, steam or
 * glowing embers. Each puff has a position, a size in metres and a colour
 * with opacity; the caller writes them every frame (no allocation) and sets
 * how many to draw. Fogged like the rest of the scene, so a plume on the
 * horizon sinks into the haze.
 */

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute vec4 aShade;
  uniform float uScale;
  varying vec4 vShade;
  varying float vSeed;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(aSize * uScale / max(-mvPosition.z, 1.0), 1.0, 320.0);
    vShade = aShade;
    vSeed = fract(position.x * 0.137 + position.z * 0.071 + position.y * 0.019);
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uSoft;
  varying vec4 vShade;
  varying float vSeed;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    float angle = atan(p.y, p.x);
    float lumps = 0.8 + 0.2 * sin(angle * 3.0 + vSeed * 18.0) * sin(angle * 5.0 - vSeed * 7.0);
    float density = smoothstep(1.0, uSoft, r / lumps);
    gl_FragColor = vec4(vShade.rgb, vShade.a * density);
    #include <fog_fragment>
  }
`;

export class PuffPoints {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positions: THREE.BufferAttribute;
  private readonly sizes: THREE.BufferAttribute;
  private readonly shades: THREE.BufferAttribute;
  private count = 0;

  constructor(
    readonly capacity: number,
    options: { additive?: boolean; soft?: number; fog?: boolean; renderOrder?: number; name?: string } = {},
  ) {
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizes = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.shades = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", this.positions);
    geometry.setAttribute("aSize", this.sizes);
    geometry.setAttribute("aShade", this.shades);
    geometry.setDrawRange(0, 0);
    const fog = options.fog ?? true;
    const material = new THREE.ShaderMaterial({
      name: options.name ?? "Puffs",
      vertexShader,
      fragmentShader,
      uniforms: THREE.UniformsUtils.merge([
        fog ? THREE.UniformsLib.fog : {},
        { uScale: { value: 500 }, uSoft: { value: options.soft ?? 0.15 } },
      ]),
      transparent: true,
      depthWrite: false,
      fog,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = options.renderOrder ?? 5;
    this.points.visible = false;
  }

  /** Starts a frame: nothing drawn until `push`. */
  begin(): void {
    this.count = 0;
  }

  /** Adds a puff (ignored beyond the capacity). */
  push(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number): void {
    if (this.count >= this.capacity || a <= 0.002) return;
    const index = this.count;
    this.positions.setXYZ(index, x, y, z);
    this.sizes.setX(index, size);
    this.shades.setXYZW(index, r, g, b, a);
    this.count += 1;
  }

  /** Ends the frame: uploads what was pushed. `pixelScale`: pixels per metre at 1 m. */
  end(pixelScale: number): void {
    this.positions.needsUpdate = true;
    this.sizes.needsUpdate = true;
    this.shades.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.count);
    this.points.visible = this.count > 0;
    this.points.material.uniforms.uScale!.value = pixelScale;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points.removeFromParent();
  }
}
