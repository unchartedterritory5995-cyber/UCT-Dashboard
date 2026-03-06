# UCT 20 Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the UCT 20 page with a click-to-expand card layout and richer structured AI analysis covering company description, catalyst, price action, and entry/stop/target levels.

**Architecture:** Change the AI thesis prompt to output structured JSON (7 fields per stock). Update the result-building code to store and pass those fields through wire_data. Redesign the frontend with collapsed rows and expandable sections.

**Tech Stack:** Python (morning_wire_engine.py), React + CSS Modules (UCT20.jsx / UCT20.module.css)

---

### Task 1: Update the AI prompt in `generate_leadership_theses()`

**File:** `C:\Users\Patrick\morning-wire\morning_wire_engine.py`
**Lines:** 3010–3021 (the instruction block at the end of `system`) and line 3038 (max_tokens)

**Step 1: Replace the instruction block (lines 3010–3021)**

Find this block (starts with `"For each stock write exactly 2-3 sentences..."`):

```python
"For each stock write exactly 2-3 sentences as the thesis value. "
"Sentence 1 — Setup + Catalyst: Identify the setup archetype ..."
...
"Return ONLY a JSON array: [{\"sym\":\"NVDA\",\"thesis\":\"[EP] Sent1. Sent2. Sent3.\"}, ...]. No markdown."
```

Replace with:

```python
"For each stock write a structured analysis with exactly these 7 fields:\n"
"• setup_type: the best-fit setup label (EP/HTF/VCP/Pocket-Pivot/Momentum-Burst/Breakout/"
"Cup-Handle/Stage2/Earnings-Gap/Flat-Base/Coiling/PDH-Break/Shakeout/ORB/Capitulation/"
"Parabolic-Short/Red-to-Green) — no brackets, just the label.\n"
"• company_desc: 2-3 sentences. What does this company do? What macro/secular force is "
"driving it RIGHT NOW? Name the specific product, service, or theme creating the opportunity "
"(e.g. 'hyperscaler AI capex', 'gold supercycle', 'reshoring defense spend'). Be specific.\n"
"• catalyst: 2-3 sentences. What is the specific catalyst — earnings beat (with actual % numbers), "
"analyst upgrade, partnership, FDA approval, contract win, macro event? When did it occur? "
"What was the market reaction? If no recent catalyst, describe the structural sector tailwind.\n"
"• price_action: 3-4 sentences. Describe the chart setup: base type and duration, EMA alignment "
"(LEAD = 9>21>50, MEDIOCRE, or LAG), volume character (accumulation/contraction/distribution), "
"proximity to 52W high, and the precise entry trigger (PDH break, ORH, pocket pivot, EMA pullback). "
"Be specific — name price levels where known.\n"
"• entry: one line. Entry trigger and approximate price level "
"(e.g. 'PDH break above $58.40 on 2×+ average volume').\n"
"• stop: one line. Exact stop condition and level "
"(e.g. 'Close below 21EMA / $54.20 base low').\n"
"• target_1: price target for first partial exit (e.g. '$66.00 — prior resistance').\n"
"• target_2: extended price target (e.g. '$74.00 — measured move').\n\n"
"Also include a 'thesis' field: a single string combining setup_type in brackets + "
"one sentence from company_desc + one sentence from price_action + the stop condition. "
"Format: '[EP] Company does X driven by Y. Chart is Z. Thesis fails on W.'\n\n"
"Use specific trading language. No fluff. Cite actual numbers wherever possible.\n"
"Return ONLY a JSON array — no markdown, no prose outside JSON:\n"
"[{\"sym\":\"NVDA\",\"setup_type\":\"EP\",\"company_desc\":\"...\",\"catalyst\":\"...\","
"\"price_action\":\"...\",\"entry\":\"...\",\"stop\":\"...\","
"\"target_1\":\"...\",\"target_2\":\"...\",\"thesis\":\"[EP] ...\"}, ...]"
```

**Step 2: Increase max_tokens at line 3038**

```python
# Before:
result = self._call(system, user_msg, max_tokens=2500, model="claude-sonnet-4-6", timeout=60)

# After:
result = self._call(system, user_msg, max_tokens=5000, model="claude-sonnet-4-6", timeout=90)
```

**Step 3: Expand KB context — line 2903**

```python
# Before:
_brain_kb_ctx = uct_brain.get_brain_context(setup_types=None, max_chars=1500)

# After:
_brain_kb_ctx = uct_brain.get_brain_context(setup_types=None, max_chars=3000)
```

**Step 4: Verify syntax**

```bash
cd C:\Users\Patrick\morning-wire
python -c "import ast; ast.parse(open('morning_wire_engine.py', encoding='utf-8').read()); print('OK')"
```

Expected: `OK`

**Step 5: Commit**

```bash
git add morning_wire_engine.py
git commit -m "feat: structured AI analysis prompt for UCT Leadership 20"
```

---

### Task 2: Update JSON parsing and result building

**File:** `C:\Users\Patrick\morning-wire\morning_wire_engine.py`
**Lines:** 1024–1064

**Step 1: Replace the theses_map building (lines 1024–1027)**

Find:
```python
theses_map = {}
if analyst:
    theses = analyst.generate_leadership_theses(top20)
    theses_map = {t["sym"]: t["thesis"] for t in (theses or []) if "sym" in t}
```

Replace with:
```python
theses_map = {}
if analyst:
    theses = analyst.generate_leadership_theses(top20)
    theses_map = {t["sym"]: t for t in (theses or []) if "sym" in t}
```

**Step 2: Update setup_type extraction (lines 1030–1036)**

Find:
```python
import re as _re_setup
_TAG_RE = _re_setup.compile(r'^\[([A-Za-z0-9\-]+)\]\s*')
setup_type_map = {}
for sym, thesis in theses_map.items():
    m = _TAG_RE.match(thesis)
    if m:
        setup_type_map[sym] = m.group(1)
```

Replace with:
```python
import re as _re_setup
_TAG_RE = _re_setup.compile(r'^\[([A-Za-z0-9\-]+)\]\s*')
setup_type_map = {}
for sym, t in theses_map.items():
    # New structured format stores setup_type directly
    if isinstance(t, dict) and t.get("setup_type"):
        setup_type_map[sym] = t["setup_type"]
    else:
        # Legacy fallback: extract from [TAG] prefix in thesis string
        thesis_str = t.get("thesis", "") if isinstance(t, dict) else str(t)
        m = _TAG_RE.match(thesis_str)
        if m:
            setup_type_map[sym] = m.group(1)
```

**Step 3: Update result building (lines 1044–1064)**

Find:
```python
result = []
for rank, s in enumerate(top20, 1):
    result.append({
        "rank":           rank,
        "sym":            s["sym"],
        "company":        s["company"],
        "sector":         s["sector"],
        "price":          round(s.get("price") or 0, 2),
        "change":         round(s.get("change") or 0, 2),
        "score":          round(s["composite"], 1),
        "rs":             round(s["rs_score"], 1),
        "earn":           round(s.get("earn_raw_pct", 50), 1),
        "tech":           round(s["tech_score"], 1),
        "pct_hi":         round(s.get("pct_from_hi", 0), 1),
        "thesis":         theses_map.get(s["sym"], ""),
        "setup_type":     setup_type_map.get(s["sym"], ""),
        "catalyst":       s.get("seeded", False),
        "catalyst_note":  s.get("catalyst_note", ""),
        "catalyst_brief": catalyst_briefs.get(s["sym"], ""),
        "repeat_count":   0,
    })
```

Replace with:
```python
result = []
for rank, s in enumerate(top20, 1):
    _t = theses_map.get(s["sym"], {})
    _t = _t if isinstance(_t, dict) else {}
    # thesis fallback: join sections if new format present, else use legacy string
    _thesis_str = _t.get("thesis") or " ".join(filter(None, [
        _t.get("company_desc", ""), _t.get("price_action", ""), _t.get("stop", "")
    ])) or ""
    result.append({
        "rank":           rank,
        "sym":            s["sym"],
        "company":        s["company"],
        "sector":         s["sector"],
        "price":          round(s.get("price") or 0, 2),
        "change":         round(s.get("change") or 0, 2),
        "score":          round(s["composite"], 1),
        "rs":             round(s["rs_score"], 1),
        "earn":           round(s.get("earn_raw_pct", 50), 1),
        "tech":           round(s["tech_score"], 1),
        "pct_hi":         round(s.get("pct_from_hi", 0), 1),
        "thesis":         _thesis_str,
        "setup_type":     setup_type_map.get(s["sym"], ""),
        "catalyst":       s.get("seeded", False),
        "catalyst_note":  s.get("catalyst_note", ""),
        "catalyst_brief": catalyst_briefs.get(s["sym"], ""),
        "repeat_count":   0,
        # Structured analysis fields (new)
        "company_desc":   _t.get("company_desc", ""),
        "catalyst_text":  _t.get("catalyst", ""),
        "price_action":   _t.get("price_action", ""),
        "entry":          _t.get("entry", ""),
        "stop":           _t.get("stop", ""),
        "target_1":       _t.get("target_1", ""),
        "target_2":       _t.get("target_2", ""),
    })
```

Note: use `catalyst_text` (not `catalyst`) to avoid collision with the existing boolean `catalyst` field.

**Step 4: Verify syntax**

```bash
python -c "import ast; ast.parse(open('morning_wire_engine.py', encoding='utf-8').read()); print('OK')"
```

**Step 5: Commit**

```bash
git add morning_wire_engine.py
git commit -m "feat: extract structured analysis fields from AI thesis output"
```

---

### Task 3: Redesign `UCT20.jsx`

**File:** `C:\Users\Patrick\uct-dashboard\app\src\pages\UCT20.jsx`

Replace the entire file content:

```jsx
// app/src/pages/UCT20.jsx
import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../components/TileCard'
import TickerPopup from '../components/TickerPopup'
import styles from './UCT20.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function SetupBadge({ type }) {
  if (!type) return null
  return <span className={styles.setupBadge}>{type}</span>
}

function TradeBar({ entry, stop, target1, target2 }) {
  if (!entry && !stop && !target1) return null
  return (
    <div className={styles.tradeBar}>
      {entry   && <div className={styles.tradeItem}><span className={styles.tradeLabel}>ENTRY</span><span className={styles.tradeVal}>{entry}</span></div>}
      {stop    && <div className={styles.tradeItem}><span className={styles.tradeLabel}>STOP</span><span className={`${styles.tradeVal} ${styles.tradeStop}`}>{stop}</span></div>}
      {(target1 || target2) && (
        <div className={styles.tradeItem}>
          <span className={styles.tradeLabel}>TARGET</span>
          <span className={`${styles.tradeVal} ${styles.tradeTarget}`}>
            {[target1, target2].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
    </div>
  )
}

function StockCard({ item, rank, expanded, onToggle }) {
  const sym          = item.ticker ?? item.sym ?? item.symbol ?? '—'
  const score        = item.score ?? item.rs_score ?? null
  const company      = item.company ?? ''
  const setupType    = item.setup_type ?? ''
  const hasStructured = !!(item.company_desc || item.catalyst_text || item.price_action)
  const legacyThesis  = item.thesis ?? ''

  return (
    <div className={styles.card}>
      {/* Collapsed row — always visible */}
      <div className={styles.cardRow} onClick={onToggle}>
        <span className={styles.rank}>#{rank}</span>
        <SetupBadge type={setupType} />
        <TickerPopup sym={sym}>
          <span className={styles.sym}>{sym}</span>
        </TickerPopup>
        {company && <span className={styles.companyName}>{company}</span>}
        <div className={styles.cardRowRight}>
          {score != null && (
            <span className={styles.score}>UCT Rating {score.toFixed ? score.toFixed(1) : score}</span>
          )}
          <span className={styles.caret}>{expanded ? '▾' : '▸'}</span>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className={styles.expanded}>
          {hasStructured ? (
            <>
              {item.company_desc && (
                <p className={styles.companyDesc}>{item.company_desc}</p>
              )}
              {item.catalyst_text && (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>CATALYST</span>
                  <p className={styles.sectionText}>{item.catalyst_text}</p>
                </div>
              )}
              {item.price_action && (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>PRICE ACTION</span>
                  <p className={styles.sectionText}>{item.price_action}</p>
                </div>
              )}
              <TradeBar
                entry={item.entry}
                stop={item.stop}
                target1={item.target_1}
                target2={item.target_2}
              />
            </>
          ) : legacyThesis ? (
            <p className={styles.legacyThesis}>{legacyThesis}</p>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default function UCT20() {
  const { data: rows, mutate } = useSWR('/api/leadership', fetcher, { refreshInterval: 3600000 })
  const [expandedIdx, setExpandedIdx] = useState(null)

  const stocks = Array.isArray(rows) ? rows.slice(0, 20) : []

  function toggle(i) {
    setExpandedIdx(prev => prev === i ? null : i)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>UCT 20</h1>
        <button className={styles.refreshBtn} onClick={() => mutate()}>Refresh</button>
      </div>
      <TileCard title="Leadership 20 — Current Top Setups">
        {!rows ? (
          <p className={styles.loading}>Loading…</p>
        ) : stocks.length === 0 ? (
          <p className={styles.loading}>No leadership data yet. Run the Morning Wire engine to populate.</p>
        ) : (
          <div className={styles.list}>
            {stocks.map((item, i) => (
              <StockCard
                key={item.ticker ?? item.sym ?? i}
                item={item}
                rank={i + 1}
                expanded={expandedIdx === i}
                onToggle={() => toggle(i)}
              />
            ))}
          </div>
        )}
      </TileCard>
    </div>
  )
}
```

**Step 2: Verify no import errors**

```bash
cd C:\Users\Patrick\uct-dashboard\app && npm run build 2>&1 | tail -20
```

Expected: no errors (warnings OK).

**Step 3: Commit**

```bash
cd C:\Users\Patrick\uct-dashboard
git add app/src/pages/UCT20.jsx
git commit -m "feat: UCT20 click-to-expand cards with structured analysis sections"
```

---

### Task 4: Redesign `UCT20.module.css`

**File:** `C:\Users\Patrick\uct-dashboard\app\src\pages\UCT20.module.css`

Replace the entire file:

```css
.page { padding: 20px 24px; }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.heading { font-family: 'Cinzel', serif; font-size: 22px; font-weight: 800; color: var(--ut-gold); letter-spacing: 4px; text-transform: uppercase; }
.refreshBtn { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 1px; background: var(--bg-elevated); color: var(--ut-green-bright); border: 1px solid var(--ut-green); border-radius: 6px; padding: 6px 14px; cursor: pointer; transition: background 0.15s; }
.refreshBtn:hover { background: var(--ut-green-dim); }
.loading { color: var(--text-muted); font-size: 13px; padding: 8px 0; }
.list { display: flex; flex-direction: column; }

/* ── Card ── */
.card { border-bottom: 1px solid var(--border); }
.card:last-child { border-bottom: none; }

/* ── Collapsed row ── */
.cardRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  cursor: pointer;
  user-select: none;
  transition: background 0.1s;
}
.cardRow:hover { background: rgba(255,255,255,0.02); }

.rank { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 700; color: var(--text-muted); min-width: 26px; }

.setupBadge {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--ut-gold);
  border: 1px solid var(--ut-gold);
  border-radius: 3px;
  padding: 1px 5px;
  white-space: nowrap;
}

.sym { font-family: 'IBM Plex Mono', monospace; font-size: 15px; font-weight: 800; color: var(--ut-cream); cursor: pointer; }
.sym:hover { color: var(--ut-green-bright); }

.companyName { font-family: 'Instrument Sans', sans-serif; font-size: 11px; color: var(--text-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cardRowRight { display: flex; align-items: center; gap: 10px; margin-left: auto; flex-shrink: 0; }
.score { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 700; color: var(--ut-green-bright); }
.caret { font-size: 11px; color: var(--text-muted); }

/* ── Expanded section ── */
.expanded {
  padding: 0 4px 14px 36px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.companyDesc {
  font-family: 'Instrument Sans', sans-serif;
  font-size: 13px;
  color: var(--text);
  line-height: 1.6;
  margin: 0;
}

.section { display: flex; flex-direction: column; gap: 4px; }

.sectionLabel {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--text-muted);
}

.sectionText {
  font-family: 'Instrument Sans', sans-serif;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0;
}

/* ── Trade bar ── */
.tradeBar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  margin-top: 2px;
}

.tradeItem { display: flex; flex-direction: column; gap: 2px; }
.tradeLabel { font-family: 'IBM Plex Mono', monospace; font-size: 8px; font-weight: 700; letter-spacing: 1px; color: var(--text-muted); }
.tradeVal { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 700; color: var(--text); }
.tradeStop { color: var(--loss); }
.tradeTarget { color: var(--ut-green-bright); }

/* ── Legacy fallback ── */
.legacyThesis { font-family: 'Instrument Sans', sans-serif; font-size: 12px; color: var(--text-muted); line-height: 1.5; margin: 0; }
```

**Step 2: Build check**

```bash
cd C:\Users\Patrick\uct-dashboard\app && npm run build 2>&1 | tail -10
```

Expected: clean build.

**Step 3: Commit + push**

```bash
cd C:\Users\Patrick\uct-dashboard
git add app/src/pages/UCT20.module.css
git commit -m "feat: UCT20 expanded card styles — sections, trade bar, setup badge"
git push origin master
```

---

### Task 5: Verify end-to-end

**Step 1: Test the backend prompt change in isolation**

Add a quick test by running the engine in dry-run mode if available, or verify by inspecting the new prompt string length:

```bash
cd C:\Users\Patrick\morning-wire
python -c "
import morning_wire_engine as e
a = e.AIAnalyst.__new__(e.AIAnalyst)
# Check that the new output fields are in the instruction string
src = open('morning_wire_engine.py', encoding='utf-8').read()
assert 'company_desc' in src, 'company_desc missing from prompt'
assert 'catalyst_text' in src or 'catalyst_text' in src, 'field missing'
assert 'price_action' in src, 'price_action missing'
assert 'target_1' in src, 'target_1 missing'
print('All new fields present in source')
"
```

**Step 2: Verify Railway deployment**

After push, check Railway build logs. Confirm `https://web-production-05cb6.up.railway.app` loads without errors.

**Step 3: Verify UCT 20 page**

- Open the dashboard → UCT 20 tab
- Confirm 20 compact rows visible (rank · badge · ticker · company · rating · ▸)
- Click any row → expands with Company / Catalyst / Price Action sections + trade bar
- Click again → collapses
- Clicking a different row → previous one closes, new one opens
- If wire_data has old-format thesis → legacy fallback renders correctly

**Step 4: Next engine run**

After the next Morning Wire engine run (7:35 AM ET or manual):
- Check `wire_data.json` → leadership entries should have `company_desc`, `catalyst_text`, `price_action`, `entry`, `stop`, `target_1`, `target_2` fields
- Dashboard UCT 20 → expanded cards show full structured analysis
