---
name: headless-screenshot
description: Render and screenshot the board game designer app headlessly (Vite dev server + Chromium in the Playwright podman container with software WebGL). Use whenever you need to render, screenshot, visually check or verify a design / box / container / 3D view in the app, check that meshes build without failures, or drive the UI (select an item, change an inspector field, switch camera) and look at the result. Do not rebuild this route by hand.
---

# Headless screenshot of the app

This host (Fedora Kinoite) has no browser. The working route is: Vite dev
server on the host (port 5199) + `mcr.microsoft.com/playwright:v1.49.1-noble`
under podman with `--network host`, driving Chromium through `playwright-core`
1.49.1 with SwiftShader WebGL. Everything is scripted here:

- `shoot.sh` – wrapper: installs playwright-core once, starts/reuses Vite, runs the container.
- `driver.cjs` – runs inside the container: loads the design, waits for meshes, runs steps, writes PNGs + `report.json`.

## Usage

Always write outputs into **your scratchpad**, never into the repo.

```bash
SKILL=/var/home/jmaarleveld/Desktop/board-game-designer/.claude/skills/headless-screenshot
$SKILL/shoot.sh <design.json> <scratchpad>/shots [--view top|front|side|iso] \
    [--steps steps.json] [--viewport 1600x1000] [--timeout 180000] [--stop-after]
$SKILL/shoot.sh --stop-server     # stop the Vite server this script started
$SKILL/shoot.sh --server-only     # just start it (e.g. before many shots)
```

Example (validated):

```bash
$SKILL/shoot.sh examples/containers-demo.json "$SCRATCH/shots" --view iso
```

Then look at the result with the Read tool on `<out>/full.png` / `<out>/3d.png`.
First run: ~10 s npm install of playwright-core; each run afterwards ~30–40 s
(container + Chromium start-up + kernel WASM load). The server is left running
between runs so repeated shots are faster; **stop it when you are done**
(`--stop-server`, or pass `--stop-after` on the last run).

## Outputs (in the output dir)

- Without `--steps`: `full.png` (whole window) and `3d.png` (the centre 3D editor only).
- With `--steps`: whatever `shot` steps name, plus `error-stepN.png` if a step throws.
- `report.json`: WebGL renderer, console errors/warnings, page errors, every
  build check (`items`, `placeholders`, `inflight`, `builds`, `failures`,
  `kernelError`, `ms`, `ready`), the steps with results/errors.

Exit code: `0` ok, `1` fatal (page/WebGL/load failed), `2` a step failed,
`3` meshes failed to build, kernel banner shown, or the build never settled.
Check `report.json` `builds[].failures` for the kernel error messages.

## Steps file

A JSON array, run in order after the design has loaded and built. One key per step:

```json
[
  { "view": "top" },                              // camera preset: top|front|side|iso|fit
  { "shot": "top", "target": "canvas" },          // target: (none)=window | canvas | inspector
  { "select": "it-flat" },                        // item id from the design JSON, or its label
  { "field": "Columns", "value": 4 },             // Inspector field by visible label; waits for rebuild
  { "click": "Exploded" },                        // any button by accessible name (exact)
  { "key": "r" },                                 // keyboard press
  { "sleep": 500 },
  { "waitBuild": true },                          // explicit wait-for-meshes
  { "bounds": "bounds" },                         // dump __bgid.assemblyBounds() to bounds.json
  { "eval": "window.__bgid.meshBuilds" },         // JS expression; result logged + in report
  { "shot": "after", "target": "canvas" }
]
```

(No comments in the real file – JSON.) `field` handles number/text inputs
(fill + Tab), checkboxes (`true`/`false`) and selects (option label or value).
Field labels are the `.field-label` texts in the Inspector, e.g. `Cell width`,
`Columns`, `Rows`, `Inner height`, `Floor`, `Top edge`.

`--view` is applied once after load, before the steps.

## How the wait-for-build works

The app exposes a dev-only hook `window.__bgid` (only under `vite` dev, not in a
production build):

- `assemblyBounds()` (src/preview/assemblyRenderer.ts) – one entry per item with
  `placeholder` (still the grey unit box), bounds, triangle count, screen position.
- `meshInflight()`, `meshFailures()`, `meshBuilds` (src/preview/assemblyMeshes.ts) –
  kernel builds in flight, failed geometry keys → error message, build counter.
  These appear only after the first build starts.

The driver polls every 250 ms and is "ready" when: the hook exists,
`assemblyBounds().length >= items in the design`, `meshInflight() === 0`, and no
item is a placeholder (or there are failures explaining them); this must hold
for 3 polls in a row. It aborts early if the `.kernel-banner` (geometry engine
failed) shows. After a `field` step it first waits (max 3 s) for `meshBuilds`
to increase so it doesn't pass on the old mesh. Then two animation frames are
awaited before the screenshot.

## Extending

Add a `case` in `runStep()` in `driver.cjs` (each step is an object whose first
key other than `target`/`wait` names the kind). Use Playwright locators on
roles/labels the UI already has: toolbar buttons by text, the camera group
`getByRole('group', {name: 'Camera'})`, Stacks rows `getByRole('treeitem')` with
`.outline-label`, the Inspector `getByRole('region', {name: 'Inspector'})`. If
the UI changes the driver breaks first in `selectItem`/`setField`/`setView` –
fix the locator there. Don't put new dependencies in the repo's package.json.

## Pitfalls (already solved here – keep them solved)

- **WebGL**: Chromium in the container needs `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader` (plus `--ignore-gpu-blocklist`). The driver
  checks a WebGL2 context exists and fails fast otherwise. The renderer string
  reads `WebKit WebGL` (masked); that is fine.
- **playwright-core version must equal the image** (1.49.1), otherwise it looks
  for a different Chromium build. It's installed with host npm into
  `~/.cache/bgid-headless-screenshot/pw-1.49.1` and mounted read-only at `/pw`;
  the driver `require`s it by absolute path (`PW_CORE`), so it's CommonJS
  (`.cjs`) – NODE_PATH/ESM resolution is not used. Delete that dir to reinstall.
- **SELinux**: mounts use `--security-opt label=disable` instead of `:Z`; `:Z`
  would relabel repo / scratchpad files.
- `--ipc host` because the default container /dev/shm is too small for Chromium.
- **Loading a design**: the `Open` button opens a hidden
  `<input type=file accept="application/json,.json">`; the driver calls
  `setInputFiles` on that input directly (no file chooser). The toolbar shows
  "Opened design.json" because the file is mounted as `/in/design.json`.
- **Background Vite must not hold the caller's stdout**: it's started with
  `setsid -f ... </dev/null >log 2>&1`; an earlier version backgrounded it from a
  subshell, which kept a pipe open and made `shoot.sh | tail` hang for minutes
  after the shot was done. The pidfile holds the session/process-group id so
  `--stop-server` kills npx + vite together. Log: `~/.cache/bgid-headless-screenshot/vite-5199.log`.
- **Reused server**: if something already listens on 5199 (e.g. another agent's
  Vite) it is reused, and `--stop-server` won't touch it (only servers this
  script started). Use `BGID_PORT=5200 shoot.sh ...` for an isolated server.
  The served code is the live working tree, so concurrent edits in src/ show up.
- Node is in `~/.local/bin` (no system node); the script adds it to PATH.
- `__bgid` exists only in dev mode; `vite preview` / `dist` won't work with the driver.
