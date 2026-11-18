# Sailing Simulator Pro for Windows

The desktop project starts with a free-sail sea trial in UE 5.8.4. Use it to verify the force model, water contact and camera framing before committing to hero assets. The production map starts with an 8 × 8 km tropical archipelago, a sheltered harbor and a route into open swell. Keep geographic IDs and the simulation clock stable so the map can grow after the first release.

| Phase | Priority and outcome | Exit gate |
| --- | --- | --- |
| 0. Sea trial | Ship a reproducible starter with one shared surface sampler, Chaos yacht, trim, rudder, engine and two cameras. | Open the checked-in level, sail both tacks, hold under power in calm water and see the same crests move through the visible hulls and buoyancy stations. |
| 1. Ocean and yacht | Profile the FFT, water material, sky reflection and the actual hull in open water before building out the coastline. | At 3840 × 2160 output on RTX 4070 with frame generation disabled, meet the open-water High preset budget. Measure the surface-to-hull error and compare a filmed tack and chase shot against reference. |
| 2. Harbor, seaway and weather | Sail a complete route from a pier past breakers into open swell. Support a range of weather, day/night, underwater and the hero FX and audio. | The route is playable in midday, storm and darkness. Check shore collisions, boat wakes, underwater crossings and 4K frame pacing along the route. |
| 3. Gameplay and saves | Port free sail, core web systems and data, then add buoy races and timed challenges. Port campaign content after its dependencies and asset rights are ready. | A web export fixture round-trips into the desktop save schema. Each shipped mode survives quit and reload. A race validates ordered gates and finish time. |
| 4. Photo mode and release | Finish the free camera, paused Path Tracer capture, quality tiers, PSO warm-up and Windows package. | Run the benchmark matrix on the packaged build. Exercise photo capture, device fallback and saves on a clean Windows machine. |

## Technical guides

- [Project settings, lighting, photo mode and release](../docs/desktop/production.md)
- [Ocean and yacht implementation](../docs/desktop/ocean-and-yacht.md)
- [Web feature and data migration, assets, Niagara and audio](../docs/desktop/content-and-parity.md)
- [Ordered implementation checklist](todo.md)

## Scope decisions

- Use a compact authored launch map. Preserve the browser's seeded island and chart IDs where needed for migration. Evaluate an endless streamed archipelago after shore rendering and streaming pass the harbor benchmark.
- Start with the browser catamaran's handling and play habits as reference. Tune six-degree-of-freedom contacts, foil forces and input feel against measured sea trials before changing race physics.
- Target 60 rendered fps at 4K output using temporal upscaling on the baseline GPU. Target 30 fps for the raster photo preview. Measure Path Tracer convergence on the frozen scene as time to image.
