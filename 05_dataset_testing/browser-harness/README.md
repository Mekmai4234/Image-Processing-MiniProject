# Isolated 02 component smoke (05-owned)

This harness mounts the existing public SimulationScene component without editing the integrated app. It uses MockInspectionPort and an explicitly synthetic SVG; it never measures real detector accuracy or represents a physical webcam run. A working harness does not prove that the Simulation route has mounted the scene.

Install the frontend's existing lockfile dependencies first. From repository root:

```powershell
node apps/web/node_modules/vite/bin/vite.js --config 05_dataset_testing/browser-harness/vite.config.mjs --configLoader native
```

Open http://127.0.0.1:5187 and use Run PASS/FAIL/REVIEW DEMO, Pause/Resume, Replay, Reset and Force 2D fallback. The visible JSON records phase, destination, inspection calls and completion/replay counts. Replay should not increase inspection calls or completed count. Force fallback deliberately tests the 2D path, not GPU failure detection.

```powershell
node apps/web/node_modules/vite/bin/vite.js build --config 05_dataset_testing/browser-harness/vite.config.mjs --configLoader native --outDir ../.venv/harness-dist
```

The build output/cache stay inside the ignored .venv directory. A large Three.js bundle warning is expected; no frontend package or lockfile is changed. GPU/software rendering depends on the browser/device and must be disclosed with evidence. Screenshots are actual captures for functional smoke, not agreed visual reference images.
