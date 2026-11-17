# Runbook: promote the allowlisted Pine libraries into the production store (owner-run, 2026-11-16)

**What this does.** It copies the library versions listed under `promote` in
`tools/pine_library/promotion_allowlist.json` into the production library store, each one under
the exact sha256 that was graded. It changes nothing else.

**Who runs it.** The owner. No agent has production access and none runs this.

**What it never does.**
- It never deletes a file.
- It never overwrites a version the store already holds under another sha256. The tool refuses.
- It never prints member data: every command prints library paths, sha256s and statuses only.
- It never restarts a service. The store is read on every request, so no restart is needed.

Approved by the owner on 2026-11-16, in the coordinator's session. The rules are U15's
(`docs/pine/evidence/2026-11-15-u15-library-pinning/EVIDENCE.md`). A version is promoted only when
every capture of every newly attaching importing script grades MATCH with the runtime pane off, and a
non-commercial licence is never promoted. The re-grade behind today's list is
`docs/pine/evidence/2026-11-16-u15b-libraries/EVIDENCE.md`.

## Where the store is

- **Railway service `web`, its volume.** The path is `$PINE_LIBRARY_DIR` when set, else
  `$DATA_DIR/pine_libraries`, so `/data/pine_libraries` by default.
  - Each version is one file, `<root>/<Author>/<Library>/<N>.json`.
  - `api/services/pine_library_store.py::store_root()` is the one authority over the path.
    `promotion_check.py` asks it, and step 1 prints it. Steps 2 and 7 name `/data/pine_libraries`,
    so step 1 tells you to stop if the store is anywhere else.
- **No other service holds a store.**
  - The Pine runtime service gets each run's pinned libraries from `web` with the request.
  - Alerts, scans and backtests read the saved trees, which already hold the library code (the U15
    splice check).
- **The read door is `GET /api/pine/libraries/<Author>/<Library>/<N>`** and the list is
  `GET /api/pine/libraries`. Both need a signed-in session.

## The versions this runbook promotes

These are the `promote` rows of the allowlist as merged, with their grades cited there:

| version | sha256 (first 12) | why |
|---|---|---|
| theEccentricTrader/PubLibSwing/3 | 3cbd09d93401 | All Chart Patterns, MATCH host-only on RDDT 1D and SPY 1D |
| theEccentricTrader/PubLibPattern/4 | 9a75c2736c39 | the same script |
| theEccentricTrader/PubLibCandleTrend/2 | 1d42daae0734 | imported by PubLibSwing/3 |
| theEccentricTrader/PubLibTrend/3 | 7f31c58b74ea | imported by PubLibPattern/4 |
| TradingView/ta/11 | da37dca4bc18 | Chandelier exit, Pring's special K, Ulcer index, Aroon oscillator: MATCH host-only, engine 61 (re-graded 2026-11-16) |
| TradingView/RelativeValue/3 | 44d71612a759 | imported by ta/11 |

The tool reads the list from the allowlist file. These names are here so you can recognise the output.

## How to type the commands

**Where.** In Claude Code, opened in `C:\Users\Patrick\uct-dashboard` (the Railway-linked folder).
Paste each command exactly as written, one at a time, including its leading `!`. The `!` runs it in
this PC's shell (Git Bash).

**What each command is.**
`MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; ...; echo EXIT=$?'`, the shape that
was measured to work (`lesson_railway_ssh_python_probe_recipe`, 2026-08-24 and 09-13):
- ONE `sh -c '...'` string, whose script starts with `cd /app`. A `railway ssh` call does not start in
  `/app`.
- The venv Python by absolute path, `PYTHONPATH=/app timeout N /opt/venv/bin/python ...`. Bare
  `python3` on the pod is the Nix system Python, with no app dependencies.
- An inner `timeout N`. Both it and the `cd /app` are load-bearing.
- No single quote and no `*` inside the script, and semicolons only.
- `MSYS_NO_PATHCONV=1` stops Git Bash from rewriting `/app/...` and `/data/...` into Windows paths.
- Every command ends `echo EXIT=$?`, so it always prints its exit status.

⛔ **An EMPTY output means the command did not run. Stop.** `railway ssh` can drop arguments and
print nothing, which reads like success. Every command here prints at least an `EXIT=` line.

**What the commands print.** Library paths, sha256s, statuses, the names and sizes of the files this
runbook writes, and `EXIT=` lines. Nothing reads a database, a member's file or an environment
variable. `/tmp` on the pod persists between commands until `web` restarts.

## 0. Preconditions

1. #1463 is merged to master and `web` has deployed it. This command must list both files and print
   `EXIT=0`:

   ```
   ! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; ls -l tools/pine_library/promotion_check.py tools/pine_library/promotion_allowlist.json; echo EXIT=$?'
   ```

   If `promotion_check.py` is missing (`No such file`), `web` has not deployed the merge yet: stop
   here.

## 1. Read what the production store holds today (read-only)

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; PYTHONPATH=/app timeout 150 /opt/venv/bin/python tools/pine_library/promotion_check.py check; echo EXIT=$?'
```

- **The first line is `store: <path>`.**
  - `store: /data/pine_libraries`: the store exists; back it up at step 2.
  - `store: /data/pine_libraries (does not exist)`: production has never held a library. Skip the
    backup at step 2.
  - Any other path: `PINE_LIBRARY_DIR` is set on `web`. **Stop and report it.** Steps 2 and 7 below
    name `/data/pine_libraries`.
- **Expected: `MISSING` for each of the six versions, then `PROMOTION CHECK: FAIL` and `EXIT=1`.**
  Nothing has been promoted yet, so this is the normal answer.
- **A `PROMOTED` line** means that version is already there under the graded sha256. The install
  keeps it.
- **A `WRONG-SHA` line** means production holds that version under different code. **Stop and report
  it.**
- **`OTHER` lines are versions the store holds that are not promoted.** Each is labelled `held out`,
  `never promoted` or `not on the allowlist`, with the status the store gives it (`ok` means it is
  served today). **Report every `OTHER` line to the coordinator.**
  - Do not remove anything. Removing a version is a separate owner decision and never part of this
    runbook.
  - Phase B never widens their reach: a v5 library is linked into a v6 script only for a version on
    the engine's admission table, and that table is held to the allowlist.

## 2. Back up the store (skip if step 1 said `does not exist`)

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; mkdir -p /data/backups; echo EXIT=$?'
```

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; timeout 150 tar -czf /data/backups/pine_libraries-2026-11-16-pre-promotion.tgz -C /data pine_libraries; echo EXIT=$?'
```

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; ls -l /data/backups/pine_libraries-2026-11-16-pre-promotion.tgz; sha256sum /data/backups/pine_libraries-2026-11-16-pre-promotion.tgz; echo EXIT=$?'
```

Each must print `EXIT=0`. Write down the sha256 the third one prints. ⚠️ `/data/backups/` is on the same
volume as the store. It covers a mistake made by this runbook, not the loss of the volume.

## 3. Fetch the six versions into a staging folder

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; PINE_LIBRARY_DIR=/tmp/pine_libraries_staging PYTHONPATH=/app timeout 300 /opt/venv/bin/python tools/pine_library/fetch_library.py theEccentricTrader/PubLibSwing/3 theEccentricTrader/PubLibPattern/4 theEccentricTrader/PubLibCandleTrend/2 theEccentricTrader/PubLibTrend/3 TradingView/ta/11 TradingView/RelativeValue/3; echo EXIT=$?'
```

- It prints `store: /tmp/pine_libraries_staging`, then one `ok <path> MPL-2.0 (header) -> <file>` per
  version, then `EXIT=0`. `EXIT=124` means it timed out.
- It reads TradingView's public, unauthenticated endpoints only. It writes only into
  `/tmp/pine_libraries_staging`, never into the store.
- **A `FAIL ...` line** (a network error, a timeout): the pod could not reach TradingView. Nothing
  has been written to the store. **Stop and report it**; see Appendix A.

## 4. Check the staging folder against the allowlist (the sha check)

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; PYTHONPATH=/app timeout 150 /opt/venv/bin/python tools/pine_library/promotion_check.py check --store /tmp/pine_libraries_staging --exact; echo EXIT=$?'
```

The last lines must be **`PROMOTION CHECK: PASS`** and `EXIT=0`, with one `PROMOTED <path> <sha256>` line per
version. The check uses the store's own rule (`entry_status`: sha256, licence, deny list), then the
allowlist's sha256 for each version, then that every library a promoted version imports is promoted
too.

- **`WRONG-SHA`** means TradingView now serves different code under that version than the code that
  was graded. **Stop.** Report it. Do not install.
- **Any other `PROBLEM` line:** stop and report it.

## 5. Install

First the plan. It writes nothing, and must end `PROMOTION INSTALL: PASS` with a `COPY` (or `KEEP`)
line per version:

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; PYTHONPATH=/app timeout 150 /opt/venv/bin/python tools/pine_library/promotion_check.py install --from /tmp/pine_libraries_staging; echo EXIT=$?'
```

Then the write:

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; PYTHONPATH=/app timeout 150 /opt/venv/bin/python tools/pine_library/promotion_check.py install --from /tmp/pine_libraries_staging --apply; echo EXIT=$?'
```

- It prints `WROTE <path> -> <file>` per copied version, then `PROMOTION INSTALL: PASS`.
- The copy goes through the store's own `write_entry`: it validates the entry and writes it
  atomically (temp file, then rename).
- It refuses, writing nothing, if the staging folder fails step 4, or if the store already holds a
  version under another sha256.
- It writes to the store `web` serves. No restart is needed.

## 6. Verify

On the pod:

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; PYTHONPATH=/app timeout 150 /opt/venv/bin/python tools/pine_library/promotion_check.py check; echo EXIT=$?'
```

The last lines must be **`PROMOTION CHECK: PASS`** and `EXIT=0`, with a `PROMOTED` line per version. Any `OTHER`
lines must be exactly the ones step 1 listed.

Then **through the read door**, in your own browser, signed in as yourself:

- ⛔ Check first that the browser is signed in as you. `https://uctintelligence.com/api/auth/me`
  must not show an `@uctintelligence.internal` address (see CLAUDE.md, "THE OWNER'S OWN CHROME IS
  NEVER A SMOKE-ACCOUNT BROWSER").
- Open `https://uctintelligence.com/api/pine/libraries`. All six paths must be listed, each with a
  `sha256` equal to the allowlist's.
- Open `https://uctintelligence.com/api/pine/libraries/TradingView/ta/11`. It must answer 200 with
  `"sha256": "da37dca4bc18ce3b825d1d9c8b682f97859508cc5bb8bd3e51e1a28713edee80"`. The page also shows
  the library's published source: public MPL-2.0 code, no member data.
- Control, the deny list still holds: `https://uctintelligence.com/api/pine/libraries/TradingView/ValueAtTime/2`
  must answer **409** with `"code": "library:denied"`, whatever the store holds.

Report the outputs of steps 1 and 6 to the coordinator.

## 7. Rollback (only if needed)

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; mv /data/pine_libraries /data/pine_libraries.rolled-back-2026-11-16; echo EXIT=$?'
```

Only if step 2 made a backup:

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; timeout 150 tar -xzf /data/backups/pine_libraries-2026-11-16-pre-promotion.tgz -C /data; echo EXIT=$?'
```

Then read back what the store holds now:

```
! MSYS_NO_PATHCONV=1 railway ssh --service web -- sh -c 'cd /app; PYTHONPATH=/app timeout 150 /opt/venv/bin/python tools/pine_library/promotion_check.py check; echo EXIT=$?'
```

- The store moves aside. It is never deleted.
- The backup comes back, or no store at all if step 1 said `does not exist`.

The effect is immediate, with no restart:
- A member's script saved against a promoted version is refused by name again (the import line,
  `pine:module` / `runtime:library`). It is never drawn wrong.
- An open browser tab keeps the code it already loaded until the page is reloaded.

## Appendix A: when the pod cannot reach TradingView

If step 3 prints `FAIL` lines for network reasons, stop. Nothing has been written to the store.
- Moving a staging folder from this PC to the pod needs a file-transfer command this runbook does
  not carry.
- The previous draft's chunked base64 upload needed a shell on the pod, so it is not copy-pasteable
  in the `!` form above.

Report it, and a one-program upload step will be added to `promotion_check.py`.
