"""The screener's OWN symbol universe — every US common stock + ADR that trades,
with NO price and NO market-cap floor.

⛔ WHY THIS IS SEPARATE FROM `cap_universe`. `api/data/cap_universe.json` (the
app-wide "$300M+ symbol list") is read by ~75 modules — the whole-universe bars
pre-cache, ticker search, the name/logo prewarmers, chart-health. Growing IT to
"every stock" would ~double all of that background work on the single web pod.
So the screener gets its own, wider pool that ONLY the screener snapshot builder
iterates; everything else keeps the curated cap universe untouched.

"All Market" on the page = this whole set. "UCT Universe" is the liquid subset,
applied at READ time in `query.py::_universe_clauses` (price ≥ $5, 30-day $-vol
≥ $20M) — not baked into this list, so the two pools stay one file + one gate.

LOAD precedence (first non-empty wins):
  1. env `SCREENER_UNIVERSE_PATH`            (tests / explicit override)
  2. `<DATA_DIR>/screener_universe.json`     (refreshed on the pod by build_and_save)
  3. `api/data/screener_universe.json`       (committed fallback, may be absent)
  4. `cap_universe.symbols()`                (LAST resort → identical to the old
                                              behaviour, so a missing file is
                                              never a regression, only "not wider yet")

Never raises. A total failure yields the cap universe so the screener still builds.
"""
from __future__ import annotations

import json
import logging
import os

log = logging.getLogger(__name__)

_FILENAME = "screener_universe.json"
_TYPES_FILENAME = "screener_types.json"
_BUYOUT_FILENAME = "screener_buyout_exclude.json"

# US common stock + ADR classes, per `api/ticker_types.py`.
ADR_TYPES = frozenset({"ADRC", "ADRP", "ADRR", "ADRW"})
KEEP_TYPES = frozenset({"CS"}) | ADR_TYPES              # common + ADR
# The "Global Universe" pool: common + ADR + the whole exchange-traded fund family
# (ETF/ETN/ETV + closed-end funds). Still excludes preferreds/units/rights/warrants
# and buyout targets. ETF_TYPES is imported at build time from `api.ticker_types`.
_ETF_FAMILY = frozenset({"ETF", "ETN", "ETV", "FUND"})
INSTRUMENT_KEEP = KEEP_TYPES | _ETF_FAMILY

# The screener-row `security_type` bucket a member filters on (Stocks / ADRs /
# ETFs). Closed-end funds and ETNs fold into "ETF" to match the member-facing
# Type control; the raw reference code is not shown.
def _coarse_type(sym: str, ref_type: dict, core_etfs: set) -> str:
    ty = ref_type.get(sym, "")
    if ty in ADR_TYPES:
        return "ADR"
    if ty == "CS":
        return "Stock"
    if ty in _ETF_FAMILY or sym in core_etfs:
        return "ETF"
    return "Stock"          # a curated core equity the reference enumeration missed


def _pkg_data_path(filename: str) -> str:
    """A data file inside the api package, then relative to CWD."""
    here = os.path.join(os.path.dirname(__file__), "..", "..", "data", filename)
    if os.path.exists(here):
        return here
    return os.path.join("api", "data", filename)


def _data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def writable_path() -> str:
    """Where `build_and_save` writes — the refreshed copy the loader prefers.
    Env override wins so a test never touches the real volume."""
    override = os.environ.get("SCREENER_UNIVERSE_PATH")
    if override:
        return override
    return os.path.join(_data_dir(), _FILENAME)


def _load_paths() -> list[str]:
    override = os.environ.get("SCREENER_UNIVERSE_PATH")
    paths = []
    if override:
        paths.append(override)
    paths.append(os.path.join(_data_dir(), _FILENAME))
    paths.append(_pkg_data_path(_FILENAME))
    return paths


def _read_list(path: str) -> list[str]:
    """A flat JSON list of ticker strings → upper-cased list, or [] on any fault."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return []
    except Exception as exc:                                # noqa: BLE001
        log.warning("[screener-universe] load failed for %s: %s", path, exc)
        return []
    if not isinstance(data, list):
        log.warning("[screener-universe] %s is not a list", path)
        return []
    return [str(t).upper() for t in data if t]


def buyout_excludes() -> frozenset[str]:
    """Owner-maintained buyout / M&A exclude set. There is NO live acquisition
    feed anywhere in the app, so this is a best-effort hand list — subtracted at
    build time and easy to extend (`api/data/screener_buyout_exclude.json`)."""
    return frozenset(_read_list(_pkg_data_path(_BUYOUT_FILENAME)))


def symbols() -> list[str]:
    """The screener universe, best available source. Falls back to the cap
    universe so the screener never loses its universe just because the wider file
    has not been generated yet."""
    for p in _load_paths():
        got = _read_list(p)
        if got:
            return sorted(set(got))
    # Last resort: the app-wide cap universe (== the pre-2026-09-21 behaviour).
    try:
        from api.services import cap_universe
        return sorted(cap_universe.symbols())
    except Exception:                                      # noqa: BLE001
        return []


def _types_paths() -> list[str]:
    override = os.environ.get("SCREENER_TYPES_PATH")
    paths = [override] if override else []
    paths.append(os.path.join(_data_dir(), _TYPES_FILENAME))
    paths.append(_pkg_data_path(_TYPES_FILENAME))
    return paths


def writable_types_path() -> str:
    override = os.environ.get("SCREENER_TYPES_PATH")
    return override or os.path.join(_data_dir(), _TYPES_FILENAME)


def types() -> dict:
    """`{TICKER: "Stock"|"ADR"|"ETF"}` — the coarse instrument bucket the snapshot
    builder stamps on each row's `security_type` and the Type filter narrows on.
    Written alongside the universe by `build_and_save`; {} when not generated yet
    (the builder then defaults a row to "Stock")."""
    for p in _types_paths():
        try:
            with open(p, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict) and data:
                return {str(k).upper(): str(v) for k, v in data.items()}
        except FileNotFoundError:
            continue
        except Exception as exc:                            # noqa: BLE001
            log.warning("[screener-universe] types load failed for %s: %s", p, exc)
    return {}


# ── the generator (runs where the Massive key lives: the web pod) ──────────────

def _recent_traded_set(sessions: int, min_shares: float,
                       max_lookback_days: int = 12) -> set[str]:
    """Union of tickers that actually traded (volume ≥ min_shares) across the last
    `sessions` non-empty grouped-daily frames — the "not a dead shell" signal.
    One whole-market call per day; empty (holiday) frames are skipped."""
    from datetime import date, timedelta
    from api.services import massive
    live: set[str] = set()
    got = 0
    day = date.today()
    for _ in range(max_lookback_days):
        day -= timedelta(days=1)
        if day.weekday() >= 5:                             # skip Sat/Sun cheaply
            continue
        frame = massive.get_grouped_daily_ohlcv(day.isoformat()) or {}
        if not frame:
            continue
        for tk, row in frame.items():
            try:
                if float(row.get("v") or 0) >= min_shares:
                    live.add(str(tk).upper())
            except Exception:                              # noqa: BLE001
                continue
        got += 1
        if got >= sessions:
            break
    return live


def build_and_save(min_shares: float | None = None, sessions: int = 5,
                   write_path: str | None = None) -> dict:
    """Regenerate the "Global Universe" from Massive reference and persist it.

    US common + ADR + the exchange-traded fund family (`INSTRUMENT_KEEP` =
    ETF/ETN/ETV + closed-end funds), active, NO price/market-cap floor, minus
    truly dead shells (never traded ≥ `min_shares` over the recent window) and
    minus the buyout exclude list. A name in the curated cap universe is ALWAYS
    kept even if it fails the liveness test — the known-good core can never shrink.

    Writes TWO files: the flat universe list, and a `{ticker: type}` map
    (Stock/ADR/ETF) the snapshot builder stamps onto each row's `security_type`.
    Best-effort: on a reference-API failure it writes nothing and reports
    `final == 0`, so the loader keeps the previous file (or the cap-universe
    fallback) rather than blanking the screener.
    """
    from api.services import massive
    if min_shares is None:
        try:
            min_shares = float(os.environ.get("SCREENER_UNIVERSE_MIN_SHARES", "1000"))
        except Exception:                                  # noqa: BLE001
            min_shares = 1000.0

    ref = massive.list_reference_tickers(active=True, market="stocks") or []
    ref_type: dict[str, str] = {}
    for r in ref:
        tk = str(r.get("ticker") or "").upper()
        typ = str(r.get("type") or "").upper()
        if tk:
            ref_type[tk] = typ
    typed = {t for t, ty in ref_type.items() if ty in INSTRUMENT_KEEP}  # CS/ADR + fund family

    if not typed:
        # Reference call failed — do NOT overwrite a good file with nothing.
        log.warning("[screener-universe] reference returned no keepable names; "
                    "leaving the existing universe untouched")
        return {"ok": False, "reason": "reference_empty", "final": 0}

    live = _recent_traded_set(sessions, min_shares)
    try:
        from api.services import cap_universe
        core = set(cap_universe.symbols())          # curated equities the reference misses
        core_etfs = set(cap_universe.etf_symbols())  # curated liquid ETFs
    except Exception:                                      # noqa: BLE001
        core, core_etfs = set(), set()
    excl = buyout_excludes()

    # ⛔ THE REFERENCE ENUMERATION IS INCOMPLETE — it drops real common stocks
    # (AL, AMWD, ASGN … present in cap_universe but absent from
    # `list_reference_tickers`). So the universe UNIONS three sources: reference
    # instruments that TRADE (or are curated), every curated cap_universe equity,
    # and the curated ETF list — then subtracts only the buyout targets. ETFs and
    # funds are now KEPT (the Global Universe is the whole tradeable market); the
    # Type filter narrows by `security_type` at read time. A blank liveness frame
    # (provider hiccup) must not delete the world, so `keep_live` falls back to all
    # typed names.
    keep_live = live or set(typed)
    keep = {t for t in typed if t in keep_live or t in core or t in core_etfs}
    keep |= core
    keep |= core_etfs
    keep -= excl
    final = sorted(keep)
    type_map = {t: _coarse_type(t, ref_type, core_etfs) for t in final}

    dest = write_path or writable_path()
    tdest = writable_types_path()
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    for path, payload in ((dest, final), (tdest, type_map)):
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        os.replace(tmp, path)

    by_bucket: dict[str, int] = {}
    for v in type_map.values():
        by_bucket[v] = by_bucket.get(v, 0) + 1
    summary = {
        "ok": True,
        "reference_total": len(ref),
        "reference_kept": len(typed),
        "core_added": len((core | core_etfs) - typed),
        "traded_recently": len(live),
        "excluded_buyouts": len({t for t in (typed | core | core_etfs) if t in excl}),
        "final": len(final),
        "by_type": by_bucket,
        "min_shares": min_shares,
        "path": dest,
    }
    log.info("[screener-universe] rebuilt: %s", summary)
    return summary
