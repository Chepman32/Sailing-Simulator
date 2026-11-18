# Desktop implementation checklist

## 0 · Sea trial

- [ ] Open and verify the native sea trial on the installed engine. Check sail, helm, reverse steering, settled draft, chase and cockpit. Then repeat on Windows in a Development package.

## 1 · Open ocean and hero yacht

- [ ] Build one RDG FFT cascade with deterministic seed and CPU reference. Compare displacement, velocity and normals at fixed times. Depends on 0.
- [ ] Add the full cascade set, clipmap, Single Layer Water look and sky fallback. Profile the ridge, horizon and low cockpit view without the yacht before testing the assembled scene. Depends on 1.1.
- [ ] Fit the hero hull, displacement stations, sail and foil tables. Check equilibrium, a wind-angle sweep, slow steering and gybe. Depends on 0 and 1.1.
- [ ] Validate one complete open-water route with the hero yacht and four camera views. Capture console, GPU and water agreement results. Depends on 1.2 and 1.3.

## 2 · Coast, atmosphere and media

- [ ] Bake the first island, bathymetry and sheltered harbor, then integrate the beach breaker and wetline. Check entry, coastal collision and camera crossings. Depends on 1.
- [ ] Deliver the four lighting setups and weather blends with the world seed held fixed. Check cloud reflection and exposure while panning through the horizon. Depends on 1.
- [ ] Integrate wakes, spray, rain, lightning, flock and MetaSounds. Check that all FX anchor to the water query, scale by camera distance and leave simulation time and speed unchanged. Depends on 2.1 and 2.2.

## 3 · Desktop gameplay

- [ ] Port helm UI, camera modes, chart, traffic and sailing assist, then validate a harbor departure and alongside approach. Depends on 2.
- [ ] Add SaveGame, import validation and round-trip fixtures. Check preferences, chart IDs, economy and campaign slot recovery. Depends on 0. Campaign content depends on the corresponding desktop map and mission runtime.
- [ ] Add an ordered buoy race and a local personal best using the fixed simulation clock. Add practiced challenges after the same gate system passes. Depends on 3.1 and 3.2.
- [ ] Port disembarking, diving, economy and discoveries, then the dependency-ready campaign chapters and assets. Verify mission flags and poses through a restorable checkpoint. Depends on 2 and 3.2.

## 4 · Delivery

- [ ] Verify the frozen Path Tracer water and free camera on Win64. Time the EXR capture and verify return to sailing. Depends on 1 and 2.
- [ ] Benchmark presets on the baseline scene matrix and fix the largest overruns. Cook with explicit maps and PSO precaching, stage a Shipping build and run offline smoke and reopen checks. Depends on the shipped features in 3 and 4.1.
