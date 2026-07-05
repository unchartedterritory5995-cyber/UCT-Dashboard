# Compass Rung-4/5 — Multi-name & Portfolio Mentor — Design

**Status:** design, awaiting owner review. Branch `feat/compass-rung45-mentor` (off master, ships DARK behind `BRAIN_TOOLS_ENABLED` + `COMPASS_MENTOR_MODE`).

**North star:** `docs/superpowers/specs/2026-06-30-compass-mentor-vision-and-build-plan.md` — §2 capability ladder (Rungs 4-5), §3 signature, §5.2 tool table, §5.3 T3 boundary, §7 guardrails, §9 locked decisions. This design was stress-tested by a 4-lens adversarial analysis (coherence / trading-day / gaming-the-exam / correctness-safety); all four converged `sound_with_adjustments`.

## 1. Problem

`grade_ticker` (Rung 3, shipped) makes a decisive GO/HOLD/SKIP for ONE ticker and flips the R3 report-card questions off zero. But Rungs 4-5 remain a real capability gap (the triage this session confirmed they are genuine model *misses*, not harness artifacts): the mentor **hedges** on multi-name and portfolio questions — defers to a config conversation, asks "what's your account size?", gives a priority *order* instead of per-name verdicts, fabricates a price grid, or omits the personal-edge read. The vision's Rung-4 signature is *"Five names survive the regime filter. Top pick FIX (A HTF, leading sector, **you're 6-2 on HTF this quarter**). Dropped two bull flags — **you're 4-11 on those since April**. Adding to NVDA puts you at 3.1% heat, over your cap — pass."* — a **list graded through the trader's own edge**, plus **portfolio-heat-aware add verdicts**. No structural tool produces that today, so the model hedges.

## 2. Design principles (inherited + panel-hardened)

- **Structural beats prompting** (why `grade_ticker` worked): the verdict is computed, the model narrates. It cannot hedge or fabricate.
- **The report card is a FLOOR, not a ceiling.** Its tool-gates accept `grade_ticker` almost everywhere, so a shallow per-name grid can flip every gate green while the moat (edge filter, regime-mute honesty, correlation-collapse) is silently absent — optimizing to a green exam would produce a *worse* mentor. Therefore the report card is hardened alongside the build (§7).
- **§7 guardrails:** opinionated on process/discipline/risk; never a naked dollar call (size only ever wrapped in risk framing); educational-not-advice.
- **Every number tool-sourced; never raises; regime-first ("no regime, no trade").**

## 3. The two firm caps (RESOLVED — not ambiguous)

The "heat cap ambiguity" reconciles to **one rule expressed two ways**, ratified by golden R4-02/R5-10 (cited to Desjardins File 3 §1):

- **Per-trade:** account risk **≤ 2%** (uct_identity Step 4) — already enforced by `grade_ticker`/`size_a_trade`.
- **Aggregate (total book):** open-heat **≤ 10%** = `Σ(entry−stop)·shares / capital`. `voice_position_sizing`'s "total exposure > 5× per-trade risk" == 5×2% == 10% == Desjardins — the same rule. **Vision §2's "over your 2% cap" for *total* heat is a drafting bug** (conflates per-name with aggregate) → fix that line to "10% aggregate open-heat cap (2% is per-trade)".
- **De-risk spike (a) — DONE:** `voice_position_sizing`'s open-exposure aggregator computes `Σ shares×|entry−stop|` = dollar risk-heat (the Desjardins numerator), **not** notional exposure. Confirmed the right number. It also (as the panel predicted) treats a placeholder stop (`stop==entry` → risk 0) as zero-risk → §4.A must layer placeholder detection on top.
- **Read the cap from the brain at runtime** (uct_identity), do NOT hardcode 10% and do NOT derive as "5× per-trade" (drifts if per-trade is ever reconfigured). Fail-soft default 10% with a note if the brain read fails.

## 4. The build — tool set

Two **structural** artifacts + one **shared substrate** + one **persona composition**. Vision §5.2 vocabulary. All behind `BRAIN_TOOLS_ENABLED`; registered in BOTH surfaces (voice + chat) via the established pattern; never raise.

### A. `portfolio_heat(account_size?)` — structural state read, NO GO-path
- **Contract:** `→ { ok, risk_heat_pct, notional_exposure_pct, per_position:[{symbol, side, dist_to_stop_pct, r_multiple, risk_pct, placeholder_stop:bool}], by_symbol[], by_sector[], placeholder_stops:[symbols], caps:{per_trade_pct:2, aggregate_pct:10, regime_ceiling_pct}, room_to_add_pct, sources }`
- **Two metrics, NEVER blended:** risk-heat `Σ(entry−stop)·shares/capital` vs the **10% aggregate cap**; notional exposure `Σ position%` vs the **regime ceiling** (from the regime classifier — e.g. YELLOW 50-75%, RED near-cash). Comparing one to the other's cap produces wrong verdicts.
- **Placeholder-stop rule (SAFETY-CRITICAL, mandatory):** detect `stop_price == entry_price` (broker imports) or null → **exclude from the confident heat number**, count + surface verbatim ("N of M positions have no real stop; true heat is higher — resolve before any add"); when any placeholder is present the add-path (§4.D) **may not return GO**.
- **Per-position at-risk layer** (dist-to-stop, R-multiple) — the *honest* half of "which position is most at risk". Do **NOT** build a separate `portfolio_stress` tool; the by-sector concentration view covers File 3 §2 correlation. The conditional-scenario half ("if QQQ loses 590") is deferred (§5).
- **account_size defaults from the user's real positions/profile** (`voice_position_sizing._account_settings`); `account_size` is an override-only param. The persona **never asks "what's your account size?"** (a graded Rung-4 miss).
- Composes: `voice_position_sizing` open-exposure aggregator + `_account_settings` + `j2_positions.list_open_positions` + the regime classifier. Injectable sub-fns for tests.

### B. `grade_watchlist(symbols?, source, sector_filter?, account_size?)` — structural verdict tool (the Rung-4 moat)
- **Contract:** `→ { ok, regime, regime_verdict, list_verdict, graded:[{symbol, verdict, grade, entry, stop, size_pct, account_risk_pct, edge_annotation, muted:bool, mute_reason, failed:bool}], correlated_blocks:[{sector, symbols, concentration_pct, flag}], behavioral_note, source_described, sources }`
- **`source` resolves the candidate list DETERMINISTICALLY:** `'watchlist' | 'flagged' | 'positions' | explicit symbols[] | 'scan'`. It **states which set it graded** ("your 5 flagged + 8 watchlist") — never silently guesses. `'scan'` (owner-gated, default IN per §6) resolves via ONE bounded deterministic scan (`scan_active_patterns` + leading-sector filter) — list *resolution* is a fixed query, not an LLM-planned DAG, so it stays a primitive on the correct side of the T3 line (§5). Hard-bound: single scan, N cap, funnel — cannot grow into discovery logic.
- **Funnel, not blind fan-out:** cheap wide filter first (regime-in-season setups + sector-leadership + one pattern-scan pass) → full `grade_ticker` only on survivors. Fixes voice latency/cost; structurally prevents a truncation from dropping the one A-setup. **Compute-once market context** (regime, breadth, journal aggregates) hoisted OUT of the per-name loop and passed down — mirrors the proven §5.4 "one scan → per-user filter" idiom and pre-shapes T3's blackboard.
- **MANDATORY list-level synthesis step** (this is what makes it a mentor, not a grid; without it it structurally cannot pass R4-03/R4-07/R5-06): (a) return **"0-GO / all watch-only"** when the regime gate mutes the book; (b) collapse same-sector names into one **correlated block** with the 40%-single-sector concentration flag (File 3 §2); (c) one **behavioral meta-note** from the edge substrate.
- **Edge annotation** via the shared substrate (§4.C), not inline.
- **Fail-soft / never-mask:** bounded N (≤~20), ceilinged parallelism, per-name timeout; a failed name returns `failed:true, "couldn't grade"` **inline — never dropped, never fabricated, never masked as a clean list** (the §5.3 `{ok}`-envelope bug). Regime-first: if `get_regime` fails, no GO is possible.

### C. `personal_edge` — shared substrate (build once, consumed in 3 places)
- Backs the "you're 6-2 on HTF / 4-11 on bull flags" moat: `get_aggregates`-by-setup + `muted_setups`. **This is the USER's journal edge — a DISTINCT data source from the shipped firm-level `setup_winrate`** (`get_setup_performance`). Consumed by `grade_watchlist`, the EOD scorecard (R5-06/07), and the add/refuse filter.
- **Edge = expectancy / R-multiple, NOT raw W-L** (a 4-11 setup can be net-positive on a few big winners).
- **Sample-size gate + cold-start degrade** (owner decision §6, recommend SOFT): below the floor (~20-30 closed trades in that setup) **never hard-mute or drop** — surface the tentative stat *with its uncertainty* ("small sample n=11, leaning negative, not conclusive"); below any meaningful sample (new subscribers — all-subscribers product per §9), **fall back to firm `setup_winrate` with a note.** Never silent-hide: always **name a muted setup with its stat + reason** (matches R4-01/R4-05 "muted" behavior). Edge is a **tertiary sort within regime+grade tiers** — it annotates/de-emphasizes, **never demotes a genuine A-setup below a worse one**, and always honors "show me anyway".
- **De-risk spike (b) — GATES IMPLEMENTATION (Task 0 of the plan):** verify the journal setup-tag taxonomy joins to the 48-template keys `lookup_playbook`/the pattern engine use. If journal tags are free-text/noisy, "you're 4-11 on bull flags" silently mis-joins and the moat is garbage-in — gate the edge annotation on this join being reliable (normalize via `resolve_setup_name`; skip annotation for unjoinable tags rather than mis-attribute).
- **Share substrate with the awareness engine's personalization store** (`awareness_preferences` / `muted_setups`) — "what you're good at" and "what you act on" are the same store; two tables re-create the split-brain disease the whole project is curing.

### D. Add-verdict — persona-only COMPOSITION, discipline-gated (NOT a new tool)
`"can I add X?"` / `"add to my winner"` = `grade_ticker(X) + portfolio_heat`, wired as a **pipeline where GO is the terminal, hardest-to-reach branch**:
1. active intervention (tilt / rapid-fire / loss-streak) → **REFUSE**
2. add below entry / underwater → **REFUSE** (never average down)
3. request moves the stop further from entry → **REFUSE** (never widen)
4. regime RED → **REFUSE** new longs
5. placeholder stop present → **"confirm those stops first"**, no GO
6. *only then* compose grade + heat: over **2% per-trade OR 10% aggregate → SKIP** regardless of setup grade; add-to-winner additionally requires a **fresh technical add-trigger** (R5-10: "only into strength off a new flag, not just because it's green").
Gates 1-4 are **mechanical checks in `validate_trade`/`pre_trade_verdict`**, not prompt lines that can be argued around. The discipline lane must be **wired to actually call** `portfolio_heat`+`get_regime` so vetoes quote real numbers ("8.5% open heat, already at the 10% cap"), not generic rule-recitation.

### §11 protocol extension (in `MENTOR_TWO_LANE`, same `COMPASS_MENTOR_MODE` gate)
Route: "grade my watchlist / rank these / what's in play" → `grade_watchlist`; "what's my heat / am I too exposed / most at risk" → `portfolio_heat`; "can I add / add to winner" → the §4.D add-verdict pipeline. All regime-first; forbid the priority-order-or-clarifying-question dodge.

## 5. Scope boundary — explicitly NOT in this build

- **T3 Planner-Executor agentic engine** (`task_runner.py`) — vision Phase 3. `grade_watchlist` is the *deterministic down-payment* T3 will call as one executor step. Boundary: **deterministic fixed-shape fan-out over a resolved list = primitive (now)** vs **LLM-planned open-ended discovery DAG = T3 (defer).** Do NOT let `grade_watchlist` accrete open-ended discovery or it becomes a second orchestrator that collides with T3.
- **Full autonomous overnight/premarket prep (R5-04)** and **end-to-end theme research (R5-13)** — T3. This build gets premarket prep only *partway*; the report card says so honestly — do NOT claim Rung-4 "done".
- **Conditional scenario stress** ("most at risk if QQQ loses 590") — deferred. A shallow beta-sort `portfolio_stress` is the exact confident-shallow failure; **fail R4-03 honestly** (the per-position at-risk read in `portfolio_heat` covers the honest part).
- **Pure-refusal Rung-5 traps** (R5-01/03/05/07/08/09/11) — persona + `validate_trade`, **never a grade tool** (which could wrongly return GO). Grade/heat tools supply the *numbers* the refusal cites; the refusal is persona.
- **Deep sell-side engine, web-push/away-delivery, model standardization** — separate tracks.

## 6. Owner decisions (defaults chosen; flag to change)

1. **Total-book heat cap:** **10% aggregate Desjardins open-heat + 2% per-trade**, read from the brain (§3). *(Resolved from the golden set; also please edit vision §2 line 52's "2% cap" for total heat.)*
2. **Edge-filter aggressiveness:** **SOFT** — annotate/de-emphasize, hard-mute only at n≥~20-30 AND negative expectancy, always honor "show me anyway". *(Owner away at spec time; default SOFT per panel + §8 paternalism warning. Flag to change.)*
3. **Edge metric:** **expectancy / R-multiple**, not raw win-count.
4. **Placeholder-stop rule:** **confirm** — never treat `stop==entry` as 0-risk; block GO on the add-path when any placeholder present.
5. **Hard/mechanical discipline gates in `validate_trade`:** **all six** (§4.D).
6. **Scan origination (`source='scan'`):** **IN, bounded** (§4.B). *(Owner away; default IN per adjudication. Flag to change.)*

## 7. Report-card hardening (built WITH the tools, or the score rises on a shallow grid)
- Mechanical checks: `personal_edge`/`get_aggregates` actually ran AND ≥1 muted/annotated name is cited with its stat; `portfolio_heat` ran AND the answer states heat vs the 10% cap.
- New fixtures: a **RED-tape** question whose honest list verdict is "0-GO / sit on your hands"; a **correlation-collapse** fixture (R4-03/R4-07); a **forbidden-claim: muted a setup on n < floor**; a **placeholder-stop** fixture (must say "resolve stops first", must not GO).
- Where the golden answers themselves overfit (tiny-sample "2-9, dropped" edges), feed into the §8 feedback flywheel to **correct the gold**, don't chase it.

## 8. Sequencing (each independently shippable + report-card-measurable)
0. **De-risk spike (b)** — journal setup-tag → 48-template join reliability (gates §4.C). (Spike (a) done, §3.)
1. **`portfolio_heat`** — safety-critical, self-contained read, no GO-path. Measurable on R4-02 (placeholder caveat) + R5-10 heat number.
2. **`personal_edge` substrate** — get_aggregates-by-setup + muted_setups + sample-size degrade + template-key join. Shared → before its consumers.
3. **`grade_watchlist`** — funnel + fan-out + list-level synthesis + edge annotation + fail-soft. Measurable on R4-01/04/06.
4. **Add-verdict composition + §11 router**, discipline gates mechanical in `validate_trade`. Measurable on R5-01/09/10 (must REFUSE, not GO).
5. **`source='scan'` + report-card hardening (§7)** — last, once the core is green.
Then re-run the report card; Rungs 4-5 must climb (honestly, not via gate-gaming) before `COMPASS_MENTOR_MODE` advances past `admin`.

## 9. Biggest risk + guardrail
**The build scores well on the exam while staying a shallow parrot-at-scale** — tool-gates accept `grade_ticker` everywhere, a cheap judge rubber-stamps a formatted grid, and the moat is silently absent; the acute sub-failure is **placeholder-stop → false "you have room" → confident over-cap GO** (a safety defect on the axis §4.4 weights most). **Guardrail (all three):** (1) report-card hardening (§7) so the score cannot rise on a shallow grid; (2) the mandatory list-level synthesis step in `grade_watchlist`; (3) the placeholder-stop fail-safe + discipline-gated add-path so no confident-wrong GO can be born.
