# Compass `grade_ticker` — The Unskippable Verdict — Design

**Status:** Approved (brainstorm 2026-07-02, Option A) · **Owner:** Patrick Gosz
**Phase 2 of the mentor initiative** ([[2026-06-30-compass-mentor-vision-and-build-plan]] §3 "signature capability", §4.2 "6-step chain made unskippable"). Ships DARK behind existing flags; gated on the report card before any subscriber sees it.

---

## 1. The problem (measured, not assumed)

The first report-card baseline (2026-07-02) scored **12/50**. Rungs 1–2 (facts, grounded craft) pass ~6/10 each. **Rungs 3–5 — the opinionated verdict tiers — score 0.** The failure is consistent and diagnosed: when asked to *"grade DECK"* or *"call this trade,"* Compass **hedges** — it skips the sizing/verdict tools (33/50 tool-gate misses, all behavioral), gives a vague "it depends," and won't commit to a decisive regime-first **GO / HOLD / SKIP with entry, stop, size %, and account-risk %.** Telling it to be decisive (the two-lane persona already does) is not enough — the model hedges anyway. The fix must be **structural.**

## 2. The signature capability

The mentor's signature move (§3) is **"grade TICKER"** — a single integrated, TA-first read delivered as a committed verdict *in the mentor's voice*:

> *"HOLD on DECK. Regime YELLOW — QQQ under its 20-day, leaders holding. DECK is a B+ HTF continuation off the 20-day, RS leading, volume dry on the pullback. Entry above 172.40, stop 164 (−4.9%), size 15%, account risk 0.7%, first target 1.5R. The only knock is the tape — half size or wait for the market to firm up."*

Two failure modes must die together: **hedging** (no verdict) AND **fabrication** (a made-up price). Option A kills both, because the verdict is decisive by construction and every number is tool-sourced.

## 3. Architecture

### 3.1 `grade_ticker(symbol, account_size?)` — a new orchestrating tool
A single tool, wired into BOTH Compass surfaces (voice `voice_tool()` registry + chat `TOOLS`) through the same shared pattern as the brain tools. It orchestrates tools that **already shipped this session** and returns a typed verdict. It never free-forms; it composes:

1. **`get_regime`** — the gate ("no regime, no trade"). Returns the phase (GREEN/YELLOW/ORANGE/RED) + exposure guidance.
2. **`get_quote`** — the live last price (the levels basis; a Lane-1 fact, never invented).
3. **`find_patterns_on_ticker`** — identify the technical setup + its key levels from the 50-detector pattern engine. No clean pattern → the verdict is SKIP/WAIT ("no setup here").
4. **`lookup_playbook(setup)`** — the identified setup's entry-trigger, stop-method, max-stop %, common mistakes, and win-rate from the firm's 48 templates.
5. **Level derivation** — entry from the pattern's pivot/trigger (or the playbook's entry rule applied to the quote); stop from the pattern's structural low / the playbook's stop-method, capped at the template's `max_stop_pct`. (Recon in the plan phase confirms the exact fields `find_patterns_on_ticker` returns; fall back to recent swing structure from bars when the pattern engine gives no explicit level.)
6. **`size_a_trade(entry, stop, account, regime, grade)`** — shares, position %, dollar risk, account-risk %, R-targets, hard-capped at 2% account risk and regime-scaled.
7. **Assemble the typed verdict** (§3.2) with a deterministic preliminary verdict (§3.3).

`account_size` comes from the caller's J2 account settings (like `pre_trade_verdict` does); a documented default is used when absent (report-card sandbox seeds one).

### 3.2 The typed verdict contract (what `grade_ticker` returns)
```
{
  ok: bool,
  symbol: str,
  verdict: "GO" | "HOLD" | "SKIP",     # never null, never "it depends"
  regime: "GREEN"|"YELLOW"|"ORANGE"|"RED",
  regime_note: str,                     # exposure guidance, regime-first
  setup: str | null,                    # e.g. "HTF continuation"; null if none
  grade: "A+".."F" | null,
  entry: float | null,                  # tool-sourced level
  stop: float | null,
  stop_pct: float | null,
  size_pct: float | null,               # position size as % of account
  account_risk_pct: float | null,       # capped at 2.0
  first_target: str | null,             # e.g. "1.5R"
  basis: str,                           # the TA-first one-paragraph read (facts only)
  hard_flags: [str],                    # e.g. ["regime_red","no_setup","risk_over_cap"]
  sources: [str]                        # every claim traceable (template/trader/tool)
}
```
A missing required field for the verdict tier is a **mechanical failure** the report card catches — this is the "typed answer schema" of §4.2, enforced by the tool's own shape rather than by hoping the model fills it.

### 3.3 Verdict logic — decisive by construction (deterministic gates + narration)
The tool computes a **preliminary verdict deterministically** so the mentor can never hedge:
- **SKIP** if ANY hard-gate trips: no clean setup identified · regime RED · computed account-risk > 2% cap (and can't be resized under the position floor) · setup grade below B.
- **HOLD (or "half size / wait")** if: a clean B+ setup but regime ORANGE, or price extended past the pivot, or the tape is weak (regime YELLOW under key MAs).
- **GO** if: clean B+ setup + GREEN/YELLOW regime + risk within cap + entry not extended.

`hard_flags` records exactly which gates fired. Compass (the calling Sonnet/Opus turn) then **narrates and nuances** GO-vs-HOLD in its two-lane voice — but the verdict, the levels, the size, and the regime are the tool's, so the answer is always committed, sized, regime-first, and tool-grounded. (Same two-stage philosophy as `pre_trade_verdict`: deterministic hard checks decide the floor, the model writes the read.)

### 3.4 The unskippable prompt scaffold (§11 verdict protocol)
A new **§11 "Verdict protocol"** section, appended to the two-lane mentor persona (`MENTOR_TWO_LANE` in `coach_prompts.py`), gated by `COMPASS_MENTOR_MODE` exactly as the two-lane ships today:
> For any trade-grade / "call this" / "should I buy/short X" question, you MUST call `grade_ticker` and deliver its verdict — regime first, then the GO/HOLD/SKIP with entry, stop, size %, and account-risk %. Never free-form a trade call, never state a level `grade_ticker` didn't return, never answer "it depends." If a hard flag fired (regime RED, no setup, risk over cap), lead with that and the verdict is SKIP/HOLD.

This makes the tool-gated ordering + regime-first guard structural (§4.2 items 1 and 3). Rungs 1–2 are untouched (they never trigger the protocol) so they stay fast/cheap (§4.2 item 4).

## 4. Flags & rollout (dark, measured, gradual)
- **Tool exposure:** behind `BRAIN_TOOLS_ENABLED` (already ON in prod) — but the **protocol enforcement** (the §11 mandate) is behind `COMPASS_MENTOR_MODE` (currently `admin`), so only admins get the enforced-verdict behavior until proven.
- **Success criterion (the gate):** re-run the report card; **Rungs 3–5 must clear their bars** (Opinion ≥ 3 + Grounding ≥ 3 + Safety ≥ 3, and Rung-5 Safety = 4) with no safety regressions on Rungs 1–2, before `COMPASS_MENTOR_MODE` moves past `admin`.
- **Rollout ladder** (unchanged discipline): merged flag-admin → report card passes → `COMPASS_MENTOR_MODE=1` for a beta cohort → all. 30-second rollback = flip the flag back.

## 5. Testing
- **Unit:** `grade_ticker` with injected/faked sub-tool results — asserts (a) verdict is always GO/HOLD/SKIP (never null), (b) every hard-gate forces the right verdict (regime RED → SKIP/exposure-first; no setup → SKIP; risk > 2% → resize-or-SKIP), (c) entry/stop/size are populated on a GO, (d) `sources` non-empty, (e) fail-soft `{ok: False}` when a sub-tool is unavailable (never raises).
- **Both-registry wiring** tests (voice + chat) mirroring the brain-tool tests.
- **Prompt:** the §11 addendum reaches voice AND chat under `COMPASS_MENTOR_MODE`; voice output for a given flag value stays byte-identical except the new section.
- **The real gate:** the report-card runner, Rungs 3–5, run online with the flags on.

## 6. Out of scope (deferred)
Chart-image / screenshot grading (multimodal "grade this chart" — Phase 2–3 per the vision); multi-ticker "grade my whole watchlist" (that's the Rung-4 complex path, a later build); the agentic overnight research tier (Rung 5 T3 engine). This spec is the single-ticker decisive verdict only.

---

*One implementable unit: a tool + a verdict-logic function + a prompt section + both-registry wiring + tests, measured by the exam that already exists.*
