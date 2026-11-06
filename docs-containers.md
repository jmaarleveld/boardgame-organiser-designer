# Containers v2: four basic elements on one tiling framework

Design brief, 2026-11-06. The v1 set (`tray`, `divided-tray`, `card-tray`)
stays registered so saved projects keep working; the four types below are the
new standard set and may replace them later.

## Goal

Four parametric, 3D‑printable container types. Each is defined as **one cell**
(a cavity plus its access features); a shared tiling framework repeats the
cell *n* times along X (columns) and/or *m* times along Y (rows) inside one
printed part with shared inner walls. Box types never loop over cells
themselves: that is the framework's job, so repeating is never hard‑coded.

| id                  | Cell                                             | Repeats   |
|---------------------|--------------------------------------------------|-----------|
| `card-tray-flat`    | card stack lying flat, finger gaps to the floor  | columns (X) |
| `card-tray-upright` | card stack standing, wedges in the long walls    | columns (X) |
| `card-tray-tilted`  | standing stack leaning back, open front (dispenser) | rows (Y) |
| `item-tray`         | small token tray, flat or scoop floor            | columns × rows |

Local frame as everywhere: X = width, Y = depth, Z = up, origin = outer
front‑left‑bottom corner, floor on Z = 0 (Z = plug height with a plug).

## Tiling framework (`src/boxes/definitions/tiling.ts`)

A box type supplies a `CellSpec` and the framework derives everything else.

```
interface CellSpec {
  /** Inner (cavity) size of one cell, axis aligned bounding box. */
  width: number; depth: number; height: number;
  /** Distance between cell origins; default width + divider (resp. depth + divider). */
  pitchX?: number; pitchY?: number;
}

/** What the framework hands the cell functions, per cell. */
interface CellFrame {
  col: number; row: number;            // 0‑based
  x: number; y: number;                // inner origin of the cell (outer frame)
  width: number; depth: number; height: number;
  floorZ: number;                      // Z of the cavity floor (plug + floor)
  topZ: number;                        // Z of the wall top (floorZ + height)
  lipH: number;                        // extra material above topZ (stacking lip), 0 if none
  /** Thickness of the material on each side of this cell: outer wall or divider. */
  sides: { left: number; right: number; front: number; back: number };
  /** Whether that side is an outer wall (true) or a shared divider (false). */
  outer: { left: boolean; right: boolean; front: boolean; back: boolean };
}

interface TiledBoxSpec {
  cols: number; rows: number;
  cell: CellSpec;
  wall: number; floor: number; divider: number;
  stacking: Stacking;                  // from common.ts
  /** Solids to subtract per cell: the cavity and its access features (gaps, wedges, floor grooves). Overshoot into a neighbouring cavity or outside the part by EPS is fine. */
  cellCutters(kernel, frame: CellFrame): Solid[];
  /** Mini‑map features per cell (cavity rect, notch rects). */
  cellDraw(frame: CellFrame): TopViewFeature[];
  /** Optional extra bearing areas per cell (default: none; dividers are added by the framework). */
  cellBearing?(frame: CellFrame): BearingArea[];
  /** Optional: divider height above the floor (0 / undefined = full height). Framework draws, builds and reports them. */
  dividerHeight?: number;
  /** false when the dividers are not straight vertical walls (tilted type): the framework then draws / reports none. */
  straightDividers?: boolean;
}
```

Framework functions (names indicative):

* `tiledFootprint(spec)` → outer W = 2·wall + (cols−1)·pitchX + cell.width,
  D likewise, H = `stackedHeight(cell.height, floor, stacking)`.
* `cellFrames(spec)` → `CellFrame[]` in row‑major order.
* `tiledBuild(kernel, spec)` → outer block with the stacking features
  (refactor `stackedOpenBox` in `common.ts` into `stackedBlock` = outer box +
  lip ring + plug pad − recess ring, **without** a cavity; `stackedOpenBox`
  becomes `stackedBlock` minus one cavity so the v1 types are unchanged), with
  dividers lowered to `dividerHeight` when set (cut the strip above them),
  minus every cell's cutters.
* `tiledDraw(spec)` → cell features + divider rects (role `divider`).
* `tiledBearingAreas(spec)` → `cavityBearingAreas` of the outer ring +
  divider rects (role `bearing` when full height, `low` otherwise) + cell
  bearing areas.
* `tiledBaseFeatures(spec)` → `cavityBaseFeatures` of the outer ring.
* `tiledValidate(problems, spec)` → counts are whole numbers ≥ 1, divider
  thickness > 0 when more than one cell, pitch ≥ cell size, plus
  `validateStacking` on the outer dims.
* `tilingParams(axes: 'x' | 'y' | 'xy')` → the `columns` / `rows` /
  `dividerThickness` ParamSpecs (group "Repeat"; only the supported counts are
  exposed; default 1 column, 1 row, divider 1.2 mm).
* `tilingOf(item, axes)` → `{ cols, rows, divider }` from the params.

Dividers between cells are `divider` thick (not `wall`): the framework's
`sides` tells a cell what it is cutting through on each side, so a gap or
wedge cutter can span exactly that thickness (+ EPS).

### Shared card parameters (`cardParams` in `common.ts`)

`cardWidth` 63.5, `cardHeight` 88, `clearance` 1, `stackHeight` 30 (group
"Cards"), same specs as the v1 `card-tray`. Plus `cardDims(item)`.

## The four types

### 1. `card-tray-flat` — Card tray (flat)

Cell: `cardWidth + 2c` (X) × `cardHeight + 2c` (Y) × `stackHeight` (Z).
Cards lie face up. **Finger gaps**: a plain rectangular slot
`gapWidth` wide (default 25) that runs from the wall top all the way down
through the wall and continues `gapFloorDepth` (default 2) into the floor as a
groove of the same width, across the full wall thickness (so a finger can get
under the last card). If `gapFloorDepth ≥ floor` the groove goes through the
floor; allowed, no warning. `gapSides`: `sides` (the walls parallel to Y, at
the card's left/right edges) / `ends` (walls parallel to X) / `both`; default
`sides`. Gaps are centred on the cell's wall. On a shared divider the gap cuts
the divider (same as v1 divided‑tray notches). Repeats along X (columns).
Stacking group as the v1 types. Validation: gap narrower than the wall it is
in, card sizes > 0, etc. Bearing areas: framework.

### 2. `card-tray-upright` — Card tray (upright)

Cell: `stackHeight + c` (X, the stack direction) × `cardWidth + 2c` (Y) ×
`cardHeight − exposedHeight` (Z); `exposedHeight` default 20. Cards stand
portrait, faces looking ±X. **Wedges**: a trapezoid cut from the top edge of
both long walls (the walls parallel to X at Y = 0 and Y = max), one per cell,
centred on the cell: `wedgeTopWidth` (default 30), `wedgeBottomWidth`
(default 12), `wedgeDepth` (default = 60 % of the inner height, param default
0 = auto), through the wall thickness and the lip. Built with
`kernel.extrude` of the trapezoid (in XZ, rotated into place) or an equivalent.
Dividers between stacks (parallel to Y) are full height by default;
`dividerHeight` param (0 = full, like v1 divided‑tray) lowers them. Repeats
along X. `keepOut` for the standing cards above the top (as v1 upright).

### 3. `card-tray-tilted` — Card tray (tilted dispenser)

The upright cell tilted by `tiltAngle` (default 15°, 5–40) about Y so the
cards lean back onto the back wall (the wall at X = 0) and are drawn from the
front (+X). Outer part stays a plain box (vertical outer faces, lip/recess
work). Geometry per cell, in the XZ plane:

* slot width across the cards `s = (stackHeight + c) / cos θ` measured
  horizontally; back inner face at height z is at `x_back(z) = x0 + (H − z)·tan θ`
  where H = inner height = `(cardHeight − exposedHeight)·cos θ` and
  `x0 = wall` (the back wall is `wall` thick at the top, thicker below);
  the slot is the tilted box `(stackHeight + c) × (cardWidth + 2c) × BIG`
  rotated by −θ about Y and placed so its lowest corner sits at
  `(x_back(0), y, floorZ)`; so the floor of the slot is tilted too (cards
  stand on it with their bottom edge against the back).
* cell inner width (axis aligned) = `H·tan θ + s`.
* **Front opening**: the material in front of the slot above `frontHeight`
  (default 20 mm) is removed (a second rotated box in front of the slot
  intersected with `z ≥ floorZ + frontHeight`), so cards are exposed at the
  front and a thumb can push the top card forward. Below `frontHeight` the
  front wall holds the stack.
* Repeats along Y (rows: lanes side by side, straight dividers parallel to X
  — `straightDividers` true). Not along X.
* `keepOut`: the cards above the top. They lean back: the keep‑out rect starts
  at `x = x_back(H) − exposedHeight·sin θ` (may be negative, i.e. outside the
  footprint; check `stackFit` / `keepOutViolations` cope with that and clamp
  only if they do not) and is `exposedHeight·cos θ` high.
* Chiral: note it in DESIGN.md (the assembly view mirror question).
* Validation: angle range, `frontHeight < H`, cards taller than exposed.

### 4. `item-tray` — Item tray

Cell: `innerWidth` 40 × `innerDepth` 30 × `innerHeight` 20 (group "Size"),
repeats along X and Y (columns × rows, shared dividers, `dividerHeight` 0 =
full). `floorShape`: `flat` (default) or `scoop`. **Scoop**: a concave fillet
of radius `scoopRadius` (default 10, clamped to ≤ innerHeight and ≤ half the
cell span across) between the floor and two opposite walls, chosen with
`scoopSides`: `long` (default; the two walls along the longer inner side) or
`short`. Built as part of the cell cutter: cavity box minus the fillet
material (a bar `r × r` along the wall minus a cylinder of radius `r` whose
axis lies along the wall at height `floorZ + r`, `r` from the wall). Every
cell gets its own scoops. No finger notches (the scoop is the access feature).

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
