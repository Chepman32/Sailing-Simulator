# Sailing Simulator Pro on Unreal Engine 5

Launch **Sailing Simulator Pro** from Applications on Apple Silicon, or open `SailingSimulatorDesktop.uproject` in Unreal Engine 5.8.4 and select **Play**. **Coral Pass** starts under sail in open water between a volcanic island and a lighthouse harbor. The `SeaTrial` map is also available in the Content Browser. Press **H** for the controls. The mouse stays visible while sailing.

| Control | Action |
| --- | --- |
| A / D or ← / → | Steer to port / starboard. Release to return the helm amidships. |
| C | Center the rudder. |
| W / S or ↑ / ↓ | Raise / lower throttle through neutral into reverse. W or ↑ also starts a stopped engine. |
| Space or the engine switch | Start / stop the engine. The lever keeps its setting. A neutral start gives 12% ahead. |
| Drag the throttle lever | Set engine power from full ahead to full astern. The lever keeps its position while the engine is off. |
| Z / X, Y | Ease / trim the sheet, resume automatic trim with Y. |
| V or the view button | Cycle through chase, helm, orbit, and drone. |
| Left-drag the scene, scroll | Look around. Scroll to zoom in exterior views. |
| R or double-click the scene | Recenter the current view. |
| P | Enter / leave a slow cinematic orbit. Drag or scroll to frame the shot. Click, Esc, or Tab to return to sailing. |
| World button or comma | Open world controls. Click a setting, or use Tab and Space. Escape or comma closes the panel. |
| H, Esc | Open controls, close a panel, or pause / resume. |
| T | Go over the side in first person. Press T again from anywhere to return to the helm. The yacht holds position. |
| WASD / arrows, mouse, Shift | Walk or swim, look around, run or swim faster. The mouse is captured while exploring and released for panels. |
| Space, C / Ctrl | Jump or swim up. Hold C or Ctrl to dive, or tap it to crouch ashore. |
| E, F away from the helm | Climb aboard at a stern step or retake the wheel beside the helm. F switches the dive torch on or off. |
| Q / N, Tab | Open the chart or inspect dive equipment. Drag the chart to pan, scroll to zoom, and use R to follow the yacht or skipper again. |
| J / B, F / G at the helm | Sound the horn or ring the bell. Send a red or green signal flare. The camera follows its rise, then returns to the yacht. |
| M, O or 0 / Shift+O | Turn sound on or off. Select the next or previous radio station. The radio cycles through three SomaFM streams, the onboard shanty band, and off. |
| 1 / 2 / 3 / 4 | Trade winds / golden hour / squall / moonlight |
| L | Trigger a lightning strike during a squall |

Press **M** or click the sound button to hear the sea, wind, engine, and signals. The diesel, bell and horn use local recordings. The engine loop follows throttle and softens underwater. In **World**, the Engine sound switch mutes the motor while it continues to drive the yacht. The radio starts off. Its three SomaFM stations stream over the internet, and the onboard band plays locally.

The ocean mesh, Chaos buoyancy and swimming share one wave spectrum and one clock. In storms and hurricanes, swell trains between 104 m and 172 m form groups. Shorter wind waves between 10.6 m and 34 m cross those groups and form breaking crests on their faces. When the player changes the weather, the sea takes tens of seconds to build or settle. Foam breaks where the surface converges, trails downwind in streaks, and blows off the crests as spray. The long swell loses energy across island shelves. Along each shore, water depth determines how fast a crest travels, how much it steepens and where it spills. The swash runs up the sand and leaves a darker strip as it drains. Each hull sheds waves and foam along its course. The outside hull leaves a stronger wave in a turn, and the propeller adds a separate wash under power. The two bows throw spray independently when they enter a wave. Water leaves each bow with its impact speed, spreads in the wind and falls back into the sea. Bow impacts and an overboard splash also send rings across the water.

The loaded catamaran displaces 9.8 tonnes. Eight points under the two hulls measure the supporting water surface. Pitch and roll damping follow the rotation of the long swell. The bows lose headway when they meet a rising face. The working sail area and centre of effort decrease in a gale, with the shorter main and jib visible on the rig. The exterior camera clears incoming waves at its own position.

Two animated Fourier wave fields supply the smaller ripples that break up reflections. Each wavelength travels at its own speed. The wind-chop field also carries foam with the orbital velocity of the waves and lets it drain after a crest passes. This motion is baked into the same texture sample as the ripples. Nearby pixels reuse the ocean mesh’s long-wave slopes and evaluate the shorter waves individually. At grazing angles the material samples along the long axis of each pixel’s footprint, keeping the crosswise ripples visible in the sun path. At a distance, unresolved ripples broaden the reflected sunlight. Single Layer Water refracts the reef, sand channels, dolphins and sharks. A single 5.44 m reef shark cruises about 30 m from the yacht for 30 seconds. It takes five seconds to dive, spends a minute at depth and then rises again. The dolphin pod visits during the shark’s deep interval. Its slate back and pale underside use 4096 × 4096 colour and roughness maps. Blue whales surface offshore, with a second animal breaching in the distance. Jumping overboard carries the skipper about 1.5 m underwater in open water and draws a plume of small and large air bubbles down with him. They rise, spread and pop at the surface.

In **World**, time of day and weather can be set independently or left to cycle automatically. **Clear** gives a trade wind. **Calm** gives light air and a low residual swell. Clouds, overcast, rain, downpour, storm and hurricane are also available. Rain moves with the wind, stipples nearby water and wets the sailcloth, deck and shore. Those surfaces dry gradually when the rain passes. Distant landmarks fade into the rain with increasing storm strength. The panel shows wind, wave height and frame rate. On the volcanic island, lava follows the ravines and ash rises from the crater in a locally ray-marched column.

At Light Cay the modeled light station includes a keeper’s cottage, gallery, glazing and Fresnel lens. The pirate ship *The Siren’s Light* lies about 190 m northeast of the starting yacht, marked **Pirate ship** on the chart. A 176 m product tanker lies by the quay. A 184 m LNG carrier lies in open water beyond the lighthouse, in view from the departure area. The chart names both merchant ships. Their hulls block the yacht, chase camera and swimmer.

On approach to a beach, the yacht slows its motion toward the sand and turns along the shore. This works bow-first or in reverse. Steering toward open water gives you the helm immediately. If the hulls are already stranded, the yacht automatically refloats in clear water nearby, even with the engine off.

The volcanic island pairs surveyed Mount St. Helens relief with a matching aerial photograph. The terrain, coastal rock scans, and coconut groves use Nanite. Lighting uses software Lumen, Virtual Shadow Maps, and Temporal Super Resolution on macOS. The boat has clear coat, a sewn mainsail and jib, and a textured skipper. Terrain and rock textures include 4096 × 4096 surface maps. The distant sky uses 8192 × 4096 photographs. A small radiance map baked from the original HDR daylight exposure restores bright cloud edges in the sky and its reflection. Rebuilding this map with the source fetcher requires ffmpeg. [Asset credits](../public/models/README.md#unreal-engine-desktop-assets)

On Auto, High and Ultra, the renderer gives the GPU 33.3 ms per frame for higher-resolution water and screen-space reflections of the yacht and coast. It can run up to 60 FPS when the GPU has headroom. Low and Medium use a 16.7 ms budget and the captured sky for reflections. **World → Graphics** offers Auto, Low, Medium, High, and Ultra. Open **Resolution** to see the active monitor’s supported pixel sizes from 720p through 4K UHD. Moving the game to another monitor refreshes the choices the next time the list opens. The current desktop size uses borderless fullscreen. Smaller sizes open in a window when they fit, and the list marks sizes that need fullscreen. The standalone preview and packaged game remember both selections across launches. On macOS the renderer filters each frame’s cloud shadows spatially. In trade winds the photographed sky supplies the clouds and the empty weather volume is skipped. On larger displays, sustained GPU load above the selected budget can also lower the resolution of reconstruction and post-processing. The instruments stay at display resolution. Boat physics runs at 60 Hz.

## Build and run on macOS

Run these commands from the repository root.

```sh
npm start            # Open the development preview and watch for saves.
npm run build        # Rebuild the Apple Silicon Shipping app and DMG.
npm run installapp   # Install the app from the DMG into /Applications.
```

The Zsh shortcuts `npm build` and `npm installapp` run the same scripts in this checkout. In another Zsh environment, load them with `source desktop/Tools/npm-commands.zsh`.

Saving C++ rebuilds the editor target and reopens the game. Saving an Unreal map, asset, or configuration file reopens the preview directly. The preview starts a fresh sailing session on reload. Press Ctrl+C to stop watching. Set `UE_ROOT` if Unreal is installed outside the default Epic Games locations.

The DMG is written to `desktop/Saved/Builds/Sailing-Simulator-Pro-macOS-arm64.dmg`. You can also open the image in Finder and drag the app to Applications. Use `npm start -- -SailingWeather=hurricane` for a hurricane preview. Weather names such as `calm`, `downpour` and `storm` start in the developed sea state. The `day`, `golden`, `night` and `squall` shortcuts also work.

For a repeatable gameplay capture, launch the player with `-SailingCapture="$HOME/Library/Containers/com.YourCompany.SailingSimulatorDesktop/Data/tmp/view.png" -SailingHideHUD -UseFixedTimeStep -fps=30`. The signed macOS player writes to its app container after seven seconds of sailing and exits. Add `-SailingWide` for the wider chase framing.

To measure real gameplay frame times, launch the player with `-SailingBenchmark="$HOME/Library/Containers/com.YourCompany.SailingSimulatorDesktop/Data/tmp/sailing.csv"`. The game warms up for at least five seconds and 120 frames, measures the next 600 frames, writes the output dimensions, average FPS, 95th-percentile frame time and number of frames over 33.33 ms, then exits. Use `-SailingWeather=golden`, `day`, `squall`, or `night` to compare conditions at the same window size.

Add `-SailingBenchmarkDive` to measure the same 600 frames underwater, or `-SailingBenchmarkAlongside` to start a few metres off the moored merchant ship and sail along its hull. The dive uses the normal overboard and dive inputs before the warm-up. For repeatable water views, use `-SailingWaterView=beach`, `sail`, `turn`, `entry`, or `shark` to watch the shoreline, a sailing wake, a powered turn, an overboard jump, or a surfaced dorsal fin. Use `waterline` for a close stern-quarter view of foam and spray with the engine off. The `dolphin` and `whale` views follow a visiting animal and begin recording when it reaches the surface. To record consecutive rendered frames, supply a writable directory with `-SailingWaterFrames` and a count with `-SailingWaterFrameCount`.

To replay the lighthouse beach approach at full throttle, use `-SailingWaterView=shore-approach` with the same recording or benchmark options.

The `pirate` water view frames the yacht alongside the two masts of *The Siren’s Light*. The `ship-shadow` view frames the shaded side of the anchored tanker. Run `swift desktop/Tools/test_ship_shadow.swift` to render and check the tanker view, or pass a PNG from that daylight replay to check a packaged build.

## Rebuild the source content

The included Unreal packages open directly. Run the following from the repository root to regenerate the source meshes for editing or reimporting.

```sh
python3 desktop/Tools/fetch_coastal_sources.py
yarn node desktop/Tools/unpack_mesh.mjs desktop/Saved/CoastalSources/HarborLighthouse.glb desktop/Saved/CoastalSources/LightStation.glb
yarn node desktop/Tools/unpack_mesh.mjs public/models/yacht-sailboat-pbr.glb desktop/Saved/CoastalSources/Yacht.glb
yarn node desktop/Tools/unpack_mesh.mjs public/models/dolphin-animated.glb desktop/Saved/CoastalSources/Dolphin.glb
yarn node desktop/Tools/unpack_mesh.mjs public/models/trader-man.glb desktop/Saved/CoastalSources/Skipper.glb
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python desktop/Tools/coastal_geometry.py
UE_ROOT='/Users/Shared/Epic Games/UE5/UE_5.8'
PROJECT="$PWD/desktop/SailingSimulatorDesktop.uproject"
EDITOR="$UE_ROOT/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"
"$EDITOR" "$PROJECT" -ExecutePythonScript="$PWD/desktop/Tools/create_coral_pass.py" -RenderOffscreen -unattended
```

The level script replaces actors tagged `CoralPassGenerated` and reuses existing textures, materials, and meshes. Set `SAILING_REIMPORT_MESHES` to a comma-separated list such as `Catamaran,CatamaranRig` after rebaking those meshes, or to `1` to reimport every mesh. To rebuild selected material graphs in place, compile the editor target and set `SAILING_REBUILD_MATERIALS` to their roles, for example `water,foam,ash`.

To rebake just the wind waves, run `desktop/Tools/ocean_spectrum.py` with Blender’s Python. Rebuild the `water` material with `SAILING_REIMPORT_TEXTURES=VT_WindChop,VT_Capillary` to import both updated sequences. To rebake the foam and spray textures, run `desktop/Tools/breaker_foam.py` with the same Python, then rebuild the `water,spindrift` materials with `SAILING_REIMPORT_TEXTURES=T_BreakerFoam,T_BreakerSpray`.
