# CLAUDE.md

Browser app for designing 3D-printable organizer inserts for board game boxes:
enter the game box's inner size, place parametric trays in a 3D editor, stack
them, export one STL per unique part. Client-side only (Vite 8, React 19,
strict TypeScript, zustand, three.js, manifold-3d WASM for CSG, JSZip).

## Read first

- `README.md`: user workflow and scripts.
- `DESIGN.md`: architecture, units (mm, degrees), axes and frames, stacking model.
- `docs-containers.md`: the container types and the cell-tiling framework.
  The code is the truth when they disagree.
- `docs-box-design-ideas.md`: box ideas, open design questions, decisions so far.
- `docs-editor-bug-notes.md`: notes on the empty-mesh bug and the kernel guard.

## Commands

```sh
npm run dev        # Vite dev server, http://localhost:5173
npx vitest run     # full test suite (manifold WASM runs in node)
npx tsc -b         # typecheck
npx oxlint         # lint (a few old warnings are expected)
```

Run tests, typecheck and lint before committing; all must pass.

## Layout

- `src/boxes/definitions/`: one file per box type (`item-tray`, `card-tray-flat`,
  `card-tray-upright`, `card-tray-tilted`, `spacer`, `platform`) plus `tiling.ts`
  (shared cell grid) and `common.ts` (walls, stacking features). Register new
  types in `src/boxes/index.ts`.
- `src/geometry/`: kernel (`kernel.ts` manifold, `scadKernel.ts` OpenSCAD
  export). Primitives throw on non-positive or non-finite sizes (`guards.ts`);
  a cutter that can legitimately vanish must be skipped, not built with size 0.
- `src/model/`: layout, stacking (z is derived by gravity from item order), drag,
  issues.
- `src/services/`: export, persistence (migrations of old saved files live in
  `persistence.ts`), BoardGameGeek lookup.
- `src/preview/`: 3D editor scene and mesh building; `src/ui/`: panels.
- Shared contracts: `src/model/types.ts`, `src/boxes/types.ts`,
  `src/geometry/types.ts`, `src/services/contracts.ts`. Keep them stable.
- `examples/*.json`: demo designs; `containers-demo.json` and
  `stacking-demo.json` are guarded by tests, so update the tests when you change them.

## Conventions

- Every box type gets tests in the existing style: valid manifold, bounds equal
  the footprint, default params validate clean, type-specific checks.
  `src/boxes/param-sweep.test.ts` builds every type over min/default/max of each
  param; a build may only fail when `validate()` reports a problem.
- Validation messages are full sentences that include the offending values.
- When a param is removed or renamed, add a load-time migration and a test.
- Commit per finished change, with a descriptive message.

## Visual checks

Use the project skill `.claude/skills/headless-screenshot` (Vite + Chromium in
the Playwright podman image, software WebGL, step lists to select items and set
inspector fields). Don't rebuild this setup by hand. Write outputs to a scratch
directory, not the repo, and stop the server afterwards (`--stop-after` or
`shoot.sh --stop-server`).

## Environment

Fedora Kinoite host: Node 22 lives under `~/.local` (add `~/.local/bin` to PATH
if `npx` is missing); browsers run only inside podman.
