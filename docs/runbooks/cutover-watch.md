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

* **`ALERT_EVAL_MODE` / `eval_mode()`** — the committed constant and its only reader.
* **`lever :`** — the line under it, and the reason the two above can now legitimately
  differ. `ALERT_EVAL_MODE` is also an **environment variable** (§6), and when it is
  set it sits *above* the constant. The line reads one of four ways:
  * `… unset — EFFECTIVE LANE 'forming' is the committed constant` — the normal state.
  * `… APPLIED — EFFECTIVE LANE 'x', overriding the constant 'y'` — an override is in
    play. **NO-GO**, deliberately: flipping the constant while a variable pins the lane
    changes nothing a member can see.
  * `… REFUSED (names no lane)` — the variable is a typo. **NO-GO**, and note the
    wording: *a rollback set this way has not taken.*
  * `UNAVAILABLE on this pod` — deployed code older than the lever.
* **the constant ≠ the effective lane with NO override to explain it** — that is
  Task 8's M4 tombstone class (something has hard-coded the lane) and it refuses as
  `eval-mode-lever-misconfigured` with the word `HARD-CODED` in the message.
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
  `--disarm`. ⚰️ **This whole runbook predates the cutover it was gating** — `ALERT_EVAL_MODE`
  was flipped to `"closed"` on 2026-08-07 (`docs/decisions/2026-08-06-closed-bar-alert-cutover.md`),
  so the GO/NO-GO decision this doc walks through has already been made and executed.
  Anyone re-arming soak rows in the future should pick a fresh muzzle-expiry date rather
  than trust the 2026-09-05 anchor above.
  ⚠️ **READ `--arm`'s EXIT CODE.** It used to print its own `verify()` and
  `return 0` regardless, so a half-finished arm exited SUCCESS with the JSON of
  its own failure on stdout. It now exits **1** when its own verify refuses, on
  the same predicate `--verify` uses. And `--verify` on an EMPTY store is now
  exit 1 as well — every refusal was written `if armed and …`, so zero armed
  rows short-circuited all four and the tool reported success on the exact
  condition it exists to detect (after a `--disarm`, a wrong `AUTH_DB_PATH`, the
  wrong service, or a rebuilt volume). Measured 2026-08-07: pre-fix `--verify`
  against a schema-only auth.db exited 0; post-fix it exits 1.

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
| `eval-mode-lever-misconfigured` | the `ALERT_EVAL_MODE` **variable** is refused (a typo), or is applied and pinning the lane above the constant, or the constant and the effective lane disagree with nothing to explain it |

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
controls** run alongside, because twelve cases that all expect exit 1 would also be
passed by a tool that returns 1 unconditionally. `SELF-TEST PASSED` / exit 0 is the
only acceptable result.

The run **prints one `[alert-eval] REFUSED ALERT_EVAL_MODE='closd' …` line to stderr**
— that is the lever case forcing a real refusal through the real evaluator, not a
fault. The self-test also **clears `ALERT_EVAL_MODE` for every case** (restoring it
afterwards only if it still owns the slot), so a variable exported in your shell
cannot turn the two green controls red.

---

## 6. Rollback

**There are two rollbacks and you almost always want the first one.**

| | how | needs a push? | works 09:15–16:20 ET? |
|---|---|---|---|
| **A — the lever** | a Railway **variable** | no | **yes** |
| **B — the constant** | edit + commit + push + build | yes | yes since the freeze lifted 2026-08-24 — but it is a ~10-min build |

### A. The lever — one variable, no deploy of yours

`ALERT_EVAL_MODE` is a committed constant **and** an environment variable, and the
variable wins. `eval_mode()` is still the only reader of either.

```sh
# From the Railway-linked directory (C:\Users\Patrick\uct-dashboard):
railway variables --service web --set "ALERT_EVAL_MODE=forming"
```

…or, identically, **Railway dashboard → web → Variables → New Variable**
`ALERT_EVAL_MODE` = `forming`. That is the whole rollback. Nothing is committed,
nothing is pushed, and no build is involved.

⚠️ **Confirm a deployment actually started.** `railway variables --set` has been
observed *both* auto-redeploying and merely staging on this project, at different CLI
versions. Look at the service's Deployments list; if no new deployment appeared within
about a minute, force it:

```sh
railway redeploy --service web --yes
```

⚠️ **An unrecognised value is REFUSED, not guessed.** `ALERT_EVAL_MODE=closd` names no
lane, so the committed default keeps running, the pod logs
`[alert-eval] REFUSED ALERT_EVAL_MODE='closd' … IF THIS WAS A ROLLBACK, IT HAS NOT
TAKEN`, and the readback below says `override_refused: true`. **A rollback typed wrong
does not silently half-happen — but it also does not happen, so read it back.** Only
`forming` and `closed` are lanes (case and surrounding whitespace are forgiven; an
*empty* value means "no override", which is how you stand the lever back down).

#### How long it takes, end to end

| step | time |
|---|---|
| set the variable (CLI or dashboard) | ~10 s |
| Railway redeploy of `web` (build layers are already cached; this is a restart of the same code with new env, not a fresh `npm run build` of your changes) | **~2–5 min**, budget 5 |
| old container drain (`drainingSeconds: 30`) | ~30 s |
| next evaluator cycle picks up the new lane | ≤ 60 s (`_CYCLE_SECONDS`) |
| **total, variable set → next evaluation runs the other lane** | **budget 6 minutes** |

Railway keeps serving the last successful deploy throughout, so the site does not go
down; `/api/*` blips for roughly a minute at the swap. **No options-tape gap** — the
flow worker is a separate service and is not touched by a web deploy.

The value is compared to the environment **on every call**, never cached at import, so
no extra restart is needed beyond the one Railway performs for the variable change.

#### How to confirm it took effect ON THE POD

**Do not infer it from an alert that did or did not arrive.** Three readbacks, cheapest
first:

1. **From a signed-in browser** (no `railway ssh`, works from a phone):
   `https://uctintelligence.com/api/indicator-alerts/latency`

   ```json
   { "mode": "forming",
     "eval_mode": { "effective": "forming", "env_var": "ALERT_EVAL_MODE",
                    "env_value": "forming", "override_present": true,
                    "override_applied": true, "override_refused": false,
                    "refusals": 0 } }
   ```

   `mode` and `eval_mode.effective` are the **same resolution**, not two calls — the
   endpoint cannot report one lane while the evaluator runs another. `override_applied:
   true` is the proof the variable reached *this pod*; `override_refused: true` is the
   proof it did not.

2. **`cutover_watch` header** — the `lever :` line names the effective lane and why
   (§2). After a rollback it reads `… APPLIED — EFFECTIVE LANE 'forming', overriding
   the constant 'closed'`, and the verdict is a deliberate **NO-GO**
   (`eval-mode-lever-misconfigured`): you should not be re-taking the cutover while a
   rollback is pinned.

3. **On the pod, from PowerShell** (`railway ssh` mangles this under Git Bash):

   ```sh
   railway ssh --service web 'cd /app; PYTHONDONTWRITEBYTECODE=1 /opt/venv/bin/python -c "from api.services import indicator_alert_evaluator as e; print(e.eval_mode_report())" > /tmp/m.txt 2>&1; echo BARE_EXIT=$?; cat /tmp/m.txt'
   ```

#### What the rollback does NOT undo

It changes **which lane the next evaluation runs**. It is not a time machine, and
nothing below is reversed by it:

* **Fires already recorded.** Rows in `indicator_alert_fires` written while the closed
  lane ran stay exactly as they are, including their `bar_time`.
* **Anything already delivered.** AlertBell entries, Resend emails and Discord posts
  are gone out the door. There is no recall.
* **Snooze / dedup state.** A fire that muzzled an alert muzzles it for its full window
  (`SNOOZE_MAX_MINUTES` caps at 30 days). Rolling back does not re-arm it; that is
  `tools/alert_soak_matrix.py --arm` or a per-row `snooze`.
* **`last_value`.** Every cycle writes it, on **either** lane — so after a rollback the
  forming lane's first cycle measures its crossing against a `prev` the *closed* lane
  produced. Expect one cycle of that, per alert, and do not read a single odd
  first-cycle result as evidence the rollback failed.
* **The signature-receipts ledger. ⚠️ THE DOOR IS WIRED — since 2026-08-08 this is
  no longer conditional.** Every delivered fire on a shipped definition accrues a
  row. `admit_alert_fire` refuses unless the lane is `closed`, so the rollback shuts
  the door for **future** fires only; rows already admitted to `signature.ledger`
  remain admitted, and that store is append-only with no rewrite path. Removing them
  is a separate, deliberate operation. ✅ **The rollback does NOT silence anything** —
  the receipt is accrued *after* `_dispatch_delivery` and the mode refusal is
  swallowed and logged at INFO, so a forming-lane cycle still tells the member
  (`test_the_FORMING_lane_writes_no_receipt_and_still_tells_the_member`). Expect one
  `no ledger receipt for alert …: forming-bar fires are not ledger-grade` line per
  fire while the lever is pulled; that line is the door working.
* **The variable itself.** It persists across redeploys and outlives the incident.
  Clearing it (empty value, or delete it) is a second deliberate step — and until you
  take it, `cutover_watch` will keep saying NO-GO, which is the point.

### B. The constant — the permanent revert

Use this when the decision is *"the closed lane is not shipping this quarter"*, not as
an incident lever. `api/services/indicator_alert_evaluator.py`:

```python
ALERT_EVAL_MODE = "forming"        # "forming" | "closed"
```

That line back to `"forming"`, one commit, one push to `master`, one Railway redeploy
of the **web** service. Verify afterwards with the AST probe (a grep
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

#### How long **B** takes

| step | time |
|---|---|
| edit + commit | ~1 min |
| push to `master` | seconds |
| Railway build (`pip install` + `npm install` + `npm run build`) and deploy | **~5–10 min** typical for this service |
| old container drain (`drainingSeconds: 30`) | ~30 s |
| **total, push → new behaviour live** | **budget 10 minutes** |

⚠️ **A committed revert does not beat a set variable.** If the lever is still set, B
lands and the lane does not move — the variable is above the constant. Clear the
variable in the same operation, and read back `override_present: false`.

### ⚠️ The thing that will bite you mid-session

**Historical note:** a pre-push hook used to block pushes 09:15–16:20 ET — precisely the
window in which a rollback would be wanted — which is why this runbook reaches for lever A
during a session. That freeze was removed 2026-08-24, so **B** is now available mid-session
with no override. Prefer **A** anyway, on the merits: it requires nothing from `git` at all,
while B costs a ~1-minute `/api/*` blip for live members (the flow worker is a separate
service now, so B is not a tape gap). `tools/alert_soak_matrix.py --disarm` is **not** a
mitigation — it only removes the 31 soak rows and does nothing for real members.

---

## 7. Suggested cadence for cutover day

| when | what |
|---|---|
| ~09:35 ET | first run. Expect `no-rth-shadow-rows` to have cleared within a few minutes of the open; if it has not, the shadow cron is not running. |
| ~10:00 ET | first meaningful read — a bar is forming, so the per-address diff is real. **This is the reading the flip decision rests on.** |
| every ~30 min | re-run. Watch `undeclared`, `unexpected` silence, and `deliverable_now`. |
| immediately after the flip | re-run. Header must show `ALERT_EVAL_MODE = 'closed'`, `lever : ALERT_EVAL_MODE unset — EFFECTIVE LANE 'closed'`, and the diff should now read the *same* two lanes (the tool passes `mode=` explicitly, so it does not start comparing closed against closed). |
| ~15:50 ET | last read of the session. |
| the Monday after | if the closed lane misbehaves, take **lever A** (§6). It is one variable, it needs no deploy at all, and the readback is a URL. |
