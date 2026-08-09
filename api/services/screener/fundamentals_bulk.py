"""The bulk fundamentals pass — Group A's ten columns, plus `exchange`.

🔴 WHAT WAS WRONG. Eleven columns of `snapshot_db.COLUMNS` were declared ahead
of any collector and were NULL on all 3,708 rows of the live snapshot:

    dividend_yield  pe_ttm  ps  pb  gross_margin  net_margin
    roa  debt_to_equity  current_ratio  beta          + exchange

The values exist in this repo — `research/financials.py` and
`research/snapshot.py` build them for the research page — but ONE SYMBOL AT A
TIME, on demand. Filling ~3,700 names that way is ~3,700 provider calls per
night, and a bulk job that starves a shared provider budget is a measured defect
here. This module is the bulk pass: **six HTTP requests for the whole market.**

──────────────────────────────────────────────────────────────────────────────
WHICH ENDPOINTS, AND WHY — PROBED, NOT ASSUMED
──────────────────────────────────────────────────────────────────────────────
Every line below was measured against the live FMP account on 2026-08-09, not
read off the documentation. The repo has already been bitten by assuming: the
legacy v3 family 403s on this plan, and it still does —

    GET /api/v3/ratios-ttm/AAPL -> 403 "Legacy Endpoint ... only available for
                                   legacy users ... prior August 31, 2025"

⭐ THE BULK ENDPOINTS RETURN **CSV**, NOT JSON. That is not a detail: the
existing `api/services/fmp_bulk.py` calls them through `earnings_estimates
._fmp_get`, which ends in `r.json()`, so it raises on every response, returns
`None`, and `fetch_fundamentals_bulk()` has been returning `{}` unconditionally.
(It is a different consumer — the ratings gather — and it is left alone here,
but it is reported.) This module parses CSV, streamed.

    ENDPOINT                        BYTES   COVERS OF OUR 3,742-NAME UNIVERSE
    /stable/ratios-ttm-bulk         69.7MB  3,679  8 of the ten
    /stable/key-metrics-ttm-bulk    44.3MB  3,679  roa
    /stable/profile-bulk?part=0..3 114.0MB  3,738  beta + exchange

`/stable/company-screener` was the cheaper candidate for beta+exchange (JSON,
~2MB, three calls) and was REJECTED after measuring: `exchange=NASDAQ` returned
EXACTLY 10,000 rows, i.e. it was truncated at its cap, and it reached 3,718
names against profile-bulk's 3,738. A silently-capped list is the failure this
whole phase exists to remove. profile-bulk paginates over the entire database,
so its coverage is a property of the walk rather than of a limit we hope is big
enough — and the walk's end is DERIVED (a part that 400s) rather than a part
count restated here, which is how such a number goes stale.

──────────────────────────────────────────────────────────────────────────────
🔴 THE ZERO QUESTION — THE ONE WAY THIS FEATURE COULD SHIP A LIE
──────────────────────────────────────────────────────────────────────────────
The dangerous outcome is not a missing number, it is a PLAUSIBLE WRONG one.
FMP emits a literal `0` where a ratio is UNDEFINED, and `0` is a perfectly
well-formed float that passes every consistency check downstream. Measured over
our universe:

    currentRatioTTM == 0 on 163 rows — AB, ABCB, ACGL, AFG, AGO, AIZ, AMAL,
    ARCC ... every one a BANK, INSURER or BDC. They have no current/non-current
    balance-sheet split, so FMP has no ratio and prints 0. Writing it makes
    `current_ratio < 1` return every financial in America.

⭐ SO A ZERO IS WRITTEN ONLY WHEN AN INDEPENDENT FIELD IN THE SAME ROW SAYS THE
NUMERATOR IS GENUINELY ZERO. That is ONE principle, not ten judgement calls,
and each column names its own corroborator in `SPECS` below. The two directions
were both measured:

  * `dividendYieldTTM == 0` on 1,712 rows, and `dividendPerShareTTM == 0` on
    **all 1,712 of them**. A non-payer's yield IS 0. ⭐ KEPT — refusing these
    would blank 47% of the column and make "no dividend" unscreenable.
  * `debtToEquityRatioTTM == 0` on 240 rows, of which **238** also read 0 for
    `debtToAssetsRatioTTM` AND `debtToCapitalRatioTTM` — three quotients with
    three different denominators agreeing, which is a debt-free company
    (ANET, AFL, AL, ARCC). KEPT. The other 2 (AHRT, MARA) are refused.
  * Everything else has no corroborator and its zeros track a dead denominator:
    `pe_ttm` 4 zeros / 4 with zero EPS · `ps` 226 / 225 with zero revenue ·
    `net_margin` 228 / 228 with zero revenue. REFUSED.
  * `pb` reads 0 for MARA, PTON, VST, ABX with *non-zero* book value per share —
    provider noise, not a price/book of zero. REFUSED.

⛔ NO DEFAULTS, NO ZERO-FILL, NO CARRY-FORWARD. A ticker FMP has no row for
keeps NULL and is COUNTED as a miss (`fmp_bulk: {'no_row': N}`), because a
provider failure that reads as success is the other half of the same defect —
`built=3708 skipped=0 errors=0` was printed over a column that was NULL 3,708
times.

⛔ AND NO SANITY BOUND. `beta` genuinely ranges (-43.73, 10.00) over this
universe and a P/E of 5,000 is a real barely-profitable company. A clamp here
would be a threshold with nothing to tune it against; only non-finite values
are refused.

──────────────────────────────────────────────────────────────────────────────
⚠️ UNITS — THE OTHER SILENT-WRONG-NUMBER TRAP
──────────────────────────────────────────────────────────────────────────────
FMP returns margins, yields and returns as FRACTIONS (AAPL grossProfitMargin
0.4865). This table stores them as PERCENT, and that is not a preference: it is
the convention the columns beside them already carry (`op_margin`/`roe` arrive
via `enrich.ratings_fields` from `get_fundamentals`, whose `_round_pct` is a
×100) and it is stated in `app/src/pages/screener/columnDefs.js`:

    // NOTE: margins / growth / roe / roa / dividend_yield are stored as PERCENT
    // numbers by the snapshot builder (e.g. 25.0 == 25%), so format directly.

Writing 0.4865 into `gross_margin` would render "0%" and make every margin
filter a silent zero-hit. The ×100 is carried in `SPECS.scale` so the scaling
lives beside the field it scales and cannot drift from it.

⭐ `pe_ttm`/`ps`/`pb`/`debt_to_equity`/`current_ratio`/`beta` are PLAIN RATIOS
(scale 1.0). `filters.py` used to claim `debt_to_equity` was "the yfinance value
(percent-ish, e.g. 47.5)" — a description of a column that had never held a
value, from a provider that never wrote it. FMP's native form is the ratio, the
manifest sentence is "the debt-to-equity ratio", and `columnDefs.js` renders it
with `num(1)` rather than a percent formatter. That docstring is corrected in
the same commit rather than left to contradict the data.

──────────────────────────────────────────────────────────────────────────────
⭐ ONE AUTHORITY PER COLUMN
──────────────────────────────────────────────────────────────────────────────
This module writes ELEVEN columns and no others. In particular it does **not**
write `market_cap` even though `key-metrics-ttm-bulk` carries it and
`profile-bulk` carries it again — `massive.get_market_cap` is that column's
authority as of `12071063`, and a second computation of one value is this
repo's most repeated defect. Nor does it write `company`/`sector`/`industry`
(the `ticker_meta` cache owns those). `test_the_bulk_map_is_disjoint_from_every
_other_source` is the rail on that, derived from the source maps rather than
from a list retyped in a test.

`exchange` DOES come from here, and that supersedes the plan to add a Massive
accessor. The objection to the Massive route was sound — `get_ticker_details`
is uncached and `get_market_cap` discards the payload, so a naive map is a
second HTTP round-trip × 3,708, and Polygon's `primary_exchange` is a MIC
(`XNAS`), so writing it raw would make `exchange == "NASDAQ"` a silent
zero-hit and create a MIC→name mapping to own. None of that applies here:
profile-bulk is a call this module already makes, and its `exchange` field is
ALREADY the plain name — measured over our universe: NYSE 1,926 · NASDAQ 1,711
· AMEX 95 · CBOE 5 · PNK 1. No mapping, no extra request, one authority.
"""
from __future__ import annotations

import contextlib
import csv
import io
import logging
import math
import os
import time
from typing import NamedTuple

log = logging.getLogger(__name__)

_BASE = "https://financialmodelingprep.com"

#: How long to wait for a bulk body. These are 30-70MB CSVs; the measured
#: transfer was 1-4s, but a slow pod must not abort a whole night's fill.
_TIMEOUT = 300
#: Politeness between bulk calls. A back-to-back walk of profile-bulk earned a
#: 429 during probing, so the pass paces itself and retries a 429 once.
_GAP_SECONDS = 1.5
_RETRY_429 = 2
#: A bound on the profile-bulk walk so a provider that stops returning 400 at
#: the end cannot spin forever. The REAL end is a 400 — this is a guard rail,
#: not the part count.
_MAX_PARTS = 32


class _Spec(NamedTuple):
    """One column's contract with the provider.

    `field`        the FMP column it is read from
    `scale`        1.0 for a plain ratio, 100.0 for a fraction stored as percent
    `zero_ok_when` the OTHER fields that must ALSO read exactly 0 before a 0 is
                   written. Empty means a literal 0 is FMP's undefined sentinel
                   and the column stays NULL. See the module note.
    """
    field: str
    scale: float
    zero_ok_when: tuple


# ⭐ DICT LITERALS KEYED BY SNAPSHOT COLUMN. That shape is load-bearing twice
# over: it is the mapping `_row_from` iterates to write the row, and it is what
# `tests/test_scalar_population_rail.py`'s AST walker reads to answer "does any
# code in this package write `pe_ttm`?". A tuple of (column, field) pairs would
# be correct code and an INVISIBLE collector — §1 of that rail would stay red
# while the column filled, which is the same class of drift as a hand-typed
# count.

#: /stable/ratios-ttm-bulk -> eight of the ten.
RATIO_SPECS = {
    "dividend_yield": _Spec("dividendYieldTTM", 100.0, ("dividendPerShareTTM",)),
    "pe_ttm":         _Spec("priceToEarningsRatioTTM", 1.0, ()),
    "ps":             _Spec("priceToSalesRatioTTM", 1.0, ()),
    "pb":             _Spec("priceToBookRatioTTM", 1.0, ()),
    "gross_margin":   _Spec("grossProfitMarginTTM", 100.0, ()),
    "net_margin":     _Spec("netProfitMarginTTM", 100.0, ()),
    # 238 of 240 zeros are corroborated by two further debt quotients reading
    # zero — a genuinely debt-free balance sheet, not a missing denominator.
    "debt_to_equity": _Spec("debtToEquityRatioTTM", 1.0,
                            ("debtToAssetsRatioTTM", "debtToCapitalRatioTTM")),
    # No corroborator exists in this payload for current LIABILITIES, and all
    # 163 zeros are banks/insurers/BDCs. A literal 0 is refused.
    "current_ratio":  _Spec("currentRatioTTM", 1.0, ()),
}

#: /stable/key-metrics-ttm-bulk -> roa. Its denominator (total assets) is not
#: carried here, so a literal 0 has nothing to corroborate it and is refused.
#: ⛔ `marketCap` is in this payload and is deliberately NOT read: Massive owns
#: that column.
KEY_METRIC_SPECS = {
    "roa": _Spec("returnOnAssetsTTM", 100.0, ()),
}

#: /stable/profile-bulk -> beta. `exchange` is TEXT and handled beside these.
PROFILE_SPECS = {
    "beta": _Spec("beta", 1.0, ()),
}

#: The one TEXT column, and the FMP field it is read from. `exchange` is the
#: SHORT name ("NASDAQ"), not `exchangeFullName` ("NASDAQ Global Select") —
#: the short form is what a member would type and what the column's siblings
#: (`sector`, `industry`) look like.
PROFILE_TEXT = {
    "exchange": "exchange",
}

#: Every snapshot column this module can write. DERIVED from the maps above so
#: it cannot fall out of step with them.
COLUMNS_WRITTEN = (
    set(RATIO_SPECS) | set(KEY_METRIC_SPECS) | set(PROFILE_SPECS)
    | set(PROFILE_TEXT)
)


def _num(value):
    """A finite float, or None. Empty string, junk and NaN/inf all become None."""
    if value is None or value == "":
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def value_for(spec: _Spec, raw_row: dict):
    """One column's value from one provider row, or None. **PURE.**

    ⭐ THE ZERO RULE LIVES HERE AND NOWHERE ELSE, so there is one place to read
    it and one place to mutate when proving the gauntlet can go red.
    """
    val = _num(raw_row.get(spec.field))
    if val is None:
        return None
    if val == 0:
        # An uncorroborated zero is the provider saying "undefined", not "zero".
        if not spec.zero_ok_when:
            return None
        for other in spec.zero_ok_when:
            if _num(raw_row.get(other)) != 0:
                return None
    return val * spec.scale


def _row_from(specs: dict, raw_row: dict) -> dict:
    out = {}
    for column, spec in specs.items():
        val = value_for(spec, raw_row)
        if val is not None:
            out[column] = val
    return out


# ── the provider (network; thin; monkeypatchable) ────────────────────────────

def _fmp_key() -> str:
    return os.environ.get("FMP_API_KEY", "")


class _ChunkReader(io.RawIOBase):
    """A binary file-like over ``requests``' own chunk iterator.

    🔴 WHY NOT JUST WRAP `resp.raw`. Because it half-works, which is worse than
    failing. `TextIOWrapper(resp.raw)` reads until `read()` returns empty, but
    urllib3 CLOSES the underlying response the moment content-length bytes have
    been consumed — so the final read lands on a closed file and raises
    `ValueError: I/O operation on closed file` AT THE NATURAL END OF THE BODY.

    Measured 2026-08-09: every one of the three pulls raised it. The rows
    already parsed survived, so the ratios pull looked complete; the damage was
    in `_walk_profile_parts`, which treats an exception as "stop walking" and so
    never fetched parts 1-3. `beta` and `exchange` came back for names in part 0
    and were SILENTLY ABSENT for T and XOM. A partial pull that reads as a
    finished one is exactly this task's defect.

    `iter_content` terminates cleanly at EOF and handles transfer/content
    decoding, so EOF here is a real 0 rather than a raise.
    """

    def __init__(self, chunks):
        self._chunks = chunks
        self._buf = b""

    def readable(self) -> bool:
        return True

    def readinto(self, target) -> int:
        while not self._buf:
            try:
                self._buf = next(self._chunks)
            except StopIteration:
                return 0
        n = min(len(target), len(self._buf))
        target[:n] = self._buf[:n]
        self._buf = self._buf[n:]
        return n


@contextlib.contextmanager
def _open_bulk_csv(path: str, params: dict, timeout: int = _TIMEOUT):
    """Yield ``(rows, status, body)`` for an FMP bulk CSV, streamed.

    ⚠️ `csv.reader` over `iter_lines()` would be WRONG: profile-bulk carries
    free-text `description` fields containing newlines, and a line-oriented
    split corrupts every row after the first one. Wrapping `raw` in a
    `TextIOWrapper` hands `csv` a real text stream, so quoting and embedded
    newlines are the csv module's problem, as they should be.

    🔴 IT IS A CONTEXT MANAGER BECAUSE THE RESPONSE'S LIFETIME IS LOAD-BEARING.
    The first cut returned the `DictReader` and let the `requests.Response` fall
    out of scope; CPython collected it and closed the socket mid-walk. See
    `_ChunkReader` for the second, subtler half of the same bug — and for what
    the per-source failure census caught that the row counts did not.

    `rows` is None on any non-200, so a caller that ignores `status` still
    cannot mistake a dead endpoint for a market with no fundamentals.
    """
    import requests

    query = dict(params)
    query["apikey"] = _fmp_key()
    resp = requests.get(f"{_BASE}{path}", params=query, stream=True, timeout=timeout)
    try:
        if resp.status_code != 200:
            yield None, resp.status_code, resp.text[:200]
            return
        stream = io.TextIOWrapper(
            io.BufferedReader(_ChunkReader(resp.iter_content(65536))),
            encoding="utf-8", errors="replace", newline="")
        yield csv.DictReader(stream), 200, ""
    finally:
        resp.close()


def _note(failures: dict, source: str, outcome) -> None:
    """Count a miss under `{source: {outcome: count}}` — the shape
    `snapshot_builder.run_build` already reports."""
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def _collect(path: str, params: dict, specs: dict, wanted: set, into: dict,
             failures: dict, source: str, text_specs: dict | None = None) -> int:
    """Stream one bulk CSV, keep only `wanted` symbols, merge into `into`.

    Returns the number of universe symbols this endpoint contributed a row for.
    """
    seen = 0
    try:
        with _open_bulk_csv(path, params) as (rows, status, body):
            if status != 200:
                _note(failures, source, f"HTTP {status}")
                log.warning("[screener] bulk %s HTTP %s: %s", path, status, body)
                return 0
            seen = _absorb(rows, specs, wanted, into, text_specs)
    except Exception as exc:                                   # noqa: BLE001
        # A truncated body mid-stream must not lose the rows already parsed,
        # and must not be mistaken for a complete pull.
        _note(failures, source, exc)
        log.warning("[screener] bulk %s failed after %s rows: %s", path, seen, exc)
    return seen


def _absorb(rows, specs: dict, wanted: set, into: dict,
            text_specs: dict | None = None) -> int:
    """Merge the `wanted` rows of one provider stream into `into`. **PURE** over
    its inputs, so the mapping is unit-testable without a socket."""
    seen = 0
    for raw in rows:
        sym = (raw.get("symbol") or "").strip().upper()
        if not sym or sym not in wanted:
            continue
        merged = _row_from(specs, raw)
        for column, field in (text_specs or {}).items():
            text = (raw.get(field) or "").strip()
            if text:
                merged[column] = text
        if merged:
            into.setdefault(sym, {}).update(merged)
        seen += 1
    return seen


def _walk_profile_parts(wanted: set, into: dict, failures: dict) -> int:
    """profile-bulk is paginated; the END OF THE WALK IS DERIVED.

    A part past the end answers `400 Query Error: Invalid or missing query
    parameter - part`, so the walk stops on 400 and on nothing else. A 429 is
    retried — treating a rate limit as the end would silently halve coverage
    and look exactly like a shorter database.
    """
    seen = 0
    for part in range(_MAX_PARTS):
        for attempt in range(_RETRY_429 + 1):
            try:
                with _open_bulk_csv("/stable/profile-bulk",
                                    {"part": str(part)}) as (rows, status, body):
                    if status == 429 and attempt < _RETRY_429:
                        _note(failures, "fmp_profile_bulk", "HTTP 429 retried")
                        time.sleep(_GAP_SECONDS * 4 * (attempt + 1))
                        continue
                    if status == 400:
                        return seen                    # the end of the walk
                    if status != 200:
                        _note(failures, "fmp_profile_bulk", f"HTTP {status}")
                        log.warning("[screener] profile-bulk part %s HTTP %s: %s",
                                    part, status, body)
                        return seen
                    seen += _absorb(rows, PROFILE_SPECS, wanted, into,
                                    PROFILE_TEXT)
            except Exception as exc:                           # noqa: BLE001
                _note(failures, "fmp_profile_bulk", exc)
                log.warning("[screener] profile-bulk part %s failed: %s", part, exc)
                return seen
            break
        time.sleep(_GAP_SECONDS)
    _note(failures, "fmp_profile_bulk", "walk hit _MAX_PARTS")
    return seen


# ── the entry point ──────────────────────────────────────────────────────────

_CACHE: dict = {}


def fetch_bulk(wanted, failures: dict | None = None, force: bool = False) -> dict:
    """``{TICKER: {snapshot_column: value}}`` for every name FMP answered for.

    `wanted` bounds the parse to our universe — the ratios file holds 71,370
    rows and we keep ~3,679 of them, so nothing but the kept rows is ever
    materialised. `failures` is the optional `{source: {outcome: count}}`
    out-dict `run_build` already reports; **a missing key or a dead endpoint is
    counted there, never swallowed into an empty result that reads like a
    market with no fundamentals.**

    ⛔ Returns `{}` (with the reason counted) rather than raising: one dead
    provider must not cost the night's technicals, candles and patterns.
    """
    wanted = {str(t).strip().upper() for t in (wanted or []) if t}
    if not wanted:
        return {}

    key = (time.strftime("%Y-%m-%d"), frozenset(wanted))
    if not force and key in _CACHE:
        return _CACHE[key]

    if not _fmp_key():
        # The single loudest failure mode, and the one that produced the
        # original defect under a different provider's name: no credential.
        # ⚠️ FMP_API_KEY lives in `uct-intelligence/.env`, NOT in
        # `uct-dashboard/.env` — the same split that left MASSIVE_API_KEY
        # unresolved for the 03:05 build.
        _note(failures, "fmp_bulk", "no_api_key")
        log.warning("[screener] FMP_API_KEY absent — the ten bulk fundamentals "
                    "and exchange will be NULL for this build")
        return {}

    out: dict = {}
    _collect("/stable/ratios-ttm-bulk", {}, RATIO_SPECS, wanted, out,
             failures, "fmp_ratios_bulk")
    time.sleep(_GAP_SECONDS)
    _collect("/stable/key-metrics-ttm-bulk", {}, KEY_METRIC_SPECS, wanted, out,
             failures, "fmp_key_metrics_bulk")
    time.sleep(_GAP_SECONDS)
    _walk_profile_parts(wanted, out, failures)

    log.info("[screener] fmp bulk fundamentals: %s/%s universe symbols answered",
             len(out), len(wanted))
    if out:
        _CACHE.clear()
        _CACHE[key] = out
    return out
