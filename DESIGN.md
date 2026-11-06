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
| Editor               | `three` 3D editor (centre pane); plain SVG mini‑map |
| Solid geometry (CSG) | `manifold-3d` (WASM, exact booleans, manifold output) |
| 3D preview           | `three` (BufferGeometry from kernel mesh)      |
| Multi‑file download  | `jszip`                                        |
| Tests                | vitest (node environment; manifold WASM runs in node) |

No backend. Everything runs client‑side. The only network call is the optional
BoardGameGeek lookup, which goes through the Vite dev proxy (`/api/bgg`) because
BGG's XML API does not send CORS headers.

## 2. Units, axes and coordinate frames

* All lengths are **millimetres**. All angles are degrees.
* **Game box frame**: origin is an inner bottom corner of the game box. `x`
  runs along the box *width*, `y` along the box *depth*, `z` is up (box
  *height*); right‑handed, like the STL frame. **On screen (y‑up)**: the 3D
  editor shows x to the right and y *up* the screen in the Top preset, i.e.
  the origin is the front‑left corner and the `y = 0` edge is the one nearest
  the viewer in the Front / Iso presets. Nothing is mirrored (a proper camera
  cannot show x right *and* y down). The mini‑map (§6) draws the same y‑up
  picture (its SVG is flipped: svg y = depth − y).
* **Stack order and gravity**: an item's elevation is not entered; it is
  derived. The order of `Project.items` is the stack order: each item rests on
  the highest effective surface (`top − engagement`, §4) of the *earlier*
  items it overlaps in XY, or on the floor (`settle` in `src/model/layout.ts`).
  Later in the array = higher up a stack.
* **Usable area**: the game box inner rectangle shrunk by the tolerance, centred:
  `usable.x0 = tol.x / 2`, `usable.width = box.width - tol.x` (same for y / depth).
  Tolerance is therefore the *total* slack that remains after tiling, per axis.
* **Item placement**: `item.x, item.y` is the minimum‑x, minimum‑y corner of the item's *outer*
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
 │   └ gridSnap                             snapping increment for drag / nudge (0 = off)
 └ items: PlacedItem[]
     ├ id, type (box type id), label
     ├ x, y, rotation (0 | 90)
     ├ z?                                   bottom elevation in mm (undefined → 0); derived cache, see below
     ├ wall?, floor?                        per‑item overrides (undefined → project default)
     └ params: Record<string, number|boolean|string>   type‑specific parameters
```

`resolveItem(item, settings, items?)` (in `src/model/resolve.ts`) merges
defaults and parameter defaults into a `ResolvedItem` that box definitions
consume; given the project's `items` it also attaches the item's build context
(§4.2).

**Elevation (`z`).** Items can be stacked. `z` is derived by gravity from the
stack order (§2): `settle(items, settings)` walks the items in order and sets
each one's `z` to max over the earlier XY‑overlapping items `o` of
`o.top − engagement(item on o)` (0 if none), rounded to 0.001 mm (0 ⇒ the field
is deleted). It returns unchanged items (and, when nothing changes, the array)
by identity, so memo keys and mesh caches stay valid; ridged platforms (whose
height depends on what rests on them, §4.2) are handled by repeating the pass
until nothing changes. The stored `z` is a cache: the store re‑settles after
every change of the items or the settings, and `loadProject` migrates files
(including those saved before z was derived) by sorting the items on their
stored `z` (stable) and settling (`migrateStackOrder`). `itemRect` reports `z` and
`top = z + height`. Two items collide when they overlap in XY *and* in Z, where
the upper item's effective bottom is `z + engagement` (see §4). `itemsTooTall`
uses `top`. `unsupportedItems` flags items with `z > 0` whose XY rect is not
fully covered (exactly, by coordinate compression) by the union of items whose
`top = z + engagement` (±0.01 mm); `layoutSummary` reports them as
`kind: 'floating'` warnings (unless the stack fit check already reports
the item, §4.3); with gravity they only occur in edge cases. `restingElevation` = max top of XY‑overlapping
items − engagement (0 if none), regardless of order. An item's own `z` does not affect its geometry
or the exporter's dedupe key (but the `z` of items resting on a platform with
locating ridges affects the platform's, §4.2). `itemRect` / `safeItemRect` /
`placedFootprint` take the project's `items` as an optional last argument so
context‑dependent heights count; the layout functions always pass them. `itemsTooTall` uses `effectiveTop` (top incl. keep‑out space, §4.3). Persistence accepts a missing or finite non‑negative `z`.

## 4. Box type registry (`src/boxes/`)

Every standard box is a `BoxTypeDefinition` registered in `src/boxes/registry.ts`.
The UI is fully generic: it renders the parameter form from `params: ParamSpec[]`,
draws the mini‑map footprints from `draw()`, and places items using `footprint()`. Adding a
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

**Stacking.** `stackEngagement?(item, below?)` returns how many mm of the
item's base sink into `below`, the item it stands on (0/undefined for flat
bases); use `engagementOf(def, item, below)`. Engagement is per pair: the
layout (`settle`, `restingElevation`, `unsupportedItems`, the overlap/intersection
checks) always passes `below`; without it the nominal
engagement against a matching partner is returned. An item on several items
rests at max over them of `top − engagement(item on it)` and is supported by
those that meet that z (within `SUPPORT_TOL`; `supportersById`).

**Moving stacks.** `moveStack(id, dx, dy, { carry })` in the store: with
`carry`, the item moves together with everything resting on it, directly or
transitively (`carriedItemIds`); an item resting on several items (a bridge)
is carried only when *all* its supporters move, otherwise it stays and
re‑settles; the moved items go to the end of the stack order (keeping their
relative order), so they land on top of whatever they now overlap. Without
`carry` (Alt+drag, "pull out") only the item moves; it and everything resting
on it, directly or through any supporter (`stackedAboveIds`), go to the end of
the order, but only the item changes position. So the items on it stay on it
while they still overlap it and drop to whatever is under them once it slides
out, and the pulled item climbs onto what it is pushed over (neighbours never
jump onto it). `moveItem(id, x, y)` is `moveStack` with `carry`.
`duplicateItemStacked` inserts the copy (same x/y) right after the source, so
it rests on it; `reorderItem(id, toIndex)` changes the stack order. The cavity types share a *Stacking* parameter group (`common.ts`:
`stackTop` `none|lip`, `stackBottom` `none|recess|plug`, `lipHeight` 2,
`plugHeight` 2, `stackClearance` 0.15). The lip is the outer `wall/2` of the
wall raised by `lipHeight`; the recess is a ring `wall/2 + clearance` wide and
`lipHeight + clearance` deep cut from the outer bottom edge (engagement =
`lipHeight`, but only on an item whose `stackTop` is `lip`; 0 on anything
else); the plug (a retrofit for stacking onto an already printed plain tray:
needs an empty cavity below and takes `plugHeight` of it) is an `(inner − 2·clearance)` pad of `plugHeight` under
the floor (engagement = `plugHeight`, floor at `Z = plugHeight`, the local
origin stays the lowest point). Footprint height = `plug + floor + inner + lip`.
They are designed for same‑footprint, same‑wall trays. Lip + recess is the
standard: the four cavity types set `newItemParams: { stackTop: 'lip',
stackBottom: 'recess' }`.

**Creation‑time params.** `BoxTypeDefinition.newItemParams?` holds values for
items newly added from the UI; the store's `addItem` (palette click and
top‑view drop both go through it) uses `newItemParams(def)` = ParamSpec
defaults + `def.newItemParams`. Duplicates copy the source, loading a file or
the sample resolves missing keys against the ParamSpec defaults, so changing
`newItemParams` never changes existing geometry. The `platform` type is
a plate with optional corner stops (engagement = `stopHeight`).

### 4.1 Standard box set

| id             | Purpose                                     | Key params |
|----------------|---------------------------------------------|------------|
| `item-tray`    | Token tray, N×M cells, flat or scoop floor  | innerWidth/Depth/Height (one cell), columns, rows, dividerThickness (dividers always full height), floorShape (`flat`/`scoop`), scoopSides (`long`/`short`), scoopRise |
| `card-tray-flat` | Card stacks lying flat, finger gaps into a raised floor (never through it), repeats along X | cardParams, columns, dividerThickness, gapWidth, gapFloorDepth, gapReach, gapSides (`sides`/`ends`/`both`) |
| `card-tray-upright` | Card stacks standing, wedges in the long walls, repeats along X | cardParams, exposedHeight, columns, dividerThickness, dividerHeight, wedges, wedgeTopWidth, wedgeBottomWidth, wedgeDepth (sizes 0 = auto, relative to the cell) |
| `card-tray-tilted` | Card display / dispenser: stacks leaning back, stepped one behind the other along X with tilted dividers, open front | cardParams, tiltAngle, exposedHeight, frontHeight, columns, dividerThickness, dividerHeight |
| `spacer`       | Solid filler block to take up slack         | width, depth, height |
| `platform`     | Plate bridging trays to carry the next level | width, depth, thickness, cornerStops, stopSize, stopHeight, stopInset, locateItems |

`cardParams` (`common.ts`, group "Cards") = cardWidth, cardHeight, clearance,
stackHeight. The four container types are built on the tiling framework (§4.4); the
tilted tray is the first **chiral** type (its mirror image is a different
part), which makes the open question about the mirrored assembly view in
`docs-box-design-ideas.md` ("Decisions so far") live.

**v1 types deleted, migrated on load.** The v1 `tray`, `divided-tray` and
`card-tray` (with rounded finger notches) were deleted on 2026-11-06.
`validateProject` (`services/persistence.ts`) maps them with
`migrateLegacyItem`, keeping the outer footprint, the stacking params and the
wall / floor overrides: `tray` → `item-tray` 1 × 1 with the same inner size;
`divided-tray` (inner W × D, c × r, dividers t) → `item-tray` c × r with cells
(W − (c−1)·t)/c × (D − (r−1)·t)/r; `card-tray` → `card-tray-flat` or
`card-tray-upright` by its `orientation` (flat with `gapFloorDepth` 0, so the
raised floor does not change the height). Finger notch params are dropped (no
equivalent); omitted params are filled with the v1 defaults where those
differ. `examples/stacking-demo.json` and the sample project were migrated
with the same function.

### 4.2 Build context (geometry that depends on other items)

Most boxes are self‑contained: their geometry depends only on their own
resolved type / wall / floor / params. The platform's locating ridges depend on
the items resting on it, so the contract has an opt‑in build context:

* `BoxTypeDefinition.usesItemsAbove?(item)` — return true (for the resolved
  item without context) to receive one. The platform returns `locateItems`.
* The context is computed in **one place**, `buildContext` in
  `src/model/resolve.ts`, called by `resolveItem(item, settings, items)`, and
  stored as `ResolvedItem.context = { itemsAbove: ItemAbove[] }`.
  `itemsAbove` are the items that overlap the item in XY (strictly) whose `z`
  equals its **context‑free** top (`z` + footprint height without context,
  within `SUPPORT_TOL`), each as `{ id, x, y, width, depth, wall,
  stackBottom, lipHeight }` with the rect in the item's local frame (both
  rotations applied; at rotation 90 `u = Y − y`, `v = x + d − X`), sorted by
  id. It only uses context‑free footprints, so there are no cycles.
* `footprint`, `build` and `draw` may read `item.context` (width and depth must
  not depend on it). `seatDepth?(item)` says how far below the outer top lies
  the surface items rest on; the layout adds it to every engagement on that
  item (`pairEngagement` = own `stackEngagement` + `seatDepth` of the item
  below). `describeContext?(item)` gives the inspector the ids it is based on
  and a note.
* Every consumer that builds, draws, sizes or keys geometry passes the
  project's items: the layout (`stackRects`, `itemsTooTall`, validation), the
  store (`settle`), the mini‑map, the inspector, the exporter
  (`buildSolid`, OpenSCAD, manifest) and the 3D editor (`localSize`,
  `classifyItems`). `geometryKey` includes the context (ids dropped, entries
  sorted), so the export dedupe, the item preview key (`PreviewPane`) and the
  assembly mesh cache rebuild a platform when an item on it moves or changes,
  while identical ridged platforms still dedupe.

**Platform ridges.** For every item above with `stackBottom = 'recess'` and
`lipHeight > 0`: a ring along its outer footprint edge, `wall/2` of its wall
wide, `lipHeight` high, standing on the plate top (Z = stopHeight +
thickness), clipped to the plate; rings are unioned, so edge‑to‑edge
neighbours merge. Outer height = stops + thickness + the tallest ridge (only
when a ridge exists); `seatDepth` = that ridge height, so everything on the
plate rests at the plate top (for equal lip heights this is the recess
engaging `lipHeight`; flat items next to ridged ones rest there too). With
`locateItems` off there is no context and the platform is a flat plate.

### 4.3 Stack fit check (`stackFit` in `src/model/layout.ts`)

The support check (§3) only compares footprints. The fit check compares the
base of a stacked item with the top of what it rests on. Three optional hooks,
all in the item's local unrotated frame (as `draw`); the layout maps them to
the game box frame in one place, `localToBoxRect` in `src/model/resolve.ts`
(rotation 90: local `(u, v)` → `(x + d − v, y + u)`, `d` = unrotated depth):

* `bearingAreas?(item): BearingArea[]` — top faces `{ x, y, width, depth,
  height, role?, name? }`, `height` = local Z of the face. `role`: `bearing`
  (default), `lip` (a locating lip / ridge: carries a flat base resting on it,
  must otherwise lie under a recess), `low` (solid, carries nothing). Without
  the hook (`bearingAreasOf`): the whole footprint at `height − seatDepth`.
  Container types (`tiledBearingAreas`, outer ring via `cavityBearingAreas` in
  `common.ts`): the wall ring at the wall top; with a lip the lip ring (outer
  `wall/2`, role `lip`, at the lip top) plus the inner wall half at the wall
  top; plus every divider at its top, role `low` when `dividerHeight` is below
  the inner height. Platform:
  the plate at the plate top plus its ridges (role `lip`). Spacer: the whole top.
* `baseFeatures?(item): BaseFeature[]` — `{ kind: 'recess' | 'protrusion', x,
  y, width, depth, height, name }`. Cavity types (`cavityBaseFeatures`): the
  recess ring (`wall/2 + clearance` wide, `lipHeight + clearance` high) or the
  plug pad (`inner − 2·clearance`, `plugHeight`). Platform: the corner stops.
  The item's lowest point is `z`; its main base is at `z + P` (P = tallest
  protrusion); under a recess the base is that much higher.
* `keepOut?(item): KeepOut[]` — `{ x, y, width, depth, height, name, fix? }`,
  space above the outer top that must stay free. Upright card tray: its cavity,
  `exposedHeight − lipHeight` high.

Rules, for every item with `z > 0` and at least one supporter (`o.top −
engagement(item on o) = z` within `SUPPORT_TOL`):

1. **Bearing.** Contact = footprint ∩ the supporters' bearing areas (not
   `low`) whose absolute height is in `[z, z + own engagement on that
   supporter]` (± `SUPPORT_TOL`; the own engagement excludes the supporter's
   seat depth). No contact → error `kind: 'stack-fit'` ("rests on nothing").
   Otherwise the footprint centre must lie inside the convex hull of the
   contact rects by at least `TIP_MARGIN_FRACTION` (0.1) × the item's smaller
   side, else warning `kind: 'unstable'` ("may tip"). Per item only one support
   message: rests on nothing > may tip > floating. Items with no supporter at
   all keep the plain floating warning.
2. **Fit.** For every bearing area (any role) of a supporter that overlaps the
   footprint and rises above `z`: split the overlap by the item's base features
   (coordinate compression) and compare per cell with the base height there
   (`z` under a protrusion, `z + P + recess` under a recess, `z + P`
   elsewhere). Higher → error `kind: 'stack-fit'`, one per (item, supporter,
   part): a protrusion ("its plug does not fit into …"), a lip / ridge under the
   floor ("collides with the lips of …"), anything else ("collides with …").
   This covers lip/recess alignment, plugs on dividers or on solid tops (the
   plug engagement stays `plugHeight` on anything, so the plug is reported
   rather than silently lifted), and corner stops on solid tops.
3. **Keep‑out.** Any other item that overlaps a keep‑out rect in XY and whose
   Z range intersects `(top, top + height)` → error `kind: 'stack-fit'`
   (intruder, keeper). `effectiveTop` = max(top, keep‑out tops) is used by
   "too tall" and by the 3D editor's `tall` tint.

`floatingItemIds` returns the stacked item of every `floating` or `unstable`
issue (light blue in the 3D editor); stack‑fit errors are ordinary errors
(orange in the 3D editor and the mini‑map, red outline in the mini‑map).
`examples/stacking-demo.json` exercises the cases A–J and L–S (case K, a tray
sunk into another, was dropped: gravity cannot produce it). Tests check that
its stored `z` values are exactly what `settle` gives and that each item's
label suffix — `(OK)`, `(warning)`, `(error)`, `(flagged with X)` — matches the
summary of the settled layout.

### 4.4 Cell tiling framework (`src/boxes/definitions/tiling.ts`)

A box type describes **one cell** (a cavity plus its access features) and the
framework repeats it `cols` times along X and `rows` times along Y inside one
printed part with shared inner walls. Box types never loop over cells.

* `CellSpec` — `width`, `depth`, `height` (inner size of one cell, axis aligned
  bounding box) and optional `pitchX` / `pitchY` (distance between cell
  origins; default size + `divider`).
* `CellFrame` — what the framework hands the cell functions: `col`, `row`,
  `x`, `y` (inner origin in the outer frame), the cell size, `floorZ` (plug +
  floor), `topZ` (wall top), `lipH` (stacking lip on the outer walls, 0 if
  none), `dividerTopZ` (`topZ`, or `floorZ + dividerHeight` when dividers are
  lowered), `sides` (thickness of the material on each side: `wall` for an
  outer wall, the gap to the neighbour for a divider) and `outer` (which sides
  are outer walls). A cutter spanning `[x − sides.left − EPS, x + EPS]` cuts
  exactly through the left wall or divider.
* `TiledBoxSpec` — `cols`, `rows`, `cell`, `wall`, `floor`, `divider`,
  `stacking`, plus the callbacks `cellCutters(kernel, frame)` (solids to
  subtract: the cavity, which must reach through the lip, and access
  features), `cellDraw(frame)` (mini‑map features), optional
  `cellBearing(frame)`, optional `dividerHeight` (lowered when 0 < h < cell
  height) and `straightDividers` (default true; false when dividers are not
  straight vertical walls: the framework then neither draws, reports nor
  lowers them, and an explicit pitch may be smaller than the cell size, i.e.
  the cells' bounding boxes may overlap as long as the cavities do not; the
  type then validates its divider thickness itself).

Outer size: W = 2·wall + (cols − 1)·pitchX + cell.width, D likewise, H =
`stackedHeight(cell.height, floor, stacking)`. Cell (col, row) has its inner
origin at `(wall + col·pitchX, wall + row·pitchY, plug + floor)`.

**Framework functions.** `tiledLayout` derives the numbers above (counts
rounded to whole numbers ≥ 1); `tiledFootprint`; `cellFrames` (row‑major, row
0 = front, col 0 = left); `dividerRects` (one per column boundary spanning the
inner depth, one per row boundary spanning the inner width, role `divider`);
`tiledBuild` = `stackedBlock` (outer box + lip ring + plug pad − recess ring,
no cavity) minus the strips above lowered dividers minus every
cell's cutters, in one boolean; `tiledDraw` (cavities, then dividers, then
notches); `tiledBearingAreas` (outer ring via `cavityBearingAreas`, dividers
as `bearing` or `low`, plus cell areas); `tiledBaseFeatures`;
`tiledValidate` (whole counts ≥ 1, wall / floor > 0, divider thickness > 0
when more than one cell, pitch ≥ cell size unless `straightDividers` is
false, divider height range,
`validateStacking`); `tilingParams(axes)` (group "Repeat": `columns` and / or
`rows` for `'x'` / `'y'` / `'xy'`, plus `dividerThickness`, default 1 / 1 /
1.2 mm); `dividerHeightParam`; `tilingOf(item, axes)` (raw counts as given:
the framework rounds, `tiledValidate` reports).

**Conventions.** Dividers never carry the stacking lip (it is the outer half of
the outer wall only), so a recessed base above rests on the inner wall half
and on full‑height dividers. A feature in a shared divider is cut by one cell
only: a cell cuts its left / front side only when that side is outer, its
right / back side always. Shared dividers are `divider` thick, not `wall`.

**Per type.** `item-tray` (X and Y): optional shallow trough floor per cell
(a circular segment between two opposite walls, rising `scoopRise` at them);
dividers always full height. `card-tray-flat` (X): rectangular finger gaps
through the walls that continue `gapFloorDepth` into the floor and `gapReach`
(default 10 mm) into the cavity under the cards; with gaps the cavity floor is
raised by `gapFloorDepth` (the spec's floor is `floor + gapFloorDepth`), so the
groove ends on the structural floor and never breaks through, and the outer
height grows by `gapFloorDepth`. `card-tray-upright` (X): trapezoid wedges in
the two outer long walls (cell X = stackHeight + c, Z = cardHeight −
exposedHeight), toggled by `wedges`; sizes 0 = auto: top 60 % of the cell X
span, bottom 40 % of the top, depth 60 % of the inner height; `keepOut` for the
standing cards. `card-tray-tilted`
(X, stepped): cell width = H·tan θ + s with s = T/cos θ and H = (cardHeight −
exposedHeight)·cos θ, pitch s + t/cos θ (smaller than the cell: the framework
allows that with `straightDividers: false`), so a tilted divider t thick stands
between neighbouring slots; `dividerHeight` lowers those dividers (the type
cuts them itself; about `frontHeight` gives a terraced display where each deck
leans on the one behind); slot 0 may notch the back lip on steep tilts; only
the front wall (last slot) gets the opening above `frontHeight`; its bearing
areas wrap the framework's (front opening removed, a `low` shelf at
`frontHeight`, tilted divider tops added); `keepOut` height is exposed·cos θ +
stackHeight·sin θ − lipH and may start at negative local x (cards overhang the
back; `keepOutViolations` checks that, `itemsOutsideUsable` ignores keep‑outs).
See `docs-containers.md`.

## 5. Geometry kernel (`src/geometry/kernel.ts`)

A thin, testable wrapper over manifold‑3d, exposing an opaque `Solid` type and
corner‑origin primitives (`box`, `cylinder`, `extrude`), booleans (`union`,
`difference`), transforms, `volume`, `bounds`, `toMesh` (for three.js) and
`toSTL` (binary STL `ArrayBuffer`). `createKernel()` loads the WASM module once
and is awaited at app start. The kernel is the only module that imports
`manifold-3d`.

## 6. UI (`src/ui/`, `src/state/`)

Three‑pane layout:

1. **Left — palette, settings & stacks**: game box size (manual entry or BGG
   lookup), tolerance x/y, default wall/floor, grid snap; list of box types to
   add (click or drag into the 3D editor); the Stacks outline (below).
2. **Centre — 3D editor** (`AssemblyView` with `editable`, three.js; y‑up,
   see §2). Camera buttons Top (orthographic, straight down) / Front / Side /
   Iso and Fit; right‑drag orbits (pans in Top), middle‑drag pans, the wheel
   zooms. The left button edits:
   * **Click** an item to select it, click empty space to deselect.
   * **Left‑drag** moves the item: the pointer is projected onto the
     horizontal plane at the height where the item was grabbed, keeping the
     grab offset (in near‑horizontal views — Front / Side — onto the upright
     plane through the grab point facing the camera instead; `src/model/drag.ts`).
     The position snaps to the grid, the usable‑area edges and the edges of the
     items that stay put (Shift: no snap; `snapPosition`), and the item settles
     live, so it visibly climbs onto trays. Alt at drag start pulls the item
     out from under its stack (`carry: false`, §4). One drag = one undo step
     (`beginDrag` / `endDrag`).
   * **While dragging**, overlay labels show the distance from the item's
     footprint to the nearest facing neighbour edge (items overlapping it in
     height) or usable‑area wall on each side (`gapLabels`), plus the snap
     guide lines and an x / y / z readout.
   * **Palette drop**: a box type dropped onto the view is placed with its
     centre at the item top or floor point under the pointer and appended to
     the stack order, so it settles on top.
   * **Keys** (when focus is not in a text field): arrows nudge by the grid
     step (Shift: 10×) following the screen — ArrowUp increases y (y‑up);
     `R` rotate, `Delete` remove,
     `Ctrl+D` duplicate, `Ctrl+Shift+D` duplicate on top (stacked),
     `Ctrl+Z/Y` undo/redo, `Esc` deselect.
   Overlapping items, items outside the usable area and items taller than the
   box are tinted (§7) and listed in a validation panel.
   * **Reaching hidden items** (toolbar toggles next to the camera buttons):
     *Fade above* (default on) — while an item is selected, every item whose
     footprint overlaps it and whose bottom is higher than its bottom (the
     column stacked on it, incl. a lid sunk into its lip) is drawn
     translucent (same tint, material cache key `tint|selected|placeholder|faded`)
     and is skipped by picking, so a click or drag reaches the selected item
     and what is beneath it. Items of other stacks stay solid and clickable
     (fading everything above a height would hide the context and block
     switching to a neighbouring stack). `fadedItemIds` in
     `src/model/stackView.ts`. *Exploded* — display only: each item is lifted
     by its stack level × 15 mm (`explodeOffsets`; level 0 on the floor, else
     1 + the highest level among its supporters, so a bridge clears both
     stacks). The offset is baked into the placement matrix, so picking, the
     drag plane, the distance labels and the selection outline all use the
     displayed position, while drags change only x/y in the model; the camera
     fit includes the exploded height (`setFitHeight`). Instant, no
     animation.
   * **Mini‑map** (`src/ui/MiniMap.tsx`, bottom‑right overlay, ~220 px wide,
     collapsible): read‑only top‑down SVG of the game box, usable area and
     item footprints (box‑type `draw()` features, the 3D tints, error/warning
     outlines, selection), drawn y‑up like the editor. A click centres the 3D
     camera on that point (`focusOn(x, y)`) and selects the topmost item
     under it, if any. No editing, no z badges, no level filter.
   * **Stacks outline** (left column, `src/ui/OutlinePanel.tsx`): the stack
     tree (`buildStackTree`); click selects, dragging a row onto another (or
     Alt+↑/↓) moves it in the stack order (`reorderItem`) — the only way to
     put an item *under* another.
3. **Right — inspector**: label, position, rotation, read‑only elevation
   ("Rests at z = …"), wall/floor override
   (checkbox "override project default" + value), generated parameter form,
   computed outer footprint, 3D preview of the selected item, export buttons.
   (The whole assembly is the centre pane; there is no separate assembly view.)

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
  identical items (same `geometryKey`: type/params/wall/floor and build
  context, §4.2) into one file with a count, and
  packs them with a `manifest.txt` into a zip.
* `download.ts` — trigger a browser download for a Blob.
* `src/preview/Preview3D.tsx` — three.js viewer for a `MeshData` (single item).
* `src/preview/AssemblyView.tsx` — the centre‑pane 3D editor (§6): the whole game box as a
  translucent shell with every item placed from the layout. One mesh per unique
  geometry (exporter's `geometryKey`) in a shared LRU cache; moves and rotations
  only update transforms (including the `z` elevation). Items whose top (incl.
  standing cards, `effectiveTop`) is above the box are tinted red,
  overlapping / intersecting / out‑of‑area items and stack‑fit errors orange,
  floating or "may tip" stacked items light blue. The three.js world is the
  game box frame itself (nothing mirrored, chiral geometry renders as it
  prints); the camera presets are y‑up (§2, `assemblyCamera.ts`). The scene
  API (`assemblyRenderer.ts`) offers picking (`pickItemAt`, skipping faded
  items), pointer rays and plane projection for dragging, `projectToCanvas`
  for HTML overlays, `focusOn(x, y)` (used by the mini‑map) and
  `setFitHeight` (exploded view).
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
