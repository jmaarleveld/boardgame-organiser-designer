# Containers v2: four basic elements on one tiling framework

Implemented 2026-11-06 (commits eaafa38 and 4fedc48). The v1 set (`tray`,
`divided-tray`, `card-tray`) stays registered so saved projects keep working;
the four types below are the new standard set and may replace them later. This
file describes what was built; where it differs from the original brief, the
code is the truth.

## Goal

Four parametric, 3D‑printable container types. Each is defined as **one cell**
(a cavity plus its access features); a shared tiling framework repeats the
cell *n* times along X (columns) and/or *m* times along Y (rows) inside one
printed part with shared inner walls. Box types never loop over cells
themselves: that is the framework's job, so repeating is never hard‑coded.

| id                  | Cell                                             | Repeats   |
|---------------------|--------------------------------------------------|-----------|
| `card-tray-flat`    | card stack lying flat, finger gaps to the floor  | columns (X) |
| `card-tray-upright` | card stack standing, wedges in the long outer walls | columns (X) |
| `card-tray-tilted`  | standing stack leaning back, open front (dispenser) | rows (Y) |
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
  pad - recess ring, no cavity; `stackedOpenBox` is `stackedBlock` minus one
  cavity, so the v1 types are unchanged) minus the strip above each lowered
  divider minus every cell's cutters, in one boolean.
* `tiledDraw(spec)` -> cavities, then divider rects (role `divider`), then the
  other cell features (notches).
* `tiledBearingAreas(spec)` -> `cavityBearingAreas` of the outer ring + divider
  rects (role `bearing`, or `low` when lowered, at `dividerTopZ`) + `cellBearing`.
* `tiledBaseFeatures(spec)` -> `cavityBaseFeatures` of the outer ring.
* `tiledValidate(problems, spec)` -> whole counts >= 1, wall and floor > 0,
  divider thickness > 0 when a repeated axis has no explicit pitch, pitch >=
  cell size, divider height in 0..cell height, plus `validateStacking`.
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
"Cards"), same specs as the v1 `card-tray`. Plus `cardDims(item)` and
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
neighbouring cavities on a shared divider). If `gapFloorDepth >= floor` the
groove goes through the floor; allowed, no warning. `gapSides`: `sides` (default;
walls parallel to Y, at the cards' long edges) / `ends` (walls parallel to X) /
`both`. Gaps are centred on the cell and cut shared dividers too (by the
convention above). Validation: card sizes, non-negative gap values, gap
narrower than the wall it is cut from. No `dividerHeight`.

### 2. `card-tray-upright` — Card tray (upright)

Cell: `stackHeight + c` (X, the stack direction) x `cardWidth + 2c` (Y) x
`cardHeight - exposedHeight` (Z). `exposedHeight` (default 20) is in the group
"Cards". Cards stand portrait, faces looking +-X. Repeats along X. **Wedges**
(group "Wedge"): a trapezoid cut from the top of the two outer long walls (the
walls parallel to X at the front and back, only when outer), one pair per cell,
centred on the cell: `wedgeTopWidth` (30, 0 = none), `wedgeBottomWidth` (12,
0 = pointed), `wedgeDepth` (0 = auto, 60 % of the inner height), through the
wall and the lip (an XZ polygon extruded and rotated into place). Dividers
between stacks (parallel to Y) are full height unless `dividerHeight` (group
"Repeat", shown with more than one column) lowers them. `keepOut`: one rect per
cell cavity, `exposedHeight - lipH` high, for the standing cards.

### 3. `card-tray-tilted` — Card tray (tilted dispenser)

Cell tilted by `tiltAngle` (default 15, 5 to 40) about Y: the cards lean back
onto the back wall (the wall at X = 0) and are drawn from the front (+X).
Params in group "Dispenser": `tiltAngle`, `exposedHeight` (20), `frontHeight`
(20). With T = stackHeight + c and theta = tiltAngle:

* inner height `H = (cardHeight - exposedHeight)·cos θ`, slot width
  `s = T / cos θ` (horizontal), back face `x_back(z) = wall + (H - z)·tan θ`,
  cell width `H·tan θ + s`, cell depth `cardWidth + 2c`.
* The slot is the box `T x (cardWidth + 2c) x L` rotated by -theta about Y
  with its lowest corner at `(x_back(0), y, floorZ)`, so its floor is tilted
  too. It is not clipped above the wall top: with a stacking lip and a steep
  tilt (`lipH·tan θ > wall/2`) it notches the back lip where the cards lean
  over it.
* **Front opening**: everything in front of the slot's front-face plane above
  `floorZ + frontHeight` is removed, within the cell's Y range only (flush at
  dividers and side walls), through the front outer wall and lip. Below
  `frontHeight` the front holds the stack.
* Repeats along Y (rows, lanes side by side) with straight dividers parallel to
  X (`straightDividers` true; `dividerHeight` available). Not along X.
* `keepOut`: height `exposed·cos θ + stackHeight·sin θ - lipH` (the front
  card's top corner stands higher on the tilted floor), x from
  `wall - exposed·sin θ` (may be negative local x: cards overhang the back) to
  `wall + s` per lane. `keepOutViolations` checks the overhang;
  `itemsOutsideUsable` ignores keep-outs.
* **Bearing areas** are a wrapper around the framework's: the front opening is
  subtracted from each, a `low` shelf at `frontHeight` is added, and the back
  lip piece the slot notches becomes `low`.
* **Chiral**: the cards always lean towards -X (-y at rotation 90), the mirror
  image is a different part; see DESIGN.md §4.1 and the assembly-view question
  in `docs-box-design-ideas.md`.
* Validation: tilt range, `exposedHeight < cardHeight`, `0 <= frontHeight < H`.

### 4. `item-tray` — Item tray

Cell: `innerWidth` 40 x `innerDepth` 30 x `innerHeight` 20 (group "Size"),
repeats along X and Y (`tilingParams('xy')`; `dividerHeight` shown with more
than one cell, 0 = full). `floorShape` (group "Floor"): `flat` (default) or
`scoop`. **Scoop**: concave fillet of radius `scoopRadius` (default 10, clamped
to <= innerHeight and <= half the span across the scooped walls) between the
floor and two opposite walls chosen by `scoopSides`: `long` (default; the two
walls along the longer inner side) or `short`. Cell cutter = cavity box minus the
fillet material (a bar r x r along the wall minus a cylinder of radius r at
height `floorZ + r`, r from the wall). Every cell gets its own scoops. No
finger notches.

## Conventions

* Every new type has `newItemParams: { ...stackingNewItemParams }` and the
  stacking group, `stackEngagement`, `bearingAreas`, `baseFeatures`.
* Validation messages follow the v1 style (`requirePositive`, full sentences
  with the offending values).
* Tests per type in `src/boxes/boxes.test.ts` style (valid manifold, bounds =
  footprint, draw inside footprint, default params validate clean) plus
  type‑specific checks (cell count ↔ volume, gap goes into the floor, wedge
  removes material, tilted slot bounds, scoop reduces cavity volume, tiled
  footprint arithmetic, divider rects). `tiling.test.ts` for the framework.
* Register in `src/boxes/index.ts` after the v1 types; palette order:
  item‑tray, card‑tray‑flat, card‑tray‑upright, card‑tray‑tilted, then v1.

## Open points for the user

* **Repeat axis per type.** Flat and upright repeat along X, tilted along Y.
  Is an X-tiled stepped dispenser (lanes side by side across the width) wanted?
* **Wedges in the long walls vs. in the dividers.** Upright wedges are cut only
  in the two outer long walls; dividers (parallel to Y) have none.
* **Retire the v1 `tray`, `divided-tray`, `card-tray` from the palette?** They
  stay registered either way for saved projects.
* **Scoop next to a lowered divider** can stand higher than the divider; there
  is no warning yet.
* **`itemsOutsideUsable` ignores the tilted tray's overhanging cards** (keep-out
  at negative local x); only `keepOutViolations` sees them.
