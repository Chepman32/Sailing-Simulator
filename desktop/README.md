# Sailing Simulator Pro on Unreal Engine 5

Launch **Sailing Simulator Pro** from Applications on Apple Silicon, or open `SailingSimulatorDesktop.uproject` in Unreal Engine 5.8.4 and select **Play**. **Coral Pass** starts under sail in open water between a volcanic island and a lighthouse harbor. The `SeaTrial` map is also available in the Content Browser. Press **H** for the controls. The mouse stays visible while sailing.

| Control | Action |
| --- | --- |
| A / D or ← / → | Steer to port / starboard. Release to return the helm amidships. |
| C | Center the rudder. |
| W / S or ↑ / ↓ | Raise / lower throttle through neutral into reverse. W or ↑ also starts a stopped engine. |
| Space or the engine switch | Start / stop the engine. The lever keeps its setting. A neutral start gives 12% ahead. |
| Drag the throttle lever | Set power from full ahead to full astern while the engine is running. |
| Z / X, Y | Ease / trim the sheet, resume automatic trim with Y. |
| V or the view button | Cycle through chase, helm, orbit, and drone. |
| Left-drag the scene, scroll | Look around. Scroll to zoom in exterior views. |
| R or double-click the scene | Recenter the current view. |
| P | Enter / leave a slow cinematic orbit. Drag or scroll to frame the shot. Click, Esc, or Tab to return to sailing. |
| World button or comma | Open world controls. Click a setting, or use Tab and Space. Escape or comma closes the panel. |
| H | Open controls. |
| Esc | Open Graphics and Sound in the pause menu, go back, or resume. |
| T | Go over the side in first person. Press T again from anywhere to return to the helm. The yacht holds position. |
| WASD / arrows, mouse, Shift | Walk or swim and look around. Hold Shift while moving to go faster. The mouse is captured while exploring and released for panels. |
| Space, C / Ctrl | Jump or swim up. Tap C or Ctrl to dive from the surface or from deeper wading water. Hold it to swim deeper. You can also dive by looking down and swimming forward. Ashore, tap C or Ctrl to crouch. |
| E, F away from the helm | Climb aboard at a stern step or retake the wheel beside the helm. F switches the dive torch on or off. |
| E beside a jet ski | Mount from the shore or water surface. While riding, hold W for gas, S to brake or reverse, A / D to steer, and press E to dismount at low speed. |
| Q / N | Open the chart. Drag to pan, scroll to zoom, click to mark a waypoint, and use Delete to clear it. R follows the player, and F fits the islands. |
| Tab | Open the equipment grid to check air, use the dive torch, or launch a signal flare. Select a slot with the mouse or arrow keys. Enter uses the selected item. |
| J / B, F / G at the helm | Sound the horn or ring the bell. Send a red or green signal flare. The camera follows its rise, then returns to the yacht. |
| M, O or 0 / Shift+O | Toggle sound. Select the next or previous radio station. The radio cycles through three SomaFM streams, the onboard shanty band, My music when tracks have been added, and off. |
| 1 / 2 / 3 / 4 | Trade winds / golden hour / squall / moonlight |
| L | Trigger a lightning strike during a squall |

Sound starts on. **M** and the sound button toggle it. The diesel, bell and horn use local recordings. The engine loop follows throttle and softens underwater. Footsteps shuffle the recordings from the web game and vary in tone with the surface and depth of the water. Their cadence follows the distance walked or run. The radio starts off.

Graphics and Sound open inside the pause menu. Graphics controls the quality preset and resolution. Sound saves independent levels for music, the world and both motors. In **Sound settings → My music**, choose files or a folder on your Mac. The library can play MP3, AAC, M4A, WAV, FLAC and AIFF in place and remembers the selected sources. Pick a track or press Play to listen.

Inventory shows current depth, remaining air and time at that depth. The chart shows the sailed track, shallow water, landmarks, ships and jet skis. A waypoint shows distance and bearing in the sailing HUD.

Underwater, the Saturn 3 ambience loops and three whale calls take turns with pauses. At the surface the recordings fade out, and the ambient loop pauses until the next dive.

Each island in Coral Pass has one jet ski at the shore. Another floats beside the harbour quay. The chart marks their current locations. The water jet gives quick acceleration and stronger steering under power. The hull rises onto plane, banks into turns and leaves a narrow white wake. Release the gas to coast. Hold brake to slow down and then reverse. The yacht stays hove to while the skipper is away. Press **T** to return to the helm.

The ocean mesh, Chaos buoyancy and swimming share one wave spectrum and one clock. Each offshore wave has a second-order Stokes crest whose shape depends on its wavelength and amplitude. Bow impacts use the speed at which the hull crosses that moving surface. The speed of an individual water particle also accounts for its horizontal travel up or down the wave face. In storms and hurricanes, swell trains between 78 m and 224 m form groups. Shorter wind waves between 13.5 m and 48 m cross those groups and form breaking crests on their faces. The developed offshore spectrum has a significant wave height of 9.7 m in a storm and 13.2 m in a hurricane. When the player changes the weather, the sea takes tens of seconds to build or settle. Foam appears where the surface converges. In a storm, foam from the past two seconds lingers behind the moving crest and stretches into streaks carried by the wind and water. Spray blows clear of the crests. The long swell loses energy across island shelves and over the shallow coral beside the starting channel. The reef samples the same seabed shape used to build its mesh. Along each shore, water depth determines how fast a crest travels, how much it steepens and where it spills. The swash runs up the sand and leaves a darker strip as it drains. Each hull sheds waves and foam along its course. The outside hull leaves a stronger wave in a turn, and the propeller adds a separate wash under power. The two bows throw spray independently when they enter a wave. Water leaves each bow with its impact speed, spreads in the wind and falls back into the sea. Each bow strike also deposits foam at the point of entry. The sheet fans outboard and aft, drifts with the wind-driven surface current, and drains into broken strands over the next eight seconds. Sheltered wave faces carry broader sky reflections between the whitecaps. Bow impacts and an overboard splash also send rings across the water.

The foam pattern uses grains one twenty-fourth of the previous size across waves and swash. The larger white patches still follow the breakers and wakes.

The loaded catamaran displaces 9.8 tonnes. Eight points under the two hulls measure the supporting water surface. Pitch and roll damping follow the rotation of the long swell. The bows lose headway when they meet a rising face. The working sail area and centre of effort decrease in a gale, with the shorter main and jib visible on the rig. The exterior camera clears incoming waves at its own position.

Holding a steering key moves the rudder from centre to full deflection in about a quarter of a second. The helm targets a turn rate as well as applying rudder force. It counters lateral drift and keeps a commanded turn responsive in cross seas. Propeller wash provides steering at low speed.

Two animated Fourier wave fields supply the smaller ripples that break up reflections. Each wavelength travels at its own speed. The wind-chop field also carries foam with the orbital velocity of the waves and lets it drain after a crest passes. This motion is baked into the same texture sample as the ripples. Nearby pixels reuse the ocean mesh’s long-wave slopes and evaluate the shorter waves individually. At grazing angles the material samples along the long axis of each pixel’s footprint, keeping the crosswise ripples visible in the sun path. At a distance, unresolved ripples broaden the reflected sunlight. Single Layer Water refracts the reef, sand channels, dolphins and sharks. A single 5.44 m reef shark cruises about 30 m from the yacht for 30 seconds. It takes five seconds to dive, spends a minute at depth and then rises again. The dolphin pod visits during the shark’s deep interval. Its slate back and pale underside use 4096 × 4096 colour and roughness maps.

One blue whale surfaces to breathe, showing its back and sometimes its flukes as it dives. A second whale breaches roughly every 35–55 seconds when there is a clear stretch of open water in view about 150–250 m away. Both whales choose routes that leave room for the full body at least 50 m from shore. The breaching whale accelerates from depth, rises and rolls in the air, then hits the waves on its flank. The impact raises a sheet of spray and leaves bubbles, foam and spreading rings. With sound on, the splash reaches the player from the point of impact after a short delay. Jumping overboard carries the skipper about 2 m underwater in open water and draws a plume of small and large air bubbles down with him. They rise, spread and pop at the surface.

In **World**, time of day and weather can be set independently or left to cycle automatically. **Clear** gives a trade wind. **Calm** gives light air and a low residual swell. Clouds, overcast, rain, downpour, storm and hurricane are also available. Rain moves with the wind, stipples nearby water and wets the sailcloth, deck and shore. Those surfaces dry gradually when the rain passes. Distant landmarks fade into the rain with increasing storm strength. The panel shows wind, wave height and frame rate. On the volcanic island, lava follows the ravines and ash rises from the crater in a locally ray-marched column.

At Light Cay the modeled light station includes a keeper’s cottage, gallery, glazing and Fresnel lens. The wreck of *The Siren’s Light* rests on rocks above the water about 250 m northeast of the starting yacht, marked **Pirate ship** on the chart. A 176 m product tanker lies by the quay, and a 184 m LNG carrier lies beyond the lighthouse. Seven additional deep-water anchorages hold tankers, LNG carriers, and 146 m container ships off the outer cays and on each side of the volcano. The chart marks all nine merchant ships. Their hulls block the yacht, chase camera and swimmer.

On approach to beaches or shallow coral heads, the yacht slows and turns toward navigable water. This works bow-first or in reverse. The reef shelf and coastal rocks can physically stop the hulls on contact. Steering toward open water gives you the helm immediately. If the hulls are already stranded, the yacht automatically refloats in clear water nearby, even with the engine off.

The volcanic island pairs surveyed Mount St. Helens relief with a matching aerial photograph. The terrain, coastal rock scans, and coconut groves use Nanite. The boat has clear coat, a sewn mainsail and jib, and a textured skipper. Terrain and rock textures include 4096 × 4096 surface maps. The distant sky uses 8192 × 4096 photographs. A small radiance map baked from the original HDR daylight exposure restores bright cloud edges in the sky and its reflection. Rebuilding this map with the source fetcher requires ffmpeg. [Asset credits](../public/models/README.md#unreal-engine-desktop-assets)

The coconut palms, coastal trees and jacarandas use downloaded models with 4K materials. Ferns and anthuriums grow on the sheltered slopes among patches of leaf litter. Leaves transmit sunlight, bend with the local wind and darken as rain accumulates. Coastal channel buoys retain their red and green marks and rock with the sea surface at their moorings.

The standalone preview and packaged game open in borderless fullscreen. **Render resolution** lists the active display’s sizes and remembers the selection across launches. At a fixed render size, the scene, temporal anti-aliasing and post-processing use that size before the final upscale to the display. The selected size preserves the screen aspect ratio. The instruments and menus use display resolution. Select **Adaptive** to let the chosen quality preset adjust resolution under load.

**High** adds filtered sun shadows (cascaded on macOS and virtual on other platforms), Lumen bounce lighting and ambient occlusion, and detailed screen-space water reflections. A shallow bank of sea mist catches the low sun and takes shadows from clouds and foliage. Local exposure retains detail in shaded leaves and bright water. **Ultra** increases shadow and reflection detail, uses Lumen reflections on the water, and enables hardware Lumen ray tracing when the GPU supports it. High and Ultra also use Nanite displacement on the volcanic island, parallax occlusion on harbor masonry, and subsurface scattering on leaves and the skipper’s skin. Press **P** for cinematic depth of field focused on the yacht. Low and Medium use simpler shadows and reflections from the captured sky. Adaptive resolution budgets 16.7 ms for Low and Medium and 33.3 ms for the higher presets. Ultra on macOS budgets 28.5 ms of GPU work to leave time for the Retina display composite. Boat physics runs at 60 Hz.

## Build and run on macOS

Run these commands from the repository root.

```sh
npm start            # Open the development preview and watch for saves.
npm run build        # Rebuild the Apple Silicon Shipping app and DMG.
npm run installapp   # Install the app from the DMG into /Applications.
```

The Zsh shortcuts `npm build` and `npm installapp` run the same scripts in this checkout. In another Zsh environment, load them with `source desktop/Tools/npm-commands.zsh`.

Saving C++ rebuilds the editor target and reopens the game. Saving an Unreal map, asset, or configuration file reopens the preview directly. The preview starts a fresh sailing session on reload and gives the game window keyboard and mouse focus when its viewport is ready. Press Ctrl+C to stop watching. Set `UE_ROOT` if Unreal is installed outside the default Epic Games locations.

The DMG is written to `desktop/Saved/Builds/Sailing-Simulator-Pro-macOS-arm64.dmg`. You can also open the image in Finder and drag the app to Applications. Use `npm start -- -SailingWeather=hurricane` for a hurricane preview. Weather names such as `calm`, `downpour` and `storm` start in the developed sea state. The `day`, `golden`, `night` and `squall` shortcuts also work.

For a repeatable gameplay capture, launch the player with `-SailingCapture="$HOME/Library/Containers/com.YourCompany.SailingSimulatorDesktop/Data/tmp/view.png" -SailingHideHUD -UseFixedTimeStep -fps=30`. The signed macOS player writes to its app container after seven seconds of sailing and exits. Add `-SailingWide` for the wider chase framing.

To measure real gameplay frame times, launch the player with `-SailingBenchmark="$HOME/Library/Containers/com.YourCompany.SailingSimulatorDesktop/Data/tmp/sailing.csv"`. The game warms up for at least five seconds and 120 frames, measures the next 600 frames by default, then writes the output dimensions, average FPS, median, p95, p99 and maximum frame times, and counts over 33.33, 66.67 and 100 ms. Use `-SailingBenchmarkFrames=1800` for a longer run and `-SailingFrameTrace` to record per-frame thread and GPU timings beside the summary. Use `-SailingWeather=golden`, `day`, `squall`, or `night` to compare conditions at the same window size.

Add `-SailingBenchmarkDive` to measure the same 600 frames underwater, or `-SailingBenchmarkAlongside` to start a few metres off the moored merchant ship and sail along its hull. The dive uses the normal overboard and dive inputs before the warm-up. For repeatable water views, use `-SailingWaterView=beach`, `sail`, `turn`, `entry`, or `shark` to watch the shoreline, a sailing wake, a powered turn, an overboard jump, or a surfaced dorsal fin. Use `waterline` for a close stern-quarter view of foam and spray with the engine off. The `dolphin`, `whale` and `distant-whale` views follow a visiting animal and begin recording when it reaches the surface. To record consecutive rendered frames, supply a writable directory with `-SailingWaterFrames` and a count with `-SailingWaterFrameCount`.

Use `-SailingWaterView=sand` to stand on the sand with the first-person camera pitched down 65 degrees at the swash. `sand-rock` places the same standing observer beside a tidal rock. `sand-horizon` looks up from the first spot. Use `-SailingWaterView=strand` for a standing-height view across the wash on Long Cay. At High and Ultra, sections of the incoming crest roll forward, throw spray, and leave broken strands of foam. Ultra can draw six simultaneous curling sections and High can draw three. Suspended sand changes the colour of the breaker, and a draining film leaves a reflection on the damp beach. When wading, the skipper feels the horizontal water velocity at leg depth.

`-SailingWaterView=rockwash` frames a breaker at the exposed Long Cay headland from above. The water material and the buoyancy sampler read the same rock contours. The current divides at the tip of the rock, and a small reflected wave carries foam offshore as the water drains. After moving coastal rocks, run `Tools/bake_rock_surf.py` with the Unreal Editor's `-ExecutePythonScript` to regenerate `Content/Coastal/Surf/RockFlow.bin`.

To replay the lighthouse beach approach at full throttle, use `-SailingWaterView=shore-approach` with the same recording or benchmark options.

The `pirate` water view frames the yacht alongside the two masts of *The Siren’s Light*. The `ship-shadow` view frames the shaded side of the anchored tanker. The `buoy` view frames the nearest channel marker and its moving waterline. The `canopy` view looks through the coastal woodland on Long Cay from walking height. Run `swift desktop/Tools/test_ship_shadow.swift` to render and check the tanker view, or pass a PNG from that daylight replay to check a packaged build.

## Rebuild the source content

The included Unreal packages open directly. Run the following from the repository root to regenerate the source meshes for editing or reimporting.

```sh
python3 desktop/Tools/fetch_coastal_sources.py
yarn node desktop/Tools/unpack_mesh.mjs desktop/Saved/CoastalSources/HarborLighthouse.glb desktop/Saved/CoastalSources/LightStation.glb
yarn node desktop/Tools/unpack_mesh.mjs public/models/yacht-sailboat-pbr.glb desktop/Saved/CoastalSources/Yacht.glb
yarn node desktop/Tools/unpack_mesh.mjs public/models/dolphin-animated.glb desktop/Saved/CoastalSources/Dolphin.glb
yarn node desktop/Tools/unpack_mesh.mjs public/models/trader-man.glb desktop/Saved/CoastalSources/Skipper.glb
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python desktop/Tools/coastal_geometry.py
node -r ./.pnp.cjs desktop/Tools/bake_aircraft.mjs
UE_ROOT='/Users/Shared/Epic Games/UE5/UE_5.8'
PROJECT="$PWD/desktop/SailingSimulatorDesktop.uproject"
EDITOR="$UE_ROOT/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"
"$EDITOR" "$PROJECT" -ExecutePythonScript="$PWD/desktop/Tools/create_coral_pass.py" -RenderOffscreen -unattended
```

The level script replaces actors tagged `CoralPassGenerated` and reuses existing textures, materials, and meshes. Set `SAILING_REIMPORT_MESHES` to a comma-separated list such as `Catamaran,CatamaranRig` after rebaking those meshes, or to `1` to reimport every mesh. To rebuild selected material graphs in place, compile the editor target and set `SAILING_REBUILD_MATERIALS` to their roles, for example `water,foam,ash`.

To prepare the coastal meshes again, run `desktop/Tools/prepare_coastal_models.py` in Blender with `--background --factory-startup --disable-autoexec --python-exit-code 1`. It reads the source archives from Downloads or `SAILING_DOWNLOADS`. Put `fern_02_alpha_4k.png` and `anthurium_botany_01_alpha_4k.png` beside the archives or in `SAILING_FOLIAGE_TEXTURES`. The leaf-litter normal map requires ffmpeg. Run `replace_coastal_models.py` with Unreal's `-ExecutePythonScript` to apply the models and ground finish to existing maps. Set `SAILING_REFRESH_COASTAL_MATERIALS=1` to rebuild the model materials.

To rebake the advected shore foam, run `desktop/Tools/surf_transport.py` with Blender’s Python and rebuild the `water` material with `SAILING_REIMPORT_TEXTURES=VT_SurfTransport`. To rebake just the wind waves, run `desktop/Tools/ocean_spectrum.py` with Blender’s Python. Rebuild the `water` material with `SAILING_REIMPORT_TEXTURES=VT_WindChop,VT_Capillary` to import both updated sequences. To rebake the foam and spray textures, run `desktop/Tools/breaker_foam.py` with the same Python, then rebuild the `water,spindrift` materials with `SAILING_REIMPORT_TEXTURES=T_BreakerFoam,T_BreakerSpray`.
