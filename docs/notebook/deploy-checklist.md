# THE DEPLOY CHECKLIST — the single authority

⚰️ **WHY THIS FILE EXISTS.** The standing deploy authorisation has been
"conditional on a checklist" since the charter, and until 2026-09-11 that
checklist existed only in prose, in conversation, re-derived from memory each
time. A checklist nobody can open is not a control; it is a hope with a
timestamp — the same shape as
`lesson_a_documented_workaround_is_not_a_recovery_path`. This is it, written
down, so a row cannot be quietly skipped or silently invented.

⛔ **Every row is MEASURED on the SHA being pushed, never on intent.** The two
most expensive mistakes this programme has made were both a claim read off a
call site or a ledger instead of off the wire.

---

## A. EVERY master push (a push to master IS a production deploy)

| # | row | how it is satisfied |
|---|---|---|
| A1 | explicit **"deploy"** from the owner, plus a member-impact paragraph they have read | their words, in the conversation |
| A2 | **the member-impact paragraph is TRUE of this tree** | check each clause against the code, not the intent. ⚰️ R-25's paragraph said the Wave R capture tools were "switched off" when no gate existed at all — found on 2026-09-11 by doing exactly this |
| A3 | full sharded gate, **0 NEW failures** vs the named baseline | `python scripts/gate_shards.py --shards 6`. ⛔ Never hand-roll the shard loop. Assert the totals line and the file reconciliation, then the exit code |
| A4 | the gate ran on a **clean tree**, hash identical at start and end | the wrapper records both; a tree that moved mid-run is not a gate |
| A5 | tree is **0 behind origin/master**, or merged and **re-gated** | overlap ≤0 and <6 behind may push as-is; otherwise merge and gate again |
| A6 | push window: **NOT Mon–Fri 09:00–16:00 ET** | a restart loses an APScheduler slot outright; docs-only pushes included |
| A7 | `grep -c broker_sync api/main.py` **≥ 7** | the merge-as-a-unit invariant |
| A8 | deploy verified **by the artifact** | `/api/health` `uptime_seconds` RESETS. Browser UA — Cloudflare 1010-blocks curl |

## B. ADDITIONALLY for a FLAG-ON deploy — R-27

> A flag-on deploy is any deploy that turns a feature ON for members: the
> offline flip, Wave R's flag, and every later wave's.

| # | row | how it is satisfied |
|---|---|---|
| **B1** | **the feature's own canary** | the flag's own instrument, on the rig |
| **B2** | **⛔ APP-WIDE CLIENT SMOKE, within the first ten minutes** | `python tools/postdeploy_client_smoke.py` — exit **0** required |
| B3 | the smoke ran with the **opt-in key UNSET** | the tool asserts it and refuses otherwise. ⛔ `'0'` is NOT unset: after the flip a stored `'0'` means opted-OUT, a product no member has. `--reset-keys` clears it |
| B4 | every top-level route **navigated by CLICKING**, URL *and* screen moved within the bound | a `goto` rebuilds the world and always works — it is what hid the 2026-09-10 freeze from every instrument |
| B5 | **render stability**: React commits stable across 5s idle on each shared-hook surface | commits are the discriminator; DOM mutations alone are live data, not a loop |
| B6 | flag ledger / manifest row updated with the **flip time** and the SHA | the ledger records intent and cannot see production; the checkpoint records what happened |

### ⛔⛔ B2 IS H4: A FAILURE MEANS ROLL BACK FIRST, DIAGNOSE SECOND.

**The lesson it encodes — 2026-09-10.** A render loop in a hub controller
starved React Router's transition commit. Clicking any nav entry changed the URL
and left the screen where it was, app-wide, for about four and a half hours.
`/api/health` returned 200 the whole time with a rising uptime. The full gate was
green at 0 NEW failures. The first-hour watch recorded five clean samples.

⭐ **The defect was in a SHARED component, so it was exposure for every member
regardless of which flag shipped.** That is why B2 is app-wide and why it runs
*in addition to* B1 rather than instead of it: a canary that exercises only the
flagged feature is structurally blind to it.

⛔ The smoke's three exit codes are three different facts — `0` PASS, `1` a
MEASURED failure (H4), `2` INCONCLUSIVE (rig down, not signed in, key set).
**INCONCLUSIVE is not a pass.** Collapsing them is the defect `CoverageLine`
exists to avoid.

---

## C. Hard stops that override every row above

H1–H8 unchanged. **H4 now explicitly covers B2.** Anything touching a member
account, a plaintext secret, the service worker, or an auth check is H6 and stops
the deploy regardless of what any row here says.

---

## Runs

| date | SHA | kind | gate | B2 smoke | result |
|---|---|---|---|---|---|
| 2026-09-11 | `3f3abe3cd` | Wave R, flags OFF | 1277 files, 18,884 passed, 0 NEW, exit 0 | n/a — not a flag-on deploy | shipped |
| 2026-09-11 | `3f3abe3cd` | (instrument validation) | — | **PASS** — 19 routes, 4 surfaces stable | `r27-smoke-waveR-flagsoff.json` |
