# flow-worker watch coverage — RED, and it is an INERT STRAND. No redeploy.

`python tools/flow_worker_watch_coverage.py` exits 1 on this branch:

```
[watch-coverage] base=origin/master reachable=165 watched=24 changed=20
[watch-coverage] FAIL - flow-worker RUNS these files but will NOT redeploy for them:
    api/services/journal_two/notes.py
```

Per `docs/runbooks/deploy-windows.md` a red here is a **REVIEW GATE, not a
block**. Traced rather than assumed, in the same shape as the `auth_service`
precedent already recorded in CLAUDE.md:

| question | answer |
|---|---|
| Is `notes.py` in flow-worker's import closure? | **Yes** — that is why the tool fires. |
| What did this branch change in it? | **Nothing that existed.** The diff against the master it lands on is **purely additive**: `git diff origin/master...HEAD -- api/services/journal_two/notes.py` has **zero** deleted or modified lines and adds exactly one top-level symbol, `get_note_graph`. |
| Who calls `get_note_graph`? | Exactly one site, `api/routers/journal_two.py:1709`. |
| Is that router in flow-worker's closure? | **No** — the tool names only `notes.py` as reachable-and-unwatched; the router does not appear in the reachable set at all. |

**Therefore a stale flow-worker executes byte-equivalent behaviour.** It keeps
running the previous `notes.py`, which differs from the new one only by a
function it has no path to call.

⛔ **Do NOT force a redeploy via the `api/flow_worker_main.py` header trigger.**
Massive OPRA does not replay, so a flow-worker restart is a permanent tape gap
until the T+1 flat file — paid here for **zero** behavioural difference. That is
the Tier 2 cost the runbook exists to prevent.

⚠️ What would change this verdict: any future edit to a pre-existing symbol in
`notes.py`, or any call to a j2 notes function from inside flow-worker's
closure. Re-run the tool and re-trace; do not inherit this conclusion.
