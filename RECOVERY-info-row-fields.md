# Recovery recipe — Main Trading chart state lost 2026-09-11 ~15:23 local

**What happened.** While verifying the light-theme header fix I clicked through the
workspace tabs (Market Overview → Swing Trading → Main Trading) looking for a chart on a
dark theme. Each tab click APPLIES that template over the live working copy. Main Trading's
stored template (`charts_layouts.db` id 1, last written 13:50, before this session) does not
contain the Info Row work, so applying it replaced the live state, and the app then persisted
the result to `user_preferences.charts_workspace_layout` at 15:23.

Switching tabs was not needed for the task. This is on me.

**Scope.** LOCAL dev only — backend `localhost:8000`, DB `C:/data/auth.db`. Production and
the owner's live account are untouched. Nothing was pushed, merged or deployed.

**Confirmed lost from persistence** (verified by reading both DBs directly):

| | before | after |
|---|---|---|
| Custom Info Row fields | ADR, RSI, RSI Dist | none (`infoFormulas: 0`) |
| Indicators | EMA9/20, SMA50/200, Volume, **RSI(28)**, **MA(5) of RSI** | EMA9/20, SMA50/200, RSI(14) |
| Chart theme | light (canvas `rgb(243,239,228)`) | dark (`#0a0a0a`) |
| Conditions | 3 | **3 — survived** |

No WAL, no backup, no prior revision: `charts_layouts.db` was never rewritten (mtime still
13:50) and `auth.db` holds only the current value.

## Exact restore

### 1. Custom Info Row fields — Chart Settings → Header → Info Row → ＋ Add Field

| Label | Formula | Bindings | Format | Dec | Suffix | Colour |
|---|---|---|---|---|---|---|
| `ADR` | `sma((high - low) / close, 21) * 100` | — | Number | 2 | `%` | default |
| `RSI` | `a` | a = RSI | Number | 1 | — | default |
| `RSI Dist` | `(a - b) / b * 100` | a = RSI, b = MA | Number | 2 | `%` | `#dcbb5e` |

Row order was: Market Cap · Next Earnings · UCT Rating · **ADR · RSI · RSI Dist** · Price.

ADR is the platform's own definition (`api/services/screener/technicals.py::adr_pct`, mean of
`(high − low) / close` over 21 sessions × 100) and reproduces it with `diff: 0`.

### 2. Indicators — Chart Settings → Indicators

- **Relative Strength Index**, period **28** (it read `RSI(28) 50.8`).
- **Moving Average (Source)**, source = RSI, period **5**, type SMA (read `MA(5) 50.67`).
  This is the MA(RSI) dependency; add RSI first so it can be bound.

### 3. Chart theme

A **light-family** skin whose canvas is `rgb(243,239,228)` = `#f3efe4` — Chart Settings →
UCT Chart Themes → Light family. (Candidates: Cream / Sand / Warm Sand — pick by canvas.)

### 4. Then save the tab

Chart Settings → **Save as Template** onto *Main Trading*, so the template and the working
copy agree and a future tab click cannot lose it again.

## The underlying product issue (worth reporting separately)

A tab click applies a template over unsaved live state with no prompt and no undo. The
Layout Dock rule recorded in memory is *"Auto-save must FLUSH on switch and may NEVER shrink
a layout"* — the flush did not fire here (`charts_layouts.db` mtime never moved), so the
guarantee did not hold. Reproducible: change a chart, click another tab, click back.
