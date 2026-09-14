# Q1 window runs — what the runner did with each clear window

⛔ A window that opened with a non-empty queue and executed nothing is an
**ANOMALY** row. Silence is not success.

| window opened | entry | outcome | detail |
|---|---|---|---|
| 2026-09-14 00:01 | `trigger4-capture` | ok | (node:28392) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url. |
| 2026-09-14 00:01 | `second-context-append` | ok | ⇒ GREEN  offline sentence in the server body: **True** · queued 1 entry(s), baseline `2026-09-14T05:02:40.163380+00:00` · 5 request(s) carried the sentence (la |
| 2026-09-14 00:01 | `embed-re-run` | ok | ⇒ INCONCLUSIVE  could not create the probe note ({'err': 'HTTP 502'}) — nothing was measured |
| 2026-09-14 00:01 | `matrix-remainder` | ok | ⇒ INCONCLUSIVE  could not create the probe note ({'err': 'HTTP 502'}) — nothing was measured |
| 2026-09-14 00:30 | `embed-re-run` | ok | ⇒ RED  offline sentence in the server body: **False** · appended node present: **True** · queued 1 entry(s), baseline `2026-09-14T05:30:53.477225+00:00` · 3 |
| 2026-09-14 00:30 | `t12-owner-profile-run` | exit 1 |   ⛔ A FRESH PROFILE IS A SIGNED-OUT PROFILE, and there is no credentials file anywhere on this machine, so nothing can sign it back in. /   Point the tool at the canonical rig profile (--profile <path |
| 2026-09-14 00:30 | `matrix-remainder` | INCONCLUSIVE (attempt 2, requeued) | ⇒ INCONCLUSIVE  could not create the probe note ({'err': 'HTTP 502'}) — nothing was measured |
| 2026-09-14 00:30 | `matrix-remainder` | INCONCLUSIVE (attempt 3, giving up — needs a human) | ⇒ INCONCLUSIVE  the `append_document_excerpt` door was rig limitation: three real pointer gestures (triple-click, double-click, slow drag) across a 667x18px span prod |
| 2026-09-14 00:54 | `t12-owner-profile-run` | exit 2 |                            [--self-check] [--out OUT] / t12_smoke_runner.py: error: unrecognized arguments: --profile C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees\canary-chrome- |
| 2026-09-14 00:54 | `matrix-remainder` | INCONCLUSIVE (attempt 1, requeued) | ⇒ INCONCLUSIVE  could not create the probe note ({'err': 'HTTP 502'}) — nothing was measured |
| 2026-09-14 02:00 | `post-merge-canary` | ok | ok   4 door `tags` moved the baseline under the queued entry: run **#34** ⇒ `DOORS[34 % 4]` = **`tags`** · PUT **200** in **1** attempt(s) · baseline `None` → `2026-09-14T07:01:10.014100+00:00` · queu |
| 2026-09-14 02:03 | `t12-owner-profile-run` | ok | (node:16956) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url. |
| 2026-09-14 02:03 | `matrix-remainder` | INCONCLUSIVE (attempt 2, requeued) | ⇒ INCONCLUSIVE  the `append_document_excerpt` door was rig limitation: three real pointer gestures (triple-click, double-click, slow drag) across a 667x18px span prod |
| 2026-09-14 02:03 | `matrix-remainder` | INCONCLUSIVE (attempt 3, giving up — needs a human) | ⇒ INCONCLUSIVE  the `append_document_excerpt` door was rig limitation: three real pointer gestures (triple-click, double-click, slow drag) across a 667x18px span prod |
