# Wave K — Production Certification Report

**Ask Notebook · Ask Document · Ask Security Research · Ask Current Note**
Private-corpus retrieval with citation-grounded answers.

**Deployed commit:** `550283e02` (merge of `notebook-primary-platform` into master)
**Pushed:** fast-forward `9c6078503..550283e02`, no force
**Date:** 2026-09-07 · **Hold:** 8G-B shared-production hold explicitly cleared by owner before any merge

## Basis-of-evidence key

Every point below carries **how** it was verified, because "verified" without a
basis is the failure this program keeps paying for.

| Tag | Meaning |
|---|---|
| **PROD** | Probed against production after the deploy |
| **RAIL** | Automated test, run on the merged tree that shipped |
| **CODE** | Read directly out of the deployed commit |
| **SANDBOX** | Proven in the fail-closed local sandbox / real-model E2E, not in production |
| **NOT VERIFIED** | Honestly outstanding — named, not papered over |

---

## A. Release mechanics (1–10)

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 1 | 8G-B hold cleared before any merge action | PASS | Owner instruction; no merge/deploy attempted while active |
| 2 | `git fetch` before acting on stale state | PASS | Step 1 of the parked procedure |
| 3 | Master drift since the checkpoint inspected, not assumed | PASS | 5 new commits (`9e72492d2..9c6078503`) enumerated and read |
| 4 | No concurrent Notebook-affecting commit | PASS | Drift touches breadth/flow/mobile only; `grep -iE "journal_two\|journal-2-0\|notebook\|ask_"` over the drift → NONE |
| 5 | Branch/tree clean before merge | PASS | `git status --short` empty at `873063c9a` |
| 6 | Merge-tree re-run against CURRENT master, not the expired proof | PASS | The parked proof was against `9e72492d2`; re-run against `9c6078503` → **0 conflicts** |
| 7 | Isolated temporary worktree used | PASS | `_wavek-master-merge-temp` on `wavek-merge-temp`; primary worktree untouched during the merge |
| 8 | Genuine conflicts only | PASS | None existed; nothing was force-resolved |
| 9 | No force push | PASS | `git push origin wavek-merge-temp:master`, fast-forward |
| 10 | Notebook branch brought to the merge, not left behind | PASS | `--ff-only` to `550283e02`, pushed |

## B. Production process health (11–16)

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 11 | Fresh process — uptime RESET | PASS · PROD | Pre-deploy `uptime_seconds=779` → post-deploy `56` |
| 12 | Process stable, not crash-looping | PASS · PROD | 10 consecutive samples climbing monotonically 65→121s; later 338s |
| 13 | Health endpoint reports ok | PASS · PROD | `{"status":"ok","wire_date":"2026-09-04"}` |
| 14 | Memory not regressed by the wave | PASS · PROD | RSS 1564.7 MB pre-deploy → 1158.5 MB post |
| 15 | One further restart during settling, observed and recorded | NOTED · PROD | uptime went 56 → 148 → 65; normal deploy settling, then monotonic |
| 16 | Transient 502s during the swap, resolved | NOTED · PROD | Cloudflare 502 bodies during the pod swap; clean on retry, probes carry a 502-retry |

## C. Route reality and gating (17–26)

⭐ The control is what makes this section mean anything: an unmounted route on this
app answers **405 on POST and 200 text/html on GET** (the SPA catch-all). The
pre-deploy reading of the Ask route was exactly that.

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 17 | `POST /api/j2/ask/stream` is a real mounted route | PASS · PROD | **405 before the deploy → 401 after** |
| 18 | `POST /api/j2/notes/{id}/ask/stream` is a real mounted route | PASS · PROD | 401 `application/json` |
| 19 | Both refuse an anonymous caller | PASS · PROD | 401, not 200 |
| 20 | Refusal is an application refusal, not the SPA | PASS · PROD | `content_type=application/json` |
| 21 | CONTROL: a nonexistent route still shows SPA fallthrough (POST) | PASS · PROD | `POST /api/j2/zzz-not-real` → 405 |
| 22 | CONTROL: a nonexistent route still shows SPA fallthrough (GET) | PASS · PROD | `GET /api/j2/zzz-not-real` → 200 `text/html` |
| 23 | Every route the gated-routes rail claims exists on the real app | PASS · RAIL | `test_exposed_routes_gated.py` on the merged tree |
| 24 | Anonymous caller refused on every safely probeable route | PASS · RAIL | same suite, incl. master's new breadth entry |
| 25 | Paid surface has not SHRUNK | PASS · RAIL | ratchet test in the same suite |
| 26 | Wave K added no ungated door | PASS · RAIL + PROD | rail walks the served app; prod probes agree |

## D. Shipped frontend artifact (27–34)

⛔ The first sweep of this section returned **zero markers** and was WRONG: it swept
the pre-deploy bundle (`index-BPpk_v_Y.js`) because `index.html` had been fetched
while the old pod still served. The entry hash is the tell (`index-JF_32lGS.js`
now), and it is recorded here because "I checked the artifact" is worthless if it
was yesterday's artifact.

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 27 | Current entry chunk identified, not a cached one | PASS · PROD | `index-JF_32lGS.js`, cache-busted fetch |
| 28 | Ask panel accessible name shipped | PASS · PROD | `Your question about` in `DocumentPreviewSheet-3ViUeKcD.js` |
| 29 | Scope label UI shipped | PASS · PROD | `Asking:` present |
| 30 | Note-scope placeholder shipped | PASS · PROD | `What did I say about…` |
| 31 | Document-scope placeholder shipped | PASS · PROD | `What does this document say about…` |
| 32 | Citation precision states shipped | PASS · PROD | `valid_exact`, `reresolved_exact`, `valid_note_only`, `degraded` |
| 33 | Retired `NoteAskPanel` absent from the shipped chunk | PASS · PROD | 0 occurrences |
| 34 | Production bundle matches what the merge commit builds | PASS · PROD+LOCAL | local `npm run build` puts the same markers in the same-named chunk |

## E. Ask Current Note on the safe contract (35–42)

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 35 | `SYNTH_SYSTEM(note_title, note_block)` builder deleted | PASS · CODE | Deployed `note_ask.py`: the symbol survives **twice, both inside the module docstring documenting the removal** — no definition, no call site |
| 36 | No member content reaches `system=` | PASS · CODE | `grep -cE "system=.*note_(title\|block\|body)"` → 0 |
| 37 | Current-note route runs the shared Wave K pipeline | PASS · CODE | route body: `return await _ask_stream(user, asvc.NOTE, note_id, …)` |
| 38 | Prompt boundary railed | PASS · RAIL | `test_note_ask_prompt_boundary.py` |
| 39 | Streaming preserved | PASS · RAIL | `test_note_ask.py`; SSE gzip-exempt rail |
| 40 | Cost/rate controls preserved | PASS · RAIL | `test_ask_security.py` daily cap / concurrency / refund |
| 41 | Honest errors preserved | PASS · RAIL | `test_note_ask.py` |
| 42 | Citation intent preserved, regex pseudo-citations retired | PASS · RAIL + PROD | `AskCitationContract.closed.test.jsx`; retired resolver absent from the bundle |

## F. Prompt-injection boundary (43–52)

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 43 | `system_prompt()` accepts no retrieved/member content | PASS · RAIL | takes no arguments — no channel exists |
| 44 | Evidence fence neutralized and marker-counted | PASS · RAIL | `ask_prompt.py` |
| 45 | Assembly REFUSES a forgeable prompt boundary | PASS · RAIL | count-mismatch refusal |
| 46 | `request_kwargs` exposes no tools | PASS · RAIL | `test_ask_security.py::test_the_request_exposes_no_tools` |
| 47 | Citation handles resolve only against the packet sent | PASS · RAIL | unknown-handle test |
| 48 | "Ignore previous instructions" neutralized | PASS · RAIL | `test_ask_prompt_injection.py` |
| 49 | Cross-note exfiltration attempt neutralized | PASS · RAIL | same |
| 50 | Fake citation instructions neutralized | PASS · RAIL | same |
| 51 | Fake tool/action instructions neutralized | PASS · RAIL | same |
| 52 | Hostile source metadata neutralized | PASS · RAIL | same |

## G. Retrieval correctness (53–62)

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 53 | `ask_match_expr` joins content words with OR | PASS · RAIL | `test_ask_retrieval.py` |
| 54 | The search box keeps AND (recall unchanged) | PASS · CODE | `fts_match_expr` untouched |
| 55 | A naturally-phrased question retrieves | PASS · RAIL | paraphrase-now-found rail (mutation-checked) |
| 56 | `BM25_FLOOR` retired as a gate | PASS · RAIL | AST probe fails if any path gates on it |
| 57 | bm25 retained for ordering | PASS · CODE | ranking module |
| 58 | `query_match` vs `entity_context` preserved | PASS · RAIL | `test_ask_evidence.py` |
| 59 | Entity context can never satisfy `no_answer` | PASS · RAIL | context-does-not-satisfy rail (mutation-checked) |
| 60 | Private prose never becomes ticker candidates | PASS · RAIL | entity-resolution privacy rails |
| 61 | Outbound resolution only for symbols the member uses | PASS · RAIL | same |
| 62 | Common words that are real tickers do not auto-resolve | PASS · RAIL | same |

## H. Ranking and evidence budget (63–70)

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 63 | Signal tier decides WHY evidence matched | PASS · RAIL | `test_ask_ranking.py` |
| 64 | Source-type-normalized score orders within a type | PASS · RAIL | same |
| 65 | A zero-variance source type normalizes to the FLOOR | PASS · RAIL | same |
| 66 | Explicit `TYPE_PRIOR` tie-break, never alphabetical | PASS · RAIL | same |
| 67 | Per-type cap has a structural floor of one | PASS · RAIL | diversity-never-evicts-authority |
| 68 | Single-source scopes disable diversity | PASS · RAIL | same |
| 69 | Lineage dedupe collapses page + excerpt + thesis edge to one source | PASS · RAIL | same |
| 70 | Dedupe collapses the source COUNT, not the text | PASS · RAIL | wider page rides along as context |

## I. Citation contract (71–78)

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 71 | `body_plain` = retrieval representation | PASS · CODE | Slice 0/1 contract |
| 72 | `doc.textBetween(0,size,"\n")` = citation addressing | PASS · RAIL | `askCitation.parity.test.js` |
| 73 | Backend ↔ real ProseMirror equivalence across structural fixtures | PASS · RAIL | parity suite + `fixtures_pm_citation_text.json` |
| 74 | Note citation positions carry a source-state guard | PASS · RAIL | position-drift guard |
| 75 | Stale PM positions never used blindly | PASS · RAIL | same |
| 76 | An INVENTED citation cannot render as a citation | PASS · RAIL | closed-contract CASE 2 — **mutation-checked at closure**, byte-identical restore |
| 77 | Ordinary quoted language is not a citation | PASS · RAIL | CASE 3 |
| 78 | A passage spanning formatting nodes resolves | PASS · RAIL | CASE 6 |

## J. Security, tenant isolation, lifecycle (79–88)

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 79 | Every retrieval query carries a user id | PASS · RAIL | `test_ask_security.py` |
| 80 | Tenant isolation happens BEFORE ranking | PASS · RAIL | foreign-note-is-not-a-candidate |
| 81 | Errors are not an existence oracle | PASS · RAIL | same |
| 82 | Trash exclusion | PASS · RAIL | trashed-note-is-not-answerable |
| 83 | Restore behavior | PASS · RAIL | restoring-makes-answerable-again |
| 84 | Wave K added no persistent table | PASS · RAIL | schema probe |
| 85 | No derived retrieval state persisted | PASS · RAIL | same |
| 86 | Account purge unaffected | PASS · RAIL | `test_journal_two_account_purge.py` |
| 87 | Rate + concurrency limits, refund on failure | PASS · RAIL | 4 mutation-checked rails |
| 88 | No raw question/source logging; telemetry is counts only | PASS · RAIL | logging probe + its non-vacuity control |

## K. Privacy and semantic status (89–93)

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 89 | **Zero Notebook content sent to any embedding endpoint** | PASS · RAIL | AST probe: no Ask module references or imports an embedding provider |
| 90 | The probe can SEE a real embedding call (non-vacuity control) | PASS · RAIL | control asserts it catches a real call and ignores a docstring |
| 91 | Semantic activation remains BLOCKED on exact-project ZDR | PASS | unchanged; `org-6ljtvy8Dr0srF2ZRiE7vH2Dy` unverified |
| 92 | No deployment wording implies semantic capability | PASS | this report and the closure record state the opposite explicitly |
| 93 | Voice retention risk untouched by Notebook | PASS | separate workstream; nothing mutated |

> **SEMANTIC RETRIEVAL — architecturally approved · quality-justified by measured
> deterministic recall failure · NOT ACTIVATED · blocked on exact-project
> Zero-Data-Retention verification. No Notebook content has been sent to the
> embedding endpoint.**

## L. Regression, rails, and neighbours (94–99)

| # | Point | Verdict | Evidence |
|---|---|---|---|
| 94 | Backend suites green on the merged tree | PASS · RAIL | **505 passed**, pytest exit 0 |
| 95 | Frontend suites green on the merged tree | PASS · RAIL | **2215 passed**, 3 skipped |
| 96 | `broker_sync` merge invariant holds | PASS · CODE | `grep -c broker_sync api/main.py` = **10 ≥ 7**, checked after merge AND immediately before push |
| 97 | `broker_sync` route mounted in production | PASS · PROD | `POST /api/j2/broker/connect` → 401, not the documented 405 unmount signature |
| 98 | Wave I/J document + excerpt routes healthy | PASS · PROD | `/api/j2/notes/{id}/documents`, `/api/j2/excerpts/{id}`, `/api/j2/notes` → 401 `application/json` |
| 99 | Bounded production smoke, nothing mutated | PASS · PROD | health 200; breadth/watchlists/candidates/leadership 401; SPA shell 200 `text/html` |

---

## Not certified — stated plainly

1. **No production Ask round-trip with a real member session.** Every production
   check above is an unauthenticated probe: it proves the routes are real, mounted
   and gated, and that the UI shipped. It does **not** prove a member's question
   returns a grounded, cited answer *in production*. That was proven in the
   fail-closed sandbox with the real configured model (Slice 8a) and in a real
   browser (Slice 8b), and it is the one gap between SANDBOX and PROD in this wave.
   Closing it needs a real member session, which is a Day-1 usage observation.
2. **Zero real-member usage evidence.** Day 0, the same honest cap every prior
   wave's closure carries. The readiness scorecard's AI row moves 5 → 6 on the
   strength of this report (production-verified) and no further.
3. **One pre-existing frontend failure on master, NOT Wave K's.**
   `optionsFlow/flowParts.test.js > first paint chooses the parts bundle when the
   flag is on` fails on the merged tree. Proven not merge-induced: `git diff
   origin/master HEAD` over the OptionsFlow paths is **empty**, and no frontend file
   outside `journal-2-0/` differs from master at all — same code, same test, same
   result on master alone. It belongs to the live OptionsFlow perf-migration
   workstream on partner-owned files and was deliberately left untouched. **Worth
   the owner's attention:** it is a wiring guard for the Phase B parts path, and
   master's most recent commits moved exactly that code.
4. **`ImportWizard` flake did not reproduce** — failed in the first merged run,
   passed in the second, matching what Wave J's closure already recorded as
   load-dependent.
5. **G-080 share-link authorization remains UNVERIFIED** and is untouched by this
   deploy — `J2_SHARE_LINKS_ENABLED=1` is still live and still classified LIVE
   CONFIGURATION / ACTIVATION AUTHORIZATION UNVERIFIED. The owner's ruling puts its
   resolution after the hold clears; the hold is now clear, so this is the next
   decision due.
6. **Residual Wave K debt unchanged:** four low-overlap paraphrases still miss; a
   shared generic word can lift `no_answer`; `reachable.test.js`'s 16 orphaned
   `floor2`/`community` modules from `cc195e888` are not Wave K's.

## Verdict

**WAVE K IS PRODUCTION MERGED, PRODUCTION DEPLOYED, PRODUCTION VERIFIED, AND
CERTIFIED** to the limits stated above — 99/99 points carry a verdict, with the
basis of each recorded, and the one capability gap between sandbox and production
named rather than implied.

Next: the post-Wave-K integrity mini-pass (G-063 · raw-error rail · gap-ledger
reconciliation). **Not started — stopping here per instruction.**

---

## Addendum — integrity mini-pass production verification (2026-09-07)

Merged `a5d5ff04d` (isolated worktree, 0 conflicts, `broker_sync` 10 ≥ 7 checked
twice, fast-forward `c96ebfa7b..a5d5ff04d`, no force). Blast radius proven
minimal: outside `journal-2-0/`, `widgets/registry.js` and `docs/` the merge
changes **nothing**.

⛔ **The mini-pass was NOT production-verified at the moment it was declared
closed.** Production was still serving the pre-deploy control bundle
(`index-0raZzhvL.js`); the merge was on master but master had moved on and that
deploy was still BUILDING. Recorded because it is the same
configuration-vs-runtime distinction G-080 turned on, one layer up.

**Verified after the deploy landed:**

| Check | Evidence |
|---|---|
| Fresh process | uptime 55s, RSS 1137.7 MB |
| New bundle serving | `index-0raZzhvL` → `index-CDo0LTY9` |
| **G-063 gate shipped** | `captured-before-outcome`, `asOfDay` in `widgetEmbedCore-C8eZTLG3.js` |
| Raw-error copy shipped | "Nothing was saved" present |
| Raw-error old pattern gone | `Could not create note: ` → **0 occurrences** |
| G-080 still dark | flag `0`, serving process started after the change |
| No Notebook regression | `/api/j2/ask/stream` 401, `/api/j2/notes` 401 |

⭐ **The G-063 marker was absent from the first two chunks checked and present
once all 249 were swept** — it has its own chunk (`widgetEmbedCore-*`). Second
time this wave that a partial bundle sweep would have produced a false negative.
**Sweep the whole bundle, or say the sweep was partial.**

**INTEGRITY MINI-PASS: PRODUCTION-CLOSED.**
