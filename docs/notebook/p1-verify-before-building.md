# P1.7 — verify before building (journal styles)

Spec: `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md` §P1.7. Measured at
`b4282b5d9d` on branch `notebook-p1-styles`. Every claim cites a line read at write time.

## §a — Is the `widgetEmbed` kind open-ended?

**Yes, at every layer. A new block kind needs no schema level.**

- The client schema table versions the node TYPE, not the widget kind:
  `app/src/pages/journal-2-0/lib/notebookSchema.js:79` — `  widgetEmbed: 0,`. The only
  attribute row is `:131` — `  'widgetEmbed.ta': 4,`.
- The server twin is the same: `api/services/journal_two/notebook_schema.py:78` —
  `    "widgetEmbed": 0,` and `:135` — `    "widgetEmbed.ta": 4,`. The level a body needs is computed
  from the node type (`:200` — `required = max(required, NOTEBOOK_TYPE_SCHEMA.get(t, 0))`),
  never from `attrs.widgetId`.
- The editor node stores the kind as a free string:
  `app/src/pages/journal-2-0/lib/widgetEmbedNode.jsx:117` — `widgetId: stringAttr('data-widget-id'),`.
- The save path indexes any non-empty string: `api/services/journal_two/notes.py:386-387` —
  `widget_id = attrs.get("widgetId")` / `if isinstance(widget_id, str) and widget_id:`.
- The registry tolerates unknown param keys by design: `app/src/widgets/registry.js:1000` —
  `Validate STORED params (from a notebook doc). Unknown keys are tolerated`.

**The catch (binding on P2):** an older bundle drops an ATTRIBUTE it does not declare.
`widgetEmbedNode.jsx:125-126` (one comment sentence wrapped over two lines) —
`NOTEBOOK_TYPE_SCHEMA versions node/mark TYPES, not attributes — an older bundle silently DROPS an`
`attr it does not know.` The mechanism is ProseMirror's `NodeType.create`, which builds only the
attributes the type declares (`prosemirror-model/dist/index.js:2157` —
`return computeAttrs(this.attrs, attrs);`, whose loop at `:2034` is `for (let name in attrs) {`
over the declared set), followed by `node.type.checkAttrs(node.attrs);`
(`prosemirror-model/dist/index.js:1531`, directly after the `create` call at `:1530`). So a block's
member state lives inside the existing `params` attribute (`widgetEmbedNode.jsx:118` —
`params: jsonAttr('data-params', {}),`), never in a new attribute. A new attribute would take a
`NOTEBOOK_ATTR_SCHEMA` row in both files and the next level, never-revert. Task 2 of the P1 plan
adds the rail for this: `app/src/pages/journal-2-0/lib/widgetEmbedNode.unknownKind.test.js`
(CONTROL case). That file does not exist yet at `b4282b5d9d`.

## §b — What does an OLDER bundle do with an unknown kind?

**It keeps the node and every attribute it declares, renders a labelled card, and writes the node
back unchanged on the next save. No data loss.**

- The node type is always registered: `widgetEmbedNode.jsx:7` —
  `NEVER remove this extension from buildExtensions(): TipTap DROPS unknown` (continuing, over the
  next lines) `node types at parse time` … `"Unknown widget" is a` `VALUE-level state`.
- An unknown kind takes the placeholder path:
  `app/src/pages/journal-2-0/lib/widgetEmbedCore.js:387` —
  `if (!meta) return { kind: hasImage ? 'image' : 'placeholder', reason: 'unknown-widget' }`.
- The view never writes it. The one `updateAttributes` call that runs from an effect is the
  self-archive at `WidgetEmbedView.jsx:517` (inside the `useEffect` at `:468`), and that effect is
  armed only by `WidgetEmbedView.jsx:467` — `const needsArchive = decision.kind === 'live' && …`.
  The `placeholder` / `image` decision an unknown kind gets is not `live`, so it never arms. Every
  other `updateAttributes` call in that file (`:266`, `:287`, `:290`, `:316`, `:340`, `:376`,
  `:391`, `:399`, `:447`, `:545`) sits in a user-event handler or callback, none in an effect.
- **The gap is the words, not the data:** the card says `WidgetEmbedView.jsx:155` —
  `reason === 'unknown-widget' ? 'widget type unavailable' : …`. The spec wants "This block needs
  a newer version — reload". Task 2 of the P1 plan changes the copy, adds a Reload control and
  rails the round trip (client and server), ahead of any new kind. It is not a data-loss fix.

## §c — A switch gates CREATING blocks, never RENDERING them

The precedent is in the code: `widgetEmbedNode.jsx:150` —
`Registered unconditionally (the gate NOTEBOOK_CHART_PLAN_ENABLED only` (continuing)
`hides the doors)`.

P1 reads `NOTEBOOK_JOURNAL_STYLES_ENABLED` (payload key `notebook_journal_styles_enabled`) ONLY in:

1. the router dependency of `api/routers/notebook_journal_styles.py` (one 404 for every route);
2. the `styleId`/`kindId` branch of `POST /api/j2/notes` (`api/routers/journal_two.py`);
3. client doors: the New note menu's "From a style", the kind section of the New note sheet, the
   Styles button, the Settings card, `/style`, "Save this note's setup as a style", the update
   banner, and offering `builtin:note_kind` in "Add property".

It is NEVER read by: the `widgetEmbed` node, the note body, `GET /api/j2/notes/{id}`, the
`builtin:note_kind` property definition, or the property resolve. With the switch off, a note made
from a style opens exactly as it was saved, its chart renders, and its Kind of note value still
shows. Rails (neither exists yet at `b4282b5d9d`; later tasks add them):
`tests/test_note_kind_property.py::test_note_kind_def_is_present_with_the_switch_off`
(Task 5) and `B/NoteEditorPage.styleUpdate.test.jsx` "a styled note renders with the switch off"
(Task 14).
