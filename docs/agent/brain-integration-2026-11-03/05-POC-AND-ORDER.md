# 5 — Proof of concept, complexity and order

## 5.1 The proof of concept: "Playbook, read-only, dark" (objective: Deliverable 8)

**Goal.** Show, with zero paid calls and no change to Compass, that the Agent can answer three knowledge-shaped questions from the firm's own material with provenance and floors, through its existing gateway and registry, on both planners.

**Scope (and nothing more):**

| Side | Files (all NEW unless marked) | Content |
|---|---|---|
| Server | `api/services/uct_agent/knowledge/__init__.py`, `kinds.py`, `policy.py`, `search.py`, `playbook.py`, `record.py`, `envelope.py` | three kinds: `knowledge.search` (FTS + existing cosine, policy-filtered, k ≤ 3, excerpt ≤ 500), `setup.playbook` (vocab + alias resolution, named refusal), `setup.record` (engine + team archive, floors, verdict) |
| Server | `docs/agent/knowledge/policy.json` | `policy_version: 1`; admissible families for the PoC: `trader_archive`, `setup_knowledge`, `self_review`, `manual`, `chart_intake`; categories: all but MACRO / REGIME / SECTOR; licence map; floors `n_min: 30`; trader map for the known variants |
| Server (agent-lead, 2 lines) | `marketdata/gateway.py:59-60` | `REGISTRARS += ("api.services.uct_agent.knowledge.kinds",)`, `CATEGORIES += ("knowledge",)`; optional `MAX_KNOWLEDGE_READS_PER_TURN = 3` in `read()` beside the scan cap |
| Server (agent-lead, 1 line) | `turn_v2.py:47` `_DOMAIN_OF` | `"knowledge": "data", "setup": "data"` so the `data` domain tool lists them (a dedicated `playbook` domain tool is a STEP-1 amendment for Wave 2, not the PoC) |
| Server | `api/services/uct_agent/knowledge/rules.py` + one hook in `turn.py` / `turn_v2.py` where `news.RULES` is appended | the ≈ 12-line rules block, appended only when a knowledge envelope was read this turn (same gate style as the NEWS block) — the one planner-adjacent edit, requested from agent-lead |
| Browser | `app/src/agent/capabilities/knowledge.js` | three QUERY capabilities on the `guide` target: `playbook.explain {question}`, `playbook.setup {setup}`, `playbook.record {setup, regime?}`; `kindServed` gating; `{text, table, link}` rendering with the source line and "Open in Setup Library"; `registerKnowledgeCapabilities()` called where `registerMarketFactsCapabilities()` is |
| Browser (agent-lead) | `contract/manifest.golden.json` | regenerated (the integrator regenerates on every capability registration per PROGRAM.md step 3) |
| Tests (free) | `tests/test_uct_agent_knowledge_*.py` (fixture pack: a 30-row `knowledge_base`, 3 templates, 2 `setup_performance` rows; `_fake_embed`), `app/src/agent/agentKnowledge.test.jsx` (panel harness; the three capabilities on the scripted model), one rail: no knowledge module imports `voice_*`, `coach_*`, `ai_search*` or the engine directly | ≥ 25 server cases (policy deny, floor withhold, named refusal, FTS-only path when embed raises, envelope validity, 2,000-char bound, stale pack note, injection fixture), ≥ 10 browser cases |
| Flags | `UCT_AGENT_KNOWLEDGE` (default off) + kinds listed in `UCT_AGENT_DATA_KINDS` | dark for everyone until the owner lists them; admin-only by `require_admin_dark` |

**Out of scope for the PoC:** statistics to members, `wire.today`, `trade.size`, examples with prices, the health report (V2–V4), the contradiction pass, any paid evaluation, any Compass / AI Search / Wisdom edit, any engine or pack change.

**Done when:** the fixture-backed suites pass in `agent-ci`; the three prompts ("what does UCT mean by an EP", "max stop on a tight flag", "how often does the U&R work") answer correctly on the scripted model on both planners; a Phase-1-style live check by the owner's session (`LIVE-TESTING.md` pattern, ≤ 10 turns, admin, the real pack) shows the source line, the verdict wording and the named refusal; p50 added latency ≤ 300 ms for FTS-only reads and ≤ 1.2 s with one embedding call.

**Rollback:** unset `UCT_AGENT_KNOWLEDGE` / remove the kinds from `UCT_AGENT_DATA_KINDS` (no restart needed: read per request); the capabilities are then unregistered and the manifest is byte-identical to today.

## 5.2 Complexity estimates

| Item | New code (est.) | Owner | Depends on | Effort |
|---|---|---|---|---|
| PoC (§5.1) | server ≈ 700 lines + tests ≈ 500; browser ≈ 300 + tests ≈ 250 | one builder (agent-kn) + agent-lead's 4 lines + manifest regen | D1, D2 | 3–5 days |
| Knowledge policy + health report + lints (V1–V3) | ≈ 400 + tests | agent-kn | PoC | 2–3 days |
| FTS table at reindex | ≈ 120 (inside the knowledge package; `brain_kb_service` untouched) | agent-kn (owner of `brain_kb_service` informed) | PoC | 1 day |
| Eval category 16, free half | 20 dev + 10 adversarial cases, checks, runner wiring | agent-qa + agent-kn | PoC | 2 days |
| Eval category 16, sealed + paid runs | 20 sealed cases written by a session that never sees the code; ≈ $2–4 per run | eval runner | D6, the $21 ledger | 1 day + budget |
| `trade.size` kind + capability (P5 input) | ≈ 200 + tests | agent-kn | D3; P5 spec | 1–2 days |
| `knowledge.examples` (admin) | ≈ 150 + tests | agent-kn | D19 for members | 1 day |
| `wire.today` / regime phase | ≈ 200 + a new ADR | agent-kn + agent-lead | D4 | 1–2 days after the ADR |
| Contradiction pass (V4) into the Wisdom review queue | ≈ 250 + tests | agent-kn (reads `wisdom.publish.review` through its API) | health report | 2 days |
| Pack manifest additive fields | ≈ 30 lines in `brain_pack_export.py` + 20 in the health hook | **partner** (uct-intelligence) + agent-kn | D5 | 1 hour each side |
| Dedicated `playbook` domain tool in v2 | STEP-1 amendment + ≈ 20 lines | agent-lead | Wave 2 | ½ day |
| P6 page adapters using the kinds | per page ≈ 60 lines | P6 builder | P6 | included in P6 |

Total to a Wave-2-ready, admin-activated knowledge layer (PoC → policy/health → eval free half → `trade.size`): **≈ 2,300 lines, 9–13 builder-days, 0 paid dollars**; the paid eval adds ≈ $10 across the wave.

## 5.3 Recommended order

1. **Owner decisions D1–D3** (D4–D6 can wait). Without D2 the PoC ships with team-owned sources only, which is the recommended default anyway.
2. **Integrator accepts the contract** (`contracts/KN-1-knowledge.DRAFT.md` → `docs/agent/program/contracts/KN-1-knowledge.md`, an ownership row for `uct_agent/knowledge/**` and `capabilities/knowledge*.js`, a BOARD section). Agent-lead lands the 4 one-line edits on `agent/int` (or approves them in the PoC PR).
3. **PoC** on a `agent/w2/knowledge` branch from `agent/int`; one PR; independent review; merged dark into `agent/int`; rides the next RC. Live check by the owner's session before any flag is listed.
4. **Policy + health + lints** (V1–V3) before the kinds are listed in production — this is the QA floor the brief asks for, and it is what makes "the partner improves the brain" safe by default.
5. **Eval category 16 (free half)** wired into `agent-ci`; the sealed half written and locked; paid runs when D6 is answered.
6. **Admin activation**: list the three kinds in `UCT_AGENT_DATA_KINDS`, set `UCT_AGENT_KNOWLEDGE=1` (owner), Phase-1 live test per `LIVE-TESTING.md`.
7. **P5 inputs** (`trade.size`, examples, `personal_edge` wrapper) as the P5 specification is written after Wave 2, per the plan of record.
8. **D4 / `wire.today`** only with its own ADR; **D5 manifest fields** whenever the partner has a free hour; **V4 contradictions** once the health report has run for a week and the duplicate / variant counts are known.
9. **Member exposure** (P8) inherits TERM-088 / TERM-049 / D19 rulings; nothing in this design pre-empts them.

## 5.4 The decisions, spelled out

| # | Question | Recommendation | Why it is the owner's |
|---|---|---|---|
| D1 | Approve knowledge kinds on the MD-1 gateway, policy-gated, dark, admin-only; approve the PoC scope | yes | architecture of a flagship product |
| D2 | Source families the Agent may cite in Wave 2 | `trader_archive`, `setup_knowledge`, `self_review`, `manual`, `chart_intake`, the 48 templates, `setup_performance` / `trigger_performance`; **hold** `intake:x_*`, `intake:substack_jeffsun*`, `intake:youtube_*`, `intake:discord_*` and the attributed Feb Substack intake until licensing is settled (the partner's own open question) | licensing and attribution are the firm's exposure, not an engineering choice |
| D3 | May statistics reach the Agent model, and at what floor | yes, with n ≥ 30, a window, the method sentence and a verdict label; prefer the control-relative source when both exist; never below the floor | member-visibility of the firm's record is already a pending ACT (TERM-088 / TERM-049) |
| D4 | May the brain's regime phase / the Wire's regime call reach the Agent model | not in Wave 2; decide with a new ADR when P4 / P6 need it | ADR-005 says any relaxation needs a new ADR and the owner's explicit approval |
| D5 | Ask the partner for additive pack-manifest fields | yes (one hour of the partner's time; nothing breaks if absent) | the two-repo contract is LOCKED by the owner's rule "change both sides together or not at all" |
| D6 | Paid knowledge evals | free deterministic now; paid inside the $21 ledger later | spending controls (EVAL.md §0) |
