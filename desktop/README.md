# Sailing Simulator Pro on Unreal Engine 5

Launch **Sailing Simulator Pro** from Applications on Apple Silicon, or open `SailingSimulatorDesktop.uproject` in Unreal Engine 5.8.4 and select **Play**. **Coral Pass** starts under sail in open water between a volcanic island and a lighthouse harbor. The `SeaTrial` map is also available in the Content Browser. Press **H** for the controls. The mouse stays visible while sailing.

| Control | Action |
| --- | --- |
| A / D or ← / → | Steer to port / starboard. Release to return the helm amidships. |
| Drag the on-screen wheel | Set and hold a rudder angle. Press C or click Center to straighten up. |
| W / S or ↑ / ↓ | Raise / lower throttle through neutral into reverse. W or ↑ also starts a stopped engine. |
| Space or the engine switch | Start / stop the engine. The lever keeps its setting. A neutral start gives 12% ahead. |
| Drag the throttle lever | Set engine power from full ahead to full astern. |
| Z / X, Y | Ease / trim the sheet, resume automatic trim with Y. |
| V or the view button | Cycle through chase, helm, orbit, and drone. |
| Left-drag the scene, scroll | Look around. Scroll to zoom in exterior views. |
| R or double-click the scene | Recenter the current view. |
| P | Enter / leave a slow cinematic orbit. Drag or scroll to frame the shot. Click, Esc, or Tab to return to sailing. |
| H, Esc | Open controls, close a panel, or pause / resume. |
| T | Go over the side in first person. Press T again from anywhere to return to the helm. The yacht holds position. |
| WASD / arrows, mouse, Shift | Walk or swim, look around, run or swim faster. The mouse is captured while exploring and released for panels. |
| Space, C / Ctrl | Jump or swim up. Hold C or Ctrl to dive, or tap it to crouch ashore. |
| E, F away from the helm | Climb aboard at a stern step or retake the wheel beside the helm. F switches the dive torch on or off. |
| Q / N, Tab | Open the chart or inspect dive equipment. Drag the chart to pan, scroll to zoom, and use R to follow the yacht or skipper again. |
| J / B, F / G at the helm | Sound the horn or ring the bell. Send a red or green signal flare. The camera follows its rise, then returns to the yacht. |
| M, O / Shift+O | Turn sound on or off. Select the next or previous radio station. The radio cycles through three SomaFM streams, the onboard shanty band, and off. |
| 1 / 2 / 3 / 4 | Trade winds / golden hour / squall / moonlight |
| L | Trigger a lightning strike during a squall |

Press **M** or click the sound button to hear the sea, wind, engine, and signals. The three SomaFM stations stream over the internet. The onboard band plays locally and also works offline.

The ocean mesh and Chaos buoyancy use the same wave spectrum and simulation clock. Wind chop and capillary ripples break up the sky reflections, while Single Layer Water refracts the reef, sand channels, and dolphins. The bows, twin hulls, and propeller leave separate foam trails. On the volcanic island, lava follows the ravines and ash rises from the crater in a locally ray-marched column. Golden hour brings out cloud shadows and light shafts. The squall raises the swell and adds rain and lightning.

The volcanic island pairs surveyed Mount St. Helens relief with a matching aerial photograph. The terrain, coastal rock scans, and coconut groves use Nanite. Lighting uses software Lumen, Virtual Shadow Maps, and Temporal Super Resolution on macOS. The boat has clear coat, a sewn mainsail and jib, and a textured skipper. Terrain and rock textures include 4096 × 4096 surface maps. The distant sky uses 8192 × 4096 photographs. [Asset credits](../public/models/README.md#unreal-engine-desktop-assets)

The renderer targets 60 FPS and adjusts the scene resolution to GPU load. Cloud shadows accumulate over several frames. In trade winds the photographed sky supplies the clouds and the empty weather volume is skipped. On larger displays, sustained GPU frame times above 29 ms also reduce the resolution of the reconstruction and post-processing passes. The instruments stay at display resolution. Boat physics runs at 60 Hz.

## Build and run on macOS

Run these commands from the repository root.

```sh
npm start            # Open the development preview and watch for saves.
npm run build        # Rebuild the Apple Silicon Shipping app and DMG.
npm run installapp   # Install the app from the DMG into /Applications.
```

The Zsh shortcuts `npm build` and `npm installapp` run the same scripts in this checkout. In another Zsh environment, load them with `source desktop/Tools/npm-commands.zsh`.

Saving C++ rebuilds the editor target and reopens the game. Saving an Unreal map, asset, or configuration file reopens the preview directly. The preview starts a fresh sailing session on reload. Press Ctrl+C to stop watching. Set `UE_ROOT` if Unreal is installed outside the default Epic Games locations.

The DMG is written to `desktop/Saved/Builds/Sailing-Simulator-Pro-macOS-arm64.dmg`. You can also open the image in Finder and drag the app to Applications. Use `npm start -- -SailingWeather=squall` for a storm preview. The `day` and `night` values select other conditions.

For a repeatable gameplay capture, launch the player with `-SailingCapture="$HOME/Library/Containers/com.YourCompany.SailingSimulatorDesktop/Data/tmp/view.png" -SailingHideHUD -UseFixedTimeStep -fps=30`. The signed macOS player writes to its app container after seven seconds of sailing and exits. Add `-SailingWide` for the wider chase framing.

To measure real gameplay frame times, launch the player with `-SailingBenchmark="$HOME/Library/Containers/com.YourCompany.SailingSimulatorDesktop/Data/tmp/sailing.csv"`. The game warms up for at least five seconds and 120 frames, measures the next 600 frames, writes the output dimensions, average FPS, 95th-percentile frame time and number of frames over 33.33 ms, then exits. Use `-SailingWeather=golden`, `day`, `squall`, or `night` to compare conditions at the same window size.

Add `-SailingBenchmarkDive` to measure the same 600 frames underwater. The benchmark uses the normal overboard and dive inputs before the warm-up.

## Rebuild the source content

The included Unreal packages open directly. Run the following from the repository root to regenerate the source meshes for editing or reimporting.

```sh
python3 desktop/Tools/fetch_coastal_sources.py
yarn node desktop/Tools/unpack_mesh.mjs public/models/yacht-sailboat-pbr.glb desktop/Saved/CoastalSources/Yacht.glb
yarn node desktop/Tools/unpack_mesh.mjs public/models/dolphin-animated.glb desktop/Saved/CoastalSources/Dolphin.glb
yarn node desktop/Tools/unpack_mesh.mjs public/models/ships/container-rm02.glb desktop/Saved/CoastalSources/ContainerShip.glb
yarn node desktop/Tools/unpack_mesh.mjs public/models/trader-man.glb desktop/Saved/CoastalSources/Skipper.glb
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python desktop/Tools/coastal_geometry.py
UE_ROOT='/Users/Shared/Epic Games/UE5/UE_5.8'
PROJECT="$PWD/desktop/SailingSimulatorDesktop.uproject"
EDITOR="$UE_ROOT/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"
"$EDITOR" "$PROJECT" -ExecutePythonScript="$PWD/desktop/Tools/create_coral_pass.py" -RenderOffscreen -unattended
```

The level script replaces actors tagged `CoralPassGenerated` and reuses existing textures, materials, and meshes. Set `SAILING_REIMPORT_MESHES` to a comma-separated list such as `Catamaran,CatamaranRig` after rebaking those meshes, or to `1` to reimport every mesh. To rebuild selected material graphs in place, compile the editor target and set `SAILING_REBUILD_MATERIALS` to their roles, for example `water,foam,ash`.
