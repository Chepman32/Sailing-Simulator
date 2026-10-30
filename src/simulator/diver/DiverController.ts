import * as THREE from "three";
import { clamp, smoothstep } from "../math";
import type { DeckField } from "./DeckField";
import {
  breathPeriod,
  createSwimState,
  createWalkState,
  DIVE_DEPTH,
  EYE_HEIGHT,
  GRAVITY,
  hop,
  hullDistance,
  JUMP_SPEED,
  plunge,
  plunge as plunge_,
  refillAir,
  RUN_SPEED,
  RUN_STRIDE,
  STEP_UP,
  stepSwim,
  stepWalk,
  SURFACE_EYE,
  SWIM_START,
  WADE_START,
  wadingDepth,
  WALK_SPEED,
  WALK_STRIDE,
  type DiverMode,
  type GroundWorld,
  type SwimInput,
  type SwimState,
  type SwimWorld,
  type WalkInput,
  type WalkState,
} from "./DiverMath";
import { LEAP_SECONDS, leapVelocity } from "./LeapMath";

/** What the player could do right here with the interact key. */
export type DiverPrompt = "helm" | "board" | "pickup" | "trade" | null;

/** Keys the diver listens to (the sailing keys are off while he is out of the helm). */
const KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Space", "ShiftLeft", "ShiftRight", "KeyC", "ControlLeft", "ControlRight", "KeyQ", "KeyE", "KeyF",
]);

/** The yacht's hulls seen from the side, for the swimmer to keep off (vessel space, m). */
export type HullShape = { offsetX: number; centreZ: number; halfLength: number; halfBeam: number; draught: number; freeboard: number };

export type DiverHooks = {
  /** He hit the water at `position` (m) with `speed` (m/s, downward). */
  splash: (position: THREE.Vector3, speed: number) => void;
  /** A breath out under water: bubbles from the regulator at `position`. */
  exhale: (position: THREE.Vector3, depth: number) => void;
  /** A breath in under water (the regulator's hiss). */
  inhale: (depth: number) => void;
  /** A footstep on deck. */
  footstep: (running: boolean) => void;
  /** A stroke at the surface. */
  stroke: (position: THREE.Vector3) => void;
  /** The mode changed (helm, leap, deck, swim, land). */
  modeChanged: (mode: DiverMode) => void;
  /** A step through shallow water at `position` (a slosh rather than a footfall). */
  wade?: (position: THREE.Vector3) => void;
};

/** The skipper's body during the leap over the side, written by the simulator each frame. */
export type LeapView = {
  /** Eyes and feet in the world. */
  eye: THREE.Vector3;
  feet: THREE.Vector3;
  /** Heading of his view relative to the yacht's (rad) and its pitch (up +). */
  yaw: number;
  pitch: number;
};

/** Mouse and touch look sensitivity, radians per pixel. */
const MOUSE_LOOK = 0.0022;
const TOUCH_LOOK = 0.0048;

/**
 * The skipper in the first person: off the helm, on deck, in the water.
 *
 * On deck he lives in the yacht's frame (she can roll and turn under him and
 * he goes with her); in the water he lives in the world (`stepSwim`). The
 * camera is his eyes.
 */
export class DiverController {
  mode: DiverMode = "helm";
  /** View yaw: relative to the yacht on deck, in the world in the water. */
  yaw = 0;
  pitch = 0;
  /** Feet in the yacht's frame, and the vertical speed there (on deck). */
  private readonly feet = new THREE.Vector3();
  private feetVy = 0;
  private readonly deckVelocity = new THREE.Vector3();
  private grounded = true;
  private stepClock = 0;
  readonly swim: SwimState = createSwimState(0, 0, 0);
  private air = 1;
  private readonly keys = new Set<string>();
  /** Touch joystick and buttons (−1…1). */
  private stickX = 0;
  private stickY = 0;
  private holdUp = false;
  private holdDown = false;
  private sprintHeld = false;
  /** Diving gear bought from the traders: fins (× swimming speed) and tank (× air). */
  readonly gear = { swim: 1, air: 1 };
  /** Torch on (toggled by the player; nights switch it on by itself once). */
  torch = false;
  private readonly eye = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly normal = { x: 0, z: 0 };
  private readonly swimInput: SwimInput = { moveX: 0, moveY: 0, vertical: 0, sprint: false, yaw: 0, pitch: 0 };
  private bobClock = 0;
  private landing = 0;
  /** Seconds into the leap over the side (counted on into the water until control returns). */
  leapTime = 0;
  /** The jump key went down (consumed by the next step ashore). */
  private jumpRequested = false;
  /** On his feet ashore (world frame). */
  readonly walk: WalkState = createWalkState(0, 0, 0);
  private readonly walkInput: WalkInput = { moveX: 0, moveY: 0, sprint: false, yaw: 0, jump: false };
  /** His body as the simulator poses it during the leap. */
  readonly leapView: LeapView = { eye: new THREE.Vector3(), feet: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private leapSplashed = false;
  /** Eyes lagging behind a sudden change of height (standing up out of the water, slipping in), m. */
  private eyeLag = 0;
  private readonly leapScratch = { x: 0, y: 0, z: 0 };
  private lastBreath = 0;
  private exhaled = false;
  /** Depth of the camera under the water surface (m; negative above it). */
  cameraDepth = -10;
  prompt: DiverPrompt = null;
  /** Seconds since entering the current mode. */
  modeTime = 0;
  /** True while a pointer lock is held on the canvas. */
  pointerLocked = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: SwimWorld,
    private readonly hull: HullShape,
    private readonly hooks: DiverHooks,
    private readonly land: GroundWorld = { ground: (x, z) => -world.seabedDepth(x, z), surface: world.surface },
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.releasePointer();
  }

  get active(): boolean {
    return this.mode !== "helm";
  }

  get airLeft(): number {
    return this.mode === "swim" ? this.swim.air : this.air;
  }

  /** Control is the player's (not during the leap and the plunge that ends it). */
  get inControl(): boolean {
    return this.mode !== "leap" && !(this.mode === "swim" && this.leapTime > 0 && this.leapTime < LEAP_SECONDS);
  }

  /** Water round a wader's legs, m (0 on dry land or when not ashore). */
  get wading(): number {
    return this.mode === "land" ? wadingDepth(this.walk.x, this.walk.z, this.land) : 0;
  }

  /** Eyes under the surface (m), when swimming. */
  get depth(): number {
    return this.mode === "swim" ? Math.max(0, this.world.surface(this.swim.x, this.swim.z) - this.swim.y) : 0;
  }

  /** Steps away from the wheel onto the deck beside it. */
  leaveHelm(standing: THREE.Vector3, helmYaw: number): void {
    if (this.mode !== "helm") return;
    this.feet.copy(standing);
    this.feetVy = 0;
    this.deckVelocity.set(0, 0, 0);
    this.grounded = true;
    this.yaw = helmYaw;
    this.pitch = 0;
    this.setMode("deck");
  }

  /**
   * Lets go of the wheel and goes over the side: a short first-person script
   * (`LeapMath`), then he is in the water and the player has him.
   */
  startLeap(): void {
    if (this.mode !== "helm") return;
    this.keys.clear();
    this.leapTime = 0;
    this.leapSplashed = false;
    this.yaw = 0;
    this.pitch = 0;
    this.setMode("leap");
  }

  /** Back at the wheel. */
  takeHelm(): void {
    if (this.mode === "helm") return;
    this.releasePointer();
    this.keys.clear();
    this.leapTime = 0;
    this.setMode("helm");
  }

  /** Climbs aboard onto `standing` (vessel space), facing forward; `heading` is hers. */
  board(standing: THREE.Vector3, heading: number): void {
    this.air = this.swim.air;
    this.yaw = Math.atan2(Math.sin(this.yaw - heading), Math.cos(this.yaw - heading));
    this.feet.copy(standing);
    this.feetVy = 0;
    this.deckVelocity.set(0, 0, 0);
    this.grounded = true;
    this.setMode("deck");
  }

  private setMode(mode: DiverMode): void {
    this.mode = mode;
    this.modeTime = 0;
    this.hooks.modeChanged(mode);
  }

  /** Touch joystick (−1…1, up is forward). */
  setStick(x: number, y: number): void {
    this.stickX = clamp(x, -1, 1);
    this.stickY = clamp(y, -1, 1);
  }

  setHold(up: boolean, down: boolean): void {
    this.holdUp = up;
    this.holdDown = down;
  }

  setSprint(on: boolean): void {
    this.sprintHeld = on;
  }

  /** A jump (the jump key or the touch button): on deck, ashore, or a kick up out of the water at the surface. */
  jump(): void {
    if (!this.inControl) return;
    if (this.mode === "deck" && this.grounded) {
      this.feetVy = JUMP_SPEED;
      this.grounded = false;
    } else if (this.mode === "land") {
      this.jumpRequested = true;
    } else if (this.mode === "swim" && hop(this.swim, this.world)) {
    }
  }

  /** Look by a drag of the canvas (touch, or a mouse without pointer lock). */
  look(deltaX: number, deltaY: number, touch = true): void {
    if (!this.inControl) return;
    const k = touch ? TOUCH_LOOK : MOUSE_LOOK;
    this.yaw -= deltaX * k;
    this.pitch = clamp(this.pitch - deltaY * k, -1.45, 1.45);
  }

  requestPointer(): void {
    if (!this.active || this.pointerLocked || matchMedia("(pointer: coarse)").matches) return;
    try {
      const request = this.canvas.requestPointerLock?.() as unknown;
      if (request instanceof Promise) request.catch(() => undefined);
    } catch {
      // Not allowed here (an iframe without permission): drag to look instead.
    }
  }

  releasePointer(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private interactRequested = false;

  /** The interact key (E) or button was pressed: what it would do here (consumed). */
  consumeInteract(): DiverPrompt {
    const requested = this.interactRequested;
    this.interactRequested = false;
    return requested ? this.prompt : null;
  }

  /** The interact button (touch). */
  interact(): void {
    this.interactRequested = true;
  }

  private readonly onLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked || !this.active || !this.inControl || this.frozen) return;
    this.look(event.movementX, event.movementY, false);
  };

  /**
   * A dialog is open over his view (the trader's shop, the controls card):
   * the keys are the dialog's, and he stands still until it closes.
   */
  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
    if (!frozen) return;
    this.keys.clear();
    this.stickX = 0;
    this.stickY = 0;
    this.holdUp = false;
    this.holdDown = false;
    this.sprintHeld = false;
    this.interactRequested = false;
  }

  private frozen = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || this.frozen || !KEYS.has(event.code)) return;
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type !== "range") return;
    if (target instanceof HTMLTextAreaElement) return;
    this.keys.add(event.code);
    if (event.code === "Space" && !event.repeat) {
      // In the water Space is also held to rise; at the surface a press kicks him up.
      if (this.mode !== "swim" || this.depth < DIVE_DEPTH * 0.8) this.jump();
    }
    if (event.code === "KeyF" && !event.repeat) this.torch = !this.torch;
    if (event.code === "KeyE" && !event.repeat) this.interactRequested = true;
    if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  private moveInput(): { x: number; y: number; vertical: number; sprint: boolean } {
    if (!this.inControl) return { x: 0, y: 0, vertical: 0, sprint: false };
    const k = this.keys;
    const forward = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const right = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const up = (k.has("Space") || this.holdUp ? 1 : 0) - (k.has("KeyC") || k.has("ControlLeft") || k.has("ControlRight") || this.holdDown ? 1 : 0);
    const x = clamp(right + this.stickX, -1, 1);
    const y = clamp(forward + this.stickY, -1, 1);
    const sprint = k.has("ShiftLeft") || k.has("ShiftRight") || this.sprintHeld || Math.hypot(this.stickX, this.stickY) > 0.97;
    return { x, y, vertical: up, sprint };
  }

  /**
   * One frame. `root` is the yacht (its matrixWorld current), `velocity` her
   * velocity (m/s), `heading` her heading; `deck` the floor aboard.
   */
  update(delta: number, root: THREE.Object3D, velocity: THREE.Vector3, heading: number, deck: DeckField | null, helmSpot: THREE.Vector3): void {
    const dt = clamp(delta, 0, 0.05);
    this.modeTime += dt;
    if (this.leapTime > 0 || this.mode === "leap") this.leapTime += dt;
    if (this.leapTime >= LEAP_SECONDS + 0.5 && this.mode !== "leap") this.leapTime = 0;
    if (this.mode === "leap") this.updateLeap(velocity, heading);
    else if (this.mode === "deck" && deck) this.updateDeck(dt, root, velocity, heading, deck, helmSpot);
    else if (this.mode === "swim") this.updateSwim(dt, root, heading);
    else if (this.mode === "land") this.updateLand(dt);
    else this.prompt = null;
  }

  /**
   * In the air over the side: the simulator has posed his body (`leapView`).
   * His feet hitting the water make the splash; his eyes going under make
   * him a swimmer, carried down by the plunge.
   */
  private updateLeap(velocity: THREE.Vector3, heading: number): void {
    this.prompt = null;
    const view = this.leapView;
    const feetSurface = this.world.surface(view.feet.x, view.feet.z);
    const local = leapVelocity(this.leapTime, this.leapScratch);
    if (!this.leapSplashed && view.feet.y < feetSurface + 0.05 && local.y < 0) {
      this.leapSplashed = true;
      this.hooks.splash(this.scratch.set(view.feet.x, feetSurface, view.feet.z), -local.y + 1.2);
    }
    const eyeSurface = this.world.surface(view.eye.x, view.eye.z);
    if (view.eye.y > eyeSurface - 0.05 && this.leapTime < LEAP_SECONDS + 1.5) return;
    // Under: from here on he is in the water, in the world.
    const vx = velocity.x + Math.cos(heading) * local.x + Math.sin(heading) * local.z;
    const vz = velocity.z - Math.sin(heading) * local.x + Math.cos(heading) * local.z;
    const swim = this.swim;
    swim.x = view.eye.x;
    swim.z = view.eye.z;
    swim.y = Math.min(view.eye.y, eyeSurface - 0.05);
    swim.vx = vx * 0.35;
    swim.vz = vz * 0.35;
    swim.air = this.air;
    swim.splashed = 0;
    swim.breath = 0;
    swim.surface = Number.NaN;
    // In feet first at speed: about a metre under, then up again.
    plunge(swim, -local.y);
    this.yaw = heading + view.yaw;
    this.pitch = view.pitch;
    if (!this.leapSplashed) this.hooks.splash(this.scratch.set(swim.x, eyeSurface, swim.z), 4);
    this.leapSplashed = true;
    this.setMode("swim");
  }

  /** Ashore: walking, wading, jumping; into deeper water he swims. */
  private updateLand(dt: number): void {
    this.prompt = null;
    const input = this.moveInput();
    const walk = this.walk;
    const walkInput = this.walkInput;
    walkInput.moveX = input.x;
    walkInput.moveY = input.y;
    walkInput.sprint = input.sprint;
    walkInput.yaw = this.yaw;
    walkInput.jump = this.jumpRequested && this.inControl;
    this.jumpRequested = false;
    stepWalk(walk, walkInput, this.land, dt, this.normal);
    const water = wadingDepth(walk.x, walk.z, this.land);
    if (walk.landed > 0) {
      this.landing = Math.min(1, walk.landed * 0.12);
      if (water > 0.12) this.hooks.wade?.(this.scratch.set(walk.x, walk.y + water, walk.z));
      else this.hooks.footstep(true);
      walk.landed = 0;
    }
    const moving = Math.hypot(walk.vx, walk.vz);
    if (walk.grounded && moving > 0.3) {
      this.stepClock += (dt * moving) / (input.sprint ? RUN_STRIDE : WALK_STRIDE);
      if (this.stepClock >= 1) {
        this.stepClock -= 1;
        if (water > 0.12) this.hooks.wade?.(this.scratch.set(walk.x, walk.y + water, walk.z));
        else this.hooks.footstep(input.sprint);
      }
      this.bobClock += (dt * moving * Math.PI * 2) / (input.sprint ? RUN_STRIDE : WALK_STRIDE);
    }
    const surfaceAtFeet = this.world.surface(walk.x, walk.z);
    if (water > SWIM_START && (walk.grounded || walk.y + 0.4 < surfaceAtFeet)) {
      // Off the end of a pier or a rock into deep water: a splash, and under for a moment.
      const plunge = !walk.grounded && walk.vy < -2 ? -walk.vy : 0;
      if (plunge > 0) this.hooks.splash(this.scratch.set(walk.x, surfaceAtFeet, walk.z), plunge);
      // Out of his depth: he swims.
      const swim = this.swim;
      const surface = this.world.surface(walk.x, walk.z);
      this.eyeLag += walk.y + EYE_HEIGHT - (surface + SURFACE_EYE);
      swim.x = walk.x;
      swim.z = walk.z;
      swim.y = plunge > 0 ? surface - 0.05 : surface + SURFACE_EYE;
      swim.vx = walk.vx * 0.7;
      swim.vz = walk.vz * 0.7;
      swim.vy = 0;
      swim.ascending = false;
      swim.plunging = false;
      if (plunge > 0) {
        plunge_(swim, plunge);
        this.eyeLag = 0;
      }
      swim.airborne = false;
      swim.surface = Number.NaN;
      swim.air = this.air;
      this.hooks.wade?.(this.scratch.set(walk.x, surface, walk.z));
      this.setMode("swim");
    }
  }

  private updateDeck(dt: number, root: THREE.Object3D, velocity: THREE.Vector3, heading: number, deck: DeckField, helmSpot: THREE.Vector3): void {
    const input = this.moveInput();
    this.air = refillAir(this.air, dt);
    const speed = input.sprint ? RUN_SPEED : WALK_SPEED;
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    // Vessel frame: +Z forward, and +X to the left of a view along +Z.
    const wishX = sinYaw * input.y - cosYaw * input.x;
    const wishZ = cosYaw * input.y + sinYaw * input.x;
    const length = Math.max(1, Math.hypot(wishX, wishZ));
    const control = this.grounded ? 12 : 1.5;
    this.deckVelocity.x += ((wishX / length) * speed - this.deckVelocity.x) * (1 - Math.exp(-control * dt));
    this.deckVelocity.z += ((wishZ / length) * speed - this.deckVelocity.z) * (1 - Math.exp(-control * dt));

    // Swept in moves shorter than a stanchion is thick, each axis on its own,
    // so a wall stops one and he slides along it; his whole body (not a
    // point) is kept off walls, the mast and the rails, so the eyes never
    // come close enough to look through them.
    const travel = Math.hypot(this.deckVelocity.x, this.deckVelocity.z) * dt;
    const moves = Math.min(24, Math.max(1, Math.ceil(travel / 0.04)));
    for (let move = 0; move < moves; move += 1) {
      for (const axis of ["x", "z"] as const) {
        const step = (this.deckVelocity[axis] * dt) / moves;
        if (Math.abs(step) < 1e-6) continue;
        const nextX = axis === "x" ? this.feet.x + step : this.feet.x;
        const nextZ = axis === "z" ? this.feet.z + step : this.feet.z;
        if (deck.blocked(nextX, nextZ, this.feet.y, this.grounded ? STEP_UP : 0.15)) {
          this.deckVelocity[axis] = 0;
          continue;
        }
        this.feet.x = nextX;
        this.feet.z = nextZ;
      }
    }

    const floor = deck.footing(this.feet.x, this.feet.z, this.feet.y, this.grounded ? STEP_UP : 0.05);
    if (this.grounded && floor.found && floor.height >= this.feet.y - 0.35) {
      // Down a step or up one: the feet follow the floor.
      this.feet.y = floor.height;
      this.feetVy = 0;
    } else {
      this.grounded = false;
      this.feetVy -= GRAVITY * dt;
      this.feet.y += this.feetVy * dt;
      if (floor.found && this.feet.y <= floor.height && this.feetVy <= 0) {
        this.landing = Math.min(1, -this.feetVy * 0.12);
        this.feet.y = floor.height;
        this.feetVy = 0;
        this.grounded = true;
        this.hooks.footstep(true);
      }
    }

    // Footsteps.
    const moving = Math.hypot(this.deckVelocity.x, this.deckVelocity.z);
    if (this.grounded && moving > 0.3) {
      this.stepClock += (dt * moving) / (input.sprint ? RUN_STRIDE : WALK_STRIDE);
      if (this.stepClock >= 1) {
        this.stepClock -= 1;
        this.hooks.footstep(input.sprint);
      }
      this.bobClock += (dt * moving * Math.PI * 2) / (input.sprint ? RUN_STRIDE : WALK_STRIDE);
    }

    // Over the side: into the sea.
    this.scratch.copy(this.feet).applyMatrix4(root.matrixWorld);
    const surface = this.world.surface(this.scratch.x, this.scratch.z);
    if (!this.grounded && this.scratch.y < surface + 0.2) {
      const fall = Math.max(0, -this.feetVy);
      // World velocity: hers plus his own across her deck, turned by her heading.
      const vx = velocity.x + Math.cos(heading) * this.deckVelocity.x + Math.sin(heading) * this.deckVelocity.z;
      const vz = velocity.z - Math.sin(heading) * this.deckVelocity.x + Math.cos(heading) * this.deckVelocity.z;
      const swim = this.swim;
      swim.x = this.scratch.x;
      swim.z = this.scratch.z;
      // The plunge carries him under for a moment.
      swim.y = surface - 0.05;
      swim.vx = vx * 0.6;
      swim.vz = vz * 0.6;
      swim.vy = 0;
      swim.air = this.air;
      // The plunge carries him under; he comes back up by himself.
      plunge(swim, Math.max(2, fall));
      swim.airborne = false;
      swim.splashed = 0;
      swim.surface = Number.NaN;
      swim.breath = 0;
      this.yaw += heading;
      this.hooks.splash(this.scratch.set(swim.x, surface, swim.z), fall + 1);
      this.setMode("swim");
      this.prompt = null;
      return;
    }

    // The wheel is within reach.
    const dx = this.feet.x - helmSpot.x;
    const dz = this.feet.z - helmSpot.z;
    this.prompt = Math.hypot(dx, dz) < 1.1 && this.grounded ? "helm" : null;
  }

  private updateSwim(dt: number, root: THREE.Object3D, heading: number): void {
    const input = this.moveInput();
    const swim = this.swim;
    const swimInput = this.swimInput;
    swimInput.moveX = input.x;
    swimInput.moveY = input.y;
    swimInput.vertical = input.vertical;
    swimInput.sprint = input.sprint;
    swimInput.yaw = this.yaw;
    swimInput.pitch = this.pitch;
    swimInput.speedScale = this.gear.swim;
    swimInput.tankScale = this.gear.air;
    // While the script still runs the view settles from looking down at the water.
    if (!this.inControl) this.pitch += (-0.05 - this.pitch) * (1 - Math.exp(-2.2 * dt));
    const depth = stepSwim(swim, swimInput, this.world, dt);
    if (swim.splashed > 0) {
      this.hooks.splash(this.scratch.set(swim.x, this.world.surface(swim.x, swim.z), swim.z), swim.splashed * 0.6);
      swim.splashed = 0;
    }

    // Ground coming up under him: a beach, a sandbank. He stands and wades.
    // (The sea floor or the beach, not a pier's planks over his head.)
    const ground = -this.world.seabedDepth(swim.x, swim.z);
    const surfaceHere = this.world.surface(swim.x, swim.z);
    if (!swim.airborne && depth < 1.4 && surfaceHere - ground < WADE_START && this.inControl) {
      const walk = this.walk;
      walk.x = swim.x;
      walk.z = swim.z;
      walk.y = ground;
      walk.vx = swim.vx;
      walk.vz = swim.vz;
      walk.vy = 0;
      walk.grounded = true;
      walk.landed = 0;
      this.air = swim.air;
      this.eyeLag += swim.y - (ground + EYE_HEIGHT);
      this.hooks.wade?.(this.scratch.set(swim.x, surfaceHere, swim.z));
      this.setMode("land");
      this.prompt = null;
      return;
    }

    // Keep off the hulls.
    this.local.set(swim.x, swim.y, swim.z);
    root.worldToLocal(this.local);
    const hull = this.hull;
    if (this.local.y > -hull.draught - 0.6 && this.local.y < hull.freeboard + 0.5) {
      const clearance = hullDistance(this.local.x, this.local.z, hull.offsetX, hull.centreZ, hull.halfLength, hull.halfBeam, this.normal) - 0.35;
      if (clearance < 0) {
        this.local.x -= this.normal.x * clearance;
        this.local.z -= this.normal.z * clearance;
        root.localToWorld(this.local);
        swim.x = this.local.x;
        swim.z = this.local.z;
        // Lose the speed toward the hull (the normal turned into the world).
        const nx = Math.cos(heading) * this.normal.x + Math.sin(heading) * this.normal.z;
        const nz = -Math.sin(heading) * this.normal.x + Math.cos(heading) * this.normal.z;
        const inward = swim.vx * nx + swim.vz * nz;
        if (inward < 0) {
          swim.vx -= inward * nx;
          swim.vz -= inward * nz;
        }
        this.local.set(swim.x, swim.y, swim.z);
        root.worldToLocal(this.local);
      }
    }

    // Breathing under water: in through the regulator, out in a burst of bubbles.
    if (depth > DIVE_DEPTH) {
      const period = breathPeriod(input.sprint);
      const phase = (swim.breath % period) / period;
      if (phase < this.lastBreath) this.hooks.inhale(depth);
      if (phase > 0.42 && !this.exhaled) {
        this.exhaled = true;
        this.scratch.set(swim.x, swim.y - 0.06, swim.z);
        this.hooks.exhale(this.scratch, depth);
      }
      if (phase < 0.42) this.exhaled = false;
      this.lastBreath = phase;
    } else if (Math.hypot(swim.vx, swim.vz) > 0.4) {
      // The crawl at the surface: a stroke every second or so.
      this.stepClock += dt * 1.1;
      if (this.stepClock >= 1) {
        this.stepClock -= 1;
        this.hooks.stroke(this.scratch.set(swim.x, this.world.surface(swim.x, swim.z), swim.z));
      }
    }
    this.bobClock += dt;

    // At the stern: the swim platforms and ladder.
    const atStern =
      this.local.z < hull.centreZ - hull.halfLength + 1.6 &&
      this.local.z > hull.centreZ - hull.halfLength - 2.4 &&
      Math.abs(Math.abs(this.local.x) - hull.offsetX) < 1.4 &&
      depth < 1.2;
    this.prompt = atStern ? "board" : null;
  }

  /** The side of the stern he is at (−1 or 1), in her frame. */
  sternSide(root: THREE.Object3D): number {
    this.local.set(this.swim.x, this.swim.y, this.swim.z);
    root.worldToLocal(this.local);
    return this.local.x >= 0 ? 1 : -1;
  }

  /**
   * Puts the camera at his eyes. On deck the yacht's roll and pitch are felt
   * a little (his legs take most of it); in the water the view sways gently.
   */
  updateCamera(camera: THREE.PerspectiveCamera, root: THREE.Object3D, heading: number, roll: number, pitch: number, delta: number): void {
    // A sudden change of eye height (standing up out of the water) eases in.
    this.eyeLag *= Math.exp(-delta * 7);
    if (Math.abs(this.eyeLag) < 1e-3) this.eyeLag = 0;
    if (this.mode === "leap") {
      const view = this.leapView;
      // The steps out from behind the wheel to the edge: the head bobs with
      // each footfall and sways a little from foot to foot.
      const t = this.leapTime;
      const stepping = smoothstep(0.55, 0.75, t) * (1 - smoothstep(1.35, 1.6, t));
      camera.position.copy(view.eye);
      camera.position.y += Math.sin(t * 13) * 0.02 * stepping;
      camera.rotation.set(view.pitch - pitch * 0.25, heading + view.yaw + Math.PI, roll * 0.25 + Math.sin(t * 6.5) * 0.014 * stepping, "YXZ");
    } else if (this.mode === "land") {
      const walk = this.walk;
      const bob = Math.sin(this.bobClock) * 0.028 * (walk.grounded ? 1 : 0);
      this.landing = Math.max(0, this.landing - delta * 3);
      camera.position.set(walk.x, walk.y + EYE_HEIGHT + bob - this.landing * 0.12 + this.eyeLag, walk.z);
      camera.rotation.set(this.pitch, this.yaw + Math.PI, Math.sin(this.bobClock * 0.5) * 0.004, "YXZ");
    } else if (this.mode === "deck") {
      const bob = Math.sin(this.bobClock) * 0.025 * (this.grounded ? 1 : 0);
      this.landing = Math.max(0, this.landing - delta * 3);
      this.eye.copy(this.feet).applyMatrix4(root.matrixWorld);
      this.eye.y += EYE_HEIGHT + bob - this.landing * 0.12;
      camera.position.copy(this.eye);
      camera.rotation.set(this.pitch - pitch * 0.25, heading + this.yaw + Math.PI, roll * 0.25 + Math.sin(this.bobClock * 0.5) * 0.004, "YXZ");
    } else if (this.mode === "swim") {
      const swim = this.swim;
      const surface = this.world.surface(swim.x, swim.z);
      const under = smoothstep(0.0, 1.5, surface - swim.y);
      const sway = Math.sin(this.bobClock * 0.9) * 0.012 * under;
      camera.position.set(swim.x, swim.y + sway + this.eyeLag, swim.z);
      // Floating, the eyes never dip into the drawn surface (it would show
      // the sea from inside, neither from above nor from below).
      if (swim.airborne || (this.depth < DIVE_DEPTH * 0.5 && !swim.ascending && !swim.plunging)) {
        const line = (this.world.floatLine ?? this.world.surface)(swim.x, swim.z);
        camera.position.y = Math.max(camera.position.y, line + SURFACE_EYE * 0.6);
      }
      // At the surface the head rolls with the waves.
      const slopeX = this.world.surface(swim.x + 0.6, swim.z) - this.world.surface(swim.x - 0.6, swim.z);
      const rollWave = (1 - under) * clamp(slopeX * 0.5, -0.12, 0.12);
      camera.rotation.set(this.pitch, this.yaw + Math.PI, rollWave + Math.sin(this.bobClock * 0.6) * 0.01 * under, "YXZ");
    }
    camera.fov += ((this.mode === "swim" && this.cameraDepth > 0 ? 66 : 72) - camera.fov) * (1 - Math.exp(-4 * delta));
    camera.near = 0.04;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    this.cameraDepth = this.world.surface(camera.position.x, camera.position.z) - camera.position.y;
  }
}
