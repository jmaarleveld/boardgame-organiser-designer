# Board Game Insert Designer

A browser app for designing 3D-printable organizer inserts for board game boxes.
Enter the inside dimensions of your game box, drag parametric trays and spacers
into a top-down view, and export one binary STL per unique part, ready for your slicer.
Everything runs client-side; there is no backend.

<!-- Screenshot: add an image of the top view and inspector here, e.g.
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
   (default 1 mm; 0 turns it off) sets the snapping increment in the top view.
4. **Add boxes.** Click a box type in the palette or drag it into the top view.
   Each item has a label and the parameters of its type.
5. **Arrange.** Drag items to move them. They snap to the grid, to the usable-area
   edges and to neighbouring item edges (guides show while snapping). Rotate with
   `R` to swap width and depth.
6. **Override per item.** In the inspector, tick "override project default" to give
   one item its own wall or floor thickness. Clear the tick to go back to the
   project default.
7. **Check validation.** Overlapping items, items outside the usable area, items
   taller than the box, and invalid parameters (for example a notch wider than the
   wall it is cut from) are highlighted in the top view and listed in the
   validation panel. The status bar shows the remaining slack in X and Y.
8. **Export.** "Export all STL" builds every item and downloads a zip containing one
   binary STL per unique geometry plus a `manifest.txt`. Items that are identical
   (same type, parameters, wall and floor) share one file, and the manifest gives the
   count to print. The inspector also offers per-item export (STL or `.scad`) and a 3D
   preview.

   Every `.stl` in the zip has a matching `.scad` file: OpenSCAD source describing the
   same geometry, for tweaking by hand. Parameters are baked in as literal numbers;
   the header comment lists them (with wall, floor and outer size) for reference only,
   so editing those lines changes nothing. `$fn` at the top controls how smooth notch
   and other round cut-outs are.
9. **Save and load.** Save writes the whole project as JSON; Open loads a JSON file
   (it is validated before it is applied). The current project is also autosaved to
   the browser's `localStorage` and restored on the next visit. Autosave is per
   browser profile, so use Save for anything you want to keep.

## Controls

Mouse:

| Action | Control |
|---|---|
| Select an item | Click it (click the background to deselect) |
| Move an item | Drag it |
| Disable snapping while dragging | Hold `Alt` |
| Zoom | Mouse wheel, centred on the pointer |
| Zoom in / out / fit | `+` / `−` / `Fit` buttons at the corner of the top view |
| Pan | Middle-button drag, or hold `Space` and drag |
| Add a box | Click a type in the palette, or drag it into the view |

Keyboard (when focus is not in a text field):

| Key | Action |
|---|---|
| `R` | Rotate the selected item by 90° |
| `Delete` / `Backspace` | Remove the selected item |
| `Ctrl+D` / `Cmd+D` | Duplicate the selected item |
| `Ctrl+Shift+D` / `Cmd+Shift+D` | Duplicate the selected item on top of itself (see Stacking) |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Y` or `Ctrl+Shift+Z` | Redo |
| Arrow keys | Nudge the selected item by one grid step |
| `Shift` + arrow keys | Nudge by ten grid steps |
| `Esc` | Deselect |
| `Tab` | Move focus through the items in the top view |

## Standard boxes

The v1 set is a starting point and is meant to be extended (see below). All
dimensions are in mm. "Default" is the value a new item starts with.

### Tray (`tray`)

Plain open-top tray with optional finger notches in its walls.

| Parameter | Default | Meaning |
|---|---|---|
| `innerWidth` | 60 | Inside width (X) |
| `innerDepth` | 40 | Inside depth (Y) |
| `innerHeight` | 30 | Inside height above the floor |
| `fingerNotch` | true | Cut finger notches |
| `notchSides` | `long` | Walls to notch: `long`, `short` or `both` |
| `notchWidth` | 20 | Width of each notch along the wall |
| `notchDepth` | 15 | Depth of each notch, measured down from the top edge |

### Divided tray (`divided-tray`)

Tray split into an N x M grid of equal compartments.

| Parameter | Default | Meaning |
|---|---|---|
| `innerWidth` | 90 | Inside width (X) |
| `innerDepth` | 60 | Inside depth (Y) |
| `innerHeight` | 25 | Inside height above the floor |
| `columns` | 3 | Compartments along X (dividers parallel to Y) |
| `rows` | 2 | Compartments along Y (dividers parallel to X) |
| `dividerThickness` | 1.2 | Thickness of each divider |
| `dividerHeight` | 0 | Divider height above the floor; 0 means full inner height |
| `fingerNotch` | false | One notch per row in the outer walls and in every column divider |
| `notchWidth` | 18 | Width of each notch |
| `notchDepth` | 12 | Depth of each notch, measured down from the top edge |

### Card tray (`card-tray`)

Holder for a stack of cards, lying flat or standing upright. The notch depth is
derived from the height of the cavity (half of it, at least 8 mm).

| Parameter | Default | Meaning |
|---|---|---|
| `cardWidth` | 63.5 | Width of one card |
| `cardHeight` | 88 | Height of one card |
| `clearance` | 1 | Extra space on each side of the cards |
| `stackHeight` | 30 | Thickness of the stack (sleeved cards are about 0.5 mm each) |
| `orientation` | `flat` | `flat` (face up) or `upright` (standing) |
| `exposedHeight` | 20 | Upright only: how far the cards stick out above the walls |
| `notchWidth` | 25 | Finger notch width; 0 means no notches |

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
of the trays below and keep it from sliding. Wall and floor settings are ignored.

| Parameter | Default | Meaning |
|---|---|---|
| `width` | 100 | Size in X |
| `depth` | 100 | Size in Y |
| `thickness` | 2 | Plate thickness |
| `cornerStops` | true | Add the four corner stops |
| `stopSize` | 6 | Side of each square stop |
| `stopHeight` | 2 | Height of the stops below the plate (= how far the platform sinks into the trays below) |
| `stopInset` | 1.75 | Distance of the stops from the plate edge; use the wall + clearance of the trays below |

## Stacking

Items can sit on top of other items, not only on the game box floor.

* **Elevation.** Every item has a `z` (the height of its bottom above the game
  box floor, default 0). The inspector shows it in the *Elevation* group next to
  the computed top (`z` + outer height). The layout checks work in 3D: two items
  that overlap in the top view only collide when their heights overlap too, and
  "too tall" uses the top of the item.
* **Rest on items below** sets `z` so the item rests on the highest item it
  overlaps in the top view (or on the floor when it overlaps nothing).
* **Duplicate on top** (`Ctrl+Shift+D`) puts a copy at the same position on top
  of the selected item and names it "… (level 2)", "… (level 3)", and so on.
* **Support check.** An item with `z > 0` must be fully carried: its footprint
  must be covered by items whose tops are exactly at its base (within 0.01 mm).
  Otherwise it is listed as *Floating* (a warning, light blue in the assembly
  view). An item whose base lies inside another item's body is an error.
* **Level filter.** When the layout has more than one level, a *Show up to*
  menu appears next to the zoom buttons of the top view. Pick a level to hide the
  items stacked above it so you can edit the lower ones. Elevated items have a
  dashed outline and an `↑ z` badge.

Stacking features of the boxes: tray, divided tray and card tray all have a
*Stacking* parameter group. These features are made for **trays with the same
footprint and the same wall thickness** stacked directly on top of each other.

| Parameter | Default | Meaning |
|---|---|---|
| `stackTop` | `none` | `lip`: the outer half of the wall (`wall/2`) rises `lipHeight` above the wall top. The outer height grows by `lipHeight`. |
| `stackBottom` | `none` | `recess`: a ring `wall/2 + stackClearance` wide and `lipHeight + stackClearance` deep is cut from the outer bottom edge, so the tray sits on a `lip` tray below. `plug`: a solid pad `(inner − 2·stackClearance)` × `plugHeight` under the floor drops into the cavity below. The outer height grows by `plugHeight`. |
| `lipHeight` | 2 | Height of the lip, and of the lip a recessed base receives |
| `plugHeight` | 2 | Height of the plug |
| `stackClearance` | 0.15 | Gap around a recess or plug |

How far a base sinks into the item below (its *engagement*) is `lipHeight` for
a recess (the inner half of the wall rests on the lower wall; the extra
clearance stays as a gap above the lip), `plugHeight` for a plug and
`stopHeight` for a platform with corner stops. *Rest on items below* and
*Duplicate on top* take this into account. A recess needs at least 0.4 mm of
wall left next to it (`wall/2 − stackClearance ≥ 0.4`). Finger notches cut
through the lip. A plug needs an empty cavity below: it collides with the
dividers of a divided tray.

The sample project shows both mechanisms: a lip tray with a recessed tray on
top, and a platform on two trays that carries a third tray.

## Adding a box type

Every box type is a `BoxTypeDefinition` (see `src/boxes/types.ts`). The UI builds
its parameter form from `params`, draws the top view from `draw()` and places items
using `footprint()`, so a new type needs no UI changes.

1. Create `src/boxes/definitions/<name>.ts` and export a `BoxTypeDefinition`
   implementing `params`, `footprint`, `build`, `draw` and (optionally) `validate`.
   Helpers such as `num`, `openBox` and the notch cutter live in `common.ts`.
2. Register it in `src/boxes/index.ts`: import it and add it to
   `standardBoxTypes`, which controls palette order.
3. Add tests to `src/boxes/boxes.test.ts`, following the existing `describe('tray')`
   blocks. Check at least the footprint and that the solid builds with the expected
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
plain SVG top view. Geometry is computed with `manifold-3d` (WASM). See
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
  preview/           three.js 3D preview of a selected item
  ui/                palette, settings, top view, inspector, validation, status bar
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
