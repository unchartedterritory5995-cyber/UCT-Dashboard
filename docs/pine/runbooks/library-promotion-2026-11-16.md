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
  - `api/services/pine_library_store.py::store_root()` is the one authority over the path. Every
    command below asks it, so nobody types the path.
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

## 0. Preconditions

1. The PR that added `tools/pine_library/promotion_check.py` is merged to master and deployed on
   `web`. From PowerShell, in the Railway-linked folder:

   ```powershell
   Set-Location C:\Users\Patrick\uct-dashboard
   railway ssh --service web "ls -l /app/tools/pine_library/promotion_check.py /app/tools/pine_library/promotion_allowlist.json"
   ```

   Both files must be listed. If `promotion_check.py` is missing, `web` has not deployed the merge
   yet: stop here.

2. Open a shell on `web`. Every command in steps 1 to 6 is typed **in that shell, on the pod**:

   ```powershell
   railway ssh --service web
   ```

   then on the pod:

   ```sh
   cd /app
   ```

## 1. Read what the production store holds today (read-only)

```sh
/opt/venv/bin/python tools/pine_library/promotion_check.py check
```

- **The first line is `store: <path>`.** Note the path. `(does not exist)` after it means
  production has never held a library.
- **Expected: `MISSING` for each promoted version, then `PROMOTION CHECK: FAIL`.** Nothing has been
  promoted yet, so this is the normal answer.
- **A `PROMOTED` line** means that version is already there under the graded sha256. The install
  keeps it.
- **A `WRONG-SHA` line** means production holds that version under different code. Stop and report
  it to the coordinator.
- **`OTHER` lines are versions the store holds that are not promoted.** Each is labelled `held out`,
  `never promoted` or `not on the allowlist`, with the status the store gives it (`ok` means it is
  served today). **Report every `OTHER` line to the coordinator.**
  - Do not remove anything. Removing a version is a separate owner decision and never part of this
    runbook.
  - Phase B never widens the reach of such a version: a v5 library is linked into a v6 script only
    for a version on the engine's admission table, and that table is held to the allowlist.

## 2. Back up the store

```sh
STORE=$(/opt/venv/bin/python -c 'from api.services import pine_library_store as s; print(s.store_root())')
echo "$STORE"
mkdir -p /data/backups
if [ -d "$STORE" ]; then tar -czf /data/backups/pine_libraries-2026-11-16-pre-promotion.tgz -C "$(dirname "$STORE")" "$(basename "$STORE")"; ls -l /data/backups/pine_libraries-2026-11-16-pre-promotion.tgz; sha256sum /data/backups/pine_libraries-2026-11-16-pre-promotion.tgz; else echo "NO STORE YET: nothing to back up"; fi
```

Write down the sha256 it prints, or the `NO STORE YET` line. ⚠️ `/data/backups/` is on the same
volume as the store. It covers a mistake made by this runbook. It does not cover losing the volume.

## 3. Fetch the promoted versions into a staging folder

```sh
PINE_LIBRARY_DIR=/tmp/pine_libraries_staging /opt/venv/bin/python tools/pine_library/fetch_library.py $(/opt/venv/bin/python tools/pine_library/promotion_check.py paths)
```

- It prints `store: /tmp/pine_libraries_staging`, then one `ok <path>` per version.
- It uses TradingView's public, unauthenticated endpoints only. It writes only into
  `/tmp/pine_libraries_staging`, never into the store.
- **A `FAIL ... urlopen` or a timeout** means the pod cannot reach TradingView. Use **Appendix A**
  instead of this step, then continue at step 4.

## 4. Check the staging folder against the allowlist (the sha check)

```sh
/opt/venv/bin/python tools/pine_library/promotion_check.py check --store /tmp/pine_libraries_staging --exact
```

The last line must be **`PROMOTION CHECK: PASS`**, with one `PROMOTED <path> <sha256>` line per
version. The check uses the store's own rule (`entry_status`: sha256, licence, deny list), then the
allowlist's sha256 for each version, then that every library a promoted version imports is promoted
too.

- **`WRONG-SHA`** means TradingView now serves different code under that version than the code that
  was graded. **Stop.** Report it. Do not install.
- **Any other `PROBLEM`:** stop and report it.

## 5. Install

First the plan (writes nothing):

```sh
/opt/venv/bin/python tools/pine_library/promotion_check.py install --from /tmp/pine_libraries_staging
```

It prints `COPY` or `KEEP` per version and `PROMOTION INSTALL: PASS`. Then:

```sh
/opt/venv/bin/python tools/pine_library/promotion_check.py install --from /tmp/pine_libraries_staging --apply
```

- It prints `WROTE <path> -> <file>` per copied version, then `PROMOTION INSTALL: PASS`.
- The copy goes through the store's own `write_entry`: it validates the entry and writes it
  atomically (temp file, then rename).
- It refuses, writing nothing, if the staging folder fails step 4, or if the store already holds a
  version under another sha256.

## 6. Verify

On the pod:

```sh
/opt/venv/bin/python tools/pine_library/promotion_check.py check
```

The last line must be **`PROMOTION CHECK: PASS`**, with a `PROMOTED` line per version. Any `OTHER`
lines must be exactly the ones step 1 listed.

Then **through the read door**, in your own browser, signed in as yourself:

- ⛔ Check first that the browser is signed in as you. `https://uctintelligence.com/api/auth/me`
  must not show an `@uctintelligence.internal` address (see CLAUDE.md, "THE OWNER'S OWN CHROME IS
  NEVER A SMOKE-ACCOUNT BROWSER").
- Open `https://uctintelligence.com/api/pine/libraries`. Each promoted path must be listed, with a
  `sha256` equal to the allowlist's.
- Open one version, for example
  `https://uctintelligence.com/api/pine/libraries/theEccentricTrader/PubLibSwing/3`. It must answer
  200 with `"sha256": "3cbd09d934016a46d43c8097857bc3fae7af23111e22a414f671db740fc8551f"`. The page
  also shows the library's published source: public MPL-2.0 code, no member data.
- Control, the deny list still holds:
  `https://uctintelligence.com/api/pine/libraries/TradingView/ValueAtTime/2` must answer **409**
  with `"code": "library:denied"`, whatever the store holds.

Close the pod shell (`exit`). Report the step 1 and step 6 outputs to the coordinator.

## 7. Rollback (only if needed)

On the pod (`railway ssh --service web`, then `cd /app`):

```sh
STORE=$(/opt/venv/bin/python -c 'from api.services import pine_library_store as s; print(s.store_root())')
mv "$STORE" "$STORE.rolled-back-$(date -u +%Y%m%dT%H%M%SZ)"
if [ -f /data/backups/pine_libraries-2026-11-16-pre-promotion.tgz ]; then tar -xzf /data/backups/pine_libraries-2026-11-16-pre-promotion.tgz -C "$(dirname "$STORE")"; fi
/opt/venv/bin/python tools/pine_library/promotion_check.py check
```

- The store moves aside. It is never deleted.
- The backup comes back, or no store at all if step 2 said `NO STORE YET`.
- The check prints what the store holds now.

The effect is immediate, with no restart:
- A member's script saved against a promoted version is refused by name again (the import line,
  `pine:module` / `runtime:library`). It is never drawn wrong.
- An open browser tab keeps the code it already loaded until the page is reloaded.

## Appendix A: fetch on the PC when the pod cannot reach TradingView

In PowerShell, in a checkout at the merged master:

```powershell
$stage = "$env:TEMP\pine_libraries_staging"
$env:PINE_LIBRARY_DIR = $stage
python tools/pine_library/fetch_library.py (python tools/pine_library/promotion_check.py paths).Split(' ')
python tools/pine_library/promotion_check.py check --store $stage --exact
Remove-Item Env:PINE_LIBRARY_DIR
tar -czf "$env:TEMP\pine_stage.tgz" -C "$env:TEMP" pine_libraries_staging
(Get-FileHash -Algorithm SHA256 "$env:TEMP\pine_stage.tgz").Hash.ToLower()
```

The check must end `PROMOTION CHECK: PASS`. Note the sha256 of `pine_stage.tgz`. Then send the
tarball to the pod in chunks (one `railway ssh` argument cannot hold it all), from the
Railway-linked folder:

```powershell
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:TEMP\pine_stage.tgz"))
Set-Location C:\Users\Patrick\uct-dashboard
railway ssh --service web "rm -f /tmp/pine_stage.b64 /tmp/pine_stage.tgz" | Out-Null
for ($i = 0; $i -lt $b64.Length; $i += 6000) {
  $c = $b64.Substring($i, [Math]::Min(6000, $b64.Length - $i))
  railway ssh --service web "printf %s $c >> /tmp/pine_stage.b64" | Out-Null
}
railway ssh --service web "base64 -d /tmp/pine_stage.b64 > /tmp/pine_stage.tgz; sha256sum /tmp/pine_stage.tgz; rm -rf /tmp/pine_libraries_staging; tar -xzf /tmp/pine_stage.tgz -C /tmp; ls /tmp/pine_libraries_staging"
```

- The sha256 the pod prints must equal the PC's. A truncated upload would still unpack, which is why
  the hashes are compared.
- Then continue at step 4, on the pod. `/tmp` does not survive a redeploy: if `web` restarted in
  between, upload again.
