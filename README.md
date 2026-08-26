# Sailing Simulator Pro

An interactive React and Three.js tropical sailing simulator built for desktop and touch devices.

## Features

- GPU-displaced Gerstner ocean with a matching CPU sampler for buoyancy and surface effects
- Force-based catamaran motion with ten buoyancy samples, engine thrust, sail force, drag, rudder torque, heel, and island collision
- Detailed local GLB yacht, palms, dolphins, sharks, whale, tropical fish, and seagulls
- Twin-hull wake, independent propeller wash, bow spray, and pooled wildlife splash particles
- Unified day/night lighting with depth-correct sun and moon, stars, navigation lights, and a moonlight path on the water
- Layered Web Audio for engine, waves, wind, hull water, and splashes
- Chase, helm, orbit, and drone cameras with swipe, pinch, wheel, and double-tap gestures
- Responsive semantic controls and automatic system-language selection across 30 languages
- Adaptive Low/Medium/High quality presets for mobile and desktop hardware

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
- Settings: day/night, camera mode, sail trim, quality, sound, engine mute, language, and reset.

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
