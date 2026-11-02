# SC-2 — Natural-language scanning on the canonical Screener (DRAFT 0.1)

- **Owner:** agent-sc.
- **Consumers:** agent-lead (the fast-path hook and planner wiring), agent-qa (scoring), agent-md (the §2c wording).
- **Depends on:** SC-1 v1.3 (kinds, specs, §2a envelope fields, §2b spec sources, §2c relative volume). MD-1 (gateway,
  budgets, `UCT_AGENT_DATA_KINDS`).
- **Status:** DRAFT for Sprint 2, flags-off preparation only. Nothing here is enabled in production. Values marked
  **PROPOSED** in §4 are agent-sc's proposals and need the owner's ruling before they ship.
- **Corpus:** `api/services/uct_agent/scan/eval/sc2.json` (validated by `tests/test_uct_agent_scan_sc2_corpus.py`).

## 1. Purpose and what does not change

SC-2 lets a member describe a screen the way traders talk, in one message or across a few follow-ups, and turns that
into **one SC-1 request**. For example:
- "liquid semis above the 50-day with RS over 80 and volume picking up"
- "only the ones near highs"
- "drop anything under $10"
- "sort by relative volume"
- "now just tech"

**Unchanged:**
- **The Screener is canonical.** The output is the Screener's own JSON spec, run through `screen.run` / `screen.count`
  (SC-1 §2). There is no parallel pipeline, no second filter language, no scan engine and no relative-volume calculator.
- **Budgets and caps:** SC-1's limits all stay: 50 rows, one scan per turn, the per-turn read budget, and the
  `UCT_AGENT_DATA` + `UCT_AGENT_SCAN` + `UCT_AGENT_DATA_KINDS` gates.
- **No paid compiler.** `/api/screener/compile` is not used.
- **Model calls:** the planner's count and the $5 / $15 budgets are unchanged. SC-2's deterministic layer can only
  *remove* model calls, never add one.
- **Refusals stay refusals:** indicator conditions (IC-1 / SC-1 v1.2) and measures the catalog lacks.

## 2. The parsed intent

A message becomes an **intent**: a set of filled slots, each traceable to the words that filled it. An intent is
compiled into a spec only when every part of the message was accounted for (§5).

| Slot | Holds | Compiles to |
|---|---|---|
| `universe` | sector / industry / theme / index / ETF-or-not / watchlist (`within`) | `in` filters on `sector`, `industry`, `theme`; `eq` on `index_*`, `is_etf`; the `list` key for a watchlist |
| `size` | market-cap words or bounds | `market_cap` bounds |
| `liquidity` | dollar-volume words or bounds | `dollar_vol_30d` (an average) or `dollar_vol_1d` (latest session, when the member says "today" / "a day") |
| `price` | price bounds | `price` bounds |
| `trend` | moving-average relations, stage, MA stack | `above_50sma`, `ema20_rising`, `ema_stack_intact`, `stage2`, `pct_vs_ema20`, `pct_vs_sma20` |
| `strength` | RS words or bounds | `rs_rank`, `sector_rs_pct`, `rs_line_trend` |
| `location` | near or at highs, distance from levels | `dist_52w_high_pct`, `dist_20d_high_pct`, `new_52w_high`, `new_ath`, `dist_ath_pct` |
| `performance` | returns over a window | `chg_pct_1d` … `chg_pct_ytd`, `gap_pct` |
| `volume` | relative or absolute volume | §2c: `vol_ratio` (full session) or `rvol_live` (by now); `vol_nweek_low` |
| `volatility` | ADR / ATR | `adr_pct`, `atr_pct` |
| `setup` | named screener setups | `tight_consolidation`, `nr7`, `inside_bar_run`, `pullback_depth_pct`, `higher_lows_run` |
| `fundamental` | growth, margins, valuation, short interest | the matching catalog fields (`eps_growth`, `rev_growth`, `short_float_pct`, …) |
| `events` | earnings windows | `days_to_earnings` |
| `sort` | an order | `spec.sort` `{key, dir}` |
| `show` | how many rows | `limit` (1–50, SC-1 §2a) |

Each filled slot carries `{field, op, value, max?, values?, words}`. `words` is the span of the message it came from,
so the receipt can say what was understood and a reviewer can see why.

**Every field name a slot produces must be a key in `filters.field_catalog()`.** A slot never names a field the
catalog does not hold, and never approximates one measure with another (§6).

## 3. Follow-ups refine the last screen

A follow-up is a **delta** on the member's last screen in this conversation (the client's `cache.last`, i.e. the
`lastScreen` context entry). It is never a new screen that forgets the old one, unless the member says so.

| Delta | Example | Effect on the last spec |
|---|---|---|
| `add` | "only the ones near highs", "with RS over 80 too" | adds the filter. If the last spec already filters that key, the new bound **replaces** it (this is `mode: refine` in `screener.run` today, which replaces by key) |
| `narrow` | "drop anything under $10", "no ETFs" | an `add` that excludes: `price >= 10`, `is_etf = no` |
| `replace_universe` | "now just tech", "same thing in software" | replaces the `universe` slot (`sector` / `industry`), keeps everything else |
| `sort` | "sort by relative volume", "biggest first" | replaces `spec.sort` only; the filters are untouched |
| `show` | "show me 25" | changes the row count only (≤ 50) |
| `remove` | "forget the RS filter", "without the price limit" | removes the filters on the named key(s) |
| `reset` | "start over", "new screen: …" | a new screen (`mode: new`) |

**Rules**
- A follow-up with no last screen in the conversation is **asked about**, never guessed: "Which screen should I
  narrow? Run one first, e.g. …".
- `remove` naming a filter the last screen does not have is a local sentence ("Your last screen has no RS filter"),
  not a model call.
- **Implementation gap:** `remove` is not expressible through `screener.run` today, because `mode: refine` only adds
  or replaces. It needs a client change in `capabilities/screener.js` (agent-sc's file), planned with SC-2's
  implementation, not this draft.
- `sort` by `rvol_live` follows §2c: labelled "vs 30-day average at this time of day". When no returned row carries a
  live value, the answer says so and offers `vol_ratio`.

## 4. Vocabulary (trading language → slots)

These are the default readings of common trader words. **PROPOSED** values are agent-sc's proposals, chosen to agree
with the discovery corpus tolerances, and they need the owner's ruling. A default is always shown on the receipt
("liquid = trading at least $20M a day, 30-day average"), so the member can see and change it.

| Words | Slot → spec | Status |
|---|---|---|
| liquid, tradable | `dollar_vol_30d >= 20000000` | PROPOSED |
| very liquid | `dollar_vol_30d >= 100000000` | PROPOSED |
| large caps / small caps / mid caps / mega caps | `market_cap > 10e9` / `< 2e9` / between 2e9 and 10e9 / `> 200e9` | PROPOSED (discovery d19, d22) |
| semis, chips | `industry in ["Semiconductors"]` | discovery d06, d26 |
| software | `industry in ["Software - Application", "Software - Infrastructure"]` | discovery d21 |
| tech | `sector in ["Technology"]` | PROPOSED |
| above the 50-day | `above_50sma = yes` | discovery d12, d24 |
| above the 20-day EMA / pullback to the 20 EMA | `pct_vs_ema20 > 0` / `pct_vs_ema20` within ±2 and `ema20_rising = yes` | discovery d14 |
| uptrend, trending | `ema_stack_intact = yes` | PROPOSED |
| stage 2 | `stage2 = yes` | catalog |
| strong RS, leaders | `rs_rank >= 80` | discovery d01, d03 |
| near highs | `dist_52w_high_pct <= 5` | discovery d01 |
| near the 20-day high | `dist_20d_high_pct <= 3` | discovery d16 |
| making new highs | `new_52w_high = yes` | discovery d03 |
| ripping / running (a window) | `chg_pct_<window> >= 20` (1m), `>= 10` (1w), `>= 5` (1d) | PROPOSED (discovery d04) |
| up today / down today | `chg_pct_1d > 0` / `< 0` | discovery d26 |
| gapping up N% | `gap_pct > N` | discovery d17 |
| oversold / overbought | `rsi14 < 30` / `rsi14 > 70` | discovery d18, d19 |
| volume picking up, unusual volume (no time word) | `vol_ratio >= 1.5` / `>= 2`, labelled "full session, vs 30-day average" | PROPOSED (discovery d06) |
| volume … today / right now / this morning | sort by `rvol_live` desc (+ `rvol_live >= 1.5` when "picking up"), labelled "vs 30-day average at this time of day" | §2c |
| relative volume, rvol (the field's own name) | `rvol_live`, labelled "vs 30-day average at this time of day" | §2c; catalog label "Rel Volume (by now)" |
| volume dried up | `vol_nweek_low >= 4` | discovery d09 |
| high ADR / tight | `adr_pct > 5` / `tight_consolidation = yes` | discovery d10, d12 |
| fast growers | `rev_growth >= 25` | discovery d21 |
| heavily shorted | `short_float_pct > 20` | discovery d22 |
| reporting soon / this week | `days_to_earnings` 0–5 | discovery d23 |
| biggest first / strongest first | sort by the screen's own measure, else `rs_rank` desc | PROPOSED |

**Numbers and units** follow the catalog's own units (screener.js hints): `%` fields take 5 for 5%; `$` fields take
dollars (`$50M` = 50000000, `$2B` = 2000000000); `×` fields take the multiple (`3x` = 3). A number with no unit on a
`$` field is read as dollars only when the word makes it unambiguous ("over $10", "under 10 bucks"). Otherwise it is
asked about (§5).

## 5. Ambiguity → ask, or hand to the planner. Never guess.

The deterministic layer (SC-2 §7, Sprint 2 task C) answers only when the whole message is accounted for. Every
other case goes to one of two exits, which are part of the contract:

- **ASK (local, no model call).** The message is clearly a screen, but one slot has two readings the member must
  choose between. The question names both readings in the member's words:
  - "volume up" with no time word *and* the session is open: "Volume vs its 30-day average for the full last session,
    or so far today at this time of day?";
  - a bare number on a field with two units;
  - a follow-up with no last screen;
  - a sector/industry word matching more than one catalog value ("financials": the sector, or banks only?).
- **PLANNER (the existing model path, unchanged).** Anything else the deterministic layer cannot fully account for:
  an unknown word, an opinion ("good setups"), a request mixing a screen with another action, or prose it cannot
  segment. The planner already writes SC-1 requests; SC-2 only removes the calls it does not need.
- **Never:** dropping a word it did not understand and running the rest, substituting a nearby field, or inventing a
  default not in §4.

**False-resolve budget: zero.** A deterministic answer that differs from what the planner and the corpus expect is a
defect, not a coverage win. Coverage is reported together with the false-resolve count (§8).

## 6. Refusals

- **Indicator conditions** (crosses, MACD, custom indicators): SC-1's indicator refusal, unchanged until IC-1.
- **A measure the catalog lacks** (put/call ratio, …): "The Screener doesn't have <measure>", with no substitute.
- **Flow fields** (`dp_*`, `opt_*`): **refused, with a stated reason** (agent-lead ruling, 2026-11-01). The owner's
  standing rule is no options flow or dark pool without approval, and ADR-003 is still a draft. The answer says
  "Dark pool and options-flow screens aren't available in UCT Agent yet", never a substitute field. Discovery r05
  ("dark pool prints over $10M") keeps its refusal expectation.
  - **Recorded gap:** today's Agent screener catalog still LISTS these fields through the existing route.
    `filters.field_catalog()` serves `dp_notional_1d` ("Dark Pool Block Notional (1d)", `$`), `dp_prints_1d`,
    `dp_notional_5d`, `dp_level_dist_pct` and the `opt_*` premium fields as filterable. The planner can therefore
    see them in the `fields` context and write a `screener.run` on them. agent-lead is raising this with the owner
    together with F-16. SC-2's deterministic layer will refuse them regardless.

## 7. Where it runs (Sprint 2 task C)

- The deterministic layer is a pure function `intent(message, lastScreen, catalog) → {spec | ask | planner | refuse}`,
  in agent-sc paths, behind the existing flags.
- It is reached from the fast path through ONE hook, which agent-lead wires (`fastPath.js` / `useAgent.js` are
  agent-lead's files).
- It takes the gateway path only when the server says it serves scans: `config.scan` AND `config.data_kinds` listing the scan kind (#621: `UCT_AGENT_DATA_KINDS` is a fail-closed per-kind allowlist). Otherwise the Screener route, as today.
- It reads the catalog the client already loaded. It never makes a network call of its own; the scan itself is the
  normal `screen.run` read.

## 8. Measurement

The corpus (`sc2.json`) holds single-message phrasings and follow-up chains. Each expects one of:
- a spec, written in the Screener's criteria language (`criteria_text`) plus an optional `sort`. For a chain step,
  the expectation is the **whole spec after the step**;
- `ask`, with the slot it is about;
- `planner`;
- `refuse`, with the reason.

**Scored per interpreter** (oracle, grammar-direct, the browser fast path, the deterministic layer and, when an owner
approves a paid run, the planner via SAT-1 §B):
- exact-spec pass rate, by category;
- ask / planner / refuse correctness;
- **false resolves**, which must be 0 for the deterministic layer to ship.

## 9. Changes

These follow MD-1 §8. Draft 0.1 → 1.0 once the owner rules on §4's PROPOSED values (and on §6's recorded catalog gap, via agent-lead).
