# Box design ideas and open questions

Working notes for the standard organizer set (item tray, flat / upright /
tilted card trays, spacer, platform); this file collects proposed additions
and the questions whose answers change the designs.
Last updated 2026-11-06.

## Proposed additions and changes

- **Lid for a tray.** A cap that drops over a tray's outer wall, with lip height
  and clearance as parameters. Keeps tokens in place when the game box is stored
  vertically. Separate printed item, so a box type rather than a parameter.
- **Token tray with a scoop floor** (done 2026-11-06, `item-tray` with
  `floorShape: scoop`). Floor curves up along one long wall so small
  tokens slide to one side and are easy to pick up. Better than a finger notch
  for coins and cubes.
- **Card well with a tilt** (done 2026-11-06, `card-tray-tilted`). For upright cards: floor sloped 10 to 15 degrees so
  the stack leans against the back wall and fans slightly. Standard in commercial
  inserts. Chiral, which matters for the mirrored assembly view (see DESIGN.md).
- **Dividers for the card tray.** Removable tabbed divider cards sized to the
  card well, so one tray can hold several decks. Thin separate item with a count,
  printed flat.
- **Dice or round-token tray.** A block with a grid of circular wells; well
  diameter, depth, columns and rows as parameters. Dice, meeples by type, round
  tokens.
- **Rounded corners and chamfers as a project default.** Outer corner radius of
  2 to 3 mm and a small bottom chamfer (avoids elephant foot, looks better).
  Project-wide default like wall thickness, overridable per item.
- **Stacking** (done, 719747e): elevation per item, lip/recess and floor plug
  mechanisms on cavity types, platform element with corner stops.
- **Locating ridges on the platform top** (decided 2026-11-03, being built):
  lip-shaped ridges along the outer edge of each recessed item resting on the
  platform, so several smaller containers lock onto one level with the same
  lip/recess mechanism. Items without a recess get nothing (flat). First feature
  where an item's geometry depends on its neighbours (box contract change);
  moving an item on the platform means reprinting the platform. Pockets cut into
  the plate were the rejected alternative (thicker plate, thin walls between
  flush items).
- **Stack fit check** (done 2026-11-03): an item's base is checked against the
  top of what it rests on. Box types describe their bearing areas (open trays:
  the walls, with a lip the inner wall half plus the lip; divided trays add
  full-height dividers; platforms and spacers are solid), base features
  (recess ring, plug, corner stops) and keep-out space (standing cards).
  No contact is an error ("rests on nothing"); contact whose hull does not
  contain the centre by 10 % of the smaller side is a "may tip" warning; a lip
  under a floor, a plug or corner stop hitting walls, dividers or a solid top,
  and anything in the space of standing cards are errors; standing cards count
  for "too tall". Strips across a big tray pass, a 2 × 2 grid warns, the
  middle of a 3 × 3 grid is an error. `examples/stacking-demo.json` (cases A–S)
  labels every item with what the app reports, and a test keeps that true.
  Possible follow-ups: show bearing areas and keep-out space in the top view;
  let *Rest on items below* skip items whose keep-out it would enter.

## Open questions

1. **Target games.** The component mix decides priorities. Euro with cubes and
   cards: scoops and card wells. Miniatures game: tall open bins.
2. **Sleeved cards.** Sleeved decks are about 2 mm wider and taller and much
   thicker. Idea: project-wide "sleeved" toggle that adjusts card tray defaults.
3. **Flush tiling versus lift-out space.** Trays edge to edge, or a few mm so
   they can be lifted out? Alternatives: finger notch in the game box corner, or a
   lifting strap channel. Affects the tolerance default and notch design.
4. **Vertical storage.** If games stand on a shelf, every tray needs a lid or
   the next layer must close it. Then lids and platforms are core, not optional.
5. **Printer constraints.** Nozzle size and bed size. With a 0.4 mm nozzle the
   default wall should be a whole number of perimeters (1.2 or 2.0 rather than
   1.6). A bed size limit should cap the largest tray with a warning in the app.

## Decisions so far

- Standard boxes are defined in TypeScript (`src/boxes/definitions/`), with an
  OpenSCAD export generated from the same definitions. OpenSCAD is an output,
  not the engine.
- The assembly view is mirrored in Y so it reads like the top view; revisit when
  the first chiral box type (tilted card well) is added.
- Lip/recess is the standard locking mechanism: new item trays and card
  trays get `stackTop: lip` and `stackBottom: recess`. The parameter default stays
  `none`, so saved projects keep their geometry. The plug stays only as a
  retrofit option for putting a tray onto an already printed plain tray
  (decided 2026-11-03).
- Platforms get locating ridges on top, on by default (a checkbox can turn them
  off), derived from the recessed items resting on them (decided 2026-11-03).
- **Containers v2** (decided and built 2026-11-06, commits eaafa38, 4fedc48):
  one cell per box type plus a tiling framework (`tiling.ts`) that repeats the
  cell in columns and/or rows with shared dividers. Four types: `item-tray`,
  `card-tray-flat`, `card-tray-upright`, `card-tray-tilted`. The tilted tray is the first chiral type, so
  the mirrored assembly view question above is now live. Details in
  `docs-containers.md`.
- **v1 types deleted** (decided 2026-11-06): `tray`, `divided-tray` and
  `card-tray` are gone from the code. Saved projects are migrated on load to
  the containers v2 types with identical footprints and stacking params
  (`tray` → `item-tray` 1 × 1, `divided-tray` → `item-tray` c × r,
  `card-tray` → `card-tray-flat` / `card-tray-upright`); finger notches are
  dropped.
