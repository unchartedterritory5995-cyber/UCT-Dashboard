# Single-Stock ETF Switcher (Leverage / Inverse) — Design

**Date:** 2026-07-21 (rev 2 — post 6-lens/18-finding adversarial review)
**Status:** Approved design (owner), pre-implementation
**Surfaces:** `/charts` ChartWidget (v1) · FastAPI backend · nightly data pipeline

## 1. Goal

When charting a stock that has single-stock leveraged/inverse ETFs (NBIS → NEBX,
NBIL, NBIG, NBIZ, NBIC, NOWX …), a compact control in the chart toolbar lets the
owner:

1. **One click** → instantly swap the chart to the **most-liquid** leveraged
   (long) ETF for that stock.
2. One click → swap to the most-liquid **inverse** (short) ETF.
3. One click → return to the underlying **stock** — from any seat in the family
   (charting NBIL directly still resolves the family and offers STOCK/SHORT).
4. Expand a panel listing **every** single-stock ETF in the family (long + short,
   all issuers), ranked by liquidity with the numbers shown, for manual override.

New single-stock ETFs launch constantly; the mapping must refresh itself nightly
with zero manual work. A hot same-day launch is addable in under a minute: the
admin force re-scan covers it once Finviz lists the fund; before Finviz catches
up, a single `add` override row (§3.5) injects it directly.

Out of scope for v1: multi-chart grid cells (component is built self-contained so
grid adoption later is a mount, not a rework), index/commodity/basket leveraged
ETFs and ETNs (TQQQ/SQQQ/SOXL/BERZ etc.), covered-call/income single-stock funds
(YieldMax-style).

## 2. UX

### 2.1 The control — segmented pill in the ChartWidget toolbar

Placement: `app/src/pages/charts/widgets/ChartWidget.jsx`, mounted as the
**first child inside `styles.tfBarRight`** (before the settings-gear button) —
`.tfBarRight` carries `margin-left:auto` (ChartsWorkspace.module.css:239), so
this right-aligns the whole cluster next to the gear. (Do NOT mount it as a
sibling before `.tfBarRight`: that left-packs it after the meta block.)
`.tfBarRight` is reused by `GridChartCell.jsx`, so this placement carries over
cleanly to the future grid-adoption path. Renders **only when the current
symbol resolves to a family** — zero chrome on the ~99% of symbols with no
single-stock ETFs.

```
┌───────┬───────┬───────┬───┐
│ STOCK │ 2X ↑  │ 2X ↓  │ ▾ │
└───────┴───────┴───────┴───┘
```

- Same height/typography as the existing `tfBtn` buttons so it reads native.
- Segment labels show the **actual factor of the current best** fund
  (`2X ↑`, `1.5X ↑`, `1X ↓`). Long segment active-state carries a subtle green
  tint, short a subtle red tint (matching the app's up/down palette); STOCK uses
  the standard `tfBtnActive` treatment.
- Active segment = where the charted symbol currently sits (STOCK on the
  underlying, LONG lit when charting any long family member, SHORT likewise).
- Click behavior:
  - `STOCK` → swap to `underlying`
  - `2X ↑` → swap to `best_long` (most liquid long)
  - `2X ↓` → swap to `best_short`
  - Segment for a side with no funds (e.g. no short exists yet) renders
    disabled with a tooltip ("No inverse single-stock ETF listed yet").
- **Narrow-width rule:** the control must **never cause the tfBar to wrap** to
  a second row — `.tfBar` is `flex-wrap:wrap` and `.chartFill` is `flex:1`, so
  a wrap resizes the lightweight-charts canvas (height jank exactly during the
  fast watchlist-scan flow, since the control pops in/out per symbol). Below a
  container-width threshold (~480px, tuned at implementation), collapse to just
  the ▾ caret (family panel stays reachable). Implemented as a single
  `@container` rule in the component's own module CSS, relying on the locked
  invariant that `.widgetBody` is the `container-type: inline-size` root.
- **All swaps route through the existing `handleSymbolChange` funnel**
  (ChartWidget.jsx:266) — the locked single-funnel invariant — so group-sym
  propagation, crosshair sync, and focus-refocus behavior are untouched.
- Aesthetics pass at build time via the frontend-design skill; UIcon-or-text
  arrows only (no emoji, per house rule).

### 2.2 The panel — full family list (▾ caret)

Anchored dropdown (same visual family as `TimeframeMenu`), grouped LONG then
SHORT, each group sorted by avg dollar volume descending:

```
 NBIS — single-stock ETFs
 LONG
 ● NBIL  GraniteShares 2x Long NBIS Daily ETF   $48.2M/d   ★ most liquid
 ○ NEBX  Tradr 2X Long NBIS Daily ETF           $12.0M/d
 ○ NBIG  Leverage Shares 2X Long NBIS Daily ETF  $3.1M/d
 ○ NBIC  Corgi NBIS 2x Daily ETF                 $0.4M/d
 SHORT
 ● NBIZ  Tradr 2X Short NBIS Daily ETF           $9.3M/d   ★ most liquid
 ○ NOWX  Corgi NBIS 2x Short Daily ETF           $0.2M/d
```

- Row = ticker · fund name (truncated middle if long) · factor badge ·
  formatted avg $ vol · ★ on each side's most-liquid.
- Click row → `handleSymbolChange(etf)`; panel closes; segments re-light from
  the new symbol's seat in the family.
- The currently-charted family member shows a filled indicator.
- No hidden stickiness: segments ALWAYS target the most-liquid; the panel is the
  explicit manual override, chosen with the liquidity numbers visible.
- **Anchoring:** like TimeframeMenu horizontally (left clamped to viewport with
  8px gutter) but **also clamped vertically** — TimeframeMenu clamps
  horizontally only, and the charts workspace is viewport-locked (no page
  scroll), so an unclamped panel opened from a bottom-row widget is
  unrecoverable. If `anchor.bottom + 4 + panelHeight > window.innerHeight − 8`,
  open ABOVE the anchor (floored at 8px); on whichever side, cap `max-height`
  to the available space with the row list scrolling internally so no rows are
  ever clipped off-screen.
- Esc / outside click closes (mirror TimeframeMenu behavior).

### 2.3 Behavior notes

- Liquidity ranking recomputes nightly, so **a newer fund that starts
  out-trading the incumbent becomes the segment target automatically** the next
  morning. This is intended behavior (owner requirement), not flapping to
  suppress.
- Symbol resolution is bidirectional: the lookup accepts a stock OR any ETF in
  a family and returns the same family object.

## 3. Data pipeline

### 3.1 Source — one Finviz Elite whole-market export per rebuild

One authenticated CSV export per rebuild (no per-ticker calls), cloning the
`industry_map._fetch_finviz_universe` mechanics (httpx, browser UA, 90s
timeout, follow_redirects, empty-list on failure — industry_map.py:95) with
**two deliberate divergences**:

1. **No auth token in logs.** Pass `auth` via `httpx` `params=`, and on failure
   log only `type(e).__name__` plus (for HTTPStatusError) the status code and
   the URL with the auth query param redacted. `raise_for_status()` embeds the
   full URL — including the key — in the exception message, and the key is
   shared with prod industry_map + the scanner. §8 includes a unit test that a
   simulated 401 never logs the token. (Non-blocking note: industry_map.py:112
   has this same defect today — fix in a separate commit, out of scope here.)
2. **Whole market, more columns:** `v=152&c=1,2,3,4,63,65` with **no `f=`
   filter** (~11k rows). Columns: Ticker, Company, Sector, Industry,
   Average Volume (c=63), Price (c=65).

One export serves BOTH datasets each rebuild:

- **ETF candidate rows** = rows where `Industry == "Exchange Traded Fund"`.
- **Stock membership set** = rows where `Industry != "Exchange Traded Fund"`
  → `{TICKER: Company}`. This replaces the static `cap_universe.json` as the
  parser's underlying-validation set, so **fresh IPOs are covered the same
  night they appear in Finviz** (the CRWV/CRCL class — a hand-edited static
  file would make hot new underlyings invisible). `cap_universe.json` remains
  only as a fail-soft fallback membership set when the export fails or returns
  implausibly few rows. Because it's an ETF-industry split, ETF-on-ETF
  leveraged funds (QQQ/SPY underlyings) auto-drop: index tickers are never in
  the stock set.

**Implementation-time probe** (first task, before any pipeline code is relied
on): pull one live export and (a) assert the exact header names for all six
columns, (b) pin the numeric FORMAT of Average Volume/Price in the parser
fixture (raw integer vs comma-grouped vs `-` for blank), (c) check Finviz's
listing lag on one or two recently launched single-stock ETFs to size how
often the `add` override path (§3.5) will be needed, and (d) note whether the
export exposes ETF-type/tag columns usable as auxiliary confirmation signals
(the name parser stays the primary extractor — tags don't identify the
underlying).

Column ids are config, but header-name validation is NOT probe-time-only — it
re-runs on every rebuild as a fail-closed gate (§3.4).

### 3.2 Name parser — `underlying + direction + factor` from fund names

Reference corpus (a pytest fixture is built from a real export during
implementation; names below verified against live funds):

- `GraniteShares 2x Long NBIS Daily ETF` / `GraniteShares 2x Short NVDA Daily ETF`
- `Direxion Daily TSLA Bull 2X Shares` / `Direxion Daily TSLA Bear 1X Shares`
- `T-REX 2X Long Tesla Daily Target ETF` / `T-REX 2X Inverse NVIDIA Daily Target ETF`
  (**T-Rex names use company names, not tickers** — among the most liquid
  single-stock funds; the company-name pass in rule 3 exists for them)
- `Tradr 2X Long NBIS Daily ETF` / `Tradr 2X Short NBIS Daily ETF`
- `Leverage Shares 2X Long NBIS Daily ETF`
- `Defiance Daily Target 2X Long SMCI ETF` / `…1.5X Short…`
- `Corgi NBIS 2x Daily ETF`

Parse rules (pure functions, `parse_etf_name(name, stock_set) -> ParseResult`):

0. **Tokenizer (normative):** split on whitespace ONLY; strip leading/trailing
   punctuation per token; never split interior punctuation (`S&P` and `T-Rex`
   stay single tokens and fail the candidate test). Ticker-candidate test =
   `^[A-Z]{1,5}$` after stripping; normalize `.` → `-` in class-share tokens
   (BRK.B → BRK-B) before membership lookup (the universe stores hyphens; it
   has zero dotted entries).
1. **Factor:** regex `(\d+(?:\.\d+)?)\s*[xX]` — accepts `2X`, `2x`, `1.5X`,
   `1.25x`. Any negative multiplier `-Nx` (`-1x`/`-2x`/`-3x`/`-1.5x`; own pattern
   `_MINUS_NX_RE` — `\b` doesn't sit cleanly next to `-`) implies **SHORT —
   direction only**; the factor MAGNITUDE still comes from the `_FACTOR_RE` match
   (so `-2x` → short at factor 2.0), with a 1.0 fallback for a bare `-1x` that
   has no other factor token. No factor → not a leveraged fund → skip silently
   (most of the ETF universe).
2. **Direction:** word-boundary keyword scan — LONG: `long|bull`; SHORT:
   `short|bear|inverse` (plus any negative multiplier `-Nx`). Word boundaries
   mandatory (`Bullion`
   must never match `bull`). **Before scanning, mask any token that is a
   ticker candidate in the stock set** (so `…2X Short BULL Daily ETF` —
   BULL = Webull — yields exactly one SHORT keyword). If keywords from BOTH
   classes still match after masking → QUARANTINE (`reason='both_directions'`;
   never a fixed precedence — no guessing). Factor present but no direction
   keyword → QUARANTINE (`reason='no_direction'`) — some issuers omit "Long",
   but defaulting is how a short fund gets mislabeled long; an override
   promotes the row in one line.

   **Issuer-rule exception (`_DIRECTIONLESS_LONG_ISSUERS`, EDGAR-verified):**
   the `no_direction` quarantine has ONE narrow, evidence-backed exception.
   When a would-be `no_direction` row (factor present, underlying resolved, no
   direction keyword) is from an issuer that registers direction-less LONG
   names — **Corgi** today — it is classified LONG at the parsed factor instead
   of quarantined. Corgi ETF Trust I (SEC EDGAR CIK 0002078265) has **zero**
   inverse/short funds; all 144+ are single-stock 2x LONG registered as
   "Corgi `<NAME>` 2x Daily ETF" with "Long" dropped from the exchange name
   (e.g. the owner's `NBIC` = "Corgi NBIS 2x Daily ETF"). **The guardrail is
   forward-safe because it keys off the ABSENCE of a bearish token, not the
   presence of "Long":** the rule fires only inside the already-reached
   `not (long_hit or short_hit)` branch, so no `short|inverse|bear` word or
   negative multiplier `-Nx` matched (it reuses the existing SHORT detection —
   no second keyword list), and the
   entire industry ALWAYS labels a bearish/inverse fund explicitly. If Corgi
   ever ships an inverse fund it will carry an explicit bearish token and the
   existing SHORT logic catches it first (`both_directions` still wins if both
   somehow match). The rule ONLY supplies the missing direction — it never
   widens underlying acceptance (an unresolved underlying still
   `skip`s/`quarantine`s as before), and `self_reference` still applies. The
   issuer set is a conservative module constant (Corgi only); a future
   same-convention issuer is a one-word add. Watch: re-audit if EDGAR ever
   returns a fund-level Corgi `"Short"`/`"Inverse"` hit (currently 0). Tests:
   `test_ssetf_parser.py` Corgi suite + `test_ssetf_fixture.py`
   `test_corgi_directionless_funds_parse_long`.
3. **Underlying — two passes, adjacency-gated:**
   - *Ticker pass:* collect candidate tokens (rule 0 test) that are ∈ the
     stock set, after removing an issuer stoplist (`T-Rex`/`T-REX` explicitly —
     its `T` fragment is a real ticker — plus other issuer words, `ETF`, `ETN`,
     `US`). **Hard accept condition:** the surviving token must sit within
     **±1 raw token of the factor token or a direction keyword** — this holds
     for every corpus name and rejects basket funds whose name mentions a real
     ticker far from the leverage grammar (`MicroSectors FANG & Innovation
     -3X Inverse Leveraged ETN` → FANG is 3 tokens away → not accepted).
     Exactly one adjacent candidate → underlying. 2+ adjacent candidates →
     QUARANTINE (`reason='ambiguous'`).
   - *Company-name pass (only when the ticker pass yields zero candidates):*
     take capitalized word spans (1–3 words) immediately adjacent (±1 token)
     to the factor/direction cluster and prefix-match them against the Company
     values of the stock set (`Tesla` → "Tesla, Inc.", `NVIDIA` → "NVIDIA
     Corp"). Exactly one company matches → underlying. Zero or multiple
     (sector words like "Semiconductor" prefix-match nothing or many) →
     **silent skip**, counted.
   - *Index/region stoplist (`_INDEX_REGION_TERMS`) — geographic index funds
     resolve zero candidates.* A bounded, evidence-based set of index-provider +
     region words (`MSCI`, `FTSE`, `RUSSELL`, `STOXX`, `EAFE`, `EMERGING`,
     `MARKETS`, `EUROPE`, `EUROZONE`, `JAPAN`, `CHINA`, `BRAZIL`, `MEXICO`,
     `GERMANY`, `INDIA`, `KOREA`, `TAIWAN`, `PACIFIC`, `WORLD`, `GLOBAL`,
     `DEVELOPED`) that appear ONLY in leveraged GEOGRAPHIC INDEX funds (out of
     scope, rule 4). Live-data finding (2026-07-22 probe): these funds
     coincidentally resolved a single company two ways — "Europe" prefix-matched
     *European Equity Fund Inc* and "Japan" *Japan Smaller Capitalization Fund
     Inc* (COMPANY pass), and the real `MSCI` ticker sat next to "Short" in
     `ProShares Short MSCI EAFE` (TICKER pass) — so `EPV`/`EWV`/`EFZ`/`EUM`
     became bogus single-stock shorts, and a Corgi Taiwan fund mis-mapped to TSM.
     The guard bars these terms as **company-pass span seeds** (same mechanism as
     `_CRYPTO_ASSETS`/`_DIRECTION_WORDS`) AND rejects a **ticker candidate that is
     immediately adjacent (±1) to one of these terms** (an index-provider ticker
     embedded in an index name is the family, not the company). A genuine
     single-stock fund never names a region/index word beside its ticker (`2x
     Long NBIS Daily`) or as its company span (`Tesla`/`NVIDIA`), so the guard
     drops no real single-stock fund — `MSCI` as a bona-fide single-stock
     underlying (`2x Long MSCI Daily`, no adjacent index term) still resolves via
     the ticker pass. §3.5 remap override is the escape hatch.
   - *Sector/theme/market-cap stoplist (`_NONSTOCK_SPAN_TERMS`, +market-cap terms
     in `_INDEX_REGION_TERMS`) — leveraged sector/theme/broad-market index funds
     resolve zero candidates.* Coverage-audit finding (2026-07-22, live universe):
     14 leveraged SECTOR/THEME/INDEX funds mis-mapped to coincidentally-named small
     companies via the company pass — "Financial" (Direxion Financial Bull/Bear 3X,
     `FAS`/`FAZ`) → *Financial Institutions Inc*; "Biotech" (`LABU`/`LABD`, Corgi
     Biotech `XBIX`) → *Bio-Techne*; "Medical" (`PILL`) → *Medical Properties
     Trust*; "Innovation" (`TARK`/`SARK`) → *Innovation Beverage Group*; "Regional"
     (`SKRE`) → *Regional Management*; "Prod." (S&P Oil & Gas, `DRIP`/`GUSH`) →
     *Pro-Dex*; "FANG+" (NYSE FANG+, `FNGG`) → *Fangdd Network*; "Mid-Cap" (Corgi
     U.S. Mid-Cap `XVO`) → *MidCap Financial*. The seed word is compared in
     stripped-alpha form (so `FANG+`→`FANG`, `Mid-Cap`→`MIDCAP`) against a bounded
     sector/theme/index-family set; company-pass ONLY, so a real ticker (`ENPH`,
     `ET`) is untouched, and no marquee single-stock underlying (Tesla/NVIDIA/
     Microsoft/…) is named with a sector word. Cut live parsed 480→466 (the 14
     bogus maps), zero legit funds dropped.
   - *No-separator class-share alias (`_TICKER_ALIASES`).* Fund names sometimes
     write a class share without the hyphen the universe stores — `Corgi BRKB 2x`,
     `Direxion Daily BRKB Bull 2X` are Berkshire's `BRK-B`. Aliased (`BRKB`→`BRK-B`,
     `BRKA`→`BRK-A`) ONLY when the hyphen form is a real symbol and the literal
     token is not, so a future genuine `BRKB` listing still wins via direct match.
   - *Known coverage gap (documented, override-covered):* ProShares `Ultra`/
     `UltraShort` single-stock funds (`Ultra COIN`, `Ultra CRCL`) use an IMPLIED
     factor (Ultra = 2×) with no number, so they skip as `no_factor`. Their
     underlyings (COIN/CRCL) are already covered via other issuers' ticker-named
     funds, so this is a per-fund completeness gap, not a coverage hole; the trap
     that keeps it out of v1 is "Ultra **Short** <bond>" DURATION funds (1×, not
     leverage). A scoped ProShares implied-factor rule is a future add; the §3.5
     `add` override covers any specific ProShares single-stock fund meanwhile.
   - *Zero candidates after both passes → silent skip, NOT quarantine.* The
     ETF universe holds ~100+ leveraged index/sector funds (SOXL, TNA, LABU,
     BITX…) with factor + direction and no single-stock underlying; sending
     them to quarantine would bury the genuinely actionable rows forever. The
     nightly diff log carries a `skipped_zero_candidate` count so a systemic
     parser break stays observable (the validation gates backstop the
     catastrophic case).
4. **Exclusions (hard skip, before parsing):** names matching
   `covered call|option income|income|yieldmax|buffer|premium|dividend` —
   income products, not leverage/inverse — and `\b(index|etns?)\b` (no
   single-stock fund name in the corpus contains either; the MicroSectors
   basket family are ETNs).
5. Validation belt: parsed underlying must differ from the ETF's own ticker.

### 3.3 Liquidity metric

`avg_dollar_vol = finviz_avg_volume × finviz_price`, recomputed on every
rebuild from the same CSV row. Ranking = descending within (family, direction).

**Fresh-listing fallback:** rows with missing/zero avg volume (days-old funds,
and `add`-override rows absent from the export) get a bounded backfill from our
own bars service — mean of `close × volume` over available daily bars (≤20),
via the existing bars fetch path. Cap: 25 symbols per rebuild. **The backfill
is skipped entirely when the liquidity gate (§3.4) trips** — systemic zeros
mean a broken export, not fresh listings; don't burn the budget on garbage.

### 3.4 Rebuild — full, atomic, validated, single-flight

- `rebuild()` is a **full rebuild** (idempotent, no incremental drift):
  fetch export → split ETF rows / stock set → parse → apply overrides →
  resolve liquidity → write staging → **validate** → atomic swap.
- **Single-flight lock:** ONE module-level non-blocking lock
  (`threading.Lock.acquire(blocking=False)`) wraps the entire rebuild for
  EVERY trigger — nightly cron, admin POST, self-heal (APScheduler
  `max_instances=1` only serializes the cron against itself). Admin POST
  returns `{status:"already_running"}` (200) when held; cron/self-heal
  log-and-skip. The validate step reads staging **inside the same write
  transaction** that performs the `DELETE FROM etfs; INSERT …` swap, so what
  was validated is exactly what commits.
- **Validate — fail-closed gates on EVERY rebuild** (each refusal keeps the
  previous table serving; see §3.5 for observability):
  1. *Header gate:* the CSV header row must contain the expected column names
     (Ticker, Company, Sector, Industry, Average Volume, Price). Mismatch →
     refuse (`refused_headers`). Catches a wrong/drifted column id AND the
     200-HTML login page an expired Elite key returns (no exception is raised
     for those — "empty-list on failure" never fires). Closes the first-build
     hole too: garbage can never seed an empty table.
  2. *Liquidity gate:* refuse (`refused_liquidity`) if >20% of parsed
     leveraged ETFs have zero/unparseable `avg_dollar_vol`, or the staging
     median is 0 while the previous table's was nonzero. Unparseable numerics
     count as failures feeding this gate — never coerced to silent 0 by a
     lenient `float()` try/except.
  3. *Shrink guard:* refuse (`refused_shrink`) if the new ETF count is <60% of
     the previous (issuer batch closures run 10–30 funds, well under 40% of a
     ~250–350-row table). Admin `?force_shrink=1` overrides gates 2–3
     deliberately.
- **Per-run record (meta table), stamped every attempt:** `last_attempt_at`
  (written at the START of every attempt, success or not), `last_success_at`,
  `last_status ∈ {ok, refused_headers, refused_liquidity, refused_shrink,
  fetch_empty, error}`, `last_error`, run counts (`csv_rows, parsed,
  skipped_zero_candidate, quarantined, overrides_applied, backfilled,
  etfs_written, families`), and the last diff summary (stored, not just
  logged). House lesson (desk-sessions triple-failure): log-only failures are
  invisible on Railway — "never ran" and "always fails" must be
  distinguishable from `/status`.
- **Nightly job:** APScheduler in `api/main.py`, ET-pinned via the existing
  `_ET` pattern (house rule: never a bare CronTrigger), weekdays 20:30 ET.
  `max_instances=1`, `replace_existing=True`.
- **Startup self-heal:** empty or >48h-stale table triggers a guarded
  background rebuild — **but diverging deliberately from
  `industry_map._maybe_self_heal`:** the cooldown keys off the persisted
  `last_attempt_at` unconditionally (30 min for staleness heals, 5 min after
  failed attempts) with **NO empty-table bypass**. industry_map skips its
  cooldown when empty, tolerable on a low-traffic endpoint; this feature's
  lookup runs on every chart symbol change, so an empty table + dead export
  would otherwise drive back-to-back 90s Finviz calls from user traffic.
- **Admin force re-scan:** `POST /api/single-stock-etfs/rebuild`
  (`require_admin`) — same `rebuild()` in a background thread, returns
  immediately; completion visible in `/status`. Covers the 9:40 AM hot launch
  **once Finviz lists the fund**; before that, an `add` override row (§3.5) is
  the under-a-minute path §1 promises.

### 3.5 Safety rails & observability

- **Refusal visibility:** on any refused swap, stamp meta
  `refusals_consecutive` (+1; reset to 0 on success) and `last_refusal`
  (JSON: ts, reason, new_count, prev_count). Surface both in `/status`.
  After **2 consecutive refusals**, emit ONE alert via the existing
  `chart_health_alerts` rail (Discord + in-app, key `ssetf_rebuild_refused`) —
  alert-on-transition only, no re-spam each cycle. Self-heal treats a recent
  refusal as a completed attempt (cooldown from `last_attempt_at`).
- **Nightly diff log:** added/removed ETFs, new families, any
  best_long/best_short change per family, `skipped_zero_candidate` count, and
  quarantine adds/removals. Stored in meta (last diff) + logged. Audit trail
  for "why did the button target change."
- **Quarantine** (`reason ∈ {ambiguous, no_direction, both_directions}`) is
  **derived data**: rewritten inside the same rebuild transaction as the etfs
  swap, reflecting only the current export's problem rows — names later fixed
  by overrides/renames/delistings drop out of `/status` automatically. Left
  untouched (with the previous etfs table) on a refused swap. Historical trail
  lives in the diff log, not the table. **The §3.2 rule-2 Corgi issuer
  exception materially shrinks the `no_direction` quarantine set** — the entire
  Corgi lineup (~90 resolvable single-stock funds live; all 7 direction-less
  resolvable Corgi rows in the committed fixture) now parses LONG instead of
  quarantining, moving those rows from `quarantined` into `parsed`/`etfs_written`
  in the per-run record. The guardrail is honest: this only lifts rows with a
  resolved underlying and NO bearish token — a Corgi thematic/sector fund whose
  underlying doesn't resolve still `skip`s (counted in `skipped_zero_candidate`),
  and any future explicitly-bearish Corgi name still routes through normal SHORT
  logic, so the exception cannot silently mislabel an inverse fund as long.
- **Override table** — applied AFTER parsing on every rebuild;
  `action ∈ {remap, exclude, add}`:
  - `remap` — correct a mispair (fix underlying/direction/factor for a parsed
    row, or promote a quarantined one).
  - `exclude` — permanently drop a fund the parser wrongly accepts.
  - `add` — inject a fund **absent from the export** (same-day launches before
    Finviz lists them): supplies etf_ticker + underlying + direction + factor
    (+ optional name; default `"<etf_ticker> (manual add)"` to satisfy the
    NOT NULL name column). Liquidity via the §3.3 bars fallback
    (`vol_source='bars_fallback'`, counted against the 25-symbol cap), ranking
    0 until bars exist. Once a later export contains the ticker, Finviz
    name/price/volume win but the override's underlying/direction/factor still
    apply (same precedence as remap).
  - v1 editing: SQL/admin endpoint only, no UI.

## 4. Storage

New SQLite DB following the `/data`-volume idiom
(`_resolve_db_path` clone; env override `SSETF_DB_PATH`, `/data/single_stock_etfs.db`
on Railway, repo-local `api/../data/` fallback for dev):

```sql
CREATE TABLE etfs (
  etf_ticker     TEXT PRIMARY KEY,
  underlying     TEXT NOT NULL,          -- indexed
  direction      TEXT NOT NULL,          -- 'long' | 'short'
  factor         REAL NOT NULL,          -- 2.0, 1.5, 1.0 …
  name           TEXT NOT NULL,          -- Finviz company name (or manual-add default)
  price          REAL,
  avg_volume     REAL,
  avg_dollar_vol REAL,                   -- ranking key
  vol_source     TEXT,                   -- 'finviz' | 'bars_fallback' | 'none'
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_etfs_underlying ON etfs(underlying);

CREATE TABLE overrides (
  etf_ticker TEXT PRIMARY KEY,
  action     TEXT NOT NULL,              -- 'remap' | 'exclude' | 'add'
  underlying TEXT, direction TEXT, factor REAL,
  note       TEXT, created_at INTEGER
);

CREATE TABLE quarantine (                -- derived; rewritten per successful rebuild
  etf_ticker TEXT PRIMARY KEY,
  name       TEXT, reason TEXT, seen_at INTEGER
);

CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
-- per-run record: last_attempt_at, last_success_at, last_status, last_error,
-- run counts, last diff summary, refusals_consecutive, last_refusal
```

Service module: `api/services/single_stock_etfs.py` (fetch/parse/rank/rebuild/
lookup/status — same shape as `industry_map.py`). Parser lives beside it as
pure functions for direct unit testing.

## 5. API

Router `api/routers/single_stock_etfs.py`, registered in `api/main.py`
(import block + `app.include_router`, the 2-step pattern).

**Route declaration order:** literal paths (`/status`, any future ones) MUST be
declared **before** the `/{symbol}` wildcard — FastAPI matches in declaration
order, so `GET /{symbol}` otherwise captures `/status` as `symbol='status'`
and silently returns the empty family shape. Mirror `api/routers/cot.py`,
which orders `/status` before `/{symbol}` for exactly this reason (and the
journal psychology route carries the same documented lesson).

- `GET /api/single-stock-etfs/{symbol}` — logged-in (`get_current_user`).
  Resolves from either direction (underlying match OR etf_ticker match):

  ```json
  {
    "underlying": "NBIS",
    "long":  [{"ticker":"NBIL","name":"…","factor":2.0,"avg_dollar_vol":48200000}, …],
    "short": [{"ticker":"NBIZ", …}, …],
    "best_long": "NBIL",
    "best_short": "NBIZ"
  }
  ```

  No family → `{"underlying": null, "long": [], "short": []}` (200, cheap,
  cacheable). In-process TTL cache 10 min keyed by symbol; invalidated on
  rebuild.
- `POST /api/single-stock-etfs/rebuild` — `require_admin` (house security rule:
  no unauth'd POSTs). Optional `?force_shrink=1`. Returns
  `{status:"started"}` or `{status:"already_running"}`.
- `GET /api/single-stock-etfs/status` — `require_admin`: row/family counts,
  full per-run record (§3.4), refusal state (§3.5), quarantine list, last diff
  summary — sufficient to distinguish "never ran" / "always fails" / "refused"
  from one screen, and the surface the first nightly run is watched on.

Env: reuses `FINVIZ_API_KEY` (already on Railway for industry_map). One kill
switch `SINGLE_STOCK_ETFS_ENABLED` (default `"1"`), read via
`os.environ.get` **at call time** (no CONFIG loader exists in this repo — that
idiom is morning-wire's); gates the scheduler job, self-heal, and router
(returns the empty shape when off). Rollback =
`railway variables --set SINGLE_STOCK_ETFS_ENABLED=0` +
`railway redeploy --service web` — vars are STAGED until redeploy (house
lesson). Lighter than a code revert (no rebuild/revert commit/pre-push window)
but still restarts web with a ~1 min `/api` blip, so time intraday flips
accordingly.

## 6. Frontend integration

- `app/src/hooks/useSingleStockEtfs.js` — SWR on
  `/api/single-stock-etfs/{sym}`, `revalidateOnFocus:false`,
  `dedupingInterval` generous (data changes nightly). Keyed on ChartWidget's
  already-debounced `sym` (the 90ms groupSym debounce), so fast watchlist
  arrow-scans don't fan out requests. Skips fetch for theme pseudo-tickers
  (`$IDX:` prefix).
- `app/src/pages/charts/widgets/LeverageInverseControl.jsx` (+ own module CSS
  incl. the §2.1 container query) — self-contained: takes `{sym, onSelect}`;
  internally uses the hook; renders null when no family. Mounted per §2.1
  inside `tfBarRight` with `onSelect={handleSymbolChange}`.
- ChartWidget diff is intentionally ~5 lines (import + mount) — the component
  owns everything else, keeping the grid-adoption path and partner-merge risk
  small.
- Charting ETFs outside the ticker-search universe (NBIL etc.) works today:
  bars come from the Massive-backed `/api/bars/{sym}` (the same path the theme
  audit used as its delisting oracle), SymbolSearch already has the
  "Go to {TICKER}" fallback, and live prices subscribe by symbol.
  **Verification task, not assumption:** first implementation step confirms
  end-to-end chart render + live tick for a representative fund (NBIL) against
  prod data paths.

## 7. Edge cases

| Case | Handling |
|---|---|
| Stock with long funds only (no short yet) | SHORT segment disabled + tooltip |
| Charting an ETF directly (typed NBIL) | Reverse lookup lights LONG; STOCK returns to underlying |
| Underlying re-tickers / delists | Nightly rebuild re-parses names; stale families vanish when funds delist or rename; phantom-bar caveat lives in bars land, not here |
| Fresh IPO underlying (CRWV/CRCL class) | Stock set derives from the nightly full-market export — covered as soon as Finviz lists the stock; same-day → `add` override |
| Basket fund naming a real ticker (BERZ names FANG) | ±1 adjacency rule + `index|ETN` skip → never mapped; fixture-pinned |
| Two adjacent in-universe tokens | `ambiguous` quarantine, override to fix |
| Leveraged index/sector funds (SOXL, TNA, BITX…) | Zero-candidate silent skip (counted in diff log), never quarantine-flood |
| ETF-of-ETF (leveraged QQQ etc.) | Underlying is an ETF row, never in the stock set → skipped |
| Finviz outage / bad export / expired key | Header gate + liquidity gate + shrink guard refuse the swap; previous table keeps serving; 2 consecutive refusals → chart_health_alerts |
| Brand-new fund, no volume data | bars_fallback backfill (§3.3), else ranks last until data exists |
| Narrow widget (2–3 grid columns) | Control collapses to ▾ caret via container query; tfBar never wraps (§2.1) |
| Bottom-row widget opens panel | Vertical clamp flips panel above anchor; internal scroll (§2.2) |
| Theme pseudo-tickers `$IDX:` | Hook skips; control never renders |
| Feature off / table empty | Endpoint returns empty shape; control renders null — invisible, never broken |

## 8. Testing & verification

- **Parser unit tests** (backend, pytest): fixture of ≥40 real fund names
  across all issuers (captured from a live export, numeric formats pinned per
  §3.1) + adversarial cases with exact expected outcomes:
  - `BERZ` "MicroSectors FANG & Innovation -3X Inverse Leveraged ETN" and
    `AIBD` "Direxion Daily AI and Big Data Bear 2X Shares" → skip/quarantine,
    NEVER a FANG/AI family assignment
  - `TSLT`/`TSLZ` + the T-REX NVIDIA pair → company-name pass resolves
    TSLA/NVDA exactly
  - `SOXL`/`TNA`/`LABU`/`BITX` → silent skip (not quarantine)
  - "Tradr 2X Short BULL Daily ETF" → SHORT/BULL (masking), a "Bullion" name →
    no direction match (word boundaries)
  - income funds, fractional factors (1.25X/1.5X), `-1x`, missing direction →
    quarantine, dotted class shares → hyphen normalization
- **Rebuild tests:** atomic swap; header-gate refusal (incl. an HTML-login-page
  body); liquidity-gate refusal (zero-volume table); shrink-guard refusal;
  refusal counters + transition-only alert at 2 consecutive; override
  application (remap + exclude + `add` injection & later-export precedence);
  quarantine rewrite (resolved rows drop out); meta per-run record stamps;
  **concurrency: two overlapping rebuild() calls → second refused, table never
  contains a mixed set**.
- **API tests:** forward + reverse resolution; empty shape; admin gating on
  rebuild/status (anon POST → 401/403); **`/status` returns the status
  payload, NOT the empty family shape** (route-shadowing guard); token never
  appears in logs on a simulated Finviz 401.
- **Frontend vitest** (`--pool=threads`): control hidden with empty family;
  segments render with correct labels/disabled states; click calls `onSelect`
  with the right ticker; panel sorts by liquidity and marks ★; mutation-check
  the assertions (a test that passes with the feature broken is vacuous —
  house lesson).
- **Live Playwright pass** (house rule: verify DOM, not hash; ESBuild can drop
  CSS-module keys): chart NBIS on the deployed/local build → control visible →
  click 2X↑ → chart symbol becomes best_long with bars rendered; type NBIL →
  STOCK returns to NBIS; narrow the widget → control collapses to caret without
  tfBar wrap; bottom-row widget → panel opens upward.
- **Prod bars sanity:** confirm `/api/bars/NBIL?tf=D` returns fresh bars via
  the prod endpoint before wiring UI (the §6 verification task).

## 9. Rollout

1. Backend service + parser + tests → 2. Router + main.py wiring + scheduler →
3. Frontend control + panel → 4. Live verification → 5. Ship via
`push origin feat/single-stock-etfs:master` **inside the deploy window**
(≥4:20 PM ET / <9:15 AM ET), fetch+rebase+push as one command (partner-race
rule). First nightly run watched via `/api/single-stock-etfs/status` (the §5
per-run record makes a failed run diagnosable from that one screen).

Worktree: `C:\Users\Patrick\uct-worktrees\single-stock-etfs`
(branch `feat/single-stock-etfs`). Commits use explicit `-- <path>` scoping
(shared-worktree house rule; never `git add -A`).
