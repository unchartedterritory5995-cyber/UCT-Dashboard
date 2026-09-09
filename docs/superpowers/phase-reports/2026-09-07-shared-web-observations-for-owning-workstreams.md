# Shared-production observations routed OUT of the Notebook workstream (2026-09-07)

Two things the Notebook integrity mini-pass **observed but does not own**. Both are
recorded here rather than acted on, per the owner's routing instruction. Neither
was remediated from Notebook, and neither is attributable to Notebook from the
evidence available.

---

## 1. Web pod RSS rose ~1.3 GB → ~7.7 GB during another workstream's deploy

**For: the deployment / infrastructure workstream.**

**What was observed**, from unauthenticated `GET /api/health` polling only:

| Time (approx, 2026-09-07 evening CT) | `uptime_seconds` | `rss_mb` |
|---|---|---|
| before the Wave K deploy | 779 | 1564.7 |
| after the Wave K deploy, settled | 148 → 338 | 1158.5 |
| during the next deploy's INITIALIZING | 1036 | 1258.5 |
| — | 1292 | **5101.0** |
| — | 1348 | **7700.5** |
| five consecutive samples, ~12s apart | 1362 → 1411 | 7700.5 → 7719.5 (flat) |
| after that deploy landed (fresh process) | 40 | 1485.7 |

**Context that matters:**

- The rise happened on the **old** process while Railway deployment
  `4a6015ae-a2ee-4052-a999-05f45643d344` — commit **`2755bad4b`**, *"3b step 3a:
  land the drift rail that step 3 said it landed"*, an Options Flow / flow-parts
  workstream commit — sat in **INITIALIZING** for an extended period.
- `status` stayed **`ok`** throughout. No member-visible failure was observed.
- **No Notebook code deploy occurred during the rise.** Wave K's deploy had
  already landed and settled at ~1158 MB before it began.
- Only **read-only probes** were running from the Notebook session: `/api/health`,
  anonymous route-code probes, and static `/assets/*.js` fetches.
- The pod cleared on restart (1485 MB), so nothing persisted.

⛔ **Do not read a leak into the plateau.** RSS rose, then held flat across five
samples, then reset with the process. That is consistent with a large bounded
allocation as easily as with a leak, and this evidence cannot separate them.

**Why it is worth someone's attention anyway:** this service has prior OOM history
(the standing rule against running heavy scripts on the prod pod exists because an
OOM there has already caused a member-visible outage twice), it runs a single
uvicorn process shared by every user, and ~7.7 GB is several times its normal
working set.

---

## 2. `optionsFlow/flowParts.test.js` fails on master

**For: the Options Flow perf-migration workstream (partner-owned Phase-B code).**

`src/pages/optionsFlow/flowParts.test.js > the parts path is actually WIRED into
the page > first paint chooses the parts bundle when the flag is on` — **fails.**

**Proven not to be Wave K's**, and proven rather than asserted:
`git diff origin/master HEAD` over the OptionsFlow paths was **empty**, and no
frontend file outside `journal-2-0/` differed from master at all. Same code, same
test, so it fails identically on master alone.

It was deliberately **not** touched from the Notebook workstream. Flagging it
because it is a *wiring guard* for the Phase B parts path, and master's most recent
commits moved exactly that code — the failure may be the guard doing its job.

Recorded in the Wave K certification's "Not certified — stated plainly" section as
item 3.
