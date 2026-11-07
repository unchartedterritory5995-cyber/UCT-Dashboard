# Trading Brain → UCT Agent knowledge integration — discovery and design (2026-11-03)

**Status: READ-ONLY discovery and design. Nothing is implemented. No production service, flag, pack, Morning Wire file or Wave 1.1 / 2 / 3 path was changed.** This directory is the record; it is proposed to the Agent integrator and the owner for review. Implementation starts only on the owner's approval of the architecture.

**Author session:** brain-integration specialist (separate checkout, branch `docs/agent-brain-integration-2026-11-03` on master `e6740b5b08`). **Evidence base:** `unchartedterritory5995-cyber/UCT-Dashboard` master `e6740b5b08`, `uct-brain` `32547a9` (snapshot 2026-11-01), `uct-intelligence` `e8a6e68`, `tsdr-ledger` HEAD (read through git objects; the Windows checkout is partial), `morning-wire` HEAD, `uct-agent-training-data` HEAD, and the acceleration audit in `docs/agent/audit-2026-11-02/` (PR #702) plus `docs/agent/program/`. Every claim names a file; numbers are counts computed from the `uct-brain` tables, never market values.

## The one-paragraph answer

The Trading Brain is **already bridged into UCT-Dashboard** (nightly Brain Pack → R2 → `api/services/brain_sync.py` → `brain_service.py` facade + `brain_kb_service.py` semantic index), and it is already consumed by Compass coach chat, Compass voice, AI Search, Catalysts, the Terminal GRADE/CHK, the Decision Record, Ticker History and the Wisdom pipeline. **UCT Agent is the one surface that does not touch it**: `api/services/uct_agent/**` and `app/src/agent/**` contain zero references to the brain, the knowledge base, the setup templates or the coaching notes. So the job is not a new pipeline; it is **one new data-kind family on the Agent's existing MD-1 gateway** (`knowledge.*` / `setup.*`), wrapping the existing facades read-only, exposed as QUERY capabilities in the browser registry so both the v1 planner and the planner-v2 tool loop see them with no planner changes. Freshness, provenance, licence class and statistical floors travel in the envelope; a dashboard-side **knowledge policy** decides which brain sources the Agent may cite, so the partner's nightly improvements reach the Agent automatically within the sources the owner has approved.

## Deliverables → files

| # | Deliverable (from the brief) | Where |
|---|---|---|
| 1 | Evidence-backed architecture audit of the Trading Brain (KB, 48 templates, chart patterns, coaching, win rates, Morning Wire) and of the Agent seams | `01-AUDIT.md` |
| 2 | Existing integration inventory (what is already connected, and how) | `02-INVENTORY.md` |
| 3 | Recommended knowledge retrieval architecture | `03-DESIGN.md` §2–§3 |
| 4 | Continuous knowledge-sync mechanism | `03-DESIGN.md` §4 |
| 5 | Security and permission model | `03-DESIGN.md` §5 |
| 6 | Versioning and update-validation strategy (QA) | `03-DESIGN.md` §6 |
| 7 | Wave 2 / Wave 3 capability opportunities | `04-WAVES.md` |
| 8 | Small proof-of-concept proposal | `05-POC-AND-ORDER.md` §1 |
| 9 | Integration complexity and recommended order | `05-POC-AND-ORDER.md` §2–§3 |
| — | Interface proposal for the Agent integrator (contract draft) | `contracts/KN-1-knowledge.DRAFT.md` |

## Key findings (each is expanded with evidence in the files above)

1. **The knowledge base is 19,024 rows across 26 categories, 134 trader labels and 93 source strings, all `active = 1`, with no review/approval state beyond `active`.** 62 % of rows are `intake:*` (attributed third-party and Substack intake), 27 % `trader_archive` (the team's own posts), 10 % `self_review` (the brain's own AI coaching). Priority is the only ranking signal and 49 % of rows sit at the lowest tier (4). 149 titles are duplicated. 3,622 MACRO rows are dated market reads (82 % from one month) with no expiry.
2. **Statistics come in three grades of trust**, and the current consumers treat them differently: the engine's `setup_performance` (25 rows, floor n ≥ 5 in `get_setup_performance`), the engine's `trigger_performance` (69 rows), and the ledger's control-relative scorecard (28,013 scored calls, "edge" only at |z| ≥ 3 and n ≥ 40). Only the ledger numbers are base-rate controlled. The Agent must carry n and a verdict label with every number, and never show a number below the stricter floor.
3. **Retrieval exists and is cheap**: `brain_kb_service` chunks title+content at 1,500 chars, embeds with OpenAI `text-embedding-3-small`, stores vectors outside the pack dir, reindexes incrementally by sha256 on every pack install, and answers top-k by cosine in memory. It has no category / trader / epoch / source filter and no score floor (AI Search adds its own floor). Those filters are the first thing the Agent needs.
4. **The update loop already runs nightly** (PC export 21:00 CT → R2 → web pod pull at boot + every 6 h → reindex). What is missing is a **content version in the pack manifest** (only `ts`, row counts, bytes) and any notion of **approved for the Agent**. Both are solvable on the dashboard side without touching the engine (a policy file + a health report at reindex), with optional additive manifest fields proposed to the partner.
5. **The Agent's architecture already has the right seams**: the MD-1 gateway (`Kind`, per-turn caps, envelopes with `as_of`/freshness), browser QUERY capabilities that read through `readData`, the planner-v2 loop that turns every manifest capability into a deferred tool, and the ADR-005 isolation layers. A knowledge kind family plugs into all four with two one-line edits owned by agent-lead (`gateway.CATEGORIES`/`REGISTRARS`, `turn_v2._DOMAIN_OF`).
6. **Nothing in the brain is model-isolated by ADR-005 today** (that ADR covers `breadth.current` and `ratings`). The brain's **regime phase** and the Morning Wire's regime call are UCT-derived observations: exposing them to the Agent model needs an owner decision (a new ADR under ADR-005 Gates §3). Everything else in scope (playbooks, rules, coaching, statistics with floors, examples) is already shown to a model by Compass and AI Search under `BRAIN_TOOLS_ENABLED` / `AI_SEARCH_BRAIN_ENABLED`.

## Decisions the owner is asked for (details in `05-POC-AND-ORDER.md` §4)

| # | Decision | Default if unanswered |
|---|---|---|
| D1 | Approve the architecture (knowledge kinds on the MD-1 gateway; policy-gated sources) and the PoC scope | nothing is built |
| D2 | Which brain source families the Agent may cite in Wave 2 (recommended: `trader_archive`, `setup_knowledge`, `self_review` coaching, the 48 templates, `setup_performance` / `trigger_performance` with floors; **not** the attributed `intake:x_*`, `intake:substack_jeffsun`, YouTube rows until licensing is settled) | team-owned sources only |
| D3 | Whether statistics may reach the Agent model (they already reach Compass and AI Search) and the floor (recommended n ≥ 30 with a verdict label, matching `wisdom/archive/team_record.py`) | numbers withheld; verdict labels only |
| D4 | Whether the brain's regime phase / Morning Wire regime call may reach the Agent model (ADR-005 relaxation; needs a new ADR) | not exposed |
| D5 | Ask the partner for two additive pack-manifest fields (`schema_version`, per-source row counts); keep approval on the dashboard side (policy file), not as an engine schema change | dashboard-side policy only |
| D6 | Evaluation: a free deterministic knowledge set now; paid knowledge evals only inside the existing $21 ledger when authorised | free sets only |

## What this is not

- Not a replacement of the planner, the canonical tools, the capability registry, the Indicators engine or market data (brief, objective 3).
- Not a change to Compass, Voice, AI Search or the Wisdom programme (the Agent program's standing rule "Voice / Compass / AI Search untouched" stands; the design wraps their facades read-only).
- Not a new pipeline, job, database or model. One new SQLite FTS table inside the existing `brain_index.db` is the only new store proposed, and only if the owner wants zero-cost retrieval.
