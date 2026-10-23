# Sailing Simulator Pro

An interactive React and Three.js tropical sailing simulator built for desktop and touch devices.

## Features

- GPU-displaced Gerstner ocean with a matching CPU sampler for buoyancy and surface effects; daytime glitter is confined to the sun's path
- Force-based catamaran motion with ten buoyancy samples, engine thrust, combined mainsail + staysail force, drag, rudder torque, leeward heel, and island collision
- Detailed local GLB yacht with procedural, wind-filled mainsail and jib, a swinging boom, a turning helm wheel and an animated skipper who leans against the heel
- Varied islands (forested hill with pier and stilt hut, rocky lighthouse island, sandy atoll, a monolith islet) and an erupting volcano with a lit ash plume, lava bombs and glowing lava channels
- Discoverable places — volcano, sunken galleon on a reef, black monolith, floating beach party, lighthouse — plus floating bottles and crates to collect
- Merchant traffic (LNG carrier, container ship, tanker, cruise liner) spaced 1.5–3 km apart, with crisp dedicated ship shadows, clear-coated LNG tank highlights, wakes and realistic horns at least 30 s apart
- Ship's bell and parachute signal flares; all effect sounds are positioned relative to the camera
- Detailed local GLB palms, dolphins, sharks (with Jaws-style fin passes), whale, tropical fish and seagulls
- Twin-hull wake, independent propeller wash, bow spray, and pooled wildlife splash particles
- Unified day/night lighting with a golden tropical sun, depth-correct sun and moon, stars, navigation lights, and a moonlight path on the water
- Layered Web Audio for engine, waves, wind, hull water, splashes, horns, bell, flares, volcano and party music
- Chase, helm, orbit, and drone cameras with swipe, pinch, wheel, and double-tap gestures
- Minimap and full chart with fog of war over uncharted water
- Photo mode with auto-targeting of live events (framed so the sails never hide the subject) and one-tap photo saving
- Responsive semantic controls (swipe or tilt steering on phones) and automatic system-language selection across 30 languages
- Low/Medium/High quality presets plus an Auto mode that adapts to keep about 30 FPS

## Run locally

Node 22.13 or newer is required.

```bash
npm ci
npm run dev
```

The simulator is implemented as TypeScript modules under `src/simulator`. The React application dynamically imports the browser-only simulator from `app/components/SailingSimulator.tsx`.

## Controls

- Engine switch: start or stop the engine; starting from neutral selects slow ahead. On phones the throttle collapses to just this switch while the engine is off.
- Throttle: continuous reverse–neutral–forward control.
- Rudder: persistent port/starboard range with an explicit center button. On touch devices you can also swipe across the wheel indicator or enable tilt steering.
- Keyboard: `W`/`S` throttle, `A`/`D` rudder, `Space` center rudder, `R` reset, `M` map, `B` ship's bell, `F` signal flare.
- Camera: swipe or drag to look, pinch or wheel to zoom, double-tap to recenter.
- Reset scene: returns the yacht to its starting position, clears its motion and wake, neutralizes rudder/throttle, and recenters the camera. Lighting, sound, quality, and engine state remain as selected.
- Map: the minimap opens a full chart; places and finds appear once discovered, uncharted water stays under fog. Discoveries persist between visits.
- Photo mode: hides the interface. Three translucent buttons at the top-left toggle event auto-targeting, save a photo to the device, and toggle sound. Press `Escape` or double-tap the scene to leave photo mode.
- Settings: day/night, camera mode, sail trim, quality (Auto/Low/Medium/High), sound, engine mute, and language. Only Auto changes the quality by itself.

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
