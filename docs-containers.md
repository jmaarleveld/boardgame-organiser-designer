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
| `item-tray`         | small token tray, flat, cove or ramp floor       | columns × rows |

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
the lip on outer walls (an XZ or YZ polygon extruded and rotated into place;
`wedgeCutter` in `common.ts`, shared with the tilted tray). Two toggles, both
off = no wedges:

* `wedgeEnds` (default true, "Wedges in the end walls and dividers"): one
  wedge in every wall perpendicular to the stack, i.e. the outer end walls at
  X = 0 and X = max and every divider, centred on the cell's Y range (the card
  width). Fingers grab the stack by its first and last card. Framework
  convention: a cell cuts its left side only when outer, its right side
  always, so each divider is cut once (thickness `frame.sides`). On a lowered
  divider (`dividerHeight`) the cut starts at the divider top and its depth is
  clamped to leave max(wall, 1) of divider above the floor (skipped if nothing
  remains to cut).
* `wedgeLong` (default false, "Wedges in the long walls"): one wedge in each
  of the two long outer walls (front and back, parallel to X), one pair per
  cell, centred on the cell's X range. Fingers grab the cards by their edges.

Both on = both sets. An earlier version (2026-11-06) had `wedges` (boolean)
and `wedgeWalls` (`ends` / `long` / `both`); on load (`migrateLegacyItem`)
`wedges: false` turns both toggles off, otherwise `wedgeWalls` maps to the
toggles, and the old keys are dropped.

The three sizes are shown only when a toggle is on and default to 0 = auto,
relative to the span of the wall the wedge is cut from: `wedgeTopWidth` 60 %
of the cell Y span for the ends (cardWidth + 2c; 39.3 mm by default) and of the
cell X span for the long walls (stackHeight + c; 18.6 mm), `wedgeBottomWidth` 40 % of
the resolved top (15.72 / 7.44 mm), `wedgeDepth` 60 % of the inner height
(40.8 mm). Explicit values override (one value for both sets). Mini-map: one
notch rect per cut wall, top width x that wall's thickness. Validation (a
toggle on, `validateWedgeSizes` in `common.ts`): sizes non-negative, an explicit bottom <= the (smallest) top in use, an
explicit top < span − 2·max(wall, 1) for every wall set in use (Y span for
the ends, X span for the long walls) so a post remains beside the wedges, depth <= inner
height. Dividers between stacks (parallel to Y) are full height unless
`dividerHeight` (group "Repeat", shown with more than one column) lowers them.
`keepOut`: one rect per cell cavity, `exposedHeight - lipH` high, for the
standing cards.

### 3. `card-tray-tilted` — Card tray (tilted dispenser)

A card display: slots stepped one behind the other along X, every stack
leaning back by `tiltAngle` (default 15, 5 to 40) towards X = 0; cell 0 is at
the back, the front deck is drawn from the front (+X). Params in group
"Dispenser": `tiltAngle`, `exposedHeight` (20), `frontHeightPct` ("Front wall height
(% of wall)", 50, 0 to 100, step 5),
`overhangClearance` ("Clearance behind the cards", 2, ≥ 0), `hollowBack`,
`hollowFront` (both default true); group "Repeat":
`columns`, `dividerThickness` t. With T = stackHeight + c and θ = tiltAngle:

* inner height `H = (cardHeight - exposedHeight)·cos θ`, slot width
  `s = T / cos θ` (horizontal), pitch `s + t / cos θ`. The exposed cards of
  slot 0 lean back by `overhang = exposedHeight·sin θ` beyond the slot's back
  face at the wall top; the part grows at the back by
  `back = overhang + overhangClearance` so they never reach past the
  footprint. Back face of slot i
  `x_back_i(z) = wall + back + i·pitch + (H - z)·tan θ`, cell width
  (axis-aligned bounding box) `back + H·tan θ + s` (the slot sits `back` into
  its cell), cell depth `cardWidth + 2c` (one lane, no repeat along Y). Outer
  width `2·wall + back + (n - 1)·pitch + H·tan θ + s`; the back is
  `wall + back` thick at the wall top and thicker below (hollow by default,
  see below). The pitch is smaller
  than the cell width, the cells overlap in bounding box but not in volume
  (`straightDividers: false`, explicit `pitchX`). Default (15°, back 7.18):
  60.07 x 68.7 mm for 1 column, 126.74 x 68.7 mm for 3 (pitch 33.34).
* Each slot is the box `T x (cardWidth + 2c) x L` rotated by -θ about Y
  with its lowest corner at `(x_back_i(0), y, floorZ)`, so its floor is tilted
  too. It is not clipped above the wall top: with a stacking lip, a steep
  tilt and a small `back` (`lipH·tan θ - back > wall/2`, e.g. 40° with
  exposed height and clearance 0) slot 0 notches the back lip where the cards
  lean over it.
* **Tilted dividers**: between slot i's front face and slot i + 1's back face
  stands a divider t thick perpendicular to the cards (t / cos θ
  horizontally), always full height (no `dividerHeight`): every deck leans on
  its own divider and the decks are held apart.
* **Hollow back** (`hollowBack`, group "Dispenser", default true, cell 0
  only): the solid back wedge (wall + back thick at the top, 26.4 mm at the
  floor by default) becomes a leaning plate `wall` thick (perpendicular)
  behind slot 0, the vertical outer back wall (`wall`, at X = 0) and a pocket
  between them. Pocket profile in XZ: x from `wall` to the plate's back face
  `x_back_0(z) - wall / cos θ`, z from `floorZ` (the structural floor stays)
  to `topZ - wall` (a flat roof `wall` thick under the top face; the back lip
  sits above it). It runs the whole depth and through both side walls (EPS
  beyond Y = 0 and Y = D), so each side face shows the pocket profile as a
  hole; the roof is a short bridge when printing. The pocket is narrowest at
  the roof, `back + wall·tan θ - wall / cos θ`, and is skipped when that or
  its height `H - wall` is below 1 mm (small `back`, steep tilt). Default
  (15°, 1 column, wall 1.6): about 5.9 mm wide at the roof, 23.1 mm at the
  floor, 64.1 mm high. The recess ring (`wall/2 + clearance` wide) never
  meets it at the back wall; when `floorZ` is below the recess top the back
  wall between them is `wall - (wall/2 + clearance)`, validated against
  `MIN_RECESS_WALL` (at the side walls the pocket hole runs into the recess
  ring along the pocket's length; the floor under the pocket stays). Bearing
  areas are unchanged: the roof keeps the `back wall` strip solid. With
  `wedgePlates` the pocket cutter is the pocket prism minus the back wedge
  grown by `wall` (each slanted side offset outward perpendicular to it, the
  bottom edge down, extruded over the whole pocket along X), so a `wall`-thick
  lining seals the pocket around the wedge cut: the pocket splits into a left
  and a right half, each still open through its side wall, with a flat
  ceiling (a short bridge) under the wedge bottom.
* **Wedges** (group "Wedge"), two toggles, sizes as in the upright tray
  (`wedgeTopWidth`, `wedgeBottomWidth`, `wedgeDepth`, 0 = auto: top 60 % of
  the span the wedge is cut across, bottom 40 % of the top, depth 60 % of H,
  clamped to `H - T·sin θ - 1` so it stays above the floor wedge under every
  slot; only bites at steep tilts with thick stacks), shown when either
  toggle is on (the two widths also while the front access opening is open,
  since they size it too):
  * `wedgePlates` (default true, "Wedges in the leaning plates"): a vertical
    trapezoid in the YZ plane centred on the lane (span = lane width
    cardWidth + 2c), cut from the top of the plate behind every slot: for
    slot 0 through the outer back wall, the roof, the pocket lining and the
    leaning plate and the back lip (never into the pocket itself); for slot i > 0 the tilted divider. Extruded along
    X from 0 (slot 0) or `x_back_i(H) - pitch` to `x_back_i(zBot) + EPS`,
    clipped to the slab between slot i - 1's back face and slot i's front face
    (the neighbouring slots are air), so it never reaches divider i, the side
    walls (top < lane - 2·max(wall, 1)) or the last cell's front block. Pinch
    the deck front and back.
  * `wedgeSides` (default false, "Wedges in the side walls"): per slot a
    trapezoid in the slot's tilted frame, top width along v = (cos θ, 0,
    sin θ) (span = T), depth along -u, u = (-sin θ, 0, cos θ), centred on the
    slot's top opening (its top edge passes through the slot's mid plane at
    the wall top), continued along u through the wall top and the lip,
    extruded along Y through both side walls (+EPS). At the wall top it is
    `top / cos θ` wide horizontally, centred on `x_back_i(H) + s/2`. Pinch the
    deck across its width.
  * Mini-map: per plate wedge a `notch` rect across the lane, top width deep
    (Y), over the plate's top (x 0 … wall + back for slot 0, the divider rect
    for i > 0); per side wedge two `notch` rects `top / cos θ` x wall.
  * Validation (a toggle on, or the front open for the widths): sizes
    non-negative, explicit bottom <= the smallest top in use, explicit top <
    span - 2·max(wall, 1) (lane width for the plates and the front opening, T
    for the side walls), explicit depth <= `H - T·sin θ - 1` (toggles only).
* **Front block** (last cell, the mirror of the back): a full-height block
  between slot n - 1's tilted front face `x_front(z) = x_back_{n-1}(z) + s`
  and the vertical outer front face at X = W; `wall` thick at the floor,
  `wall + H·tan θ` at the wall top. The lip ring runs all round, so stacking
  works as for any tray. **Hollow front** (`hollowFront`, default true): like
  the back, a leaning plate `wall` thick (perpendicular) in front of the slot
  (front face `x_front(z) + wall / cos θ`), the outer front wall (`wall`) and
  a pocket between them, `(z - floorZ)·tan θ - wall / cos θ` wide, a
  triangle pointing down: cut off where it is 1 mm wide (or above the recess
  ring + `MIN_RECESS_WALL`), up to a flat roof `wall` thick under the top
  face, open through both side walls; skipped when less than 1 mm high or wide
  (`frontPocketProfile`). Default (15°, wall 1.6): 15.5 mm wide under the
  roof, from 9.9 mm above the floor up to `H - wall` (54.2 mm high).
* **Front access opening**: `frontHeight = frontHeightPct / 100 · H`, from the
  structural floor `floorZ`; the opening is the plate wedge trapezoid
  (`wedgeTopWidth` / `wedgeBottomWidth`, auto 60 % of the lane / 40 % of the
  top, whatever `wedgePlates` says) centred on the lane, cut from the wall top
  down to `floorZ + frontHeight`, i.e. `(1 - pct/100)·H` deep, through the
  whole front block and the lip (outer wall, pocket, plate). Extruded along X
  from the slot's back face at the wall top to the outer face, clipped to the
  half space in front of the slot's back face plane so it never reaches the
  divider behind the last slot. With the hollow front the pocket keeps the
  same `wall`-thick lining around it as the back wedge (`wedgeLining`, with the
  opening depth). The slot floor rises `T·sin θ` toward the front, so the
  opening bottom stands `pct·H - T·sin θ` above the slot floor at the front;
  validation requires `frontHeight >= T·sin θ + 1` (default 9.02 mm = 13.7 %;
  0 % is reported). At 100 % (`>= 100 - 1e-9`) there is no opening: a closed
  front like a normal wall. Interior slots have no opening: their divider is
  in front of them.
* Mini-map: per slot a `cavity` rect for its top opening (x_back_i(H) to
  x_back_i(H) + s), a `divider` rect per tilted divider at the wall top
  (t / cos θ wide; the framework draws none with `straightDividers: false`);
  the front block is solid (no rect), with a `notch` rect for the access
  opening (top width across Y, from `x_back_{n-1}(H) + s` to the outer face)
  below 100 %.
* Mini-map: the `back` strip is drawn as part of the solid (no rect).
* `keepOut`: per slot, height `exposed·cos θ + stackHeight·sin θ - lipH` (the
  front card's top corner stands higher on the tilted floor), x from
  `x_back_i(H) - overhang` to `x_back_i(H) + s`. For slot 0 that starts at
  `wall + overhangClearance`, inside the footprint; slots i > 0 overhang the
  previous slot of the same part.
* **Bearing areas** wrap the framework's (outer ring and lip all round, no
  dividers with `straightDividers: false`): the top of the front block
  (`x_back_{n-1}(H) + s` to the outer wall) is added as `bearing` `front wall`
  at the wall top; below 100 % the access opening's top width (over the block,
  the outer wall and the lip) is taken out of both and added as `low`
  `front opening` at `floorZ + frontHeight`. A tray on top rests on the whole
  ring except that gap. Every tilted divider top is added
  (`bearing` at the wall top, x range as in the mini-map), the `back` strip
  (`wall … wall + back`) is added as `bearing` at the wall top, and the back
  lip piece slot 0 notches (if any) becomes `low`.
* **Chiral**: the cards always lean towards -X (-y at rotation 90), the mirror
  image is a different part; see DESIGN.md §4.1 and the assembly-view question
  in `docs-box-design-ideas.md`.
* Validation: tilt range, `exposedHeight < cardHeight`, `0 <= frontHeightPct <= 100`,
  below 100 % `frontHeight >= T·sin θ + 1`,
  `overhangClearance >= 0`, divider thickness > 0 with more than one column,
  the wedge checks above and the recess wall next to the hollow back.
* An earlier version (2026-11-06) repeated lanes along Y (`rows`) and had a
  `dividerHeight`; on load (`migrateLegacyItem`) `rows` ≥ 2 becomes `columns`
  and both `rows` and `dividerHeight` are dropped. A saved `frontHeight` (mm)
  becomes `frontHeightPct = round(100·frontHeight / H, 1 decimal)`, clamped to
  [0, 100], with H from the item's own cardHeight / exposedHeight / tiltAngle
  (defaults 88, 20, 15° for missing keys); `frontHeight` is dropped.

### 4. `item-tray` — Item tray

Cell: `innerWidth` 40 x `innerDepth` 30 x `innerHeight` 20 (group "Size"),
repeats along X and Y (`tilingParams('xy')`). Dividers are always full height
(no `dividerHeight`; an old file's value is ignored). `floorShape` (group
"Floor"): `flat` (default), `cove` or `ramp`; the other Floor params show only
for their shape (`visibleIf`). The raised material belongs to the floor: the
outer height is unchanged. Every cell gets its own cove / ramp. No finger
notches: the curved floor is the access feature.

**Cove**: a concave quarter circle of radius `coveRadius` r (default 8 mm, min
1) where the floor meets the walls, tangent to both. `coveSides`: `all`
(default), `long` (the two walls along the longer inner side) or `short`.
Validated r < half the span across the coved walls (`all`: half the smaller of
cell width / depth) and r <= innerHeight. Cell cutter for one pair = an
extruded profile (quarter arcs sampled every <= 0.5 mm, at least 16 per arc,
then straight up through the lip). For `all` the cutter is the **intersection**
of the X-pair and Y-pair profiles: along every wall the cove is exact, and the
walls keep their square vertical corners, so in each corner the two coves meet
like a groin vault (floor = the higher of the two arcs, a shallow valley along
the diagonal from the corner at height r down to (r, r)). A ball in the corner
was tried and rejected: with square vertical corners it leaves a flat shelf at
height r (it only blends with rounded vertical corners). Raised volume per cell:
(1 − π/4)·r²·2(w + d) − 4·r³·(5/3 − π/2).

**Ramp**: one large concave curve from the floor up one wall, or up two
opposite walls, so bits can be swept up and out. `rampWall` (one select):
`front` (−Y, default: you slide bits toward yourself and lift them over the
near wall), `back` (+Y), `left` (−X), `right` (+X), `front-back`,
`left-right`. Profile across the span w between those walls: a circular arc
tangent to the floor at distance `rampLength` L from the wall, reaching
`rampHeight` h at the wall, R = (L² + h²) / (2h); flat floor between. Both are
"0 = automatic" (default): L = w/2 for one wall, 0.4·w for two; h = ¾·innerHeight,
at most L. Validated L <= w (one wall), 2L <= w (two walls), h <= innerHeight
and h <= L (with h > L a tangent arc would have to lean over the wall; h = L is
a quarter circle, vertical at the wall). Cell cutter = the extruded profile, as
for the cove pairs.

Every cell has the same cutter: it is built once per build and translated.

## Conventions

* Every new type has `newItemParams: { ...stackingNewItemParams }` and the
  stacking group, `stackEngagement`, `bearingAreas`, `baseFeatures`.
* Validation messages follow the common style (`requirePositive`, full sentences
  with the offending values).
* Tests per type in `src/boxes/boxes.test.ts` style (valid manifold, bounds =
  footprint, draw inside footprint, default params validate clean) plus
  type‑specific checks (cell count ↔ volume, gap goes into the floor, wedge
  removes material, tilted slot bounds, cove / ramp add the raised volume, tiled
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

* **Item tray finger access: cove and ramp** (2026-11-07). The scoop floor
  (shallow trough, `scoopSides` / `scoopRise`) is removed. `floorShape` is
  `flat` | `cove` | `ramp` (see section 4). On load a `scoop` tray becomes a
  `cove` on the same walls (`coveSides` = old `scoopSides`, default long) with
  `coveRadius` 8, reduced to the largest half millimetre that fits a small cell
  (below half the span, within the inner height); `scoopSides` / `scoopRise`
  are dropped (`migrateItemTray` in services/persistence). The containers demo
  shows a cove tray (all walls) and two ramp trays (front; left and right).

## Open points for the user

* **Repeat axis per type.** All three card trays now repeat along X; the
  tilted tray as stepped slots one behind the other (built 2026-11-06, replacing
  the lanes along Y; its dividers are always full height and the part grows
  at the back so the leaning cards stay inside the footprint).
* ~~Scoop next to a lowered divider~~: moot, the item tray's dividers are
  always full height (and the scoop is gone, see Decided).
