# Sailing Simulator Pro

An interactive React and Three.js tropical sailing simulator built for desktop and touch devices.

## Features

- Physically shaded ocean: a shared six-wave Gerstner spectrum drives both the GPU surface and the CPU sampler, with per-pixel analytic normals, capillary detail, Fresnel sky reflection, a GGX sun and moon glitter path, crest scattering, whitecaps, a planar mirror of the yacht, islands and birds, sparkling HDR glints, and bathymetry-driven shallow-water colour
- Surf on every beach: waves steepen and break on the shelf, a frayed bore runs in, the swash sheet climbs the sand with a lacy foam edge and drains back, and the sand it wet stays dark and glossy for a few seconds; every wave is different and crests arrive obliquely along the coast
- Sand with grain, shell fragments, wind ripples and wet/dry shading, and palm groves that cast soft, sun-following shadows with contact darkening at each trunk
- Analytic sky with procedural clouds, a warm dusk, and image-based lighting captured from the same sky, so the yacht, islands, and water all agree
- Mostly fair trade-wind weather: a scattering of cumulus, with an occasional cloudy spell; the sun, moon and stars are drawn in the sky itself so clouds drift across them, and day–night changes pass through a slow sunset or sunrise
- HDR rendering with multisampling, bloom on real light sources, filmic tone mapping, and a restrained lens finish; bypassed automatically on the low preset
- Force-based catamaran: a real sail polar (no-go zone, fastest on a reach), gusting true wind, engine shafts that spool, propeller-race steering, lifting keels and leeway, heel to leeward, wave surge, damped heave, pitch and roll, and shoal-water drag
- A shore guard that sees an island coming: it takes the helm, slows the yacht, turns her to open water (backing off first if she is already at the beach), then hands control back; even a helmsman steering straight at an island cannot strand her
- Detailed local GLB yacht with a working rig: the boom swings to the sheeting angle, crosses on every tack and slams on a gybe
- Antifouling, boot stripe, wet band, non-skid deck and sail seams painted in the yacht's own frame, plus saildrive propellers and spade rudders
- Reef fish: four species, about 140 instanced fish schooling over the island shelves, swimming with a body wave and fleeing the hulls, dolphins and shark
- Clear tropical water: everything below the local wave surface keeps its colour and texture, absorbed toward blue with depth and lit by moving sunlight caustics near the surface
- A whale that stays hidden at depth, surfaces now and then to breathe (blows drifting downwind), and lobtails: the peduncle lifts the flukes clear while the body stays under, then slaps the sea one to three times, leaving spray, a long-lived foam field and spreading ring waves; it swims with slow, powerful fluke strokes, working flippers and a body that bends into its turns
- Rarely, far off, another whale breaches: it accelerates up from the deep, flies a ballistic arc while rolling onto its side or back (full, flank and chin breaches), and crashes down in a towering splash with mist, rings and churned water, heard across the water
- A dolphin pod that roams, escorts the yacht, rides her bow wave and crosses ahead; dolphins swim with a real body wave and leap only at speed, in one continuous ballistic arc (low porpoising, high arcs, paired leaps and rare spinners), re-entering head first
- A shark that patrols, investigates, passes under the hulls, bursts away and sinks into the deep; now and then its dorsal fin cuts the surface
- Every animal contact with the sea happens where the body actually crosses the rendered waves: crowns, droplets, mist, foam trails and ring waves scaled by mass and speed
- Animals keep to deep enough water: they plan around islands and the shelf in good time, and can never cross the beach
- Detailed local GLB palms, dolphins, sharks, whale, and seagulls
- A wake drawn into the water itself: transverse waves that follow the stern at the yacht's speed, diverging bow waves that open the Kelvin V, white water behind the transoms that breaks into streaky lace, and a paler band of aerated water that calms the ripples; it follows every turn and acceleration
- Unified day/night lighting with depth-correct sun and moon, stars, navigation lights with glowing lenses, and a moonlit glitter path on the water
- Layered Web Audio: a calm marine-diesel note that fills out under load, waves, a soft wind that swells with the weather, hull water, positional gull calls, and splashes placed and filtered by distance
- Chase, helm, orbit, and drone cameras with swipe, pinch, wheel, and double-tap gestures
- Semantic, keyboard-accessible controls and automatic system-language selection across 30 languages
- Adaptive Low/Medium/High quality presets for mobile and desktop hardware, with every shader compiled during loading so play never hitches
- Lean frames for phones: fixed parts are merged by material, multi-part animals are drawn as one mesh with one skeleton, reef-fish schools are culled and simplified with distance — about 95 draw calls on High (including the water's mirror) and 40 on Low
- Responsive layout from a 320 px phone to a 4K desktop: a bottom dock in portrait, corner controls in landscape, settings as a sheet on phones and two columns on wide screens, safe-area aware, and never over the yacht

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
- Photo mode: hides every interface overlay while the simulation and camera gestures continue; a short hint says how to leave it. Tap or click the scene once (a drag still frames the shot), or press `Escape`, and the interface fades back in. `Tab` also restores the controls for keyboard navigation. Renderer errors automatically leave photo mode so recovery remains accessible.
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
