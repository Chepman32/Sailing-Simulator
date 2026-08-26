# Sailing Simulator Pro: repository guide for coding agents

This file is the repository-level operating manual for automated coding agents and human contributors. It applies to every file below the repository root unless a more specific `AGENTS.md` is added in a subdirectory.

The application is an interactive, browser-based tropical sailing simulator. It is not a static landing page and it is not the legacy single-file HTML prototype. The current source of truth is the modular TypeScript simulator in `src/simulator`, rendered by a small React application and deployed as a Cloudflare Worker through ChatGPT Sites.

## 1. Product concept

Sailing Simulator Pro presents a responsive catamaran in a stylized but physically legible tropical sea. Its design goal is a convincing, immediately playable marine scene on desktop and mobile hardware rather than a naval-architecture-grade solver.

The experience should communicate the following at a glance:

- the catamaran is floating on, not above, the same waves the player sees;
- engine, throttle, rudder, sails, current heading, and apparent wind are distinct concepts;
- the two hulls create two wakes, while the engine creates a separate propeller wash;
- day and night are coherent environment states rather than unrelated color filters;
- islands are tropical land masses with shallow water and collision boundaries, not circular platforms;
- wildlife uses authored, licensed, rigged 3D models and moves forward with inertia;
- whales remain mostly submerged and expose an articulated fluke for a tail slap;
- mobile controls remain readable, reachable, and independent from camera gestures;
- sound is a layered simulation channel that unlocks from a trusted browser gesture.

Visual richness must not come at the expense of a stable frame rate. Medium mobile GPUs are an explicit target. Prefer perceptually useful detail over indiscriminate polygon count, texture resolution, draw calls, or particle count.

## 2. Non-negotiable architectural rules

1. Keep one `Simulator` owner, one `RenderLoop`, one fixed-step update, and one variable-rate render update.
2. Do not append alternate implementations to the end of another file or redefine global functions.
3. Do not reintroduce the old monolithic HTML simulator, an iframe wrapper, CDN-hosted Three.js scripts, or runtime code generation.
4. Put reusable simulation behavior in the appropriate system class. React owns interface state and sends explicit commands to the simulator; it does not own marine physics.
5. Keep the GPU ocean and CPU water sampler mathematically consistent. Physics, wake placement, wildlife contact, and rendering must describe the same water surface.
6. Use fixed-step physics for vessel forces and wake sampling. Use variable-rate updates for visual interpolation, cameras, audio automation, and HUD refresh.
7. Every listener, GPU resource, mixer, timer, and observer created by a system must be released in its `dispose()` path.
8. Prefer bounded pools and instancing for frequently created visuals. Do not allocate thousands of meshes or vectors every frame.
9. Required assets fail the loading phase clearly. Optional assets are omitted cleanly; never replace a failed detailed animal with a crude procedural primitive.
10. Preserve asset attribution and license information in `public/models/README.md` whenever models are added, replaced, or transformed.

## 3. Runtime and toolchain

| Layer | Current implementation | Notes |
| --- | --- | --- |
| UI | React 19.2.6 | Client component in `app/components/SailingSimulator.tsx` |
| Application surface | Next 16.2.6 conventions | Built through Vinext/Vite for the Sites runtime |
| Language | TypeScript 5.9, strict mode | Do not weaken compiler settings to hide an error |
| 3D renderer | Three.js 0.180 | WebGL renderer, local modules and local assets |
| Build | Vite 8 + Vinext 0.0.50 | Cloudflare-compatible output |
| Hosting | Cloudflare Worker via ChatGPT Sites | Configuration lives in `.openai/hosting.json` |
| Unit tests | Node test runner + `tsx` | `tests/unit/*.test.ts` |
| Rendered smoke test | Node test runner | `tests/rendered-html.test.mjs` |
| Minimum Node | 22.13.0 | Declared in `package.json` |

The repository is intentionally self-contained at runtime. Three.js and application code are bundled. Models and their textures are local GLB files under `public/models`.

## 4. Repository map

### Application shell

| Path | Responsibility |
| --- | --- |
| `app/page.tsx` | Top-level route; renders the simulator component |
| `app/layout.tsx` | Document metadata and root layout |
| `app/components/SailingSimulator.tsx` | Canvas lifecycle, responsive HUD, controls, settings, sound-unlock affordance, simulator bridge |
| `app/components/i18n.ts` | Thirty language definitions, system-language resolution, aliases, RTL helpers |
| `app/globals.css` | Full-screen layout, mobile breakpoints, safe areas, control sizing, UI states |
| `app/chatgpt-auth.ts` | Sites/ChatGPT runtime integration; do not remove without understanding the host contract |

### Simulator orchestration and core

| Path | Responsibility |
| --- | --- |
| `src/simulator/Simulator.ts` | Sole subsystem owner, initialization, state persistence, update ordering, snapshots, teardown |
| `src/simulator/state.ts` | Default simulator state and engine power transition logic |
| `src/simulator/types.ts` | Public simulator, snapshot, control, camera, lighting, and quality types |
| `src/simulator/math.ts` | Allocation-free scalar helpers |
| `src/simulator/core/RenderLoop.ts` | Visibility-aware requestAnimationFrame loop with 60 Hz fixed-step accumulator |
| `src/simulator/core/AssetManager.ts` | Manifest, parallel GLB loading, required/optional behavior, cloning, progress, disposal |
| `src/simulator/core/QualityManager.ts` | Low/medium/high settings, DPR, shadows, ocean tessellation, adaptive quality |

### Environment

| Path | Responsibility |
| --- | --- |
| `src/simulator/environment/OceanMath.ts` | CPU companion for shared Gerstner waves |
| `src/simulator/environment/OceanSystem.ts` | GPU-displaced ocean, material shading, transparency, sun/moon glints, vessel shadow |
| `src/simulator/environment/EnvironmentMath.ts` | Pure day/night state derivation |
| `src/simulator/environment/EnvironmentSystem.ts` | Sky, fog, exposure, sun, moon, stars, ambient/directional lighting |
| `src/simulator/environment/IslandSystem.ts` | Terrain, palms, seabed, bathymetry, collision, avoidance, shore direction |

### Vessel

| Path | Responsibility |
| --- | --- |
| `src/simulator/vessel/Vessel.ts` | Detailed yacht GLB normalization, materials, transform, nav lights, visual pose |
| `src/simulator/vessel/VesselPhysics.ts` | Propeller and sail forces, drag, rudder torque, buoyancy, heave, pitch, roll, island collision |
| `src/simulator/vessel/SailSystem.ts` | Sail material and wind/trim deformation |
| `src/simulator/vessel/WakeSystem.ts` | Twin hull tracks, prop wash, bow droplets, wildlife splash rings and foam patches |

### Wildlife

| Path | Responsibility |
| --- | --- |
| `src/simulator/wildlife/WildlifeSystem.ts` | Owns wildlife controllers and throttles animation mixers to approximately 30 Hz |
| `DolphinController.ts` | Dolphin group movement and gated breach state machine |
| `SharkController.ts` | Forward-only shark cruise behavior |
| `WhaleController.ts` | Submerged whale cruise, articulated fluke rise/strike, physical water-contact splash |
| `FishSchoolController.ts` | Local animated tropical fish group |
| `GullFlockController.ts` | Animated aerial flock behavior |
| `SwimmerDynamics.ts` | Shared bounded speed, acceleration, yaw-rate, pitch, bank, and vertical dynamics |
| `WildlifeState.ts` | Pure dolphin and whale states, durations, transitions, tail-slap pose |
| `WildlifeModel.ts` | GLB normalization, animation selection, asset validation, heading helpers |

### Input, camera, audio, and HUD

| Path | Responsibility |
| --- | --- |
| `src/simulator/input/InputController.ts` | Keyboard, gamepad, rudder/throttle setters, dead zones |
| `src/simulator/input/TouchControls.ts` | Camera-only pointer orbit, pinch zoom, double-tap recenter |
| `src/simulator/camera/CameraController.ts` | Chase, helm, orbit, drone framing; damping; FOV; water-floor guard |
| `src/simulator/audio/AudioSystem.ts` | Web Audio lifecycle, buses, engine synthesis, waves, wind, hull noise, splash cues |
| `src/simulator/ui/HudController.ts` | Snapshot throttling between simulator and React |

### Build, hosting, and tests

| Path | Responsibility |
| --- | --- |
| `scripts/build-verified.sh` | Canonical production build wrapper |
| `scripts/sites-env.sh` | Reproducible environment wrapper for lint/type/build commands |
| `scripts/install-ci.sh` | CI installation path |
| `build/sites-vite-plugin.ts` | Sites-specific Vite behavior |
| `worker/index.ts` | Cloudflare Worker entrypoint |
| `.openai/hosting.json` | Sites project configuration and deployment identity |
| `tests/unit/simulator.test.ts` | Environment, engine, wake, physics, wildlife, and stability invariants |
| `tests/unit/assets.test.ts` | GLB quality/rig/animation/weight constraints and island geometry constraint |
| `tests/unit/i18n.test.ts` | Language coverage, aliases, fallback, and preference semantics |
| `tests/rendered-html.test.mjs` | Built-route smoke test |

Generated folders such as `dist`, `.next`, `.sites-runtime`, and `node_modules` are not source. Never hand-edit or commit their generated contents unless the hosting tool explicitly owns a required metadata change.

## 5. Coordinate, scale, and model conventions

- World up is `+Y`.
- Simulation forward/bow is `+Z`.
- Simulation starboard/right is `+X`.
- Heading zero points along `+Z`; heading increases toward `+X`.
- Distances are treated as meters.
- Speeds in physics are meters per second. HUD knots use the factor `1.943844`.
- Rudder control state is normalized to `[-1, 1]`; the HUD maps that range to `[-35°, 35°]`.
- Throttle is continuous `[-1, 1]`: negative astern, zero neutral, positive ahead.
- Sail trim is clamped to `[0.2, 1]`.
- The imported yacht source points its bow toward `-Z`; `Vessel` rotates and scales it to the simulator convention.
- Imported wildlife forward axes differ by source. Normalize each model once in `WildlifeModel` or its visual setup; never compensate by letting an animal translate backward.

When introducing a model, document its native axis, units, expected bounding dimension, named nodes, animations, and any runtime rotation. Do not scatter unexplained `Math.PI` corrections through update code.

## 6. Initialization contract

`Simulator.init()` currently performs these stages in order:

1. construct and apply `QualityManager`;
2. load seven local GLB definitions through `AssetManager`;
3. create the GPU ocean;
4. create the unified environment and current light mode;
5. create islands and bathymetry;
6. create vessel physics;
7. create the yacht visual and sail system;
8. create wake, foam, and particle pools;
9. create wildlife controllers from loaded assets;
10. create and configure the camera;
11. attach keyboard/gamepad input;
12. attach canvas camera gestures;
13. install resize observation;
14. construct and start the render loop;
15. emit the first running snapshot.

`AudioSystem` is constructed earlier, in the `Simulator` constructor, so gesture listeners exist while assets are loading. This is intentional for iOS/WebKit, where a user may tap the loading screen before `init()` finishes.

Required asset failures move the simulator to an error state and surface a readable message. Optional wildlife failures log a warning and omit that animal.

## 7. Frame-order contract

The order of each simulation frame is an invariant.

### Fixed step: 1/60 second

1. advance shared ocean time and focus;
2. apply keyboard/gamepad input;
3. force throttle to neutral if the engine is stopped;
4. integrate vessel forces, collision, and buoyancy;
5. sample and advance wake, spray, splash decals, and droplets.

The loop clamps a long frame to 50 ms, caps the accumulator at five fixed steps, and performs no more than five catch-up steps. That prevents a backgrounded or stalled tab from creating a spiral of death.

### Variable-rate update

1. refresh ocean focus/uniforms;
2. animate palms;
3. interpolate yacht and sails;
4. update wildlife movement and animation mixers;
5. rebuild visible wake instances at a throttled rate;
6. update camera spring and FOV;
7. derive and apply environment state;
8. automate audio parameters;
9. publish HUD state on its own cadence;
10. render once.

Do not run physics from React renders, HUD timers, GLB animation clip events, or arbitrary pointer event frequency.

## 8. State ownership and persistence

`SimulatorState` owns:

- normalized rudder, throttle, and sail trim;
- camera mode;
- lighting mode;
- quality preset;
- master sound preference;
- engine running state for the current session;
- engine-only mute preference.

The persistence key is `sailing-simulator-pro-preferences-v2`. Persisted fields are lighting, camera, quality, master sound, and engine mute. Engine running and active throttle deliberately do not persist across a page load.

An explicit engine start clears a stale persisted engine-mute value, selects slow ahead when the throttle is near neutral, and persists the corrected mute preference. The user may mute the running engine again afterward. This prevents an old hidden setting from making the primary engine switch appear broken.

On coarse input devices the simulator starts at low quality. Saved high quality is not blindly restored on mobile. Treat this as a safety guard.

React receives immutable `SimulationSnapshot` values. A UI control must invoke a public `Simulator` method; it must not mutate physics objects, system internals, or a stale snapshot.

## 9. Ocean system

The ocean is a focused `1800 × 1800` meter grid. Vertex density is concentrated around the vessel so near-field waves receive more geometry without applying the same density at the horizon.

Four wave definitions in `OceanMath.ts` are the shared source for:

- GLSL Gerstner displacement;
- CPU height and normal sampling;
- ten yacht buoyancy points;
- wake and splash placement;
- wildlife surface contact;
- camera water-floor protection.

If a wave parameter changes, verify GPU and CPU calculations still use the same direction, amplitude, wavelength, speed, steepness, phase convention, and world coordinates.

The fragment shader combines:

- geometric wave normals;
- procedural micro-normal detail;
- Fresnel reflection;
- tropical shallow/deep transmission colors;
- broad low-cost color variation;
- caustic hints;
- sun or moon glints;
- a broken night moonlight path;
- crest foam;
- a local shadow below both hulls;
- distance/view-dependent alpha.

The ocean material is transparent, depth-tested, and does not write depth. Its render order is `2`. Any transparent terrain below it must be deliberately ordered before the ocean.

Never return to CPU-deforming the full ocean grid. CPU work should remain limited to the small number of water samples needed by physics and contact effects.

## 10. Vessel physics

`VesselPhysics` is a purpose-built force model, not a generic rigid-body engine.

Current major parameters:

- mass: `6200 kg`;
- yaw inertia: `112000` in simulator units;
- ten buoyancy points: bow, midship, and stern samples on both hulls;
- true wind vector: `(6.8, 0, 4.2) m/s`;
- stronger forward than reverse propeller force;
- twin visual propellers counter-rotate, reverse with astern throttle, accelerate smoothly, idle visibly above 220 RPM, and reach exactly 600 RPM at full throttle;
- quadratic forward drag;
- strong lateral drag to limit unrealistic side-slip;
- speed-dependent rudder effectiveness;
- sail force based on apparent wind, trim, no-go attenuation, and projected lift;
- shore avoidance before collision and hard water constraint at the beach boundary.

Buoyancy computes average surface height plus separate bow/stern and port/starboard averages. Heave uses a damped response to the moving water target. Pitch and roll align the yacht with the same sampled wave surface. Avoid directly setting yacht visual `y` from a different wave formula; that creates the appearance that the boat is hanging in the air.

Physics must remain finite. Any new force should be bounded, unit-tested, and stable at both 60 Hz and 120 Hz integration in the existing comparison test.

## 11. Yacht visual and sails

The primary yacht is `public/models/yacht-sailboat-pbr.glb`. It is a detailed optimized catamaran, not a procedural assembly. At runtime `Vessel` normalizes its dimensions and orientation, configures PBR materials, and adds simulator-owned effects such as navigation lights.

Rules for yacht work:

- preserve named or semantically discoverable hull, mast, sail, cockpit, and rigging nodes;
- keep opaque hull materials depth-writing and physically shaded;
- do not make the entire sail emissive to fake sunlight;
- sun core geometry must respect the depth buffer, including when it is behind a sail;
- deform sails smoothly from wind and trim; do not simply snap a flat triangle between sides;
- use the physics root for position, heading, pitch, and roll, with visual-only damping inside `Vessel`;
- keep propellers/rudders tied to engine/rudder state if the asset exposes suitable nodes;
- validate close camera framing after any scale, pivot, or bounding-box change.

## 12. Wake, footprint, foam, and splash

The wake is intentionally divided into separate effects:

1. two hull tracks, emitted from the port and starboard stern positions;
2. one central propeller wash, emitted whenever throttle magnitude exceeds the prop threshold;
3. bow droplets at higher forward speed;
4. reusable splash rings, foam patches, and ballistic droplets for wildlife impacts.

The current wake contract is:

- hull tracks begin above `0.06 m/s`;
- prop wash begins when absolute throttle is above `0.04`, even before the hull has accelerated;
- track history samples after approximately `0.28 m` of movement;
- a maximum time interval supplements distance sampling so stationary prop wash and very slow motion remain visible;
- slow or stationary maximum interval is `0.55 s`; moving interval is `0.22 s`;
- wake decals follow the current sampled ocean height plus a small surface offset;
- wake and splash materials are additive, untone-mapped, and rendered after the ocean;
- hull tracks live about 12 seconds; prop tracks about 8 seconds.

Distance remains the primary spacing rule. The time fallback exists only to make active prop wash and slow-ahead foam visible; do not replace the distance rule with frame-dependent spawning.

Wake visuals use bounded `InstancedMesh` capacity derived from quality at construction time. Splash droplets use a bounded `Points` pool. New effects must reuse these pools or introduce another bounded pool rather than allocating a mesh per frame.

A wildlife splash position must be an actual world-space water-contact position, not a hard-coded distance from the animal root.

## 13. Islands and bathymetry

Three island definitions provide center, beach radius, and elliptical Z scale. `IslandSystem.depthAt()` derives a shallow-water profile near each beach and deep-water variation elsewhere. The same definitions support soft avoidance, collision constraint, and direction back toward open water.

The rendered island uses irregular radial geometry and a short submerged apron. The outer apron fades with vertex alpha before its final edge. This prevents clear water from revealing a giant circular shelf that can be mistaken for a ring or a flat whale.

Island constraints:

- keep the visible terrain radius scale at or below the tested limit;
- keep the hard collision boundary approximately two meters outside the nominal beach radius;
- render the transparent terrain before the transparent ocean;
- do not add a wide opaque underwater disc;
- keep beach color warm muted yellow, not pure white or neon yellow;
- maintain a plausible transition from beach to shallow blue water;
- if bathymetry changes, update collision and HUD depth behavior together;
- avoid adding high-detail palm geometry to every distant island without LOD or instancing.

## 14. Unified day and night environment

`EnvironmentMath.deriveTimeOfDay()` produces a bounded state consumed by `EnvironmentSystem` and `OceanSystem`. One lighting mode drives sky, sun, moon, stars, fog, exposure, water colors, directional lights, ambient light, and navigation lights.

Night requirements:

- the scene remains readable rather than nearly black;
- moon elevation is 30 degrees (`π/6`) above the horizon;
- moon core is depth-tested;
- moon halo is soft and controlled;
- small stars use varied low intensity and glow, not large flat dots;
- moonlight creates a broken elongated reflection path on the water;
- yacht navigation lights activate with night factor;
- no stale dark sky sector may remain after repeated day/night switching.

Sun requirements:

- the solar core passes the depth test;
- a sail or mast can occlude it;
- halo and rays must not be unconditionally drawn over foreground geometry;
- avoid excessive sail transparency or emissive brightness that makes the sun appear through canvas.

Do not independently set `scene.background`, fog, sky dome, ocean night, and exposure from multiple event handlers. Environment ownership is centralized.

## 15. Wildlife assets and validation

The simulator loads external rigged GLBs for all visible living objects. There are no primitive-mesh animal fallbacks.

`isDetailedSwimAsset()` and controller-specific checks guard geometry, rigging, and animations. If an optional shark, whale, fish, or gull asset fails validation or loading, omit it. If the required dolphin fails, loading fails visibly.

General motion rules:

- translation is always along the model's normalized forward direction;
- speed remains positive;
- acceleration, deceleration, yaw rate, and yaw acceleration are bounded;
- target heading uses the shortest angular path but cannot instantaneously flip 180 degrees;
- bank derives from turn rate and remains small;
- pitch derives from bounded vertical speed and never rapidly inverts the body;
- depth follows a damped acceleration model rather than teleporting;
- waypoints last long enough to produce legible arcs;
- animation clips may accelerate with swim speed, but clip speed cannot replace actual translation;
- distant respawn preserves coherent orientation on the first visible frame.

### Dolphins

Dolphins normally cruise rapidly and smoothly. A breach can start only with sufficiently fast forward motion and an expired cooldown. The state sequence is:

`swim → approach → breach_ascent → airborne → reentry → splash → dive → swim`

Each phase has a finite duration, continuous position, continuous velocity, and timeout. Airborne motion must not pause. Orientation follows trajectory tangent without rolling upside down. Reentry creates foam, droplets, and sound.

### Sharks

Sharks cruise below the surface with positive speed, limited turn rate, gradual bank, and gentle depth corrections. Do not use the authored bite clip as a locomotion substitute. A shark may pass the yacht at a safe distance but must not reverse or pivot in place.

### Whales

Whales remain submerged. The normal behavior is a slow cruise followed by an articulated tail sequence:

`cruise → tail_rise → tail_strike → dive → cruise`

`WhaleController` owns exactly one whale. It follows a broad, inertial orbit around the yacht, remains between 50 and 100 horizontal meters away, and silently repositions below the surface if a fast yacht leaves that viewing band.

Only the fluke should clear the water. Keep the complete PBR mesh volumetric and place the torso deeply enough that it remains below every nearby wave. Because the tropical ocean is intentionally translucent, the whale material uses a short dithered alpha-hash fade against the locally sampled water plane: underwater fragments disappear smoothly while the raised fluke remains fully 3D. A hard material clipping plane is forbidden because its exposed slice reads as a flat dark silhouette. Tail joints `locator4`, `locator5`, and `locator6` receive weighted procedural flex on top of the authored swim clip.

Splash emission is armed only after the final tail joint is above local water and fires when that same joint crosses downward through the sampled surface during `tail_strike`. The impact generates multiple foam rings, patches, many droplets, and a stronger splash sound. Do not trigger a whale splash from an arbitrary elapsed-time threshold or a hard-coded offset behind the root.

## 16. Audio system

The current audio implementation is procedural Web Audio. There are no runtime audio downloads. The graph contains:

```text
Master → DynamicsCompressor → destination
  EngineBus → low/high engine oscillators + start cue
  EnvironmentBus → wave noise + wind noise + hull-water noise
  WildlifeBus → one-shot splash noise
```

The master sound setting and audio readiness are different states:

- `soundEnabled` is a saved user preference;
- `audioReady` means the browser `AudioContext` is actually running.

Browsers, especially iOS Safari and embedded web views, require a trusted gesture. The system therefore:

- installs capture listeners before asset loading;
- listens for pointer, touch, mouse, click, and keyboard gestures;
- supports `AudioContext` and `webkitAudioContext`;
- retries construction without options on older WebKit;
- releases a stuck resume lock after a short timeout;
- shows a prominent localized “Tap for sound” button while sound is enabled but context is not running;
- treats the entire sound-unlock capsule as one touch target and performs the complete enable/resume path on `pointerdown`, with `click` retained as the keyboard fallback;
- tracks `statechange`, visibility, page hide/show, and focus;
- suspends on a hidden page and waits for the next trusted gesture to resume.

Do not display “sound on” as if it proves playback. Use `audioReady` for the active state. Do not auto-create or resume an `AudioContext` from server code, module evaluation, a timer, or an untrusted promise continuation.

Engine mute controls only `EngineBus`. Master sound controls the master gain. Waves and wind must continue when the engine bus is muted.

While an audible engine is running, the engine bus is boosted and the environment bus is gently ducked. The engine combines two RPM-controlled oscillators, a band-limited mechanical-noise layer, and a one-shot start cue so it remains distinguishable on phone speakers.

When tuning audio, test on small phone speakers. Important engine fundamentals and environmental energy must not exist only below approximately 100 Hz. Keep total gain bounded through the compressor and avoid clipping.

## 17. Camera and gesture separation

Four camera modes are supported:

- `chase`: damped third-person follow with speed-sensitive FOV;
- `helm`: first-person position near the helm, limited look range, no zoom;
- `orbit`: freer inspection around the yacht;
- `drone`: elevated long-distance view.

Canvas gestures are camera-only:

- one pointer: orbit/look;
- two pointers: pinch zoom;
- double tap: recenter;
- wheel: zoom on desktop.

Rudder and throttle inputs are React controls outside the canvas. Their events must not leak into camera orbit. Maintain large touch targets and `touch-action` rules when modifying CSS.

The camera may not pass below the sampled water surface. Portrait devices receive increased follow distance so the yacht remains framed. Camera motion is damped; avoid hard teleports after ordinary mode input.

## 18. Interface, mobile behavior, and accessibility

The main settings panel is minimized by default on all devices, especially phones. Its collapsed form must still identify the controls and expose a large expand button. The persistent primary controls contain:

- a visible rudder wheel indicator;
- a horizontal rudder range input and explicit center button;
- a large engine on/off switch;
- a continuous vertical throttle range from reverse through neutral to forward.

UI requirements:

- use semantic `button`, `input`, `select`, headings, and labels;
- retain keyboard focus states;
- maintain at least roughly 44 × 44 CSS pixel touch targets;
- honor `env(safe-area-inset-*)` on iOS;
- avoid 8 px body text or clipped labels;
- keep the engine switch large enough to fill its card rather than resembling a tiny status dot;
- keep the rotated vertical throttle centered inside its fixed slot at every breakpoint; do not rely on the range input's overflowing layout box for placement;
- keep the rudder range explicitly styled as a large touch control: a thick visible track, a roughly 50 px thumb, and full-width track placement with its port/starboard labels above it on narrow screens;
- give the rudder track its own full-width row; do not constrain it to the narrow middle column between the wheel and centering button. On phone portrait, place the throttle above the rudder so the latter can span the control bar;
- show visible feedback when engine state changes;
- keep control panel and primary controls usable in portrait and landscape;
- prevent the settings drawer from permanently covering the yacht;
- preserve localized labels even when strings are longer than English;
- use compact line icons for dense settings buttons while preserving localized `aria-label` and `title` text, active-state contrast, keyboard focus, and 44 px touch targets;
- use `aria-pressed`, `aria-expanded`, `aria-controls`, and live regions where they communicate state.

The compact help prompt may disappear after successful interaction, but critical state such as engine running, throttle, speed, and rudder angle must remain observable.

## 19. Localization

`app/components/i18n.ts` contains thirty languages:

English, Chinese, Hindi, Spanish, French, Arabic, Bengali, Portuguese, Russian, Urdu, Indonesian, German, Japanese, Swahili, Marathi, Telugu, Turkish, Tamil, Vietnamese, Korean, Italian, Persian, Polish, Ukrainian, Dutch, Thai, Gujarati, Filipino, Malay, and Hebrew.

Startup resolution checks, in order:

1. a valid explicit preference stored under `sailing-simulator-language-v2`;
2. `navigator.languages`;
3. `navigator.language`;
4. `Intl.DateTimeFormat().resolvedOptions().locale`;
5. English fallback.

Locale tags are lowercased, underscores become hyphens, regional suffixes fall back to their base code, and aliases such as `iw → he`, `in → id`, and `tl → fil` are supported. System `languagechange` events continue to update the app only while no valid manual preference is saved.

Arabic, Persian, Hebrew, and Urdu set document direction to RTL. Adding a UI message requires adding it to the English shape and all thirty translations; tests enforce structural completeness.

## 20. Quality and performance

| Preset | Max DPR | Ocean segments | Shadow map | Foam density | Wildlife multiplier/count |
| --- | ---: | ---: | ---: | ---: | ---: |
| Low | 1.0 | 96 | 512 | 0.45 | 1 |
| Medium | 1.25 | 144 | 1024 | 0.70 | 2 |
| High | 1.75 | 224 | 2048 | 0.90 | 2 |

Coarse devices start low. Adaptive quality observes FPS windows, steps down quickly when slow, and requires a long stable period above 58 FPS before stepping up. Coarse devices never automatically step to high.

Important implementation caveats:

- changing ocean segments replaces and disposes geometry at runtime;
- shadows can change with quality;
- wake pool and wildlife counts are currently sized at construction and do not rebuild after a preset change;
- `reflectionSize` is reserved in settings but the custom ocean does not currently allocate a reflection render target;
- animation mixers are advanced at approximately 30 Hz while movement remains per-frame;
- wake instance transforms are refreshed at approximately 30 Hz;
- the render loop and Web Audio suspend when the document is hidden.

Before increasing visual cost, measure the current bottleneck. Favor shader detail, instancing, LOD, texture compression, smaller shadow casters, and bounded effects over more individual objects.

## 21. Local 3D asset manifest

The authoritative license text is `public/models/README.md`. Keep it synchronized with any asset replacement or modification.

| Runtime key | File | Approx. bytes | Approx. geometry | Required | Runtime role |
| --- | --- | ---: | ---: | --- | --- |
| `yacht` | `yacht-sailboat-pbr.glb` | 2,770,696 | 162,913 triangles, 26 meshes | Yes | Primary PBR catamaran |
| `palms` | `palm-trees-quaternius.glb` | 1,120,784 | 1,920 triangles, 5 variants | Yes | Tropical island grove with shader wind |
| `dolphin` | `dolphin-animated.glb` | 171,552 | 3,728 triangles, rigged | Yes | Swim and breach pod |
| `shark` | `shark-animated.glb` | 1,739,400 | 51,199 triangles, authored clips | No | Subsurface shark |
| `whale` | `blue-whale-rigged-pbr-v2.glb` | 1,422,856 | 38,784 triangles, rigged PBR | No | Submerged blue whale tail slap |
| `fishSchool` | `tropical-fish-school.glb` | 3,277,364 | 8,932 triangles, four species | No | Animated local fish school |
| `seagull` | `seagull-animated.glb` | 133,248 | 1,174 triangles, authored clips | No | Aerial flock |

Unused legacy files currently retained for provenance or possible comparison:

- `dolphin-animated-quaternius.glb`;
- `yacht-quaternius.glb`.

Do not silently switch the runtime manifest to these legacy low-detail assets.

### Asset acceptance checklist

For every new or replacement GLB:

1. verify license permits redistribution and adaptation;
2. add source URL, author, license, and transformations to `public/models/README.md`;
3. inspect byte size, triangle count, texture count, material count, rig, and clips;
4. confirm PBR textures use correct color spaces;
5. normalize pivot, forward axis, and scale exactly once;
6. test animated clone behavior with `SkeletonUtils.clone`;
7. ensure no source camera, light, floor, water plane, giant bounding proxy, or hidden collision mesh remains;
8. compress textures and geometry without destroying normals, tangents, skin weights, or morph targets;
9. add or update an asset test for minimum visual quality and maximum mobile weight;
10. update this manifest.

## 22. Testing requirements

Run all of these before committing a behavioral change:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

The Sites checkpoint performs its own production build and rendered smoke verification, but local failures should be fixed before deployment.

### Unit-test expectations by subsystem

- Ocean: finite height/normal samples over a large world range and CPU/GPU companion invariants.
- Environment: bounded day/night state, moon at 30 degrees, readable night exposure.
- Engine: start from neutral selects slow ahead, active throttle is preserved, stop returns neutral.
- Physics: engine produces forward motion, no NaN, comparable outcomes at 60/120 Hz, buoyancy follows sloped samples.
- Wake: low-speed hull wake, stationary prop wash, monotonic strength, reverse symmetry, stronger whale splash profile.
- Wildlife: complete dolphin/whale transitions, breach speed gate, forward-only dynamics, bounded acceleration/turn/pitch/bank.
- Assets: detailed whale rig/clip/PBR/triangle/byte limits, visible island radius constraint, future model budgets.
- Localization: exactly thirty language entries, complete message keys, locale aliases, manual preference precedence, RTL set.

Add a pure helper and a unit test when introducing a new numerical rule. Three.js scene integration can remain in a controller, but thresholds, state transitions, and bounded dynamics should be testable without WebGL.

### Manual acceptance scenarios

When visual/browser testing is requested or available, cover at least:

- initial load on desktop and phone;
- sound enabled but locked, then enabled with one tap;
- page background/foreground followed by audio recovery;
- engine start from neutral and immediate prop wash;
- slow-ahead twin hull wake;
- forward and reverse wake;
- day → night → day repeatedly;
- sun fully behind a sail;
- moon and moon path visible at night;
- island edge through transparent water;
- approach and collision with a beach;
- dolphin cruise, breach, reentry, and splash;
- shark long turn without reverse/upside-down motion;
- whale body submerged, fluke rise, physical strike, strong splash;
- all four camera modes, swipe, pinch, double-tap;
- portrait and landscape safe areas;
- RTL language layout;
- 20–30 minute soak for memory growth, NaN, context loss, or decreasing FPS.

Do not claim browser or visual acceptance if only unit/build checks were run.

## 23. Error handling and lifecycle

Expected failure modes include optional GLB failure, required GLB failure, WebGL context loss, interrupted Web Audio, blocked local storage, resize/orientation changes, backgrounding, and component unmount.

Rules:

- required asset failure must show the React error card;
- optional asset failure must omit the feature and retain the rest of the scene;
- WebGL context loss stops the loop and reports a recoverable status;
- context restoration restarts the loop;
- audio interruption changes `audioReady` and waits for a trusted gesture;
- local-storage failure must not block the current language or control session;
- `dispose()` must be safe after partial initialization;
- do not leave event handlers from an earlier simulator instance attached after hot reload or navigation.

## 24. Development workflow

### Install and run

```bash
npm ci
npm run dev
```

Use the URL printed by Vite/Vinext. The application is a modular React/Three.js build; there is no public standalone simulator HTML file.

### Before editing

1. inspect `git status --short`;
2. preserve unrelated user changes;
3. read the system file and its unit tests;
4. check `public/models/README.md` before changing an asset;
5. identify which system owns the state being changed.

### While editing

- use TypeScript types instead of unstructured global state;
- reuse scratch vectors in hot paths;
- avoid per-frame material, geometry, texture, array, or audio-node creation except bounded one-shots;
- add comments for coordinate transforms, browser lifecycle workarounds, and non-obvious rendering order only;
- keep thresholds named or tested;
- update tests and documentation in the same change.

### Before handing off

1. run unit tests, typecheck, lint, production build, and `git diff --check`;
2. inspect `git diff --stat` and the actual diff;
3. verify no generated output or downloaded source archive is staged accidentally;
4. deploy through the Sites checkpoint workflow when the user expects a published version;
5. commit and push to GitHub only when the user explicitly asks for it;
6. report exactly what was tested and whether the live deployment reached a terminal ready state.

## 25. Hosting and deployment

This project contains `.openai/hosting.json`, so ChatGPT Sites is the canonical deployment workflow.

Operational rules for agents:

- initialize an editing session with the Sites edit command before modifying a hosted project;
- use a Sites checkpoint to build, commit to the Sites origin, publish, and verify the hosted version;
- pass user approval only when the user has explicitly requested publishing;
- if the checkpoint is asynchronous, monitor that exact project/deployment until terminal status;
- after monitoring, query deployment status directly from the primary agent before claiming success;
- do not invent or change the requested public slug casually;
- a green local build is not the same as a ready deployment;
- a Sites checkpoint may create the repository commit that is later pushed to GitHub.

The public site is currently expected at:

`https://enhanced-sailing-simulator-pro.anton-chepur.chatgpt.site`

If the deployment is unavailable, inspect the exact Sites project and deployment status. Do not substitute another random URL without user direction.

## 26. Git and remote policy

This working tree can have two remotes:

- `origin`: Sites-managed repository/deployment remote;
- `github`: `https://github.com/Chepman32/Sailing-Simulator.git`.

Before pushing GitHub:

1. fetch `github main`;
2. inspect the commit graph and merge base;
3. preserve commits that exist only on GitHub;
4. reconcile with a normal fast-forward, merge, or safe rebase as appropriate;
5. never force-push unless the user explicitly requests history replacement and the risk has been reviewed;
6. push the tested deployment commit to `github main`;
7. report the resulting commit hash.

Do not commit every exploratory change. The standing project preference is to publish each completed version when requested/authorized, but commit and push GitHub only when the user explicitly asks.

## 27. Subsystem change checklists

### Changing water

- update shared wave definitions rather than duplicating formulas;
- compare CPU samples with visual displacement;
- check buoyancy, camera floor, wake height, and wildlife contact;
- test day/night colors and transparent shallows;
- inspect island aprons and seabed through the water;
- measure mobile FPS before increasing ocean segments or fragment-shader work.

### Changing physics

- keep forces in fixed update;
- bound every new acceleration or torque;
- preserve slow-ahead engine movement;
- verify reverse behavior;
- test NaN recovery and 60/120 Hz similarity;
- check collision and automatic return to open water;
- update telemetry only after integration.

### Changing wake or particles

- preserve two hull sources and independent prop source;
- sample primarily by distance;
- show prop wash while engine throttle is active at rest;
- place visuals on sampled water;
- keep materials visible in day and night;
- keep pool sizes bounded by quality;
- verify reset clears all arrays, counts, timers, and particle flags.

### Changing wildlife

- use a licensed rigged GLB;
- normalize the forward axis;
- preserve positive forward speed;
- use bounded turn/vertical dynamics;
- avoid random new targets every frame;
- keep state transitions finite;
- derive splash from physical contact;
- prevent opaque underwater silhouettes;
- test the relevant pure helpers and asset constraints.

### Changing audio

- retain trusted-gesture flow;
- test locked, running, suspended, interrupted, and closed context states;
- preserve WebKit fallback and retry timeout;
- update `audioReady` UI, not just saved preference;
- keep engine mute independent from ambient sound;
- tune for phone speakers and compressor headroom;
- remove every new listener on dispose.

### Changing UI or localization

- keep panel minimized by default;
- retain persistent engine/rudder/throttle access;
- test phone portrait and landscape safe areas;
- keep touch targets large;
- add message keys to all thirty languages;
- test locale aliases and RTL;
- ensure canvas camera gestures do not receive control-panel drags;
- preserve semantic states and keyboard accessibility.

### Replacing a model

- verify license before download or inclusion;
- remove unwanted embedded floors, lights, cameras, and water;
- record adaptation details and attribution;
- optimize to a measured mobile budget;
- validate animation names, rig, textures, and clone behavior;
- add asset tests;
- check bounding box, pivot, forward axis, and in-scene scale;
- check close, far, and phone camera views.

## 28. Known limitations and deliberate technical debt

The following are known constraints, not invitations to bypass the architecture:

- audio is synthesized rather than based on recorded engine/wave stems;
- the yacht force model is intentionally lightweight and not a full six-degree-of-freedom naval solver;
- the custom ocean has no planar reflection render target despite a reserved `reflectionSize` setting;
- wake and wildlife capacities do not rebuild when changing quality after initialization;
- palms use one GLB grove plus runtime vertex wind rather than full LOD/impostor vegetation;
- yacht sail deformation is simplified compared with cloth simulation;
- camera collision guards water but does not perform general mesh collision with mast/islands;
- asset loading is parallel but does not yet use Draco, Meshopt, or KTX2 decoders;
- browser-level Playwright visual regression and long soak automation are not yet part of `npm test`.

Address these incrementally inside the owning system. Do not solve them by placing another script layer around the simulator.

## 29. Regression guardrails

Never knowingly ship any of these regressions:

- sound preference says on while there is no clear way to unlock audio;
- engine switch changes visually but leaves throttle neutral and yacht motionless;
- wake is absent at slow ahead or prop wash is absent immediately after throttle engagement;
- wake becomes one giant painted ribbon or a frame-rate-dependent trail;
- yacht heave uses a different surface than the rendered ocean;
- island geometry exposes a large circular underwater edge;
- sun or moon renders through the opaque sail;
- part of the sky stays dark after returning to day;
- night is unreadably black or moon is missing from the 30-degree elevation;
- dolphins or sharks translate backward, flip upside down, pivot instantly, or freeze in place;
- a whale fully breaches, becomes a flat dark blob, or splashes without its fluke contacting water;
- procedural primitive animals replace failed GLBs;
- mobile settings open over the scene by default;
- engine switch, rudder, wheel indicator, or throttle disappears at a phone breakpoint;
- a manually selected language is overwritten by system auto-detection;
- a new translated string exists in only some languages;
- low FPS causes unlimited fixed-step catch-up or unbounded allocations;
- hidden tabs continue rendering and consuming audio resources;
- a change passes local TypeScript while production Sites build is broken.

## 30. Definition of done

A simulator change is complete only when:

- it is implemented in the correct owning module;
- old conflicting behavior has been removed rather than shadowed;
- state transitions are explicit and bounded;
- related resources dispose cleanly;
- relevant unit/asset/i18n tests are added or updated;
- `npm test`, typecheck, lint, production build, and diff whitespace checks pass;
- documentation and model licenses remain accurate;
- mobile performance and controls have been considered;
- the authorized Sites checkpoint reaches ready status when publication is requested;
- the exact tested commit is pushed to GitHub when, and only when, the user asks.

When uncertain, prefer a smaller coherent system change with an invariant and test over another isolated visual patch.
