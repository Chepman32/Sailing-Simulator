# Sailing Simulator Pro

An interactive React and Three.js tropical sailing simulator built for desktop and touch devices.

## Features

- Physically shaded ocean: a shared six-wave Gerstner spectrum drives both the GPU surface and the CPU sampler, with per-pixel analytic normals, capillary detail, Fresnel sky reflection, a GGX sun and moon glitter path, crest scattering, whitecaps, shore wash, and bathymetry-driven shallow-water colour
- Analytic sky with procedural clouds, a warm dusk, and image-based lighting captured from the same sky, so the yacht, islands, and water all agree
- HDR rendering with multisampling, bloom on real light sources, filmic tone mapping, and a restrained lens finish; bypassed automatically on the low preset
- Force-based catamaran: a real sail polar (no-go zone, fastest on a reach), gusting true wind, engine shafts that spool, propeller-race steering, lifting keels and leeway, heel to leeward, wave surge, damped heave, pitch and roll, and soft grounding in shoal water
- Detailed local GLB yacht with a working rig: the boom swings to the sheeting angle, crosses on every tack and slams on a gybe
- Antifouling, boot stripe, wet band, non-skid deck and sail seams painted in the yacht's own frame, plus saildrive propellers and spade rudders
- Reef fish: four species, about 140 instanced fish schooling over the island shelves, swimming with a body wave and fleeing the hulls, dolphins and shark
- Water absorbs light realistically: everything below the surface turns blue with depth
- Detailed local GLB palms, dolphins, sharks, whale, and seagulls
- Twin-hull wake with diverging bow waves, independent propeller wash, bow spray, and pooled wildlife splash particles, all lit by the time of day
- Unified day/night lighting with depth-correct sun and moon, stars, navigation lights with glowing lenses, and a moonlit glitter path on the water
- Layered Web Audio for engine, waves, wind, hull water, and splashes
- Chase, helm, orbit, and drone cameras with swipe, pinch, wheel, and double-tap gestures
- Responsive semantic controls and automatic system-language selection across 30 languages
- Adaptive Low/Medium/High quality presets for mobile and desktop hardware, with every shader compiled during loading so play never hitches

## Run locally

Node 22.13 or newer is required.

```bash
npm ci
npm run dev
```

The simulator is implemented as TypeScript modules under `src/simulator`. The React application dynamically imports the browser-only simulator from `app/components/SailingSimulator.tsx`.

## Controls

- Engine switch: start or stop the engine; starting from neutral selects slow ahead.
- Throttle: continuous reverse–neutral–forward control.
- Rudder: persistent port/starboard range with an explicit center button.
- Keyboard: `W`/`S` throttle, `A`/`D` rudder, `Space` center rudder, `R` reset.
- Camera: swipe or drag to look, pinch or wheel to zoom, double-tap to recenter.
- Reset scene: visible beside Photo mode without opening Settings, and enabled once the scene is ready. Returns the yacht to its starting position, clears its motion and wake, neutralizes rudder/throttle, and recenters the camera. Lighting, sound, quality, and engine state remain as selected.
- Photo mode: hides every interface overlay while the simulation and camera gestures continue. Press `Escape` or double-click/double-tap the scene to restore the interface without recentering the shot. `Tab` also restores the controls for keyboard navigation. Renderer errors automatically leave photo mode so recovery remains accessible.
- Settings: day/night, camera mode, sail trim, quality, sound, engine mute, and language.

Browsers require a trusted user gesture before Web Audio can play. If sound is enabled but the audio context is locked, use the visible **Tap for sound** button.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Detailed architecture, subsystem invariants, asset budgets, deployment procedures, and contributor guidance are documented in [AGENTS.md](./AGENTS.md). Model sources and licenses are documented in [public/models/README.md](./public/models/README.md).
