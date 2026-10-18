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
- islands are tropical land masses with shallow water and collision boundaries, not circular platforms, an endless world with at least one cay or island in every 1.2 km cell, so land lies every one to two kilometres in any direction;
- large ships (container ships, tankers, bulk carriers, car carriers, cruise liners) pass in the distance or lie at anchor; they can be reached, their wakes rock the yacht, and they are heard and seen at night;
- wildlife uses authored, licensed, rigged 3D models and moves forward with inertia;
- whales stay hidden at depth most of the time; a surfacing is a rare event in which only the back, the blowhole and, when lobtailing, the peduncle and flukes clear the water; a full breach happens only far from the yacht, rarely, by a separate distant whale;
- dolphins leap only at real speed, in one continuous ballistic arc; sharks are mostly a dark shape below the surface;
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
| `app/components/SoundPrompt.tsx` | The “tap for sound” capsule and its dust animation into the corner sound button |
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
| `src/simulator/core/FramePacer.ts` | Pure frame-rate cap (60 fps, 30 fps unfocused) so 120/144 Hz displays do not double the GPU work |
| `src/simulator/core/RenderBudget.ts` | Pure pixel budget (`budgetPixelRatio`), GPU-time governor (`GpuGovernor`) that eases the render scale, and the frame-rate judge (`FpsJudge`) for the preset fallback |
| `src/simulator/core/GpuTimer.ts` | Asynchronous GPU frame timing through `EXT_disjoint_timer_query_webgl2`, where the browser has it |
| `src/simulator/core/AssetManager.ts` | Manifest, parallel GLB loading, required/optional behavior, cloning, progress, disposal |
| `src/simulator/core/QualityManager.ts` | Low/medium/high settings, DPR, shadows, ocean tessellation and shader detail, post-processing switches, adaptive quality |
| `src/simulator/core/PostProcessing.ts` | HDR scene target, bloom, lens finish, tone mapping; bypassed on the low preset |
| `src/simulator/core/ShaderPatch.ts` | Composable `onBeforeCompile` patches for built-in materials |
| `src/simulator/core/StaticBatching.ts` | Merges fixed parts that share a material into one mesh each; finds stacked copies of one shell |
| `src/simulator/core/SkinnedMerge.ts` | Merges the flat-coloured skinned parts of one rig into a single skinned mesh with vertex colours |
| `src/simulator/core/Subdivision.ts` | One step of Loop subdivision for a skinned, flat-coloured mesh: welded topology, crease rules, inherited colours, blended skin weights |

### Environment

| Path | Responsibility |
| --- | --- |
| `src/simulator/environment/OceanMath.ts` | Shared Gerstner spectrum, shading-only detail spectrum, CPU sampler of the displaced surface and of the water's motion at depth |
| `src/simulator/environment/SurfaceImpacts.ts` | Ring waves and slicks from impacts, as a pure function and its GLSL twin |
| `src/simulator/environment/OceanGrid.ts` | Pure builder for the camera-focused grid and its per-vertex cell size |
| `src/simulator/environment/OceanSystem.ts` | Ocean mesh, uniforms, whole-cell re-centring, quality changes |
| `src/simulator/environment/shaders/oceanShader.ts` | Ocean GLSL generated from the shared spectra and island definitions |
| `src/simulator/environment/shaders/skyShader.ts` | Analytic sky and clouds shared by the dome, the lighting capture, and ocean reflections |
| `src/simulator/environment/SkyUniforms.ts` | Uniform objects shared by reference between sky and ocean |
| `src/simulator/environment/EnvironmentMath.ts` | Pure day/night state derivation |
| `src/simulator/environment/EnvironmentPalette.ts` | Pure scene-linear colour palette for day, dusk, and night |
| `src/simulator/environment/WindMath.ts` | Pure, deterministic true-wind gusts and shifts |
| `src/simulator/environment/EnvironmentSystem.ts` | Sky dome, image-based lighting capture, fog, exposure, sun, moon, stars, directional light |
| `src/simulator/environment/IslandMath.ts` | Pure, seeded, endless (per-cell) island generator, bathymetry, coastline noise, terrain noise, exact nearest-coast search over the 3×3 cells, shader island slots |
| `src/simulator/environment/IslandSystem.ts` | Terrain (two LODs per island), palms merged per cluster, seabed following the yacht, draw distances, collision, shore direction |
| `src/simulator/environment/IslandSurface.ts` | Sand shading (grain, ripples, wet sand), swash on the beach, palm shadow map and trunk contact shading |
| `src/simulator/environment/SurfMath.ts` | Pure surf model (breaking crest, bore, swash, drying sand) and its GLSL twin, shared by ocean and sand; the island slot uniforms the shaders read |
| `src/simulator/environment/WeatherMath.ts` | Pure weather model: seven kinds (clear … hurricane) as presets, exponential easing, deterministic auto planner |
| `src/simulator/environment/LightningMath.ts` | Pure lightning: strikes hashed from time slots (kind, distance, leader and return strokes), their light, thunder delay, the branching channel |
| `src/simulator/environment/LightningSystem.ts` | Bolts as camera-facing HDR ribbons from a pool of three, the sky flash's direction and focus, strike events for the thunder |
| `src/simulator/environment/RainSystem.ts` | One instanced draw of rain streaks in a camera-following box; intensity selects a stratified subset of the seeds |
| `src/simulator/environment/OceanReflection.ts` | Planar mirror of the world above the sea (oblique near plane), sampled by the ocean shader |
| `src/simulator/environment/UnderwaterLight.ts` | Beer–Lambert absorption for everything below the surface |

### Vessel

| Path | Responsibility |
| --- | --- |
| `src/simulator/vessel/Vessel.ts` | Detailed yacht GLB normalization, part classification, boom pivot, appendages, nav lights, visual pose |
| `src/simulator/vessel/BoomDynamics.ts` | Pure boom swing on its sheet, gybe slam, mirrored pivot pose |
| `src/simulator/vessel/Appendages.ts` | Procedural saildrive legs, three-bladed propellers and spade rudders |
| `src/simulator/vessel/HelmStation.ts` | Starboard aft helm: pedestal, leather-rimmed wheel, instrument pod with chart plotter, speed/depth and wind displays (one canvas atlas), compass, engine lever, guard rail, seat, winch |
| `src/simulator/vessel/HelmInstruments.ts` | Pure helm numbers: chart projection and range, wind needle, engine revolutions, compass card, lever angle |
| `src/simulator/vessel/YachtShading.ts` | Antifouling, boot stripe, wet band, non-skid deck, sail seams and translucency |
| `src/simulator/vessel/ShoreGuard.ts` | Pure collision avoidance near islands and ships' hulls: look-ahead sweep of the hull, temporary helm override, hand-back |
| `src/simulator/vessel/ShoreContact.ts` | Pure hull-outline shore cushion and impulse contact (physical backstop behind the guard) |
| `src/simulator/vessel/VesselPhysics.ts` | Engines, sails, windage, hull and keel hydrodynamics, rudders, seakeeping, grounding |
| `src/simulator/vessel/SailAerodynamics.ts` | Pure sail lift/drag polar and automatic sheeting |
| `src/simulator/vessel/SailSystem.ts` | Sail material and wind/trim deformation |
| `src/simulator/vessel/WakeField.ts` | Top-down wake texture (foam, aerated slick, wave height) the ocean shader samples |
| `src/simulator/vessel/WakeSystem.ts` | Twin hull tracks, prop wash, bow droplets; wildlife splashes by contact kind: droplets, mist, crown sheets, rings, foam fields, fin trails, whale blows |

### Ships

| Path | Responsibility |
| --- | --- |
| `src/simulator/ships/ShipMath.ts` | Pure ship types, lane and anchorage planning, steering (shoal avoidance, give way to starboard), hull waterplane and contact, sound signals, Kelvin wake (CPU sampler and GLSL twin) |
| `src/simulator/ships/ShipGeometry.ts` | Procedural ships: lofted hull with raked stem, sheer and transom, paint bands, fittings, superstructure per type, night lights |
| `src/simulator/ships/ShipSystem.ts` | Owns the ships: placement and replacement, one mesh per ship, points of light at night, wake uniforms, yacht contact, horn events, sound sources |

### Wildlife

| Path | Responsibility |
| --- | --- |
| `src/simulator/wildlife/WildlifeSystem.ts` | Owns every animal and the shared `MarineWorld` (rendered surface, bathymetry, yacht, each other) |
| `WhaleBehavior.ts` | Pure whale state machine, depth keeping, tail-chain springs, lobtail planning, tail forward kinematics |
| `WhaleController.ts` | Whale rig (`createWhaleRig`): procedural fluke strokes and turn bends, flipper clip, tracked blowhole/back/fluke contact points |
| `WhaleBreach.ts` | Pure distant breach: rare scheduling, run-up from depth, ballistic flight with roll, splash, dive |
| `WhaleBreachController.ts` | Second whale rig for breaches, body contact points, splash and spray |
| `ShoreAvoidance.ts` | Shared look-ahead steering around shallows and the hard deep-water confinement for every swimmer |
| `DolphinBehavior.ts` | Pure pod modes, per-dolphin leap state machine, speed gates, ballistics, hull clearance |
| `DolphinController.ts` | Dolphin rig: procedural dorsoventral body wave, path-following arc, contact points |
| `SharkBehavior.ts` | Pure shark state machine: patrol, investigate, close pass, burst, retreat, deep swim, fin show |
| `SharkController.ts` | Shark rig: clip phase and weight from the behaviour, turn curvature, countershading, fin contact |
| `WaterContact.ts` | `MarineWorld`, `WaterEffects`, surface-crossing hysteresis, contact energy, deep-water steering |
| `BodyRig.ts` | Procedural bones in the animal frame, body points, clip filtering, animation LOD intervals |
| `ReefFishController.ts` | Instanced reef fish extracted from the school asset, vertex-shader swimming |
| `ReefFishMath.ts` | Pure boids schooling, depth band, flight from threats, tail-beat rules |
| `GullBehavior.ts` | Pure gull flight: soar, follow the yacht's wake, skim, dive, land, rest on the water, take off; coordinated banking, flap bouts, wing pose |
| `GullFlockController.ts` | The flock: the rig turned into the flight frame, merged, Loop-subdivided once, painted as herring gulls with feather detail in the shader; flap clip driven by the behaviour's phase, procedural shoulder/hand/tip stroke, glide "M" and folding |
| `SwimmerDynamics.ts` | Shared forward-only swimmer: turn radius, bounded rates, pitch steering and overshoot-free depth holding |
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
| `tests/unit/simulator.test.ts` | Environment, engine, wake, physics, and stability invariants |
| `tests/unit/wildlife.test.ts` | Shared surface, impacts, contact, whale/dolphin/shark behaviour runs against the real sea |
| `tests/unit/assets.test.ts` | GLB quality/rig/animation/weight constraints and island geometry constraint |
| `tests/unit/i18n.test.ts` | Language coverage, aliases, fallback, and preference semantics |
| `tests/unit/rendering.test.ts` | Static batching, shell detection, shared skeletons, exact skinned merging, distant fish meshes |
| `tests/unit/helm.test.ts` | Chart plotter orientation against the rendered view, range steps, needles, compass, lever |
| `tests/unit/world.test.ts` | Endless islands (every cell inhabited, no overlaps, land within 2 km), exact coast search, shader slots, ship lanes, steering, contact, Kelvin wake, horns, gull flight, loop subdivision |
| `tests/unit/rig-and-reef.test.ts` | Boom and gybe, underwater absorption, wet band, foil sections, reef-fish schooling |
| `tests/unit/shipguard.test.ts` | Hull clearance to the nearest ship; the yacht turns away from and leaves a ship's side by herself |
| `tests/unit/postprocessing.test.ts` | Bloom bright-pass and finish guarded against NaN and half-float overflow |
| `tests/unit/framepacer.test.ts`, `gestures.test.ts` | Frame cap and resynchronisation; double-tap recognition |
| `tests/rendered-html.test.mjs` | Built-route smoke test |

Generated folders such as `dist`, `.next`, `.sites-runtime`, and `node_modules` are not source. Never hand-edit or commit their generated contents unless the hosting tool explicitly owns a required metadata change.

## 5. Coordinate, scale, and model conventions

- World up is `+Y`.
- Simulation forward/bow is `+Z`.
- Simulation starboard/right is `+X`. Note that three.js is right-handed: a camera looking along `+Z` shows `+X` on the left of the screen. Anything drawn for the player (the chart plotter, the wind dial, the compass card, positional sound) must follow what the view shows, not the name; `HelmInstruments` and the thunder panning do, and `tests/unit/helm.test.ts` checks the chart against a projected camera.
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
6. create vessel physics and the ships (every ship type is built here, before the first frame);
7. create the yacht visual and sail system;
8. create wake, foam, and particle pools;
9. create wildlife controllers from loaded assets;
10. create and configure the camera;
11. attach keyboard/gamepad input;
12. attach canvas camera gestures;
13. install resize observation;
14. compile every shader program against the active render target (`prewarmShaders`);
15. construct and start the render loop;
16. emit the first running snapshot.

`AudioSystem` is constructed earlier, in the `Simulator` constructor, so gesture listeners exist while assets are loading. This is intentional for iOS/WebKit, where a user may tap the loading screen before `init()` finishes.

Required asset failures move the simulator to an error state and surface a readable message. Optional wildlife failures log a warning and omit that animal.

## 7. Frame-order contract

The order of each simulation frame is an invariant.

### Fixed step: 1/60 second

1. advance shared ocean time and focus;
2. apply keyboard/gamepad input;
3. force throttle to neutral if the engine is stopped;
4. step the ships (`ShipSystem.fixedUpdate`), so their wakes are current for buoyancy;
5. integrate vessel forces, collision, and buoyancy; then keep the yacht out of the ships' hulls;
6. sample and advance wake, spray, splash decals, and droplets.

The loop clamps a long frame to 50 ms, caps the accumulator at five fixed steps, and performs no more than five catch-up steps. That prevents a backgrounded or stalled tab from creating a spiral of death.

### Variable-rate update

1. refresh ocean focus/uniforms;
2. animate palms;
3. put the yacht between her last two fixed steps (`VesselPhysics.blendPose(alpha)`, undone by `restorePose` before the next step; heading is blended the short way round), so a fast yacht does not judder when frames and 60 Hz steps drift apart; interpolate sails and swing the boom; a gybe slam is passed to audio; place the ships on the swell;
4. update wildlife movement and animation mixers, and the reef-fish schools (which flee the hulls, dolphins and shark);
5. redraw the wake field at a throttled rate (about 30 Hz);
6. update camera spring and FOV;
7. derive and apply environment state, and refresh the lighting capture when the time of day has moved;
8. light the spray from the same palette and redraw the palm shadow map if the light has moved;
9. automate audio parameters;
10. publish HUD state on its own cadence;
11. render once through `PostProcessing`.

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

The persistence key is `sailing-simulator-pro-preferences-v2`. Persisted fields are lighting, camera, the quality preset the player picked by hand (`qualityChoice`; an automatic fallback is never saved, and the old `quality` field is ignored, because it used to keep every later visit on a preset reached in one slow moment), master sound, and engine mute. Engine running and active throttle deliberately do not persist across a page load.

An engine start selects slow ahead when the throttle is near neutral and never touches the engine-sound preference: engine power and engine sound are independent controls.

On coarse input devices the simulator starts at low quality. Saved high quality is not blindly restored on mobile. Treat this as a safety guard.

React receives immutable `SimulationSnapshot` values. A UI control must invoke a public `Simulator` method; it must not mutate physics objects, system internals, or a stale snapshot.

## 9. Ocean system

The ocean is a focused `3600 × 3600` meter grid built by `OceanGrid.ts`. Its centre is a uniform lattice (about 1.25 m cells on high, 1.7 m on low) and the cells grow smoothly toward the horizon. The mesh is re-centred on the yacht in whole inner cells, so the dense lattice is locked to the world and never slides across the waves. Every vertex stores the size of its largest neighbouring cell; the vertex shader fades a wave out wherever the local cells can no longer resolve it.

Eight wave definitions in `OceanMath.ts` (`OCEAN_WAVES`) are the shared source for:

- GLSL Gerstner displacement;
- the per-pixel analytic surface normal;
- CPU height and normal sampling;
- ten yacht buoyancy points;
- wake and splash placement;
- wildlife surface contact;
- camera water-floor protection.

The first six describe a moderate trade-wind sea aligned with the true wind. The last two (`storm: true`, 118 m and 76 m) are the storm swell: their amplitude factor is zero until the wave scale passes `STORM_SWELL_START` and full at `STORM_SWELL_FULL`, so fair weather is exactly the six-component sea, a storm runs about 6.5 m significant wave height and a hurricane about 10 m. The storm swell shoals away over the island shelves (`SurfMath.stormShoalAt` and its GLSL twin `stormShoalFactor`, from the nearest-island slots; the CPU sampler reads it through `setShoalField`), so a hurricane does not wash over the cays; the GLSL twins used by other materials (`OCEAN_SURFACE_HEIGHT_GLSL`) take it unshoaled. Its crests are kept out of the whitecap fold (`stormFold`, `maximumOceanFold(…, false)`): a long swell does not break, the wind sea on it does, and in a gale the foam is drawn out into streaks along the wind. Every displaced wavelength stays above 5 m.

The GPU moves each vertex sideways as well as up, so `sampleOcean` first inverts the horizontal Gerstner excursion (two fixed-point steps, `surfaceBasePoint`) and returns the height and normal of the surface actually drawn over the queried point; `OCEAN_SURFACE_HEIGHT_GLSL` does the same in shaders. With a `depth` argument it instead returns the vertical motion of the water that far down (each wave attenuated by e^(−k·depth)): heavy swimmers ride this, so a whale at ten metres is barely moved by the swell and one at the surface rides it fully.

`SurfaceImpacts.ts` adds up to eight ring-wave impacts (`OceanSystem.addImpact`): a group of crests spreading from each splash and a glassy slick behind it that damps the wind ripples, lasting up to about twenty seconds for a fluke slap. Like the detail spectrum they only shape the normal. If a wave parameter changes, verify GPU and CPU calculations still use the same direction, amplitude, wavelength, speed, steepness, phase convention, and world coordinates, and keep `maximumOceanSlope()` under the tested limit.

Passing ships add their wakes to the same surface (`ShipMath`, uniforms `uShipPose`/`uShipShape`, four slots): the vertex stage displaces it by the Kelvin waves' height wherever the grid can carry them, `OceanSystem.sample` adds the same height and slope (so a ship's wake really rocks the yacht and moves the camera floor), and the fragment stage shades their slope like the swell and draws their foam and slick through the yacht's wake path. The yacht's wet band (`OCEAN_SURFACE_HEIGHT_GLSL`) does not include ship wakes.

`OCEAN_DETAIL_WAVES` are shorter waves that only perturb the shading normal. They have no CPU companion on purpose: they are too small to move the yacht.

`shaders/oceanShader.ts` generates both stages from those tables, so there is exactly one copy of each number. The fragment stage:

- rebuilds the slope of all shared waves analytically per pixel, so normals are crisp regardless of tessellation;
- adds the detail spectrum and drifting capillary ripple layers, each faded against the pixel footprint, with the faded energy converted into specular roughness instead of being dropped. The ripple noise is stretched along the crest direction (across the mean wind, `RIPPLE_STRETCH`) and the ripple slope is steepened where it is already steep (heavy-tailed, like real wind ripples), so from above the sea shows short, crisp bright dashes of mirrored sky over dark navy rather than round speckles or silky bands;
- keeps the water body dark (deep water returns only a few percent of the light, so the mirrored sky is several times brighter than the body) and only moderately clear over deep water; the shallows stay clear;
- reflects the shared analytic sky (and, on high, its clouds) with Schlick Fresnel, and on medium/high a planar mirror of the yacht, islands and birds (`OceanReflection`) distorted by the swell and ripples;
- draws the sun and moon glitter path with a GGX lobe whose width follows the unresolved wave energy, a broad sheen around it, and HDR sparkles from individual facets that bloom;
- colours the water body from the island bathymetry: deep blue offshore, turquoise over the shelf, sand showing through at the beach; the shaders evaluate only the eight islands nearest the yacht (`ISLAND_SLOTS`, uniforms `uIslandShape`/`uIslandFrame`, refreshed every frame by `IslandSystem.update`), and only measure the irregular coast within 60 m of it;
- scatters sunlight forward through wave crests;
- breaks whitecaps on the steepest crests inside gusts;
- draws the surf from `SurfMath`: each wave steepens on the shelf (its face tilts the normal along the shore normal), breaks into a bore of white water and runs in; every wave has its own strength and run-up, and the timing drifts along the coast. The breaking line is ragged (the shore distance is jittered by noise away from the beach, where the swash must still meet the island's wet sand), and the white water is a cellular lace (`foamLace`, Worley F2 − F1: bubble strands around dark holes), nearly solid in the bore and opening into strands in the foam it leaves behind (`surfTrail`, shading only, no CPU twin), which thins out over the rest of the cycle;
- samples the wake field (`WakeField`): its wave height bends the normal, its aerated band pales the water and damps the ripples, and its foam is broken into lace at pixel scale; the yacht's white water behind the transoms fades over a few seconds and lingers as a lace of bubbles a boat length or two astern (`WakeSystem`);
- keeps a local contact shadow under both hulls;
- is clear looking down (about 58 % see-through at the nadir, closing toward grazing angles), so what swims below shows its own colour, already veiled by `UnderwaterLight`;
- fades into the sky's own horizon colour between `HORIZON_FADE_START` (640 m) and `HORIZON_FADE_END` (1250 m), so sea and sky meet without a seam and ships a kilometre off still sit on visible water.

All colours are scene-linear and the shader ends with the renderer's tone-mapping and colour-space chunks, so it renders identically with and without the HDR pipeline.

The ocean material is transparent, depth-tested, and does not write depth. Its render order is `2`. Any transparent terrain below it must be deliberately ordered before the ocean.

Never return to CPU-deforming the full ocean grid. CPU work should remain limited to the small number of water samples needed by physics and contact effects.

## 10. Vessel physics

`VesselPhysics` is a purpose-built force model, not a generic rigid-body engine. Surge, sway, and yaw are integrated from summed forces; heave, pitch, and roll are damped oscillators with the natural periods of a cruising catamaran. All tunable numbers are named constants at the top of the file.

Forces and moments, in the order they are computed each fixed step:

- **True wind** from `WindMath.sampleWind`: about 8 m/s toward `(6.8, 0, 4.2)`, with deterministic gusts, lulls, and slow shifts. It is a closed-form function of simulation time, so integration stays reproducible at any step size.
- **Sails** from `SailAerodynamics.solveSail`: the crew sheets the sail to the angle of attack the trim control asks for, limited by the tightest sheeting angle and by the shrouds. Lift and drag follow a real polar, so the yacht cannot sail closer than roughly 35° to the true wind, is fastest on a reach, and runs downwind as a drag device. "Sail trim" keeps its meaning: more trim, more power.
- **Windage** on hulls and rig, which makes a stopped yacht drift and lets the bow fall off the wind.
- **Engines**: the helm sets a shaft-speed target; the shafts spool up and down at finite rates. Thrust follows shaft speed squared and fades as the hull catches up with the propeller race. Bollard thrust is 15.6 kN ahead and 9.7 kN astern, for a top speed near 13 kn under power.
- **Hull resistance**, quadratic plus a small linear term, rising in shoal water.
- **Keels** as lifting foils: they resist leeway in proportion to boat speed, stall if overloaded, and cost induced drag. A slow yacht therefore slides sideways more than a fast one.
- **Rudders** with authority from water flow, including the propeller race, so a burst of throttle turns a nearly stopped yacht. They also act as fixed fins that damp yaw.
- **Seaway**: the slope of the water plane under the hulls surges and sways the yacht, so she slows climbing a wave and accelerates down its face.
- **Shoal water** adds drag through the keels but never pins the yacht.
- **Shore guard** (`ShoreGuard.updateShoreGuard`, before any force): the leading edge of the hulls is swept along the course, and along where the present swing takes the bow, over a look-ahead that grows with speed. If it meets water within `GUARD_MARGIN` of the coast, the guard takes the helm: it picks an escape heading to the side that clears soonest and keeps that side for the whole manoeuvre, steers for it with the real rudders and a propeller kick, sets a speed for the room left (backing off first when the bow is already at the beach), and eases the sheets under sail. It hands the helm back only when the course is clear, the yacht is heading out to sea and is far enough off; a helmsman who turns straight back is taken further out each time. `guard.output` is what the physics, wake and visuals use; the player's own controls are never changed, and the open control panel shows a status line while the guard holds the helm. The guard's clearance is the nearer of the island shore and the nearest ship's hull (`VesselPhysics.hullClearance`, set to `nearestHullClearance` over the ships, with the hull's outward normal), so a yacht approaching or lying against a big ship's side turns away by herself exactly as from a beach; `resolveContact` stays the physical wall behind it.
- **Shore contact** (`ShoreContact.resolveShoreContact`): ten points around the twin-hull outline are tested against the signed distance to the rendered waterline (`IslandMath.shoreClearance`). Within `SHORE_CUSHION` a soft push and torque start turning the bow away; on contact the deepest point takes a rigid-body impulse with restitution `SHORE_RESTITUTION`, a little friction and a turn kick toward the open tangent, so the yacht rebounds and changes course at once instead of sticking in the sand. A hard contact throws a slap splash at the bow. `IslandSystem.constrainToWater` keeps the hull centre at least 2.2 m off the coast as the final guard.

Sign conventions: positive pitch lowers the bow; positive roll lowers the starboard hull; `telemetry.apparentWindAngle` is the signed angle the wind comes *from* (0 = head to wind, positive = over the starboard side); `telemetry.leewardSide` is the side the sails fill toward. The yacht heels to leeward.

Buoyancy samples ten points and derives the water plane under the hulls. The water's own vertical acceleration under the hulls is passed to the heave (`HEAVE_FOLLOW`), so the yacht climbs and falls with a storm swell several metres high instead of lagging into it (tested in a hurricane sea). Heave, pitch, and roll are driven toward that plane plus the steady trim caused by sail, engine, and turning loads. Avoid directly setting yacht visual `y` from a different wave formula; that creates the appearance that the boat is hanging in the air.

Physics must remain finite. Any new force should be bounded, unit-tested, and stable at both 60 Hz and 120 Hz integration in the existing comparison test. The polar, top-speed, helm-sense, grounding, and seaway tests in `tests/unit/simulator.test.ts` are the acceptance criteria for retuning.

## 11. Yacht visual and sails

The primary yacht is `public/models/yacht-sailboat-pbr.glb`. It is a detailed optimized catamaran, not a procedural assembly. At runtime `Vessel` normalizes its dimensions and orientation, configures PBR materials, and adds simulator-owned effects such as navigation lights.

The source file's node names are generic, so `Vessel.classifyParts` finds the hulls, deck, mast, boom and sail by their shape and material. The boom and sail are re-parented to a pivot on the mast axis; `BoomDynamics` swings them to the angle the physics' sheeting chooses, on the side the sail fills from. On the other tack the pivot mirrors the rig across the centreline so the cloth's camber always faces leeward. A gybe slams the boom across and the audio system plays the thud.

The source file splits the yacht into more than forty meshes. After `classifyParts` has measured them, `batchStaticParts` merges the fixed ones by material into nine (`StaticBatching`), which cuts the yacht from about fifty draw calls per pass to under twenty. The coachroof exists three times, a few centimetres apart; the copies stay visible (they differ in detail and resolve each other's z-fighting) but only one casts a shadow. Anything that has to move on its own (boom, sail, propellers, rudders) stays a separate mesh.

The model ships without underwater appendages or textures. `Appendages` builds a saildrive leg with a three-bladed bronze propeller and a balanced NACA-section spade rudder for each hull, placed from the measured hull bottom. `YachtShading` paints antifouling, a boot stripe, a cove line, a wet band that follows the real wave surface, a non-skid deck and sail seams in vessel space; sailcloth passes a little diffuse light when the sun is behind it.

Rules for yacht work:

- preserve named or semantically discoverable hull, mast, sail, cockpit, and rigging nodes;
- keep opaque hull materials depth-writing and physically shaded;
- do not make the entire sail emissive to fake sunlight;
- sun core geometry must respect the depth buffer, including when it is behind a sail;
- deform sails smoothly from wind and trim; do not simply snap a flat triangle between sides;
- use the physics root for position, heading, pitch, and roll, with visual-only damping inside `Vessel`;
- keep propellers/rudders tied to engine/rudder state if the asset exposes suitable nodes;
- the helm station is procedural (`HelmStation`) because the asset has none. It stands on the starboard aft deck, out of the boom's sweep (the boom clears the coachroof by only half a metre): a pedestal with a leather-rimmed five-spoke wheel that turns with the rudder, an instrument pod whose chart plotter shows the islands, the ships as AIS targets and the yacht head-up, a speed/depth/RPM display and a wind dial (one 1024×672 canvas atlas, redrawn about five times a second and only while the helm camera or a close camera can read it; red night palette), a binnacle compass whose card keeps north, the engine lever that follows the throttle, a guard rail, a helm seat and the sheet winch. Static parts are merged by material with vertex colours: eight draw calls. The helm camera stands at `HELM_EYE`;
- validate close camera framing after any scale, pivot, or bounding-box change;
- keep new fixed parts batchable (one material, no per-part animation); a part that must move on its own needs its own mesh outside the batches;
- underwater parts do not cast shadows: nothing could show them.

## 12. Wake, footprint, foam, and splash

The wake is intentionally divided into separate effects:

1. two hull tracks, emitted from the port and starboard stern positions;
2. one central propeller wash, emitted whenever throttle magnitude exceeds the prop threshold;
3. bow droplets at higher forward speed;
4. wildlife contact effects from bounded pools: droplets, mist, crown sheets, rings, foam fields, fin trails and whale blows.

The current wake contract is:

- hull tracks begin above `0.06 m/s`;
- above about `1.1 m/s` each bow also sheds a diverging wave that drifts outward and slows, drawing the V of a displacement hull;
- bow spray begins near `2.1 m/s` (`bowSprayRate`);
- prop wash begins when absolute throttle is above `0.04`, even before the hull has accelerated;
- track history samples after `wakeSampleSpacing(speed)` of movement: `0.28 m` at low speed, growing to `1 m` at speed so the bounded pool holds the whole twelve seconds;
- a maximum time interval supplements distance sampling so stationary prop wash and very slow motion remain visible;
- slow or stationary maximum interval is `0.55 s`; moving interval is `0.22 s`;
- the wake is not a set of decals on the water: every sample is drawn as a soft stamp into the wake field (`WakeField`, a texture of about 150 m following the yacht), and the ocean shader turns that into water: foam, aerated slick and a height field whose slope it shades like the swell;
- stern-track stamps carry the transverse waves: their phase is the distance behind the stern times `g / v²`, so the crests follow the yacht at her own speed and spread to the Kelvin wedge;
- bow stamps are single crests that move out sideways at `v · tan 19.47°` (`KELVIN_TANGENT`), so the diverging arms always lie on the Kelvin angle;
- overlapping stamps are weighted by the track length each stands for, so density does not depend on sampling; fresh foam collapses within seconds and a faint aerated band lingers;
- foam is lit by the ocean shader with the rest of the surface; spray is lit from the environment palette;
- hull tracks live about 12 seconds; prop tracks about 8 seconds;
- the ocean shader itself draws the water piling against each hull's waterplane: a lapping line at rest, a bow wave and a ribbon of aerated water along the sides that grow with speed.

Distance remains the primary spacing rule. The time fallback exists only to make active prop wash and slow-ahead foam visible; do not replace the distance rule with frame-dependent spawning.

Wake samples and the field's stamp capacity are bounded and derived from quality at construction time (field resolution 512, 384 or 256 texels); the field is redrawn from scratch each time, so it holds no history. Splash droplets use a bounded `Points` pool. New effects must reuse these pools or introduce another bounded pool rather than allocating a mesh per frame.

A wildlife splash position must be an actual world-space water-contact position, not a hard-coded distance from the animal root.

`WakeSystem.splash(position, intensity, kind, velocity)` shapes the water by how the body met the surface (`SplashKind`): `entry` opens a crown that rises and falls back, `exit` drags a sheet of spray along the body's own velocity, `slap` blasts water out and leaves a foam field that lasts tens of seconds, `breath` is a back or fin breaking the surface, and `blow` is a whale's (or a dolphin's tiny) exhalation that drifts downwind as mist. Intensity is contact energy from `contactIntensity(mass, speed)`: a dolphin re-entering at speed is about 1, a fluke slap about 5. Heavier contacts throw more and finer droplets plus a soft mist cloud, never bigger balls. Each splash also starts a ring-wave impact in the ocean shader. `trail()`, `shed()` and `ripple()` add fin trails, water running off a body in the air, and a spray-free slick. Crowns, trails and particles are fixed-size pools sized by quality.

## 13. Islands and bathymetry

The world is cut into `WORLD_CELL` (1.2 km) cells. `IslandMath.islandsInCell(column, row)` generates each cell deterministically from a hash of its coordinates: one primary island and, at random, one or two more — mostly cays and islets, some wooded islands, one in eight a large high island with ridged hills, forest and bare rock. Centres stay `cellMargin(reach)` from the cell edge, so islands of different cells never come closer than their shelves plus a channel; cell (0, 0) holds the three fixed home islands and keeps the start clear. Each definition provides a unique `id`, a `seed` (0…95) that replaces the old array index in the coastline noise and in the shaders' phases, centre, beach radius, elliptical Z scale, summit height and a two-lobed coastline bulge. `START_ISLANDS` is the stable list near the start used by tests. Caches are bounded and regenerate identically.

Coast queries (`distanceFromWaterline`, `nearestShore`) measure only the islands of the 3×3 cells around the point (`islandsAround`), so the answer is exact and a query touches a handful of islands. `IslandSystem` streams visuals: islands within `ISLAND_BUILD_RADIUS` are built (one per frame, nearest first), those beyond `ISLAND_RELEASE_RADIUS` are disposed; palms are merged per island and the palm shadow map is invalidated when the set changes. `IslandSystem.depthAt()` derives a shallow-water profile near each beach and deep-water variation elsewhere. The same definitions support soft avoidance, collision constraint, and direction back toward open water.

Island definitions, bathymetry, coastline noise, and terrain noise live in the pure module `IslandMath.ts`. The ocean shader compiles the same definitions, so shore wash and shallow-water colour follow the rendered coast.

The rendered island uses irregular radial geometry (rings crowd toward the beach) and a short submerged apron. Terrain triangles are wound counter-clockwise seen from above so the top face is the lit front face. Vegetation, dry grass and dunes come from low-frequency terrain noise; a `sandMask` attribute marks the sand.

`IslandSurface` decorates the terrain material: sand grain, rare shell fragments and broad colour patches that fade to their average before they can shimmer; wind ripples and micro-relief in the normal, faded by the pixel footprint; wet sand (darker, glossy) near the waterline and wherever the swash has just been; the swash sheet itself with its foam lace (`SurfMath`, the same waves the ocean draws). Palm shadows come from `PalmShadowMap`: the groves (on `PALM_SHADOW_LAYER`) are drawn from the dominant light into a depth map, only when the light moves, and sampled with a rotated Poisson disc for soft edges; each trunk also darkens the sand around its foot.

Water depth (`waterDepthAt`) slopes down from the rendered, irregular waterline, so physics, wildlife and the ocean colour agree on where the shallows are.

Each island's terrain is a `THREE.LOD` of two meshes (the coarse one beyond 380 m); its vertex count follows its size. Islands are drawn to 2 km (70 % of that on the low preset), groves to 1.3 km, and islands beyond 650 m are left out of the planar mirror. The palm shadow map covers a 520 m square around the yacht on a 120 m grid and is redrawn when the yacht moves into another square or the light moves; the 32 trunk-contact slots hold the trunks nearest that square. The seabed plane follows the yacht.

The palm asset is a row of five tree variants. `plantPalms` lifts each tree out of that row and plants it individually inside the vegetated zone; never place the whole asset group as one object, or the trees trail out to sea. All palms share one material per source material and one wind uniform, and sway in world space; because the wind needs nothing per tree, the groves are then merged per 1.5 km cluster into one mesh per material (a few draw calls for every palm in view instead of one per trunk and crown). The outer apron fades with vertex alpha before its final edge. This prevents clear water from revealing a giant circular shelf that can be mistaken for a ring or a flat whale.

Island constraints:

- keep the visible terrain radius scale at or below the tested limit;
- keep the hard collision boundary approximately two meters outside the nominal beach radius, and keep it inelastic;
- render the transparent terrain before the transparent ocean;
- do not add a wide opaque underwater disc;
- keep beach color warm muted yellow, not pure white or neon yellow;
- maintain a plausible transition from beach to shallow blue water;
- if bathymetry changes, update collision and HUD depth behavior together;
- avoid adding high-detail palm geometry to every distant island without LOD or instancing.

## 14. Unified day and night environment

`EnvironmentMath.deriveTimeOfDay()` produces a bounded state. `EnvironmentPalette.deriveEnvironmentPalette()` turns that state into every colour the scene uses, in scene-linear RGB: zenith, horizon, sun tint, dominant light, ambient light, cloud colours, and water colours, including a warm twilight as the sun crosses the horizon. This palette is the only place day, dusk, and night colours are defined.

One analytic sky function (`shaders/skyShader.ts`) is evaluated by three consumers:

- the visible sky dome, with procedural fair-weather clouds lit from the sun or moon;
- the image-based-lighting capture, which `EnvironmentSystem` prefilters with `PMREMGenerator` and assigns to `scene.environment` so PBR materials are lit by, and reflect, the sky that is on screen (below the horizon the capture shows the sea);
- the ocean, which reflects it and fades into its horizon.

The capture is refreshed only when the night factor has moved, at most a few times per second during a day/night transition, and the previous target is disposed.

The sun, moon and stars are drawn by the sky shader itself (`skyCelestial`), under the clouds: clouds drift across them, and every piece of geometry hides them by being drawn later. The solar disc is HDR (it blooms), with limb darkening, and dims near the horizon so it stays red-orange; the moon shows the familiar face — the real maria (Imbrium, Serenitatis, Tranquillitatis, Crisium, Fecunditatis, Nectaris, Procellarum, Nubium, Humorum, Vaporum, Frigoris) where they lie as seen from Earth, Tycho and Copernicus with their rays, craters thinning out over the seas — and a soft, darker limb; stars twinkle on a stereographic grid, sized to a pixel. The lighting capture leaves them out (`uCelestial` 0): the directional light already carries the sun and the moon.

Weather comes from `WeatherMath` (see “Weather, sea state and the day cycle” below): a clear blue sky with only a few small, crisp cumulus (about 12 % cover) when clear, thicker and darker as the weather worsens. By day the sun stands about 29° up (`deriveTimeOfDay`, higher at the top of the automatic arc), high enough for the deep blue of the sea seen from above and short shadows on deck. A day/night change takes `TRANSITION_SECONDS` (11 s) and passes through a full sunset or sunrise.

Lighting: one directional light carries the palette's dominant light (at 1.3× the palette's irradiance: direct sun is several times the sky's light on a clear day, and a weaker key lets the sky fill tint every white surface blue and flatten it) and casts a tight shadow frustum (about ±17 m) that follows the yacht for crisp self-shadowing; a weak hemisphere light (0.3) and the sky capture (`environmentIntensity` 0.5) fill the shadows. Turning shadows on or off with a preset change rebuilds every lit material (three.js bakes shadow support into the program). There is no separate ambient light; ambient comes from the capture.

### Under the surface

`UnderwaterLight` applies the same Beer–Lambert transmittance to every material below the local wave surface (evaluated per vertex from the shared spectrum): wildlife, the reef fish, the hulls' underwater parts, the appendages, the island aprons and the seabed. Red is absorbed within a few metres, blue last, and the water's own colour is scattered back in, so submerged things read as in the water rather than behind glass. The in-scattered colour follows the palette. Near the surface, moving sunlight caustics (fading with depth, off at night) play over every submerged material.

Navigation lights stay in the scene at zero intensity by day. Toggling their visibility would change the scene's light count and recompile every lit shader at dusk.

Night requirements:

- the scene remains readable rather than nearly black;
- moon elevation is 30 degrees (`π/6`) above the horizon;
- the moon is part of the sky, so geometry and clouds pass in front of it;
- moon halo is soft and controlled;
- small stars use varied low intensity and glow, not large flat dots;
- moonlight creates a broken elongated glitter path on the water;
- yacht navigation lights and their lamp lenses activate with night factor;
- no stale dark sky sector may remain after repeated day/night switching.

Sun requirements:

- the solar disc is part of the sky, behind all geometry and the clouds;
- a sail or mast can occlude it;
- the wide solar glow is part of the sky itself, so it is naturally behind all geometry;
- avoid excessive sail transparency or emissive brightness that makes the sun appear through canvas.

Do not independently set `scene.background`, fog, sky dome, ocean colours, lighting capture, and exposure from multiple event handlers. Environment ownership is centralized.

### Presentation pipeline

`PostProcessing` renders the scene into a multisampled half-float target, applies bloom only to pixels brighter than `BLOOM_THRESHOLD`, then runs one finishing pass: slight corner fringing, saturation, vignette, the renderer's ACES tone curve, the display transfer, and fine grain. On the low preset, or on a GPU that cannot render to half-float, the scene renders directly and every material tone-maps itself. Custom shaders must therefore output scene-linear colour and end with `#include <tonemapping_fragment>` and `#include <colorspace_fragment>`.

Values above 1 are meaningful: the solar disc, sun glitter, and lamp lenses are deliberately brighter than white so they bloom. Do not mark such materials `toneMapped: false`.

### Weather, sea state and the day cycle

The player (manual) or the planner `autoWeatherKind(time)` (auto, the default; the first 480 s are always clear, storms and hurricanes wait until 900 s) picks a `WeatherKind`; `stepWeather` eases a `WeatherSample` toward its preset. The sample drives, and nothing else may define:

- the sea: `OceanMath.setSeaScale(sample.waves)` sets per-wave amplitude factors `seaFactors` (GLSL `uSeaFactors`, CPU `sampleOcean`), so buoyancy, wake, wildlife and the camera floor follow the same higher sea; `significantWaveHeight` feeds the HUD; `uMaxFold` replaces the old constant fold limit;
- the wind: `VesselPhysics.windScale` and `reefFactor` (the crew reefs above `REEF_START_SPEED`), palm lean, wind ripples, whitecaps (`uBreaking`), haze;
- sky and light: `EnvironmentPalette` storm darkening, exposure, fog, lightning (below);
- rain: `RainSystem` (`QualityManager.rainDrops`), ocean rain rings, rain hiss and patter.

Lightning (`LightningMath`, `LightningSystem`) is drawn from 1.6 s time slots by hashing the slot, so it is reproducible at any frame rate. From `storm` 0.35 (a downpour) there is now and then a distant flash six to thirteen kilometres off; from 0.6 (a storm) several strikes a minute, mostly one to eleven kilometres away and one in seven or so close by, more in a hurricane. A strike is a cloud-to-ground bolt (a branching channel from the cloud base to the sea) or a flash inside the cloud. Its light is a stepped leader that reveals the channel downward in 45 ms, then one to four return strokes (a spike of a few milliseconds and a glowing tail). Bolts are camera-facing ribbons with an HDR core and halo, additive, at most three at once; one farther than `BOLT_RENDER_DISTANCE` (1.9 km) is drawn there at its true angular size, behind the islands and ships on the horizon, dimmed by the air and the rain. The sky flash (`uFlash`) lights the clouds around the strike's direction (`uFlashDirection`) and fills the whole sky only for a close one (`uFlashFocus`); the scene light (sun colour, hemisphere) follows `strikeProximity`. Each strike's thunder arrives `distance / 343 m/s` later, panned to where it struck: a crack and a crash close by, a long low roll from far away, nothing beyond `THUNDER_RANGE`.

`autoTime` turns on the automatic day cycle (`dayCycleState`: day, dusk, night, dawn, with the sun climbing in the day); `EnvironmentSystem` follows the goal at the usual transition speed. Persisted: `autoTime`, `weatherMode`, `weather` (the present weather itself is not persisted).

The moon's face is drawn in the sky shader (`moonCraters`: three scales of craters with a bright rim and a lit inner wall, broad dark seas, fine mottling) at a radiance below the bloom threshold, so the detail is not washed out; the sun has a wide soft glow (`skyAtmosphere`) around its disc. Every HDR value entering bloom and the finish pass is made finite and capped at `HDR_CEILING` (`saneColor`, `hardenBrightPass`): one overflowed or NaN half-float pixel is otherwise smeared by the blur over the whole frame (blinking or a black screen). After a lost WebGL context is restored the lighting capture, render budget and buffers are rebuilt.

`OceanReflection` is a whole second scene render, so it is skipped once the sea is rough (`calmSea = 1 − smoothstep(0.45, 0.75, storm)`): the storm sea reflects the sky and clouds only, with the cheap cloud path (`skyClouds` detail < 0). The heave of the yacht is driven by moving averages of the sampled water level (`VesselPhysics`), which take chop flicker out of its velocity and acceleration without delaying a swell. Outside the helm the camera near plane is 0.35 m (finer depth at range); ships have their own lighter haze patch (`ship-haze-v1`) so they read at several kilometres.

The mirror target of `OceanReflection` has a mip chain; the ocean shader blurs it by roughness and contact distance (`mirroredWorld`) and lifts Fresnel where an object is really mirrored.

## 15. Wildlife assets and validation

The simulator loads external rigged GLBs for all visible living objects. There are no primitive-mesh animal fallbacks.

`isDetailedSwimAsset()` and controller-specific checks guard geometry, rigging, and animations. If an optional shark, whale, fish, or gull asset fails validation or loading, omit it. If the required dolphin fails, loading fails visibly.

General motion rules:

- every animal is a forward-only swimmer (`SwimmerDynamics`): velocity is always along the body axis, speed stays positive, and the turn rate is limited by a minimum turning radius at the current speed, so nothing pivots in place;
- yaw and pitch rates change with bounded acceleration; bank follows turn rate and stays small;
- heavy swimmers (whales, sharks, cruising dolphins) hold depth with a critically damped, bounded vertical controller (`stepSwimmerAtDepth`) and take their pitch from the resulting path, so depth changes never overshoot; leaping dolphins steer by pitch;
- depth is kept relative to the mean surface, and the water's own motion at that depth (`sampleOcean(x, z, t, depth)`) carries the body on top: nothing bobs on a sine of its own;
- behaviour is pure (`*Behavior.ts`: state machine, steering, kinematics, pose parameters) and unit-tested against the real sea and bathymetry; controllers only map it onto the rig and the effects;
- tails and spines are bent procedurally through the real joints with `ProceduralBone`, in the animal's own frame, on top of whatever the mixer last wrote; authored clips are filtered (`filterClip`) to the secondary motion they do well;
- surface contact is tracked at named body points (`BodyPoint` + `SurfacePoint` with hysteresis), never at the model centre; splash energy comes from mass and speed through the surface;
- animals keep off islands with `ShoreAvoidance`: `steerClearOfShallows` looks ahead along a fan of headings, as far as the animal needs to turn at its speed and radius, picks the clear heading closest to its wish and reports an urgency used to ease off; `confineToDeepWater` is the hard limit that eases a body back to deep water at swimming speed, so land is unreachable; leaps need a clear deep run ahead; reef fish never take a step onto the beach;
- animals keep each other at a distance and never occupy the yacht's hull and keel box;
- an animal left far behind a moving yacht is moved ahead of her only while it is deep and out of sight;
- skeletal sampling slows with camera distance (`animationInterval`) and animals hidden by depth or distance are not drawn.

### Dolphins

`DolphinBehavior` runs a pod and its members. The pod roams calmly around a stopped or slow yacht, escorts her abeam, rides the pressure wave just ahead of her bows, or crosses ahead of her and loops back, depending on her speed. Pod members keep loose slots with individual speed, depth and timing, grouped in knots of two or three (`podJitter`) rather than a ruled echelon, surge ahead and drop back when playful, and rise to breathe with a small chuff of mist.

Each dolphin runs:

`cruise → accelerate → approach_surface → leap → airborne → reentry → dive → recover → cruise`

The pod holds 4, 6 or 8 dolphins on the low, medium and high presets (`dolphinCount`), and reef fish density is 0.55, 0.9 and 1.4.

Leaps are speed gated twice. A dolphin only commits to one (`canCommitToLeap`) in a playful pod (yacht at least `DOLPHIN_PLAY_VESSEL_SPEED`, about 3.5 kn), after its cooldown, already swimming at `DOLPHIN_LEAP_ENTRY_SPEED` or more, over deep water and clear of the hulls. It then accelerates at depth and only leaves the water if it has actually reached `DOLPHIN_LEAP_MIN_SPEED`; otherwise it levels off. A calm pod never leaps. The run-up depth (`leapRunDepth`) is what lets the body rotate to its exit angle before the rostrum breaks the surface. From that moment the motion is ballistic, the body axis lies along the velocity and arches with the path's curvature, the strokes stop, and the dolphin re-enters head first carrying its momentum into a dive that the water slows. Variants: low porpoising arcs, high arcs, paired leaps started a fraction of a second apart, and rare spinner leaps that complete one or two rolls before re-entry.

The rig is rooted at the tail and its authored clip only flaps the pectoral fins, so the dorsoventral body wave is procedural (frequency from speed, larger toward the flukes) and the model is shifted to keep the mid-body on the path. The model is scaled by its length to a 2.7 m bottlenose.

### Sharks

`SharkBehavior` runs:

`cruise ⇄ patrol → investigate → approach → accelerate → retreat → deep_swim`, with an occasional `fin_show`.

The shark patrols wide circles, cruises with slow changes of course, spirals in to look at the yacht and turns away, and drops into the deep where it disappears. Rarely (`SHARK_CLOSE_PASS_COOLDOWN`) it curves in and passes under the hulls below `SHARK_UNDER_KEEL_DEPTH`, sometimes followed by a burst; occasionally it rises until its dorsal fin cuts the surface for a few seconds, leaving a thin foam line. It never jumps, never chases the yacht for long and dives quickly if she comes over it. The authored swim clip is kept but driven: its phase is the shark's own tail-beat phase (faster with speed and effort) and its weight is the effort, so a gliding shark barely strokes and a bursting one thrashes; the spine curves into turns. The source ships white, so the material is countershaded (dark back, pale belly), which is what makes it a dark shape from above. Do not use the bite clip for locomotion.

### Reef fish

The licensed school asset holds nine rigged fish of four species in one choreographed loop. `ReefFishController` lifts one fish of each species out of it at load time (grouping vertices by the bone that weighs on them most, and using that fish's head and tail bones for its axis) and draws every fish as an instance of that geometry. The swimming body wave and its effect on normals are computed in the vertex shader from a per-instance phase and amplitude.

`ReefFishMath` gives each species its own schooling (separation, alignment, cohesion), a patch of reef on the shelf of the island nearest the yacht, a depth band between the reef and the surface, and flight from the hulls, dolphins and shark; the alarm passes through the school. Fish obey the same rules as larger animals: positive speed, bounded turn rate and pitch, no instantaneous reversal. Schools far from the camera are neither simulated nor drawn. Each school's bounding sphere is rebuilt from its fish every frame, so a school outside the view is frustum-culled, and beyond `FISH_DETAIL_DISTANCE` (24 m, where a fish is under ten pixels long) it is drawn from a simplified mesh with about a sixth of the triangles.

### Whales

`WhaleBehavior` runs one whale:

`deep_swim → ascend → surface → prepare_tail_slap → tail_slap → submerge → cooldown → deep_swim`

The whale spends most of its time deep (about ten metres), where the water hides it completely; it is not hidden by any material trick. It surfaces only when the moment is right: at a comfortable distance from a stopped yacht on a course that will not carry it into her, or timed to come up abeam of a moving one (closest approach in about twenty to forty seconds). It climbs slowly and levels off near the surface (an 18 m body climbing steeply would lift its head metres out), breathes two or three times with only a sliver of back and the blowhole clear, each breath a blow of mist that drifts downwind, lies along the swell, and circles a stopped yacht rather than heading at her.

After surfacing it may lobtail (almost always the first time, then more likely the longer it has gone without; never within `WHALE_SLAP_COOLDOWN`): it slows, tips its head down, and its peduncle lifts the flukes two to four metres clear while the torso stays under; water pours off them. It holds, then strikes one to three times with varying force, height and body angle. The tail is a chain of three real joints (`locator4`, `locator5`, `locator6`) whose bends follow damped springs, stiff at the root and laggier toward the flukes, so every stroke starts in the body and whips through to the tip; a strike is about twice as powerful as a lift. Otherwise it sounds, sometimes lifting its flukes as it goes down. A sounding whale leaves a glassy footprint.

The slap fires once per downstroke when a tracked fluke point crosses down through the rendered surface fast enough, at that point, with energy from the fluke's mass and speed. `WHALE_SHALLOWEST_DEPTH` is a hard limit on the body centre; the seabed may squeeze the whale up but never out of the sea, and it steers for water at least 13.5 m deep. The authored swim clip beats the flukes through seven metres, so only its flipper and eye tracks are played. Swimming, the flukes beat every four to eight seconds through the three tail joints (stronger when speeding up or climbing), the head dips slightly against each stroke, the tail bends toward the inside of a turn, and the flipper clip works harder when turning.

### Distant breaches

`WhaleBreach` runs a second, separate whale that is only ever seen breaching: often (`BREACH_MIN_INTERVAL`–`BREACH_MAX_INTERVAL`, 45–110 s, the first within about 40 s), `BREACH_MIN_DISTANCE`–`BREACH_MAX_DISTANCE` from the yacht, ahead or off her bow, over deep water, running across the line of sight. It accelerates up from twelve metres, leaves the water on the arc its plan needs (full breach onto its back, flank breach, or chin breach), flies ballistically while its body lags the path and rolls, and crashes down; the water stops it within a body length and it dives out of sight. `WhaleBreachController` draws it with its own rig and throws spray where body points actually cross the surface: a sheet of water on the way out, the largest splash, mist and ring waves on the way down, and churned water afterwards. The whale near the yacht still never lifts its body out.

### Gulls

`GullBehavior` flies each bird: `soar` (circling a centre that drifts with the yacht, rising and sinking on the circle), `follow` (a station over the wake when she is under way; birds that overtake weave and fall back), `skim` (a long glide a metre or two above the waves), `dive` (climb, fold, plunge: a splash), `land` (a slowing glide into the wind and a soft touchdown), `rest` (afloat at `GULL_FLOAT_HEIGHT`, riding the swell head to wind, paddling) and `takeoff` (running along the surface on fast strokes; a resting bird takes off with an alarm call when the yacht comes within `GULL_ALARM_DISTANCE`). Airspeed stays forward and above `GULL_MIN_SPEED` in flight; the turn rate is bounded and the bank is that of a coordinated turn (tan bank = V·ω/g, at most `GULL_MAX_BANK`); flapping comes in bouts and harder to climb, accelerate and take off; birds keep a few metres apart.

`GullFlockController` measures the rig's flight frame from the posed skeleton once (the source is built upright and only lies down in its clips) and corrects it on a body node, so the root's frame is the bird's. The merged bird is Loop-subdivided once (`subdivideSkinnedLoop`, creases kept) and shared by the flock; the plumage is painted per triangle (white body, silver-grey mantle and upper wing on whichever face of the single-sheet wing shows the top, white trailing edge, black tips with white mirrors, yellow bill with a red spot) and the shader adds primary shafts, scalloped secondaries and sunlight through the wing. The flap and glide clips always sum to full weight (the second glide clip, which turns the body, is stopped); on top, the shoulder, hand and tip are stroked a beat apart so the wing whips, hold a shallow "M" in a glide, and fold back along the body (the hand tucked by scale) to dive or sit.

## 15a. Ships

`ShipSystem` keeps nine ships near the yacht, five under way and four at anchor (`MOVING_SHIPS`, `MAX_SHIPS`), so a large ship lies every one to two kilometres wherever she sails; the ocean shader draws the wakes of the four nearest (`WAKE_SLOTS`, `writeShipUniforms`). Types (`SHIP_SPECS`): a 334 m container ship, a 310 m tanker, a 262 m bulk carrier, a 300 m car carrier and a 330 m cruise liner, each in one of three paint schemes; a tanker or bulk carrier is laden or in ballast (riding up to five metres high, red antifouling showing).

- **Lanes** (`planLane`): a straight course whose closest approach to the yacht lies 300–800 m off, clear of every coast by `LANE_SHORE_CLEARANCE` over the passage. A new ship appears 1.5–1.95 km up her lane, in the haze; at the start the first ship already crosses ahead of the yacht and the others are within sight. A ship far astern and moving away (`RECYCLE_DISTANCE`) is replaced; a slot that finds no clear lane retries a few seconds later.
- **Anchorage** (`planAnchorage`): open water well off the islands, head to wind, swinging slowly; moved ahead of the yacht once she is more than `ANCHOR_RECYCLE_DISTANCE` away. It is the ship the yacht can always reach.
- **Steering** (`stepShip`): service speed with bounded acceleration and turn rate; turns away when shoal water lies ahead; gives way to starboard to a ship on her starboard side on a collision course (and to an anchored ship), but takes the other side when the chosen one runs toward shoal water.
- **Contact**: the hull waterplane (`hullHalfWidth`, the same planform the geometry and the wake use) is a wall; points of the yacht's outline inside it are pushed out and her motion into the side is reversed with restitution, relative to the ship's motion; a hard contact throws a slap splash and a thud.
- **Wake**: a Kelvin pattern (divergent waves on the 19.47° arms, transverse waves following at the ship's speed with wavenumber g/V²), white water along the arms and a turbulent foam centreline that lasts `WAKE_FOAM_SECONDS`, a smooth slick that lasts `WAKE_SLICK_SECONDS`, a bow wave and a lapping line along the hull (see §9).
- **Visual** (`ShipGeometry`): one geometry per type and scheme with vertex colours, one shared-program material per ship (one draw call); the lofted hull has a raked stem, flared bow, sheer, flat bottom and bilge, transom; hawse pipes and anchors, draught marks, rubbing strake; container stacks, a tanker's pipe deck, catwalk and manifold crane, hatch covers and cranes, a liner's ten terraced decks of balconies and lifeboats, a car carrier's slab sides. Below the waterline the hull is veiled by `UnderwaterLight`. The ships ride the swell (heave, pitch, roll from four samples, heavily damped).
- **Night**: windows and deck lights glow (an emissive `shipLight` attribute, channel 0); masthead, side and stern lights burn under way (channel 1), anchor lights at anchor (channel 2). A `THREE.Points` layer keeps the lamps and lit windows a few pixels wide at any range, dimmed by the haze.
- **Sound** (`AudioSystem.updateShips`, `shipHorn`): the two nearest ships each have a voice — a low throb with the beat of a slow two-stroke diesel, losing its highs with distance, and the rush of the bow wave when close. A ship sounds five short blasts when the yacht stands into her path within 650 m ahead, and now and then one prolonged blast; the sound arrives as late as it takes to cross the water. The whistle is synthesised as a stack of air horns tuned to a chord (fundamental, fifth, octave plus a detuned octave for beating) from band-shaped `PeriodicWave`s with a 400–600 Hz tube resonance, a slow swell, flat-to-true pitch glide, an air-valve breath at each onset, a long falling pitch on release and a darkening slow echo off the sea; the larger the ship the lower the chord. No recordings are used.

## 16. Audio system

The current audio implementation is procedural Web Audio. There are no runtime audio downloads. The graph contains:

```text
Master → DynamicsCompressor → destination
  EngineBus → diesel firing pulses + half-speed crank + combustion knock + wet-exhaust burble → opening low-pass; starter cue
  EnvironmentBus → wave noise + soft low wind (weather-driven) + rigging whistle in strong wind + hull-water noise
  WildlifeBus → one-shot splashes (panned to where they happened, darker with distance) + positional gull calls (also when a bird is disturbed on the water or takes off)
  EnvironmentBus → thunder per strike (delayed by distance, panned to the strike, crack when close, low roll when far)
  EnvironmentBus → two ship voices (diesel throb and beat, bow-wave rush, air absorption by distance) + ship horns (delayed by distance / 343 m/s)
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
- shows a prominent localized “Tap for sound” capsule once the scene is ready while sound is enabled but the context is not running; after `SOUND_PROMPT_SECONDS` (or as soon as sound starts or it is tapped) the capsule crumbles into dust that streams into the permanent mute/unmute button at the start of the scene actions (top left), which glows as it arrives (`SoundPrompt`: fragments of the capsule animated with the Web Animations API; a plain fade with reduced motion);
- the corner button pulses while sound is enabled but still locked; one press unlocks and plays, the next mutes;
- treats the sound-unlock capsule and the corner button as single touch targets and performs the complete enable/resume path on `pointerdown`, with `click` retained as the keyboard fallback;
- tracks `statechange`, visibility, page hide/show, and focus;
- suspends on a hidden page and waits for the next trusted gesture to resume.

Do not display “sound on” as if it proves playback. Use `audioReady` for the active state. Do not auto-create or resume an `AudioContext` from server code, module evaluation, a timer, or an untrusted promise continuation.

Engine mute controls only `EngineBus`. Master sound controls the master gain. Waves and wind must continue when the engine bus is muted.

While an audible engine is running, the engine bus is boosted and the environment bus is gently ducked. The engine combines two RPM-controlled oscillators, a band-limited mechanical-noise layer, and a one-shot start cue so it remains distinguishable on phone speakers.

The engine is a small four-cylinder diesel: firing frequency 26 Hz at idle to 86 Hz flat out, a harmonic spectrum with its energy between 150 Hz and 1.5 kHz, and a low-pass that opens with revs and load, so it is calm and muffled at idle and fuller (never shrill) under power. Wind is pink noise in a low band that the breeze and the weather move slowly. Gulls call at irregular intervals from where they fly (long call, kee-ow, alarm keks, soft mew; pitch and timing vary every call). No licensed recordings could be fetched in this environment; everything is synthesised.

When tuning audio, test on small phone speakers. Important engine fundamentals and environmental energy must not exist only below approximately 100 Hz. Keep total gain bounded through the compressor and avoid clipping.

## 17. Camera and gesture separation

Four camera modes are supported:

- `chase`: damped third-person follow with speed-sensitive FOV;
- `helm`: the helmsman's eyes at the starboard helm (`HELM_EYE`), carried exactly with the yacht so nothing lags into the wheel or the pod, while the head keeps most of its level against her roll and pitch (`HEAD_ROLL_SHARE`, `HEAD_PITCH_SHARE`); limited look range, no zoom;
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
- use `aria-pressed`, `aria-expanded`, `aria-controls`, and live regions where they communicate state;
- never put a live region on a value that changes every frame (the heading in the collapsed panel is plain text).

Layout is driven by tokens on `.simulator-shell` (`--gap`, `--top-bar`, `--edge-*` with safe areas, `--throttle-width`, `--throttle-length`); breakpoints change the tokens and the arrangement, not scattered offsets:

- desktop and large tablets: instruments, reset/photo and the notice column on the left and centre top, settings top right, rudder bottom left, throttle bottom right; from 1280 px wide the open settings use two short columns so they clear the throttle on a 720 px tall laptop, and the throttle shortens on short windows;
- up to 900 px wide or 560 px tall: reset and photo mode become 44 px icon buttons (names kept for assistive technology and as tooltips);
- phone portrait (up to 680 px): a bottom dock; the rudder spans the width and the narrow throttle stands above its right end, beside the yacht rather than over it; settings open as a bottom sheet over a scrim;
- phone landscape and short windows (up to 560 px tall): rudder bottom left, throttle bottom right, the middle left to the yacht; settings open as a side sheet; below 350 px tall the collapsed settings button steps left of the throttle column;
- nothing but the sound-unlock prompt is laid over the scene: the status lines (the plaque that names what a switch has just done for 2.4 s — `showNotice`: “Time of day: Night”, “Weather: Auto”, “Engine sound: Off” —, the shore guard's “Steering clear of the island”, and the first-run tip) are shown at the top of the open control panel (`.panel-status`) and nowhere else;
- layout containers that only position their children (`.primary-controls`, `.scene-actions`, `.notice-stack`) set `pointer-events: none`, so their empty areas belong to the camera; every control inside sets it back;
- the apparent-wind card is shown on every phone at least 360 px wide: in portrait it shows the short caption (`messages.wind`) and drops the angle so speed, depth and wind fit beside the controls pill; the scene actions include a one-tap camera cycle (chase → helm → orbit → drone) whose label is the current mode;
- phone conveniences: the Screen Wake Lock keeps the display on while the page is visible (re-requested on `visibilitychange`, released on unmount, failures ignored); starting or stopping the engine gives a short `navigator.vibrate` tick where supported; `overscroll-behavior: none` and `-webkit-touch-callout: none` stop pull-to-refresh and long-press menus;
- the app is installable: `public/manifest.webmanifest` (fullscreen, theme `#061923`), `icon-192/512.png`, a maskable icon and `apple-touch-icon.png`, wired through `metadata` in `app/layout.tsx` (`appleWebApp` capable, translucent status bar);
- photo mode fades the interface out (inert while hidden); one tap or click on the scene (a short press that barely moved, so drags still frame the shot), `Escape` or `Tab` fades it back in; the hint says so for three seconds.

Verify layout changes at least at 320×568, 375×667, 390×844, 360×740, 568×320, 667×375, 844×390, 932×430, 768×1024, 1024×768, 1280×720, 1366×768 and 1920×1080, with the panel open and closed, in a long language (German or Russian), an RTL language and a non-Latin script (Tamil).

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

| Preset | Max DPR | Pixel budget | Ocean segments | Shadow map | Foam density | Gulls / dolphins | Reef fish | Ocean detail | Sky detail | HDR pipeline | Bloom | MSAA |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Low | 1.0 | 1.0 MP | 96 | 512 | 0.45 | 3 / 2 | 35% | 0.30 | 0 | off | – | – |
| Medium | 1.25 | 1.7 MP | 144 | 1024 | 0.70 | 6 / 3 | 60% | 0.55 | 1 | on | 0.20 | 2× |
| High | 1.5 | 2.6 MP | 224 | 2048 | 0.90 | 6 / 4 | 100% (142 fish) | 1.00 | 1 | on | 0.26 | 4× |

Ocean detail gates fragment work: above 0.2 the detail spectrum and one ripple layer are shaded; above 0.5 the finer ripple layer and the metre-scale chop are added; above 0.6 cloud reflections. Sky detail selects three- or five-octave clouds.

The drawing buffer never holds more pixels than the preset's budget (`budgetPixelRatio`): a Retina laptop at full screen renders about 2.6 million pixels on high instead of 4–5 million. Where the browser can time GPU work (`GpuTimer`, Chrome and Edge on desktop), `GpuGovernor` eases the render scale (down to `MIN_RENDER_SCALE`) while a frame costs more than `GPU_TARGET_MS` (8.5 ms, about half a 60 Hz frame) and back up when there is room, at most once every `SCALE_CHANGE_INTERVAL`; a GPU still overloaded at the lowest scale steps the preset down, and only a long idle one steps it up (the frame rate alone no longer raises the preset there, since a GPU can deliver 60 fps working flat out). Without GPU timing the preset falls back on the frame rate (`FpsJudge`): windows during start-up and after a preset change (shader compilation) do not count, nor do windows while the page is paced to 30 fps because another app has the focus; it takes three slow windows in a row to step down. Before this, switching to another app (to take a screenshot, say) dropped a session from high to low within seconds and left it there, aliased and flat. The canvas itself is not multisampled when the HDR pipeline will draw (it would only add a full-screen resolve every frame), and the context asks for the default power preference, so a laptop with two GPUs can stay on the efficient one.

Coarse devices start low. Adaptive quality observes FPS windows, steps down quickly when slow, and requires a long stable period above 58 FPS before stepping up. Coarse devices never automatically step to high.

Important implementation caveats:

- changing ocean segments replaces and disposes geometry at runtime;
- shadows can change with quality;
- a preset change resizes the HDR targets and their sample count;
- wake pool and wildlife counts are currently sized at construction and do not rebuild after a preset change;
- the palm shadow map is at least 1024² (2048² on high) and redrawn only when the light moves; the wake field is 512², 384² or 256²;
- `reflectionScale` sizes the planar mirror (`OceanReflection`, off on low, 0.35 on medium, 0.5 on high); it re-renders the scene without the ocean, wake, underwater group and sky, with no shadow pass;
- animation mixers are advanced at approximately 30 Hz while movement remains per-frame;
- all shader programs are compiled during loading against the render target the scene actually uses; nothing should compile during play (check `renderer.info.programs` before and after a day/night cycle);
- wake instance transforms are refreshed at approximately 30 Hz;
- on phones the per-draw-call CPU work of three.js, not the triangle count, is usually what limits the frame rate: the high preset draws about 125 calls per frame including the shadow, mirror and post-processing passes, the low preset about 50 (the archipelago, the ships and the larger flock added about 45 and 12); keep it there by batching fixed parts by material (`StaticBatching`), merging the parts of one rig (`SkinnedMerge`), letting meshes of one animal share their skeleton (`shareSkeletons`, so its bones upload once per frame), and culling instanced groups with a real bounding sphere;
- muting the sound suspends the `AudioContext` once the fade is done, so a muted simulator synthesises nothing; the next press (a trusted gesture) resumes it;
- the duplicate coachroof shells are left out of the planar mirror (`Vessel.mirrorSkipped`, about 90k triangles);
- the render loop and Web Audio suspend when the document is hidden, and `FramePacer` caps rendering at 60 fps (30 fps while the page is visible but unfocused), so a 120 Hz ProMotion display does not render twice as much; the mirror pass skips pixels with nothing mirrored nearby (one coarse tap).

Before increasing visual cost, measure the current bottleneck (`renderer.info.render.calls` and `.triangles` with `info.autoReset` off across the post-processing passes, texture uploads per frame, and a CPU profile of `render`). Favor shader detail, instancing, LOD, texture compression, smaller shadow casters, and bounded effects over more individual objects.

## 21. Local 3D asset manifest

The authoritative license text is `public/models/README.md`. Keep it synchronized with any asset replacement or modification.

| Runtime key | File | Approx. bytes | Approx. geometry | Required | Runtime role |
| --- | --- | ---: | ---: | --- | --- |
| `yacht` | `yacht-sailboat-pbr.glb` | 2,770,696 | 162,913 triangles, 26 meshes | Yes | Primary PBR catamaran |
| `palms` | `palm-trees-quaternius.glb` | 1,120,784 | 1,920 triangles, 5 variants | Yes | Tropical island grove with shader wind |
| `dolphin` | `dolphin-animated.glb` | 171,552 | 3,728 triangles, rigged | Yes | Swim and breach pod |
| `shark` | `shark-animated.glb` | 1,739,400 | 51,199 triangles, authored clips | No | Subsurface shark |
| `whale` | `blue-whale-rigged-pbr-v2.glb` | 1,422,856 | 38,784 triangles, rigged PBR | No | Submerged blue whale tail slap |
| `fishSchool` | `tropical-fish-school.glb` | 3,277,364 | 8,932 triangles, four species | No | Source of the four instanced reef-fish species |
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

- Ocean: finite height/normal samples over a large world range, bounded summed slope, resolvable wavelengths, and a focused grid with a uniform centre and upward-facing triangles.
- Environment: bounded day/night state, moon at 30 degrees, readable night exposure, a finite palette that warms at dusk and stays readable at night.
- Wind: bounded, deterministic gusts and shifts.
- Islands: bathymetry that shoals toward a coast matching the rendered waterline; an archipelago of every size that keeps its channels and the start clear; an indexed coast search identical to the brute-force one; shader slots that always hold the nearest island.
- Ships: lanes clear of every coast that pass within reach of the yacht and start out of sight; ships that never touch land and keep apart over a long run; an anchored ship that stays put; a hull that pushes the yacht out; foam on the Kelvin arms; bounded, finite wake waves, nothing ahead of the bow, nothing from a stopped ship; the danger signal and recycling.
- Gulls: forward flight on coordinated, bounded banks; never in the water except to dive, land or take off; afloat on the swell when resting; every mode reached; an alarmed take-off when the yacht closes.
- Quality: presets that scale cost monotonically, with no post-processing on low.
- Engine: start from neutral selects slow ahead, active throttle is preserved, stop returns neutral.
- Physics: engine produces forward motion with believable inertia, no NaN, comparable outcomes at 60/120 Hz, buoyancy follows sloped samples, a correct sailing polar (no-go zone, fastest on a reach, heel to leeward, bounded leeway), realistic top speed, prop-wash steerage, correct helm sense, shaft spool-down, shoal drag without sticking, a beached yacht that rebounds and turns away, and a long seaway passage that stays finite and on the rendered surface.
- Wake: low-speed hull wake, stationary prop wash, monotonic strength, reverse symmetry, sample spacing that keeps the whole wake in the pool, the Kelvin angle; splash kinds scaled by contact energy, a slap far larger and longer-lived than a dolphin entry.
- Weather and surf: fair most of the time, clear at the start, occasional spells; waves that differ, break, run up and drain, sand that dries; a storm swell several metres high that the yacht rides and that dies out over the shelves.
- Lightning: none below a downpour, distant flashes only in a downpour, several strikes a minute in a storm; a leader, then return strokes that die within a second; thunder delayed by distance; a channel from cloud base to sea with branches above it, the same for the same seed.
- Render budget: the pixel budget caps large canvases; the governor lowers the scale under load, restores it, spaces its changes and asks for a preset change only at its limits; the frame-rate fallback ignores start-up stalls and unfocused pacing.
- Shore guard: under power the yacht turns away before touching and the helm is handed back with speed restored; a helmsman steering into an island never strands her; under sail the sheets are eased.
- Water contact: the sampler returns the displaced surface, motion fades with depth, ring waves spread and stay gentle, crossings have hysteresis.
- Islands and animals: dolphins around a coast never cross the beach or enter very shallow water; sharks and whales keep to deep water; a distant breach is rare, far, continuous and varied.
- Wildlife: forward-only swimmers with a real turning radius and overshoot-free depth holding; whales complete surfacing and lobtail, stay hidden most of the time, never raise the torso, never repeat displays back to back; dolphins never leap when calm or slow, leap only at speed in a continuous arc with the body along the path and re-enter head first, never enter the hull box; sharks stay mostly deep, show the fin rarely, never leave the water, never graze the keels, and beat their tails harder when accelerating; reef fish that swim forward with bounded turns, stay between reef and surface, keep off the beach, flee together and calm down.
- Rig: boom settles at the sheeting angle on the correct side, gybes slam and tacks do not, mirrored pivot pose is exact.
- Underwater light: red absorbed first, nothing above the surface, path bounded by view distance.
- Assets: detailed whale rig/clip/PBR/triangle/byte limits, visible island radius constraint, future model budgets.
- Localization: exactly thirty language entries, complete message keys, locale aliases, manual preference precedence, RTL set.
- Rendering: Loop subdivision keeps flat colours and normalised skin weights and rounds the shape; batching keeps world placement and outward-facing triangles (also for mirrored parts), finds stacked shells only within the tolerance, shares skeletons only for identical bindings, a merged skinned rig deforms exactly as its parts did and refuses textured or inconsistent rigs, distant fish keep their shape with far fewer triangles.

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
- dolphin cruise, bow ride, breath, leap at speed (low, high, paired, spinner), re-entry and splash; no leaps beside a slow yacht;
- shark silhouette at depth, fin at the surface, pass under the hulls, burst, long turns without reverse/upside-down motion;
- whale hidden at depth, surfacing with blows, fluke rise, physical strike, strong splash with lingering foam and rings, sounding;
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
- check grounding in shoal water and the inelastic shore boundary;
- re-run the sailing-polar, top-speed, and seaway tests after any retune;
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
- use bounded turn/vertical dynamics and the shared swimmer, never a sine on the model's height;
- keep behaviour in a pure `*Behavior.ts` module and run it against the real sea in tests;
- avoid random new targets every frame; gate rare events with conditions, probabilities and cooldowns;
- keep state transitions finite;
- derive splash from tracked body points crossing the rendered surface;
- let the water hide what is submerged; never mask a body with a clipping plane or alpha cut;
- count the new animal's draw calls and bone uploads per frame; merge or share what the source file split;
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
- ensure canvas camera gestures do not receive control-panel drags, and that empty parts of layout containers do not swallow them;
- check the layout matrix in §18 with the panel open and closed;
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

- audio is synthesized rather than based on recorded engine/wave/gull stems (no licensed recordings were reachable from the build environment);
- the yacht force model is intentionally lightweight and not a full six-degree-of-freedom naval solver: sails are sheeted automatically, the two engines are not independently controllable, and heave, pitch, and roll are oscillators driven by the water plane rather than integrated hull pressures;
- ocean reflections combine the analytic sky with a planar mirror of everything above the sea at mean sea level (bent by the ripples, not by the swell's real geometry); there is no refraction or depth-based absorption because the scene depth is not sampled;
- whitecaps are a function of the instantaneous wave field and leave no persistent foam history;
- the wake and the surf only shade the water (normal, foam, colour); like the detail spectrum they do not move the yacht or the camera floor;
- palm shadows ignore the fronds' wind sway (the shadow map is drawn from the rest pose);
- the ocean's own transparency is a blend rather than a refraction, and underwater absorption uses the uninverted wave height per vertex (a few centimetres of error);
- the yacht's three cabin meshes overlap substantially (about 140k triangles together, only one of them casting shadows); removing two of them changes the cabin's detail, so it needs an asset rework;
- reef fish are lifted from one rigged asset and animated procedurally; they do not use the asset's authored clip;
- the ships are procedural (no licensed ship model was reachable); they do not alter course for the yacht (her shore guard turns her away from their sides, and she rebounds if it cannot), only for shoals and each other, and the wildlife ignores them; ships converging in a tight spot can still pass closer than they should (the keep-apart test uses a fixed seed);
- the yacht's wet band and the underwater absorption use the swell without ship wakes (a few tens of centimetres in a wake);
- gull folding is an approximation by sweep, roll and a scaled hand; the rig has no legs or neck to animate;
- wake and wildlife capacities do not rebuild when changing quality after initialization;
- palms are individually planted GLB trees, merged per island, with runtime vertex wind rather than LOD/impostor vegetation;
- the steering is named by the simulation's convention (positive rudder and "starboard" turn the bow toward `+X`), which the right-handed renderer shows turning left from behind the yacht (see §5); the instruments follow the view, the names were left as they are;
- lightning bolts are flat ribbons facing the camera, drawn at most at 1.9 km; the lighting capture does not flash with them (the directional and hemisphere lights do);
- the dolphins (three skinned parts plus two eyes, textured) and the shark and whale are still drawn as their source meshes; the shark alone is 51k triangles when it is near enough to be drawn;
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
- the yacht sticks in the sand or stops dead against a beach instead of rebounding;
- island geometry exposes a large circular underwater edge;
- island terrain is back-face culled from above, or palms stand in the sea;
- a custom shader skips the tone-mapping and colour-space chunks and so differs between the HDR and direct paths;
- sun or moon renders through the opaque sail;
- part of the sky stays dark after returning to day;
- night is unreadably black or moon is missing from the 30-degree elevation;
- dolphins or sharks translate backward, flip upside down, pivot instantly, or freeze in place;
- the whale near the yacht shows its torso, repeats a display back to back, or splashes without its fluke contacting water; a breach happens close to the yacht or often;
- the shore guard holds the helm without the course being blocked, or circles in front of a beach;
- the sun or moon is drawn in front of clouds, or clouds cover the sky most of the time;
- a dolphin leaps at low speed, leaves the water outside a leap, or passes through a hull;
- an animal is hidden or revealed by a material trick instead of the water;
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
