# P5 announcement: draft for the owner

This is a draft. Nothing here is posted or sent anywhere by an agent. The owner edits it, picks the channel and posts it.

Post it only after these switches are on for members, or it points at doors they cannot open:
`NOTEBOOK_JOURNAL_STYLES_ENABLED`, `NOTEBOOK_TEMPLATE_GALLERY_ENABLED`, `NOTEBOOK_STYLE_LIBRARY_ENABLED` and `NOTEBOOK_STARTER_PACKS_ENABLED`.

## Draft (164 words)

**Journal styles are in the Notebook**

Pick a kind of note (trade plan, daily prep, weekend prep, earnings, post-trade review, weekly review and more) and a style for it. Every new note of that kind starts with the same outline and the same blocks.

Blocks are the working parts of a note: a pre-entry checklist, position sizing, a market context stamp, and the daily prep pack (morning wire and exposure, earnings for your names, your movers, key levels from your plans).

The community library lets you browse styles other traders share. Adopt one and it becomes your own copy to change. Tick "Notify me when the author updates" and you get a notice when a newer version is out.

Not sure where to begin? Open Styles and press Starter packs. It asks "How do you trade?". Pick Swing, Day, Prop, Options or Earnings and we add three styles you can change.

Start with New note, then From a style, or open the Learn menu.

## Checked against the code

| Claim | Where it is true |
|---|---|
| Kinds of note, a style per kind, new notes start from it | `api/services/journal_two/journal_styles.py`: `BUILTIN_STYLES`, the create path calls `default_style_for_kind` |
| The four blocks named | `app/src/pages/journal-2-0/lib/journalBlocks.js` (`preEntryChecklist`, `positionSizing`, `marketcontext`, the `prep*` blocks) |
| Adopt gives your own copy | `template_gallery.adopt_style` writes a `j2_journal_styles` row for the member |
| Update notice is opt-in | `StyleLibraryCard.jsx`: "Notify me when the author updates", off by default; `UPDATE_NOTICE` in `template_gallery.py` |
| "How do you trade?", five packs, three styles each | `StarterPackOffer.jsx` (`OFFER_TITLE`, `OFFER_LINE`), `lib/starterPacks.js` `PACKS`, `template_gallery_style_seed.json` |
| Starter packs button | `StylesManager.jsx`, beside New style and Community |
| New note, then From a style | `NewNoteMenu.jsx` |
| Learn menu | `onboarding/learnMenuCopy.js` (`button: 'Learn'`) |

No performance claims and no numbers about members. The word count covers the heading and the body.
