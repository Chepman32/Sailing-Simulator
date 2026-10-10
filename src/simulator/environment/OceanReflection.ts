import * as THREE from "three";

/**
 * Planar reflection of the world above the sea.
 *
 * The ocean already mirrors the analytic sky per pixel. What it could not
 * mirror is everything standing on the water: the yacht, her sail, the
 * islands and their palms, the birds. This renders those from a camera
 * mirrored in the mean sea level, at a fraction of the screen resolution,
 * into a texture the ocean shader samples and bends with its own ripples.
 *
 * An oblique near plane (Lengyel's method, as three's `Reflector` uses)
 * clips everything below the sea, so nothing under water appears in the
 * mirror and no shader needs a clipping-plane variant. The texture's alpha
 * marks where something was drawn; elsewhere the ocean keeps its sky.
 */

/** Mean sea level of the mirror; a little below zero so waterlines are kept. */
const MIRROR_HEIGHT = -0.05;
const CLIP_BIAS = 0.003;

export class OceanReflection {
  readonly target: THREE.WebGLRenderTarget;
  /** World position → reflection texture coordinates (projective). */
  readonly textureMatrix = new THREE.Matrix4();
  private readonly mirrorCamera = new THREE.PerspectiveCamera();
  private readonly normal = new THREE.Vector3(0, 1, 0);
  private readonly mirrorPoint = new THREE.Vector3(0, MIRROR_HEIGHT, 0);
  private readonly cameraPosition = new THREE.Vector3();
  private readonly rotation = new THREE.Matrix4();
  private readonly lookAt = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly target3 = new THREE.Vector3();
  private readonly plane = new THREE.Plane();
  private readonly clipPlane = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly clearColor = new THREE.Color();
  private readonly hiddenState: boolean[] = [];
  private enabled = true;

  constructor(private scale: number) {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.target.texture.name = "OceanReflection";
  }

  /** Whether the last `render` produced a usable mirror image. */
  get active(): boolean {
    return this.enabled;
  }

  setScale(scale: number, width: number, height: number): void {
    this.scale = scale;
    this.setSize(width, height);
  }

  /** Drawing-buffer size of the main view, in device pixels. */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * this.scale));
    const h = Math.max(1, Math.round(height * this.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
  }

  /**
   * Renders the mirrored scene. `hidden` objects (the ocean itself, things
   * under water, the sky the shader already reflects) are left out.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hidden: readonly THREE.Object3D[]): void {
    this.enabled = this.scale > 0;
    if (!this.enabled) return;
    camera.updateMatrixWorld();
    this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    this.view.subVectors(this.mirrorPoint, this.cameraPosition);
    // A camera under the sea sees no mirror from above.
    if (this.view.dot(this.normal) > 0) {
      this.enabled = false;
      return;
    }
    this.view.reflect(this.normal).negate().add(this.mirrorPoint);
    this.rotation.extractRotation(camera.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rotation).add(this.cameraPosition);
    this.target3.subVectors(this.mirrorPoint, this.lookAt).reflect(this.normal).negate().add(this.mirrorPoint);

    const mirror = this.mirrorCamera;
    mirror.position.copy(this.view);
    mirror.up.set(0, 1, 0).applyMatrix4(this.rotation).reflect(this.normal);
    mirror.lookAt(this.target3);
    mirror.near = camera.near;
    mirror.far = camera.far;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    // Oblique near plane on the mirror: clip everything below the sea.
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.mirrorPoint).applyMatrix4(mirror.matrixWorldInverse);
    this.clipPlane.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const projection = mirror.projectionMatrix.elements;
    this.q.set(
      (Math.sign(this.clipPlane.x) + projection[8]) / projection[0],
      (Math.sign(this.clipPlane.y) + projection[9]) / projection[5],
      -1,
      (1 + projection[10]) / projection[14],
    );
    this.clipPlane.multiplyScalar(2 / this.clipPlane.dot(this.q));
    projection[2] = this.clipPlane.x;
    projection[6] = this.clipPlane.y;
    projection[10] = this.clipPlane.z + 1 - CLIP_BIAS;
    projection[14] = this.clipPlane.w;
    mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();

    // Render without the shadow pass, the background or the hidden objects.
    const previousTarget = renderer.getRenderTarget();
    const previousShadowUpdate = renderer.shadowMap.autoUpdate;
    const previousBackground = scene.background;
    renderer.getClearColor(this.clearColor);
    const previousAlpha = renderer.getClearAlpha();
    hidden.forEach((object, index) => {
      this.hiddenState[index] = object.visible;
      object.visible = false;
    });
    renderer.shadowMap.autoUpdate = false;
    scene.background = null;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, mirror);

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.clearColor, previousAlpha);
    scene.background = previousBackground;
    renderer.shadowMap.autoUpdate = previousShadowUpdate;
    hidden.forEach((object, index) => {
      object.visible = this.hiddenState[index];
    });
  }

  dispose(): void {
    this.target.dispose();
  }
}
