# Single-Stock ETF Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A STOCK / 2X↑ / 2X↓ / ▾ control in the ChartWidget toolbar that swaps the chart to the most-liquid single-stock leveraged/inverse ETF (full ranked family panel behind the caret), backed by a nightly Finviz-export → name-parser → SQLite pipeline with fail-closed validation.

**Architecture:** Backend clones the `industry_map.py` shape: one Finviz Elite whole-market CSV per rebuild → pure-function name parser → staged+validated atomic swap into `/data/single_stock_etfs.db` → thin router (`GET /{symbol}` lookup, admin `POST /rebuild`, admin `GET /status`) + nightly APScheduler job + self-heal. Frontend is one self-contained component + one SWR hook mounted in ChartWidget with a ~5-line diff.

**Tech Stack:** FastAPI + SQLite (WAL) + httpx + APScheduler (backend); React + SWR + CSS modules + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-07-21-single-stock-etf-switcher-design.md` (rev 2). The spec is the authority on every behavior below; when a detail is ambiguous here, the spec wins.

## Global Constraints

- Worktree: `C:\Users\Patrick\uct-worktrees\single-stock-etfs`, branch `feat/single-stock-etfs`. ALL paths below are relative to this worktree root. Bash cwd can drift — use absolute paths in commands.
- Commits: explicit paths only (`git add -- <paths>`), NEVER `git add -A`. Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Backend tests: `python -m pytest tests/<file> -v` from the worktree root. Frontend tests: `cd app && npx vitest run --pool=threads <pattern>`.
- No emoji in UI — text/UIcon only. New CSS uses only 640/1024 breakpoint literals (not relevant here — the control uses a `@container` query).
- Kill switch env: `SINGLE_STOCK_ETFS_ENABLED` (default "1"), read via `os.environ.get` at call time.
- The Finviz auth token must NEVER appear in any log message.
- FastAPI route order: literal paths before `/{symbol}` wildcard.
- Frontend: all symbol swaps go through the `onSelect` prop → ChartWidget's `handleSymbolChange`. Never call `setGroupSym` directly.
- Deploy: ship = `git fetch origin && git rebase origin/master && git push origin feat/single-stock-etfs:master` as ONE command, only ≥4:20 PM ET or <9:15 AM ET.

## File Structure

| File | Responsibility |
|---|---|
| `api/services/ssetf_parser.py` (new) | Pure parse functions: tokenize, factor, direction, underlying (ticker + company passes), exclusions. No I/O. |
| `api/services/single_stock_etfs.py` (new) | Fetch, store, rebuild (gates/overrides/quarantine/diff/lock), lookup, status, self-heal, TTL cache. |
| `api/routers/single_stock_etfs.py` (new) | 3 endpoints, admin gating, kill switch. |
| `api/main.py` (modify) | Router registration + nightly job + startup self-heal. |
| `tests/test_ssetf_parser.py`, `tests/test_single_stock_etfs.py`, `tests/test_ssetf_router.py` (new) | Backend suites. |
| `tools/ssetf_probe.py` (new) | Manual live-export probe (headers/formats/lag) + fixture capture. |
| `app/src/hooks/useSingleStockEtfs.js` (new) | SWR family lookup, `$IDX:` skip. |
| `app/src/pages/charts/widgets/LeverageInverseControl.jsx` + `.module.css` (new) | Segmented pill + family panel, container-query collapse, vertical clamp. |
| `app/src/pages/charts/widgets/ChartWidget.jsx` (modify) | Mount control first-child inside `tfBarRight`. |
| `app/src/pages/charts/widgets/LeverageInverseControl.test.jsx` (new) | Frontend suite. |

---

### Task 1: Name parser (pure functions)

**Files:**
- Create: `api/services/ssetf_parser.py`
- Test: `tests/test_ssetf_parser.py`

**Interfaces:**
- Produces: `ParseResult` dataclass — fields `status: str` (`'parsed' | 'skip' | 'quarantine'`), `reason: str | None` (`'ambiguous' | 'no_direction' | 'both_directions' | 'excluded' | 'no_factor' | 'zero_candidates' | 'self_reference'`), `underlying: str | None`, `direction: str | None` (`'long' | 'short'`), `factor: float | None`.
- Produces: `parse_etf_name(name: str, etf_ticker: str, stock_set: dict[str, str]) -> ParseResult` where `stock_set = {TICKER: CompanyName}`.
- Consumes: nothing (pure).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_ssetf_parser.py
"""Parser spec: docs/superpowers/specs/2026-07-21-single-stock-etf-switcher-design.md §3.2."""
import pytest
from api.services.ssetf_parser import parse_etf_name

STOCK_SET = {
    "NBIS": "Nebius Group NV", "NVDA": "NVIDIA Corp", "TSLA": "Tesla, Inc.",
    "SMCI": "Super Micro Computer Inc", "FANG": "Diamondback Energy Inc",
    "AI": "C3.ai Inc", "S": "SentinelOne Inc", "T": "AT&T Inc",
    "BULL": "Webull Corp", "BRK-B": "Berkshire Hathaway Inc",
}

def _p(name, etf="XXXX"):
    return parse_etf_name(name, etf, STOCK_SET)

# ── Happy paths: every corpus name parses exactly ──
@pytest.mark.parametrize("name,und,direc,factor", [
    ("GraniteShares 2x Long NBIS Daily ETF", "NBIS", "long", 2.0),
    ("GraniteShares 2x Short NVDA Daily ETF", "NVDA", "short", 2.0),
    ("Direxion Daily TSLA Bull 2X Shares", "TSLA", "long", 2.0),
    ("Direxion Daily TSLA Bear 1X Shares", "TSLA", "short", 1.0),
    ("Tradr 2X Long NBIS Daily ETF", "NBIS", "long", 2.0),
    ("Tradr 2X Short NBIS Daily ETF", "NBIS", "short", 2.0),
    ("Leverage Shares 2X Long NBIS Daily ETF", "NBIS", "long", 2.0),
    ("Defiance Daily Target 2X Long SMCI ETF", "SMCI", "long", 2.0),
    ("Defiance Daily Target 1.5X Short SMCI ETF", "SMCI", "short", 1.5),
])
def test_ticker_pass_corpus(name, und, direc, factor):
    r = _p(name)
    assert (r.status, r.underlying, r.direction, r.factor) == ("parsed", und, direc, factor)

# ── Company-name pass (T-REX convention) ──
@pytest.mark.parametrize("name,und,direc", [
    ("T-REX 2X Long Tesla Daily Target ETF", "TSLA", "long"),
    ("T-REX 2X Inverse NVIDIA Daily Target ETF", "NVDA", "short"),
])
def test_company_pass(name, und, direc):
    r = _p(name)
    assert (r.status, r.underlying, r.direction) == ("parsed", und, direc)

# ── Adversarial: live basket funds naming real tickers must NEVER map ──
def test_berz_fang_basket_never_maps():
    r = _p("MicroSectors FANG & Innovation -3X Inverse Leveraged ETN", "BERZ")
    assert r.status in ("skip", "quarantine") and r.underlying != "FANG"

def test_aibd_ai_basket_never_maps():
    r = _p("Direxion Daily AI and Big Data Bear 2X Shares", "AIBD")
    assert r.status in ("skip", "quarantine") and r.underlying != "AI"

# ── Leveraged index/sector funds: SILENT SKIP, not quarantine ──
@pytest.mark.parametrize("name", [
    "Direxion Daily Semiconductor Bull 3X Shares",
    "Direxion Daily Small Cap Bull 3X Shares",
    "Volatility Shares 2x Bitcoin Strategy ETF",
])
def test_index_sector_funds_skip(name):
    r = _p(name)
    assert r.status == "skip"

# ── Direction rules ──
def test_short_bull_webull_masks_candidate_before_direction_scan():
    r = _p("Tradr 2X Short BULL Daily ETF")
    assert (r.status, r.underlying, r.direction) == ("parsed", "BULL", "short")

def test_bullion_never_matches_bull_keyword():
    r = _p("Something 2X Gold Bullion Daily ETF")
    assert r.status == "skip"  # no direction keyword + no candidate -> not quarantine noise

def test_missing_direction_quarantines():
    r = _p("Corgi NBIS 2x Daily ETF")
    assert (r.status, r.reason) == ("quarantine", "no_direction")

def test_minus_1x_implies_short():
    r = _p("Issuer -1x NBIS Daily ETF")
    assert (r.status, r.direction, r.factor) == ("parsed", "short", 1.0)

# ── Exclusions ──
@pytest.mark.parametrize("name", [
    "YieldMax NVDA Option Income Strategy ETF",
    "Kurv Yield Premium Strategy NVDA ETF",
    "Innovator NVDA Buffer ETF",
    "MicroSectors FANG Index -2X Inverse Leveraged ETN",
])
def test_income_and_etn_index_excluded(name):
    assert _p(name).status == "skip"

# ── Structure rules ──
def test_two_adjacent_candidates_quarantine_ambiguous():
    r = _p("Weird 2X Long NVDA TSLA Daily ETF")
    assert (r.status, r.reason) == ("quarantine", "ambiguous")

def test_non_adjacent_ticker_not_accepted():
    # NVDA is 4 tokens from the factor/direction cluster -> zero candidates -> skip
    r = _p("NVDA Growth And Income Leaders 2X Long Basket ETF")
    assert r.status == "skip"

def test_no_factor_is_skip():
    assert _p("Vanguard Total Stock Market ETF").status == "skip"

def test_dotted_class_share_normalizes_to_hyphen():
    r = _p("Issuer 2X Long BRK.B Daily ETF")
    assert (r.status, r.underlying) == ("parsed", "BRK-B")

def test_self_reference_rejected():
    r = parse_etf_name("Tradr 2X Long NBIS Daily ETF", "NBIS", STOCK_SET)
    assert r.status == "quarantine" and r.reason == "self_reference"

def test_fractional_factor():
    r = _p("Issuer 1.25x Long NVDA Daily ETF")
    assert r.factor == 1.25
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python -m pytest tests/test_ssetf_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: api.services.ssetf_parser`

- [ ] **Step 3: Implement the parser**

```python
# api/services/ssetf_parser.py
"""Single-stock ETF name parser — pure functions, no I/O.

Spec: docs/superpowers/specs/2026-07-21-single-stock-etf-switcher-design.md §3.2.
Extracts (underlying, direction, factor) from leveraged/inverse fund names.
Never guesses: ambiguity -> quarantine; no single-stock signal -> silent skip.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

# Hard-skip (income products, buffers, index/ETN baskets) — case-insensitive.
_EXCLUDE_RE = re.compile(
    r"covered\s+call|option\s+income|\bincome\b|yieldmax|\bbuffer\b|\bpremium\b"
    r"|\bdividend\b|\bindex\b|\betns?\b",
    re.I,
)
_FACTOR_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[xX]\b")
_MINUS_1X_RE = re.compile(r"-1\s*[xX]\b")
_LONG_RE = re.compile(r"\b(long|bull)\b", re.I)
_SHORT_RE = re.compile(r"\b(short|bear|inverse)\b", re.I)
_CAND_RE = re.compile(r"^[A-Z]{1,5}$")

# Issuer words + generic tokens that must never become an underlying candidate.
_STOPLIST = {
    "ETF", "ETN", "ETFS", "US", "T-REX", "T-Rex", "TREX", "TRADR", "CORGI",
    "DAILY", "TARGET", "SHARES",
}


@dataclass
class ParseResult:
    status: str                      # 'parsed' | 'skip' | 'quarantine'
    reason: Optional[str] = None
    underlying: Optional[str] = None
    direction: Optional[str] = None  # 'long' | 'short'
    factor: Optional[float] = None


def tokenize(name: str) -> list[str]:
    """Whitespace-only split; strip leading/trailing punctuation per token.
    Interior punctuation survives (S&P, T-Rex stay single tokens)."""
    out = []
    for raw in name.split():
        t = raw.strip(".,;:()[]{}'\"!?")
        if t:
            out.append(t)
    return out


def _candidate(tok: str) -> Optional[str]:
    """Ticker-candidate normalization: ^[A-Z]{1,5}$ after '.'->'-' class-share fix."""
    t = tok.replace(".", "-") if re.fullmatch(r"[A-Z]{1,4}\.[A-Z]", tok) else tok
    base = t.replace("-", "") if re.fullmatch(r"[A-Z]{1,4}-[A-Z]", t) else t
    if _CAND_RE.fullmatch(base) and tok not in _STOPLIST and t not in _STOPLIST:
        return t
    return None


def parse_etf_name(name: str, etf_ticker: str, stock_set: dict[str, str]) -> ParseResult:
    if _EXCLUDE_RE.search(name):
        return ParseResult("skip", "excluded")

    minus_1x = bool(_MINUS_1X_RE.search(name))
    m = _FACTOR_RE.search(name)
    if not (m or minus_1x):
        return ParseResult("skip", "no_factor")
    factor = 1.0 if minus_1x and not m else float(m.group(1))

    tokens = tokenize(name)

    # Anchor indices: factor tokens + direction-keyword tokens ("the cluster").
    anchor_idx = set()
    for i, tok in enumerate(tokens):
        if _FACTOR_RE.search(tok) or _MINUS_1X_RE.search(tok):
            anchor_idx.add(i)

    # Ticker candidates ∈ stock set (collected BEFORE direction scan for masking).
    cand_idx: dict[int, str] = {}
    for i, tok in enumerate(tokens):
        c = _candidate(tok)
        if c and c in stock_set:
            cand_idx[i] = c

    # Direction scan over tokens, with candidate tokens MASKED (spec rule 2).
    long_hit = short_hit = False
    for i, tok in enumerate(tokens):
        if i in cand_idx:
            continue
        if _LONG_RE.fullmatch(tok):
            long_hit = True
            anchor_idx.add(i)
        elif _SHORT_RE.fullmatch(tok):
            short_hit = True
            anchor_idx.add(i)
    if minus_1x:
        short_hit = True

    if long_hit and short_hit:
        return ParseResult("quarantine", "both_directions", factor=factor)

    def _adjacent(i: int) -> bool:
        return any(abs(i - a) <= 1 for a in anchor_idx)

    # Ticker pass: candidates adjacent (±1 token) to the factor/direction cluster.
    adj = {i: c for i, c in cand_idx.items() if _adjacent(i)}
    underlying = None
    if len(adj) == 1:
        underlying = next(iter(adj.values()))
    elif len(adj) >= 2:
        return ParseResult("quarantine", "ambiguous", factor=factor)
    else:
        # Company-name pass (T-REX convention): capitalized spans (1-3 words)
        # adjacent to the cluster, PREFIX-matched against company names.
        underlying = _company_pass(tokens, anchor_idx, stock_set)
        if underlying is None:
            return ParseResult("skip", "zero_candidates", factor=factor)

    if not (long_hit or short_hit):
        return ParseResult("quarantine", "no_direction", underlying=underlying, factor=factor)
    if underlying == etf_ticker.upper():
        return ParseResult("quarantine", "self_reference", factor=factor)

    return ParseResult("parsed", None, underlying, "long" if long_hit else "short", factor)


def _company_pass(tokens: list[str], anchor_idx: set, stock_set: dict[str, str]) -> Optional[str]:
    def _norm(s: str) -> str:
        return re.sub(r"[^a-z0-9 ]", "", s.lower())

    companies = {t: _norm(c) for t, c in stock_set.items() if c}
    spans: list[str] = []
    for i, tok in enumerate(tokens):
        if not any(abs(i - a) <= 1 for a in anchor_idx):
            continue
        if not tok[:1].isupper() or tok in _STOPLIST:
            continue
        for ln in (3, 2, 1):
            span = tokens[i:i + ln]
            if len(span) == ln and all(w[:1].isupper() and w not in _STOPLIST for w in span):
                spans.append(" ".join(span))
    matches = set()
    for span in spans:
        ns = _norm(span)
        if len(ns) < 4:          # 'AI', 'Big' — too short to prefix-match safely
            continue
        hits = [t for t, c in companies.items() if c.startswith(ns)]
        if len(hits) == 1:
            matches.add(hits[0])
        elif len(hits) > 1:
            return None          # sector-word ambiguity -> caller skips
    return matches.pop() if len(matches) == 1 else None
```

- [ ] **Step 4: Run tests until green**

Run: `python -m pytest tests/test_ssetf_parser.py -v`
Expected: ALL PASS. Iterate on the implementation (NOT on test expectations — they encode the spec) until green.

- [ ] **Step 5: Commit**

```bash
git add -- api/services/ssetf_parser.py tests/test_ssetf_parser.py
git commit -m "feat(ssetf): single-stock ETF name parser (pure, spec §3.2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Finviz fetch with redacted logging + probe tool

**Files:**
- Create: `tools/ssetf_probe.py`
- Modify: `api/services/single_stock_etfs.py` (create — fetch + numeric parse portion)
- Test: `tests/test_single_stock_etfs.py` (fetch/numeric section)

**Interfaces:**
- Produces: `single_stock_etfs._fetch_finviz_market() -> list[dict]` (CSV DictReader rows; `[]` on failure).
- Produces: `single_stock_etfs._num(v) -> float | None` (handles `'-'`, `''`, comma-grouping; `None` when unparseable).
- Produces: `single_stock_etfs.EXPECTED_HEADERS = ["Ticker", "Company", "Sector", "Industry", "Average Volume", "Price"]`.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_single_stock_etfs.py
import logging
import httpx
import pytest
from api.services import single_stock_etfs as ss

def test_num_formats():
    assert ss._num("1234567") == 1234567.0
    assert ss._num("1,234,567") == 1234567.0
    assert ss._num("12.34") == 12.34
    assert ss._num("-") is None
    assert ss._num("") is None
    assert ss._num(None) is None
    assert ss._num("n/a") is None

def test_fetch_never_logs_token(monkeypatch, caplog):
    monkeypatch.setenv("FINVIZ_API_KEY", "SECRET-TOKEN-XYZ")
    def boom(url, **kw):
        req = httpx.Request("GET", url + "?auth=SECRET-TOKEN-XYZ")
        resp = httpx.Response(401, request=req)
        raise httpx.HTTPStatusError("401 Unauthorized", request=req, response=resp)
    monkeypatch.setattr(ss.httpx, "get", boom)
    with caplog.at_level(logging.DEBUG):
        rows = ss._fetch_finviz_market()
    assert rows == []
    assert "SECRET-TOKEN-XYZ" not in caplog.text

def test_fetch_missing_key_returns_empty(monkeypatch, caplog):
    monkeypatch.delenv("FINVIZ_API_KEY", raising=False)
    assert ss._fetch_finviz_market() == []
```

- [ ] **Step 2: Run, verify fail** — `python -m pytest tests/test_single_stock_etfs.py -v` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement fetch + numeric parse (start `single_stock_etfs.py`)**

```python
# api/services/single_stock_etfs.py
"""Single-stock leveraged/inverse ETF family map.

Spec: docs/superpowers/specs/2026-07-21-single-stock-etf-switcher-design.md.
Shape mirrors industry_map.py (bulk Finviz export -> /data SQLite) with
deliberate divergences: fail-closed validation gates, per-run meta record,
no empty-table self-heal cooldown bypass, and auth-token log redaction.
"""
from __future__ import annotations

import contextlib
import csv
import io
import json
import logging
import os
import re
import sqlite3
import threading
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Exact header names asserted on EVERY rebuild (spec §3.4 gate 1).
EXPECTED_HEADERS = ["Ticker", "Company", "Sector", "Industry", "Average Volume", "Price"]
_EXPORT_COLS = "1,2,3,4,63,65"  # ids config; headers are the runtime contract


def _num(v) -> Optional[float]:
    """Finviz numeric: '1,234,567' | '12.34' | '-' | '' -> float | None.
    Unparseable NEVER coerces to 0 — zeros feed the liquidity gate (spec §3.4)."""
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if not s or s in ("-", "n/a", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _fetch_finviz_market() -> list[dict]:
    """Whole-market export (~11k rows) — ETF rows + stock membership in one call.
    Token passed via params and NEVER logged (redaction test-pinned)."""
    token = os.environ.get("FINVIZ_API_KEY", "")
    if not token:
        logger.warning("[ssetf] FINVIZ_API_KEY not set — fetch skipped")
        return []
    url = "https://elite.finviz.com/export.ashx"
    try:
        r = httpx.get(
            url,
            params={"v": "152", "c": _EXPORT_COLS, "auth": token},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/csv"},
            timeout=90.0,
            follow_redirects=True,
        )
        r.raise_for_status()
        return list(csv.DictReader(io.StringIO(r.text)))
    except httpx.HTTPStatusError as e:
        logger.warning("[ssetf] Finviz fetch failed: HTTP %s (url redacted)",
                       e.response.status_code)
        return []
    except Exception as e:
        logger.warning("[ssetf] Finviz fetch failed: %s", type(e).__name__)
        return []
```

- [ ] **Step 4: Run tests** — `python -m pytest tests/test_single_stock_etfs.py -v` → PASS.

- [ ] **Step 5: Write the manual probe tool** (run later in Task 10 — needs the live key)

```python
# tools/ssetf_probe.py
"""Manual Finviz probe for the single-stock ETF pipeline (spec §3.1).

Usage (loads FINVIZ_API_KEY from .env or environment):
    python tools/ssetf_probe.py [--save-fixture]

Prints: header row vs EXPECTED_HEADERS, row count, ETF-industry row count,
numeric format samples for Average Volume/Price (incl. '-' blanks), the parse
outcome for known families (NBIS/TSLA/NVDA), quarantine + skip counts, and a
spot check that recently-launched single-stock ETFs are present (listing lag).
--save-fixture writes the first 200 ETF rows + 50 stock rows to
tests/fixtures/finviz_etf_sample.csv for the parser fixture suite.
"""
import argparse, collections, csv, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from api.services import single_stock_etfs as ss
from api.services.ssetf_parser import parse_etf_name

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--save-fixture", action="store_true")
    args = ap.parse_args()

    rows = ss._fetch_finviz_market()
    if not rows:
        print("FETCH FAILED (empty) — check FINVIZ_API_KEY"); sys.exit(1)
    headers = list(rows[0].keys())
    print(f"headers: {headers}")
    print(f"expected: {ss.EXPECTED_HEADERS}")
    print(f"header match: {all(h in headers for h in ss.EXPECTED_HEADERS)}")
    print(f"total rows: {len(rows)}")

    etf_rows = [r for r in rows if (r.get("Industry") or "").strip() == "Exchange Traded Fund"]
    stock_set = {(r.get("Ticker") or "").strip().upper(): (r.get("Company") or "").strip()
                 for r in rows if (r.get("Industry") or "").strip() != "Exchange Traded Fund"
                 and (r.get("Ticker") or "").strip()}
    print(f"ETF rows: {len(etf_rows)}  stock set: {len(stock_set)}")

    vol_samples = collections.Counter()
    for r in etf_rows[:500]:
        raw = r.get("Average Volume")
        kind = "blank" if not raw or raw.strip() in ("-", "") else (
            "comma" if "," in raw else "plain")
        vol_samples[kind] += 1
    print(f"Average Volume formats (first 500 ETF rows): {dict(vol_samples)}")

    outcomes = collections.Counter()
    families = collections.defaultdict(list)
    for r in etf_rows:
        t = (r.get("Ticker") or "").strip().upper()
        res = parse_etf_name((r.get("Company") or ""), t, stock_set)
        outcomes[f"{res.status}:{res.reason}"] += 1
        if res.status == "parsed":
            families[res.underlying].append((t, res.direction, res.factor))
    print(f"parse outcomes: {dict(outcomes)}")
    for sym in ("NBIS", "TSLA", "NVDA"):
        print(f"family {sym}: {sorted(families.get(sym, []))}")
    print(f"total families: {len(families)}")

    if args.save_fixture:
        os.makedirs("tests/fixtures", exist_ok=True)
        with open("tests/fixtures/finviz_etf_sample.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=headers)
            w.writeheader()
            for r in etf_rows[:200]:
                w.writerow(r)
            for r in list(rows)[:50]:
                w.writerow(r)
        print("fixture saved: tests/fixtures/finviz_etf_sample.csv")

if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Commit**

```bash
git add -- api/services/single_stock_etfs.py tests/test_single_stock_etfs.py tools/ssetf_probe.py
git commit -m "feat(ssetf): Finviz whole-market fetch (token-redacted) + live probe tool

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Store — schema, lookup, per-run meta, status

**Files:**
- Modify: `api/services/single_stock_etfs.py` (append store section)
- Test: `tests/test_single_stock_etfs.py` (append)

**Interfaces:**
- Produces: `lookup(symbol: str) -> dict` — `{"underlying": str|None, "long": [row...], "short": [row...], "best_long": str|None, "best_short": str|None}`; row = `{"ticker","name","factor","avg_dollar_vol"}`; resolves stock OR etf ticker; TTL-cached 600s (`_LOOKUP_CACHE`), `invalidate_cache()` clears.
- Produces: `status() -> dict` — counts + full meta record + quarantine list.
- Produces: `_meta_set(k, v)` / `_meta_get(k, default=None)` (JSON values), `_connect()`, `_ensure_init()`, `SSETF_DB_PATH` env override, tables per spec §4.

- [ ] **Step 1: Failing tests** (append to `tests/test_single_stock_etfs.py`)

```python
@pytest.fixture()
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "ssetf.db"))
    import importlib
    importlib.reload(ss)
    yield ss
    ss.invalidate_cache()

def _seed(s):
    with s._write_conn() as c:
        c.executemany(
            "INSERT INTO etfs (etf_ticker, underlying, direction, factor, name, price,"
            " avg_volume, avg_dollar_vol, vol_source, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
                ("NBIL", "NBIS", "long", 2.0, "GraniteShares 2x Long NBIS", 50.0, 1e6, 5e7, "finviz", 1),
                ("NEBX", "NBIS", "long", 2.0, "Tradr 2X Long NBIS", 40.0, 3e5, 1.2e7, "finviz", 1),
                ("NBIZ", "NBIS", "short", 2.0, "Tradr 2X Short NBIS", 30.0, 3e5, 9e6, "finviz", 1),
            ],
        )

def test_lookup_forward_and_reverse(tmp_db):
    _seed(tmp_db)
    fam = tmp_db.lookup("NBIS")
    assert fam["underlying"] == "NBIS"
    assert [r["ticker"] for r in fam["long"]] == ["NBIL", "NEBX"]  # liquidity desc
    assert fam["best_long"] == "NBIL" and fam["best_short"] == "NBIZ"
    assert tmp_db.lookup("nbil")["underlying"] == "NBIS"  # reverse, case-insensitive

def test_lookup_empty_shape(tmp_db):
    fam = tmp_db.lookup("KO")
    assert fam == {"underlying": None, "long": [], "short": [], "best_long": None, "best_short": None}

def test_lookup_cache_and_invalidation(tmp_db):
    assert tmp_db.lookup("NBIS")["underlying"] is None  # cached empty
    _seed(tmp_db)
    assert tmp_db.lookup("NBIS")["underlying"] is None  # still cached
    tmp_db.invalidate_cache()
    assert tmp_db.lookup("NBIS")["underlying"] == "NBIS"

def test_status_shape(tmp_db):
    _seed(tmp_db)
    tmp_db._meta_set("last_status", "ok")
    st = tmp_db.status()
    assert st["etf_count"] == 3 and st["family_count"] == 1
    assert st["last_status"] == "ok"
    assert isinstance(st["quarantine"], list)
```

- [ ] **Step 2: Run, verify fail** — attribute errors for `_write_conn`/`lookup`/etc.

- [ ] **Step 3: Implement store section** (append to `single_stock_etfs.py`)

```python
# ── Store ────────────────────────────────────────────────────────────────────

def _resolve_db_path() -> str:
    override = os.environ.get("SSETF_DB_PATH")
    if override:
        return override
    if os.path.isdir("/data"):
        return "/data/single_stock_etfs.db"
    here = os.path.join(os.path.dirname(__file__), "..", "..", "data")
    return os.path.join(here, "single_stock_etfs.db")

_WRITE_LOCK = threading.Lock()
_REBUILD_LOCK = threading.Lock()          # single-flight across ALL triggers
_INIT_DONE = False
_INIT_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS etfs (
  etf_ticker TEXT PRIMARY KEY, underlying TEXT NOT NULL, direction TEXT NOT NULL,
  factor REAL NOT NULL, name TEXT NOT NULL, price REAL, avg_volume REAL,
  avg_dollar_vol REAL, vol_source TEXT, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_etfs_underlying ON etfs(underlying);
CREATE TABLE IF NOT EXISTS overrides (
  etf_ticker TEXT PRIMARY KEY, action TEXT NOT NULL,
  underlying TEXT, direction TEXT, factor REAL, note TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS quarantine (
  etf_ticker TEXT PRIMARY KEY, name TEXT, reason TEXT, seen_at INTEGER
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""

def _db_path() -> str:
    return _resolve_db_path()

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def _ensure_init() -> None:
    global _INIT_DONE
    with _INIT_LOCK:
        if _INIT_DONE and os.path.exists(_db_path()):
            return
        parent = os.path.dirname(_db_path())
        if parent:
            os.makedirs(parent, exist_ok=True)
        with contextlib.closing(_connect()) as c:
            c.executescript(_SCHEMA)
            c.commit()
        _INIT_DONE = True

@contextlib.contextmanager
def _write_conn():
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        yield c
        c.commit()

def _meta_set(k: str, v) -> None:
    with _write_conn() as c:
        c.execute("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                  (k, json.dumps(v)))

def _meta_get(k: str, default=None):
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["v"])
    except Exception:
        return default

# ── Lookup (hot path: every chart symbol change) ────────────────────────────

_LOOKUP_CACHE: dict[str, tuple[float, dict]] = {}
_LOOKUP_TTL = 600.0
_EMPTY_FAMILY = {"underlying": None, "long": [], "short": [], "best_long": None, "best_short": None}

def invalidate_cache() -> None:
    _LOOKUP_CACHE.clear()

def _row_out(r) -> dict:
    return {"ticker": r["etf_ticker"], "name": r["name"], "factor": r["factor"],
            "avg_dollar_vol": r["avg_dollar_vol"]}

def lookup(symbol: str) -> dict:
    sym = (symbol or "").strip().upper()
    if not sym:
        return dict(_EMPTY_FAMILY)
    hit = _LOOKUP_CACHE.get(sym)
    now = time.time()
    if hit and now - hit[0] < _LOOKUP_TTL:
        return hit[1]
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT underlying FROM etfs WHERE etf_ticker=?", (sym,)).fetchone()
        underlying = row["underlying"] if row else sym
        rows = c.execute(
            "SELECT * FROM etfs WHERE underlying=? "
            "ORDER BY avg_dollar_vol DESC NULLS LAST, etf_ticker",
            (underlying,),
        ).fetchall()
    if not rows:
        out = dict(_EMPTY_FAMILY)
    else:
        longs = [_row_out(r) for r in rows if r["direction"] == "long"]
        shorts = [_row_out(r) for r in rows if r["direction"] == "short"]
        out = {"underlying": underlying, "long": longs, "short": shorts,
               "best_long": longs[0]["ticker"] if longs else None,
               "best_short": shorts[0]["ticker"] if shorts else None}
    _LOOKUP_CACHE[sym] = (now, out)
    _maybe_self_heal()
    return out

def status() -> dict:
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        etf_count = c.execute("SELECT COUNT(*) FROM etfs").fetchone()[0]
        family_count = c.execute("SELECT COUNT(DISTINCT underlying) FROM etfs").fetchone()[0]
        quarantine = [dict(r) for r in c.execute(
            "SELECT etf_ticker, name, reason, seen_at FROM quarantine ORDER BY etf_ticker").fetchall()]
    out = {"etf_count": etf_count, "family_count": family_count, "quarantine": quarantine}
    for k in ("last_attempt_at", "last_success_at", "last_status", "last_error",
              "last_counts", "last_diff", "refusals_consecutive", "last_refusal"):
        out[k] = _meta_get(k)
    return out
```

Note: SQLite `NULLS LAST` requires 3.30+ (Railway + local both fine); if the
test env chokes, use `ORDER BY avg_dollar_vol IS NULL, avg_dollar_vol DESC`.
`_maybe_self_heal` doesn't exist yet — add a no-op stub `def _maybe_self_heal(): pass`
at the end of the file (Task 5 replaces it).

- [ ] **Step 4: Run** — `python -m pytest tests/test_single_stock_etfs.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -- api/services/single_stock_etfs.py tests/test_single_stock_etfs.py
git commit -m "feat(ssetf): store, bidirectional lookup + TTL cache, per-run meta, status

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: rebuild() — gates, overrides, quarantine, diff, single-flight, alerts

**Files:**
- Modify: `api/services/single_stock_etfs.py` (append rebuild section)
- Test: `tests/test_single_stock_etfs.py` (append)

**Interfaces:**
- Produces: `rebuild(force_shrink: bool = False, trigger: str = "manual") -> dict` (the per-run record; `{"status": "already_running"}` if lock held).
- Consumes: `ssetf_parser.parse_etf_name`, `_fetch_finviz_market`, `_num`, store helpers (Task 3), `chart_health_alerts.emit(alert_key, severity, message, metadata)`.
- Behavior contract (spec §3.4-3.5): header gate → parse → overrides (remap/exclude/add) → liquidity backfill (Task 5 wires; stub `_backfill_dollar_vol(t) -> None` for now) → gates (liquidity, shrink) → atomic swap + quarantine rewrite in ONE transaction → meta record + diff → refusal counters + transition alert at 2 consecutive.

- [ ] **Step 1: Failing tests** (append; representative — implementer adds the full set from spec §8)

```python
def _mkrows(n_etf=10, vol="1,000,000", price="50.00"):
    rows = [{"Ticker": "TSLA", "Company": "Tesla, Inc.", "Sector": "Consumer Cyclical",
             "Industry": "Auto Manufacturers", "Average Volume": "9,999,999", "Price": "200.00"},
            {"Ticker": "NBIS", "Company": "Nebius Group NV", "Sector": "Technology",
             "Industry": "Software", "Average Volume": "5,000,000", "Price": "40.00"}]
    for i in range(n_etf):
        rows.append({"Ticker": f"LG{i:02d}", "Company": f"Issuer{i} 2X Long NBIS Daily ETF",
                     "Sector": "Financial", "Industry": "Exchange Traded Fund",
                     "Average Volume": vol, "Price": price})
    return rows

def test_rebuild_happy_path(tmp_db, monkeypatch):
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows())
    rec = tmp_db.rebuild(trigger="test")
    assert rec["status"] == "ok" and rec["counts"]["etfs_written"] == 10
    assert tmp_db.lookup("NBIS")["best_long"] is not None
    assert tmp_db.status()["last_status"] == "ok"

def test_header_gate_refuses_html_login_page(tmp_db, monkeypatch):
    import csv as _csv, io as _io
    # Two-line HTML => DictReader yields 1 row with a garbage header, so the
    # HEADER gate (not fetch_empty) must trip — this is the 200-HTML login page.
    html = "<html>\n<body>login</body>\n</html>"
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market",
                        lambda: list(_csv.DictReader(_io.StringIO(html))))
    rec = tmp_db.rebuild(trigger="test")
    assert rec["status"] == "refused_headers"
    assert tmp_db.status()["last_status"] == "refused_headers"
    assert tmp_db.status()["etf_count"] == 0  # garbage never seeds the table

def test_liquidity_gate_refuses_all_zero_volume(tmp_db, monkeypatch):
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows())
    assert tmp_db.rebuild(trigger="test")["status"] == "ok"
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows(vol="-"))
    rec = tmp_db.rebuild(trigger="test")
    assert rec["status"] == "refused_liquidity"
    assert tmp_db.status()["etf_count"] == 10  # previous table survives

def test_shrink_guard_and_force(tmp_db, monkeypatch):
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows(n_etf=10))
    tmp_db.rebuild(trigger="test")
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows(n_etf=3))
    assert tmp_db.rebuild(trigger="test")["status"] == "refused_shrink"
    assert tmp_db.rebuild(trigger="test", force_shrink=True)["status"] == "ok"
    assert tmp_db.status()["etf_count"] == 3

def test_two_consecutive_refusals_emit_one_alert(tmp_db, monkeypatch):
    calls = []
    monkeypatch.setattr(tmp_db.chart_health_alerts, "emit",
                        lambda *a, **k: calls.append(a) or True)
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows(n_etf=10))
    tmp_db.rebuild(trigger="test")
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows(n_etf=1))
    tmp_db.rebuild(trigger="test"); tmp_db.rebuild(trigger="test"); tmp_db.rebuild(trigger="test")
    assert len(calls) == 1 and calls[0][0] == "ssetf_rebuild_refused"

def test_override_add_and_exclude(tmp_db, monkeypatch):
    with tmp_db._write_conn() as c:
        c.execute("INSERT INTO overrides VALUES ('LG00','exclude',NULL,NULL,NULL,NULL,1)")
        c.execute("INSERT INTO overrides VALUES ('NEWZ','add','NBIS','short',2.0,NULL,1)")
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows())
    tmp_db.rebuild(trigger="test")
    fam = tmp_db.lookup("NBIS")
    assert all(r["ticker"] != "LG00" for r in fam["long"])
    assert fam["best_short"] == "NEWZ"          # injected despite absence from export

def test_quarantine_rewrite(tmp_db, monkeypatch):
    rows = _mkrows()
    rows.append({"Ticker": "QQ01", "Company": "Corgi NBIS 2x Daily ETF",  # no direction
                 "Sector": "Financial", "Industry": "Exchange Traded Fund",
                 "Average Volume": "100,000", "Price": "20.00"})
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: rows)
    tmp_db.rebuild(trigger="test")
    assert any(q["etf_ticker"] == "QQ01" for q in tmp_db.status()["quarantine"])
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows())
    tmp_db.rebuild(trigger="test")
    assert tmp_db.status()["quarantine"] == []   # derived data: rewritten per run

def test_concurrent_rebuild_single_flight(tmp_db, monkeypatch):
    import threading as th
    started, release = th.Event(), th.Event()
    def slow_fetch():
        started.set(); release.wait(timeout=5); return _mkrows()
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", slow_fetch)
    results = {}
    t1 = th.Thread(target=lambda: results.update(a=tmp_db.rebuild(trigger="t1")))
    t1.start(); started.wait(timeout=5)
    results["b"] = tmp_db.rebuild(trigger="t2")
    release.set(); t1.join(timeout=10)
    assert results["b"]["status"] == "already_running"
    assert results["a"]["status"] == "ok"
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement rebuild** (append)

```python
# ── Rebuild ──────────────────────────────────────────────────────────────────
from api.services import chart_health_alerts
from api.services.ssetf_parser import parse_etf_name

_ETF_INDUSTRY = "Exchange Traded Fund"
_SHRINK_FLOOR = 0.60
_LIQ_BAD_FRACTION = 0.20

def _backfill_dollar_vol(ticker: str) -> Optional[float]:
    return None  # Task 5 implements (bars_sqlite mean(c*v) over <=20 daily bars)

def rebuild(force_shrink: bool = False, trigger: str = "manual") -> dict:
    if not _REBUILD_LOCK.acquire(blocking=False):
        return {"status": "already_running", "trigger": trigger}
    try:
        return _rebuild_locked(force_shrink, trigger)
    finally:
        _REBUILD_LOCK.release()

def _finish(record: dict) -> dict:
    """Stamp meta from a completed attempt; handle refusal counters + alert."""
    st = record["status"]
    _meta_set("last_status", st)
    _meta_set("last_error", record.get("error"))
    _meta_set("last_counts", record.get("counts"))
    if st == "ok":
        _meta_set("last_success_at", record["attempt_at"])
        _meta_set("last_diff", record.get("diff"))
        _meta_set("refusals_consecutive", 0)
        invalidate_cache()
    elif st.startswith("refused"):
        n = int(_meta_get("refusals_consecutive", 0) or 0) + 1
        _meta_set("refusals_consecutive", n)
        _meta_set("last_refusal", {"ts": record["attempt_at"], "reason": st,
                                   "new_count": record.get("new_count"),
                                   "prev_count": record.get("prev_count")})
        if n == 2:  # transition-only alert (spec §3.5)
            chart_health_alerts.emit(
                "ssetf_rebuild_refused", "warning",
                f"single-stock ETF rebuild refused {n}x consecutively ({st})",
                {"reason": st, "new_count": record.get("new_count"),
                 "prev_count": record.get("prev_count")})
    logger.info("[ssetf] rebuild %s trigger=%s counts=%s",
                st, record.get("trigger"), record.get("counts"))
    return record

def _rebuild_locked(force_shrink: bool, trigger: str) -> dict:
    now = int(time.time())
    _meta_set("last_attempt_at", now)  # stamped at START of EVERY attempt
    rec: dict = {"status": "error", "trigger": trigger, "attempt_at": now}

    rows = _fetch_finviz_market()
    if not rows:
        rec["status"] = "fetch_empty"
        return _finish(rec)

    # Gate 1: header assert (catches wrong column ids AND 200-HTML login pages).
    headers = list(rows[0].keys())
    missing = [h for h in EXPECTED_HEADERS if h not in headers]
    if missing:
        rec.update(status="refused_headers", error=f"missing headers: {missing}")
        return _finish(rec)

    stock_set: dict[str, str] = {}
    etf_rows: list[dict] = []
    for r in rows:
        t = (r.get("Ticker") or "").strip().upper()
        if not t:
            continue
        if (r.get("Industry") or "").strip() == _ETF_INDUSTRY:
            etf_rows.append(r)
        else:
            stock_set[t] = (r.get("Company") or "").strip()
    if len(stock_set) < 2000:  # fail-soft membership fallback (spec §3.1)
        try:
            path = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
            with open(path, encoding="utf-8") as fh:
                for t in json.load(fh):
                    stock_set.setdefault(str(t).upper(), "")
            logger.warning("[ssetf] stock set thin (%d) — merged cap_universe fallback", len(stock_set))
        except Exception:
            pass

    # Load overrides.
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        ovr = {r["etf_ticker"]: dict(r) for r in c.execute("SELECT * FROM overrides").fetchall()}
        prev_count = c.execute("SELECT COUNT(*) FROM etfs").fetchone()[0]
        prev_map = {r["etf_ticker"]: dict(r) for r in c.execute("SELECT * FROM etfs").fetchall()}
        prev_median = _median([r["avg_dollar_vol"] for r in prev_map.values()
                               if r["avg_dollar_vol"]])

    parsed: dict[str, dict] = {}
    quarantined: list[tuple] = []
    skipped_zero = 0
    for r in etf_rows:
        t = (r.get("Ticker") or "").strip().upper()
        name = (r.get("Company") or "").strip()
        o = ovr.get(t)
        if o and o["action"] == "exclude":
            continue
        res = parse_etf_name(name, t, stock_set)
        if o and o["action"] == "remap":
            res_status, und, direc, fac = "parsed", o["underlying"], o["direction"], o["factor"]
        elif res.status == "parsed":
            res_status, und, direc, fac = "parsed", res.underlying, res.direction, res.factor
        elif res.status == "quarantine":
            quarantined.append((t, name, res.reason, now))
            if res.reason == "zero_candidates":
                skipped_zero += 1
            continue
        else:
            if res.reason == "zero_candidates":
                skipped_zero += 1
            continue
        price = _num(r.get("Price"))
        avg_vol = _num(r.get("Average Volume"))
        adv = price * avg_vol if (price and avg_vol) else None
        parsed[t] = {"etf_ticker": t, "underlying": und, "direction": direc, "factor": fac,
                     "name": name, "price": price, "avg_volume": avg_vol,
                     "avg_dollar_vol": adv, "vol_source": "finviz" if adv else "none",
                     "updated_at": now}

    # 'add' overrides: inject rows absent from the export (spec §3.5).
    for t, o in ovr.items():
        if o["action"] == "add" and t not in parsed:
            parsed[t] = {"etf_ticker": t, "underlying": o["underlying"],
                         "direction": o["direction"], "factor": o["factor"],
                         "name": o["note"] or f"{t} (manual add)", "price": None,
                         "avg_volume": None, "avg_dollar_vol": None,
                         "vol_source": "none", "updated_at": now}
        elif o["action"] == "add" and t in parsed:
            parsed[t].update(underlying=o["underlying"], direction=o["direction"],
                             factor=o["factor"])  # export row wins name/price/vol

    new_count = len(parsed)
    rec.update(new_count=new_count, prev_count=prev_count)

    # Gate 2: liquidity (skip backfill entirely when it trips — spec §3.3).
    bad = [p for p in parsed.values() if not p["avg_dollar_vol"]]
    median_new = _median([p["avg_dollar_vol"] for p in parsed.values() if p["avg_dollar_vol"]])
    liq_tripped = (new_count > 0 and len(bad) / new_count > _LIQ_BAD_FRACTION) or \
                  (median_new == 0 and (prev_median or 0) > 0)
    if liq_tripped and not force_shrink:
        rec["status"] = "refused_liquidity"
        return _finish(rec)

    # Bounded fresh-listing backfill (Task 5 wires the real impl).
    backfilled = 0
    if not liq_tripped:
        for p in list(parsed.values()):
            if backfilled >= 25:
                break
            if p["avg_dollar_vol"] is None:
                adv = _backfill_dollar_vol(p["etf_ticker"])
                if adv:
                    p["avg_dollar_vol"] = adv
                    p["vol_source"] = "bars_fallback"
                backfilled += 1

    # Gate 3: shrink guard.
    if prev_count and new_count < prev_count * _SHRINK_FLOOR and not force_shrink:
        rec["status"] = "refused_shrink"
        return _finish(rec)

    # Diff vs previous table.
    added = sorted(set(parsed) - set(prev_map))
    removed = sorted(set(prev_map) - set(parsed))
    def _bests(m):
        out = {}
        for r in m.values():
            key = (r["underlying"], r["direction"])
            cur = out.get(key)
            if cur is None or (r["avg_dollar_vol"] or 0) > (cur[1] or 0):
                out[key] = (r["etf_ticker"], r["avg_dollar_vol"])
        return {k: v[0] for k, v in out.items()}
    b_old, b_new = _bests(prev_map), _bests(parsed)
    best_changes = [f"{u}/{d}: {b_old.get((u, d))} -> {t}"
                    for (u, d), t in b_new.items() if b_old.get((u, d)) not in (None, t)]
    diff = {"added": added, "removed": removed, "best_changes": best_changes,
            "skipped_zero_candidate": skipped_zero,
            "new_families": sorted({p["underlying"] for p in parsed.values()} -
                                   {r["underlying"] for r in prev_map.values()})}

    # Atomic swap + quarantine rewrite in ONE transaction (spec §3.4).
    with _write_conn() as c:
        c.execute("DELETE FROM etfs")
        c.executemany(
            "INSERT INTO etfs (etf_ticker, underlying, direction, factor, name, price,"
            " avg_volume, avg_dollar_vol, vol_source, updated_at)"
            " VALUES (:etf_ticker,:underlying,:direction,:factor,:name,:price,"
            ":avg_volume,:avg_dollar_vol,:vol_source,:updated_at)",
            list(parsed.values()))
        c.execute("DELETE FROM quarantine")
        c.executemany("INSERT INTO quarantine VALUES (?,?,?,?)", quarantined)

    rec.update(status="ok", diff=diff, counts={
        "csv_rows": len(rows), "etf_rows": len(etf_rows), "parsed": len(parsed),
        "skipped_zero_candidate": skipped_zero, "quarantined": len(quarantined),
        "overrides_applied": len(ovr), "backfilled": backfilled,
        "etfs_written": new_count,
        "families": len({p["underlying"] for p in parsed.values()})})
    return _finish(rec)

def _median(vals: list) -> float:
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return 0.0
    mid = len(vals) // 2
    return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2
```

- [ ] **Step 4: Run all backend tests** — `python -m pytest tests/test_ssetf_parser.py tests/test_single_stock_etfs.py -v` → PASS (fix implementation, not tests).

- [ ] **Step 5: Commit**

```bash
git add -- api/services/single_stock_etfs.py tests/test_single_stock_etfs.py
git commit -m "feat(ssetf): validated atomic rebuild — header/liquidity/shrink gates, overrides, quarantine rewrite, diff, single-flight, refusal alerts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Liquidity backfill + self-heal

**Files:**
- Modify: `api/services/single_stock_etfs.py` (replace both stubs)
- Test: `tests/test_single_stock_etfs.py` (append)

**Interfaces:**
- Produces: real `_backfill_dollar_vol(ticker) -> float | None` — `bars_sqlite.get_bars(ticker, "D", 20)` tuples `(ts,o,h,l,c,v)` → `mean(c*v)`; `None` if no bars/any error.
- Produces: real `_maybe_self_heal()` — spawns background `rebuild(trigger="self_heal")` when table empty OR `last_success_at` >48h old; cooldown from `last_attempt_at`: 30 min normally, 5 min minimum ALWAYS (NO empty-table bypass — deliberate divergence from industry_map, spec §3.4); in-flight guard via `_REBUILD_LOCK.locked()`.

- [ ] **Step 1: Failing tests**

```python
def test_backfill_uses_bars_sqlite(tmp_db, monkeypatch):
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars",
                        lambda t, tf, n: [(1, 1, 1, 1, 10.0, 1000), (2, 1, 1, 1, 20.0, 2000)])
    assert tmp_db._backfill_dollar_vol("NEWZ") == (10.0 * 1000 + 20.0 * 2000) / 2

def test_backfill_none_on_empty_or_error(tmp_db, monkeypatch):
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda t, tf, n: [])
    assert tmp_db._backfill_dollar_vol("NEWZ") is None
    monkeypatch.setattr(bars_sqlite, "get_bars",
                        lambda t, tf, n: (_ for _ in ()).throw(RuntimeError()))
    assert tmp_db._backfill_dollar_vol("NEWZ") is None

def test_self_heal_no_empty_table_cooldown_bypass(tmp_db, monkeypatch):
    fired = []
    monkeypatch.setattr(tmp_db, "_spawn_rebuild", lambda trig: fired.append(trig))
    tmp_db._meta_set("last_attempt_at", int(__import__("time").time()) - 60)  # 1 min ago
    tmp_db._maybe_self_heal()      # empty table, but attempt 1 min ago -> NO spawn
    assert fired == []
    tmp_db._meta_set("last_attempt_at", int(__import__("time").time()) - 400)  # >5 min
    tmp_db._maybe_self_heal()
    assert fired == ["self_heal"]
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement (replace the stubs)**

```python
_HEAL_STALE_SECONDS = 48 * 3600
_HEAL_COOLDOWN = 30 * 60
_HEAL_MIN_COOLDOWN = 5 * 60   # applies even when the table is EMPTY (spec §3.4)

def _backfill_dollar_vol(ticker: str) -> Optional[float]:
    """Mean close*volume over the last <=20 cached daily bars; None if unknown."""
    try:
        from api.services import bars_sqlite
        bars = bars_sqlite.get_bars(ticker, "D", 20)
        if not bars:
            return None
        vals = [float(b[4]) * float(b[5]) for b in bars if b[4] and b[5]]
        return sum(vals) / len(vals) if vals else None
    except Exception:
        return None

def _spawn_rebuild(trigger: str) -> None:
    threading.Thread(target=lambda: rebuild(trigger=trigger),
                     daemon=True, name="ssetf-heal").start()

def _enabled() -> bool:
    return os.environ.get("SINGLE_STOCK_ETFS_ENABLED", "1") == "1"

def _maybe_self_heal() -> None:
    if not _enabled() or _REBUILD_LOCK.locked():
        return
    try:
        _ensure_init()
        with contextlib.closing(_connect()) as c:
            empty = c.execute("SELECT COUNT(*) FROM etfs").fetchone()[0] == 0
        last_ok = _meta_get("last_success_at", 0) or 0
        stale = (time.time() - last_ok) > _HEAL_STALE_SECONDS
        if not (empty or stale):
            return
        last_attempt = _meta_get("last_attempt_at", 0) or 0
        cooldown = _HEAL_MIN_COOLDOWN if empty else _HEAL_COOLDOWN
        if (time.time() - last_attempt) < cooldown:
            return   # NO empty-table bypass — hot lookup path (spec §3.4)
        _spawn_rebuild("self_heal")
    except Exception:
        pass
```

Delete the Task 3 no-op `_maybe_self_heal` stub and the Task 4 `_backfill_dollar_vol` stub — exactly one definition of each remains.

- [ ] **Step 4: Run full backend suite** — `python -m pytest tests/test_ssetf_parser.py tests/test_single_stock_etfs.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -- api/services/single_stock_etfs.py tests/test_single_stock_etfs.py
git commit -m "feat(ssetf): bars-backed liquidity backfill + bounded self-heal (no empty-table cooldown bypass)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Router + main.py wiring + nightly job

**Files:**
- Create: `api/routers/single_stock_etfs.py`
- Modify: `api/main.py` (import block ~L38-80; `include_router` block ~L2124+; scheduler near the `flow_nightly_prune` job at ~L2906)
- Test: `tests/test_ssetf_router.py`

**Interfaces:**
- Produces: `GET /api/single-stock-etfs/status` (require_admin — DECLARED FIRST), `GET /api/single-stock-etfs/{symbol}` (get_current_user), `POST /api/single-stock-etfs/rebuild?force_shrink=` (require_admin).
- Consumes: `single_stock_etfs.lookup/status/rebuild/_enabled/_EMPTY_FAMILY`, `api.middleware.auth_middleware.get_current_user/require_admin`.

- [ ] **Step 1: Failing tests**

```python
# tests/test_ssetf_router.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.middleware.auth_middleware import get_current_user, require_admin
from api.routers import single_stock_etfs as router_mod
from api.services import single_stock_etfs as ss

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "ssetf.db"))
    import importlib; importlib.reload(ss)
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "user"}
    app.dependency_overrides[require_admin] = lambda: {"id": "a1", "role": "admin"}
    return TestClient(app)

def test_status_not_shadowed_by_symbol_wildcard(client):
    r = client.get("/api/single-stock-etfs/status")
    assert r.status_code == 200
    assert "etf_count" in r.json()          # status payload, NOT the family shape

def test_symbol_lookup_empty_shape(client):
    r = client.get("/api/single-stock-etfs/KO")
    assert r.status_code == 200
    assert r.json() == {"underlying": None, "long": [], "short": [],
                        "best_long": None, "best_short": None}

def test_rebuild_returns_started(client, monkeypatch):
    monkeypatch.setattr(ss, "_fetch_finviz_market", lambda: [])
    r = client.post("/api/single-stock-etfs/rebuild")
    assert r.status_code == 200 and r.json()["status"] == "started"

def test_kill_switch_returns_empty(client, monkeypatch):
    monkeypatch.setenv("SINGLE_STOCK_ETFS_ENABLED", "0")
    r = client.get("/api/single-stock-etfs/NBIS")
    assert r.json()["underlying"] is None

def test_anon_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "s.db"))
    app = FastAPI(); app.include_router(router_mod.router)
    c = TestClient(app)
    assert c.post("/api/single-stock-etfs/rebuild").status_code in (401, 403)
    assert c.get("/api/single-stock-etfs/status").status_code in (401, 403)
    assert c.get("/api/single-stock-etfs/NBIS").status_code in (401, 403)
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement router**

```python
# api/routers/single_stock_etfs.py
"""Single-stock leveraged/inverse ETF family endpoints.

ROUTE ORDER MATTERS: /status is declared BEFORE /{symbol} — FastAPI matches in
declaration order, and the wildcard would otherwise capture 'status' as a
symbol (same lesson as cot.py + journal psychology routes).
"""
import threading

from fastapi import APIRouter, Depends, Query

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import single_stock_etfs as ss

router = APIRouter()


@router.get("/api/single-stock-etfs/status")
def ssetf_status(user: dict = Depends(require_admin)):
    return ss.status()


@router.post("/api/single-stock-etfs/rebuild")
def ssetf_rebuild(force_shrink: bool = Query(default=False),
                  user: dict = Depends(require_admin)):
    if not ss._enabled():
        return {"status": "disabled"}
    threading.Thread(
        target=lambda: ss.rebuild(force_shrink=force_shrink, trigger="admin"),
        daemon=True, name="ssetf-admin-rebuild",
    ).start()
    return {"status": "started"}


@router.get("/api/single-stock-etfs/{symbol}")
def ssetf_lookup(symbol: str, user: dict = Depends(get_current_user)):
    if not ss._enabled():
        return dict(ss._EMPTY_FAMILY)
    return ss.lookup(symbol)
```

- [ ] **Step 4: Run** — `python -m pytest tests/test_ssetf_router.py -v` → PASS.

- [ ] **Step 5: Wire into main.py (3 edits)**

Edit 1 — import block (~L38-80, alongside the other router imports):
```python
from api.routers import single_stock_etfs as single_stock_etfs_router
```

Edit 2 — `include_router` block (~L2124+, near `app.include_router(ticker_search.router)`):
```python
app.include_router(single_stock_etfs_router.router)
```

Edit 3 — scheduler, immediately after the `flow_nightly_prune` job (~L2906), same `_ET` idiom:
```python
        # Single-stock ETF family map: nightly rebuild (spec: docs/superpowers/
        # specs/2026-07-21-single-stock-etf-switcher-design.md §3.4). Weekdays
        # 20:30 ET; self-heals on lookup if this ever misses.
        def _ssetf_nightly():
            import os as _os
            if _os.environ.get("SINGLE_STOCK_ETFS_ENABLED", "1") != "1":
                return
            from api.services import single_stock_etfs as _ss
            _ss.rebuild(trigger="cron")
        _scheduler.add_job(_ssetf_nightly,
                           trigger=CronTrigger(day_of_week="mon-fri", hour=20, minute=30, timezone=_ET),
                           id="ssetf_nightly_rebuild", max_instances=1, replace_existing=True)
```

No explicit startup thread needed: `_maybe_self_heal()` fires from the first `lookup()` (empty table → guarded background rebuild) — same net effect as industry_map's prewarm without another boot thread.

- [ ] **Step 6: Sanity-run the app import** — `python -c "import api.main"` → no ImportError (full uvicorn boot not required for this check).

- [ ] **Step 7: Run FULL backend test suite** — `python -m pytest tests/ -x -q` → no NEW failures vs baseline (pre-existing failures, if any, are not ours — compare against a `git stash`-clean run only if something looks suspicious).

- [ ] **Step 8: Commit**

```bash
git add -- api/routers/single_stock_etfs.py api/main.py tests/test_ssetf_router.py
git commit -m "feat(ssetf): router (status-before-wildcard, admin-gated writes) + nightly 20:30 ET rebuild job

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend hook

**Files:**
- Create: `app/src/hooks/useSingleStockEtfs.js`
- Test: `app/src/hooks/useSingleStockEtfs.test.js`

**Interfaces:**
- Produces: `useSingleStockEtfs(sym) -> {family, hasFamily}` — `family` = API shape or null; `hasFamily` = `!!(family?.long?.length || family?.short?.length)`. Skips fetch for falsy syms and `$IDX:` pseudo-tickers.

- [ ] **Step 1: Failing tests**

```jsx
// app/src/hooks/useSingleStockEtfs.test.js
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import useSingleStockEtfs from './useSingleStockEtfs'

const FAMILY = {
  underlying: 'NBIS',
  long: [{ ticker: 'NBIL', name: 'GraniteShares 2x Long NBIS', factor: 2, avg_dollar_vol: 5e7 }],
  short: [{ ticker: 'NBIZ', name: 'Tradr 2X Short NBIS', factor: 2, avg_dollar_vol: 9e6 }],
  best_long: 'NBIL', best_short: 'NBIZ',
}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => FAMILY }))
})

describe('useSingleStockEtfs', () => {
  it('fetches the family for a plain symbol', async () => {
    const { result } = renderHook(() => useSingleStockEtfs('NBIS'))
    await waitFor(() => expect(result.current.hasFamily).toBe(true))
    expect(result.current.family.best_long).toBe('NBIL')
    expect(global.fetch).toHaveBeenCalledWith('/api/single-stock-etfs/NBIS', expect.anything())
  })

  it('skips theme pseudo-tickers and empty syms', () => {
    renderHook(() => useSingleStockEtfs('$IDX:ai-infrastructure'))
    renderHook(() => useSingleStockEtfs(''))
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('hasFamily false on the empty shape', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () =>
      ({ underlying: null, long: [], short: [], best_long: null, best_short: null }) }))
    const { result } = renderHook(() => useSingleStockEtfs('KO'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current.hasFamily).toBe(false)
  })
})
```

- [ ] **Step 2: Run** — `cd app && npx vitest run --pool=threads src/hooks/useSingleStockEtfs.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement**

```jsx
// app/src/hooks/useSingleStockEtfs.js
// Family lookup for the Leverage/Inverse chart control. Data changes nightly,
// so cache generously; keyed on ChartWidget's already-debounced sym.
import useSWR from 'swr'

const fetcher = (url) => fetch(url, { credentials: 'include' })
  .then(r => (r.ok ? r.json() : null))
  .catch(() => null)

export default function useSingleStockEtfs(sym) {
  const skip = !sym || String(sym).startsWith('$IDX:')
  const { data } = useSWR(
    skip ? null : `/api/single-stock-etfs/${encodeURIComponent(String(sym).toUpperCase())}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 },
  )
  const family = data || null
  const hasFamily = !!(family && ((family.long && family.long.length) ||
    (family.short && family.short.length)))
  return { family, hasFamily }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -- app/src/hooks/useSingleStockEtfs.js app/src/hooks/useSingleStockEtfs.test.js
git commit -m "feat(ssetf): useSingleStockEtfs hook (SWR, \$IDX skip, nightly-cadence caching)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: LeverageInverseControl component

**Files:**
- Create: `app/src/pages/charts/widgets/LeverageInverseControl.jsx`
- Create: `app/src/pages/charts/widgets/LeverageInverseControl.module.css`
- Test: `app/src/pages/charts/widgets/LeverageInverseControl.test.jsx`

**Interfaces:**
- Consumes: `useSingleStockEtfs(sym)` (Task 7).
- Produces: `<LeverageInverseControl sym={string} onSelect={fn(ticker)} />` — renders null when `!hasFamily`; segments STOCK / `{factor}X ↑` / `{factor}X ↓` / ▾ panel.

**Design notes for the implementer (from spec §2.1-2.2 — follow exactly):**
- Read `app/src/pages/charts/ChartsWorkspace.module.css` `.tfBtn`/`.tfBtnActive`/`.sessionToggle` first and match height (22px-ish), font-size, radius, and border idiom so the pill reads native. Invoke the frontend-design skill for the polish pass.
- Active seat: `sym === family.underlying` → STOCK; sym in `family.long` → LONG; in `family.short` → SHORT.
- Long active tint green (`rgba(26,229,26,…)` family), short red (`rgba(255,59,71,…)`), matching the app's up/down palette.
- Disabled side (no funds): `disabled` + `title="No inverse single-stock ETF listed yet"` (or "leveraged" for long).
- Panel: `position:fixed`, anchored from `getBoundingClientRect()`; horizontal clamp 8px gutter; **vertical clamp**: estimated height = `52 + rows*30`; if `anchor.bottom + 4 + h > innerHeight - 8` open above (`top = anchor.top - h - 4`, floored 8), else below; `maxHeight` = available side space; row list `overflow-y:auto`. Esc + outside-click close.
- Container query in the module CSS:
  ```css
  .wrap { display: inline-flex; }
  @container (max-width: 480px) {
    .segBtn { display: none; }   /* caret stays — panel remains reachable */
  }
  ```
- Rows: ticker (gold, mono) · truncated name · factor badge · `$48.2M/d` formatted (`v >= 1e9 ? (v/1e9).toFixed(1)+'B' : v >= 1e6 ? (v/1e6).toFixed(1)+'M' : (v/1e3).toFixed(0)+'K'`) · `★ most liquid` on `best_long`/`best_short` rows · filled dot on the currently-charted member. Text `★` is fine (SVG-text-marker precedent); NO emoji.

- [ ] **Step 1: Failing tests**

```jsx
// app/src/pages/charts/widgets/LeverageInverseControl.test.jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import LeverageInverseControl from './LeverageInverseControl'

const FAMILY = {
  underlying: 'NBIS',
  long: [
    { ticker: 'NBIL', name: 'GraniteShares 2x Long NBIS Daily ETF', factor: 2, avg_dollar_vol: 4.82e7 },
    { ticker: 'NEBX', name: 'Tradr 2X Long NBIS Daily ETF', factor: 2, avg_dollar_vol: 1.2e7 },
  ],
  short: [{ ticker: 'NBIZ', name: 'Tradr 2X Short NBIS Daily ETF', factor: 2, avg_dollar_vol: 9.3e6 }],
  best_long: 'NBIL', best_short: 'NBIZ',
}
const EMPTY = { underlying: null, long: [], short: [], best_long: null, best_short: null }

beforeEach(() => { global.fetch = vi.fn(async () => ({ ok: true, json: async () => FAMILY })) })

describe('LeverageInverseControl', () => {
  it('renders nothing when the symbol has no family', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => EMPTY }))
    const { container } = render(<LeverageInverseControl sym="KO" onSelect={() => {}} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('one click swaps to the most-liquid long / short / stock', async () => {
    const onSelect = vi.fn()
    render(<LeverageInverseControl sym="NBIS" onSelect={onSelect} />)
    await screen.findByRole('button', { name: /2X ↑/i })
    fireEvent.click(screen.getByRole('button', { name: /2X ↑/i }))
    expect(onSelect).toHaveBeenCalledWith('NBIL')          // best_long, not first-listed
    fireEvent.click(screen.getByRole('button', { name: /2X ↓/i }))
    expect(onSelect).toHaveBeenCalledWith('NBIZ')
  })

  it('reverse seat: charting NBIL lights LONG, STOCK returns underlying', async () => {
    const onSelect = vi.fn()
    render(<LeverageInverseControl sym="NBIL" onSelect={onSelect} />)
    const stock = await screen.findByRole('button', { name: /stock/i })
    fireEvent.click(stock)
    expect(onSelect).toHaveBeenCalledWith('NBIS')
  })

  it('panel lists every fund liquidity-desc with the ★ on best per side', async () => {
    render(<LeverageInverseControl sym="NBIS" onSelect={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /more single-stock etfs/i }))
    const rows = screen.getAllByRole('menuitem')
    expect(rows.map(r => r.textContent.slice(0, 4))).toEqual(['NBIL', 'NEBX', 'NBIZ'])
    expect(rows[0].textContent).toMatch(/most liquid/i)
    expect(rows[1].textContent).not.toMatch(/most liquid/i)
  })

  it('panel row click selects that specific fund (manual override)', async () => {
    const onSelect = vi.fn()
    render(<LeverageInverseControl sym="NBIS" onSelect={onSelect} />)
    fireEvent.click(await screen.findByRole('button', { name: /more single-stock etfs/i }))
    fireEvent.click(screen.getAllByRole('menuitem')[1])
    expect(onSelect).toHaveBeenCalledWith('NEBX')
  })

  it('side with no funds renders a disabled segment', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () =>
      ({ ...FAMILY, short: [], best_short: null }) }))
    render(<LeverageInverseControl sym="NBIS" onSelect={() => {}} />)
    const shortBtn = await screen.findByRole('button', { name: /↓/ })
    expect(shortBtn).toBeDisabled()
  })
})
```

Mutation check (required, spec §8): after tests pass, temporarily swap
`best_long` for `family.long[1].ticker` in the click handler — the
`one click swaps` test MUST fail; revert.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement component + CSS** — full implementation per the design notes above. Skeleton contract (implementer fills styling honestly against the real tfBar):

```jsx
// app/src/pages/charts/widgets/LeverageInverseControl.jsx
// Leverage/Inverse single-stock ETF switcher (spec §2). Self-contained:
// ChartWidget only mounts it and passes handleSymbolChange as onSelect.
import { useCallback, useEffect, useRef, useState } from 'react'
import useSingleStockEtfs from '../../../hooks/useSingleStockEtfs'
import styles from './LeverageInverseControl.module.css'

const fmtVol = (v) => v == null ? '—'
  : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B/d`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M/d`
  : `$${(v / 1e3).toFixed(0)}K/d`

export default function LeverageInverseControl({ sym, onSelect }) {
  const { family, hasFamily } = useSingleStockEtfs(sym)
  const [open, setOpen] = useState(false)
  const [panelPos, setPanelPos] = useState(null)
  const caretRef = useRef(null)
  const seat = !family ? null
    : sym === family.underlying ? 'stock'
    : family.long.some(r => r.ticker === sym) ? 'long'
    : family.short.some(r => r.ticker === sym) ? 'short' : null
  useEffect(() => { setOpen(false) }, [sym])
  // ... Esc/outside-click close, vertical-clamp positioning per design notes ...
  if (!hasFamily) return null
  const bestLongRow = family.long[0] || null
  const bestShortRow = family.short[0] || null
  // segments: STOCK | {factor}X ↑ | {factor}X ↓ | ▾ (aria-label "More single-stock ETFs")
  // panel: role="menu", rows role="menuitem", LONG then SHORT groups
  // (full JSX per design notes — match tfBtn styling, tints, disabled states)
}
```

- [ ] **Step 4: Run until green + run the mutation check.**

- [ ] **Step 5: Commit**

```bash
git add -- app/src/pages/charts/widgets/LeverageInverseControl.jsx app/src/pages/charts/widgets/LeverageInverseControl.module.css app/src/pages/charts/widgets/LeverageInverseControl.test.jsx
git commit -m "feat(ssetf): LeverageInverseControl — segmented STOCK/LONG/SHORT pill + ranked family panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Mount in ChartWidget + integration test + full suite

**Files:**
- Modify: `app/src/pages/charts/widgets/ChartWidget.jsx` (~L485-497, the `tfBarRight` div)
- Test: extend `app/src/pages/charts/widgets/LeverageInverseControl.test.jsx` or the existing ChartWidget test file if present

**Interfaces:**
- Consumes: `LeverageInverseControl` (Task 8), ChartWidget's existing `sym` state + `handleSymbolChange`.

- [ ] **Step 1: The mount (exact diff)**

```jsx
// ChartWidget.jsx — add import at top with the other widget imports:
import LeverageInverseControl from './LeverageInverseControl'

// In the render, FIRST CHILD inside the tfBarRight div (before the settings
// gear button — .tfBarRight's margin-left:auto right-aligns the cluster):
        <div className={styles.tfBarRight}>
          {!themeIdx.isIndex && (
            <LeverageInverseControl sym={sym} onSelect={handleSymbolChange} />
          )}
          {/* Chart settings gear — moved down next to Share to the Floor. */}
```

`sym` here is the debounced symbol (ChartWidget.jsx:47) — the hook therefore
never fans out during fast watchlist arrow-scans. `themeIdx.isIndex` guard is
belt-and-suspenders on top of the hook's own `$IDX:` skip.

- [ ] **Step 2: Integration test** — render ChartWidget is heavy; instead assert the wiring contract with a focused test: mock `useSingleStockEtfs`, render the control with `onSelect` spy, verify all three segments + panel rows route through the single callback (already covered in Task 8) AND grep-assert the mount:

Run: `grep -n "LeverageInverseControl" app/src/pages/charts/widgets/ChartWidget.jsx`
Expected: 2 hits (import + mount inside tfBarRight).

- [ ] **Step 3: Run the FULL frontend suite** — `cd app && npx vitest run --pool=threads` → all pass (baseline was 2,446; new total higher, zero failures).

- [ ] **Step 4: Production build check** — `cd app && npm run build` → succeeds (catches ESBuild/CSS-module issues before Playwright).

- [ ] **Step 5: Commit**

```bash
git add -- app/src/pages/charts/widgets/ChartWidget.jsx
git commit -m "feat(ssetf): mount Leverage/Inverse control in ChartWidget tfBarRight

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Live verification (probe + local end-to-end + Playwright DOM)

**Files:**
- Uses: `tools/ssetf_probe.py`, local uvicorn, Playwright (Python, already installed)
- Create (throwaway OK, keep if clean): `tools/ssetf_e2e_check.py`

- [ ] **Step 1: Run the live probe** — `python tools/ssetf_probe.py --save-fixture` (FINVIZ_API_KEY via `.env`). Verify: headers match `EXPECTED_HEADERS` **exactly** (if not, fix `EXPECTED_HEADERS`/`_EXPORT_COLS` NOW — this is the §3.1 probe); numeric formats consistent with `_num`; NBIS family contains NBIL/NEBX/NBIG/NBIZ (± genuinely-new funds); TSLA family includes T-REX funds (company-name pass proof); parse outcomes show quarantine ≪ 20 rows (not flooded).
- [ ] **Step 2: Fixture-based parser regression** — add `tests/test_ssetf_fixture.py` that runs `parse_etf_name` over `tests/fixtures/finviz_etf_sample.csv` asserting: zero `quarantine:ambiguous` rows for known-good names, and the NBIS family parses complete. Commit fixture + test.
- [ ] **Step 3: Local end-to-end** — start local backend (heavy jobs off, per CLAUDE.md local recipe: `$env:WORKER_ENABLED="0"; $env:CATALYST_ENGINE_ENABLED="0"; ...; python -m uvicorn api.main:app --port 8077`), then: `POST /api/single-stock-etfs/rebuild` as admin (mobtest recipe) → poll `GET /status` until `last_status == "ok"` → `GET /api/single-stock-etfs/NBIS` returns the ranked family → `GET /api/single-stock-etfs/status` NOT the family shape.
- [ ] **Step 4: Prod bars sanity** — `GET https://uctintelligence.com/api/bars/NBIL?tf=D&bars=5` (browser UA — Cloudflare blocks bare curl UAs): fresh daily bars return with last-bar date = last trading day.
- [ ] **Step 5: Playwright DOM pass** (real built bundle at `localhost:8077`, admin login): chart NBIS in /charts → control visible in the toolbar → click `2X ↑` → chart symbol becomes the best_long ticker with bars rendered (assert DOM, not hash) → caret panel lists the family → pick a non-best fund → chart swaps → type the ETF directly → STOCK returns NBIS → narrow the widget below ~480px container width → segments hide, caret remains, tfBar does NOT wrap (measure `.tfBar` height unchanged) → move widget to the bottom row → panel opens upward fully on-screen.
- [ ] **Step 6: Commit fixture/test/tool** — explicit paths, message `test(ssetf): live-export fixture regression + e2e checks`.

---

### Task 11: Ship + post-deploy verification

- [ ] **Step 1: Preflight** — `grep -c broker_sync api/main.py` ≥ 7 (locked invariant); full backend + frontend suites green; `npm run build` green.
- [ ] **Step 2: Deploy-window check** — PowerShell (NOT Git Bash TZ) for ET time; ship only ≥4:20 PM ET or <9:15 AM ET.
- [ ] **Step 3: Ship** — `git fetch origin && git rebase origin/master && git push origin feat/single-stock-etfs:master` (ONE command — partner-race rule). If rebase conflicts touch partner files (OptionsFlow.jsx, schwab_router.py, live_massive_router.py, massive_ws_worker.py) STOP and coordinate.
- [ ] **Step 4: Verify Railway vars** — `railway variables` (linked dir `/c/Users/Patrick/uct-dashboard`): FINVIZ_API_KEY present (it is — industry_map uses it). Do NOT set SINGLE_STOCK_ETFS_ENABLED (defaults on).
- [ ] **Step 5: Post-deploy** — wait for build success; verify bundle per `reference_dashboard_deploy_verify_cloudflare` (grep the deployed `index-*.js` for a control string, e.g. "No inverse single-stock"); admin `POST /api/single-stock-etfs/rebuild` in prod → `GET /status` shows `ok` with plausible counts (~150-400 ETFs, dozens of families) → chart NBIS on prod → control renders → swap works.
- [ ] **Step 6: Punch list** — single end-of-run punch list (house rule): first nightly run (20:30 ET) check via `/status` next morning; grid-cell adoption deferred; overrides admin UI deferred; industry_map token-redaction fix as separate commit.

## Self-Review (done at plan-writing time)

- **Spec coverage:** §2.1 control → T8/T9; §2.2 panel → T8; §3.1 fetch/probe → T2/T10; §3.2 parser → T1 (+T10 fixture); §3.3 liquidity/backfill → T4/T5; §3.4 rebuild/gates/self-heal/nightly → T4/T5/T6; §3.5 rails/overrides/quarantine/alerts → T4; §4 storage → T3; §5 API/kill switch/route order → T6; §6 hook/mount → T7/T9; §7 edge cases → tests across T1/T4/T6/T8; §8 → every task's tests + T10; §9 → T11. No gaps.
- **Placeholder scan:** Task 8 Step 3 is deliberately a contract-skeleton (full JSX is a styling exercise against live CSS the implementer must read; behavior is fully pinned by the tests in Step 1). Everything else is complete code.
- **Type consistency:** `parse_etf_name(name, etf_ticker, stock_set)`, `ParseResult.status/reason/underlying/direction/factor`, `rebuild(force_shrink, trigger)`, `lookup(symbol)`, family shape `{underlying, long, short, best_long, best_short}`, hook return `{family, hasFamily}`, component props `{sym, onSelect}` — consistent across all tasks.
