# Tier 2 part B: the arming packet

What this is: everything the owner needs to turn on `NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED` after the Tier 2 part B PR has
merged and `web` is serving it, and to turn it off again. Merging and arming are the owner's. No agent runs a `railway`
command.

Status (2026-10-15, tree `247bc13994`): built, reviewed task by task and as a whole branch (final review and its fix
wave re-reviewed: no Critical or Important open). Gated and walked at an earlier tip; the re-gate and walk #2 at the final
tip are PENDING (below). Nothing here has been run on production yet.

## What merging does, before anything is armed

Live for every member the moment the PR merges (O-T2B-2, the P0.9 precedent):

- the **Earnings follow-up** note kind and style (three headings: what I expected, what happened, what I will do);
- the **`reminder`** style block (a "Follow up by <date>" task, made only when a style is applied to a new note);
- the **Reminder** slash item: `/remind` makes an unticked task "Follow up " and opens the `@` date list;
- **the `@` date list now takes Enter inside a task.** Before this branch, `@` inside a task followed by ArrowDown and
  Enter split the task instead of picking the date (TipTap ran the task item's Enter before the date list's; click and
  Tab worked). The walk found it on `/remind`; the fix is the extension order in `lib/tiptap.js` (`563069bb54`).
- **The prebuilt community watchlists stop counting as anyone's own names** (`33646af3eb`,
  `member_interest._watchlist_syms` now skips `is_prebuilt` lists). The admin account that owns the prebuilt lists
  (S&P 500, Russell 2000, Sunday Scans, ...) stops seeing those names in its **earnings-prep list** and in the
  **Calendar's My Stocks**; only the lists it made itself remain. Every other member is unaffected (they own no
  prebuilt list). This reader is shared, so it changes on merge, not on arming.

Dark until the switch is armed: the 16:45 / 18:00 ET job, the bell, the card, and the server's prefill.

## Evidence

- Gate, six shards, separate worktree: `docs/notebook/evidence/t2b-gate-c0ada18033/` -- at `c0ada18033`: NO_NEW_FAILURES, 3,473 test files reconcile, tree unchanged. The re-gate at the final tip (`563069bb54`) was stopped by the harness for low system memory before a verdict and is PENDING.
- Walk, sandbox c2, `--only followup`, 1280 / 820 / 390: `docs/notebook/evidence/t2b-walk-20261015T214338/` -- at `c952812a6b`: setup, notice and write PASS at all three widths (including the prep-note link); `followup.reminder` FAILED at all three, which is how the `@` + Enter defect was found. Walk #2 at the final tip, which must show `followup.reminder` PASS, is PENDING.
  15 steps, 3 FAIL, all `followup.reminder`. Sandbox integrity (C:\data) CLEAN at every checkpoint.
- Bytes: first open 2,256,050 B at `5f26255d46` (`docs/notebook/evidence/t2b-bytes-20261015T221929Z.txt`) (ceiling 2,256,406 = merge-base + 2,048; budget 2,260,793). Typing: `lib/tiptap.js` changed only
  in extension ORDER (no extension or plugin added), so no per-keystroke path was added; Part A's typing measurement stands.
- Known pre-existing reds (fail at the merge-base, not this branch's): `tests/test_notebook_flag_parse.py` (2),
  `tests/test_notebook_earnings_prep.py::test_the_import_graph_never_reaches_alphavantage_or_the_recap_generator`, and
  the vitest names inside the gate baseline.

## Arm

```
! railway variables --service web --set "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED=1"
```

`NOTEBOOK_JOURNAL_STYLES_ENABLED` must already be on (it is armed); the job does nothing while it is off.

## Checks after arming, in order

1. A NEW boot: a `[startup] notebook earnings follow-ups registered (16:45 + 18:00 ET mon-fri, boot catch-up ...)` line
   stamped after the `--set`. No boot within ~3 minutes: `! railway redeploy --service web --yes`.
2. The value in the running process (over `railway ssh` with `/opt/venv/bin/python`), never from `--kv`.
3. `/api/auth/me` for the smoke account carries `notebook_earnings_followup_enabled: true`.
4. The app-wide client smoke (R-27): `python tools/hub_nav_smoke.py --auth` (0 PASS, 1 measured, 2 INCONCLUSIVE; H15 on 1).
5. The next trading day's first pass in the logs: `[notebook-earnings-followup] 16:45 pass: {...}`. Read its row in
   `j2_earnings_followup_runs` (over `railway ssh`, `/opt/venv/bin/python`) and check the `result`: `candidates > 0` on
   a day with reporters, `timing_unknown` small, `partial` false, `warm_skipped` recorded. This is the FIRST real test of
   the calendar's past-date answer (V2-V4 below). Since final fix C: `partial` is also true when the one Finnhub call
   for a scanned day failed (the run then used the calendar board alone and is not complete), and `refreshed` /
   `refresh_failed` / `refresh_skipped` count the names whose held earnings copy, read before the reaction closed,
   was rebuilt once for the ranking.
6. `docs/feature_flags.json`: move the entry to `armed` with the flip time, in the same docs push.

## What not to expect

- No bell on a weekend or a market holiday (the run skips them inside).
- Nothing while `NOTEBOOK_JOURNAL_STYLES_ENABLED` is off.
- At most 3 bells per member per session day; the rest are counted and never delivered (capped is final).
- No email and no Discord: the bell is in-app only, and carries the symbol, the report date, the reason ("You hold it."
  / watchlist / flagged) and a link; never note text.
- A before-the-open report rings at 16:45 the same day; an after-the-close report rings the next trading day, once its
  reaction session has closed.

## Known limits, recorded rather than fixed

- **V2, V3-bars and V4-live were never measured** (no sanctioned provider key on this box). The calendar's answer for a
  past date, the bars behind the reaction and the live intel read are unit-tested with patched seams only. Check 5 is
  where they are first seen.
- **F22, a stale held payload:** when the server's held earnings data predates the report, the note says it does not
  have that report's numbers yet; it never shows another quarter's. The numbers are a record: they do not refresh later.
- **The reaction line** is measured only when the held data was read at least 30 minutes after the close of the session
  that reacted; otherwise it is a dash with a sentence naming that session. The server learns which session reacted from the earnings calendar it already holds (cache only); a same-evening bell finds it there. For an older report no longer in that cache it assumes the conservative next session, so the line can be a dash where a number was possible; the sentence then says exactly that.
- **The bell says a company "reported"** on the strength of the earnings calendar listing; nothing re-confirms the
  report before the bell rings.
- **Revenue for a foreign issuer whose reporting currency could not be read** prints with "$" (the repo-wide
  convention). A known currency is shown as its code.
- **Rollback strands delivered bells:** after the switch is turned off, bells already delivered stay in Notices; pressing
  one marks it read and lands on Research Home with no card.

## Roll back

```
! railway variables --service web --set "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED=0"
```

Then verify a NEW boot (as above). The job, the card and the prefill go dark; the two tables stay, unread
(`CREATE TABLE IF NOT EXISTS`, additive). The kind, style, `reminder` block, `/remind` and the `@`-in-a-task fix are
removed only by reverting the PR; no schema changed, notes already made stay ordinary notes and their tasks stay tasks.

## Open items

- NVDA rows 42-44 (`docs/notebook/screen-reader-pass.md`), run only while the owner is away. Row 42 needs an unread
  follow-up bell on the smoke account to grade; without one it records NOT RUN. Rows 39-41 (Part A) wait for the same run.
- A second whole-branch review on Opus after the weekly limit resets (Oct 19, 12pm CT); this branch's final review ran on
  Sonnet.
- The plan's owner decisions, decided by the controller under the owner's standing delegation ("You decide it all",
  2026-10-15): O-T2B-1, arming, is this packet; O-T2B-2, the kind, style, `reminder` block and `/remind` live on merge,
  as built; O-T2B-3, a withheld reaction strip (fewer than 4 quarters) gives a labelled dash, not a second vendor read;
  O-T2B-4, the prep-note window is "on or before the report date, in ET".
- Not carried, by ruling: `/plan`'s ticker shape still refuses digits (Part A's door); a lost create response shows the
  "may not have been saved" sentence rather than checking for the note.
