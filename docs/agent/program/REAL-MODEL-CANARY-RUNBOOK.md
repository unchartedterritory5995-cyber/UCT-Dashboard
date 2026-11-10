# REAL-MODEL production canary: runbook (PREPARED, NOT STARTED)

Run this only after: AUDIT GO on the cap (`d22bd7675d`, GO given 2026-11-10); the owner has written both C:/UCT files; and the
Lead pings. The cap proof is in `REAL-MODEL-CAP-PROOF.md`. Harness head: `a83670784b` (`agent/pl/autotest-2`). The public set hash at
that head is `6846cf3d6b04afb8eba2f8b1b7c846ff6a77ae4848b305a00f9fa87ffb6db8f5` and the held-out hash is
`8ac6a1ed4e8323aee42a2bbf9a5b54f071ca71a208dbdbf54d54389641ced48f`, the same values as in the authorization text.

**What runs:** stage `canary` = 12 public requests (`stageList('canary')`). The production request filter (`prodSafe`) leaves
**8** of them: `symbol-01`, `symbol-02`, `timeframe-01`, `timeframe-02`, `indicator-add-01`, `indicator-add-02`, `howto-01`
and `howto-02`. All 8 are single-turn and run on ONE disposable `AUTOTEST-<ms>` layout (board TWO).

**Hard money limits:**
- $0.25 is reserved per request before it is sent.
- The canary stage allows $0.50 in all, and the program allows $8. Both are checked atomically in the ledger.
- The ledger cap file is $8. The server caps each turn at $0.25 and 2 calls.
- Expected cost is about $0.02 per request, so about $0.16 for the run.

All commands run from `C:\w\pl-auto-cap\app` unless they start with `..\`. A Claude session runs them; the owner does the
steps marked OWNER.

## 0. Preconditions (Claude, free)

```
git -C C:\w\pl-auto-cap status --short          # empty
git -C C:\w\pl-auto-cap log -1 --format=%h      # a83670784b (or the head AUDIT names)
node src/testing/agent/autotest/run.mjs --lint  # lintErrors 0, publicHash and heldout.sha256 as above
```

Stop here if a hash differs from the authorization file. The guard would refuse anyway.

## 1. OWNER writes two files (by hand; never a Claude session)

`C:/UCT/agent-autotest-authorization.json` contains EXACTLY the JSON in REAL-MODEL-CAP-PROOF.md §1a. `C:/UCT/agent-eval-cap.json` contains:

```json
{"cap_usd": 8.0}
```

## 2. Status BEFORE (Claude, read-only)

```
python ..\tools\agent_autotest_cap_status.py > %RUN%\cap-before.json
```

Where `%RUN%` is a new folder, for example `C:\w\pl-auto-cap\autotest-out\canary-<date>`. Expected values:
- `cap_file_usd` 8.0
- `authorization` {max_usd 8, expires 2026-11-12, targets [production], stages [canary]}
- `stop_in_force` false
- `program_committed_usd` 0.0
- `ledger_state` absent, or present with 0

## 3. Guard check (Claude, free: no browser, no socket, no model)

```
node src/testing/agent/autotest/run.mjs --mode real-model --target production --stage canary --guard-check
```

Expected: `the authorization file holds (max $8, target production). Nothing was run.`
- Any `REFUSED: ...` → stop, fix the named cause, and do not edit the guard.
- This step creates the empty ledger file `C:/UCT/agent-eval-ledger.db` if it is absent.

## 4. The run (Claude starts it; the OWNER signs in)

```
node src/testing/agent/autotest/run.mjs --mode real-model --target production --stage canary --out %RUN%
```

1. The console prints `production target: 8 of 12 requests are safe to send; test layout AUTOTEST-<ms>`.
2. A NEW Chrome window opens on `https://www.uctintelligence.com/charts`. It has a temporary profile, so it is not the
   owner's browser and holds no saved cookie.
3. **OWNER:** sign in by hand in that window, with the admin smoke account, within **5 minutes**. Claude never sees the
   password. The console says `sign in to the isolated Chrome window by hand (5 minutes)`. If no admin sign-in is detected in
   5 minutes, the run throws and nothing is sent.
4. After sign-in, do not touch the window. The harness:
   - fingerprints the protected state (layouts, watchlists, alerts, drawings, templates, preferences),
   - saves the workspace preferences to `%RUN%\prod-restore-point.json`, reads the server budget (`budgetStart`), and
     creates the AUTOTEST layout,
   - then for each request: `gate reserve` ($0.25), send, read the budget, wait 10 s, read again, then `gate settle`
     (max of the two deltas, or the worst case).
5. Each request prints one line: `PASS|FAIL <id> $0.0xxx`, or `usd unknown, settled at the worst case`.
6. Duration: up to about 8 × (≤60 s turn + 10 s settle) ≈ 10 min, usually 2–4 min.
7. At the end (in `finally`, even after a crash or stop), the harness:
   - writes the preferences back and deletes the AUTOTEST layout,
   - re-fingerprints, then prints `restore: <..>; protected state changed: none`.
   - Any difference writes a STOP and lists the differing kinds, never their contents.
8. The window closes. The **OWNER** may sign that session out on the account page afterwards (optional).

## 5. Status AFTER and the report (Claude, read-only)

```
python ..\tools\agent_autotest_cap_status.py > %RUN%\cap-after.json
node src/testing/agent/autotest/prodReport.mjs %RUN% %RUN%\cap-before.json %RUN%\cap-after.json
```

The report is value-free: ids, families, check names, role names, booleans and Agent-budget dollars.
- Totals: requests, passed and failed. Wrong target: **APPLIED / PROPOSED / OFFERED / over-ask** counts (role names only).
  Restored, protected state changed, and write violation.
- **Spend side by side:**
  - the eval-ledger program delta (after − before),
  - the production server's own `/api/agent/budget` delta (run end − run start),
  - the sum of the per-request settles.
  - The ledger value should be ≥ the server delta: worst-case settles over-count, never under-count. If the ledger is lower,
    report it as a defect.
- Per row: pass, failure layer and first check (plan correctness), wrong-target kind, rendering (repaint / prewarm /
  console / guide tags, or ok), and the settled $.
- **Not reported, by design:** reply text, card text, panel text, axis text, widget faces and screenshots (production shows
  real values).

## 6. STOP behaviour

**Sticky STOP:** these write `C:/UCT/agent-autotest-STOP.json` and end the run before the next request.
- a request settled over $0.10. That includes any worst-case settle ($0.25), so a crash, a turn timeout or an unreadable
  budget STOPs the run, by design. The console prints `STOP: refused: a production turn cost ...`.
- a write outside the allow list. The CDP write guard fails the request at the network and the run breaks with
  `STOP: a write outside the allow list`.
- a protected-state fingerprint difference after restore.

**Run ends, no STOP file:** the ledger refuses a reservation. The causes are the cap, the stage's $0.50, the program's $8,
an expired authorization, or a STOP already in force. The console prints `STOP: the ledger refused: ...`, and the next run
is refused for the same reason.

While the STOP file exists, every `check`, `reserve` and `serve` refuses. **Only the OWNER deletes it**, after reading
its reason (its text is content-free).
- A crash between reserve and settle leaves one open reservation that counts at $0.25. Only the owner releases it:
  `python ..\tools\agent_eval_ledger.py release <id> --confirm "<why>"`.
- A crash before restore leaves `%RUN%\prod-restore-point.json` (the workspace prefs) on this machine for a manual restore.
  The AUTOTEST layout can be deleted by name.

## 7. Closing

Report the step-5 output to the Lead. The OWNER may delete `C:/UCT/agent-autotest-authorization.json` to close the
gate. It also expires by itself after 2026-11-12.
