# Editor bug notes: tilted card tray "becomes invisible" (2026-11-06)

## Finding
- Not a cache / in-flight / debounce / NumberField problem. In headless runs the editor mesh always matched a
  fresh kernel build exactly (vertex count, triangle count, signed volume) for every edit tried: front wall height
  0, 30, 65.6 (also digit by digit and after clearing), stack thickness 10/20/30/40, tilt angle 25,
  on both HEAD and the working tree (% front height). No build errors, no stuck builds, `failures` stayed empty.
- Reproduced "invisible": at HEAD, front wall height > inner height H (65.68 mm in the demo; e.g. 66 or 70,
  the field had no max) makes the kernel return an EMPTY mesh (0 triangles, volume 0) without throwing.
  The editor cached and drew that empty mesh: item gone, no placeholder, no "could not be generated" banner;
  only the status bar showed "1 error".
- Mechanism (outside my scope, src/boxes + src/geometry): `frontCutter` in card-tray-tilted.ts builds
  `kernel.box(..., f.topZ + f.lipH + EPS - z0, ...)` with z0 = floorZ + frontHeight; above the top the height is
  negative. `Manifold.cube` with a negative size is invalid, and any boolean with it (difference, intersection)
  returns an empty solid (checked: cube minus a negative box -> volume 0). Fix options: skip the cutter when
  z0 >= top (the working-tree % version with max 100 and `frontClosed` already avoids it), and/or make
  `kernel.box` throw or clamp on non-positive sizes.
- Stack thickness symptom: the editor and the inspector preview show the current build (matches fresh kernel
  build for T = 10/20/30/40, HEAD and working tree). At HEAD a mid-Y section shows the front plate present for
  all T. Any remaining "front plate missing / overlapping" is in the geometry (src/boxes), not the editor.

## Changes (uncommitted)
- src/preview/meshGeometry.ts: `requireNonEmptyMesh` / `EMPTY_MESH_ERROR`; empty kernel mesh is treated as a
  build failure. Used in src/preview/assemblyMeshes.ts (placeholder + failed banner) and src/ui/PreviewPane.tsx
  ("Preview failed: ..."). Unit test in src/preview/meshGeometry.test.ts.
- Dev debug hook: `__bgid.meshFailures()`, `__bgid.meshInflight()`; `assemblyBounds()` entries gain
  `vertices`, `triangles`, `volume`.

## Checks
- `npx vitest run src/preview src/ui src/state`: 81 passed. `npx tsc -b`: clean. oxlint: 0 errors (2 old warnings).

## Remaining
- Re-run the headless scenario with the fix (expect a placeholder + "1 item could not be generated" at front 70
  on HEAD; with the kernel guard the inspector now shows the thrown message instead of the empty-mesh one).
  Not done yet; to be run separately.
- DONE 2026-11-07: kernel guard + cutter audit, see "Kernel guard" below.
- Possible follow-up: the editor banner only shows a count ("1 item could not be generated"); the message is
  in `failures` (`__bgid.meshFailures()`) and in the inspector's "Preview failed: ...", not in the banner.

## Kernel guard (2026-11-07)
- src/geometry/guards.ts (new): `requirePositiveDims`, `requireFiniteOffset`, `requireValidPolygon`. Used by
  both kernels (kernel.ts, scadKernel.ts): `box` / `cylinder` / `extrude` throw on non-positive or non-finite
  sizes, non-finite positions, < 3 or non-finite polygon points (manifold kernel also: cylinder segments must be
  an integer >= 3). Message names the primitive and all values, e.g.
  `Invalid box(width=31, depth=65.5, height=-6.55): height must be a finite number > 0`.
- Error flow: thrown in `def.build` -> exporter `previewMesh` rejects -> assemblyMeshes `failures` (placeholder +
  failed banner) / PreviewPane "Preview failed: <message>". `requireNonEmptyMesh` stays as a safety net.
- src/services/exporter.ts `buildSolid`: when a build throws and the item's `validate` reports problems, the error
  leads with those problems and appends the kernel message (`explainBuildError`), so the user sees
  "Exposed height ... must be smaller than the card height ... (geometry: Invalid box(...))".
- Cutter audit: no definition change needed. Fuzzing every container type (24k random builds over param ranges,
  walls 0.1..6, floors 0.1..3) found NO throw / empty solid for any item that `validate` accepts. The only throws
  are items `validate` already flags: exposed height >= card height (negative inner height) in card-tray-upright
  (`cellCutters`), card-tray-tilted (`slotCutter`) and the stacking block (common.ts `stackedBlock`). The old
  `frontCutter` case (front > inner height) is already prevented in the working tree: `frontHeightPct` max 100
  and `frontOpen()` skips the opening cutter when closed / zero depth.
- src/boxes/param-sweep.test.ts (new, ~5 s): every standard type, each numeric param at min/default/max (well
  above default when no max) crossed with each boolean toggle / select option, plus extreme wall/floor. Invariant:
  valid solid unless `validate` flags the item. Verified it catches a regression (dropping the `frontOpen` guards
  throws on a non-finite extrude point at frontHeightPct 100).
- Tests: 343 passed (was 331). `npx tsc -b` clean; oxlint exit 0 (3 old warnings).

## Evidence
Scratchpad /tmp/claude-1000/-var-home-jmaarleveld-Desktop-board-game-designer/21c4917c-5688-48de-964b-76aba0dc5c0b/scratchpad:
pw/seq.mjs + pw/runseq.sh (headless driver), vis/fh/*.png (hv-01-Frontwallheight-70.png = item gone;
head-st-*, wt-st-* stack thickness sweeps, *-pv.png = inspector preview), vis2/*.test.ts (fresh builds, sections,
empty-mesh check).
