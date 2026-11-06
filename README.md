# Board Game Insert Designer

A browser app for designing 3D-printable organizer inserts for board game boxes.
Enter the inside dimensions of your game box, drag parametric trays and spacers
around a 3D view of the box, stack them, and export one binary STL per unique part,
ready for your slicer.
Everything runs client-side; there is no backend.

<!-- Screenshot: add an image of the 3D editor and inspector here, e.g.
     ![Board Game Insert Designer](docs/screenshot.png) -->

## Quick start

Requires a current Node.js LTS release (Vite 8 needs a recent 20.19+ or 22.12+).

```sh
npm install      # install dependencies
npm run dev      # start the Vite dev server (http://localhost:5173)
npm run build    # type-check (tsc -b) and produce a static build in dist/
npm test         # run the vitest suite (geometry, box definitions, services, state)
```

Other scripts: `npm run lint` (oxlint), `npm run typecheck`, `npm run preview`
(serve the production build locally).

## Workflow

1. **Set the game box size.** Type the inner width, depth and height in the
   left-hand settings panel, or use the BoardGameGeek lookup to search for a game
   and pick a box version. BGG reports *outer* dimensions, so the app subtracts a
   cardboard deduction (2 mm per side by default, editable) before filling in the
   inner size. Check the numbers against your real box.
2. **Set the tolerance.** The tolerance is the *total* slack left per axis, not per
   side. The usable area is the inner box shrunk by the tolerance and centred, so a
   tolerance of 2 mm leaves 1 mm of play on each side. Defaults are 2 mm in X and Y.
3. **Set the defaults.** Project-wide wall thickness (default 1.6 mm) and floor
   thickness (default 1.2 mm) apply to every item unless overridden. Grid snap
   (default 1 mm; 0 turns it off) sets the snapping increment for dragging and
   nudging.
4. **Add boxes.** Click a box type in the palette or drag it into the 3D editor
   (it lands on the floor or on top of the item under the pointer). Each item has
   a label and the parameters of its type.
5. **Arrange.** The centre of the window is a 3D editor of the game box. Drag
   items with the left mouse button to move them; they snap to the grid, to the
   usable-area edges and to neighbouring item edges (guides and live distance
   labels show while dragging), and they rest on whatever is under them (see
   *Stacking*). Rotate with `R` to swap width and depth. The *Top* camera looks
   straight down, with x to the right and y **up** the screen: the origin is the
   front-left corner of the box, and the `y = 0` edge is the one nearest you in
   the *Front* and *Iso* views.
6. **Override per item.** In the inspector, tick "override project default" to give
   one item its own wall or floor thickness. Clear the tick to go back to the
   project default.
7. **Check validation.** Overlapping items, items outside the usable area, items
   taller than the box, and invalid parameters (for example a finger gap wider than the
   wall it is cut from) are tinted in the 3D editor and the mini-map and listed in the
   validation panel. The status bar shows the remaining slack in X and Y.
8. **Export.** "Export all STL" builds every item and downloads a zip containing one
   binary STL per unique geometry plus a `manifest.txt`. Items that are identical
   (same type, parameters, wall and floor) share one file, and the manifest gives the
   count to print. The inspector also offers per-item export (STL or `.scad`) and a 3D
   preview.

   Every `.stl` in the zip has a matching `.scad` file: OpenSCAD source describing the
   same geometry, for tweaking by hand. Parameters are baked in as literal numbers;
   the header comment lists them (with wall, floor and outer size) for reference only,
   so editing those lines changes nothing. `$fn` at the top controls how smooth scoops
   and other round cut-outs are.
9. **Save and load.** Save writes the whole project as JSON; Open loads a JSON file
   (it is validated before it is applied). The current project is also autosaved to
   the browser's `localStorage` and restored on the next visit. Autosave is per
   browser profile, so use Save for anything you want to keep.

## Controls

Mouse:

| Action | Control |
|---|---|
| Select an item | Click it in the 3D editor or in the *Stacks* list (click the background to deselect) |
| Move an item (with its stack) | Left-drag it |
| Disable snapping while dragging | Hold `Shift` |
| Drag an item out from under its stack | Hold `Alt` when you start dragging |
| Orbit | Right-drag (pans in the *Top* view) |
| Pan | Middle-button drag |
| Zoom | Mouse wheel, centred on the pointer |
| Camera views | `Top` / `Front` / `Side` / `Iso` buttons; `Fit` (or clicking the active view again) re-frames the box |
| See and click items inside a stack | `Fade above` (on by default) and `Exploded` buttons |
| Jump the camera to a spot | Click it in the mini-map (bottom-right; also selects the item there) |
| Change the stack order | Drag a row in the *Stacks* list onto another row, or `Alt+↑` / `Alt+↓` on a row |
| Add a box | Click a type in the palette, or drag it into the 3D editor |

Keyboard (when focus is not in a text field):

| Key | Action |
|---|---|
| `R` | Rotate the selected item by 90° |
| `Delete` / `Backspace` | Remove the selected item |
| `Ctrl+D` / `Cmd+D` | Duplicate the selected item |
| `Ctrl+Shift+D` / `Cmd+Shift+D` | Duplicate the selected item on top of itself (see Stacking) |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Y` or `Ctrl+Shift+Z` | Redo |
| Arrow keys | Nudge the selected item by one grid step, following the screen (`↑` = +y) |
| `Shift` + arrow keys | Nudge by ten grid steps |
| `Esc` | Deselect |

## Standard boxes

The standard set is meant to be extended (see below). All dimensions are in
mm. "Default" is the value a new item starts with.

### Containers (cell-based)

Four types, each defined as one cell that repeats inside one printed part
with shared dividers (see `docs-containers.md` for every parameter).

* **Item tray** (`item-tray`): grid of equal cells for tokens, columns x rows, flat or scoop floor.
* **Card tray, flat** (`card-tray-flat`): card stacks lying face up in columns, finger gaps down into a floor groove (the floor is raised by the groove depth, so it never breaks through).
* **Card tray, upright** (`card-tray-upright`): standing card stacks in columns, wedges in the long walls (on by default, sized relative to the stack slot unless set explicitly).
* **Card tray, tilted** (`card-tray-tilted`): card dispenser, stacks leaning back with an open front, lanes in rows.

The first standard set (`tray`, `divided-tray`, `card-tray`) was replaced by
these on 2026-11-06. Project files that still use them open as before: on load
a `tray` becomes a 1 x 1 item tray, a `divided-tray` an item tray with the same
grid (cell size = compartment size) and a `card-tray` a flat or upright card
tray. The outer size and the stacking settings stay the same; finger notches
are dropped.

### Spacer (`spacer`)

Solid filler block to take up leftover space. Wall and floor settings are ignored.

| Parameter | Default | Meaning |
|---|---|---|
| `width` | 20 | Size in X |
| `depth` | 40 | Size in Y |
| `height` | 30 | Size in Z |

### Platform (`platform`)

Flat plate that spans several trays and carries the next level. Optional corner
stops are four small blocks under the plate that drop just inside the cavities
of the trays below and keep it from sliding. Optional locating ridges on top
lock the smaller organizers that rest on it (see Stacking). Wall and floor
settings are ignored.

| Parameter | Default | Meaning |
|---|---|---|
| `width` | 100 | Size in X |
| `depth` | 100 | Size in Y |
| `thickness` | 2 | Plate thickness |
| `cornerStops` | true | Add the four corner stops |
| `stopSize` | 6 | Side of each square stop |
| `stopHeight` | 2 | Height of the stops below the plate (= how far the platform sinks into the trays below) |
| `stopInset` | 1.75 | Distance of the stops from the plate edge; use the wall + clearance of the trays below |
| `locateItems` | true | *Locate items on top*: add a locating ridge for every item with a recessed base that rests on the plate. The outer height grows by the tallest ridge (only when there are ridges). |

## Stacking

Items can sit on top of other items, not only on the game box floor.

* **Gravity.** Every item has a `z` (the height of its bottom above the game
  box floor), but you never type it: each item rests on the highest item below
  it that it overlaps seen from above, or on the floor. The order of the items
  is the stack order — an item dragged onto another lands on top of it. The
  inspector shows "Rests at z = …" next to the computed top (`z` + outer
  height). The layout checks work in 3D: two items that overlap seen from above
  only collide when their heights overlap too, and "too tall" uses the top of
  the item.
* **Moving stacks.** Dragging an item moves everything stacked on it along (an
  item bridging two trays only comes along when both move); the moved stack goes
  to the end of the stack order, so it lands on top of whatever it is dropped on.
  Alt+drag pulls only the item out from under its stack: the item and everything
  that rested on it go to the end of the stack order, but only the item moves, so
  what is on it stays on it while they still overlap and drops to whatever is
  under it once the item slides out, and the pulled item climbs onto anything it
  is pushed over. Shift+drag moves without snapping.
* **Stack order.** The *Stacks* list in the left column shows each floor item
  with what rests on it (an item on several items is listed under the first and
  marked "also on"). Drag a row onto another row to put it directly underneath
  that item, or use `Alt+↑` / `Alt+↓`. This is the only way to slide an item
  under an existing stack: dropping from the palette always lands on top.
* **Duplicate on top** (`Ctrl+Shift+D`) puts a copy at the same position on top
  of the selected item and names it "… (level 2)", "… (level 3)", and so on.
* **Support check.** An item with `z > 0` must be fully carried: its footprint
  must be covered by items whose tops are exactly at its base (within 0.01 mm).
  Otherwise it is listed as *Floating* (a warning, light blue in the 3D
  editor). An item whose base lies inside another item's body is an error.
* **Stack fit check.** The support check looks at footprints; the fit check
  looks at what the item really stands on (see *Stack fit* below): open trays
  only carry on their walls, a lip must drop into a recess, a plug needs an
  empty cavity, and standing cards need free space above them.
* **Reaching hidden items.** With *Fade above* on (the default), selecting an
  item turns everything stacked over it see-through (it keeps its colour) and
  click-through, so you can click and drag the selected item and what is under
  it; items of other stacks stay solid. Select a low item from the *Stacks*
  list, or click its visible side. *Exploded* lifts each stack level 15 mm
  apart for display only; you can still select and drag items, and the real
  positions are unchanged.

Stacking features of the boxes: the item tray and the three card trays all have a
*Stacking* parameter group. These features are made for **trays with the same
footprint and the same wall thickness** stacked directly on top of each other.

**Lip + recess is the standard.** An item tray or card tray you add
from the palette starts with `stackTop: lip` and `stackBottom: recess`, so any
two new trays of the same footprint lock onto each other. Switch them to *Flat*
if you don't want it. The parameter defaults below stay `none`: projects saved
before this change, and the sample, keep exactly their geometry. Duplicates
copy their source's settings.

**Plug is a retrofit.** Use *Plug (retrofit onto a plain tray)* only to stack a
new tray onto a tray that is already printed without a lip. The plug drops into
the lower tray's cavity, so that cavity must be empty (it collides with the
dividers of an item tray with several cells) and the plug takes `plugHeight` of its height.

| Parameter | Default | Meaning |
|---|---|---|
| `stackTop` | `none` (new items: `lip`) | `lip`: the outer half of the wall (`wall/2`) rises `lipHeight` above the wall top. The outer height grows by `lipHeight`. |
| `stackBottom` | `none` (new items: `recess`) | `recess`: a ring `wall/2 + stackClearance` wide and `lipHeight + stackClearance` deep is cut from the outer bottom edge, so the tray sits on a `lip` tray below. `plug` (retrofit): a solid pad `(inner − 2·stackClearance)` × `plugHeight` under the floor drops into the cavity below. The outer height grows by `plugHeight`. |
| `lipHeight` | 2 | Height of the lip, and of the lip a recessed base receives |
| `plugHeight` | 2 | Height of the plug |
| `stackClearance` | 0.15 | Gap around a recess or plug |

How far a base sinks into the item below (its *engagement*) is `lipHeight` for
a recess on a tray with a lip (the inner half of the wall rests on the lower
wall; the extra clearance stays as a gap above the lip), 0 for a recess on
anything else (a plain tray, platform or spacer: it simply rests on top),
`plugHeight` for a plug and `stopHeight` for a platform with corner stops. An
item resting on several items sits on the highest effective surface (top −
engagement on that item); it counts as supported only by the items that meet
it there. Gravity takes this into account. A recess needs at least 0.4 mm of
wall left next to it (`wall/2 − stackClearance ≥ 0.4`). Finger gaps and
wedges cut through the lip. A plug needs an empty cavity below: it collides
with the dividers of an item tray with several cells.

**Platform locating ridges.** A platform with *Locate items on top* (on by
default) gets a ridge for every item resting on its plate whose base is a
`recess`: a ring along that item's outer footprint edge, `wall/2` of *that
item's* wall wide and its `lipHeight` high, standing on the plate — the same
shape as a tray's lip, so the recess drops over it. Ridges are clipped to the
plate, and the ridges of items placed edge to edge merge. Items without a
recess get no ridge. Several smaller organizers of different types can so be
locked on one platform. Everything on the platform still rests on the plate:
the platform's top is the top of its ridges, and its engagement for anything on
it is the ridge height (`lipHeight` when all ridged items use the same lip), so
gravity puts the items on the plate and the support check accepts
them. With the option off, ridges are left out and items rest on the flat plate.
An item counts as resting on the platform when it overlaps it seen from above
and its `z` is the plate top (within 0.01 mm).

The platform's geometry is based on the items on it: moving, resizing or
changing those items changes the platform and means **reprinting it**. The
inspector lists the items a selected platform's ridges are based on, and the
item preview, the 3D editor and the export rebuild the platform as soon as
they change (the OpenSCAD file lists them as "Based on: …").

### Stack fit

Every item with `z > 0` that rests on something is checked against the items
it rests on (its *supporters*: those whose top − engagement is its `z`).

* **Bearing areas.** Each box type says which parts of its top can carry
  something. Item tray and card trays: the wall ring. With a lip, the lip ring (outer
  half of the wall, at the lip top) and the inner half of the wall (at the wall
  top): a recessed tray rests on the inner half while the lip sits in its
  recess. Plus the dividers between cells that reach the wall top
  (`dividerHeight` 0 or ≥ inner height); lower dividers carry nothing. Platform:
  the whole plate (its ridges are lips). Spacer, and any type without the hook:
  the whole top.
* **Bearing rule.** The contact area is the item's footprint ∩ the bearing
  areas of its supporters at its base height (from `z` up to `z` + its own
  engagement). No contact at all: **error** "rests on nothing: it hangs over
  the open cavity of …". Contact whose convex hull does not contain the item's
  footprint centre with a margin of 10 % of the item's smaller side
  (`TIP_MARGIN_FRACTION`): **warning** "may tip" (light blue in the assembly
  view, like *Floating*). An item gets one support message: "rests on
  nothing", else "may tip", else *Floating*. So: strips side by side across a
  big tray, each reaching the front and back walls, are fine; a 2 × 2 grid of
  trays on one big tray gives four warnings (each rests on an L of two walls);
  the middle tray of a 3 × 3 grid rests on nothing.
* **Lip and recess.** Nothing of a supporter may reach above the item's base:
  the base is at `z` + the tallest protrusion, raised by the recess depth under
  the recess ring, and at `z` under a protrusion. A lip (or platform ridge)
  under the item's recess ring fits; a lip under its floor (e.g. one wide
  recessed tray across two lip trays) is an **error**. A recess edge that sits
  on a wall without a lip is fine.
* **Plug and corner stops.** A plug pad (`inner − 2·clearance`, `plugHeight`
  deep) or a platform's corner stops must drop into an open cavity: an
  **error** when they hit walls or dividers that reach higher than the pad's
  bottom (a plug on an item tray with several cells), or a solid top (a plug on a spacer or a
  platform). The engagement stays `plugHeight` on anything, so gravity sinks
  the plug and the check reports the collision.
* **Keep‑out space.** An upright card tray keeps the space above its cavity
  free up to where the cards stick out (`exposedHeight` − lip height above its
  top). Another item in that space is an **error**, and the "too tall" check
  uses the top of the cards.

Fit messages name both items and say what to change. A fit error highlights
the stacked item (and, for a collision, the item it collides with) like any
other error.

`examples/stacking-demo.json` (open it with *Open*) shows every case, A to S
(there is no case K: a tray sunk into another cannot happen with gravity);
each label ends with what the app reports: `(OK)`, `(warning)`, `(error)`, or
`(flagged with X)` for a base that is part of X's error.

The sample project shows both mechanisms: a lip tray with a recessed tray on
top, and a platform on two trays that carries a third tray.

## Adding a box type

Every box type is a `BoxTypeDefinition` (see `src/boxes/types.ts`). The UI builds
its parameter form from `params`, draws the mini-map footprint from `draw()` and places items
using `footprint()`, so a new type needs no UI changes.

1. Create `src/boxes/definitions/<name>.ts` and export a `BoxTypeDefinition`
   implementing `params`, `footprint`, `build`, `draw` and (optionally) `validate`.
   Helpers such as `num`, `openBox` and the stacking helpers live in `common.ts`;
   a type made of repeated cells uses the tiling framework in `tiling.ts`.
   A type whose geometry depends on the items resting on it (like the
   platform's ridges) opts in with `usesItemsAbove` and reads `item.context`;
   see DESIGN.md §4.2.
   For the stack fit check (DESIGN.md §4.3), a type with an open top should
   implement `bearingAreas` (without it the whole top counts as solid; the
   helper `cavityBearingAreas` gives the wall ring), a type with a recess, plug
   or feet `baseFeatures`, and a type with something sticking out above its top
   `keepOut`.
2. Register it in `src/boxes/index.ts`: import it and add it to
   `standardBoxTypes`, which controls palette order.
3. Add tests to `src/boxes/boxes.test.ts` or a file of its own, following the
   existing `describe('item-tray')` blocks in `src/boxes/containers.test.ts`. Check at least the footprint and that the solid builds with the expected
   bounds.
4. Run `npm test` and `npm run build`.

Minimal example (a tray sized for a row of coins):

```ts
// src/boxes/definitions/coin-tray.ts
import type { BoxTypeDefinition } from '../types';
import { num, openBox, requirePositive } from './common';

const dims = (item: Parameters<BoxTypeDefinition['footprint']>[0]) => {
  const d = num(item, 'diameter');
  return { iw: d * num(item, 'count'), id: d, ih: num(item, 'innerHeight') };
};

export const coinTray: BoxTypeDefinition = {
  id: 'coin-tray',
  name: 'Coin tray',
  description: 'Open tray sized for a row of coins.',
  params: [
    { key: 'diameter', label: 'Coin diameter', kind: 'number', default: 25, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'count', label: 'Coins per row', kind: 'number', default: 8, min: 1, step: 1, unit: 'count', group: 'Size' },
    { key: 'innerHeight', label: 'Inner height', kind: 'number', default: 20, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
  ],
  footprint(item) {
    const { iw, id, ih } = dims(item);
    return { width: iw + 2 * item.wall, depth: id + 2 * item.wall, height: ih + item.floor };
  },
  build: (item, kernel) => {
    const { iw, id, ih } = dims(item);
    return openBox(kernel, iw, id, ih, item.wall, item.floor);
  },
  draw(item) {
    const { iw, id } = dims(item);
    return [{ kind: 'rect', role: 'cavity', x: item.wall, y: item.wall, w: iw, h: id }];
  },
  validate: (item) => {
    const problems: string[] = [];
    requirePositive(problems, 'Coin diameter', num(item, 'diameter'));
    return problems;
  },
};
```

## Printing notes

* STL files are binary, in millimetres, one solid per file. Each part's floor sits on
  Z = 0, so it can be placed on the print bed as exported.
* Print parts as-is; they are already in the orientation they will be used in.
* Suggested wall thickness is 1.2 to 2 mm and floor thickness 1 to 1.5 mm. With a
  0.4 mm nozzle, walls that are multiples of 0.4 mm (1.2, 1.6, 2.0) print cleanest,
  because the perimeters fill the wall exactly.
* Tolerance: a total of 2 to 3 mm per axis is typical. It leaves room for the
  printed parts to slide in and out without being tight, and absorbs the small
  dimensional error of a home printer.

## Architecture

The app is a Vite + React 19 + TypeScript project with a single zustand store and a
three.js 3D editor (plus a small SVG mini-map). Geometry is computed with `manifold-3d` (WASM). See
[`DESIGN.md`](DESIGN.md) for the data model, coordinate frames, conventions and
module ownership.

```
src/
  App.tsx            top-level layout, keyboard shortcuts, toolbar, autosave
  main.tsx           entry point; creates services and mounts the app
  model/             project data model, layout maths (usable area, snapping,
                     validation summary), parameter resolution
  state/             zustand store with undo/redo history
  boxes/             BoxTypeDefinition interface, registry, standard definitions
    definitions/     one file per box type plus common.ts helpers
  geometry/          thin wrapper over manifold-3d (the only module that imports it),
                     binary STL writer
  services/          BoardGameGeek client, persistence (autosave, JSON),
                     STL/zip exporter, file download
  preview/           three.js 3D editor (AssemblyView, scene, camera) and the
                     3D preview of a selected item
  ui/                palette, settings, stacks outline, mini-map, inspector,
                     validation, status bar
```

The BGG lookup calls `/api/bgg`, which the Vite dev server proxies to
`boardgamegeek.com/xmlapi2`. BGG's API has no CORS headers, so this proxy is needed.
`npm run build` does not include a proxy: the production build only has the lookup
working behind a reverse proxy that forwards `/api/bgg` to BGG in the same way.
Manual entry always works without it.

BoardGameGeek also requires a registered application token for its XML API.
Request one at https://boardgamegeek.com/using_the_xml_api and start the dev
server with it in the environment:

```
BGG_TOKEN=your-token npm run dev
```

Without a token the lookup shows an explanatory error and you enter the size by hand.
