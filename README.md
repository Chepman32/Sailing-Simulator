# Sailing Simulator Pro

An interactive Three.js catamaran simulator with responsive sailing physics, tropical water, dynamic lighting, and touch-friendly helm controls.

## Highlights

- Multi-wave buoyancy with pitch, roll, wind, sail trim, rudder, and engine response
- Physically shaded catamaran, sky, water reflections, island terrain, and shadows
- Visible low sun with bloom and rays, plus a high-contrast blue-water treatment
- Immediate stern foam footprint and a persistent wake that follows the vessel
- Mobile-friendly controls for engine, wheel, sail trim, and sun height

## Run locally

```bash
npm ci
npm run dev
```

The simulator itself is served from `public/Sailing_Simulator_Pro_-_Ultimate.html` and embedded by the application shell in `app/page.tsx`.

## Controls

- **ENGINE** or `W` / `S` / `Space`: forward, reverse, or stop
- Drag the helm or use `A` / `D`: steer
- `Q` / `E` or the sail trim control: adjust trim
- Sun-height control: adjust lighting while sailing
