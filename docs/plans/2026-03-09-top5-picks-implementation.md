# Top 5 Actionable Setups — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite `generate_top_picks()` to draw from all 8 candidate sources, inject UCT KB rules for represented setup types, and produce a formal analyst brief (narrative + 4 structured fields) per pick.

**Architecture:** Single enhanced Claude Sonnet call. Pre-processing builds a unified 40-candidate pool from scanner (PULLBACK_MA/REMOUNT/GAPPER) + UCT20 + earnings gappers + news gappers + sustained leaders + analyst upgrades. KB excerpts for represented setup types injected before the call. New HTML output template renders narrative block + Entry/Stop/Target/Invalidation field rows.

**Tech Stack:** Python (morning_wire_engine.py), Claude claude-sonnet-4-6, UCT Intelligence KB (`uct_brain.get_knowledge()`), HTML/CSS (ut_morning_wire_template.html inline styles)

---

## Key Files

- **Modify:** `C:\Users\Patrick\morning-wire\morning_wire_engine.py` — `AIAnalyst.generate_top_picks()` (lines 3472–3600) + call site (line 3413)
- **Modify:** `C:\Users\Patrick\morning-wire\ut_morning_wire_template.html` — add `.rd-pick` CSS class rules to stylesheet

## Data Available at Call Time

- `_uct_candidates` dict: `candidates.pullback_ma` (30 objects), `candidates.remount` (10), `candidates.gapper_news` (9) — each with fields: `ticker`, `candle_score`, `adr_pct`, `ema_distance_pct`, `pattern_type`, `days_in_pattern`, `pole_pct`, `vol_acc_ratio`, `alert_state`, `rs_trend`, `earnings_date`
- `intel["gappers"]["tier_a"]` and `intel["gappers"]["earnings_gaps"]` — premarket gappers with `ticker`, `change_pct`, `conviction`, `is_peg`, `news`
- `data["leadership"]` — UCT20 with `sym`, `setup_type`, `score`, `confidence_tier`, `regime_fit`, `repeat_count`
- `data["analyst_actions"]` — today's upgrades with `ticker`, `action`, `from_grade`, `to_grade`, `price_target`
- `regime` dict: `phase`, `trend_score`, `dist_spy`, `dist_qqq`
- `breadth` dict: `pct_above_50ma`, `pct_above_200ma`, `breadth_score`
- `uct_brain.get_knowledge(category, tag)` — UCT KB query

---

## Task 1: Add `candidates` parameter to `generate_top_picks()`

**File:** `C:\Users\Patrick\morning-wire\morning_wire_engine.py`

**Step 1: Update the function signature**

Change line 3472 from:
```python
def generate_top_picks(self, data: dict, intel: dict, regime=None, breadth=None,
                       x_ticker_map=None) -> str:
```
To:
```python
def generate_top_picks(self, data: dict, intel: dict, regime=None, breadth=None,
                       x_ticker_map=None, candidates: dict = None) -> str:
```

**Step 2: Update the call site (line 3413)**

Change:
```python
top_picks_html = analyst.generate_top_picks(data, intel, regime=regime, breadth=breadth,
                                            x_ticker_map=x_ticker_map)
```
To:
```python
top_picks_html = analyst.generate_top_picks(data, intel, regime=regime, breadth=breadth,
                                            x_ticker_map=x_ticker_map,
                                            candidates=_uct_candidates)
```

**Step 3: Commit**
```bash
git add morning_wire_engine.py
git commit -m "feat: add candidates param to generate_top_picks signature"
```

---

## Task 2: Build the unified candidate pool

**File:** `C:\Users\Patrick\morning-wire\morning_wire_engine.py`

Replace the entire `# ── Build candidates context ──` block (lines 3483–3548) with the new pool-building logic below.

**Step 1: Write the new pool builder**

Replace from `lines = []` through `candidates_text = "\n".join(lines)` with:

```python
# ── Step 1: Build unified candidate pool ──────────────────────────────────
pool = {}  # ticker -> {fields + source_tags: set}

def _add(ticker: str, source_tag: str, **fields):
    ticker = ticker.upper().strip()
    if not ticker:
        return
    if ticker not in pool:
        pool[ticker] = {"ticker": ticker, "source_tags": set(), **fields}
    else:
        pool[ticker].update({k: v for k, v in fields.items() if v is not None})
    pool[ticker]["source_tags"].add(source_tag)

# Source 1: Scanner PULLBACK_MA
_cands = (candidates or {}).get("candidates", {})
for c in _cands.get("pullback_ma", []):
    if c.get("alert_state") in ("LOW_ADR", "EXTENDED", "NO_DATA"):
        continue
    _add(c["ticker"], "PULLBACK_MA",
         price=c.get("price"), adr_pct=c.get("adr_pct"),
         candle_score=c.get("candle_score"), ema_dist=c.get("ema_distance_pct"),
         pattern_type=c.get("pattern_type"), days_in_pattern=c.get("days_in_pattern"),
         pole_pct=c.get("pole_pct"), vol_acc=c.get("vol_acc_ratio"),
         rs_trend=c.get("rs_trend"), alert_state=c.get("alert_state"),
         earnings_date=c.get("earnings_date"), sector=c.get("sector"),
         setup_type="PULLBACK_MA")

# Source 2: Scanner REMOUNT
for c in _cands.get("remount", []):
    if c.get("alert_state") in ("LOW_ADR", "EXTENDED", "NO_DATA"):
        continue
    _add(c["ticker"], "REMOUNT",
         price=c.get("price"), adr_pct=c.get("adr_pct"),
         candle_score=c.get("candle_score"), ema_dist=c.get("ema_distance_pct"),
         pole_pct=c.get("pole_pct"), rs_trend=c.get("rs_trend"),
         alert_state=c.get("alert_state"), sector=c.get("sector"),
         setup_type="REMOUNT")

# Source 3: Scanner GAPPER_NEWS
for c in _cands.get("gapper_news", []):
    _add(c["ticker"], "GAPPER_NEWS",
         price=c.get("price"), gap_pct=c.get("gap_pct"),
         catalyst_note=c.get("catalyst_note"), sector=c.get("sector"),
         setup_type="GAPPER_NEWS")

# Source 4: UCT20 leaders
_leaders = data.get("leadership", [])
_leader_syms = {l.get("sym", "").upper() for l in _leaders}
for l in _leaders:
    sym = l.get("sym", "").upper()
    _add(sym, "UCT20",
         uct20_score=l.get("score"), confidence_tier=l.get("confidence_tier"),
         regime_fit=l.get("regime_fit"), setup_type=l.get("setup_type"),
         repeat_count=l.get("repeat_count", 0))
    if l.get("repeat_count", 0) >= 3:
        pool.get(sym, {}).setdefault("source_tags", set()).add("SUSTAINED")

# Source 5: Earnings gappers (BMO/AMC today)
_gappers = intel.get("gappers", {})
for g in (_gappers.get("earnings_gaps", []) + _gappers.get("tier_a", [])):
    tags = []
    if g.get("is_peg"):       tags.append("EARNINGS_GAP")
    if g.get("uct20_match"):  tags.append("UCT20")
    source = "EARNINGS_GAP" if g.get("is_peg") else "GAPPER_TIER_A"
    _add(g["ticker"], source,
         gap_pct=g.get("change_pct"), catalyst_note=(g.get("news") or "")[:120],
         gapper_conviction=g.get("conviction"), setup_type="GAPPER_EP" if g.get("is_peg") else "GAPPER")

# Source 6: News catalyst gappers (Finviz movers)
for g in (data.get("premarket_gappers", {}).get("rippers", []))[:10]:
    sym = (g.get("sym") or g.get("ticker", "")).upper()
    if sym and sym not in pool:
        _add(sym, "NEWS_GAPPER",
             gap_pct=g.get("pct"), setup_type="NEWS_GAPPER")

# Source 7: Analyst upgrades today
for a in (data.get("analyst_actions") or []):
    if a.get("action", "").lower() in ("upgrade", "initiated", "reiterated"):
        _add(a.get("ticker", "").upper(), "ANALYST_UPGRADE",
             upgrade_to=a.get("to_grade"), price_target=a.get("price_target"))

# ── Step 2: Compute cross-confirmation composite score ───────────────────
def _composite(c: dict) -> float:
    score = 0.0
    tags = c.get("source_tags", set())
    score += len(tags) * 15          # multi-source = big bonus
    score += min(c.get("candle_score") or 0, 100) * 0.4
    score += min(c.get("uct20_score") or 0, 100) * 0.3
    if "SUSTAINED" in tags:     score += 20
    if "EARNINGS_GAP" in tags:  score += 25
    if "UCT20" in tags:         score += 15
    if c.get("rs_trend") == "up": score += 10
    if c.get("alert_state") in ("READY", "WATCH"): score += 10
    return score

for ticker, c in pool.items():
    c["_composite"] = _composite(c)

# ── Step 3: Pre-filter + cap at top 40 ───────────────────────────────────
ranked = sorted(pool.values(), key=lambda x: x["_composite"], reverse=True)[:40]

# ── Step 4: Build candidate text for AI ──────────────────────────────────
def _fmt_tags(c):
    return " · ".join(sorted(c.get("source_tags", set())))

lines = []
lines.append(f"CANDIDATE POOL ({len(ranked)} stocks ranked by composite score):\n")
for i, c in enumerate(ranked, 1):
    tags_str = _fmt_tags(c)
    parts = [f"{i:2d}. {c['ticker']:<6}  [{tags_str}]"]
    if c.get("setup_type"):    parts.append(f"setup={c['setup_type']}")
    if c.get("price"):         parts.append(f"px=${c['price']:.2f}")
    if c.get("adr_pct"):       parts.append(f"ADR={c['adr_pct']:.1f}%")
    if c.get("candle_score"):  parts.append(f"score={c['candle_score']}")
    if c.get("ema_dist") is not None: parts.append(f"ema_dist={c['ema_dist']:.1f}%")
    if c.get("pattern_type"):  parts.append(f"pattern={c['pattern_type']}({c.get('days_in_pattern','?')}d)")
    if c.get("pole_pct"):      parts.append(f"prior_run={c['pole_pct']:.0f}%")
    if c.get("gap_pct"):       parts.append(f"gap={c['gap_pct']:+.1f}%")
    if c.get("catalyst_note"): parts.append(f"catalyst={c['catalyst_note'][:80]}")
    if c.get("uct20_score"):   parts.append(f"uct20_score={c['uct20_score']:.1f} conf={c.get('confidence_tier','')}")
    if c.get("rs_trend"):      parts.append(f"rs={c['rs_trend']}")
    if c.get("alert_state"):   parts.append(f"alert={c['alert_state']}")
    lines.append("  " + "  ".join(parts))
lines.append("")

# Regime + breadth
if regime:
    lines.append(f"REGIME: {regime.get('phase','?')} | Trend {regime.get('trend_score',5)}/10"
                 f" | SPY dist days: {regime.get('dist_spy',0)} | QQQ: {regime.get('dist_qqq',0)}")
if breadth:
    lines.append(f"BREADTH: {breadth.get('pct_above_50ma','?')}% above 50MA"
                 f" | {breadth.get('pct_above_200ma','?')}% above 200MA"
                 f" | Score {breadth.get('breadth_score',50):.0f}/100")
lines.append("")
```

**Step 2: Commit**
```bash
git add morning_wire_engine.py
git commit -m "feat: build unified 8-source candidate pool for top 5 picks"
```

---

## Task 3: Inject UCT KB excerpts for represented setup types

**File:** `C:\Users\Patrick\morning-wire\morning_wire_engine.py`

Add this block immediately after the candidate pool lines are built (after `lines.append("")` for breadth), before `candidates_text = "\n".join(lines)`:

```python
# ── Step 5: KB injection for represented setup types ─────────────────────
_setup_types_present = {c.get("setup_type") for c in ranked if c.get("setup_type")}
# Map scanner setup_type values to UCT KB tags
_setup_to_kb_tag = {
    "PULLBACK_MA": "PULLBACK",
    "REMOUNT":     "REMOUNT",
    "GAPPER_EP":   "EP",
    "EARNINGS_GAP":"EP",
    "GAPPER":      "GAPPER",
    "GAPPER_NEWS": "GAPPER",
    "NEWS_GAPPER": "GAPPER",
}
_kb_tags_to_fetch = list({_setup_to_kb_tag.get(s, s) for s in _setup_types_present if s})
_kb_chunks = []
_kb_budget  = 1500
try:
    for _tag in _kb_tags_to_fetch[:4]:  # max 4 setup types
        _kb_results = uct_brain.get_knowledge(category="SETUP", tag=_tag, limit=3)
        if not _kb_results:
            _kb_results = uct_brain.get_knowledge(tag=_tag, limit=2)
        for _kb in _kb_results[:2]:
            _chunk = (_kb.get("content") or "")[:350]
            if _chunk:
                _kb_chunks.append(f"[{_tag}] {_chunk}")
        if sum(len(x) for x in _kb_chunks) >= _kb_budget:
            break
    if _kb_chunks:
        kb_text = "\n".join(_kb_chunks)[:_kb_budget]
        lines.append(f"UCT KNOWLEDGE BASE — METHODOLOGY FOR PRESENT SETUPS:\n{kb_text}\n")
except Exception as _kb_err:
    pass  # KB injection is best-effort

candidates_text = "\n".join(lines)
```

**Step 3: Commit**
```bash
git add morning_wire_engine.py
git commit -m "feat: inject UCT KB excerpts for represented setup types into top 5 prompt"
```

---

## Task 4: Rewrite system prompt, user prompt, and output HTML template

**File:** `C:\Users\Patrick\morning-wire\morning_wire_engine.py`

Replace the `system`, `user`, and `result` block (lines 3553–3600) entirely:

**Step 1: Replace system prompt, user prompt, and HTML wrapper**

```python
if not candidates_text.strip():
    print("  [top picks] No candidates available — skipping")
    return ""

system = (
    "You are UCT Intelligence — the formal pattern recognition and trade analysis engine "
    "for the Uncharted Territory trading community. You have been trained on the methodologies "
    "of 150+ elite traders including Qullamaggie, Minervini, O'Neil, Oliver Kell, and "
    "Pradeep Bonde. Your task is to SELECT the 5 highest-conviction trade setups from "
    "the candidate pool and write a formal analyst brief for each.\n\n"
    "SELECTION CRITERIA (in order of priority):\n"
    "1. Setup quality — clean technical structure, volume confirmation, orderly action\n"
    "2. Multi-source confirmation — candidates in UCT20 + scanner + earnings score highest\n"
    "3. Regime fit — in Rally Attempt or Confirmed Uptrend, favor liquid leaders and EPs; "
    "in Downtrend, favor shorts or avoid\n"
    "4. Catalyst strength — earnings beats, news catalysts, and analyst upgrades add conviction\n"
    "5. Risk/reward — ADR must support a clean entry with defined stop\n\n"
    "NEVER label a setup 'EP' unless: (a) stock was genuinely neglected/range-bound before "
    "the gap, (b) gapped 10%+ on 2× average volume, (c) there is a genuine catalyst surprise. "
    "Apply UCT methodology strictly. Output ONLY the HTML — no preamble, no explanation."
)

user = (
    f"Today: {__import__('datetime').date.today()}\n\n"
    f"{candidates_text}\n\n"
    "SELECT the 5 best setups. For each, output one <div class=\"rd-pick\"> block:\n\n"
    "<div class=\"rd-pick\">\n"
    "  <div class=\"rd-pick-header\">\n"
    "    <span class=\"rd-pick-num\">1</span>\n"
    "    <span class=\"rd-pick-sym\">TICKER</span>\n"
    "    <span class=\"rd-pick-setup\">Setup Type — Full Name</span>\n"
    "    <span class=\"rd-pick-conv g\">HIGH</span>\n"
    "    <span class=\"rd-pick-tags\">UCT20 · PULLBACK_MA · SUSTAINED</span>\n"
    "  </div>\n"
    "  <div class=\"rd-pick-body\">\n"
    "    <p class=\"rd-pick-narrative\">3–5 sentence formal analyst narrative. Cover: what the "
    "stock is doing technically, what makes the setup compelling right now, volume context, "
    "which UCT framework or trader methodology it aligns with, and why the timing is right "
    "given the current regime and market phase. Be specific — name price levels, % moves, "
    "volume ratios, days in pattern. Write as a formal analyst briefing to a professional "
    "trading group.</p>\n"
    "    <div class=\"rd-pick-fields\">\n"
    "      <div class=\"rd-pick-field\"><span class=\"rd-pick-flabel\">Entry Zone</span>"
    "<span class=\"rd-pick-fval\">specific price level or trigger condition</span></div>\n"
    "      <div class=\"rd-pick-field\"><span class=\"rd-pick-flabel\">Stop</span>"
    "<span class=\"rd-pick-fval\">specific price — base low/EMA/structure + % distance</span></div>\n"
    "      <div class=\"rd-pick-field\"><span class=\"rd-pick-flabel\">Target</span>"
    "<span class=\"rd-pick-fval\">R-target or % upside range</span></div>\n"
    "      <div class=\"rd-pick-field\"><span class=\"rd-pick-flabel\">Invalidation</span>"
    "<span class=\"rd-pick-fval\">what kills the trade before or after entry</span></div>\n"
    "    </div>\n"
    "  </div>\n"
    "</div>\n\n"
    "Use class='g' for HIGH conviction, class='w' for MEDIUM, class='rd-dim' for WATCH.\n"
    "rd-pick-tags: list the source tags for that pick (e.g. UCT20 · HTF · SUSTAINED).\n"
    "Output all 5 picks back-to-back. No markdown, no wrapper div, no extra text."
)

result = self._call(system, user, max_tokens=2000, model="claude-sonnet-4-6", timeout=60)
print(f"  OK Top 5 Picks in {time.time()-t0:.1f}s")
if not result:
    return ""

# Wrap in titled section
header = (
    '<div class="rd-top-picks-header">'
    'Top 5 Actionable Setups — UCT Intelligence'
    '</div>'
    '<div class="rd-top-picks-grid">'
)
footer = '</div>'
return header + result.strip() + footer
```

**Step 2: Commit**
```bash
git add morning_wire_engine.py
git commit -m "feat: rewrite top 5 system prompt, user prompt, and output template"
```

---

## Task 5: Add CSS for new card layout to template

**File:** `C:\Users\Patrick\morning-wire\ut_morning_wire_template.html`

Find the existing `.rd-dim` rule (line ~490) in the `<style>` block and add these rules immediately after it:

```css
/* ── Top 5 Picks ── */
.rd-top-picks-header{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin:18px 0 10px;border-top:1px solid var(--border);padding-top:14px}
.rd-top-picks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:16px}
.rd-pick{background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.rd-pick-header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rd-pick-num{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-muted);font-weight:700;min-width:16px}
.rd-pick-sym{font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:700;color:var(--ut-cream)}
.rd-pick-setup{font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--text-muted);letter-spacing:.05em;flex:1}
.rd-pick-conv{font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.08em;padding:2px 6px;border-radius:3px;border:1px solid currentColor}
.rd-pick-conv.g{color:var(--gain)}
.rd-pick-conv.w{color:var(--warn)}
.rd-pick-conv.rd-dim{color:var(--text-muted)}
.rd-pick-tags{font-family:'IBM Plex Mono',monospace;font-size:8px;color:var(--text-muted);width:100%;letter-spacing:.04em}
.rd-pick-body{display:flex;flex-direction:column;gap:6px}
.rd-pick-narrative{font-family:'Instrument Sans',sans-serif;font-size:11px;line-height:1.55;color:var(--text);margin:0}
.rd-pick-fields{display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--border);padding-top:6px;margin-top:2px}
.rd-pick-field{display:flex;gap:6px;align-items:baseline}
.rd-pick-flabel{font-family:'IBM Plex Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.08em;color:var(--text-muted);text-transform:uppercase;min-width:72px;flex-shrink:0}
.rd-pick-fval{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text-bright)}
```

**Step 3: Commit**
```bash
git add ut_morning_wire_template.html
git commit -m "feat: add rd-pick CSS classes for new Top 5 card layout"
```

---

## Task 6: Test end-to-end

**Step 1: Run the engine**
```bash
cd C:\Users\Patrick\morning-wire
python morning_wire_engine.py
```

**Expected output:**
```
AI: Generating Top 5 Picks...
  OK Top 5 Picks in XX.Xs
```

Check that:
- "Top 5 Picks" section shows 5 cards with narrative paragraphs
- Each card has: header with ticker + setup type + conviction badge + source tags
- Each card has: narrative paragraph + 4 field rows (Entry Zone / Stop / Target / Invalidation)
- Cards are NOT from EXTENDED or LOW_ADR candidates
- Cards with UCT20 + scanner overlap show both tags

**Step 2: Verify candidate pool in output**

Temporarily add `print(f"  [top picks] Pool: {[c['ticker'] for c in ranked]}")` before the AI call to confirm the right 40 candidates are in the pool. Remove after verification.

**Step 3: Push to Railway**

Engine auto-pushes on completion. Verify at `https://web-production-05cb6.up.railway.app` → Morning Wire tab → Top 5 Picks section.

**Step 4: Commit**
```bash
git add morning_wire_engine.py
git commit -m "feat: top 5 picks redesign complete — 8-source pool + KB injection + formal brief"
```

---

## Rollback

If the engine fails during `generate_top_picks()`, the function returns `""` gracefully — the rest of the Morning Wire renders normally. No data loss risk.
