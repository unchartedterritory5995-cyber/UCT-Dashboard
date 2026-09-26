---
id: ARCH-05
title: AI architecture — what runs today, what Terminal-Next constrains, and what it is not allowed to decide
role: the AI architecture deliverable. MASTER_CHECKLIST item 22, gate item 15. Written 2026-09-25.
inputs: D-12 `08-ai/existing-ai-systems.md` (accepted) · C6-01 `08-ai/ai-native-tools-survey.md`
  (accepted) · C6-02 `08-ai/grounding-architectures.md` (accepted) · E-06
  `09-security-licensing-cost/cost-model-ai-infra.md` (accepted — supplies §3's fifteen
  constraints) · I1-SPEC `08-ai/i1-tool-contract-grounding-refusal-spec.md` (draft, and the
  single most load-bearing input because its contract already SHIPPED)
scope: re-measured against the `_merge-master` worktree at `3b4140d46`, read 2026-09-25.
  Every `file:line` below was opened in that tree this pass unless it is attributed to an input
  report. No production surface was called, no Railway variable was read, no test was run,
  no LLM was invoked.
evidence_ceiling: |
  Flag STATE is the governing ceiling. This pass read two artifacts about flags — the in-repo
  ledger (`docs/feature_flags.json`, which records INTENT) and ORCH-RAILWAY-01's live read
  (which is 23 days old). Neither is the running process. `railway variables --service web --kv`
  is the only authority and this contract does not permit it. So every statement here about
  what is ARMED is a claim about an artifact, dated, never about the pod.
  Nothing was OBSERVED-CALLED: no answer was generated, no exam was run, no p50/p95 exists.
status: DRAFT for gate item 15. §4 is a set of constraints on an existing platform, not a
  greenfield design; §6 is the part a reader should not skip.
---

# AI architecture — Terminal-Next

## 0. Headline

**DECISION. Terminal-Next does not add an AI layer. It inherits one, and its architectural work
is three constraints on what already runs.**

1. ⭐⭐ **The contract this document was commissioned to invent has already shipped.**
   `api/services/ticker_explain.py` is on `_merge-master` (120,939 bytes) and implements, in
   running code, exactly the shape C6-02 ranks highest and D-12 found missing: fixed
   deterministic evidence domains with stable citable ids, a closed member-facing vocabulary,
   a **blocking** grounding gate that runs over the union of *every* free-text field the model
   authored, five named response states, and a refusal whose reason is **derived from the
   evidence gap, never model-authored** (§1.6). ARCH-05's job is to **generalise and rail**
   that contract, not to design one.
2. ⛔ **Grounding is producer-side only, and that is the whole trust gap.** UCT runs C6-02's
   P2 (declared gaps), P3 (post-generation gate), P4 (facts-first/computed verdict) and part of
   P6 (proposal chips) — *"stronger than any vendor's published posture on the producer side …
   and nothing at all on the reader side (P5)"* [C6-02 §9]. P5 is a machine-checkable citation
   pointer per claim. Half of closing it is a wire format; **the other half is a data-modelling
   job no citation API will do** — a computed number with no addressable row cannot be cited by
   any mechanism in the field [C6-02 §4].
3. ⛔⛔ **The economic risk is guard INHERITANCE, not the model bill.** At E-06's base
   assumptions the six proposed features cost $2.81–3.56/member/month against a $200 list price
   [E-06 §1.1]. The per-user caps already in code sum to **~$610–650/member/month** and the
   global caps sum to **~$68/day ≈ $2,000/month across every capped lane** — so *"at 1,000
   members the six-feature base case ($3,563/month) already exceeds the sum of all caps: the
   caps as inherited would refuse members before the product reached its own base case"*
   [E-06 §4.3, §5.1]. Terminal-Next must size a **population ceiling per lane** before it ships
   a single new AI surface.

**CONFIDENCE.** 🟢 on §1 (source read this pass, `file:line`), on §2 (a ruling and an owner
input, both cited) and on §3 (enumerated from E-06's own §6). 🟡 on §4 — it is a set of
constraints derived from accepted inputs, and **not one of them has been built or measured in a
Terminal-Next shell, because no such shell exists.** 🔴 on live flag state (see the ceiling).

⚠️ **Read §6 before quoting anything from §4.** Two questions this document is explicitly
forbidden to answer bound every proposal in it.

---

## 1. What AI exists today — measured from source

### 1.1 Two lanes, one facade, and the reason the facade exists

**OBSERVATION.** There are two member-facing Compass lanes — **voice** (OpenAI Realtime) and
**text chat** (Anthropic) — and they reach the firm's brain through **one shared module**, so
they cannot answer differently.

**EVIDENCE.**
- `api/services/brain_service.py:1-8` states the invariant in its own docstring: *"Single point
  both Compass surfaces (voice tools + text-chat tools) call, so voice and text can never
  diverge. Every function is guarded: when the pack is not installed / importable it returns
  `{"ok": False, "error": "brain not available"}` instead of raising."* The sentinel is at
  `:20`.
- The facade's public functions are `aggregate_heat_cap_pct` (`:73`), `lookup_playbook`
  (`:107`), `setup_winrate` (`:143`), `find_historical_analogs` (`:165`), `size_a_trade`
  (`:180`). **Read the module for the roster — do not retype it here.**
- ⭐ **Two safety properties are structural, not prompted.** `size_a_trade` refuses a stop at or
  above entry (`:189-191`, *"size only ever comes after the stop"*) and clamps account risk with
  `min(max(float(risk_pct), 0.1), 2.0)  # hard 2% account-risk cap` (`:193`). Neither can be
  talked around by a model, because the model does not compute them.
- `aggregate_heat_cap_pct` (`:73-89`) reads the firm's total-heat cap from the brain and
  fail-softs to `10.0`, with the reason written in-file: *"NEVER derived as N× per-trade (would
  drift if per-trade is reconfigured)."*
- `_current_regime()` (`:92-104`) maps the dashboard's own 5-way regime label onto the engine's
  4-tier sizing scale via `_REGIME_MAP` (`:24-30`) and **falls back to `YELLOW` on any
  failure** — an unknown regime never reads as GREEN.
- The engine is a **lazy import from an installed pack**, not a dependency: `_engine()`
  (`:48-66`) resolves `UCT_INTEL_PATH` or `brain_sync.brain_dir()`, returns `None` when the
  `uct_intelligence` directory is absent, and logs rather than raises. `_reset_for_tests()`
  (`:33-45`) pops `sys.modules` and says why: *"without it, a prior import of
  uct_intelligence from a DIFFERENT path would be silently served by Python's module cache
  and the facade would answer from the wrong DB."*

**INTERPRETATION.** This is the "one engine, three doors" pattern actually implemented, and the
`{"ok": False}` discipline is what makes it safe to put behind a member surface: a missing pack
degrades to a stated absence, never a stack trace and never a fabricated answer.

**RELEVANCE TO UCT.** Terminal-Next adds doors. It must not add a second facade. Any new
AI-touching panel calls `brain_service` / the registries below, or it becomes a second authority
over the firm's own numbers.

**CONFIDENCE.** 🟢 — read directly this pass.

### 1.2 The tool registries — three, and their relationship

**OBSERVATION.** Three registries exist and **two of them are views over the first**.

**EVIDENCE.**
- **`api/services/voice_tools.py:14` `_REGISTRY: dict[str, dict] = {}`** — populated by the
  `voice_tool(...)` decorator (`:17-40`) and dispatched by `dispatch(name, args, user=...)`
  (`:92`). `:116` exposes `sorted(_REGISTRY.keys())`. ⛔ **This is the source of truth for the
  tool roster. Do not restate its size here** — D-12 §2c reports an AST-derived **154** as of
  its own pass, which is a claim about that date; the registry is the thing to count.
- **Compass text chat: `api/services/journal_two/coach_chat_tools.py`.** The catalog contract
  is in the module docstring at `:1-14`. `TOOLS` is opened at `:903` and extended by
  `TOOLS.update({...})` at `:993`, `:1160`, `:1185`, `:1369`, `:1471`, `:1513`, `:1542`,
  `:1552`. ⚠️ **Eight `update()` sites mean a naive read of the literal at `:903` under-reports
  the catalog** — this is the same defect class the repo's own CLAUDE.md records under "a
  hand-typed enumeration beside the source that owns it".
- **The chat lane delegates rather than reimplements.** `_voice_delegate(tool_name)` (`:1684`)
  returns an executor that calls `voice_tools.dispatch(...)`, and it is used for `get_quote`
  (`:1784`), `get_regime` (`:1798`), `get_breadth` (`:1805`), `get_movers` (`:1814`),
  `get_earnings_intel` (`:1825`), `get_earnings_this_week` (`:1834`) — so there is one
  implementation per capability.
- **The brain tools are one gated block.** `_BRAIN_TOOLS` is defined at `:1691` and merged at
  **`:1841`: `if os.environ.get("BRAIN_TOOLS_ENABLED", "0") == "1": TOOLS.update(_BRAIN_TOOLS)`**.
  ⛔ The gate is evaluated **at import**, so a flag flip needs a process restart, not a request.
- **The agent lane is an explicit read-only allowlist over the same registry.**
  `api/services/ai_search_agent.py:39-45` is a literal list of tool names; `:78-86` builds the
  Anthropic tool definitions by looking each one up in `voice_tools._REGISTRY`; `:221` rejects
  anything off it. **Read the literal; do not retype its length.** D-12 §2a records the
  docstring invariant: *"READ-ONLY BY CONSTRUCTION… Actions from the ask box go through the
  PROPOSAL chips (the member's tap is the consent), not through the model."*
- **Write tools are preview → confirm, with an escalation flag.** Every action tool returns a
  preview carrying `confirm_label` and `elevated` (e.g. `:411`, `:521`, `:556`, `:649`,
  `:752`), and the discipline-settings tool sets **`"elevated": loosening`** at `:709` — i.e.
  the warning subtype is computed from whether the change *loosens* a risk rule, described at
  `:1252`.

**INTERPRETATION.** The permission model is **per-lane**, expressed as a constant. That is the
right shape and the wrong scope: it cannot express "this member's plan permits these tools".

**RELEVANCE TO UCT.** A Terminal-Next panel that wants tool access asks for **an allowlist, not
a registry**. The allowlist should become a function of an entitlement rather than a module
constant — D-12 §8 Gap #3 names the same thing, and `entitlements.py` ships exactly one toolkit
today.

**CONFIDENCE.** 🟢 on the mechanism. 🔴 on the roster's size, deliberately: not measured here.

### 1.3 Retrieval — `brain_kb_service`, and what "v1" means

**OBSERVATION.** Retrieval is a **semantic index that returns cited passages and refuses to
synthesise**. The calling model writes the sentence; the index only says what the KB holds.

**EVIDENCE.** `api/services/brain_kb_service.py`, read this pass:
- `:1-10` docstring: *"v1 is retrieval-only: return the top-k cited passages and let the CALLING
  model (Realtime voice / Sonnet chat) synthesize — no nested LLM call."* The index lives
  **outside** the swapped pack directory so a pack install cannot destroy it.
- `:23-25` `EMBEDDING_MODEL = "text-embedding-3-small"`, `EMBEDDING_DIM = 1536`,
  `MAX_CHUNK_CHARS = 1500`. `:31-35` `_index_path()` — `BRAIN_INDEX_DB`, else
  `<DATA_DIR>/brain_index.db`.
- `:49-60` its own SQLite (`brain_chunks`, WAL, `busy_timeout=2000`), keyed
  `UNIQUE(kb_id, chunk_no)`.
- `:72-78` `_default_embed` carries an explicit `timeout=20.0` with the reason in-file:
  *"request-path invariant (2026-07-01 outage): every blocking external call reachable from a
  request MUST carry an explicit timeout."* ⭐ This is E-06 constraint 9 already satisfied at
  this call site.
- `:96-149` `reindex()` is **incremental by content hash** and **deletes chunks that are no
  longer live** (`:139-141`) — a KB row removed upstream leaves the index.
- `:81-93` `_chunk()` keeps the title on every chunk, *"for retrieval quality"*.
- `:152-173` `_matrix()` caches an L2-normalised float32 matrix keyed on the index file's
  **mtime**, so a reindex invalidates it without a restart. `:176-194` `search()` is a cosine
  top-k. `:197-211` `ask_the_brain()` returns `{ok, question, passages[], note}` where each
  passage carries `title`, `category`, `trader`, `source`, `score` and a `≤900`-char excerpt.
- ⭐ **The empty case has its own return value, not an exception**: `:203-204`
  `{"ok": False, "reason": "brain index empty — run reindex"}`. That is exactly C6-02 §6's
  (b)-vs-(c) separation, done right, in one module.
- **Wiring:** `api/main.py:4874-4884` — under `BRAIN_PACK_ENABLED`, `brain_sync.on_install(lambda: _brain_kb.reindex())`
  then `start_background_sync()`, and `UCT_INTEL_PATH` is auto-set to `brain_dir()` when unset.

**INTERPRETATION.** Retrieval is the healthiest layer in the stack: one model, one store,
incremental, self-invalidating, timeout-bounded, and honest about emptiness.

**RELEVANCE TO UCT.** ⛔ **But it returns untyped text.** C6-02 §2 is decisive about the
consequence: *"A tool that returns a plain string in a `tool_result` is exactly as
unattributable as a stuffed pack. Adding tools buys better selection; it buys provenance only
if the return value is typed."* `ask_the_brain` already carries `source` per passage — the
field a citable block format needs. Typing that return value is the cheapest available step
toward P5, and it changes a return shape, not a tool list.

**CONFIDENCE.** 🟢 on the module. 🔴 on whether the index is populated in production — index
row counts live on the production volume and were not read.

### 1.4 The report-card exam and its recorded baseline

**OBSERVATION.** There is a runnable graded exam with deploy-gate exit codes, and its bars are
**the first honest run's numbers, stated as such** rather than tuned to pass.

**EVIDENCE.** `api/services/compass_eval/golden_set.py`, read this pass:
- `:15-21` `RUNG_BARS` — per-question axis minimums (correctness / grounding / opinion / safety)
  per rung.
- `:43` `RUNG_PASS_BARS = {1: 6, 2: 6, 3: 0, 4: 0, 5: 0}` and `:47`
  `BASELINE_LABEL = "2026-07-02 v2 baseline (12/50)"`.
- ⭐⭐ `:24-42` is the most reusable comment in the AI stack, and it is about gate design, not
  about AI: *"The gate this replaced demanded `passed == questions` for EVERY selected rung —
  50/50 against a 12/50 baseline. It was unconditionally exit 1, so it got routed around, and a
  gate that cannot pass is worse than one that cannot fail: it trains people to bypass gates."*
  Plus the ratchet rule: *"raise a bar when a real run proves a rung holds a higher number.
  NEVER lower one to turn a red run green."*
- ⭐ `:57-66` `rung_question_counts()` derives the per-rung question count **from the golden set**
  with the reason stated: *"never restated here (a hand-typed count is how the bars would drift
  away from the set they grade)."* `required_passes()` (`:69`+) scales a bar **down** for a
  partial run so `--rungs 3` cannot recreate a can-never-pass gate one size smaller.
- Exit contract: `scripts/run_report_card.py` returns `1` (`:127`, `:163`), `2` (`:135`),
  `3` (`:166`), `0` (`:157`, `:168`), `sys.exit(main())` at `:172`. ⭐ The `--offline` branch
  prints its own disclaimer at `:152-157` — *"This exit code is not a verdict"* — because a
  stubbed run once made the exit code stop meaning anything.
- Mechanical checks: `api/services/compass_eval/checks.py:114 run_mechanical_checks(transcript)`
  over a regex battery at `:35-71`, including `_PRICE_RE` (a quoted price with no supporting
  tool result), `_GO_VERDICT_RE` at `:58` marked *"case-sensitive on purpose"*, and
  add-verdict/mute/averaging-down probes.
- The sibling exam: `api/services/ai_search_eval/runner.py:43 SEARCH_RUBRIC` and
  **`:412 run_grounding_audit(...)`** — D-12 §4 calls this *"the finding most worth carrying
  forward"*: it measures which retrieval packs fire, deterministically, with **no provider call
  and no judge**.

**INTERPRETATION.** The exam's value to Terminal-Next is not the score. It is three
transferable rules: a bar that can fail *and* can pass; counts derived from the artifact they
grade; and **retrieval measured free before answer quality is paid for**.

⛔ **The recorded baseline is 12/50 and is a claim about 2026-07-02.** `RUNG_PASS_BARS` has not
moved off it in the source read this pass, and `test_report_card_gate.py` pins the declared
total so a silent edit reds. Whether a run today would score higher is **not measured** — no
exam was run by this pass or by any input report.

**RELEVANCE TO UCT.** 🔴 **The exam has a hole both C6-02 and the repo's own lessons name and
nobody has closed:** neither report card contains a fixture where **the correct answer is a
refusal** [C6-02 §6]. Without it, *"we improved the answers" and "we made it more willing to
invent" are the same score movement.* Terminal-Next's first AI exam work is that fixture class,
before any new question.

**CONFIDENCE.** 🟢 on the harness (source). 🔴 on any current score.

### 1.5 Every flag that gates them — and why this section cannot be trusted as state

**OBSERVATION.** There are three artifacts about AI flag state and **none of them is the running
process.**

**EVIDENCE.**
1. **Code defaults** (a CLAIM about nothing but the default): `coach_chat_tools.py:1841`
   `BRAIN_TOOLS_ENABLED` default `"0"` · `api/routers/ai_search.py:1845`
   `AI_SEARCH_CLAUDE_SYNTH` default `"0"` · `:619` `AI_SEARCH_AGENT_AUTOROUTE` default `"0"` ·
   `:1839` `_SYNTH_CAP_DEFAULT = 5.0` · `:1895` `AI_SEARCH_SYNTH_MODEL` default
   `claude-sonnet-5` · `api/services/journal_two/compass_cost_guard.py:37`
   `COMPASS_COST_CAP_DAILY` default `"0"` · `api/services/ticker_explain.py:160-163`
   `TICKER_EXPLAIN_MODEL` default `claude-sonnet-5`, `TICKER_EXPLAIN_COST_CAP_DAILY` default
   `10.0` · `api/main.py:4874` `BRAIN_PACK_ENABLED` default `"0"`.
2. **The ledger — `docs/feature_flags.json`** — which records **intent**. Statuses read this
   pass: `BRAIN_TOOLS_ENABLED` **armed**/`web` · `BRAIN_PACK_ENABLED` **armed**/`web` ·
   `AI_SEARCH_DOSSIER_ENABLED` / `_MEMORY_` / `_PERSONAL_` **armed**/`web` ·
   `COMMUNITY_ASK_ENABLED` **armed**/`web` · `RESEARCH_TECHNICAL_TAB_ENABLED` **armed**/`web` ·
   `RESEARCH_FLOW_TAB_ENABLED` present with a flip note · `THEME_ENGINE_ENABLED`,
   `AWARENESS_ENGINE_ENABLED`, `COMPASS_AUTOMATION_ENABLED` **armed**/`web` ·
   `ASKAI_WISDOM_RETRIEVAL_ENABLED` **dark**, `where: []`. ⛔ **Read the ledger for the roster;
   the AI-adjacent subset was derived by matching key names this pass and is not retyped here.**
3. **The live read — ORCH-RAILWAY-01** (`02-data-providers/railway-flag-state.md`, dated
   **2026-09-02**, `railway variables --service web --json` in the owner's linked CLI). L39
   records, on `web`: **`AI_SEARCH_CLAUDE_SYNTH=1`** · **`BRAIN_PACK_ENABLED=1`** ·
   **`BRAIN_TOOLS_ENABLED=1`** · **`COMPASS_MENTOR_MODE=admin`** · `COMMUNITY_ASK_ENABLED=1` ·
   `AWARENESS_ENGINE_ENABLED=1` · `COMPASS_AUTOMATION_ENABLED=1` · `THEME_ENGINE_ENABLED=1` ·
   **`PATTERN_VISION_ENABLED=0`** · **`CATALYST_OPUS_MODEL=claude-sonnet-4-6`**. And **absent
   from that service's key list at L29**: `AI_SEARCH_AGENT_AUTOROUTE`,
   `COMPASS_COST_CAP_DAILY`, `LLM_BATCH_ENABLED`, `COT_NARRATIVE_ENABLED`,
   `ASKAI_WISDOM_RETRIEVAL_ENABLED`, `TICKER_EXPLAIN_MODEL`, `TICKER_EXPLAIN_COST_CAP_DAILY`.

**INTERPRETATION — four consequences, and the first two close D-12's biggest open questions.**

- ✅ **D-12's headline open question is answered: `AI_SEARCH_CLAUDE_SYNTH=1`.** D-12 §2b asked
  *"Is `AI_SEARCH_CLAUDE_SYNTH` on in production? If it is `"0"` as the code defaults, every
  member AI-Search answer today is written by Perplexity `sonar-pro`, not by Claude."* The live
  read says `1`. **Claude writes the answer**, which is what the licensing analysis and the
  voice work were both waiting on.
- ✅ **`BRAIN_TOOLS_ENABLED=1`: the brain tools are armed on BOTH surfaces in production** —
  so §1.1's facade is not dark, and `grade_ticker` is a registered tool a model can call.
- ⛔ **But `COMPASS_MENTOR_MODE=admin`, so the ENFORCED verdict protocol reaches admins only.**
  `grade_ticker` being callable and the `§11` protocol making it *unskippable* are two
  different facts; the second is admin-gated. A member asking "should I buy X" today is not
  guaranteed to be routed through the computed verdict.
- ⛔⛔ **`COMPASS_MENTOR_MODE` IS NOT A KEY IN THE FLAG LEDGER.** Measured this pass: the string
  occurs twice in `docs/feature_flags.json` and **both occurrences are inside other flags'
  `note` prose**, citing it as the precedent for the `0`/`1`/`admin` idiom. The flag that decides
  whether the unskippable trading verdict reaches members **has no ledger entry of its own** —
  no declared default, no exposure, no owner decision, no flip history. This is
  `project_feature_flag_ledger`'s exact failure: *off-and-unset is indistinguishable from
  off-on-purpose*, one level worse, because here the live value is `admin` and nothing in the
  repo records that anyone chose it.

⚠️⚠️ **AND THE LIVE READ IS 23 DAYS OLD, WHICH MATTERS MORE THAN USUAL HERE.** It predates
`ticker_explain.py` (file mtime **2026-09-18** in this tree), so the newest member-facing AI
surface's flags **could not have appeared in it**; and the repo's own CLAUDE.md records
`RESEARCH_FLOW_TAB_ENABLED` being flipped on **2026-09-24 ~19:24 UTC**, after the read. A flag
table quoted from a dated document is a claim about that date — the defect `fixed-modular-hybrid.md`
§7 corrected itself for twice in one hour.

**RECOMMENDATION.** Before ARCH-05 closes, run `tools/flag_ledger_audit.py` against the live
services (it exits 2 for "did not look") and **give `COMPASS_MENTOR_MODE` a ledger entry with a
dated `owner_decision`** — the mechanism `DESK_PUBLIC_SHOWS` already has, for the same reason.

**CONFIDENCE.** 🟢 that these artifacts say what is quoted. 🔴 that any of it describes the pod.

### 1.6 ⭐⭐ I1 already shipped the contract — and its own spec's line numbers have drifted

**OBSERVATION.** `api/services/ticker_explain.py` is the newest and by far the most constrained
member-facing AI surface, and it implements the target architecture of §4 in running code.

**EVIDENCE — all re-measured in `_merge-master` this pass.**

| Contract piece | Where, at `3b4140d46` |
|---|---|
| Domain selection is deterministic, **before** any model call | `_classify_domains` `:325` · `_resolve_domains` `:376` |
| Evidence assembled into one bundle, each item with a stable citable `id` | `_build_evidence` `:1031` |
| **Closed** member-facing vocabulary | `_DOMAIN_LABEL` `:2074` |
| Five response states, defined once | `_RESPONSE_STATES` `:1186` |
| Decisive-verdict language blocked **mechanically** | `_decisive_language_flags` `:1581` |
| The union of every model-authored free-text field | `_full_answer_text` `:1973` |
| The blocking gate, run after the model and before the caller sees anything | `_grounding_flags` `:1988` |
| A retry note naming exactly what failed | `_retry_note` `:2053` |
| Refusal reason **derived** from the evidence gap | `derive_refusal_reason` `:2090`, used as a *fallback* in `_result` `:2121` |
| Model + budget are env-named with stated defaults | `MODEL_ENV`/`DEFAULT_MODEL = "claude-sonnet-5"` `:160-161` · `COST_CAP_ENV`/`DEFAULT_COST_CAP_USD = 10.0` `:162-163` · `_EFFORT` `:167` |
| Spend is ledgered to the shared durable guard, checked **before** the call | `_COST_SURFACE = "ticker_explain"` `:164` · `guard.over_budget(...)` `:2206` · `guard.record_from_response(...)` `:2047` |
| The member door | `POST /api/research/explain/{sym}` — `api/routers/research.py:121-122` |
| The renderer primitives it must compose | `app/src/components/provenance/` — `Cited.jsx`, `CoverageLine.jsx`, `FreshnessBadge.jsx`, `Provenance.jsx` (+ `availabilityContract.js`, `freshnessContract.js`, `sessionStale.js`) |
| The boundary, as a running check | `app/src/pages/research/i1S8Boundary.test.js` |
| The mount | `app/src/pages/research/ResearchPage.jsx:21, :186` |

The I1 spec states the two rules that make this a *contract* rather than an implementation
[I1-SPEC Part 2, Part 3]: the grounding check runs on the **union** of every free-text field —
*"a decisive verdict or a fabricated number hidden in `caveat`/`clarification_question`/
`refusal_reason` must be caught exactly like one in `summary`/`interpretation`/`key_facts`"* —
and `derive_refusal_reason` is a **fallback only**, because the first version overwrote every
refusal unconditionally and *"a cost-budget refusal ('usage limit') became 'nothing was
retrieved', telling a member there's no data when the truth is the service stopped spending."*

**⚰️⚰️ AND HERE IS THE FINDING THIS TABLE EXISTS TO PRODUCE. The I1 spec was written on
2026-09-23 against the `s7-price-level` worktree, and by 2026-09-25 seven of its nine cited
line numbers had moved:**

| symbol | I1-SPEC says | measured, `_merge-master` |
|---|---|---|
| `_classify_domains` | `:325` | `:325` ✅ |
| `_resolve_domains` | `:376` | `:376` ✅ |
| `_build_evidence` | `:1017` | **`:1031`** |
| `_RESPONSE_STATES` | `:1172-1173` | **`:1186`** |
| `_decisive_language_flags` | `:1567` | **`:1581`** |
| `_full_answer_text` | `:1959-1971` | **`:1973`** |
| `_grounding_flags` | `:1974-2007` | **`:1988`** |
| `_DOMAIN_LABEL` | `:2060-2064` | **`:2074`** |
| `derive_refusal_reason` | `:2076` | **`:2090`** |

⛔ **Nothing is wrong with the spec** — it was accurate against the tree it read, and it says so.
The point is that **a contract carried in `file:line` prose decays in two days**, which is why
§4.2's first requirement is a *derived* rail rather than a *documented* one. The repo has
already paid for this exact shape twice: CLAUDE.md's single-writer index (*"the in-file comment
it pointed at listed A–D with line numbers that had drifted 2,300–4,700 lines"*) and the
`components/ui/` roster the consistency audit named for components that do not exist.

**INTERPRETATION.** ARCH-05 is not a design problem. It is a **generalisation-and-railing**
problem, and the thing to generalise is already running behind a member door.

**RELEVANCE TO UCT.** Terminal-Next's AI panels adopt `ticker_explain.py`'s shape — a named
domain, a deterministic fetcher, an evidence shaper giving every fact a citable id, added to a
closed label vocabulary — and **do not force-fit Compass's tool-calling pattern onto a job that
never needs the model to choose what to fetch** [I1-SPEC, its own correction to the roadmap's
framing].

⚠️ **One asymmetry worth an owner decision, measured not inferred:** `POST /api/research/explain/{sym}`
is gated `Depends(get_current_user)` (`research.py:122`) while `POST /api/ai-search` is gated
`Depends(require_paid)` (`ai_search.py:2614`). Two member-facing LLM lanes, two different
gates, both spending the firm's budget. D-12 §1 records the corollary from `ai_search.py`'s own
docstring: *"the per-user daily cap is NOT this gate — a cap on free usage is a budget for
giving the product away."*

**CONFIDENCE.** 🟢 on every row of both tables (opened this pass). 🔴 on whether the surface is
armed in production — its flags do not appear in the 2026-09-02 read (§1.5).

---

## 2. The cost doctrine, as it actually stands

**OBSERVATION.** The doctrine is settled and it is **not** "spend less". It is: **a model is
NEVER downgraded for cost; caching and batching are the cost lever.**

**EVIDENCE.**
- The ruling: `12-decisions/DECISION_CARDS_2026-09-26.md:144-148` (CARD 14) —
  *"The cost-doctrine half is answered by an existing ruling, not an open question:
  `project_llm_cost_doctrine` is explicit that a model is **never downgraded for cost**, and the
  AI lanes already run on API keys with the 15 guard constraints E-06 supplies. There is no
  unknown left in this row — only architecture work (gate item 22), which is a deliverable, not
  a gate on knowledge."* Its reversal condition is *"a licensing term surfacing that bars AI
  processing of a provider's data specifically, which would reopen CP-03 first."*
- The propagated glyph: `00-program-control/CRITICAL_PATH.md:16` — CP-10 🟢 **RESOLVED**.
- E-06 applies the doctrine as a *pricing* rule, and says so where it would be most tempting to
  break: *"**Not a sensitivity, and stated so nobody makes it one:** model tier. Sonnet 5 in
  place of Opus 5 on F3/F4/F6 would remove ~45% of the six-feature bill. The doctrine forbids it
  as a cost move"* [E-06 §4.4]. And on the natural-language screen it prices Opus 5 at the
  measured $0.227/call rather than proposing a cheaper model: *"The cost model does not get a
  vote; it only shows that this one row is 27–34% of the six-feature bill"* [E-06 §2 F4].
- The lever that IS permitted: E-06 §1.2 — Batch API ×0.5, prompt cache (read 0.1×, 5-minute
  write 1.25×), pre-warm, and the codebase's own **generate-once + skip-if-stable + serve-many**
  idiom. ⛔ Their measured effect is **12–25%**, not 50%, *"because two of the three scaling
  lanes (F4 and the ask box) are request-path work a member waits on — Batch is unavailable to
  them by construction."*
- ⛔ The trap that comes with the lever, already fixed in three guards and stated as constraint
  3 in §3: turning caching on without teaching the guard **loosens the cap**. Verified live at
  `compass_cost_guard.py:60-63`, which bills `cache_read` at `×0.1` and `cache_creation` at
  `×1.25` explicitly.
- ⚠️ **One live value sits in tension with the doctrine and is an owner question, not a
  finding:** `CATALYST_OPUS_MODEL=claude-sonnet-4-6` on `web` [ORCH-RAILWAY-01 L39] — a
  Sonnet-class model under an "OPUS" variable name. ORCH-RAILWAY-01 L53 and E-06 §7 both route
  it to **OI-14** rather than calling it a downgrade.

**INTERPRETATION.** The doctrine removes exactly one design freedom (model tier as a cost dial)
and grants two (caching, batching). It does **not** answer how much may be spent in total —
see §6.

**RELEVANCE TO UCT.** Every §4 proposal is priced at its quality tier and bounded by a
population ceiling. No §4 proposal reaches for a cheaper model.

**CONFIDENCE.** 🟢 — a dated ruling plus an accepted cost model.

---

## 3. E-06's fifteen guard constraints — enumerated from E-06 §6

⛔ **These are E-06's, not this document's.** They are reproduced because ARCH-05 is the
deliverable that inherits them; the wording is E-06 §6's, condensed, with its own rationale
pointer kept. The right-hand column is **this pass's measurement of whether shipped code
already satisfies it** — that column is new and is cited.

| # | Constraint (E-06 §6) | Satisfied today? |
|---|---|---|
| 1 | **Population ceiling first, per-user allowance second.** Every member-reachable lane carries an ET-day USD ceiling sized `N × allowance + scheduled_reserve`, re-derived at each scenario boundary; the per-user cap is the anti-abuse rail beneath it | 🔴 **No.** Per-user caps sum to ~$610–650/member/month [E-06 §4.3]; global caps sum to ~$68/day [§5.1] |
| 2 | **Durable ledger for any lane a member can reach** — a volume table, ET-anchored, `spend_today = max(durable, in-process)` so a failed write tightens rather than uncaps | 🟡 **Partly.** `narrative_cost_guard` is durable and is what `ticker_explain.py:2047` records into; `compass_cost_guard` is in-memory by design (`:37`+) |
| 3 | **The guard consumes `usage` cache fields** — `record_from_response`, never `record(input_tokens=…)`; reads 0.1×, writes 1.25× | ✅ **Yes**, at the sites read: `compass_cost_guard.py:60-63`; `ticker_explain.py:2047` |
| 4 | **One price table, one pinning test.** Unknown model → the priciest known rate, never $0; a fallback that is too punitive is also a defect | 🟡 **Improved, not closed** — see the RG-12 re-measurement below |
| 5 | **Count requests, not only tokens.** Perplexity bills per request; Anthropic bills web search per call | 🔴 **Not determined** — E-06 §5.4 records that whether the Perplexity per-request fee is ledgered was never read |
| 6 | **A scheduled reserve on every shared budget, and a named owner per lane** — absolute floor where a member surface silently depends on the scheduled lane; fraction where the scheduler is the guest | 🟡 **Two lanes only** — `ai_search_deep` (fraction 0.6) and `catalyst/cost_guard` (absolute $6) [E-06 §5.3] |
| 7 | **Reservation, not a floor test, at the per-user gate** for any lane whose single call exceeds ~10% of the allowance | 🔴 **No** — `definition_concierge.py:142-146` documents a 159% overshoot |
| 8 | **Batch anything a warmer generates; generate-once + skip-if-stable + serve-many keyed by (symbol, facts hash) for anything per-symbol.** A pre-market batch needs a synchronous fallback | 🔴 **One consumer** — D-12 §2c: `call_recap_warmer` only, of five qualifying warmers |
| 9 | **A stated timeout on every call**, enforced by the existing census rail | ✅ **Yes** at the sites read — `brain_kb_service.py:77` `timeout=20.0`; rail `tools/llm_timeout_census.py` |
| 10 | **Member traffic on the API key, never the subscription seat** | ✅ **Yes** — D-12 §5e: twenty modules read a provider key, `grep` for `claude -p` across `api/`, `scripts/`, `tools/` returns zero; the one seat-backed lane is off-box and producer-side |
| 11 | **Model routing through one registry, not ~40 env vars** — the cost guard should read the same registry | 🔴 **No** — D-12 §2b: routing is per-surface env vars, *"a tier migration is ~40 edits"* |
| 12 | **Price the 4.7+ tokenizer** — budgets calibrated on Sonnet 4.6 or characters ÷ 4 under-count Opus 5 / Sonnet 5 by ~30% | 🔴 **Not determined** — no calibration artifact was found |
| 13 | **Ground the expensive lanes on cheap, licensable inputs** — desk-grounded on EOD + derived facts is both cheaper and licensing-safer | 🟡 **A design instruction**, and the one §4.2 adopts |
| 14 | **Cost telemetry per lane on an admin surface, with a `surface` tag in the ledger** so scheduled-vs-member is a query, not an assumption | 🟡 `_COST_SURFACE` exists per lane (`ticker_explain.py:164`); whether the split is queryable was not read |
| 15 | **A refusal names who spent the money** — distinguish "you reached your allowance" from "the desk's budget is spent today" | 🟡 **The mechanism exists** (`may_member_spend`) and I1 preserves a caller-supplied reason for exactly this case (`ticker_explain.py:2121`, and I1-SPEC Part 3's recorded regression) |

### 3.1 ⚰️ RG-12 re-measured at `3b4140d46` — one authority FIXED, three still open

E-06 §5.2 found **six price authorities over one value, one pinned by a test, and the
2026-08-30 Sonnet-5 fix landed in one.** Re-read this pass:

| # | Table | Measured 2026-09-25 | vs E-06 (2026-09-02) |
|---|---|---|---|
| 1 | `narrative_cost_guard._PRICES` `:64-68` | `claude-opus-5 (5.0, 25.0)`, `claude-sonnet-5 (2.0, 10.0)`; unknown model → **max output rate** (`:163`) | unchanged, still correct, still the only one with a rail (`tests/test_narrative_cost_guard_prices.py`) |
| 2 | `catalyst/cost_guard._PRICING` `:38` | **`claude-sonnet-5: {"input": 2.0, "output": 10.0}`** — corrected, with the reason in-file at `:27` dated **2026-09-22 (PACKET-R)** | ✅ **CLOSED.** E-06's *"still mis-priced … the $8/$15 caps fire early"* is now stale |
| 3 | `flow_explain._PRICING` `:86-91` | **still no `claude-sonnet-5` / `claude-opus-5` entry**; `_FALLBACK_PRICING = (15.0, 75.0)` `:92`; `FLOW_EXPLAIN_MODEL` default `claude-opus-4-8` `:104` | unchanged — fails **safe**, and still trips at a third of its intended spend the day the model moves to a 5-series id |
| 4 | `pattern_vision/orchestrator._PRICE` `:20` | single entry `{"claude-opus-4-8": (5.0, 25.0)}` | unchanged; `PATTERN_VISION_ENABLED=0` on `web` |
| 5 | `voice_cost_service` `:5`, `:27` | `gpt-realtime` documented as *"$0.06/M input, $0.24/M output"*; `MODE_C_USD_PER_MINUTE = 0.30` | unchanged — and E-06 §3.2 puts the vendor page at **$32/$64 per 1M audio tokens**, three orders of magnitude apart. This is still *"the least trustworthy number"* in the cost model |
| 6 | `compass_cost_guard` `:17-18` | `_IN_PER_MTOK` / `_OUT_PER_MTOK` default **3.0 / 15.0** (Sonnet 4.6), env-overridable | unchanged — correct for today's `coach_chat` default and wrong the day the lane moves, with nothing linking the two |

⭐ **The interesting thing is which one got fixed.** Table 2 was fixed in a dated, named packet
three days ago; tables 3–6 were not, because **only table 1 has a rail**. Constraint 4 is
therefore not "fix the tables" — it is *"one module, one pinning test"*, and the evidence that
the constraint is right is that the unrailed copies drifted while the railed one did not.

---

## 4. The target architecture for Terminal-Next

⚠️ **This section is constraints, not a build.** Nothing in it has been implemented or measured
in a Terminal-Next shell; no such shell exists. Each item names the shipped precedent it
generalises, so none of it is invented.

### 4.1 Where AI sits relative to panels

**AI is a panel-scoped capability plus exactly one ask surface. It is never a panel type of its
own, and never a second chat.**

- ⭐ **The pattern already shipped and should be inherited unchanged.** D-12 §1 measured it:
  the earnings modal (`AskAiSection.jsx`) and the notebook (`AiSearchEmbed.jsx`) both
  **compose `AiSearchWidget`** rather than growing a second chat, and `AskAiSection.jsx:5-13`
  says so explicitly. One ask-box component, scoped by the surface that mounts it.
- **Terminal-Next's board follows C5-03's hybrid lock** [`06-ux-and-information-architecture/fixed-modular-hybrid.md` §0]:
  fixed pages own market-wide questions, one composable board owns portfolio-specific ones.
  An AI answer is therefore **scoped to whatever a panel is already about** — the symbol, the
  scan, the position — not to a free-floating conversation.
- ⛔ **The scope object is the gap, and it is the one genuinely new piece of plumbing.**
  D-12 §8 Gap #1: the voice path has a page-context contract (`setVoicePageHint` →
  a `"=== CURRENT PAGE ==="` block) and *"the typed ask box has only a symbol scope"*. A board
  that can hold N panels needs **one page-context contract both lanes read**, not two.
- ⛔ **A panel-scoped AI answer inherits C5-03's §6 standing invariant**: a boundary per panel,
  the close control outside it, and a mount cap. An AI panel is the *most* likely to throw
  (a provider 500, a budget refusal, an empty evidence bundle) and therefore the least
  acceptable place to lose the close control.
- **Registry membership, not a new host:** D-06 §1.1's recommendation is to *"add a
  `menus.terminal` flag rather than forking the registry"*. An `aisearch` widget is already a
  registry entry.

🟡 **CONFIDENCE.** The composition pattern is measured and shipped; the shared page-context
contract is a proposal with no implementation.

### 4.2 What grounding is required before any member-facing answer

**Five requirements. The first four already exist in `ticker_explain.py`; the fifth does not
exist anywhere.**

1. **Evidence is assembled deterministically, before the model runs.** Named domains, each with
   its own fetcher and shaper, every fact carrying a stable citable id, and a **closed**
   member-facing label vocabulary. Precedent: `ticker_explain.py:325`, `:376`, `:1031`, `:2074`.
   The file's own comment states why the vocabulary must be closed: *"the sentence can only ever
   be assembled from these strings and a symbol, so it cannot carry a fabricated number or a
   Buy/Sell directive no matter what the model returned"* [I1-SPEC Part 1].
   ⛔ **Do not reach for a tool registry where the model does not need to choose what to
   fetch.** I1-SPEC's own correction to its commissioning roadmap is the rule.
2. **The gate is post-generation, BLOCKING, and runs over the UNION of every model-authored
   field.** Precedent: `_full_answer_text` `:1973` → `_grounding_flags` `:1988`, four checks,
   any flag triggering a retry with `_retry_note` `:2053` naming what failed. ⛔ **A field added
   later without being folded into the union is a hole** — the earlier version of this idea
   *"never read the refusal sentence, so a fabricated number inside a refusal passed every
   mechanical check"* [I1-SPEC Part 2].
3. **Numbers the desk computes are handed to the model, never asked of it.** C6-02 §4 is
   unambiguous that no citation mechanism in the field binds a claim to a *computed* value, so
   facts-first is the only available answer for breadth, exposure, flow aggregates and heat.
   Precedent: `flow_explain` (*"the model only narrates them — it can never invent numbers we
   didn't hand it"*), `cot_narrative`'s store-nothing gate, `grade_ticker`'s computed verdict
   [D-12 §3c, §6].
4. **Absence is declared, not silent.** `ai_search.py` appends to `meta["grounding_gaps"]`
   (`:2090`, `:2128-2129`, `:2157`, `:2172`, `:2180`) and puts them in the prompt at
   `:2203-2206`, with the reason D-12 §3a quotes: *"Silence reads to the model as 'the desk
   didn't mention it', and it invents flow."* One symbol answering suppresses the gap, because
   declaring a gap while handing over real data for the other name would be a second lie.
5. 🔴 **The session clock must be a stated, gate-checkable fact — and today it is nowhere.**
   C6-02 §5 measures four distinct clocks and finds freshness handled *"everywhere as a
   retrieval filter and nowhere as a stated fact in the prompt"*. D-12 §3d found no time or
   market-status block in the widget system prompt, with freshness carried by cache salting and
   a deliberate in-code note that *"Today is deliberately excluded: the live quote pack already
   answers it."* ⛔ **That reasoning is sound for price and insufficient for session**: a quote
   pack answers "what is it now", not "what does now mean". The requirement is one injected
   block — ET wall clock, session (`pre`/`RTH`/`post`/`closed`/`half-day`), minutes since the
   last boundary, and the as-of of each pack — precisely because **a grounding gate can check
   it**. ⚠️ And its anti-pattern is already live elsewhere in the repo: C6-02 §5 warns against
   *"caching a prompt prefix that contains market state for longer than the state lasts"*, and
   `ai_search.py:1890` caches the system prefix.

⛔ **And one requirement about the requirements themselves: the contract is RAILED, not
DOCUMENTED.** §1.6 measured seven of nine `file:line` citations in the I1 spec drifting in two
days. The rail that exists is `i1S8Boundary.test.js`, and it is the right shape for the reason
its own header gives: *"Phase 2's adversarial validation found S8 and I1 BOTH claiming
ownership of 'the one provenance renderer' … The fix was a paragraph in an architecture
document. **A paragraph cannot fail, so it is not a boundary.**"* It parses an **AST**, never a
grep, and derives its forbidden vocabulary from S8's own component names so a fifth primitive is
guarded the day it lands. ⭐ **Extend that rail's roots; do not write this section again.**

🟡 **CONFIDENCE.** 🟢 that requirements 1–4 exist and where. 🔴 on requirement 5 — not built,
not costed, and its half-day/holiday case is C6-02's own open question (*"on 27 November 2026 the
market closes at 1:00 p.m. ET. Does any AI surface in the benchmark set — or in UCT — know
that? Nothing found either way."*)

### 4.3 How a refusal or a low-confidence answer is surfaced

1. **A fixed, small set of named states, coerced — no sixth state, no free-text status.**
   Precedent: `_RESPONSE_STATES` at `ticker_explain.py:1186` — `answer`, `answer_with_caveat`,
   `partially_answer`, `ask_for_clarification`, `refuse`.
2. **The refusal names what is missing, and the name is DERIVED.** `derive_refusal_reason`
   `:2090` builds the sentence from which domains were requested and which came back empty,
   over the closed vocabulary — *"never a model-authored explanation of its own refusal"*
   [I1-SPEC Part 3].
3. ⛔ **Enrich a refusal that says nothing; never overwrite one that already says something
   specific.** `_result` `:2121` calls the derivation only as a fallback, and I1-SPEC Part 3
   records the regression that taught it: a budget refusal ("usage limit") was rewritten as
   "nothing was retrieved", *"telling a member there's no data when the truth is the service
   stopped spending."* This is constraint 15 in §3, arriving from the product side.
4. **Three outcomes stay three, at every layer.** C6-02 §6: *"we retrieved and it says X"*,
   *"we retrieved and there is genuinely nothing"*, *"we failed to retrieve"*. Collapsing the
   third into the second *"= a lie a member will act on"*, and the repo has the incident: the
   `.catch(() => null)` idiom rendered *"No recent news for this ticker."* against NVDA while
   the endpoint returned 15KB of headlines [D-12 §6]. ⛔ **`sectionFetch.js` is the fix and
   D-12 names six sibling call sites that never migrated.** Any Terminal-Next surface that can
   render "we hold nothing" uses that fetcher.
5. **The receipt idiom for a short result set is `CoverageLine`, and it must not be collapsed.**
   FOUR counts — evaluated · answered · dropped · not computable — because *"we could not
   compute it"* and *"something broke"* are different facts to a trader; a screen that silently
   loses symbols *"returns fewer hits and looks like a quiet market"* [repo CLAUDE.md, Phase E].
   `CoverageLine.jsx` is already one of the four S8 primitives.
6. **Rendering goes through S8's primitives or it is a finding** — `Cited`, `CoverageLine`,
   `FreshnessBadge`, `Provenance`, enforced by `i1S8Boundary.test.js`. This is C6-01 §2's
   highest-value transferable recommendation (*"provenance rendering should be a shared
   component every AI surface must route through, so a surface without citations is
   structurally impossible rather than merely discouraged"*) and FactSet's UI-invariant framing,
   which *"is enforceable in a way a prompt is not"*.
7. ⛔ **Never ship a mode switch that changes the provenance guarantee without changing the
   rendering** [C6-01 §10 anti-pattern 2]. If a Terminal-Next answer may ever draw outside the
   grounded corpus, **the label belongs on the sentence, not on the session.**
8. ⛔ **Never ship "no hallucinations" as a claim** [C6-01 §10 anti-pattern 1]. Two surveyed
   vendors do and both are contradicted by their own help centres.
9. ⚠️ **A refusal must be exam-visible.** §1.4's hole: neither report card has a fixture where
   the correct answer is a refusal, so an over-refusal and a fabricated absence are both
   invisible to the grade [C6-02 §6]. FailSafeQA's shape — deliberately empty and deliberately
   irrelevant context, scored on whether the system declines — is the cheapest transferable
   idea, and C6-02 adds the scoring rule: **Compliance and Robustness separately, never as one
   number.**

🟢 **CONFIDENCE** on 1–3, 5, 6 (shipped code, read this pass). 🟡 on 4 (the six unmigrated call
sites are D-12's measurement, not re-verified here). 🔴 on 9 — not built.

### 4.4 The budget guard

**One shape, and it is E-06 §6 constraint 1 with the arithmetic made explicit.**

- **Population daily USD ceiling per lane = `N × allowance + scheduled_reserve`**, re-derived at
  each scenario boundary (100 · 500 · 1,000 · 5,000 · 10,000). The per-user cap is the
  **second** rail, not the first.
- **The allowance is the number the owner steers with.** E-06 §4.3's worked example: at $200
  list and a 3% AI-cost target, **$6/member/month ≈ $0.28 per trading day** — *"comfortably
  above base usage on every lane except an Opus-5 screen a day."* ⛔ **That target percentage is
  OI-E06-04 and is not settled** (§6).
- **Reserve shape is chosen per lane, by who depends on whom** [E-06 §5.3]: an **absolute
  floor** where a member surface silently depends on a scheduled lane (a morning brief, the
  catalyst table); a **fraction** where the scheduler is merely a guest (weekly deep research).
  Neither idiom exists today on briefings, theme engine, desk insights, Compass or voice.
- **Durable, cache-aware, request-counting** — constraints 2, 3 and 5. The template is
  `narrative_cost_guard`; the counter-example is `compass_cost_guard`'s in-memory state
  (`:37`+), which is only defensible behind a durable per-user cap.
- **One price table with the pinning test**, and unknown-model → the priciest known rate.
  `narrative_cost_guard.py:163` already does the second half; §3.1 shows why the first half is
  the load-bearing part.
- ⛔⛔ **Two lanes have no population bound at all, and they are the two most expensive per
  active member**: Compass chat (`COMPASS_COST_CAP_DAILY` default `"0"` = disabled,
  `compass_cost_guard.py:37`, and absent from `web`'s key list in the 2026-09-02 read) and voice
  (`voice_usage` is per-user monthly only). E-06 §5.4 prices the consequence: **$400/member/month
  at Compass chat's own per-user cap.** Whether Terminal-Next re-hosts either is E-06's own
  closing open question and moves the all-in column by ±$2.70/member/month.
- **A refusal names who spent the money** (constraint 15), and I1's fallback-only derivation is
  the mechanism that keeps it true.

🟡 **CONFIDENCE.** The constraints are E-06's and traceable; the sizing depends on two numbers
nobody has (§6).

---

## 5. What would overturn this, stated before anyone relies on it

| # | Signal | Effect |
|---|---|---|
| 1 | A live flag read showing `BRAIN_TOOLS_ENABLED=0` or `AI_SEARCH_CLAUDE_SYNTH=0` on `web` today | §1.5's two "answered" questions re-open; the voice/text parity claim and the licensing analysis both change |
| 2 | A licensing term barring AI processing of a specific provider's data | Reopens CP-03 first, then CP-10 — CARD 14's own stated reversal condition |
| 3 | An owner cost ceiling (OI-10) below E-06's fixed base of ~$515/month Anthropic alone | §4.4's sizing is not a constraint problem but a scope problem; features get cut, not guarded |
| 4 | A measured report-card run materially above 12/50 on rungs 3–5 | The mentor-mode gate (`COMPASS_MENTOR_MODE=admin`) becomes a decision rather than a hold, and §1.5's fourth consequence becomes urgent |
| 5 | `ComparisonAskAi.jsx` (or any second AI surface) shipping its own citation renderer | §4.3's requirement 6 is already broken; I1-SPEC's own closing gap names this file as outside every boundary rail today |
| 6 | A measured member-cohort ask rate anywhere near E-06's F1 assumption (3 clicks/member/day vs the 1.7/day measured population-wide) | Every per-member figure in E-06 §1.1 moves; it is the widest-band assumption in the model |

---

## 6. ⛔ What this document does NOT decide

**Two questions bound *which member-facing AI is permitted*, and this document answers
neither. It is not entitled to.**

1. ✅ **Licensing — CP-03 — is RESOLVED, and that is a fact to be inherited, not re-litigated
   here.** `00-program-control/CRITICAL_PATH.md:9`: 🟢 resolved 2026-09-19/20, re-confirmed
   2026-09-23; Massive held at **Business/Enterprise**, FMP **DDLA confirmed to exist**,
   Finviz/Finnhub/AlphaVantage/Schwab confirmed; register effect *"of 118 rows, 18 stay
   Restricted (was 81), 76 Likely Allowed (was 7), 12 Unknown (was 18)"*. CP-03's question text
   explicitly covers *"derived use, and **AI processing** of FMP / Massive / Finviz / news
   data"*. ⚠️ **But four FMP-gated rows stay Unknown regardless of the DDLA** — E-06's cited
   OI-03 entry names them: *transcript AI, TheFly chain, an attribution clause, copyrighted-text
   AI*. **Whether a specific AI feature may process a specific provider's data is the licensing
   register's ruling, per row, not this document's.** ARCH-05 states the grounding contract; it
   does not classify an input.
2. 🔴 **The owner's cost ceiling — OI-10 — is UNKNOWN, and every ceiling in §4.4 is therefore a
   shape with no number in it.** `00-program-control/OWNER_INPUTS_REQUESTED.md:18` reads, in
   full, for the answer column: **"Unknown; cost model states every assumption and shows deltas,
   not absolutes."** E-06's own evidence ceiling says the same: the $515/month Anthropic figure
   is *"an owner Console read recorded in session memory on 2026-08-24, not re-read by me"*, and
   *"OpenAI and Perplexity spend are unaudited anywhere."*
   ⛔ **So this document does not choose which of E-06's six features ship, or at what
   adoption.** It says what each one must carry *if* it ships. Choosing costs a number nobody
   has.
3. ⚠️ **And the distinction that keeps getting collapsed, stated plainly: the cost DOCTRINE is
   settled and the cost CEILING is not.** CARD 14 rules that *"the cost-doctrine half is
   answered by an existing ruling, not an open question"* — a model is never downgraded for
   cost. That is not the same as knowing what the monthly ceiling is. CP-10 is 🟢 because no
   *knowledge* is missing for the architecture; OI-10 is still Unknown because a *number* is.
   Both are true. Quoting the first as though it answered the second is the error this clause
   exists to prevent.

**Also explicitly not decided here:**

* **No model or tier choice per lane.** E-06 §2 prices each; the quality bar is the owner's
  (OI-E06-01 names the natural-language screen's Opus-5-at-8,192 budget as exactly this kind of
  call). This document only forbids choosing a cheaper model *for cost*.
* **No ruling on whether Terminal-Next re-hosts Compass chat or voice.** E-06 §6's closing open
  question, worth ±$2.70/member/month.
* **No AI-cost-share-of-ARPU target.** OI-E06-04. It is the input that sets every population
  ceiling, and $6/member/month in §4.4 is E-06's illustration at 3% of $200, not a decision.
* **No P5 wire-format commitment.** C6-02 §2 establishes that Anthropic's `search_result` block
  is the available mechanism and that `source` accepts `kb://`-style identifiers; §4 establishes
  that half of P5 is a data-modelling job. **Whether computed metrics get addressable rows is
  C7-03's contract** (`domain-data-platform.md`), and C6-02 §4 says so itself.
* **No packs-vs-tools resolution as a cost decision.** C6-02 §2 dissolves the framing — the
  citation win belongs to the block format, not the agent lane — so the autoroute flag is not
  the fork it looks like. The remaining question is which selector, and it is not settled here.
* **No entitlement design.** Tool allowlists becoming a function of a plan is ARCH-06's
  territory (gate item 23); §4.1 only records that the current allowlist is a module constant.
* **No exam content.** §4.3 requirement 9 names the missing fixture class; writing the fixtures
  is work, not an architecture decision.

---

## GAPS

* **No live flag read.** This is the governing gap, and it makes §1.5 a statement about two
  artifacts rather than about production. `railway variables --service web --kv` settles it and
  is one command this contract does not permit.
* **`COMPASS_MENTOR_MODE` has no ledger entry** (measured: both occurrences of the string in
  `docs/feature_flags.json` are inside other flags' notes). So the flag deciding whether the
  computed trading verdict reaches members has no recorded owner decision. Filed here because
  it is a finding, not fixed here because the ledger is not this document's file.
* **No exam was run**, so the 12/50 baseline is quoted as the recorded baseline and nothing
  more. `scripts/run_report_card.py --rungs 3,4,5` with the flags on would settle whether the
  mentor-mode hold is still justified — and needs an `ANTHROPIC_API_KEY`, which this pass had no
  authority to spend.
* **`ticker_explain.py` was read at its contract points only** — the nine symbols in §1.6's
  table plus the cost and model constants. It is 120,939 bytes; the eight fetchers, the eight
  evidence shapers, `_evidence_numbers`/`_number_is_grounded`, and the conflicting-evidence
  check (I1-SPEC Part 2 check 4) were **not read line by line**. Anyone generalising the
  contract should read them before depending on their shape.
* **`_WIDGET_INTRO` was not read** — so §4.2 requirement 5's "no session block exists" inherits
  D-12 §3d's own caveat that it is an absence read over roughly two thirds of the system prompt,
  not a proof.
* **The Perplexity per-request-fee question is still open** (E-06 §5.4, constraint 5):
  `narrative_cost_guard.py:210-230` was not read by E-06 and was not read here either.
* **`entitlements.py` was not read this pass.** §4.1's recommendation that the allowlist become
  a function of a plan rests on D-12 §8 Gap #3's reading of it.
* **No latency figures exist anywhere.** D-12 §1a's latency classes are inferred from timeouts
  and cache TTLs; C6-02 §8's tiers are *"a taxonomy, not a measurement"*; no p50/p95 for any AI
  lane is recorded in any input or any file read here.
* **Nothing in C6-01 or C6-02 was observed running** — no competitor seat, no rendered
  citation. Both files state this ceiling themselves. So every "the field does X" claim here
  tops out at *what the vendor publishes*.
* **The `_merge-master` tree is not necessarily what production serves.** The scope line pins a
  SHA; no ancestry check against `origin/production` was run, because that is a git command this
  contract forbids.
* ⚠️ **CARD 14 is dated 2026-09-26 in a file written before 2026-09-25 ends.** The card is
  quoted verbatim with its own date; this document does not reconcile the calendar and does not
  treat the date as evidence of anything beyond what the file says.

## SOURCES

**Accepted program inputs (cited, not re-derived).**
* **D-12** `08-ai/existing-ai-systems.md` — §1 surfaces and gates, §2 lanes/models/tool
  registries/batch/caching/fallbacks, §3 retrieval and grounding (§3a declared gaps, §3c
  citation, §3d the missing clock), §4 the two exams and `--grounding-audit`, §5 the cost rails
  and §5c–§5e the price tables and the API-key doctrine, §6 safety and the `.catch(() => null)`
  incident, §7 scheduled AI, §8 the ten-row gap table.
* **C6-01** `08-ai/ai-native-tools-survey.md` — §0 the survey table, §2 the five-mechanism
  verification ladder and its two structural refinements, §9 abstention as a strategy, §10 the
  eight anti-patterns.
* **C6-02** `08-ai/grounding-architectures.md` — §1 the six patterns by where the bond is
  enforced, §2 the block format vs the tool call, §4 provenance for computed values, §5 the four
  clocks, §6 the three states that keep collapsing, §9 the "already have" column.
* **E-06** `09-security-licensing-cost/cost-model-ai-infra.md` — §1 the per-feature table and
  the levers, §2 the per-row assumptions, §3 the dated vendor prices and measured anchors, §4
  the ARPU crossover and the cap arithmetic, §5 the rail inventory and RG-12, **§6 the fifteen
  guard constraints reproduced in §3 of this document**, §7 the owner questions.
* **I1-SPEC** `08-ai/i1-tool-contract-grounding-refusal-spec.md` — Parts 1–4 and its closing
  gap. The single most load-bearing input, because its contract is running code.
* **C5-03** `06-ux-and-information-architecture/fixed-modular-hybrid.md` — §0 the hybrid lock,
  §6 the per-panel error-isolation invariant.
* **D-06** `07-technical-architecture/current-ui-architecture.md` — §1.1 the widget registry as
  a multi-host manifest.
* **ORCH-RAILWAY-01** `02-data-providers/railway-flag-state.md` — the 2026-09-02 live variable
  read, L29 (key names) and L39 (flag values), L53 (its own relevance notes).
* **Program control** — `00-program-control/MASTER_CHECKLIST.md:28` (this deliverable's row),
  `CRITICAL_PATH.md:9` (CP-03 🟢) and `:16` (CP-10 🟢),
  `OWNER_INPUTS_REQUESTED.md:11` (OI-03's four surviving Unknowns) and `:18` (OI-10 Unknown),
  `12-decisions/DECISION_CARDS_2026-09-26.md:136-152` (CARD 14).

**New measurement, this document** — `_merge-master` at `3b4140d46`, read 2026-09-25, all
read-only:
* `api/services/brain_service.py` — the facade, its sentinel, the regime map, the sizing caps.
* `api/services/brain_kb_service.py` — the retrieval index end to end.
* `api/services/journal_two/coach_chat_tools.py` — the catalog, its eight `update()` sites, the
  voice delegation, the `BRAIN_TOOLS_ENABLED` import-time gate, the preview/confirm/`elevated`
  shape.
* `api/services/voice_tools.py`, `api/services/ai_search_agent.py` — the registry and the
  read-only allowlist over it.
* `api/services/compass_eval/{golden_set.py,checks.py}`, `scripts/run_report_card.py`,
  `api/services/ai_search_eval/runner.py` — the exam, its bars, its exit contract, the free
  retrieval audit.
* `api/services/ticker_explain.py` + `api/routers/research.py` +
  `app/src/components/provenance/` + `app/src/pages/research/{ResearchPage.jsx,i1S8Boundary.test.js}`
  — the shipped contract and its renderer boundary.
* `api/main.py:4874-4884` — the brain-pack wiring.
* `api/routers/ai_search.py` — the paid gate, the synth/agent flags and caps, the
  `grounding_gaps` sites.
* `api/services/narrative_cost_guard.py`, `api/services/catalyst/cost_guard.py`,
  `api/flow_explain.py`, `api/services/pattern_vision/orchestrator.py`,
  `api/services/voice_cost_service.py`, `api/services/journal_two/compass_cost_guard.py` — the
  six price authorities, re-measured for §3.1.
* `docs/feature_flags.json` — flag statuses and the `COMPASS_MENTOR_MODE` absence.
