# Mobile memory and recovery

Safari's “a problem repeatedly occurred” page is a browser process failure; a React error handler cannot catch it. Memory pressure is a working diagnosis, not a confirmed crash report from the device.

- Free sailing loads marine life, traders and ships, but excludes the seven campaign-only boat, weapon and character models. `/story` retains them.
- Imported models on handheld devices are limited before GPU upload to a 1024-pixel texture edge and approximately 12 MiB of RGBA texture storage including mipmaps per model. Shared images are counted/resized once; their sampler and colour-space settings are retained. Desktop textures remain unchanged. This bounds retained texture memory, not the entire process: the source images are still decoded before resizing.
- Background asset adoption and shader compilation finish before another model is loaded. Disposed owners discard and free late results. Image bitmaps are closed when their model owner is disposed.
- The LOD registry removes nested models when their ancestor leaves the scene, and frees unused LOD index buffers without disposing shared source attributes.
- Mobile automatic quality can step down, but cannot step up into HDR/MSAA on the basis of FPS alone. Manual quality choices remain available.
- Context recovery counts only foreground time, clears an earlier error when restoration succeeds, resumes on low quality, and handles loss during initialization. Initialization checks teardown after asynchronous work; a removed route releases its WebGL context.

Regression tests cover memory budgets, shared-image ownership, late downloads after disposal, serialized adoption, route-specific assets, mobile quality policy and background recovery timing. Real-device Safari memory and long-session verification remain necessary to confirm the reported browser crash is resolved.
