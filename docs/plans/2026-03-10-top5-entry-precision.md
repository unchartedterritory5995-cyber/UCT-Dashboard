# Top 5 Actionable Setups — Entry Level Precision

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Top 5 Picks always outputs exactly 5 setups, each with a specific dollar entry level and a classified entry type (PREV DAY HIGH BREAK / PREV LOW RECLAIM / R2G / BASE BREAKOUT), derived from real pre-fetched OHLC data.

**Architecture:** Three-layer change. (1) Scanner enriches each candidate with prev day OHLC already in the fetched DataFrame. (2) Engine batch-fetches prev day OHLC via yfinance for non-scanner candidates (UCT20, earnings gappers, analyst upgrades). (3) AI prompt is updated to mandate entry type classification, specific price levels, and exactly-5 output. Knowledge layer (brain_prompt.txt) gets entry type taxonomy. No frontend CSS changes — existing `rd-pick-field` rows accommodate the new Entry Type field.

**Tech Stack:** Python — `scanner_candidates.py` (uct-intelligence), `morning_wire_engine.py` (morning-wire), `brain_prompt.txt` (uct_intelligence), `yfinance` (already imported in engine at line 22).

---

## Task 1 — Scanner: Add prev day OHLC to candidate output

**Files:**
- Modify: `C:\Users\Patrick\uct-intelligence\scripts\scanner_candidates.py:801-826` (base dict init)
- Modify: `C:\Users\Patrick\uct-intelligence\scripts\scanner_candidates.py:827-881` (data fetch block)

The `_analyze_pullback_candidate()` function already fetches a 60-day OHLCV DataFrame via `MassiveClient().get_daily_bars()`. The scanner runs pre-market, so `df.iloc[-1]` is the previous trading day. The data is available — it just isn't being stored in the output dict.

- [ ] **Step 1: Add prev_day_* keys to the `base` dict initialization (lines 801–826)**

```python
# Add after "apex_days_remaining": None, at line 824:
        "prev_day_open":       None,
        "prev_day_high":       None,
        "prev_day_low":        None,
        "prev_day_close":      None,
```

- [ ] **Step 2: Populate prev day OHLC from DataFrame after the data fetch (after line 837)**

After the `if df is None or df.empty or len(df) < 7:` guard block (after line 837), add:

```python
        # ── Prev day OHLC ─────────────────────────────────────────────────
        try:
            _last = df.iloc[-1]
            base["prev_day_open"]  = round(float(_last["open"]),  2)
            base["prev_day_high"]  = round(float(_last["high"]),  2)
            base["prev_day_low"]   = round(float(_last["low"]),   2)
            base["prev_day_close"] = round(float(_last["close"]), 2)
        except Exception:
            pass  # prev day data is best-effort
```

- [ ] **Step 3: Verify the fields appear in scanner output by running a quick smoke test**

```bash
cd C:\Users\Patrick\uct-intelligence
python -c "
from scripts.scanner_candidates import _analyze_pullback_candidate
r = _analyze_pullback_candidate('NVDA')
print('prev_day_high:', r.get('prev_day_high'))
print('prev_day_low:', r.get('prev_day_low'))
"
```
Expected: two non-None float values.

---

## Task 2 — Engine: Plumb prev day fields through pool builder

**Files:**
- Modify: `C:\Users\Patrick\morning-wire\morning_wire_engine.py` — `generate_top_picks()`, Source 1 `_add()` call (~line 3546) and Source 2 `_add()` call (~line 3559)

The `_add()` helper accepts `**fields` and merges them into the pool. Scanner candidates already carry `prev_day_high` etc. after Task 1. Just pass them through.

- [ ] **Step 1: Update Source 1 (PULLBACK_MA) `_add()` call to pass prev day fields**

Find the `_add(c["ticker"], "PULLBACK_MA", ...)` block (~line 3546). Add four kwargs:

```python
        _add(c["ticker"], "PULLBACK_MA",
             price=c.get("price"), adr_pct=c.get("adr_pct"),
             candle_score=c.get("candle_score"), ema_dist=c.get("ema_distance_pct"),
             pattern_type=c.get("pattern_type"), days_in_pattern=c.get("days_in_pattern"),
             pole_pct=c.get("pole_pct"), vol_acc=c.get("vol_acc_ratio"),
             rs_trend=c.get("rs_trend"), alert_state=c.get("alert_state"),
             earnings_date=c.get("earnings_date"), sector=c.get("sector"),
             setup_type="PULLBACK_MA",
             prev_day_high=c.get("prev_day_high"),
             prev_day_low=c.get("prev_day_low"),
             prev_day_close=c.get("prev_day_close"))
```

- [ ] **Step 2: Update Source 2 (REMOUNT) `_add()` call similarly**

```python
        _add(c["ticker"], "REMOUNT",
             price=c.get("price"), adr_pct=c.get("adr_pct"),
             candle_score=c.get("candle_score"), ema_dist=c.get("ema_distance_pct"),
             pole_pct=c.get("pole_pct"), rs_trend=c.get("rs_trend"),
             alert_state=c.get("alert_state"), sector=c.get("sector"),
             setup_type="REMOUNT",
             prev_day_high=c.get("prev_day_high"),
             prev_day_low=c.get("prev_day_low"),
             prev_day_close=c.get("prev_day_close"))
```

---

## Task 3 — Engine: Batch yfinance fetch for non-scanner candidates

**Files:**
- Modify: `C:\Users\Patrick\morning-wire\morning_wire_engine.py` — `generate_top_picks()`, after Step 3 (pre-filter block, ~line 3625)

Non-scanner candidates (UCT20, earnings gappers, news gappers, analyst upgrades) won't have prev day OHLC from the pool builder. After the pool is ranked, collect tickers missing this data and do a single `yf.download()` call to fill them in. `yfinance` is already imported at line 22 as `yf`.

- [ ] **Step 1: Add the batch fetch block after the `ranked = sorted(...)[:40]` line (~line 3625)**

```python
        # ── Prev day OHLC fill for non-scanner candidates ─────────────────
        _missing = [c["ticker"] for c in ranked if not c.get("prev_day_high")]
        if _missing:
            try:
                _yf_syms = " ".join(_missing) if len(_missing) == 1 else _missing
                _ohlc = yf.download(
                    _yf_syms, period="5d", interval="1d",
                    auto_adjust=True, progress=False, threads=True
                )
                if not _ohlc.empty:
                    # yfinance returns MultiIndex columns when multiple tickers
                    _is_multi = isinstance(_ohlc.columns, __import__('pandas').MultiIndex)
                    for c in ranked:
                        if c.get("prev_day_high"):
                            continue
                        sym = c["ticker"]
                        try:
                            if _is_multi:
                                _h = float(_ohlc["High"][sym].dropna().iloc[-1])
                                _l = float(_ohlc["Low"][sym].dropna().iloc[-1])
                                _o = float(_ohlc["Open"][sym].dropna().iloc[-1])
                                _cl = float(_ohlc["Close"][sym].dropna().iloc[-1])
                            else:
                                # Single ticker — flat columns
                                _h  = float(_ohlc["High"].dropna().iloc[-1])
                                _l  = float(_ohlc["Low"].dropna().iloc[-1])
                                _o  = float(_ohlc["Open"].dropna().iloc[-1])
                                _cl = float(_ohlc["Close"].dropna().iloc[-1])
                            c["prev_day_high"]  = round(_h,  2)
                            c["prev_day_low"]   = round(_l,  2)
                            c["prev_day_open"]  = round(_o,  2)
                            c["prev_day_close"] = round(_cl, 2)
                        except Exception:
                            pass  # symbol not in yfinance — skip
            except Exception as _yf_err:
                print(f"  [top picks] prev day OHLC fetch failed: {_yf_err}")
                # Non-fatal — AI will use available price context
```

- [ ] **Step 2: Verify no crash when pool has mixed scanner + non-scanner candidates**

The try/except blocks ensure this is non-fatal. No test needed beyond visual inspection of the next full engine run.

---

## Task 4 — Engine: Update candidate text formatter to show prev day levels

**Files:**
- Modify: `C:\Users\Patrick\morning-wire\morning_wire_engine.py` — `generate_top_picks()`, candidate text formatter (~lines 3628–3648)

The formatter builds the text lines the AI sees. Add prev day H/L/C to each candidate line so the AI has the exact numbers.

- [ ] **Step 1: Add prev day fields to the formatter block**

In the `for i, c in enumerate(ranked, 1):` loop, after the existing `if c.get("gap_pct"):` line (~line 3643), add:

```python
            if c.get("prev_day_high"):
                parts.append(f"pd_high=${c['prev_day_high']:.2f}  pd_low=${c['prev_day_low']:.2f}  pd_close=${c['prev_day_close']:.2f}")
```

This places prev day OHLC on every line where available, giving the AI concrete numbers to reference in entry levels.

---

## Task 5 — Engine: Update system + user prompts

**Files:**
- Modify: `C:\Users\Patrick\morning-wire\morning_wire_engine.py` — `generate_top_picks()`, `system` variable (~line 3697) and `user` variable (~line 3715)

Two changes: (a) add entry type taxonomy and "always 5" enforcement to the system prompt; (b) add an Entry Type field to the HTML template in the user prompt.

- [ ] **Step 1: Replace the existing `system` string in `generate_top_picks()` (~lines 3697–3713)**

```python
        system = (
            "You are UCT Intelligence — the formal pattern recognition and trade analysis engine "
            "for the Uncharted Territory trading community. You have been trained on the methodologies "
            "of 150+ elite traders including Qullamaggie, Minervini, O'Neil, Oliver Kell, and "
            "Pradeep Bonde. Your task is to SELECT the 5 highest-conviction trade setups from "
            "the candidate pool and write a formal analyst brief for each.\n\n"
            "SELECTION CRITERIA (in order of priority):\n"
            "1. Setup quality — clean technical structure, volume confirmation, orderly action\n"
            "2. Multi-source confirmation — candidates in UCT20 + scanner + earnings score highest\n"
            "3. Regime fit — in Rally Attempt or Confirmed Uptrend, favor liquid leaders and PEGs; "
            "in Downtrend, favor shorts or avoid\n"
            "4. Catalyst strength — earnings beats, news catalysts, and analyst upgrades add conviction\n"
            "5. Risk/reward — ADR must support a clean entry with defined stop\n\n"
            "ALWAYS OUTPUT EXACTLY 5 PICKS. If fewer than 5 high-conviction setups exist today, "
            "fill remaining slots from the candidate pool with lower-conviction watchlist-tier setups "
            "and note the reduced conviction in the narrative. Never output fewer than 5.\n\n"
            "ENTRY TYPE — classify each pick using exactly one of these labels:\n"
            "  PREV DAY HIGH BREAK — entry triggers on a print above prev day's high; momentum "
            "continuation; stock is coiled and the break confirms directional intent.\n"
            "  PREV LOW RECLAIM — entry triggers when price reclaims the previous day's low after "
            "dipping below it; classic shakeout/U&R entry; stop is below the wick low.\n"
            "  RED TO GREEN (R2G) — stock is gapping slightly negative premarket; entry triggers "
            "when price crosses the prior day's close to the upside intraday; converts overnight "
            "weakness into a long signal.\n"
            "  BASE BREAKOUT — entry triggers on a break above a multi-day consolidation high or "
            "pivot point; use when the setup is a flag, wedge, or VCP completing its base.\n"
            "Use the pd_high, pd_low, pd_close values provided per candidate to assign the label "
            "and state the exact trigger price.\n\n"
            "EP vs PEG: Earnings gappers are PEGs. NEVER label a setup 'EP' unless the gap was "
            "caused by a genuine non-earnings episodic catalyst (FDA, contract win, major news) "
            "AND the stock was previously neglected/range-bound AND gapped 10%+ on 2x+ volume. "
            "True EPs are rare — a handful per year market-wide. Default to PEG for earnings gaps.\n\n"
            "Apply UCT methodology strictly. Output ONLY the HTML — no preamble, no explanation."
        )
```

- [ ] **Step 2: Update the HTML template in the `user` string to add an Entry Type field**

Replace the existing `user = (...)` block (~lines 3715–3745). Change the `rd-pick-fields` section to add Entry Type as the first field:

```python
        user = (
            f"Today: {__import__('datetime').date.today()}\n\n"
            f"{candidates_text}\n\n"
            "SELECT exactly 5 setups. For each, output one <div class=\"rd-pick\"> block:\n\n"
            "<div class=\"rd-pick\">\n"
            "  <div class=\"rd-pick-header\">\n"
            "    <hr class=\"rd-pick-hr\">\n"
            "    <span class=\"rd-pick-sym\">TICKER</span>\n"
            "    <hr class=\"rd-pick-hr\">\n"
            "  </div>\n"
            "  <div class=\"rd-pick-body\">\n"
            "    <p class=\"rd-pick-narrative\">3-5 sentence formal analyst narrative. Cover: what the "
            "stock is doing technically, what makes the setup compelling right now, volume context, "
            "which UCT framework or trader methodology it aligns with, and why the timing is right "
            "given the current regime and market phase. Be specific — name price levels, % moves, "
            "volume ratios, days in pattern. Write as a formal analyst briefing to a professional "
            "trading group.</p>\n"
            "    <div class=\"rd-pick-fields\">\n"
            "      <div class=\"rd-pick-field\"><span class=\"rd-pick-flabel\">Entry Type</span>"
            "<span class=\"rd-pick-fval\">PREV DAY HIGH BREAK or PREV LOW RECLAIM or RED TO GREEN or BASE BREAKOUT</span></div>\n"
            "      <div class=\"rd-pick-field\"><span class=\"rd-pick-flabel\">Entry</span>"
            "<span class=\"rd-pick-fval\">exact dollar trigger — e.g. above $47.83 (prev day high) on volume</span></div>\n"
            "      <div class=\"rd-pick-field\"><span class=\"rd-pick-flabel\">Stop</span>"
            "<span class=\"rd-pick-fval\">specific price — base low/EMA/structure + % distance</span></div>\n"
            "      <div class=\"rd-pick-field\"><span class=\"rd-pick-flabel\">Target</span>"
            "<span class=\"rd-pick-fval\">R-target or % upside range</span></div>\n"
            "      <div class=\"rd-pick-field\"><span class=\"rd-pick-flabel\">Invalidation</span>"
            "<span class=\"rd-pick-fval\">what kills the trade before or after entry</span></div>\n"
            "    </div>\n"
            "  </div>\n"
            "</div>\n\n"
            "Output all 5 picks back-to-back. No markdown, no wrapper div, no extra text."
        )
```

Note: the field label changed from "Entry Zone" to "Entry" (cleaner) and "Entry Type" is a new first field. The `rd-pick-flabel` `min-width: 80px` in existing CSS accommodates both labels — no CSS change needed.

---

## Task 6 — Knowledge: brain_prompt.txt entry type taxonomy

**Files:**
- Modify: `C:\Users\Patrick\uct_intelligence\config\prompts\brain_prompt.txt` — ENTRY & EXIT EXECUTION section (~lines 67–74)

Add entry type definitions so the Discord bot correctly labels entries in conversational analysis.

- [ ] **Step 1: Add entry type taxonomy to the ENTRY & EXIT EXECUTION section**

After the `- Scaling out: take partial profits at 1R, 2R, 3R targets` line (~line 73), add:

```
- Entry Type Classification — use exactly one per setup analysis:
  * PREV DAY HIGH BREAK: entry above previous day's high; confirms directional continuation
  * PREV LOW RECLAIM: entry when price reclaims previous day's low after dipping below (U&R)
  * RED TO GREEN (R2G): entry when price crosses prior day's close from below intraday
    (stock gapping slightly negative premarket, converts to positive)
  * BASE BREAKOUT: entry above a multi-day consolidation high or pivot (flag, wedge, VCP apex)
  Always state the exact trigger price when price data is available.
```

---

## Task 7 — CSS: Add Entry Type field label min-width adjustment (optional)

**Files:**
- Modify: `C:\Users\Patrick\uct-dashboard\app\src\pages\MorningWire.module.css` — `.rd-pick-flabel` (~line 263)

"Entry Type" is 10 characters vs "Entry Zone" (10 chars) — same length. No CSS change strictly needed. The existing `min-width: 80px` on `.rd-pick-flabel` handles it. Skip this task unless visual testing shows misalignment.

---

## Verification Checklist

After all tasks are committed:

- [ ] Run scanner smoke test (Task 1 Step 3) — confirms `prev_day_high` populated
- [ ] Run a dry engine run or inspect the `candidates_text` string in `generate_top_picks()` — confirm `pd_high=$xx.xx` appears in candidate lines
- [ ] Inspect generated HTML from `generate_top_picks()` — confirm:
  - Exactly 5 `<div class="rd-pick">` blocks output
  - Each has an "Entry Type" field with one of the 4 valid labels
  - Each "Entry" field contains a specific dollar value (not generic placeholder text)
  - No EP labels on earnings gappers (should be PEG)
- [ ] Check Discord bot `/ask "what's the entry for a prev day high break setup"` — should return a coherent answer referencing the classification
