# Trading Brain → UCT Agent knowledge program — STATUS (the durable board)

Resume from this file. It is the record; chat messages are notices only. Last updated 2026-11-03 (overnight session).

## Authority and boundaries
- Owner authorized implementation 2026-11-03 (overnight program after design PR #723): three-kind PoC on the MD-1 gateway over the read-only Brain facades; dashboard-side source policy, default-deny, team-owned sources only; free deterministic tests only.
- NOT authorized: merge to master, deploy, flag activation, member rollout, paid model calls, external model calls, new source families, proprietary-data export, flow-worker restart, any change to the partner's pipeline, the planner, the Brain engines or the indicator systems.
- Main integrator (session AUDIT) 2026-11-03: OK for hooks 1–6 as one commit on this branch; **merges are frozen program-wide until the owner returns**; open a DRAFT PR into `agent/int-w2` (not `agent/int`); integrator regenerates the golden manifest at merge time.

## Owner decisions (recorded 2026-11-03, end of phase 1)
- Phase complete. Stopping further feature work without measurable benefit: approved.
- Source policy stays as is (trader_archive + setup_knowledge only). No additional sources.
- Wisdom vocabulary expansion (31 of 48 templates unmapped): approved in principle; owned by the main integrator and the Wisdom maintainer, not this package.
- VCP RS-rank criterion stays BLOCKED (F-16). No public substitute is to be invented.
- Feature NOT activated (UCT_AGENT_KNOWLEDGE stays off).
- The five structured setup criteria stay unserved (reviewed:false) until reviewed.
- This package is on STANDBY: implementation resumes only for a concrete defect or integration requirement in the knowledge package reported by AUDIT. No merge, deploy, flag change or scope expansion.

## Owner source-policy decision (final, 2026-11-03, after review r5)
1. Original team commentary is NOT excluded merely because it mentions EP, VCP, HTF or another excluded setup.
2. The 380 approved team posts that mention excluded setups are NOT admitted wholesale either: eligibility requires
   verified team ownership or authorization, original commentary, and no reproduced or closely paraphrased restricted
   third-party material.
3. The 71 definition-like posts (r4 bypass hunt) stay WITHHELD pending provenance and rights review.
4. Third-party setup templates and their restricted definitions stay excluded.
5. A narrowly scoped, testable source-policy refinement only if the integrator determines one is necessary;
   default-deny and all existing boundaries preserved.
6. No export timestamp substitutes for the original statistics calculation date; the partner must confirm the Brain
   Pack's date semantics (R4-3); until then questionable statistics stay withheld.
Status vs code at be4c127a41: (1) and (4) already hold. (3) does NOT hold yet — the 71 definitional posts are served
(trader_archive is an admitted source). (6) holds by construction (no export/import date is ever read; undated or
inconsistent dates withhold). Refinement proposal for (2)/(3) sent to AUDIT; no code change until AUDIT confirms it is
necessary (owner point 5).

## Source-policy refinement: mentions of excluded setups (branch agent/kn/mention-refine, stacked on #735)
Owner wording (relayed to this session, 2026-11-03): do not exclude original team commentary merely for mentioning EP,
VCP, HTF or another excluded setup; do not admit all 380 either; eligibility requires verified team ownership or
authorization, original commentary, and no reproduced or closely paraphrased restricted third-party material; keep the
71 definition-like posts withheld pending provenance and rights review.
Owner wording (relayed to AUDIT): "third-party setup commentary remains excluded unless independently established as
original, authorized team-owned analysis". AUDIT: consistent with the above, given ownership verified by construction
plus the definitional proxy. Activation stays on HOLD.

What the code does (AUDIT-approved design (a)-(d), its conditions 1-3):
- At index build every row records the templates it names (each template name/alias of >= 3 characters, whole word,
  case-insensitive) and those named with DEFINITIONAL wording nearby: within 40 non-full-stop characters one of
  is|are|means|defined|definition|rule(s)|entry|stop|criteria (the review r4 pattern, probe_n15.py:35).
- An admitted row with a definitional mention of an EXCLUDED template is withheld unless it is on policy.cleared_rows
  with a complete {kb_id, provenance_ref, rights_review_ref, approved_by, approved_on} entry (list EMPTY).
- Every other admitted row that mentions an excluded setup is served as team commentary: the passage carries
  mentions_excluded_setup + commentary_only, the browser text says "team commentary that mentions X; not UCT's
  definition of it", and the model frame rule says commentary is never a definition. Coach: read commentary_only.
- Fail closed: a row whose check failed (mention_error) is withheld; if the exclusion data cannot be read at all, the
  search answers "unavailable" and serves nothing.
Real snapshot (counts only): of 2,837 rows servable before the refinement, 71 are withheld (exactly the review's 71)
and 309 are served flagged as commentary; 0 parse errors. Across all admitted rows including dated categories: 100
withheld. Index build 9.2 s (was 0.7 s; once per Brain Pack); search unchanged (~15 ms).

DETECTION LIMIT (stated plainly): team ownership is verified by construction (the ledger stores only the six team
authors' posts). Reproduced or closely paraphrased third-party material is NOT detected beyond the definitional-wording
proxy above: a post that paraphrases a third-party definition without those cue words near the setup name would be
served as commentary. Provenance and rights review (cleared_rows) is the only way to establish more.

## Branches, commits, PRs
| Branch | Worktree | Base | Head | PR |
|---|---|---|---|---|
| `docs/agent-brain-integration-2026-11-03` | session scratchpad clone | master `e6740b5b08` | `33a87385` | #723 draft → master (design docs) |
| `agent/kn/knowledge-poc` | `C:/w/kn-1` | `origin/agent/int` `06ba3eefcf` | see `git log` (last recorded below) | draft → `agent/int-w2` (see RESUME-KN) |

Commits on `agent/kn/knowledge-poc`, oldest first:
| Commit | What |
|---|---|
| `20db0d1534` | this board (K-00) |
| `1e95267442` | server package: policy, pack, FTS index, guard, stats, three kinds, 41 tests (K-01..K-04) |
| `e106cc1932` | health / coverage report (K-06) |
| `6c7e2d88a2` | browser QUERY capabilities `playbook.*` + 13 tests (K-05) |
| `68c401482a` | hooks 1–4 (gateway, builtins, routing group, turn_v2 domain), AUDIT-approved |
| `17e553f48b` | with/without-Brain comparison suite (K-07) |
| `3f3afea069` | fix: dark routing regression, isolation rail (literal kinds), clock rail |
| `f9a03577da` | independent review round 1 fixes (findings 2–7, 9) |
| `224f057b8e` | board, QA record, RESUME-KN |
| `8a4993b520` | independent review round 2 fixes (live figure not withheld; pack-scoped cooldown) |
| `f4e89bf1d8` | relevance: query expansion from the pack template aliases (K-14) |
| `a288af7607` | routing narrowing pinned as an expected failure |
| `f0e2e24c6c` | retrieval quality round (K-15) |
| `8f8bdd1605` | routing: playbook group add-only (review finding 8; AUDIT-approved shared-file change) |
| `3852446f29` | setup-criteria pilot + KN-1 contract with the measurables table (K-16; AUDIT go) |
| `668f9903ed` | independent review #735 fixes: B1 signed edge labels, B2 model-visible data frame (turn_v2 step result + v1 history replay, AUDIT-approved hunks), B3 guard shapes, N1, N2, N4, N8 (K-18) |
| `4b144368ce` | owner decisions: N3 default-deny for templates (origin) and records, N5 coach split, B3 round 2, per-turn caps, archive date requirement (K-19) |
| `adca17b6a9` + `10a478526b` | modelIsolation scan fix (cherry-pick of AUDIT b3ed064223) + knowledge.js as a known reader |
| `3faccb7b07` | owner decisions (PROGRAM.md @ b8d20a1286): brain stats CONDITIONAL gate, rights-cleared concept path (empty), web-research separation (block by default), ARCHIVE-ASOF-1 contract (K-20) |
| `e25ebc813e` | re-review r2: N-7a/b, N-8 citation-only replay, N-1..N-6; guard false positive from 4b144368ce fixed (K-21) |
| `6d9ee0f727` | separation tests stub the research door; robust to the eval-ledger stub leak |
| `de59823327` | r3: B-1 v2 knowledge replies replay citation-only (research blocked in the window); N-9..N-14 (K-22) |
| `3cc2a232f9` | N-15 fail closed: setup_knowledge SETUP rows with no template withheld (K-23) |
| `be4c127a41` | r4: structural used_knowledge (R4-1), naming skip (R4-2), fail-closed exclusion (R4-6), figure drop on every path (R4-4) (K-24) |

## Tasks
| id | task | state | evidence |
|---|---|---|---|
| K-00 | Worktree + board | done | |
| K-01 | Default-deny policy (`docs/agent/knowledge/policy.json`, `policy.py`) | done | admitted: trader_archive, setup_knowledge only |
| K-02 | Local FTS index keyed on pack version (lazy rebuild + on_install, atomic, cooldown) | done | real snapshot: 19,024 rows in 0.66 s |
| K-03 | Kinds `knowledge.search`, `setup.playbook`, `setup.record` | done | |
| K-04 | Server tests (synthetic fixture pack) | done | 67 passed |
| K-05 | Browser capabilities + tests | done | 13 passed |
| K-06 | Health / coverage report | done | QA-RESULTS.md §1 |
| K-07 | With/without-Brain comparison | done | 20/20 vs 0/20; 0/8 control false matches |
| K-08 | Real-snapshot demo (scratchpad only) | done | QA-RESULTS.md §2 |
| K-09 | Hooks | done (1–4); 5 deferred to integrator; 6 dropped (ledger lists no Agent flags) | `68c401482a` |
| K-10 | Independent review round 1 | done; all findings fixed except 8 (known limitation) | QA-RESULTS.md §5 |
| K-11 | Full Agent suites on head `f9a03577da` | done: all green | server 2,156 passed; browser 2,653 passed, 6 skipped |
| K-12 | Draft PR into `agent/int-w2` + RESUME-KN note | done | PR #735 (draft) |
| K-13 | Second review round | done: 0 blocking; findings 1, 2, 4 fixed in `8a4993b520`; 3 and 5 recorded | |
| K-14 | Relevance: expand shorthand (EP, U&R, VCP, HTF…) with the template names/aliases from the pack, whole-word only | done | real snapshot, 6 shorthand questions: top passages naming the setup in full 7/14 → 9/13 |

| K-15 | Retrieval quality: adjacent-word phrases, precise alias expansion (name match wins), focused excerpts, whole-passage injection check, guard precision | done | real snapshot, 40 questions: P@3 0.86 -> 0.89; success 37 -> 38/40; guard false positives 3 -> 0 of 5,270; p95 23.6 -> 18.8 ms |
| K-16 | Derived setup criteria (pilot: Stage 2 Breakout, EP, VCP, HTF, U&R), validated, served only when reviewed; KN-1 contract measurables | done (all reviewed:false) | criteria tests; contract-table equality test |
| K-17 | Routing finding 8 fixed (add-only group) | done | "explain this setup" keeps chart actions |

## Full-suite record
| Head | Server (tests/test_uct_agent*.py + brain tests) | Browser (src/agent) |
|---|---|---|
| `68c401482a` | 2,148 passed, 1 failed (clock rail — this branch; fixed) | 2,576 passed, 3 failed (this branch; fixed) |
| `f9a03577da` | 2,156 passed, 0 failed | 2,653 passed, 6 skipped, 0 failed |
| `8a4993b520` | knowledge + clock rail 69 passed (change is knowledge-package only) | knowledge suites 87 passed |
| `3852446f29` | 2,183 passed, 0 failed | 2,655 passed, 6 skipped, 1 timeout (qa/modelIsolation scan test hit 15 s under suite load; alone: 12/12 in 7.6 s) |

| `668f9903ed` | 2,207 passed, 0 failed | 2,657 passed, 6 skipped, 1 timeout (same qa/modelIsolation scan test; alone 12/12 in 8.7 s) |
| `4b144368ce` | 2,223 passed, 0 failed | 2,665 passed, 6 skipped, 1 timeout (same qa/modelIsolation scan test; passes alone) |
| `e25ebc813e` | 2,248 passed, 2 failed (suite-order leak, fixed in 6d9ee0f727) | 2,673 passed, 6 skipped, 0 failed (isolation timeout fixed) |
| `6d9ee0f727` | 2,250 passed, 0 failed | (server-test-only change; browser as e25ebc813e) |
| `de59823327` | 2,259 passed, 0 failed | 2,673 passed, 6 skipped, 0 failed |
| `3cc2a232f9` | 2,260 passed, 0 failed | 2,673 passed, 6 skipped, 0 failed |
| `be4c127a41` | 2,266 passed, 0 failed | 2,673 passed, 6 skipped, 0 failed |

Browser suite notes (head 3852446f29):
- 1 timeout: qa/modelIsolation.test.jsx "no module reads an isolated kind outside a local-only capability…" exceeded its 15 s limit while the full suite loaded the machine; rerun alone it passes 12/12 in 7.6 s (9.5 s on the earlier full run). Not a regression; the test scans every Agent source file and sits close to its budget. File owned by agent-qa; reported to AUDIT.
- 6 skipped, all PRE-EXISTING conditional skips (it.skipIf on an env var), none added by this branch: agentNl1EvalScore (AGENT_EVAL_BODIES/RESULTS), agentNl1EvalCapture, agentLiveCapture, agentSmokeCapture (capture OUT dir), agentLiveFlow (live RELAY), agentScreenerSortCoverage one case (ROUTE). They run only for live-model or eval-capture runs, which are paid and not authorised.

## Independent review of #735 (AUDIT, 3852446f29): APPROVE WITH CHANGES
Fixed in 668f9903ed: B1, B2, B3, N1, N2, N4, N8 (tests for each). Owner items relayed by AUDIT: B4 (written approval that
team-owned knowledge may reach the model and transcripts; blocks activation), N3 (templates/records outside policy.json),
N5 (coach vs playbook split). Notes for later: N6 (routing words never disarmed at runtime), N7 (criteria names verified
against the real template names: EP, VCP, HTF, U&R, Stage 2 Breakout match), N9 (gateway owner: guard each registrar).
Consequence of N4: the team archive record carries no refresh date, so its figures are withheld (undated = stale) until
the archive exposes one — a requirement for the Wisdom archive owner.

## Owner decisions after review (2026-11-03, via AUDIT), implemented in 4b144368ce
- Archive freshness: fail-safe kept; date must be a computation date (`through`), never export/import time. Requirement:
  docs/agent/knowledge/ARCHIVE-ASOF-REQUIREMENT.md. No named maintainer for wisdom/archive in the repo.
- Model access: conditionally approved for admin-only design/testing; caps per read (k <= 3, 500 chars/passage,
  1,900 chars/result) and per turn (4 knowledge reads, 3,000 excerpt chars); recorded in policy.json `model_access`.
- Transcript retention: NOT approved; no storage change (design on agent/kn/retention-proposal by another agent).
- N3: templates admitted only from UCT team origins (8 of 48 on the real snapshot, all TSDR; EP/VCP/HTF/Stage 2
  Breakout excluded as third-party methodology). Engine setup_performance / trigger_performance PENDING (firm-generated);
  team_archive admitted but undated, so setup.record currently serves n and reasons only. Owner to decide both.
- N5: coaching phrasings never route to the playbook group.

## Owner decisions (PROGRAM.md @ b8d20a1286) and re-review r2, implemented
- Brain statistics: CONDITIONAL — served only with provenance, calculation date (<= 14 days, not future), n >= 30,
  methodology id and Wilson interval; each failure mode -> figure-free block naming it.
- Third-party templates: blocked; rights-cleared concept allow-list exists and is EMPTY.
- Web research: knowledge never reaches it (v1 + v2 blocked when framed knowledge is in the request; knowledge kinds
  refuse non-answer purposes; replay is citation-only) — sentinel tests in both planners.
- Archive date: interface contract ARCHIVE-ASOF-1 to the proposed owner (partner/ledger maintainer); undated withheld.
- N-7b real snapshot: 14 of 98 setup_knowledge SETUP rows withheld (linked only to excluded templates).
- r3 B-1: a v2 knowledge reply is replayed citation-only; the reviewer's probe shows no replay and 0 research calls.
- N-15: SETUP rows with no template now FAIL CLOSED (3cc2a232f9). Real snapshot: SETUP 8 served, 34 withheld (14 excluded-template, 20 no template); non-SETUP 56 served. Ids: docs/agent/knowledge/N15-UNRESOLVED-SETUP-IDS.md.
- r4 review (AUDIT): APPROVE merge-dark; B-1 verified fixed. Open: R4-5 (owner scope: 380 admitted rows name an excluded setup, 71 definitional), R4-3 / N-9 (brain owner: does the pack export preserve updated_at).
- Real snapshot after all changes: P@3 0.89, 38/40, p50 17.6 ms, guard false positives 0 of 5,270.

## Quality work stopped (owner rule: stop when the measurable benefit is small)
Admitted corpus on the real snapshot: 0 passages under 200 characters, 0 remaining duplicates, 0 near-duplicate titles,
0 guard false positives. Retrieval: 38/40 realistic questions answered relevantly, P@3 0.89, p95 < 20 ms. Further
filtering or ranking work would add complexity without a measurable gain; embeddings stay out (no external calls).

## Brain response handling (branch agent/kn/grounded-reply, owner-approved 2026-11-03, before activation)
- Planner v1 writes `reply` before anything is read. A v1 plan holding ANY `playbook.*` op (decided by action name,
  knowledge.frame.is_knowledge_action) never serves that reply (turn.sanitize_envelope); UCT's cited card is the answer.
- Mixed write + playbook plan (decision): the reply is dropped too. Free text cannot be checked for a definition the
  knowledge base never gave; the write's receipt confirms the change and the card gives the knowledge.
- A v1 knowledge plan is never researched in the same turn; the fixed sentence turn.KNOWLEDGE_NO_WEB says so.
- Cards (capabilities/knowledge.js): fixed leads "From UCT's knowledge base (...)" / "From UCT's playbook - <template>:",
  a citation per passage (UCT KB #id, source, trader, date) or per template, and the pack + source-policy version.
  Nothing approved: "No approved UCT source covers this" / "UCT has no approved playbook definition for <X>" /
  "UCT has no approved evidence for <X>" (X echoed only when it is a short plain name). Server caps, N3, the stats
  gate and the withheld rules are unchanged.
- Planner v2 (reads, then answers from the framed result) is unchanged and never passes the v1 gate (tested).
- Flags unchanged: UCT_AGENT_KNOWLEDGE unset; no knowledge kind in UCT_AGENT_DATA_KINDS.
- Review #768 (2026-11-04), knowledge first (turn.knowledge_first, only while a playbook.* capability is offered):
  a TALK disposition (answer/clarify) holding a knowledge op becomes an apply of those knowledge ops only (also in the
  gate itself); a message that is a playbook question (knowledge.frame.wants_knowledge = the browser's PLAYBOOK_WORDS,
  tested equal) never streams the reply; its answer without a knowledge op becomes UCT's playbook.explain read of the
  member's question (no extra model call), or KNOWLEDGE_NOT_RETRIEVED if that read is not offered; a change + playbook
  question keeps the change and adds the read; a clarify keeps its choices, never its model-written text. A local-only
  lookup's notice still replaces KNOWLEDGE_NO_WEB (tested). Flag off: unchanged (tested, streaming included).
- Review #768 delta (2026-11-04) and OWNER DIRECTIVE: v1's gates are DEFENCE IN DEPTH, not the guarantee. A word list
  (or a scan of the model's answer) cannot enforce "playbook definitions only from approved retrieval": the reviewer's
  phrasings ("what's a VCP?", "tell me about cup and handle") pass it. Brain stays OFF until a retrieval-first evidence
  step exists: design docs/agent/knowledge/EVIDENCE-ROUTING-DESIGN.md (owner decisions pending). Kept here, low risk:
  the server's words match across line breaks (re.S); while a knowledge capability is offered an answer never streams;
  a knowledge-turn clarify keeps only short plain choices (none left = the read); a message about a specific stock or
  chart is not a knowledge turn; a proposal never gets a read added (its reply is dropped); flag off, a talk reply with
  a stray playbook.* op is served exactly as before (the gate checks cap_names).

## E-1 evidence routing (branch agent/kn/e1-evidence-routing, owner-approved 2026-11-04 via AUDIT, DARK)
- Built as release 1 of docs/agent/knowledge/EVIDENCE-ROUTING-DESIGN.md ("Release 1 as built"): knowledge/evidence.py,
  one hook at the top of turn.run_turn. Stacked on #768 (agent/kn/grounded-reply); rebase onto master after train 4.
- Runs only while UCT_AGENT_KNOWLEDGE is on (OFF everywhere). Scripted tests only: no paid call, no eval run.
- Review #781 (AUDIT, 69c17cde6d): safe to merge dark, not activation-ready; findings 1-6 fixed or decided on this branch
  (word backstop + #768 gate on chart/none, general-information label, classifier off the call ceiling, no echoed
  names in refusals, manifest checked before the paid call, mixed-turn note text decided). Delta review pending.
- Owner decisions before activation: the labelled-set eval and its budget (>= 600 playbook-class prompts, 0 misses);
  Brain + planner v2 needs the v2 runner to render UCT's reads first; no streaming while Brain is on.

## Blocked / needs the owner
- Admitting `self_review`, `manual`, `chart_intake:*` or any `intake:*` source (policy.json is the switch; default-deny until the owner rules).
- Activation: `UCT_AGENT_KNOWLEDGE=1` and the three kinds in `UCT_AGENT_DATA_KINDS` — owner only, after merge.
- Before activation (AUDIT, 2026-11-03): master hotfix #755 `turn.DATA_READ_ACTIONS` drops the model's reply for a v1 plan made
  only of those reads. `playbook.*` are NOT in it today. Recommendation: add them for planner v1 (the v1 reply is written before the
  passages are read, so it could state a definition the knowledge base never gave; the renderer text is the answer); v2 is
  unaffected (it reads, then answers). Shared file: AUDIT's change, decided at activation, not before.
- Paid real-model comparison — not authorised.
- Partner: additive PACK_MANIFEST fields `schema_version`, `kb_sources`, `stats_updated_at` (compat behaviour in place; reported missing, never invented); fix the "high tight flag" alias attached to two templates.

## Known limitations (recorded for the integrator)
- (fixed in 8f8bdd1605) knowledge-only messages no longer narrow the routed request.
- 31 of 48 templates have no Wisdom vocabulary id (owner decision raised by AUDIT); resolution is by template name + alias, ambiguity refused.
- The VCP RS-rank criterion is blocked by F-16 until an owner-approved public alternative exists.
- Routing words are armed when the capabilities register and only disarmed by the test reset; nothing unregisters them at runtime today (review round 2, latent).
- A facade row with a win rate but no win count is withheld (fails closed).
- Retrieval is lexical (FTS5, porter stemming); no embeddings by design (no external calls).

## #751 review queue (independent review: approved except coach B-1, fixed in #757 8ba90b43ab, merged into this branch)
- (1) Rebuild: a request never waits for another thread's rebuild (`index.ensure` answers "being rebuilt" at once, nothing
  served from the old index); the mention scan checks only terms present in the row. Real snapshot build 4.6 s (was
  9.2-12.9 s). The first request after a schema change still builds once synchronously (startup hooks are shared code).
- (2) Template terms are bounded by non-word characters (a term ending in ")" now matches).
- (3) `cleared_rows`: approved_by must be a name (2-80 chars, a letter), approved_on an ISO date not in the future,
  kb_id a positive integer; anything else is ignored (row stays withheld).
- (4) 122 served, flagged rows matching a looser cue -> PROVENANCE-REVIEW-LOOSER-CUE.md (ids only) for the rights review.
- Real snapshot after the changes: 71 withheld, 309 served and flagged, 0 mention errors (unchanged).
- 2026-11-04 (owner directive via AUDIT): the 122 looser-cue rows are WITHHELD, not served as commentary: the index's
  definitional cue is now the looser cue (SCHEMA 4). None has a rights clearance; all are trader_archive (admitted
  source, 5 traders). Real snapshot: 122/122 + 71/71 withheld, 0 escaped; non-dated 150 withheld, 230 served flagged.
- Rebuild safety: a build writes a temporary file and swaps it in with one os.replace; a failed build leaves the old
  file untouched and no temporary file; a stale index (pack_ts or schema mismatch) is never served, and a request during
  another thread's rebuild gets "being rebuilt" (tests r751_a_search_never_waits..., r751_a_failed_rebuild...).
- Delta review of 8dbf655fb7 (2026-11-04), fixed:
  1. Spelling variants: rows and terms are compared folded (NFKC, case-folded, "&" = "and", punctuation/space runs
     collapsed); a term also matches its plural and its unspaced form.
  2. Definitional wording BEFORE the term ("definition of", "we call this", "known as", "characterised by", "rules
     for"...) and more after it (refers to, consists of, must, should, requires...) withholds the row.
  3. A clearance names the reviewed text: cleared_rows entries need `content_sha` (the index's sha256); changed text
     under the same kb_id loses its clearance.
  4. If the index is swapped between the withheld list and the query, nothing is served ("being rebuilt").
  5. The temp index file is fsynced before os.replace.
  6. OWNER DEFAULT (directive 2026-11-04, withhold uncertain): policy `excluded_setup_mentions.mode = "withhold"`:
     every admitted row that NAMES an excluded setup is withheld unless cleared. `serve_flagged` (owner only) re-admits
     the non-definitional ones as a block, flagged commentary_only. policy_version 5, index SCHEMA 5.
  Real snapshot (counts only): non-dated 2,837 servable BEFORE the mention rule, 430 of them withheld by it, 2,407 served, 0 served flagged; the 71 and
  the 122 all withheld; 0 served rows match any cue, a variant or a pre-term cue. If the owner chose serve_flagged:
  201 non-dated withheld, 229 served flagged.

## Next step to resume
MERGED DARK (2026-11-03): #735 is on master via release train 2, PR #754, master 3d3d444d4f, after Wave 1.1 was verified live.
Flags unset (AUDIT verifies production). #751 (this branch) is NOT on master; it needs its own independent review and a rebase
onto master before merge. Activation HOLD unchanged.
STANDBY (owner, end of phase 1): act only on a concrete defect or integration requirement in the knowledge package reported by AUDIT.

Previous notes:
The PoC is complete and reviewed; it is waiting on the owner. Release candidate = PR #735 head (GO for owner evaluation as a dark admin-only RC; HOLD on activation until the owner admits sources and sets the flag).
1. Owner: review PR #735; decide sources beyond team-owned; when merges reopen, the integrator merges into `agent/int-w2` and regenerates the golden manifest.
2. Optional free work within scope: an FTS synonym table for UCT slang (EP, U&R, HTF) to raise recall; health card on the Admin page (needs a page-owner OK).
3. Do not merge anything; merges are frozen until the owner returns.
- Second delta review (95db830922): APPROVE WITH NITS for merge-dark. Nit 1 fixed: the search takes the withheld ids,
  flags and the build they belong to from ONE snapshot (kinds._blocked_snapshot); a rebuild during the computation
  returns "cannot tell" (nothing served or cached); builds carry a nanosecond build_id (index.build_id). Follow-ups
  (not blocking): short aliases (peg/coil/bob) and the broad after-cues matter only if the owner ever chooses
  serve_flagged; a directory fsync after os.replace on Linux.
