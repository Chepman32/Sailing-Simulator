import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";

/**
 * Ground-truth ambient occlusion (three's GTAO, normals rebuilt from depth)
 * on the scene's own depth buffer, with one twist for a sea: the water does
 * not write depth (it is drawn over the seabed it lets show through), so its
 * pixels carry the depth of whatever lies under them. Occlusion is therefore
 * applied only where the depth belongs to something above the water line —
 * the hull, the deck, the crew, the islands and their huts — and to
 * everything once the eyes are under the water.
 */

const CompositeShader = {
  uniforms: {
    tColor: { value: null as THREE.Texture | null },
    tAo: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uProjectionInverse: { value: new THREE.Matrix4() },
    uCameraWorld: { value: new THREE.Matrix4() },
    uWaterLevel: { value: 0 },
    uUnderwater: { value: 0 },
    uIntensity: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform sampler2D tAo;
    uniform sampler2D tDepth;
    uniform mat4 uProjectionInverse;
    uniform mat4 uCameraWorld;
    uniform float uWaterLevel;
    uniform float uUnderwater;
    uniform float uIntensity;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tColor, vUv);
      float depth = texture2D(tDepth, vUv).x;
      float ao = texture2D(tAo, vUv).r;
      // Where is this pixel's surface? Above the sea it is what the eye
      // sees; below it, it is hidden by water that wrote no depth.
      vec4 view = uProjectionInverse * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec3 world = (uCameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;
      float above = max(smoothstep(uWaterLevel - 0.6, uWaterLevel + 0.4, world.y), uUnderwater);
      above *= step(depth, 0.99999);
      gl_FragColor = vec4(color.rgb * mix(1.0, ao, above * uIntensity), color.a);
    }
  `,
};

export class AmbientOcclusionPass extends Pass {
  /** The scene's depth for this frame (set by the pipeline before each render). */
  depth: THREE.Texture | null = null;
  /** 1 while the camera is under the water (everything is then occluded as seen). */
  underwater = 0;
  private readonly gtao: GTAOPass;
  private readonly material = new THREE.ShaderMaterial({
    ...CompositeShader,
    uniforms: THREE.UniformsUtils.clone(CompositeShader.uniforms),
    depthTest: false,
    depthWrite: false,
  });
  private readonly quad = new FullScreenQuad(this.material);
  private boundDepth: THREE.Texture | null = null;

  constructor(
    scene: THREE.Scene,
    private camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    super();
    this.gtao = new GTAOPass(scene, camera, width, height);
    this.gtao.output = GTAOPass.OUTPUT.Off;
    // Contact shadows a hand's breadth to an arm's length: under the boom,
    // round the cockpit, in the angles of the hut, where the sand meets a rock.
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16, distanceFallOff: 0.6, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 });
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.gtao.camera = camera;
  }

  override setSize(width: number, height: number): void {
    this.gtao.setSize(width, height);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const uniforms = this.material.uniforms;
    if (this.depth) {
      if (this.depth !== this.boundDepth) {
        // Normals are rebuilt from the depth (no separate normal pass).
        this.gtao.setGBuffer(this.depth as THREE.DepthTexture);
        this.boundDepth = this.depth;
      }
      this.gtao.render(renderer, writeBuffer, readBuffer, 0, false);
      uniforms.tAo!.value = this.gtao.gtaoMap;
      uniforms.uIntensity!.value = 1;
    } else {
      uniforms.uIntensity!.value = 0;
    }
    uniforms.tColor!.value = readBuffer.texture;
    uniforms.tDepth!.value = this.depth;
    const camera = this.camera as THREE.PerspectiveCamera;
    (uniforms.uProjectionInverse!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (uniforms.uCameraWorld!.value as THREE.Matrix4).copy(camera.matrixWorld);
    uniforms.uUnderwater!.value = this.underwater;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.gtao.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
