# K2 keyboard walk — raw evidence (wave 10 lane K2, 2026-09-28)

Raw output only, committed before any summary (R-RAW). The interpretation is in the lane's report
(`wave10-K2-report.md` in the controller's ledger), not here.

## What ran

| path | what | against |
|---|---|---|
| `before/walk-all.json`, `before/shots/`, `before/walk-console.log` | this directory's walk, all sections (S1–S6) | tip `fa6710394` (the branch base), sandbox `C:\data-w10k2` on `:8227` |
| `before/attempt1-*` | the first "before" attempt: it died at the admin sign-up (a 30 s request timeout while the fresh sandbox was still warming), after the C0 control and before any product step | same sandbox |
| `after/` | the same walk at the K2 tip (added when it ran) | a fresh boot of the same sandbox |

## The walk is lane 10E-2's, copied, with three changes

`keyboard_walk.py`, `kbd_more.py` and `kbd_lib.py` are copies of
`docs/notebook/evidence/a11y-second-review-2026-09-27/` (10E-2's instrument, the one F4 re-ran).
`kbd_lib.py` is unchanged. The changes, all in the open:

1. `keyboard_walk.py`: the recorded `tip` is read from `K2_TIP` (the original hard-coded
   `d9e887ca0`, the tip 10E-2 walked).
2. `kbd_more.py`, S2-13 and S2-14 — the probes 10E-2 marked INCONCLUSIVE and F4's run scored
   FAIL. They could not answer:
   * S2-13 looked for the inserted link as `[data-note-id]`, `[data-type="noteLink"]` or
     `.noteLink`; the editor renders `<span data-note-link>` (NoteLinkView.jsx), so a link that
     WAS inserted read as absent (F4's own S2-18 row shows "Beta rates note" in the body).
   * S2-14 expected "a date picker opens"; `@date` is an input rule, not a picker
     (`app/src/pages/journal-2-0/lib/dateMentionNode.js`, its header), so no product could
     have passed it.

   The new probes count BEFORE and AFTER (a delta, never a presence) and each has a case that
   must answer "no": S2-13c (Escape inserts nothing) and S2-14c (a CONTROL: `@notaday` must stay
   text, verdict `INSTRUMENT-FAILED` otherwise). S2-13b adds keyboard selection (ArrowDown, then
   Enter inserts the option that was selected, not the first).
3. `kbd_more.py`, the editor doors (S2-2x) and Lock/Archive (S2-30/31): when a door is not a Tab
   stop on the page, the walk opens the note's "More note actions" disclosure and Tabs to it
   there (`reach_door`), and records which route it took. Design finding D-3 moved those actions
   behind that door; a page without it never takes the second route, so the SAME walk measures
   before and after.

## Preconditions (as 10E-2's walk requires)

`app/dist` rebuilt from the tip under test; a census-pinned `scripts/hub_sandbox_boot.py` boot
through `docs/notebook/proof/e2-d9e887ca0/e2_sandbox.py` (data dir passed from PowerShell,
single-quoted); identity proved by `scripts/sandbox_identity.verify` before any request; the walk
account is a paid-equivalent sandbox member (`e2-kbd@local.dev`), never production.
