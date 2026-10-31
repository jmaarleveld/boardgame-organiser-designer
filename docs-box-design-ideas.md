# Box design ideas and open questions

Working notes for the standard organizer set. The v1 set (tray, divided tray,
card tray, spacer, platform) is a starting point; this file collects proposed
additions and the questions whose answers change the designs.
Last updated 2026-10-31.

## Proposed additions and changes

- **Lid for a tray.** A cap that drops over a tray's outer wall, with lip height
  and clearance as parameters. Keeps tokens in place when the game box is stored
  vertically. Separate printed item, so a box type rather than a parameter.
- **Token tray with a scoop floor.** Floor curves up along one long wall so small
  tokens slide to one side and are easy to pick up. Better than a finger notch
  for coins and cubes.
- **Card well with a tilt.** For upright cards: floor sloped 10 to 15 degrees so
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
- **Stacking** (being implemented): elevation per item, lip/recess and floor plug
  mechanisms on cavity types, platform element with corner stops.

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
