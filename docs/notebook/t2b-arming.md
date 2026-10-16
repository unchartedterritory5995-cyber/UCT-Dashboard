# Tier 2 part B: the arming packet

What this is: everything the owner needs to turn on `NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED` after the Tier 2 part B PR has
merged and `web` is serving it, and to turn it off again. Merging and arming are the owner's. No agent runs a `railway`
command.

Status (2026-10-16, tree `1054b7b95c`): built, reviewed task by task and as a whole branch twice (a Sonnet final
review, then an Opus final review after the weekly limit allowed it), every fix wave re-reviewed with no Critical or
Important open. Gated, walked and measured at the final merged tree (below). Nothing here has been run on production.

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

- **Final gate**, six shards, at the final merged tree `1054b7b95c` (this branch + master `b4b1df534f`, which carries the
  mid-text fork hotfix #342): VERDICT=NEW_FAILURES new=3 vs the stored baseline, 127 no longer failing, 3,490 test files reconcile -- none of
  the three is this branch's: one passes alone (load), two name master's screener files that this branch does not
  change (`docs/notebook/evidence/t2b-gate-final-1054b7b95c/`). The first gate, at `c0ada18033`, was NO_NEW_FAILURES.
- **Walk #3**, sandbox c2, `--only followup`, 1280 / 820 / 390, at `00703930aa` (this branch + master `34bf314585` +
  the hotfix's fix round 1): `VERDICT c2: 15 steps, 0 FAIL` -- setup (one member, one notice), notice, write, and the
  reminder (one dated task item in the stored body, a live task item counted, due today, a Tasks-view row, and no
  conflicted copy) all PASS at every width; sandbox integrity CLEAN at all four checkpoints
  (`docs/notebook/evidence/t2b-walk3-20261016T023826Z/`).
- **Walk #2** (`docs/notebook/evidence/t2b-walk2-20261015T234317/`) is what found the three defects fixed since: the
  prebuilt watchlists counted as an admin's own names (fixed here, `33646af3eb`), the walk's own dead task-item
  selector, and the single-tab "(conflicted copy)" fork after a mid-text edit -- a defect already live on master for
  every member, named by stack (the outbox drain), reproduced on production with the smoke account, and fixed in its
  own hotfix PR #342 (merged and deployed 2026-10-16, smoke PASS).
- **Bytes**: first open 2,257,813 B at the final tree vs 2,256,066 B for master + the hotfix: **+1,747 B** (rule
  +2,048 B; budget 2,260,793 B -- both PASS) (`docs/notebook/evidence/t2b-bytes-final-20261016T023826Z.txt`).
- **Typing**: an A/B on the same box, master `b4b1df534f` vs this tree, 4 alternating runs per side with date mentions seeded
  (`docs/notebook/evidence/t2b-typing-final-20261016-0214/`), busy-typing ms per key: 1,000 paragraphs p50 6.11 vs
  6.38, p95 9.04 vs 9.62; 2,000 paragraphs p50 9.38 vs 10.13, p95 14.27 vs 15.18. Every delta is inside master's own
  run-to-run spread, so **no measurable regression** -- but all four deltas are positive, and at n=4 a real cost under
  ~1 ms per key cannot be told from noise. The box was not quiet (another session's small test runs). One run per side
  breached 16 ms at the 2,000-paragraph p95, master included; both medians are under the line. No budget was touched.
- **Python rails**, 302 files at `4f939dd65d`, each failure compared with the merge-base `4649e2d03e` run on the
  same file lists: the only failure this branch caused was the switch-rehearsal census missing the new gate (fixed,
  `0404ac3a9b`); every other red also fails at the merge-base or passes alone in a file this branch never touches.
- Known pre-existing reds (fail at the merge-base, not this branch's): `tests/test_notebook_flag_parse.py` (2),
  `tests/test_notebook_earnings_prep.py::test_the_import_graph_never_reaches_alphavantage_or_the_recap_generator`,
  `tests/test_member_interest_surfaces.py::test_each_gate_is_declared_dark_in_the_ledger`,
  `tests/test_notebook_switch_rehearsal.py` (NOTEBOOK_TERMINAL_LINKS_ENABLED only, the Terminal workstream's), the
  route / rate-limit / open-reads censuses (other workstreams' routes), and the vitest names inside the gate baseline.

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
   a day with reporters, `partial` false, `warm_skipped` recorded. Since final fix C, `candidates` and `timing_unknown`
   count the WHOLE day (the calendar board plus Finnhub's full list), not only the names a member holds: hundreds of
   candidates on a busy day is expected, and `timing_unknown` is read as a share of `candidates`, not as a small
   number. `delivered`, `already_sent` and `capped` are the ones that count member-matched names. This is the FIRST real test of
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
- **A rebuild can be thinner than the copy it replaces.** The job rebuilds a held earnings copy once when it was read
  before the reaction closed; if that rebuild comes back with the quarters but without a section the old copy had
  (the consensus tier, say), the thinner copy is kept until the next normal rebuild. Only copies that were already
  unmeasured are ever rebuilt.
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
- Done: the Opus whole-branch review ran on 2026-10-15 (0 Critical, 2 Important, 6 Minor); its fix wave C and the
  re-review's N1/N3 are in this branch.
- The offline layer's word-safety work found on the way is separate from this branch: the mid-text fork hotfix is
  merged and live (#342, smoke PASS 2026-10-16); the crash-draft Restore-then-Undo loss (pre-existing on master) is
  being fixed on `hotfix/notebook-restore-undo-loss`; an ordinary offline Undo that pins the record is queued next.
- The plan's owner decisions, decided by the controller under the owner's standing delegation ("You decide it all",
  2026-10-15): O-T2B-1, arming, is this packet; O-T2B-2, the kind, style, `reminder` block and `/remind` live on merge,
  as built; O-T2B-3, a withheld reaction strip (fewer than 4 quarters) gives a labelled dash, not a second vendor read;
  O-T2B-4, the prep-note window is "on or before the report date, in ET".
- Not carried, by ruling: `/plan`'s ticker shape still refuses digits (Part A's door); a lost create response shows the
  "may not have been saved" sentence rather than checking for the note.
