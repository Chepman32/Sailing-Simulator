# Sailing Simulator Pro on Unreal Engine 5

Launch **Sailing Simulator Pro** from Applications on Apple Silicon, or open `SailingSimulatorDesktop.uproject` in Unreal Engine 5.8.4 and select **Play**. **Coral Pass** starts under sail in open water between a volcanic island and a lighthouse harbor. The `SeaTrial` map is also available in the Content Browser. The mouse stays visible and the game uses keyboard controls while its window has focus.

| Keys | Action |
| --- | --- |
| A / D | Port / starboard helm |
| Q / E, T | Sheet in / ease, resume automatic trim |
| F, W / S | Toggle the engine, raise / lower throttle |
| C | Switch between chase camera and helm |
| Scroll down / up | Widen / tighten the chase view |
| 1 / 2 / 3 / 4 | Trade winds / golden hour / squall / moonlight |
| L | Trigger a lightning strike during a squall |
| H | Toggle the instruments and controls |

The ocean mesh and Chaos buoyancy use the same wave spectrum and simulation clock. Wind chop and capillary ripples break up the sky reflections, while Single Layer Water refracts the reef, sand channels, and dolphins. The bows, twin hulls, and propeller leave separate foam trails. On the volcanic island, lava follows the ravines and ash rises from the crater in a locally ray-marched column. Golden hour brings out cloud shadows and light shafts. The squall raises the swell and adds rain and lightning.

The volcanic island pairs surveyed Mount St. Helens relief with a matching aerial photograph. The terrain, coastal rock scans, and coconut groves use Nanite. Lighting uses software Lumen, Virtual Shadow Maps, and Temporal Super Resolution on macOS. The boat has clear coat, a sewn mainsail and jib, and a textured skipper. Terrain and rock textures include 4096 × 4096 surface maps. The distant sky uses 8192 × 4096 photographs. [Asset credits](../public/models/README.md#unreal-engine-desktop-assets)

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
