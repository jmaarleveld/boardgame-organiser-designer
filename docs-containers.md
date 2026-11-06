# Containers v2: four basic elements on one tiling framework

Implemented 2026-11-06 (commits eaafa38 and 4fedc48). The four types below are
the standard container set. The v1 set (`tray`, `divided-tray`, `card-tray`)
was deleted the same day; saved projects that use it are migrated on load
(`migrateLegacyItem` in `src/services/persistence.ts`, see DESIGN.md §4.1).
This file describes what was built; where it differs from the original brief,
the code is the truth.

## Goal

Four parametric, 3D‑printable container types. Each is defined as **one cell**
(a cavity plus its access features); a shared tiling framework repeats the
cell *n* times along X (columns) and/or *m* times along Y (rows) inside one
printed part with shared inner walls. Box types never loop over cells
themselves: that is the framework's job, so repeating is never hard‑coded.

| id                  | Cell                                             | Repeats   |
|---------------------|--------------------------------------------------|-----------|
| `card-tray-flat`    | card stack lying flat, finger gaps into a raised floor | columns (X) |
| `card-tray-upright` | card stack standing, wedges in the long outer walls | columns (X) |
| `card-tray-tilted`  | standing stack leaning back, open front (dispenser) | columns (X), stepped |
| `item-tray`         | small token tray, flat or scoop floor            | columns × rows |

Local frame as everywhere: X = width, Y = depth, Z = up, origin = outer
front‑left‑bottom corner, floor on Z = 0 (Z = plug height with a plug).

## Tiling framework (`src/boxes/definitions/tiling.ts`)

A box type supplies a `TiledBoxSpec` (one `CellSpec` plus callbacks) and the
framework derives everything else.

```
type TilingAxes = 'x' | 'y' | 'xy';

interface CellSpec {
  width: number; depth: number; height: number;   // inner AABB of one cell
  pitchX?: number; pitchY?: number;               // default width + divider / depth + divider
}

interface CellFrame {
  col: number; row: number;                        // 0-based
  x: number; y: number;                            // inner origin in the outer frame
  width: number; depth: number; height: number;
  floorZ: number;                                  // plug + floor
  topZ: number;                                    // floorZ + height
  lipH: number;                                    // lip on the outer walls, 0 if none (dividers never have one)
  dividerTopZ: number;                             // topZ, or floorZ + dividerHeight when lowered
  sides: CellSides<number>;                        // left/right/front/back: wall, or gap to neighbour
  outer: CellSides<boolean>;                       // true = outer wall, false = shared divider
}

interface TiledBoxSpec {
  cols: number; rows: number;                      // as given; the framework rounds to whole numbers >= 1
  cell: CellSpec;
  wall: number; floor: number; divider: number;
  stacking: Stacking;
  cellCutters(kernel: GeometryKernel, frame: CellFrame): Solid[];
  cellDraw(frame: CellFrame): TopViewFeature[];
  cellBearing?(frame: CellFrame): BearingArea[];
  dividerHeight?: number;                          // lowered only when 0 < h < cell height
  straightDividers?: boolean;                      // default true
}
```

`cellCutters` must reach up through the lip (`topZ + lipH + EPS`); overshoot by
EPS into a neighbour or outside the part is fine. A feature in a shared divider
is cut by one cell only: a cell cuts its left / front side only when that side
is outer, its right / back side always.

Framework functions:

* `tiledLayout(spec)` -> `TiledLayout` (rounded counts, pitches, gaps, outer
  size, `floorZ`, `topZ`, `lipH`, `dividerTopZ`, `lowDividers`).
* `tiledFootprint(spec)` -> outer W = 2·wall + (cols-1)·pitchX + cell.width,
  D likewise, H = `stackedHeight(cell.height, floor, stacking)`.
* `cellFrames(spec)` -> `CellFrame[]`, row-major (row 0 = front, col 0 = left).
* `dividerRects(spec)` -> `DividerRect[]` (`axis` `x` or `y`): one per column
  boundary spanning the inner depth, one per row boundary spanning the inner
  width; none when `straightDividers` is false or the gap is not positive.
* `tiledBuild(kernel, spec)` -> `stackedBlock` (outer box + lip ring + plug
  pad - recess ring, no cavity) minus the strip above each lowered
  divider minus every cell's cutters, in one boolean.
* `tiledDraw(spec)` -> cavities, then divider rects (role `divider`), then the
  other cell features (notches).
* `tiledBearingAreas(spec)` -> `cavityBearingAreas` of the outer ring + divider
  rects (role `bearing`, or `low` when lowered, at `dividerTopZ`) + `cellBearing`.
* `tiledBaseFeatures(spec)` -> `cavityBaseFeatures` of the outer ring.
* `tiledValidate(problems, spec)` -> whole counts >= 1, wall and floor > 0,
  divider thickness > 0 when a repeated axis has no explicit pitch, pitch >=
  cell size (only with straight dividers: with `straightDividers: false` the
  cells' bounding boxes may overlap, e.g. the tilted tray's stepped slots, and
  `sides` / `gapX` are then negative for shared sides), divider height in 0..cell height, plus `validateStacking`.
* `tilingParams(axes)` -> `columns` / `rows` / `dividerThickness` ParamSpecs
  (group "Repeat", only the supported counts; defaults 1, 1, 1.2 mm).
  `dividerHeightParam` is the optional "Repeat" `dividerHeight` (0 = full).
* `tilingOf(item, axes)` -> `{ cols, rows, divider }` as raw values from the
  params (the framework rounds, `tiledValidate` reports bad ones).

Dividers are `divider` thick (not `wall`): `CellFrame.sides` tells a cell what
it cuts through on each side, so a cutter spanning
`[x - sides.left - EPS, x + EPS]` cuts exactly through that wall or divider.

### Shared card parameters (`cardParams` in `common.ts`)

`cardWidth` 63.5, `cardHeight` 88, `clearance` 1, `stackHeight` 30 (group
"Cards"), same specs as the deleted v1 `card-tray`. Plus `cardDims(item)` and
`validateCards`.

## The four types

### 1. `card-tray-flat` — Card tray (flat)

Cell: `cardWidth + 2c` (X) x `cardHeight + 2c` (Y) x `stackHeight` (Z). Cards
lie face up. Repeats along X (`tilingParams('x')`). **Finger gaps** (group
"Finger gaps"): a rectangular slot `gapWidth` wide (default 25, 0 = none) from
above the wall top and lip down through the wall, continuing `gapFloorDepth`
(default 2) below the cavity floor as a groove, across the full wall thickness.
The groove also continues `gapReach` (default 10, clamped to the cell span)
into the cavity under the cards, so a fingertip gets under the last card (both
neighbouring cavities on a shared divider).

**Raised floor.** With gaps (`gapWidth > 0`) the cavity floor is raised by
`gapFloorDepth` above the structural floor: the spec's floor is
`floor + gapFloorDepth`, so the cavity floor sits at Z = plugH + floor +
gapFloorDepth and frames, outer block, bearing areas and base features follow.
The groove is cut from the cavity floor down to the structural floor (exactly
`gapFloorDepth` deep, `floor` mm of material left under it), so it never breaks
through; the wall gap runs from the top down to the groove bottom. Outer height
= plugH + grooveFloor + gapFloorDepth + stackHeight + lipH, where
`grooveFloor` = `floor`, or with a recessed base max(`floor`, recessDepth +
0.4), so the recess ring never meets the gap under the outer wall (default 1.2
+ 2 + 30 = 33.2 mm without stacking; 2.55 + 2 + 30 = 34.55 mm with a recess,
plus the lip). Without gaps the floor is not raised.

`gapSides`: `sides` (default; walls parallel to Y, at the cards' long edges) /
`ends` (walls parallel to X) / `both`. Gaps are centred on the cell and cut
shared dividers too (by the convention above). Validation: card sizes,
non-negative gap values (`gapFloorDepth >= 0`), a positive structural floor,
gap narrower than the wall it is cut from. No `dividerHeight`.

### 2. `card-tray-upright` — Card tray (upright)

Cell: `stackHeight + c` (X, the stack direction) x `cardWidth + 2c` (Y) x
`cardHeight - exposedHeight` (Z). `exposedHeight` (default 20) is in the group
"Cards". Cards stand portrait, faces looking +-X. Repeats along X. **Wedges**
(group "Wedge"): a trapezoid cut from the top of a wall, through the wall and
the lip on outer walls (an XZ or YZ polygon extruded and rotated into place).
`wedges` (boolean, default true) switches them on; `wedgeWalls` ("Wedged
walls", select, shown when on) picks the grip:

* `ends` (default, "End walls and dividers: pinch across the stack"): one
  wedge in every wall perpendicular to the stack, i.e. the outer end walls at
  X = 0 and X = max and every divider, centred on the cell's Y range (the card
  width). Fingers grab the stack by its first and last card. Framework
  convention: a cell cuts its left side only when outer, its right side
  always, so each divider is cut once (thickness `frame.sides`). On a lowered
  divider (`dividerHeight`) the cut starts at the divider top and its depth is
  clamped to leave max(wall, 1) of divider above the floor (skipped if nothing
  remains to cut).
* `long` ("Long walls: pinch across the card width"): one wedge in each of the
  two long outer walls (front and back, parallel to X), one pair per cell,
  centred on the cell's X range. Fingers grab the cards by their edges.
* `both`: both sets.

The three sizes are shown only when wedges are on and default to 0 = auto,
relative to the span of the wall the wedge is cut from: `wedgeTopWidth` 60 %
of the cell Y span for `ends` (cardWidth + 2c; 39.3 mm by default) and of the
cell X span for `long` (stackHeight + c; 18.6 mm), `wedgeBottomWidth` 40 % of
the resolved top (15.72 / 7.44 mm), `wedgeDepth` 60 % of the inner height
(40.8 mm). Explicit values override (one value for both sets). Mini-map: one
notch rect per cut wall, top width x that wall's thickness. Validation (wedges
on): sizes non-negative, an explicit bottom <= the (smallest) top in use, an
explicit top < span − 2·max(wall, 1) for every wall set in use (Y span for
`ends`, X span for `long`) so a post remains beside the wedges, depth <= inner
height. Dividers between stacks (parallel to Y) are full height unless
`dividerHeight` (group "Repeat", shown with more than one column) lowers them.
`keepOut`: one rect per cell cavity, `exposedHeight - lipH` high, for the
standing cards.

### 3. `card-tray-tilted` — Card tray (tilted dispenser)

A card display: slots stepped one behind the other along X, every stack
leaning back by `tiltAngle` (default 15, 5 to 40) towards X = 0; cell 0 is at
the back, the front deck is drawn from the front (+X). Params in group
"Dispenser": `tiltAngle`, `exposedHeight` (20), `frontHeight` (20); group
"Repeat": `columns`, `dividerThickness` t, `dividerHeight` (shown with more
than one column). With T = stackHeight + c and θ = tiltAngle:

* inner height `H = (cardHeight - exposedHeight)·cos θ`, slot width
  `s = T / cos θ` (horizontal), pitch `s + t / cos θ`, back face of slot i
  `x_back_i(z) = wall + i·pitch + (H - z)·tan θ`, cell width (axis-aligned
  bounding box) `H·tan θ + s`, cell depth `cardWidth + 2c` (one lane, no
  repeat along Y). Outer width `2·wall + (n - 1)·pitch + H·tan θ + s`; the
  pitch is smaller than the cell width, the cells overlap in bounding box but
  not in volume (`straightDividers: false`, explicit `pitchX`). Default
  (15°): 52.89 x 68.7 mm for 1 column, 119.57 x 68.7 mm for 3 (pitch 33.34).
* Each slot is the box `T x (cardWidth + 2c) x L` rotated by -θ about Y
  with its lowest corner at `(x_back_i(0), y, floorZ)`, so its floor is tilted
  too. It is not clipped above the wall top: with a stacking lip and a steep
  tilt (`lipH·tan θ > wall/2`) slot 0 notches the back lip where the cards
  lean over it.
* **Tilted dividers**: between slot i's front face and slot i + 1's back face
  stands a divider t thick perpendicular to the cards (t / cos θ
  horizontally), full height by default. `dividerHeight` (0 = full, validated
  0..H) lowers every tilted divider: cell i cuts the slab between those two
  planes above `floorZ + dividerHeight`, clipped to the inner lane, so the
  side walls, back and front wall and the lip are never touched. Trade-off:
  full dividers keep every deck upright on its own divider and the decks apart,
  but only the top `exposedHeight` of each is reachable; lowered to about
  `frontHeight` the tray becomes a terraced display where each deck leans on
  the deck behind it (more of each card visible and easier to grab, but pulling
  a card drags on the deck in front and the decks are no longer held apart).
* **Front opening** (last cell only): everything in front of slot n - 1's
  front-face plane above `floorZ + frontHeight` is removed, within the lane's
  Y range only (flush at the side walls), through the front outer wall and
  lip. Below `frontHeight` the front holds the stack. Interior slots have no
  opening: their divider is in front of them.
* Mini-map: per slot a `cavity` rect for its top opening (x_back_i(H) to
  x_back_i(H) + s; for the last slot up to where the front opening meets the
  shelf, since the slot is open from above there), a `divider` rect per tilted
  divider at the wall top (t / cos θ wide; the framework draws none with
  `straightDividers: false`), and for the last slot the `solid` shelf and the
  `notch` in the front wall.
* `keepOut`: per slot, height `exposed·cos θ + stackHeight·sin θ - lipH` (the
  front card's top corner stands higher on the tilted floor), x from
  `x_back_i(H) - exposed·sin θ` to `x_back_i(H) + s`. For slot 0 that may be
  negative local x (cards overhang the back); slots i > 0 overhang the
  previous slot of the same part. `keepOutViolations` checks the overhang;
  `itemsOutsideUsable` ignores keep-outs.
* **Bearing areas** wrap the framework's (outer ring only, no dividers with
  `straightDividers: false`): the last slot's front opening is subtracted, a
  `low` shelf at `frontHeight` is added, every tilted divider top is added
  (`bearing` at the wall top, `low` at `floorZ + dividerHeight` when lowered;
  x range as in the mini-map at that height), and the back lip piece slot 0
  notches becomes `low`.
* **Chiral**: the cards always lean towards -X (-y at rotation 90), the mirror
  image is a different part; see DESIGN.md §4.1 and the assembly-view question
  in `docs-box-design-ideas.md`.
* Validation: tilt range, `exposedHeight < cardHeight`, `0 <= frontHeight < H`,
  divider thickness > 0 with more than one column, divider height in 0..H.
* Earlier versions repeated lanes along Y (`rows`); an old `rows` value is now
  ignored (one lane).

### 4. `item-tray` — Item tray

Cell: `innerWidth` 40 x `innerDepth` 30 x `innerHeight` 20 (group "Size"),
repeats along X and Y (`tilingParams('xy')`). Dividers are always full height
(no `dividerHeight`; an old file's value is ignored). `floorShape` (group
"Floor"): `flat` (default) or `scoop`. **Scoop**: a shallow trough between two
opposite walls chosen by `scoopSides`: `long` (default; the two walls along the
longer inner side) or `short`. Across the span w between those walls the floor
is one circular segment (axis parallel to the scoop walls, centred across the
cell), at `floorZ` in the middle and rising `scoopRise` h (default 3 mm, min
0.2, validated 0 < h < innerHeight) at the walls, radius
R = (w²/4 + h²) / (2h) (39 mm for the default 40 x 30 cell). Small items slide
to the middle. The raised material belongs to the floor: the outer height is
unchanged and the usable depth at the scoop walls is innerHeight − h. Cell
cutter = an extruded profile (the arc sampled every <= 0.5 mm, then straight up
through the lip), equivalent to cavity box from `floorZ + h` ∪ (cylinder ∩
cavity box). Every cell gets its own trough. No finger notches.

## Conventions

* Every new type has `newItemParams: { ...stackingNewItemParams }` and the
  stacking group, `stackEngagement`, `bearingAreas`, `baseFeatures`.
* Validation messages follow the common style (`requirePositive`, full sentences
  with the offending values).
* Tests per type in `src/boxes/boxes.test.ts` style (valid manifold, bounds =
  footprint, draw inside footprint, default params validate clean) plus
  type‑specific checks (cell count ↔ volume, gap goes into the floor, wedge
  removes material, tilted slot bounds, trough adds the raised volume, tiled
  footprint arithmetic, divider rects). `tiling.test.ts` for the framework.
* Register in `src/boxes/index.ts`; palette order: item‑tray,
  card‑tray‑flat, card‑tray‑upright, card‑tray‑tilted, spacer, platform.

## Decided

* **v1 retired** (2026-11-06). `tray`, `divided-tray` and `card-tray` are
  deleted, not just hidden from the palette. On load `tray` becomes `item-tray`
  1 × 1 (same inner size), `divided-tray` an `item-tray` c × r with cell =
  ((W − (c−1)·t)/c) × ((D − (r−1)·t)/r), `card-tray` a `card-tray-flat` or
  `card-tray-upright` by orientation (flat with `gapFloorDepth` 0, so the
  raised floor does not change the height). Footprints and stacking params are
  unchanged; finger notches are dropped. `examples/stacking-demo.json` and the
  sample project were migrated with the same function and report exactly as
  before.

## Open points for the user

* **Repeat axis per type.** All three card trays now repeat along X; the
  tilted tray as stepped slots one behind the other (built 2026-11-06, replacing
  the lanes along Y). Open: should a lowered divider default to `frontHeight`
  (terraced display) instead of full height?
* **Wedges in the long walls vs. in the dividers.** Upright wedges are cut only
  in the two outer long walls; dividers (parallel to Y) have none.
* **Scoop next to a lowered divider** can stand higher than the divider; there
  is no warning yet.
* **`itemsOutsideUsable` ignores the tilted tray's overhanging cards** (keep-out
  at negative local x); only `keepOutViolations` sees them.
