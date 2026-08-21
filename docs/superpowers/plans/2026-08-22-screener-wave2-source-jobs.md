# Screener Wave 2 — New Source Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the screener snapshot from 103 to 138 columns by adding the provider-fed families — FMP bulk unread fields (zero extra requests), a nightly Finviz whole-market pull (float/short/ownership), FMP earnings dates, local earnings-context stores, a cadenced analyst pass, insider clusters, and the ratings-store component fields — each with one writer, honest None semantics, and a receipt.

**Architecture:** Wave 2 adds five NEW nightly artifacts + readers around the existing `snapshot_builder` pipeline: `fundamentals_bulk` grows in place (same six HTTP requests); a new `finviz_universe.py` writes a whole-market JSON artifact from ONE `export.ashx` call; `earnings_dates.py` writes an artifact from a date-chunked FMP pull; `earnings_context.py` reads two local stores; `analyst_pass.py` owns a cadenced per-ticker store with a wall-clock-bounded nightly job; `insider_capture.py` accumulates OpenInsider clusters. `build_row` gains ONE new dict-source param (`market_row` — the per-ticker merge of the Wave 2 readers) merged before `context_row`; `rs_fields` stays last. Every reader is one-read-per-build, registered in `_source_key_sets`, and every job's success is read from its artifact/receipt.

**Tech Stack:** Python/FastAPI, SQLite + JSON artifacts on /data, APScheduler (existing `register_screener_jobs`), pytest; one JS touch (`columnDefs.js`) + the manifest exclusion bookkeeping.

**Spec:** `docs/superpowers/specs/2026-08-21-screener-deep-work-design.md` (§2.2, §5.2, §5.3, §10 Wave 2)

## Global Constraints

- One writer per column; every new source registers in `tests/test_screener_fundamentals_bulk.py::_source_key_sets` (`:385-442`) and the pairwise rail must stay green. The `inst_pct` writer MOVES from `enrich` to the Finviz pull in this wave (recorded spec decision) — the swap is Task 9's, atomically.
- NO per-ticker network in the nightly builder loop. Bulk pulls, cadenced passes, and local stores only. The analyst pass is the one per-ticker network job and it runs in its OWN scheduled job with pacing + a wall-clock deadline, never inside `run_build`.
- Dead/empty/stale source → `{}` or absent keys (columns stay None), never confident zeros; every miss is counted into the builder's `sources` census. FMP zeros follow `fundamentals_bulk`'s corroboration doctrine — each new field states its own rule.
- Writer shapes stay AST-rail-visible: dict literals keyed by snapshot column names, or constant-key subscript assigns (`tests/test_scalar_population_rail.py:91-121` recognizes exactly those two shapes).
- `test_screener_filters.py::test_every_column_the_bulk_pass_fills_has_a_filter_control` derives from `fb.COLUMNS_WRITTEN` — Task 2 therefore ships its registry controls + display defs IN THE SAME COMMIT as its spec additions, or the suite is red between tasks. Zero new `factual_presets` anywhere (the reviewed-exemption set stays untouched).
- Keys: `FMP_API_KEY` and the Finviz token are Railway env on prod; locally they live in `C:\Users\Patrick\uct-intelligence\.env`. TESTS never require either (skip/stub); the two one-shot probe TOOLS load them explicitly from that path.
- Tests: explicit-file runs only (never `tests/ -k` sweeps); never `git add -A`; worktree `C:\Users\Patrick\uct-worktrees\screener-deep-work`, branch `feat/screener-deep-work`; ship = fetch → merge → re-verify → `git push origin feat/screener-deep-work:master`; after every master merge `grep -c broker_sync api/main.py` ≥ 7.
- Job registration follows `api/main.py::register_screener_jobs` (`:1200-1282`) idioms: env-gated, CronTrigger ET, `max_instances=1`, `replace_existing=True`; success is read from the job's artifact, never its log line.
- Parallel-safe groups AFTER Task 1 (disjoint files): {T2} {T3} {T4} {T5} {T6→T7 sequential pair} {T8}; T9 (enrich) alone; T10–T14 strictly serial after everything above.

## The 35 new columns (single reference — every later task links back here)

| Family | Columns (type) |
|---|---|
| FMP bulk (T2) | `quick_ratio` `p_fcf` `p_ocf` `payout_ratio` `roic` `lt_debt_to_capital` (REAL) · `ipo_date` `country` (TEXT) · `ipo_age_days` (INT, derivation) |
| Finviz (T3) | `shares_outstanding` `float_shares` `float_pct` `short_float_pct` `short_ratio` `insider_own_pct` (REAL) — plus the `inst_pct` WRITER MOVE (column exists) |
| Earnings (T4/T5) | `next_earnings_date` `earnings_session` (TEXT) · `days_to_earnings` (INT, derivation) · `last_report_move_pct` `implied_move_pct` (REAL) · `earnings_setup_grade` (TEXT) |
| Analyst (T6/T7) | `analyst_consensus` (TEXT) · `pt_target` `pt_upside_pct` (REAL; upside is a derivation) · `upgrades_30d` `downgrades_30d` (INT) · `eps_next_y_growth` (REAL %) |
| Insider (T8) | `insider_cluster_days` (INT) |
| Ratings (T9) | `blended_growth` (REAL %) · `sector_rs_pct` `rating_eps` `rating_growth` `rating_value` `rating_smr` (INT 1–99) · `sponsorship` (TEXT letter) |

`_TEXT` additions: `ipo_date, country, next_earnings_date, earnings_session, earnings_setup_grade, analyst_consensus, sponsorship`.
`_INT` additions: `ipo_age_days, days_to_earnings, upgrades_30d, downgrades_30d, insider_cluster_days, sector_rs_pct, rating_eps, rating_growth, rating_value, rating_smr`.
Deliberately ABSENT: `rating_rs` (rs_rank IS the RS rating — a near-duplicate spelling would be the second-authority defect); `p_cash` (Finviz's balance-sheet Price/Cash has no FMP bulk source; `p_ocf` ships instead — parity-matrix note, recorded deviation).

---

### Task 1: Schema — 35 new columns + manifest exclusion bookkeeping

**Files:**
- Modify: `api/services/screener/snapshot_db.py` (COLUMNS `:13-50`, `_TEXT` `:52-58`, `_INT` `:59-68`)
- Modify: `app/src/components/chart/engine/ast/closedTable.json` (`_scalars_excluded` ONLY)
- Modify: `tests/test_ast_scalars.py` (the two pinned literals: `== 103` → `== 138`, `(54, 49)` → `(54, 84)`)
- Modify: `app/src/components/chart/engine/ast/freshness.test.js` (`toBe(49)` → `toBe(84)`)
- Test: `tests/test_screener_wave2_schema.py` (new)

**Interfaces:**
- Produces: `snapshot_db.COLUMNS` extended with the 35 names from the reference table above; the Wave 1 `init_db` migration (`PRAGMA table_info` diff → ALTER-add) picks them up with zero new migration code.
- Insert the names as three grouped blocks with comments, keeping the file's existing grouping style: the FMP + Finviz + analyst + ratings names in a `# provider fundamentals (Wave 2)` block after `"debt_to_equity", "current_ratio", "beta", "inst_pct",`; the earnings + insider names in a `# events (Wave 2)` block after the `# context (Wave 1)` group; `ipo_date`/`country` ride in the provider block. Exact insertion:

```python
    "debt_to_equity", "current_ratio", "beta", "inst_pct",
    # provider fundamentals (Wave 2)
    "quick_ratio", "p_fcf", "p_ocf", "payout_ratio", "roic",
    "lt_debt_to_capital", "ipo_date", "ipo_age_days", "country",
    "shares_outstanding", "float_shares", "float_pct", "short_float_pct",
    "short_ratio", "insider_own_pct",
    "analyst_consensus", "pt_target", "pt_upside_pct",
    "upgrades_30d", "downgrades_30d", "eps_next_y_growth",
    # ratings components (Wave 2)
    "blended_growth", "sector_rs_pct", "rating_eps", "rating_growth",
    "rating_value", "rating_smr", "sponsorship",
```

…and after the `# context (Wave 1)` group's last line (`"is_etf", "is_leveraged", "stage2", "stage4", "hvc_52w",`):

```python
    # events (Wave 2)
    "next_earnings_date", "earnings_session", "days_to_earnings",
    "last_report_move_pct", "implied_move_pct", "earnings_setup_grade",
    "insider_cluster_days",
```

`_TEXT` gains (append inside the set, with a `# Wave 2` comment): `"ipo_date", "country", "next_earnings_date", "earnings_session", "earnings_setup_grade", "analyst_consensus", "sponsorship"`.
`_INT` gains: `"ipo_age_days", "days_to_earnings", "upgrades_30d", "downgrades_30d", "insider_cluster_days", "sector_rs_pct", "rating_eps", "rating_growth", "rating_value", "rating_smr"`.

- [ ] **Step 1: Write the failing tests**

```python
"""Wave 2 schema: the 35 new columns exist and the widen path still works."""
import sqlite3


def _fresh(monkeypatch, tmp_path):
    db = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    return db


WAVE2 = ("quick_ratio", "p_fcf", "p_ocf", "payout_ratio", "roic",
         "lt_debt_to_capital", "ipo_date", "ipo_age_days", "country",
         "shares_outstanding", "float_shares", "float_pct", "short_float_pct",
         "short_ratio", "insider_own_pct", "next_earnings_date",
         "earnings_session", "days_to_earnings", "last_report_move_pct",
         "implied_move_pct", "earnings_setup_grade", "analyst_consensus",
         "pt_target", "pt_upside_pct", "upgrades_30d", "downgrades_30d",
         "eps_next_y_growth", "insider_cluster_days", "blended_growth",
         "sector_rs_pct", "rating_eps", "rating_growth", "rating_value",
         "rating_smr", "sponsorship")


def test_wave2_columns_are_declared(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    missing = [c for c in WAVE2 if c not in snapshot_db.COLUMNS]
    assert not missing, missing
    assert len(WAVE2) == 35  # the reference table's own count, pinned


def test_init_db_widens_a_wave1_shaped_table(monkeypatch, tmp_path):
    """A prod DB that stopped at Wave 1's 103 columns gains the 35 on init."""
    db = _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    wave1_cols = [c for c in snapshot_db.COLUMNS if c not in WAVE2]
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE screener_rows (%s)" % ", ".join(
        "ticker TEXT PRIMARY KEY" if c == "ticker" else f"{c} REAL"
        for c in wave1_cols))
    conn.commit()
    conn.close()
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        have = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    assert set(snapshot_db.COLUMNS) <= have
    snapshot_db.upsert_rows([{"ticker": "T", "short_float_pct": 12.5,
                              "earnings_session": "bmo"}])
    row = snapshot_db.get_row("T")
    assert row["short_float_pct"] == 12.5 and row["earnings_session"] == "bmo"


def test_type_classes_stay_disjoint(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    assert not (snapshot_db._TEXT & snapshot_db._INT)
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_screener_wave2_schema.py -v` → FAIL naming the 35.
- [ ] **Step 3: Apply the COLUMNS/_TEXT/_INT edits.**
- [ ] **Step 4: Manifest bookkeeping** — append the same 35 names to `_scalars_excluded` in `closedTable.json` (match its formatting); update `tests/test_ast_scalars.py`'s literals `== 103` → `== 138` and `(54, 49)` → `(54, 84)`; update `freshness.test.js` `toBe(49)` → `toBe(84)`. Touch nothing else in those files.
- [ ] **Step 5: Run to green** — `python -m pytest tests/test_screener_wave2_schema.py tests/test_screener_wave1_schema.py tests/test_ast_scalars.py tests/test_scalar_population_rail.py -v` all green, plus `cd app && npx vitest run src/components/chart/engine/ast/freshness.test.js --pool=threads --execArgv=--no-warnings`.
- [ ] **Step 6: Commit**

```bash
git add api/services/screener/snapshot_db.py tests/test_screener_wave2_schema.py app/src/components/chart/engine/ast/closedTable.json tests/test_ast_scalars.py app/src/components/chart/engine/ast/freshness.test.js
git commit -m "screener: 35 Wave-2 columns + manifest exclusions (103 -> 138)"
```

---

### Task 2: FMP bulk — six unread ratio fields + ipo_date/country, with controls and defs in the same commit

**Files:**
- Create: `tools/screener_wave2_fmp_headers.py`
- Modify: `api/services/screener/fundamentals_bulk.py` (RATIO_SPECS `:225-250`, KEY_METRIC_SPECS `:274-277`, PROFILE_TEXT `:288-290`)
- Modify: `api/services/screener/snapshot_builder.py` (`build_row` — the `ipo_age_days` derivation)
- Modify: `api/services/screener/filters.py` (nine controls — REQUIRED same-commit: `test_every_column_the_bulk_pass_fills_has_a_filter_control` derives from `COLUMNS_WRITTEN`)
- Modify: `app/src/pages/screener/columnDefs.js` (nine defs — REQUIRED same-commit: the visibility rail derives from FILTERS)
- Test: `tests/test_screener_wave2_fmp_bulk.py` (new)

**Interfaces:**
- Consumes: `fundamentals_bulk._Spec`, `value_for`, `_open_bulk_csv` (all existing).
- Produces: `COLUMNS_WRITTEN` grows by 8 (derivation keeps it honest); `build_row` writes `ipo_age_days` when `ipo_date` merged in.

**Step 0 — the header probe (run BEFORE editing specs; its output is the authority on field names).** The expected names below are drawn from FMP stable conventions; `fundamentals_bulk`'s own doctrine is "probed, not assumed", so pin what the probe PRINTS, and record any divergence from the expected names in your report and the commit body.

```python
"""One-shot header census of the FMP bulk CSVs — Wave 2 field pinning.

A TOOL, not a test: it loads FMP_API_KEY from the key's real home
(C:/Users/Patrick/uct-intelligence/.env) explicitly, because the dashboard
repo's env deliberately does not carry it and the tests must never need it.
Streams ONE data row per endpooint and prints the headers matching our
candidate keywords, so Task 2 pins measured names, never documented ones.
"""
import io
import sys

sys.path.insert(0, ".")


def _load_key():
    import os
    if os.environ.get("FMP_API_KEY"):
        return
    try:
        for line in open(r"C:\Users\Patrick\uct-intelligence\.env",
                         encoding="utf-8"):
            if line.strip().startswith("FMP_API_KEY="):
                os.environ["FMP_API_KEY"] = line.split("=", 1)[1].strip()
                return
    except OSError:
        pass


KEYWORDS = ("quick", "cashflow", "cash", "payout", "invested", "longterm",
            "ipo", "country", "shares")


def _census(path, params):
    from api.services.screener.fundamentals_bulk import _open_bulk_csv
    with _open_bulk_csv(path, params) as (rows, status, body):
        if status != 200:
            print(f"{path}: HTTP {status} {body}")
            return
        first = next(iter(rows), None)
        headers = sorted((first or {}).keys())
        hits = [h for h in headers
                if any(k in h.lower() for k in KEYWORDS)]
        print(f"{path}: {len(headers)} headers; candidates:")
        for h in hits:
            print(f"   {h} = {first.get(h)!r}")


_load_key()
_census("/stable/ratios-ttm-bulk", {})
_census("/stable/key-metrics-ttm-bulk", {})
_census("/stable/profile-bulk", {"part": "0"})
```

The spec additions (adjust `field` names to the probe's output):

```python
    # ── Wave 2 additions — same file, same six requests, zero new cost ──
    "quick_ratio":        _Spec("quickRatioTTM", 1.0, ()),
    # A zero P/FCF or P/OCF requires a zero PRICE; both are undefined-sentinels.
    "p_fcf":              _Spec("priceToFreeCashFlowRatioTTM", 1.0, ()),
    "p_ocf":              _Spec("priceToOperatingCashFlowRatioTTM", 1.0, ()),
    # A non-payer's payout genuinely IS 0 — same corroborator as dividend_yield.
    "payout_ratio":       _Spec("payoutRatioTTM", 100.0, ("dividendPerShareTTM",)),
    # Debt-free is witnessed by the independent debt quotients, exactly as
    # debt_to_equity's own rule.
    "lt_debt_to_capital": _Spec("longTermDebtToCapitalRatioTTM", 1.0,
                                ("debtToEquityRatioTTM",
                                 "debtToAssetsRatioTTM")),
```

into `RATIO_SPECS`; and into `KEY_METRIC_SPECS` (the balance-sheet-zero near-miss documented above ROA/ROE applies verbatim — no corroborator, zeros refused):

```python
    "roic": _Spec("returnOnInvestedCapitalTTM", 100.0, ()),
```

and into `PROFILE_TEXT`:

```python
    "ipo_date": "ipoDate",
    "country":  "country",
```

`quick_ratio` zero note (goes in a comment beside it): the same ~163 banks/insurers/BDCs that print `currentRatioTTM == 0` print quick 0 for the same no-current-split reason — refused, NULL by design, matching `current_ratio`.

`build_row` derivation — insert directly after the `dollar_vol_30d` block (`snapshot_builder.py:146-147`):

```python
    # Pure derivation, single writer: age from the profile-bulk listing date.
    if row.get("ipo_date"):
        try:
            listed = datetime.date.fromisoformat(str(row["ipo_date"])[:10])
            row["ipo_age_days"] = max(0, (datetime.date.today() - listed).days)
        except (TypeError, ValueError):
            pass
```

`filters.py` additions (fundamental category unless noted; ALL bare `_open_range`, no factual presets; `country` and `ipo_date` are the two non-range shapes):

```python
    _open_range("quick_ratio", "Quick Ratio", "fundamental", "quick_ratio"),
    _open_range("p_fcf", "P/FCF", "fundamental", "p_fcf"),
    _open_range("p_ocf", "P/OCF", "fundamental", "p_ocf"),
    _open_range("payout_ratio", "Payout Ratio", "fundamental", "payout_ratio",
                unit="%"),
    _open_range("roic", "ROIC", "fundamental", "roic", unit="%"),
    _open_range("lt_debt_to_capital", "LT Debt / Capital", "fundamental",
                "lt_debt_to_capital"),
    # ISO dates compare correctly as TEXT in SQLite, so a custom range works
    # server-side today; the old panel's number inputs can't type one — the
    # usable control is ipo_age_days below, and Wave 3's typed controls make
    # this one first-class. It exists because every bulk-written column must
    # carry a control (the registry rail).
    _open_range("ipo_date", "IPO Date", "descriptive", "ipo_date"),
    _open_range("ipo_age_days", "IPO Age (days)", "descriptive",
                "ipo_age_days"),
    _enum("country", "Country", "descriptive", "country",
          [{"label": "Any"}], options_column="country"),
```

`columnDefs.js` additions (reuse existing helpers: `num`, `pctPlain`, `dollarVol`? no — these are ratios; `shares` exists from Wave 1):

```js
  quick_ratio: { label: 'Quick', fmt: num(1) },
  p_fcf: { label: 'P/FCF', fmt: num(1) },
  p_ocf: { label: 'P/OCF', fmt: num(1) },
  payout_ratio: { label: 'Payout', fmt: pctPlain(0) },
  roic: { label: 'ROIC', fmt: pctPlain(0) },
  lt_debt_to_capital: { label: 'LTD/Cap', fmt: num(2) },
  ipo_date: { label: 'IPO', fmt: v => v ? String(v).slice(0, 10) : '—' },
  ipo_age_days: { label: 'IPO Age', fmt: num(0) },
  country: { label: 'Country', fmt: v => v || '—' },
```

- [ ] **Step 1: Run the header probe** — `python tools/screener_wave2_fmp_headers.py`. Record its full output in your report. If a candidate name differs from the expected spec names above, use the MEASURED name and say so in the commit body. If the key is unavailable locally, note it, use the expected names, and flag DONE_WITH_CONCERNS (the prod receipt's `populated` counts are the backstop — a wrong name reads 0/N by name on the first nightly).
- [ ] **Step 2: Write the failing tests**

```python
"""Wave 2 FMP bulk fields — zero rules + derivation, no sockets."""
from api.services.screener import fundamentals_bulk as fb


def test_new_specs_are_registered_and_derived():
    for col in ("quick_ratio", "p_fcf", "p_ocf", "payout_ratio",
                "lt_debt_to_capital", "roic", "ipo_date", "country"):
        assert col in fb.COLUMNS_WRITTEN, col


def test_payout_zero_needs_the_dividend_corroborator():
    spec = fb.RATIO_SPECS["payout_ratio"]
    assert fb.value_for(spec, {spec.field: "0",
                               "dividendPerShareTTM": "0"}) == 0.0
    assert fb.value_for(spec, {spec.field: "0",
                               "dividendPerShareTTM": "1.2"}) is None
    assert fb.value_for(spec, {spec.field: "0.153",
                               "dividendPerShareTTM": "1.2"}) == 15.3


def test_quick_ratio_zero_is_refused_like_current_ratio():
    assert fb.value_for(fb.RATIO_SPECS["quick_ratio"],
                        {"quickRatioTTM": "0"}) is None


def test_lt_debt_zero_needs_both_debt_witnesses():
    spec = fb.RATIO_SPECS["lt_debt_to_capital"]
    row = {spec.field: "0", "debtToEquityRatioTTM": "0",
           "debtToAssetsRatioTTM": "0"}
    assert fb.value_for(spec, row) == 0.0
    row["debtToAssetsRatioTTM"] = "0.4"
    assert fb.value_for(spec, row) is None


def test_ipo_age_derivation():
    import datetime
    from api.services.screener import snapshot_builder
    bars = [{"o": 100, "h": 101, "l": 99, "c": 100, "v": 1000}] * 40
    row = snapshot_builder.build_row(
        "T", bars, None, {"ipo_date": "2020-01-15"})
    want = (datetime.date.today() - datetime.date(2020, 1, 15)).days
    assert row["ipo_age_days"] == want
    row = snapshot_builder.build_row("T", bars, None, {"ipo_date": "junk"})
    assert row["ipo_age_days"] is None
```

(Adjust the two raw field-name literals in the corroborator tests if Step 1's probe renamed them — the SPEC is the single place the name lives; the tests reach it via `spec.field` everywhere except the corroborator keys, which are the measured names by definition.)

- [ ] **Step 3: Run to verify failure**, **Step 4: implement all five files' edits**, **Step 5: run to green** —
`python -m pytest tests/test_screener_wave2_fmp_bulk.py tests/test_screener_fundamentals_bulk.py tests/test_screener_filters.py tests/test_screener_wave1_columndefs.py -v`
(the last two prove the same-commit control/def requirement held).
- [ ] **Step 6: Commit**

```bash
git add tools/screener_wave2_fmp_headers.py api/services/screener/fundamentals_bulk.py api/services/screener/snapshot_builder.py api/services/screener/filters.py app/src/pages/screener/columnDefs.js tests/test_screener_wave2_fmp_bulk.py
git commit -m "screener: eight FMP-bulk fields at zero request cost + ipo age derivation"
```

---

### Task 3: finviz_universe.py — one whole-market pull for float/short/ownership + the inst_pct authority artifact

**Files:**
- Create: `tools/screener_wave2_finviz_ids.py`
- Create: `api/services/screener/finviz_universe.py`
- Test: `tests/test_screener_wave2_finviz.py` (new)

**Interfaces:**
- Produces: `finviz_universe.run_pull() -> dict` (the receipt: `{rows, kept, missing_headers, wrote, as_of}`) writing the artifact `<DATA_DIR or /data>/screener_finviz.json` atomically; `finviz_universe.read_finviz_fields(targets, failures=None) -> {TICKER: {column: value}}` with PER-COLUMN presence (a header the pull didn't get → that column's key absent everywhere → None downstream, the `read_index_flags` idiom); env override `SCREENER_FINVIZ_ARTIFACT` for tests.
- Columns written: `shares_outstanding, float_shares, float_pct, short_float_pct, short_ratio, insider_own_pct, inst_pct` (the last is the WRITER MOVE — enrich stops emitting it in Task 9; between T3 and T9 this module is unwired so no dual-writer window exists).

**Step 0 — the id probe.** `export.ashx?v=152` with NO `c=` is a bug, full stop; ids must be measured. The probe requests `c=0..149` and prints the returned header for every position, giving the complete id→name census in one call. The auth/URL/UA plumbing is `industry_map.py`'s — READ its `_fetch_finviz_universe` first and mirror its exact env/token/redirect handling (it "already owns the token, the 301 and the timeout"); if its fetch helper is importable without side effects, import it instead of mirroring.

```python
"""One-shot Finviz export column census — Wave 2 id pinning.

Prints {id: header} for c=0..149 so the module pins MEASURED ids for:
Shares Outstanding, Shares Float (and/or Float %), Short Float, Short
Ratio, Insider Ownership, Institutional Ownership — plus a sample row so
the UNITS of each are recorded (suffixed 1.5B vs raw-millions vs '3.45%').
Token comes from the same env/config industry_map's fetch uses.
"""
```

(Body: build the c list `",".join(str(i) for i in range(150))`, perform ONE GET via the mirrored/imported helper, `csv.reader` the first two lines, print `zip(ids, headers)` and the first data row's values for the matched candidates. ~40 lines; the implementer writes it against the idiom found in `industry_map.py`.)

**The module** (shape — the parse contract is HEADER NAMES, ids only select columns; a missing header drops ITS column, never the pull):

```python
"""Whole-market Finviz pull — float/short/ownership for the screener.

ONE export.ashx request per night (02:45 ET job), pinned `c=` ids measured
by tools/screener_wave2_finviz_ids.py on 2026-08-22, parsed BY HEADER NAME
(the contract), written atomically to a JSON artifact the builder joins.

⛔ The whole-market pull carries NO `f=` filter, so the fail-open token
trap cannot bite — there is no clause to silently drop. What CAN bite is
units: Finviz mixes suffixed absolutes ('1.5B'), raw-thousands, and
'3.45%' strings. `_parse` handles all three shapes and the tests pin each.
⛔ Never on a request path (90s-class fetch); the job owns it, with an
in-flight flag. ⛔ An empty/short result never overwrites a good artifact.
"""
```

Key functions (write in full):

```python
_HEADERS = {
    # snapshot column -> the header Finviz returns (measured; ids in _C_IDS)
    "shares_outstanding": "Shares Outstanding",
    "float_shares":       "Shares Float",
    "float_pct":          "Float %",
    "short_float_pct":    "Short Float",
    "short_ratio":        "Short Ratio",
    "insider_own_pct":    "Insider Ownership",
    "inst_pct":           "Institutional Ownership",
}
_PCT_COLUMNS = {"float_pct", "short_float_pct", "insider_own_pct", "inst_pct"}
_MIN_ROWS = 1000        # an artifact below this is a failed pull, not a market


def _parse(text, is_pct):
    """'1.5B' -> 1.5e9 · '3.45%' -> 3.45 · '12.3' -> 12.3 · '-'/'' -> None."""
    s = (text or "").strip().replace(",", "")
    if not s or s == "-":
        return None
    if s.endswith("%"):
        s = s[:-1]
        try:
            return float(s)
        except ValueError:
            return None
    mult = 1.0
    if s and s[-1] in "KMBT":
        mult = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}[s[-1]]
        s = s[:-1]
    try:
        val = float(s) * mult
    except ValueError:
        return None
    return val if not is_pct else val
```

`run_pull()`: fetch → `csv.DictReader` → for each row keep `Ticker`-keyed dict of parsed columns whose header is PRESENT (`missing_headers` recorded by name); refuse to write when `len(rows) < _MIN_ROWS` (receipt says so; prior artifact survives); atomic write `tmp → os.replace`; receipt returned AND logged. `read_finviz_fields(targets, failures)`: load artifact (env-overridable path); artifact absent/short → `_note(failures, "finviz_universe", "missing")` → `{}`; artifact older than 4 days → served BUT counted (`_note(..., f"stale:{age_days}d")`); per-column guarded subscript assigns exactly like `context_joins.read_index_flags` — a column in `missing_headers` is absent from every row.

- [ ] **Step 1: Run the id probe; paste its census into your report** (and the sample-row units). Pin `_C_IDS` and correct `_HEADERS` to the measured names.
- [ ] **Step 2: Write the failing tests** — `_parse` shapes (suffixes, %, '-', junk); `run_pull` against a monkeypatched fetch returning a synthetic CSV (kept rows, missing-header census, `_MIN_ROWS` refusal preserves a prior artifact); `read_finviz_fields` healthy/missing/stale/per-column-absence, all against `SCREENER_FINVIZ_ARTIFACT` in tmp_path. No sockets anywhere.
- [ ] **Step 3: Run RED, Step 4: implement, Step 5: green** — `python -m pytest tests/test_screener_wave2_finviz.py -v`.
- [ ] **Step 6: Commit**

```bash
git add tools/screener_wave2_finviz_ids.py api/services/screener/finviz_universe.py tests/test_screener_wave2_finviz.py
git commit -m "screener: nightly Finviz whole-market pull (float/short/ownership) + artifact reader"
```

---

### Task 4: earnings_dates.py — chunked FMP calendar pull + session parse

**Files:**
- Create: `api/services/screener/earnings_dates.py`
- Modify: `api/services/screener/snapshot_builder.py` (the `days_to_earnings` derivation)
- Test: `tests/test_screener_wave2_earnings_dates.py` (new)

**Interfaces:**
- Produces: `earnings_dates.run_pull() -> receipt` writing `<DATA>/screener_earnings_dates.json` (`{as_of, rows: {TICKER: {date, session}}}`, EARLIEST future date per symbol wins); `read_earnings_dates(targets, failures=None) -> {TICKER: {"next_earnings_date": iso, "earnings_session": "bmo"|"amc"|"tbd"}}`; env override `SCREENER_EDATES_ARTIFACT`.
- `build_row` derives `days_to_earnings` (after the `ipo_age_days` block):

```python
    if row.get("next_earnings_date"):
        try:
            nxt = datetime.date.fromisoformat(str(row["next_earnings_date"])[:10])
            row["days_to_earnings"] = (nxt - datetime.date.today()).days
        except (TypeError, ValueError):
            pass
```

**The pull:** `earnings_estimates._fmp_get("/stable/earnings-calendar", {"from": d0, "to": d1})` in **7-day chunks over the next 84 days** (12 requests, each far under the 4,000-row silent truncation; the truncation is the whole reason for chunking — say so in the module docstring, citing the measured 4,000 cap). Mirror `implied_store._fmp_reporters`'s field handling for the row shape (READ it first — it already parses this exact endpoint's rows); dates arrive in mixed `8/6/2026` and `08/06/2026` forms in some Finviz-adjacent feeds, but FMP's are ISO — still parse defensively with `[:10]` + `fromisoformat` in a try. Session: if the row carries a time/hour field, threshold-parse it (`<09:30` → bmo, `>=16:00` → amc, else tbd — a SENTINEL clock is parsed as a THRESHOLD, never an equality); if FMP carries no session field (its known gap), every row is `tbd` and the receipt records `sessions_resolved=0` so the gap is visible, not silent.

- [ ] **Step 1: Write the failing tests** — chunk-window math (12 windows, contiguous, no overlap); earliest-future-date-wins on duplicate symbols; threshold session parse (0930 boundary → tbd side, 0929 → bmo; 1600 → amc); reader healthy/missing/stale against tmp artifacts; a monkeypatched `_fmp_get` returning >0 rows per chunk yields a receipt whose `rows` equals the deduped union.
- [ ] **Step 2: RED, Step 3: implement, Step 4: green** — `python -m pytest tests/test_screener_wave2_earnings_dates.py -v`.
- [ ] **Step 5: Commit**

```bash
git add api/services/screener/earnings_dates.py api/services/screener/snapshot_builder.py tests/test_screener_wave2_earnings_dates.py
git commit -m "screener: nightly earnings-date pull (chunked past the 4,000-row truncation)"
```

---

### Task 5: earnings_context.py — last-report move + implied move + setup grade from local stores

**Files:**
- Create: `api/services/screener/earnings_context.py`
- Test: `tests/test_screener_wave2_earnings_context.py` (new)

**Interfaces:**
- Produces TWO readers (registered separately — they are two stores):
  - `read_last_report_move(targets, failures=None) -> {TICKER: {"last_report_move_pct": float}}` — one query over the earnings wire store: latest print per symbol (`SELECT sym, peak_move_pct, MAX(market_date) FROM wire_prints GROUP BY sym`), via the wire store module's own `_connect` (monkeypatch seam: `api.services.wire.store`); absent symbol → key absent (NULL — the store only holds ~since 2026-07-30, honest coverage).
  - `read_implied_context(targets, failures=None) -> {TICKER: {"implied_move_pct": float, "earnings_setup_grade": str}}` — reporters within 14 days via `implied_store.upcoming_reporters(days=14)`; per distinct `report_date` one `implied_store.get_implied_for_date(date)` call; grade from `grade_snapshots` latest row per symbol with `surface=setup_grade.SURFACE` (import the constant — `api/services/setup_grade.py:29`, `SURFACE = "setup"`; never retype the literal). Non-reporters → keys absent (disclosed NULL, per spec).

Both readers: dead store / raise → `_note` + `{}`. Emit dict literals / constant-key subscripts (rail visibility).

- [ ] **Step 1: failing tests** — monkeypatch `wire.store._connect` with an in-memory sqlite holding two prints for one sym (latest wins) + one for another; monkeypatch `implied_store.upcoming_reporters`/`get_implied_for_date`/grade query seam; assert absent-symbol keys absent; failure paths counted.
- [ ] **Step 2: RED → implement → green** — `python -m pytest tests/test_screener_wave2_earnings_context.py -v`.
- [ ] **Step 3: Commit**

```bash
git add api/services/screener/earnings_context.py tests/test_screener_wave2_earnings_context.py
git commit -m "screener: earnings context readers (last-report move, implied move, setup grade)"
```

---

### Task 6: analyst_pass.py — the store + the per-ticker client

**Files:**
- Create: `api/services/screener/analyst_pass.py` (store + client halves; the job runner is Task 7's half of the same file)
- Test: `tests/test_screener_wave2_analyst_store.py` (new)

**Interfaces:**
- Store: SQLite at `SCREENER_ANALYST_DB_PATH` env → `/data/screener_analyst.db`; table
  `analyst_rows(ticker TEXT PRIMARY KEY, consensus TEXT, pt_target REAL, upgrades_30d INTEGER, downgrades_30d INTEGER, eps_next_y_growth REAL, fetched_at INTEGER)` + `analyst_runs(started_at INTEGER, finished_at INTEGER, actives INTEGER, tail_slice INTEGER, fetched INTEGER, errors INTEGER, budget_stop INTEGER)` (the receipt table). WAL; `contextlib.closing` on every connection (the ssetf lesson).
- Client: `fetch_one(ticker) -> dict | None` — three `earnings_estimates._fmp_get` legs (this is the SCREENER's lean nightly client; `analyst_grades.get_analyst_grades` stays the request-path composition, untouched — two consumers, one provider, DIFFERENT columns, no overlap):
  1. `/stable/grades-consensus` → `consensus` label (the `consensus` field, e.g. "Buy"); None when bucket total is 0 (mirror `analyst_grades._consensus`'s zero-total refusal).
  2. `/stable/price-target-consensus` → `pt_target` = `targetConsensus` (fall back `targetMedian`); None when both null.
  3. `/stable/grades?limit=40` → count rows with `action in ("upgrade","downgrade")` whose `date` is within 30 days of today → `upgrades_30d`/`downgrades_30d` (0 is a REAL answer when the leg returned rows; None only when the leg failed).
  4. `/stable/analyst-estimates?symbol=&period=annual&limit=4` → `eps_next_y_growth` = (next-FY `estimatedEpsAvg` / current-FY `estimatedEpsAvg` − 1) × 100, None when either side missing or the base is ≤ 0 (a negative-base growth number is meaningless — the same refusal `earnings_growth_fmp` documents). READ `annual_financials.py`'s parse of this endpoint first and mirror its field names.
  A leg that raises nulls only its slice; `fetch_one` returns None only when ALL legs nulled.
- `upsert(ticker, row, now)`, `stalest(tickers, n)` (fetched_at ascending, never-fetched first — the `_stalest` idiom), `read_analyst_fields(targets, failures=None)` → rows with `fetched_at` within 8 days → `{TICKER: {five columns}}` (pt_upside is Task 10's derivation, not stored).

- [ ] **Step 1: failing tests** — store roundtrip + stalest ordering + freshness window in tmp DB; `fetch_one` against a monkeypatched `_fmp_get` (per-leg isolation: one raising leg nulls its slice only; zero-total consensus refused; negative-base growth refused; 30-day action counting with boundary dates).
- [ ] **Step 2: RED → implement → green** — `python -m pytest tests/test_screener_wave2_analyst_store.py -v`.
- [ ] **Step 3: Commit**

```bash
git add api/services/screener/analyst_pass.py tests/test_screener_wave2_analyst_store.py
git commit -m "screener: analyst store + lean nightly client (consensus, PT, 30d actions, next-FY EPS)"
```

---

### Task 7: analyst_pass.py — the cadenced job (actives daily, tail rotated weekly)

**Files:**
- Modify: `api/services/screener/analyst_pass.py`
- Test: `tests/test_screener_wave2_analyst_job.py` (new)

**Interfaces:**
- `actives() -> set[str]` — the spec's definition, each leg guarded and countable:
  member watchlists (`SELECT DISTINCT UPPER(sym) FROM watchlist_items` via `api.services.auth_db.get_connection` — read-only, one query) ∪ UCT20 (`engine.get_leadership`, ticker/sym/symbol coalesce — the `context_joins.read_uct20` idiom) ∪ current candidates (`engine.get_candidates()` buckets, same coalesce) ∪ top-500 by `dollar_vol_30d` (`SELECT ticker FROM screener_rows WHERE dollar_vol_30d IS NOT NULL ORDER BY dollar_vol_30d DESC LIMIT 500` via `snapshot_db.connect`). Intersected with the cap universe.
- `run_pass(now=None) -> receipt` — targets = actives ∪ tail-slice, where tail = universe − actives and the slice is `sorted(tail)[day_index % 7::7]` (one-seventh nightly = full tail weekly, even budget); order within the run = `stalest()`; pacing `SCREENER_ANALYST_GAP_SECONDS` (default `0.25`); **wall-clock deadline 04:45 ET** (derived stop: give up STARTING tickers past it, count `budget_stop`; the scan sweep's between-items check idiom); receipt row written to `analyst_runs` and returned. Success is read from the receipt/artifact, never the log.
- Env: `SCREENER_ANALYST_PASS_ENABLED` default `"0"` in code — the scan-sweep precedent for budget-spending jobs (Railway sets `1` at ship; the divergence is deliberate and documented where the flag is read).

- [ ] **Step 1: failing tests** — `actives()` with every leg monkeypatched (union + coalesce + a dead leg costs only its members and is counted); tail rotation covers the whole tail across 7 consecutive day-indices with no overlap per night; `run_pass` with a monkeypatched `fetch_one` + frozen `now`: deadline stop counted, receipt arithmetic (`fetched + errors + budget_stop`-consistent), stalest-first order observed.
- [ ] **Step 2: RED → implement → green** — `python -m pytest tests/test_screener_wave2_analyst_job.py tests/test_screener_wave2_analyst_store.py -v`.
- [ ] **Step 3: Commit**

```bash
git add api/services/screener/analyst_pass.py tests/test_screener_wave2_analyst_job.py
git commit -m "screener: cadenced analyst pass — actives nightly, tail in weekly rotation, deadline-bounded"
```

---

### Task 8: insider_capture.py — accumulate cluster buys, answer in days-since

**Files:**
- Create: `api/services/screener/insider_capture.py`
- Test: `tests/test_screener_wave2_insider.py` (new)

**Interfaces:**
- Store: SQLite at `SCREENER_INSIDER_DB_PATH` → `/data/screener_insider.db`; `cluster_latest(ticker TEXT PRIMARY KEY, last_trade_date TEXT, insiders INTEGER, value_usd REAL, captured_at INTEGER)`.
- `run_capture() -> receipt` — `insider_clusters.get_recent_clusters(days=7, count=50)`; upsert each cluster's ticker keeping the NEWEST `trade_date` (`MAX` on conflict — the wire_prints ratchet idiom); an `error` payload from the scrape → receipt records it, store untouched (never blank a good store on a bad scrape).
- `read_insider_fields(targets, failures=None) -> {TICKER: {"insider_cluster_days": int}}` — days since `last_trade_date` vs today, only when ≤ 90; otherwise key absent (an INT column: NULL means "no recent cluster", which is the honest reading of both never-clustered and long-ago — a 0-fill would claim a cluster TODAY).
- OpenInsider dates arrive as `YYYY-MM-DD` in the trade-date cell; parse defensively, skip unparseable rows counted in the receipt.

- [ ] **Step 1: failing tests** — capture upsert ratchet (older trade_date never regresses a newer one); scrape-error leaves store intact; days-since boundary (90 in, 91 out); reader absent-key semantics; all in tmp DBs with `get_recent_clusters` monkeypatched.
- [ ] **Step 2: RED → implement → green** — `python -m pytest tests/test_screener_wave2_insider.py -v`.
- [ ] **Step 3: Commit**

```bash
git add api/services/screener/insider_capture.py tests/test_screener_wave2_insider.py
git commit -m "screener: insider cluster capture + days-since reader"
```

---

### Task 9: enrich — ratings components + sector RS + sponsorship, and the inst_pct handover

**Files:**
- Modify: `api/services/screener/enrich.py`
- Modify: `api/services/screener/snapshot_builder.py` (`_read_ratings` threads sector distributions)
- Test: `tests/test_screener_wave2_enrich.py` (new)

**Interfaces:**
- `enrich.load_sector_distributions()` (mirror of `load_distributions`, wrapping `ratings_db.get_sector_distributions`, `{}`-on-error).
- `ratings_fields(metrics, dists, sdists=None)` — signature grows one optional param; `_read_ratings` loads both once per call and threads them.
- New emissions (all dict-literal / constant-key writes): `blended_growth` (direct passthrough), `sector_rs_pct` (`ratings_db.sector_percentile(metrics.get("sector"), "rs_return", metrics.get("rs_return"), sdists)`), `rating_eps`/`rating_growth`/`rating_value`/`rating_smr` (the `eps`/`growth`/`value`/`smr_n` legs the function ALREADY computes — exposed as `int(round(x))` when not None), `sponsorship` (`_letter(_pct("inst_pct", metrics.get("inst_pct")))` when the percentile resolves — the research page's own sponsorship path).
- **The handover:** `inst_pct` LEAVES the `direct` map here, in this task, with a docstring block in the file's established handover voice (the op_margin/roe/peg precedent is directly above it): the Finviz nightly pull (Task 3) is the new authority — full-universe, nightly, one request — while the ratings store's `inst_pct` remains an INPUT to `sponsorship` and the composite, exactly the still-an-input-no-longer-an-output shape this module already uses three times. ⚠️ Ordering rail: Task 3's module stays UNWIRED until Task 10 registers both sides in the same commit-window, so no dual-writer window ever exists; state this in the docstring.
- Deliberately absent, documented beside the additions: `rating_rs` (`rs_rank` IS the RS component; a second spelling would be the repo's most repeated defect wearing a new name).

```python
    # ── Wave 2: components + sector RS + sponsorship ──
    if metrics.get("blended_growth") is not None:
        out["blended_growth"] = metrics["blended_growth"]
    if eps is not None:
        out["rating_eps"] = int(round(eps))
    if growth is not None:
        out["rating_growth"] = int(round(growth))
    if value is not None:
        out["rating_value"] = int(round(value))
    if smr_n is not None:
        out["rating_smr"] = int(round(smr_n))
    sp = _pct("inst_pct", metrics.get("inst_pct"))
    if sp is not None:
        out["sponsorship"] = _letter(sp)
    if sdists:
        srs = ratings_db.sector_percentile(
            metrics.get("sector"), "rs_return", metrics.get("rs_return"),
            sdists)
        if srs is not None:
            out["sector_rs_pct"] = int(srs)
```

(Placement: after the existing `accdis` block, before the composite; `eps`/`growth`/`value`/`smr_n` are already in scope there. `_pct` requires `dists` — when `dists` is `{}` it returns None and sponsorship stays absent: honest on a cold store.)

- [ ] **Step 1: failing tests** — with a full `METRIC_COLUMNS`-derived metrics dict and synthetic dists (≥200 values so `percentile` resolves) + sector dists (≥15 values): all seven new keys emit with plausible values; with `dists={}`: sponsorship/sector_rs absent, `blended_growth` still direct; `inst_pct` ABSENT from the output in both cases (the handover — assert `"inst_pct" not in out`); composite unchanged for a fixed input (pin one composite value pre/post-edit to prove the additions changed no existing output).
- [ ] **Step 2: RED → implement (enrich + `_read_ratings` threading) → green** — `python -m pytest tests/test_screener_wave2_enrich.py tests/test_screener_enrich.py -v`.
- [ ] **Step 3: Commit**

```bash
git add api/services/screener/enrich.py api/services/screener/snapshot_builder.py tests/test_screener_wave2_enrich.py
git commit -m "screener: ratings components + sector RS + sponsorship; inst_pct hands over to the Finviz pull"
```

---

### Task 10: Builder wiring — six Wave 2 readers, one market_row, three derivations, rails extended

**Files:**
- Modify: `api/services/screener/snapshot_builder.py` (imports, `build_row` signature, `run_build`)
- Modify: `tests/test_screener_fundamentals_bulk.py` (`_source_key_sets` — six new entries + sector-dist stub)
- Test: `tests/test_screener_wave2_wiring.py` (new)

**Interfaces:**
- `build_row(ticker, bars, ratings_row, fundamentals, rs_row=None, bulk_row=None, spy_closes=None, context_row=None, market_row=None)` — `market_row` is the per-ticker merge of the six Wave 2 readers, merged in the dict-source tuple between `ratings_row` and `context_row` (`rs_fields` stays last):

```python
    for src in (fundamentals or {}, bulk_row or {}, ratings_row or {},
                market_row or {}, context_row or {}, rs_fields(rs_row)):
```

- `run_build` reads once per build, beside the context reads:

```python
    finviz_map = finviz_universe.read_finviz_fields(targets, failures=sources)
    edates_map = earnings_dates.read_earnings_dates(targets, failures=sources)
    lastmove_map = earnings_context.read_last_report_move(targets, failures=sources)
    implied_map = earnings_context.read_implied_context(targets, failures=sources)
    analyst_map = analyst_pass.read_analyst_fields(targets, failures=sources)
    insider_map = insider_capture.read_insider_fields(targets, failures=sources)
```

…and per ticker: `market_row = {**finviz_map.get(T, {}), **edates_map.get(T, {}), **lastmove_map.get(T, {}), **implied_map.get(T, {}), **analyst_map.get(T, {}), **insider_map.get(T, {})}` threaded as `market_row=market_row`.
- The `pt_upside_pct` derivation in `build_row`, after the bars block (price exists there), beside `dollar_vol_30d`:

```python
    if row.get("pt_target") is not None and row.get("price"):
        row["pt_upside_pct"] = round(
            (row["pt_target"] / row["price"] - 1) * 100, 2)
```

- `_source_key_sets` gains six entries obtained by RUNNING each reader against stubs (artifact tmp files for finviz/edates via their env overrides; monkeypatched store seams for the rest), plus `get_sector_distributions` stubbed with a ≥15-value Technology pool so `enrich.ratings_fields`'s grown key set (incl. `sector_rs_pct`) is fully exercised. The pairwise rail then covers 14 sources with zero allowance changes (every key set disjoint by construction — `inst_pct` now appears ONLY in the finviz entry).

- [ ] **Step 1: failing tests** —

```python
def test_build_row_merges_market_row_and_derives_pt_upside():
    from api.services.screener import snapshot_builder
    bars = [{"o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "v": 1000}] * 40
    row = snapshot_builder.build_row(
        "T", bars, None, None,
        market_row={"short_float_pct": 22.4, "pt_target": 125.0,
                    "next_earnings_date": "2026-09-03"})
    assert row["short_float_pct"] == 22.4
    assert row["pt_upside_pct"] == 25.0          # 125 vs price 100
    assert row["days_to_earnings"] is not None   # T4's derivation fires


def test_run_build_passes_market_row_through(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_builder as sb, snapshot_db
    from api.services.screener import (finviz_universe, earnings_dates,
                                       earnings_context, analyst_pass,
                                       insider_capture, context_joins as cj)
    bars = [(20250101 + i, 100.0, 100.5, 99.5, 100.0, 1000) for i in range(60)]
    monkeypatch.setattr(sb, "_load_universe", lambda: ["AAA"])
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(bs, "get_bars", lambda t, tf, n: bars)
    monkeypatch.setattr(sb, "_read_rs_map", lambda: {})
    monkeypatch.setattr(sb, "_read_bulk_fundamentals",
                        lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_fundamentals",
                        lambda t, price=None, failures=None: {})
    monkeypatch.setattr(sb, "_read_spy_closes", lambda: [])
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags",
               "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})

    calls = {"finviz": 0, "analyst": 0}

    def finviz_stub(targets, failures=None):
        calls["finviz"] += 1
        return {"AAA": {"short_float_pct": 31.2}}

    def analyst_stub(targets, failures=None):
        calls["analyst"] += 1
        return {"AAA": {"pt_target": 130.0}}

    monkeypatch.setattr(finviz_universe, "read_finviz_fields", finviz_stub)
    monkeypatch.setattr(analyst_pass, "read_analyst_fields", analyst_stub)
    for mod, fn in ((earnings_dates, "read_earnings_dates"),
                    (earnings_context, "read_last_report_move"),
                    (earnings_context, "read_implied_context"),
                    (insider_capture, "read_insider_fields")):
        monkeypatch.setattr(mod, fn, lambda targets, failures=None: {})

    out = sb.run_build(max_tickers=1)
    assert out["built"] == 1
    row = snapshot_db.get_row("AAA")
    assert row["short_float_pct"] == 31.2
    assert row["pt_target"] == 130.0
    assert row["pt_upside_pct"] == 30.0        # derived vs price 100
    assert calls == {"finviz": 1, "analyst": 1}  # one read per build, each
```

- [ ] **Step 2: RED → implement → green** — `python -m pytest tests/test_screener_wave2_wiring.py tests/test_screener_fundamentals_bulk.py tests/test_screener_builder.py tests/test_scalar_population_rail.py tests/test_screener_wave1_wiring.py -v`.
- [ ] **Step 3: Commit**

```bash
git add api/services/screener/snapshot_builder.py tests/test_screener_wave2_wiring.py tests/test_screener_fundamentals_bulk.py
git commit -m "screener: wire the six Wave-2 readers into the nightly build; rails cover 14 sources"
```

---

### Task 11: Job registration — four new nightly jobs in register_screener_jobs

**Files:**
- Modify: `api/main.py` (`register_screener_jobs`, between the scan-sweep block and `start_screener_snapshot_warm()` at `:1279-1281`)
- Test: `tests/test_screener_wave2_jobs.py` (new)

**Interfaces:** four registrations, each in the house idiom (env-gated wrapper fn, CronTrigger ET, `max_instances=1`, `replace_existing=True`, job id pinned):

| id | time ET | gate (default) | runs |
|---|---|---|---|
| `screener_finviz_universe` | 02:45 | `SCREENER_FINVIZ_ENABLED` ("1") | `finviz_universe.run_pull` |
| `screener_earnings_dates` | 02:50 | `SCREENER_EDATES_ENABLED` ("1") | `earnings_dates.run_pull` |
| `screener_insider_capture` | 02:40 | `SCREENER_INSIDER_ENABLED` ("1") | `insider_capture.run_capture` |
| `screener_analyst_pass` | 02:00 | `SCREENER_ANALYST_PASS_ENABLED` (**"0"** — the scan-sweep precedent for budget-spending jobs; Railway sets 1 at ship, divergence documented at the flag read) | `analyst_pass.run_pass` |

Each job body wraps its runner in try/except, logs the RECEIPT dict on success (`log.info("[screener] %s receipt: %s", job_id, receipt)`) — the receipt line is what Task 14's verification greps, and the artifact is what it trusts.

- [ ] **Step 1: failing test** — the desk-audit idiom: AST over `api/main.py` asserting all four `add_job` ids exist inside `register_screener_jobs`, WITH a non-vacuity control (the probe must also see the sibling `screener_snapshot_nightly` id, and must NOT see a made-up id):

```python
import ast


def _add_job_ids():
    src = open("api/main.py", encoding="utf-8").read()
    tree = ast.parse(src)
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            for kw in node.keywords or ():
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    ids.add(kw.value.value)
    return ids


def test_wave2_jobs_are_registered():
    ids = _add_job_ids()
    assert "screener_snapshot_nightly" in ids          # control: probe sees
    assert "definitely_not_a_job" not in ids           # control: probe honest
    for jid in ("screener_finviz_universe", "screener_earnings_dates",
                "screener_insider_capture", "screener_analyst_pass"):
        assert jid in ids, jid
```

- [ ] **Step 2: RED → implement → green** — `python -m pytest tests/test_screener_wave2_jobs.py tests/test_screener_schedule.py -v`. Then `grep -c broker_sync api/main.py` (≥ 7 — shared-file invariant; report the number).
- [ ] **Step 3: Commit**

```bash
git add api/main.py tests/test_screener_wave2_jobs.py
git commit -m "screener: register the four Wave-2 nightly jobs (finviz, earnings dates, insider, analyst)"
```

---

### Task 12: Registry + defs for the non-bulk families (26 controls, 2 new categories)

**Files:**
- Modify: `api/services/screener/filters.py`
- Modify: `app/src/pages/screener/columnDefs.js`
- Test: existing rails (`tests/test_screener_filters.py`, `tests/test_screener_wave1_columndefs.py`) must stay green — they force def coverage automatically.

**Interfaces:** two NEW categories appended to CATEGORIES (the panel renders from meta — zero frontend surgery, the Wave 1 mechanism):

```python
    {"key": "ownership", "label": "Ownership & Insiders"},
    {"key": "events", "label": "Events & Analysts"},
```

(final order: descriptive, fundamental, performance, technical, momentum, single_candle, multi_candle, pattern, ownership, events, context).

FILTERS additions — ALL bare (`_open_range`) or value-definitional enums; ZERO factual presets:

```python
    # ── ownership (Wave 2) ──
    _open_range("shares_outstanding", "Shares Outstanding", "ownership",
                "shares_outstanding"),
    _open_range("float_shares", "Float (Shares)", "ownership", "float_shares"),
    _open_range("float_pct", "Float % of Shares", "ownership", "float_pct",
                unit="%"),
    _open_range("short_float_pct", "Short % of Float", "ownership",
                "short_float_pct", unit="%"),
    _open_range("short_ratio", "Short Ratio (Days to Cover)", "ownership",
                "short_ratio"),
    _open_range("insider_own_pct", "Insider Ownership", "ownership",
                "insider_own_pct", unit="%"),
    _open_range("insider_cluster_days", "Insider Cluster Buy (days ago)",
                "ownership", "insider_cluster_days"),
    # inst_pct's existing filter keeps its key/category; only its writer moved.
    # ── events (Wave 2) ──
    _open_range("next_earnings_date", "Next Earnings Date", "events",
                "next_earnings_date"),
    _open_range("days_to_earnings", "Days to Earnings", "events",
                "days_to_earnings"),
    _enum("earnings_session", "Earnings Session", "events", "earnings_session",
          [{"label": "Any"},
           {"label": "Before the open", "op": "eq", "value": "bmo"},
           {"label": "After the close", "op": "eq", "value": "amc"},
           {"label": "Time TBD", "op": "eq", "value": "tbd"}]),
    _open_range("last_report_move_pct", "Last Report Move", "events",
                "last_report_move_pct", unit="%"),
    _open_range("implied_move_pct", "Implied Move (pre-report)", "events",
                "implied_move_pct", unit="%"),
    _enum("earnings_setup_grade", "Earnings Setup Grade", "events",
          "earnings_setup_grade", [{"label": "Any"}],
          options_column="earnings_setup_grade"),
    _enum("analyst_consensus", "Analyst Consensus", "events",
          "analyst_consensus", [{"label": "Any"}],
          options_column="analyst_consensus"),
    _open_range("pt_target", "Price Target", "events", "pt_target", unit="$"),
    _open_range("pt_upside_pct", "PT Upside", "events", "pt_upside_pct",
                unit="%"),
    _open_range("upgrades_30d", "Upgrades (30d)", "events", "upgrades_30d"),
    _open_range("downgrades_30d", "Downgrades (30d)", "events",
                "downgrades_30d"),
    _open_range("eps_next_y_growth", "EPS Growth Next FY (est)", "events",
                "eps_next_y_growth", unit="%"),
    # ── ratings components (fundamental) ──
    _open_range("blended_growth", "Blended Growth", "fundamental",
                "blended_growth", unit="%"),
    _open_range("sector_rs_pct", "Sector RS", "fundamental", "sector_rs_pct"),
    _open_range("rating_eps", "EPS Rating", "fundamental", "rating_eps"),
    _open_range("rating_growth", "Growth Rating", "fundamental",
                "rating_growth"),
    _open_range("rating_value", "Value Rating", "fundamental", "rating_value"),
    _open_range("rating_smr", "SMR Rating", "fundamental", "rating_smr"),
    _enum("sponsorship", "Sponsorship Grade", "fundamental", "sponsorship",
          [{"label": "Any"}], options_column="sponsorship"),
```

columnDefs additions (helpers exist: `num`, `pct`, `pctPlain`, `usd`, `shares`, `bool`):

```js
  shares_outstanding: { label: 'Shs Out', fmt: shares },
  float_shares: { label: 'Float', fmt: shares },
  float_pct: { label: 'Float%', fmt: pctPlain(0) },
  short_float_pct: { label: 'Short%', fmt: pctPlain(1) },
  short_ratio: { label: 'Days2Cvr', fmt: num(1) },
  insider_own_pct: { label: 'Insider%', fmt: pctPlain(0) },
  insider_cluster_days: { label: 'Cluster', fmt: v => v == null ? '—' : `${v}d` },
  next_earnings_date: { label: 'Earnings', fmt: v => v ? String(v).slice(5, 10) : '—' },
  earnings_session: { label: 'Session', fmt: v => v === 'bmo' ? 'BMO' : v === 'amc' ? 'AMC' : v ? 'TBD' : '—' },
  days_to_earnings: { label: 'Days→ER', fmt: num(0) },
  last_report_move_pct: { label: 'Last Move', fmt: pct },
  implied_move_pct: { label: 'Impl Move', fmt: pctPlain(1) },
  earnings_setup_grade: { label: 'ER Grade', fmt: v => v || '—' },
  analyst_consensus: { label: 'Consensus', fmt: v => v || '—' },
  pt_target: { label: 'PT', fmt: usd },
  pt_upside_pct: { label: 'PT Upside', fmt: pct, heat: heatPos },
  upgrades_30d: { label: 'Upgr 30d', fmt: num(0) },
  downgrades_30d: { label: 'Dngr 30d', fmt: num(0) },
  eps_next_y_growth: { label: 'EPS Next Y', fmt: pctPlain(0) },
  blended_growth: { label: 'Blend Gr', fmt: pctPlain(0) },
  sector_rs_pct: { label: 'Sect RS', fmt: num(0), heat: heatRs },
  rating_eps: { label: 'EPS Rt', fmt: num(0), heat: heatRs },
  rating_growth: { label: 'Gr Rt', fmt: num(0), heat: heatRs },
  rating_value: { label: 'Val Rt', fmt: num(0), heat: heatRs },
  rating_smr: { label: 'SMR', fmt: num(0), heat: heatRs },
  sponsorship: { label: 'Spons', fmt: v => v || '—' },
```

- [ ] **Step 1: baseline** — `python -m pytest tests/test_screener_filters.py tests/test_screener_wave1_columndefs.py -v` green BEFORE edits.
- [ ] **Step 2: apply both files' edits.** If a dynamic-enum rail pins the `options_column` set, extend it the derived way (the Wave 1 pre-ruling stands). No factual exemptions under any circumstance.
- [ ] **Step 3: green** — same suites + `python -m pytest tests/test_screener_query.py tests/test_screener_api.py -v`; meta smoke `python -c "import sys; sys.path.insert(0,'.'); from api.services.screener import filters; m=filters.meta(); print(len(m['filters']), len(m['categories']))"` → ~125 filters, 11 categories (record exact).
- [ ] **Step 4: Commit**

```bash
git add api/services/screener/filters.py app/src/pages/screener/columnDefs.js
git commit -m "screener: ownership + events categories — 26 Wave-2 controls, defs, zero invented thresholds"
```

---

### Task 13: Verification — smoke, suites, build

**Files:**
- Create: `tools/screener_wave2_smoke.py`

The smoke extends the Wave 1 pattern (READ-ONLY, build_row in memory, writes nothing): 20 real tickers' bars from the local store; `market_row` assembled from the REAL Wave 2 readers where their local stores/artifacts exist, `{}` where absent — and it PRINTS which sources were present, because on the dev box most artifacts won't exist yet and "absent locally" must never read as "broken":

```python
"""Wave 2 smoke: build_row over 20 real tickers with whatever Wave-2 source
artifacts exist locally. READ-ONLY. Bar-derived + FMP-derivation columns
must populate when their inputs are present; job-fed columns report
source-presence honestly instead of pretending."""
import json
import sys

sys.path.insert(0, ".")
from api.services.screener import snapshot_builder as sb          # noqa: E402
from api.services.screener import (finviz_universe, earnings_dates,   # noqa: E402
                                   earnings_context, analyst_pass,
                                   insider_capture)

universe = [t for t in json.load(open("api/data/cap_universe.json"))
            if isinstance(t, str)][:20]
sources = {}
readers = {
    "finviz": finviz_universe.read_finviz_fields,
    "edates": earnings_dates.read_earnings_dates,
    "lastmove": earnings_context.read_last_report_move,
    "implied": earnings_context.read_implied_context,
    "analyst": analyst_pass.read_analyst_fields,
    "insider": insider_capture.read_insider_fields,
}
maps = {}
for name, fn in readers.items():
    try:
        maps[name] = fn(universe, failures=sources)
    except Exception as exc:                                   # noqa: BLE001
        maps[name] = {}
        sources.setdefault(name, {})[type(exc).__name__] = 1
print("source presence:", {k: bool(v) for k, v in maps.items()})
print("failure census:", sources)

spy = sb._read_spy_closes()
census, rows = {}, 0
for t in universe:
    bars = sb._read_daily_bars(t)
    if not bars:
        continue
    T = t.upper()
    market_row = {}
    for m in maps.values():
        market_row.update(m.get(T, {}))
    row = sb.build_row(t, bars, None, None, spy_closes=spy,
                       market_row=market_row)
    rows += 1
    for k, v in row.items():
        if v is not None:
            census[k] = census.get(k, 0) + 1
print(f"rows built: {rows}")
for c in ("ipo_age_days", "days_to_earnings", "pt_upside_pct",
          "short_float_pct", "next_earnings_date", "rating_eps",
          "sponsorship", "insider_cluster_days"):
    print(f"  {c}: {census.get(c, 0)}/{rows}")
```

- [ ] **Step 1:** `python tools/screener_wave2_smoke.py` — record output; job-fed columns at 0/N with their source absent locally is EXPECTED and must be reported as such, not "fixed".
- [ ] **Step 2:** explicit suites — `python -m pytest tests/test_screener_wave2_schema.py tests/test_screener_wave2_fmp_bulk.py tests/test_screener_wave2_finviz.py tests/test_screener_wave2_earnings_dates.py tests/test_screener_wave2_earnings_context.py tests/test_screener_wave2_analyst_store.py tests/test_screener_wave2_analyst_job.py tests/test_screener_wave2_insider.py tests/test_screener_wave2_enrich.py tests/test_screener_wave2_wiring.py tests/test_screener_wave2_jobs.py tests/test_screener_fundamentals_bulk.py tests/test_screener_builder.py tests/test_screener_filters.py tests/test_scalar_population_rail.py tests/test_ast_scalars.py -v` — all green.
- [ ] **Step 3:** frontend — `cd app && npx vitest run src/pages/screener src/components/chart/engine/ast/freshness.test.js --pool=threads --execArgv=--no-warnings && npm run build`.
- [ ] **Step 4: Commit** — `git add tools/screener_wave2_smoke.py` → `screener: wave-2 read-only smoke (source presence honest)`.

---

### Task 14: Ship + verify by the artifact

- [ ] **Step 1: Sync** — `git fetch origin && git merge origin/master`; `grep -c broker_sync api/main.py` ≥ 7; re-run the Task 13 Step 2 suite list `-q`.
- [ ] **Step 2: Railway env BEFORE the code push** (⚠️ `railway variables --set` auto-redeploys — set the flag first so ONE deploy carries both): from `C:\Users\Patrick\uct-dashboard` via PowerShell, `railway variables --service web --set "SCREENER_ANALYST_PASS_ENABLED=1"`. The other three gates default on.
- [ ] **Step 3: Push** — `git push origin feat/screener-deep-work:master` (market-hours freeze → `UCT_PUSH_OVERRIDE=1`, standing rule). Push the branch pointer too.
- [ ] **Step 4: Same-night verify** (browser UA on curls; owner's authed browser for member endpoints):
  1. `/api/health` uptime reset.
  2. `GET /api/screener/meta` → ~125 filters / 11 categories.
  3. Admin `POST /api/screener/refresh?max_tickers=300` → 3 min → scan `{"filters":[{"key":"payout_ratio","op":"gte","min":0}],"view":"overview","page_size":5}` returns rows with non-null `payout_ratio` (T2's columns fill in-build via the bulk pass; job-fed columns CANNOT fill until their 02:00–02:50 jobs run — do not chase them tonight).
- [ ] **Step 5: Next-morning verify (the real gate for this wave)** — after the 02:00–03:00 job train + build:
  1. `railway logs -n 5000` → the four `receipt:` lines (finviz rows ≥ universe-size-ish; edates rows; insider; analyst fetched/budget_stop) + the build receipt: `empty_columns` must not name any Wave 2 column whose job ran; `sources` census read per leg.
  2. Authed scan: `short_float_pct gte 20` + `days_to_earnings lte 7` returns plausible names with values.
  3. Analyst coverage ramps over 7 nights by design (tail rotation) — judge `analyst_rows` count against actives+one-slice, not the universe.
  4. Record outcomes in the session ledger/memory; any 0/N job-fed column with a healthy receipt is a REAL defect — investigate before Wave 3's cutover ships on top.

## Execution notes

- Parallel-safe after T1 (disjoint files): {T2} {T3} {T4} {T5} {T6+T7 as one sequential pair} {T8}. T9 solo (enrich + builder touch — hold until T2/T4's builder edits land or batch T2/T4/T9's builder derivations carefully; simplest: run T2 first alone, then T3–T8 in parallel, then T9). T10→T14 strictly serial.
- T2 and T12 both edit `filters.py`/`columnDefs.js` — they are serialized by construction (T12 runs after T10).
- The two probe tools are one-shot; their measured outputs are pasted into reports and pinned into code. If a probe cannot run locally (missing key/token), expected names ship with DONE_WITH_CONCERNS and the first prod receipt adjudicates — by NAME, per column, which is exactly what the receipt machinery exists for.

## Self-review (writing-plans checklist)

1. **Spec §2.2 coverage:** shares_outstanding ✓(T3, moved to Finviz — deviation noted) · quick_ratio/p_fcf/payout_ratio/roic/lt_debt_to_capital ✓(T2) · p_cash → `p_ocf` deviation ✓ · float/float%/short-float/short-ratio/insider-own ✓(T3) · inst_pct writer move ✓(T3+T9) · next_earnings/days_to/session ✓(T4) · last_report_move ✓(T5) · implied+grade ✓(T5) · analyst consensus/PT/up-downgrades/eps_next_y ✓(T6/T7) · insider clusters ✓(T8) · blended/sector-RS/components/sponsorship ✓(T9) · registry/defs/manifest ✓(T1/T2/T12) · jobs+receipts ✓(T11) · census extension ✓(T10). Revision-direction (`fundamentals_estimates_store`) — DEFERRED to Wave 6 gap-fill per spec §2.2's own "needs universe-wide capture" caveat; recorded deviation.
2. **Placeholder scan:** every task carries real code, including T10's full run_build wiring test. The two probe steps are measurement instructions whose outputs pin field/id names (fundamentals_bulk's own probed-not-assumed doctrine), with an explicit DONE_WITH_CONCERNS path when a key is unavailable locally — bounded contingencies, not TBDs. The one sketched body (the finviz id probe tool) names its exact mechanics, output contract, and the file whose idiom it mirrors.
3. **Type consistency:** `market_row` param name consistent across T10/T13; reader names consistent (`read_finviz_fields`, `read_earnings_dates`, `read_last_report_move`, `read_implied_context`, `read_analyst_fields`, `read_insider_fields`) across T3–T10 and the smoke; column names in T1's reference table match every task's emissions and T12's registry bindings 1:1 (35 = 9+6+6+6+1+7).

