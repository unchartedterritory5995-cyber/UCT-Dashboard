# Runbook — `cutover_watch`: the GO / NO-GO gate for the `ALERT_EVAL_MODE` flip

**What it is.** `tools/cutover_watch.py` is a **read-only** instrument that answers, in
one call, whether the closed-bar cutover is safe to take *right now*. It exits **0 on
GO** and **1 on NO-GO**, so it can gate a script. Run it **repeatedly through the
session** in which you intend to flip — the point is to catch a problem while the
market is open and you can still fix it, not to discover one afterwards.

It **changes nothing**. Both stores are opened with `file:…?mode=ro` URIs plus
`PRAGMA query_only=1`; it calls no writer, no `record_*`, no delivery hook. The only
side effect is the same bars read the evaluator already does once a minute.

---

## 1. The command

On the pod, after this branch has merged and deployed:

```sh
railway ssh --service web "cd /app; PYTHONDONTWRITEBYTECODE=1 /opt/venv/bin/python tools/cutover_watch.py > /tmp/cw.txt 2>&1; echo BARE_EXIT=\$?; cat /tmp/cw.txt"
```

Add `--json` for a machine-readable payload, `--self-test` to prove the gate can
still refuse (see §5).

**Three environment traps, all of which have fired for real here:**

| Trap | What to do |
|---|---|
| `railway ssh` mangles quoting under **Git Bash** | Run it from **PowerShell**, and use **single quotes** around the remote command so `$?` reaches the pod's shell instead of being expanded locally. |
| bare `python3` on the pod is the Nix system Python with **no app deps** | Always `/opt/venv/bin/python`. |
| an exit code has been lost through a pipe on this project | **Redirect to a file, then read `$?` bare.** Never `… \| tail`. |

Local / pre-merge use (the tool finds the repo root itself, and honours
`UCT_APP_ROOT`):

```sh
PYTHONDONTWRITEBYTECODE=1 python tools/cutover_watch.py --auth-db /path/auth.db --shadow-db /path/alert_shadow.db
```

### If the branch has NOT shipped yet

The pod only carries what is deployed. Until `feat/phase-c-alerts` reaches
`master` and redeploys, `/app/tools/cutover_watch.py` does not exist and you must
put the single file there yourself. gzip + base64 it in chunks (one `railway ssh`
argument cannot hold the whole payload), from **PowerShell**:

```powershell
Set-Location C:\Users\Patrick\uct-dashboard          # the railway-linked dir
$src = "C:\Users\Patrick\uct-worktrees\phase-b2-engine\tools\cutover_watch.py"
$bytes = [System.IO.File]::ReadAllBytes($src)
$ms = New-Object System.IO.MemoryStream
$gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Compress)
$gz.Write($bytes, 0, $bytes.Length); $gz.Close()
$b64 = [Convert]::ToBase64String($ms.ToArray())
railway ssh "rm -f /tmp/cw.b64 /tmp/cutover_watch.py" | Out-Null
for ($i = 0; $i -lt $b64.Length; $i += 6000) {
  $c = $b64.Substring($i, [Math]::Min(6000, $b64.Length - $i))
  railway ssh "printf %s $c >> /tmp/cw.b64" | Out-Null
}
railway ssh "base64 -d /tmp/cw.b64 | gunzip > /tmp/cutover_watch.py; sha256sum /tmp/cutover_watch.py"
```

**Compare that sha256 against `Get-FileHash -Algorithm SHA256 $src`** before you
trust a reading — a truncated upload would run and report a number.

Then run it with `cd /app` so it resolves `api/services` from the deployed tree:

```sh
railway ssh 'cd /app; PYTHONDONTWRITEBYTECODE=1 /opt/venv/bin/python /tmp/cutover_watch.py > /tmp/cw.txt 2>&1; echo BARE_EXIT=$?; cat /tmp/cw.txt'
```

⚠️ **`/tmp` does not survive a redeploy.** The pod restarted once mid-session
during this tool's own bring-up and the file vanished; re-upload if
`can't open file` comes back.

---

## 2. What each number means

### Header

* **`ALERT_EVAL_MODE` / `eval_mode()`** — the constant and its only reader. If they
  ever disagree, something has hard-coded the lane; that is Task 8's M4 tombstone
  class and it means the flip is not what it appears to be.
* **`deploy : N of M required accessor(s) present`** — the pod's code is checked
  against everything this tool calls, *before* anything is measured. A miss here is
  reported as `pod-code-too-old`, not as a crash. It fired on the first real run:
  production had no `indicator_alert_service.snooze_active`.

### 1 · Shadow lane — is it observing during **RTH**?

* **`rth rows`** — rows recorded inside **09:30–16:00 ET on a weekday**. **This is the
  only row count the verdict reads.** A soak of 8,130 rows once looked well-exercised
  and every one of them was recorded after 16:52 ET, so the lane had never seen a
  forming bar. `total`, `pre`, `post` and `weekend` are printed beside it so the
  mistake is not available to make.
* **`partition holds`** — `rth + pre + post + weekend == total`. If this is `False`
  the classifier has a hole and nothing under it is safe to read.
* **`rth distinct alerts … of N armed`** — how many *different* alerts the lane saw
  during regular hours. Expect **`armed − 1`**: `ichimoku.chikou` produces no closed
  value, therefore no row (§4).
* **`newest row age`** — seconds since the last row. The cron is a 60 s interval job;
  over 300 s (five cycles) means the lane has stopped and the counts are history.
* **half-day caveat** — the window is a fixed 09:30–16:00, so on a 13:00-close day
  the 13:00–16:00 rows would be counted as RTH. That is the *generous* direction (it
  can only make the RTH count too high) and the per-session-day table shows it.

### 2 · The two lanes on live tape, per address

* **`evaluated: forming N / closed N / BOTH N`** — the **denominator**. A row of
  zeros in the table below means "the lanes agree" only if `BOTH` is non-zero.
* **`groups with a FORMING (open) newest bar: N of M`** — **read this before the
  disagreement columns.** If the newest bar has already closed, `closed_bar_index`
  *is* the newest index, both lanes read the same element, and every
  gained/lost/shifted count is a structural zero. Outside RTH that is always the
  case. The verdict refuses it as `lanes-compared-off-a-closed-bar`.
* **per-address columns** — `n` armed, `fVal`/`cVal` how many produced a value on
  each lane, then `gained` (closed fires where forming did not), `lost` (forming
  fires where closed does not), `shifted` (both fire, different number) and `silent`
  (forming has a value, closed has none).
* **`undeclared: 0 of N observed group(s)`** — every live `(address, direction)` is
  checked against `tests/fixtures/alerts/fire_diff_declared.json` through the shipped
  `alert_shadow_log.declared_covers`. A live behaviour outside the 61 declared rows
  is a change nobody priced, and it refuses.

### 3 · What would change if you flipped right now

`would change` = `gained + lost + shifted + closed-silent`, over the armed total, with
every alert named. `identical` is the healthy majority.

**Closed-lane silence** is classified by *mechanism*, measured off the series:

| shape | meaning | remedy |
|---|---|---|
| `trailing_pad` | the newest N elements of the column are None **for good** | permanent — the alert can never fire closed-bar |
| `warmup_boundary` | the judged bar sits inside the indicator's warm-up while a *later* bar has a value | the bar window is too short for that indicator on that symbol |

`ichimoku.chikou` with `trailing_pad`, pad **26**, is the **owner-accepted casualty**
and prints as `OK … ACCOUNTED FOR`. It does **not** refuse. **Anything else does** —
including `ichimoku.chikou` itself if the shape or the pad ever changes, because the
acceptance is keyed on `(address, shape)` and not on the address.

### 4 · Is anything about to deliver?

* **`deliverable_now`** — armed rows **outside** their snooze window, derived from
  `indicator_alert_service.snooze_active(row)`, i.e. **`snooze_until` vs the clock**.
  It is *never* derived from the `state` column. That proxy is why `--verify` once
  reported 0 right up to the cycle that would have sent the emails:
  `mark_needs_attention` rewrites `state` unconditionally every 300 s, and all 31 soak
  rows share one `(SPY, "5")` bar group, so one failed bars fetch rewrote all of them.
* **`muzzled by clock … by the state string … disagreeing`** — the two answers side by
  side. A non-zero `disagreeing` is the evidence that the state column is the wrong
  thing to read, printed rather than argued.
* **`muzzle expires`** — the soak rows are snoozed, and `SNOOZE_MAX_MINUTES` is a hard
  30-day ceiling. Rows armed 2026-08-06 lose their muzzle **2026-09-05, the launch
  date**; 27 of 31 would deliver on the first cycle past it. Inside 7 days this
  refuses. The fix is one command: `tools/alert_soak_matrix.py --arm` (idempotent) or
  `--disarm`.

---

## 3. GO looks like this

```
VERDICT: GO
  every check passed, and each one had a non-zero denominator:
    rth rows 4820 > 0 | armed 31 > 0 | evaluated on both lanes 30 > 0
    3 live disagreement group(s), all declared | 1 silent address(es), all accounted
exit 0
```

Read it as: the shadow lane observed during regular hours; there were armed alerts to
observe; both lanes actually produced values; a bar was forming so the comparison was
capable of showing a difference; every difference it did show is already declared and
priced; the only silent address is the accepted one; nothing can deliver.

## 4. NO-GO looks like this

Every reason is **collected**, not just the first, each with a distinct code:

| code | it means |
|---|---|
| `pod-code-too-old` | the pod is missing something the instrument calls; the reading would be a guess |
| `cannot-read-store` | a store is absent, or is not the shape its own module declares |
| `no-armed-alerts` | nothing to observe — every zero below is vacuous |
| `no-rth-shadow-rows` | the soak has never seen a forming bar during regular hours |
| `shadow-lane-stale` | the newest row is older than five cycles; the lane has stopped |
| `no-live-evaluation` | armed, but nothing produced a value on both lanes (dead bar fetch) |
| `lanes-compared-off-a-closed-bar` | no bar was forming, so the diff compared a thing with itself |
| `undeclared-disagreement` | a live behaviour outside `fire_diff_declared.json` |
| `unexpected-closed-lane-silence` | an address goes silent that nobody has accepted |
| `deliverable-now` | an armed alert is outside its snooze window and can mail the owner |
| `soak-muzzle-expiring` | the muzzle runs out within 7 days |

Real output, production, 2026-08-06 22:03 ET, `BARE_EXIT=1`:

```
VERDICT: NO-GO
  [pod-code-too-old]      this deployment has no indicator_alert_service.snooze_active …
  [no-rth-shadow-rows]    0 row(s) inside 09:30-16:00 ET … 9060 outside it …
  [lanes-compared-off-a-closed-bar]  the newest bar has already CLOSED in all 1 bar group(s) …
exit 1
```

All three are correct: the durable-snooze fix had not deployed, the soak had only ever
run after the close, and at 22:03 ET no bar was forming.

## 5. Proving the gate can still refuse

```sh
railway ssh --service web 'cd /app; PYTHONDONTWRITEBYTECODE=1 /opt/venv/bin/python tools/cutover_watch.py --self-test > /tmp/st.txt 2>&1; echo BARE_EXIT=$?; cat /tmp/st.txt'
```

It forces **every** code in `NOGO_REASONS` through the real `main()` against throwaway
databases, reads the real exit code each time, and then compares what it forced
against `NOGO_REASONS` — so a branch added without a case fails. Two **green
controls** run alongside, because eleven cases that all expect exit 1 would also be
passed by a tool that returns 1 unconditionally. `SELF-TEST PASSED` / exit 0 is the
only acceptable result.

---

## 6. Rollback

**The flip is one constant.** `api/services/indicator_alert_evaluator.py`, line 110:

```python
ALERT_EVAL_MODE = "forming"        # "forming" | "closed"
```

Reverting is that line back to `"forming"`, one commit, one push to `master`, one
Railway redeploy of the **web** service. Verify afterwards with the AST probe (a grep
has lied about this file before — `git grep -c admit_alert_fire` once counted two
comments):

```sh
python - <<'PY'
import ast, pathlib
t = ast.parse(pathlib.Path("api/services/indicator_alert_evaluator.py").read_text(encoding="utf-8"))
print([(n.lineno, ast.literal_eval(n.value)) for n in t.body
       if isinstance(n, ast.Assign)
       for x in n.targets if getattr(x, "id", None) == "ALERT_EVAL_MODE"])
PY
```

…and then re-run `cutover_watch` on the pod: the header must read
`ALERT_EVAL_MODE = 'forming'`.

### How long it takes

| step | time |
|---|---|
| edit + commit | ~1 min |
| push to `master` | seconds |
| Railway build (`pip install` + `npm install` + `npm run build`) and deploy | **~5–10 min** typical for this service |
| old container drain (`drainingSeconds: 30`) | ~30 s |
| **total, push → new behaviour live** | **budget 10 minutes** |

Railway keeps serving the **last successful** deploy throughout, so the site does not
go down; `/api/*` blips for roughly a minute at the swap. **No options-tape gap** — the
flow worker is a separate service and is not touched by a web deploy.

### ⚠️ Two things that will bite you mid-session

1. **There is no environment kill-switch.** `ALERT_EVAL_MODE` is a module constant, not
   an env var, so rollback is a code change plus a deploy. Nothing can be undone from
   the Railway dashboard. (Making it env-driven is a production change and is
   deliberately not part of this read-only tool — see the report.)
2. **The pre-push hook blocks pushes 09:15–16:20 ET.** That is the window in which you
   would want to roll back. Decide *before* flipping which of these you are taking:
   * flip late in the session so a rollback lands after 16:20 ET; **or**
   * pre-authorise `UCT_PUSH_OVERRIDE` for the rollback push only (the ledger records
     one prior misuse of it costing eight tape gaps — this is not that: the flow
     worker is now a separate service and a web deploy costs a ~1-minute `/api/*`
     blip, not a tape gap); **or**
   * accept that the rollback waits until 16:20 ET.

   There is **no** no-deploy mitigation that restores forming-bar behaviour for real
   members. `tools/alert_soak_matrix.py --disarm` only removes the 31 soak rows.

---

## 7. Suggested cadence for cutover day

| when | what |
|---|---|
| ~09:35 ET | first run. Expect `no-rth-shadow-rows` to have cleared within a few minutes of the open; if it has not, the shadow cron is not running. |
| ~10:00 ET | first meaningful read — a bar is forming, so the per-address diff is real. **This is the reading the flip decision rests on.** |
| every ~30 min | re-run. Watch `undeclared`, `unexpected` silence, and `deliverable_now`. |
| immediately after the flip | re-run. Header must show `ALERT_EVAL_MODE = 'closed'`, and the diff should now read the *same* two lanes (the tool passes `mode=` explicitly, so it does not start comparing closed against closed). |
| ~15:50 ET | last read of the session. |
