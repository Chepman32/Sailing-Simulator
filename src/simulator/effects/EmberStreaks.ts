import * as THREE from "three";

/**
 * Incandescent fragments drawn as motion-blurred streaks: each is a quad
 * from where the ember is now back along its velocity, a white-hot head
 * fading into an orange-red tail, the width turned toward the camera. This
 * is what a lava fountain looks like on any real photograph, where a short
 * exposure turns each bomb into a glowing arc. Blended over the scene (not
 * added: over a blue sky that bleached it white), hot cores brighter than
 * white so the bloom spreads them. One draw call for all of them.
 */

const vertexShader = /* glsl */ `
  attribute vec3 aHead;
  attribute vec3 aTail;
  attribute vec2 aShape;
  varying vec2 vUv;
  varying float vHeat;
  #include <fog_pars_vertex>
  void main() {
    vec4 head = viewMatrix * vec4(aHead, 1.0);
    vec4 tail = viewMatrix * vec4(aTail, 1.0);
    vec3 along = head.xyz - tail.xyz;
    float length = max(length(along), 1.0e-3);
    vec3 axis = along / length;
    vec3 across = normalize(cross(axis, normalize(head.xyz + tail.xyz)));
    // position.x: 0 tail … 1 head; position.y: −0.5 … 0.5 across.
    vec3 point = mix(tail.xyz, head.xyz, position.x) + across * position.y * aShape.x;
    // A little beyond the head, round.
    point += axis * (position.x - 0.5) * aShape.x * 0.5;
    vec4 mvPosition = vec4(point, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vUv = position.xy + vec2(0.0, 0.5);
    vHeat = aShape.y;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying float vHeat;
  #include <fog_pars_fragment>
  void main() {
    // A streak tapers from a round, bright head to a thin, dim tail.
    float along = vUv.x;
    float halfWidth = mix(0.25, 1.0, pow(along, 0.7));
    float across = 1.0 - smoothstep(0.0, halfWidth, abs(vUv.y * 2.0 - 1.0));
    float core = pow(across, 1.6);
    float fade = pow(along, 2.2);
    // Saturated incandescence: yellow-orange when hot, orange-red as it
    // cools, the tail always redder; a cooled bomb is dark rock. Drawn over
    // what is behind it, not added to it: added to a blue sky, orange turned
    // into a white dash.
    vec3 hot = vec3(3.4, 1.35, 0.24);
    vec3 warm = vec3(1.9, 0.42, 0.06);
    vec3 cold = vec3(0.7, 0.08, 0.02);
    vec3 glow = mix(cold, mix(warm, hot, vHeat), fade) * (0.35 + 0.65 * vHeat);
    vec3 color = mix(vec3(0.045, 0.04, 0.038), glow, smoothstep(0.0, 0.3, vHeat));
    float alpha = core * (0.15 + 0.85 * fade);
    gl_FragColor = vec4(color, alpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class EmberStreaks {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly head: THREE.InstancedBufferAttribute;
  private readonly tail: THREE.InstancedBufferAttribute;
  private readonly shape: THREE.InstancedBufferAttribute;
  private count = 0;

  constructor(readonly capacity: number) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.head = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tail = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.shape = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aHead", this.head);
    geometry.setAttribute("aTail", this.tail);
    geometry.setAttribute("aShape", this.shape);
    geometry.instanceCount = 0;
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        name: "EmberStreaks",
        vertexShader,
        fragmentShader,
        uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        fog: true,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    this.mesh.name = "EmberStreaks";
  }

  begin(): void {
    this.count = 0;
  }

  /** An ember from `tail` to `head` (m), `width` m wide, heat 0 (dull) … 1 (white-hot). */
  push(hx: number, hy: number, hz: number, tx: number, ty: number, tz: number, width: number, heat: number): void {
    if (this.count >= this.capacity || heat <= 0.02) return;
    const index = this.count;
    this.head.setXYZ(index, hx, hy, hz);
    this.tail.setXYZ(index, tx, ty, tz);
    this.shape.setXY(index, width, Math.min(1, heat));
    this.count += 1;
  }

  end(): void {
    this.head.needsUpdate = true;
    this.tail.needsUpdate = true;
    this.shape.needsUpdate = true;
    this.mesh.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
