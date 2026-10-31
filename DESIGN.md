# Board Game Insert Designer — Design Document

A browser application for designing 3D‑printed, tileable organizer boxes ("inserts")
that fill a board game box. The user enters the game box's inner dimensions, a
tolerance, and drags parametric standard boxes into a top‑down view. The app then
produces one STL per box, ready for slicing.

## 1. Stack

| Concern              | Choice                                         |
|----------------------|------------------------------------------------|
| Build / dev server   | Vite 8, TypeScript (strict), React 19          |
| State                | zustand (single store, `src/state/store.ts`)   |
| Top view             | plain SVG, pointer events (no canvas lib)      |
| Solid geometry (CSG) | `manifold-3d` (WASM, exact booleans, manifold output) |
| 3D preview           | `three` (BufferGeometry from kernel mesh)      |
| Multi‑file download  | `jszip`                                        |
| Tests                | vitest (node environment; manifold WASM runs in node) |

No backend. Everything runs client‑side. The only network call is the optional
BoardGameGeek lookup, which goes through the Vite dev proxy (`/api/bgg`) because
BGG's XML API does not send CORS headers.

## 2. Units, axes and coordinate frames

* All lengths are **millimetres**. All angles are degrees.
* **Game box frame** (top view): origin is the inner top‑left corner of the game
  box. `x` grows to the right (box *width*), `y` grows downward (box *depth*),
  exactly like SVG. `z` is up (box *height*).
* **Usable area**: the game box inner rectangle shrunk by the tolerance, centred:
  `usable.x0 = tol.x / 2`, `usable.width = box.width - tol.x` (same for y / depth).
  Tolerance is therefore the *total* slack that remains after tiling, per axis.
* **Item placement**: `item.x, item.y` is the top‑left corner of the item's *outer*
  footprint in the game box frame. `rotation` is `0` or `90`; at `90` the
  footprint's width and depth are swapped. Rotation affects placement only —
  STL geometry is always generated unrotated.
* **Item local frame / STL frame**: origin at the outer bottom corner,
  `X = width`, `Y = depth`, `Z = up`, floor on `Z = 0`. STL files are binary,
  in mm, one solid per file.

## 3. Data model (`src/model/types.ts`)

```
Project
 ├ version: 1
 ├ settings: ProjectSettings
 │   ├ name
 │   ├ box: { width, depth, height }        inner dimensions of the game box
 │   ├ tolerance: { x, y }                  total slack left per axis
 │   ├ defaults: { wall, floor }            project‑wide wall / floor thickness
 │   └ gridSnap                             snapping increment in the top view (0 = off)
 └ items: PlacedItem[]
     ├ id, type (box type id), label
     ├ x, y, rotation (0 | 90)
     ├ z?                                   bottom elevation in mm (undefined → 0)
     ├ wall?, floor?                        per‑item overrides (undefined → project default)
     └ params: Record<string, number|boolean|string>   type‑specific parameters
```

`resolveItem(item, settings)` (in `src/model/resolve.ts`) merges defaults and
parameter defaults into a `ResolvedItem` that box definitions consume.

**Elevation (`z`).** Items can be stacked. `itemRect` reports `z` and
`top = z + height`. Two items collide when they overlap in XY *and* in Z, where
the upper item's effective bottom is `z + engagement` (see §4). `itemsTooTall`
uses `top`. `unsupportedItems` flags items with `z > 0` whose XY rect is not
fully covered (exactly, by coordinate compression) by the union of items whose
`top = z + engagement` (±0.01 mm); `layoutSummary` reports them as
`kind: 'floating'` warnings. `restingElevation` = max top of XY‑overlapping
items − engagement (0 if none). `z` does not affect geometry or the exporter's
dedupe key. Persistence accepts a missing or finite non‑negative `z`.

## 4. Box type registry (`src/boxes/`)

Every standard box is a `BoxTypeDefinition` registered in `src/boxes/registry.ts`.
The UI is fully generic: it renders the parameter form from `params: ParamSpec[]`,
draws the top view from `draw()`, and places items using `footprint()`. Adding a
new box type means adding one file under `src/boxes/definitions/` and registering it
in `src/boxes/index.ts`; nothing else changes.

Conventions for definitions:

* Types with a cavity expose `innerWidth`, `innerDepth`, `innerHeight` params
  (so the UI can later offer "stretch to fit" generically).
* `footprint()` returns the **outer** size (unrotated) — inner + 2·wall, height =
  inner height + floor.
* `build(item, kernel)` returns a single `Solid` in the item local frame.
* `draw(item)` returns `TopViewFeature[]` in the item local frame (unrotated,
  mm); the UI applies translation/rotation. Roles: `cavity`, `divider`, `notch`,
  `solid`.

**Stacking.** `stackEngagement?(item)` returns how many mm of the item's base
sink into the item below (0/undefined for flat bases); use `engagementOf(def,
item)`. The cavity types share a *Stacking* parameter group (`common.ts`:
`stackTop` `none|lip`, `stackBottom` `none|recess|plug`, `lipHeight` 2,
`plugHeight` 2, `stackClearance` 0.15). The lip is the outer `wall/2` of the
wall raised by `lipHeight`; the recess is a ring `wall/2 + clearance` wide and
`lipHeight + clearance` deep cut from the outer bottom edge (engagement =
`lipHeight`); the plug is an `(inner − 2·clearance)` pad of `plugHeight` under
the floor (engagement = `plugHeight`, floor at `Z = plugHeight`, the local
origin stays the lowest point). Footprint height = `plug + floor + inner + lip`.
They are designed for same‑footprint, same‑wall trays. The `platform` type is
a plate with optional corner stops (engagement = `stopHeight`).

### 4.1 Initial standard box set (v1 — a starting point we will iterate on)

| id             | Purpose                                     | Key params |
|----------------|---------------------------------------------|------------|
| `tray`         | Plain open‑top tray                         | innerWidth/Depth/Height, fingerNotch, notchWidth, notchDepth, notchSides (`long`/`short`/`both`) |
| `divided-tray` | Tray with an N×M grid of compartments       | innerWidth/Depth/Height, columns, rows, dividerThickness, dividerHeight |
| `card-tray`    | Holder for a card stack                     | cardWidth, cardHeight, clearance, stackHeight, orientation (`flat`/`upright`), exposedHeight (upright), notchWidth |
| `spacer`       | Solid filler block to take up slack         | width, depth, height |
| `platform`     | Plate bridging trays to carry the next level | width, depth, thickness, cornerStops, stopSize, stopHeight, stopInset |

Finger notches are rounded slots (a box plus a cylinder at the bottom of the
cut) subtracted from the wall, centred on the wall, `notchWidth` wide and
`notchDepth` deep from the top edge.

## 5. Geometry kernel (`src/geometry/kernel.ts`)

A thin, testable wrapper over manifold‑3d, exposing an opaque `Solid` type and
corner‑origin primitives (`box`, `cylinder`, `extrude`), booleans (`union`,
`difference`), transforms, `volume`, `bounds`, `toMesh` (for three.js) and
`toSTL` (binary STL `ArrayBuffer`). `createKernel()` loads the WASM module once
and is awaited at app start. The kernel is the only module that imports
`manifold-3d`.

## 6. UI (`src/ui/`, `src/state/`)

Three‑pane layout:

1. **Left — palette & settings**: game box size (manual entry or BGG lookup),
   tolerance x/y, default wall/floor, grid snap; list of box types to add
   (click or drag into the view).
2. **Centre — top view** (SVG): game box outline, usable area (tolerance
   band hatched), placed items with their top‑view features, labels and
   dimensions. Drag to move, `R` to rotate, `Delete` to remove, `Ctrl+D`
   duplicate, `Ctrl+Shift+D` duplicate on top (stacked), `Ctrl+Z/Y` undo/redo. Snapping to the grid, to the usable‑area
   edges and to neighbouring item edges. Overlapping items, items outside the
   usable area and items taller than the box are highlighted and listed in a
   validation panel.
3. **Right — inspector**: label, position, rotation, wall/floor override
   (checkbox "override project default" + value), generated parameter form,
   computed outer footprint, 3D preview of the selected item, export buttons.

Status bar: remaining slack in x / y given the current layout (bounding box of
items vs usable area), total item count, validation summary.

## 7. Services (`src/services/`)

* `bgg.ts` — search BoardGameGeek and read box dimensions from the
  `thing?versions=1` endpoint (inches → mm). Optional; manual entry is primary.
  BGG reports *outer* dimensions, so the UI applies a configurable cardboard
  deduction before filling the inner size. BGG's API requires a registered
  application token; the Vite proxy forwards it from the `BGG_TOKEN` environment
  variable as a Bearer header.
* `persistence.ts` — autosave to `localStorage`, JSON import/export with
  validation.
* `exporter.ts` — builds every item with the kernel, writes binary STLs, dedupes
  identical items (same type/params/wall/floor) into one file with a count, and
  packs them with a `manifest.txt` into a zip.
* `download.ts` — trigger a browser download for a Blob.
* `src/preview/Preview3D.tsx` — three.js viewer for a `MeshData` (single item).
* `src/preview/AssemblyView.tsx` — "Assembly" tab: the whole game box as a
  translucent shell with every item placed from the layout. One mesh per unique
  geometry (exporter's `geometryKey`) in a shared LRU cache; moves and rotations
  only update transforms (including the `z` elevation). Items whose top is above
  the box are tinted red, overlapping / intersecting or out‑of‑area items
  orange, floating (unsupported) stacked items light blue. Note: the scene root is mirrored in Y
  (`scale(1,-1,1)`) so the view reads like the top view (x right, y down); this
  mirrors chiral geometry, which is invisible for the current symmetric boxes.
* `src/geometry/scadKernel.ts` — a second `GeometryKernel` that records calls
  and emits OpenSCAD source; the exporter writes a `.scad` next to every `.stl`.

## 8. Module ownership (parallel implementation)

| Area                                   | Owner agent  |
|----------------------------------------|--------------|
| `src/geometry/*`, `src/boxes/*`, tests | geometry     |
| `src/state/*`, `src/ui/*`, `src/model/layout.ts`, `src/App.tsx`, styles | ui |
| `src/services/*`, `src/preview/*`      | services     |
| Final wiring, build, smoke test        | integration  |

Shared contracts (written before the agents start, do not change without
updating all owners): `src/model/types.ts`, `src/model/resolve.ts`,
`src/boxes/types.ts`, `src/boxes/registry.ts`, `src/geometry/types.ts`,
`src/services/contracts.ts`.
