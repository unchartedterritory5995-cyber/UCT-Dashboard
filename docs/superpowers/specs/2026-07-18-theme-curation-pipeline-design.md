# Theme-Taxonomy Curation Pipeline — Design Spec

**Date:** 2026-07-18
**Status:** design — awaiting owner sign-off before the implementation plan
**Feature area:** `themes_taxonomy.json` maintenance (feeds Groups, Theme Tracker, theme-index, voice sizing)
**Sub-project:** ② of 2 in the theme-curation initiative (① Live Swing Gates = shipped & live)
**Grounded by:** adversarial multi-lens design analysis (5 lenses + opus synthesis, all claims code-verified) — this spec incorporates its 14 load-bearing findings.

## 1. Goal

An owner-run **local CLI pipeline** that cleans `themes_taxonomy.json` for **correctness** — fix dead/renamed/mis-mapped tickers, add genuinely-missing leaders, and refresh the ~3-month-stale map across all 99 themes — so Groups/Theme Tracker surface the right *pool* of names. Sub-project ①'s live gates already handle *strength*; ② must **not** prune or pad for strength. The pipeline proposes; the owner approves; a deterministic apply step rewrites the JSON and bumps its version so the DB reseeds on next deploy.

## 2. Membership rubric (the standard every proposal is judged against)

**Meaningful exposure:** a name belongs in a theme if the theme is *material to its business or market story* (a real revenue segment, or a name traders associate with the theme). Tangential exposure (a diversified giant with a token segment) is effectively **mis-mapped** → drop. `tier` (core / relevant / peripheral) reflects centrality.

## 3. Architecture — a staged, local, dry-run-default CLI

`tools/theme_curation/` (Python; run locally). Four stages, each emitting a **git-trackable artifact**, sharing an append-only **decision ledger**. Dry-run by default; `--apply` is explicit and gated. All symbol handling reuses `groups.normalize_sym` (dot→hyphen) / `groups.to_taxonomy_sym` (hyphen→dot).

```
Stage 1 Audit ──► audit.md            (mechanical, local, no LLM)
Stage 2 Discover+Propose ──► proposals/{theme_id}.json   (Perplexity + Finviz corroboration + Anthropic)
Stage 3 Review ──► review-{sector}.md  +  interactive CLI (confidence-tiered; writes ledger)
Stage 4 Apply ──► themes_taxonomy.json (validated mutation + version bump; --apply --confirm)
                     shared: curation_ledger.(sqlite|jsonl)  keyed (theme_id, sym, action)
```

## 4. Stage 1 — Audit (mechanical, pure-local)

Inputs (all local): `themes_taxonomy.json`, `api/data/cap_universe.json` (flat list, hyphen form), `ipo_maintenance.IPO_DATES`. Per-theme + global flags → `audit.md`:
- **dead** — a holding whose `normalize_sym` ∉ cap_universe (delisted / renamed / dropped-from-universe candidate; the *resolution* — drop vs remap — is Stage 2's LLM call, so "dead" is a flag, not a verdict).
- **dup / normalization** — duplicate `sym` within a theme, or a dot/hyphen inconsistency.
- **thin** — a theme with few chartable holdings. **Informational only** — surfaced in `audit.md` for the owner, and to DROP/REMAP reasoning; it is **NOT** fed into the ADD-proposing prompt (must not pressure padding — a legitimately narrow theme stays narrow).
- **gap pool** (global) — cap_universe / `IPO_DATES` names that are in **no** theme. **Every `IPO_DATES` ticker is first run through the same 365-day cutoff `ipo_maintenance` uses**; aged-out IPOs (e.g. VLTO, KVUE) are excluded from the `recent_ipos` ADD path (they may still be proposed for a durable theme). SNDK-class recent IPOs feed ADD.

All deterministic and unit-tested.

## 5. Stage 2 — Discover + propose (Perplexity primary, Finviz corroboration, one Anthropic call)

Per theme, batched by sector, **resumable** (per-theme `proposals/{theme_id}.json`; `--resume` skips completed themes).

**Candidate discovery = Perplexity (primary).** `perplexity_search.web_search(query, system=<list-mode>, max_tokens=1500, domain_pack="finance", cache_salt=<run_id>)`. The default system prompt is spoken-prose ("2–4 sentences, no lists") — it **must be overridden** with an explicit list-mode system (mirroring `groups._ai_peer_raw`'s "ONLY a JSON array, no prose"). The returned `error` field is checked per theme (never raises, but a per-theme failure must surface, not vanish). Concept-themes (no Finviz industry, below) get a **second independent Perplexity confirmation query**.

**Finviz corroboration (not enumeration).** `industry_map` is a per-*ticker* lookup (`get_industries([syms])` / `get_groups([syms])`), **not** a constituent source — so Finviz is used to *corroborate* Perplexity's candidates, not to discover them: each candidate's Finviz industry is checked against the theme's expected industry set (mirroring `_ai_peers`' proven "sector OR industry must match" gate). A net-new **owner-maintained `tools/theme_curation/theme_finviz_industries.json`** maps `theme_id → [finviz_industry…]` (nullable; versioned in git). It is **bootstrapped once, not hand-built from scratch:** a one-time setup command lists the distinct Finviz industries present in `industry_map` and asks the LLM to propose the 0–N industries that fit each theme (null for concept-themes), which the owner confirms in one pass; thereafter it's hand-maintained. This keeps it a small setup step, not a hidden sub-project. On startup the CLI calls `industry_map.status()`; if empty/stale it runs `bulk_refresh_from_finviz()` synchronously; if that returns 0 rows (no `FINVIZ_API_KEY`) it **hard-fails with an actionable message** rather than silently losing the Finviz leg.

**The Anthropic call.** One grounded call per theme (`engine._get_anthropic_client()` + `TAXONOMY_LLM_MODEL` env, `.with_options(timeout=…)` off the request path): inputs = current members (with tier/sub_theme_id/rationale + each member's Finviz industry), Perplexity candidates (+ their Finviz industry), audit flags (minus `thin` from the ADD side), the meaningful-exposure rubric, and the theme's `sub_themes` list. Output = typed proposals:
- **ADD** (sym, tier, sub_theme_id, rationale, confidence)
- **DROP** (sym, reason, confidence)
- **REMAP** (old_sym → new_sym, **plus new_sym's tier/sub_theme_id/rationale** defaulting to inherit-from-old, confidence)
- **RETIER** (sym, new_tier, confidence)

Every candidate/new-sym is normalized (`normalize_sym`) and validated against cap_universe before it can be proposed.

**Confidence** = LLM self-rating adjusted by corroboration: a Perplexity candidate whose Finviz industry matches the theme → **boosted**; concept-theme candidate confirmed by the second Perplexity query → boosted; Perplexity-only + borderline exposure → **low**. A REMAP whose `old` is cleanly dead in **both** cap_universe and Finviz is a **positive** signal (not a missing leg). Prior owner **rejections** in the ledger suppress/down-rank re-proposals of the same `(theme_id, sym, action)`.

## 6. Stage 3 — Review (confidence-tiered, machine-parseable)

- **High-confidence** proposals → `review-{sector}.md`, **machine-parseable**: one block per proposal with a **stable ID `theme_id::sym::action`** and an explicit decision token (`[x]` approve / `[ ]` reject, plus optional `EDIT: <field>=<value>`). The owner skims and bulk-toggles.
- **Low-confidence** (per-proposal below the threshold) **or a whole theme the LLM flags as "can't confidently curate"** → the **interactive CLI** one-by-one (shows name + rationale + Finviz industry + evidence; approve / edit / reject / skip). The CLI **writes each decision to the ledger immediately** and **skips already-decided items on relaunch** (crash/Ctrl-C safe; resumable).

The confidence threshold is an env/flag knob, defaulted conservative (more to the CLI).

## 7. Stage 4 — Apply (validated, deterministic, gated)

Reads approved decisions (ledger + parsed `review-*.md`). **Never defaults-to-approved and never silently skips** — Stage 4 **hard-fails on any block/decision it cannot confidently parse**.

**Cross-referential validation gate** (reject + log each proposal that fails — downstream `INSERT OR IGNORE` / tier-fallback would otherwise silently *mask* bad data):
- DROP.sym ∈ current holdings
- ADD.sym ∉ current holdings (and ∈ cap_universe)
- REMAP: old ∈ current holdings ∧ new ∈ cap_universe ∧ (new ∉ current holdings **or** merge into the existing new-sym row rather than create a duplicate)
- RETIER.new_tier ∈ {core, relevant, peripheral}
- ADD/REMAP `sub_theme_id` ∈ `{s["id"] for s in theme["sub_themes"]}` (or null)

**Mutation:** apply add/drop/remap/retier; **untouched holdings' fields preserved verbatim**; write syms in taxonomy (dot) form via `to_taxonomy_sym`.

**Pre-write self-validation** (prevents a boot crash — `seed_from_json` does unguarded `t["id"]/t["sector_id"]/h["sym"]` after DELETEing all three tables): assert every theme has `id/name/sector_id/holdings` and every holding has `sym`; **refuse to write/commit on failure**.

**Version bump (the reseed gate):** `seed_from_json` reseeds only when the JSON's top-level `version` ≠ the stored `user_preferences('system','theme_seed_version')`. Stage 4 sets `version = "{bumped-semver}+{sha8}"` where `sha8` = first 8 hex of sha256 over the canonicalized sectors+themes+holdings — so **any content change forces a new version (reseed fires) and reused content maps to the same version (correctly skips)**, immune to a manual version hand-edit or revert-then-reapply. `generated_at` updated.

**Apply gating:** `--apply` prints/saves a unified old-vs-new diff and requires a distinct `--confirm`; it **refuses to run when `git status --porcelain themes_taxonomy.json` is dirty** (unless `--force`) so two applies can't compound past a clean rollback point. Rollback = revert the JSON commit (which restores the old version+hash → reseed restores membership on next deploy). Git is the backup/audit trail.

## 8. Boot hardening (small, related — prevents an outage from a bad apply)

Wrap the lifespan `seed_from_json()` call (`api/main.py`, currently unwrapped unlike the `_build_deep_cache` block above it) in try/except → a malformed taxonomy leaves themes empty and logs, instead of crashing the web pod. Belt to Stage 4's suspenders.

## 9. Data / run model

Fully local. **Local:** `themes_taxonomy.json`, `cap_universe.json`, `IPO_DATES`, the new `theme_finviz_industries.json`, the ledger. **Keys (local `.env`):** `PERPLEXITY_API_KEY`, `ANTHROPIC_API_KEY`, `FINVIZ_API_KEY`, `TAXONOMY_LLM_MODEL`. `screener.db`/RS are prod-only but **not needed** (① owns strength). No FMP.

## 10. Testing

Unit-tested (Perplexity / Finviz / Anthropic **mocked**):
- **Audit:** dead / dup / thin / gap-pool (incl. the IPO 365-day cutoff) on a fixture taxonomy + cap_universe + IPO_DATES.
- **Proposal parsing/validation:** LLM JSON → typed proposals; malformed/partial/hallucinated rejected; the cross-referential gate (each of the §7 checks as a fixture — drop-nonmember, add-dup, remap-to-nonexistent, remap-into-existing merge, bad tier, bad sub_theme_id).
- **Normalization:** no resulting holding contains a bare hyphen; a `BRK.B` member and a `BRK-B` candidate dedupe to one.
- **Apply mutation:** add/drop/remap/retier + field preservation + version bump (content-hash changes on content change, stable on no-op) on a fixture JSON.
- **Review parse:** `review-*.md` round-trips through the parser; an unparseable block hard-fails (never silent-approve).
- **Confidence routing + ledger:** high→batch / low→CLI / whole-theme→CLI; a prior rejection suppresses re-proposal; CLI resume skips decided items.
- **Pre-write self-validation** rejects a synthetically-malformed output.

LLM *quality* is not unit-testable — the owner review is that gate.

## 11. Non-goals

Buyout-exclusion (deferred, ①); auto-apply without owner review; any strength/ranking/quantity change (①'s job — enforced by keeping `thin` out of the ADD prompt); a member-facing UI; rebuilding cap_universe or the Finviz industry map's schema; a corporate-actions feed (rename resolution stays LLM-proposed + owner-confirmed).
