"""Live swing-trade quality gates for Groups ranking.

Biases rank_holdings toward tradable names (liquid, high-RS, good range, real
price) at query time, so the taxonomy map never needs pruning for strength.
NEVER drops a name and NEVER raises — it only re-orders. Default OFF (dark).

rs_rank comes ONLY from the rs_ranking cache (passed in as `rs`), NOT the
screener's own rs_rank column (a different metric). price/$-vol are LIVE
(derived from the intraday move); ADR is the screener's EOD figure.
"""
import logging
import os
import time

from api.services.screener import snapshot_db

_logger = logging.getLogger(__name__)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        _logger.warning("groups_gates: bad %s=%r, using default %s",
                        name, os.environ.get(name), default)
        return default


RS_MIN = _env_float("GROUPS_GATE_RS_MIN", 70.0)
DVOL_MIN = _env_float("GROUPS_GATE_DOLLARVOL_MIN", 20_000_000.0)
ADR_MIN = _env_float("GROUPS_GATE_ADR_MIN", 4.0)
PX_MIN = _env_float("GROUPS_GATE_PRICE_MIN", 5.0)
_STALE_SECS = _env_float("GROUPS_GATE_STALE_SECS", 4 * 86400.0)

# Screener rows change once/night — cache the batched read briefly.
_ROWS_CACHE = {}          # {frozenset(syms): (monotonic_at, {sym: row})}
_ROWS_TTL = 3600.0


def gates_enabled() -> bool:
    return os.environ.get("GROUPS_SWING_GATES_ENABLED", "0") == "1"


def _num(v):
    """float(v) or None — guards NULLs and stray bad types from SQLite."""
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def gate_bands(m: dict | None) -> tuple:
    """(liq_band, momentum) for {rs_rank, dollar_vol, adr_pct, price}.

    liq_band: 0 confirmed-liquid (price & $-vol present and >= floors),
              1 unconfirmed (price or $-vol missing — can't tell),
              2 confirmed-illiquid (present but below a floor).
    momentum: (rs_rank>=RS_MIN) + (adr_pct>=ADR_MIN), missing counts 0.
    Higher momentum is better; the caller negates it in the sort key.
    """
    m = m or {}
    price = _num(m.get("price"))
    dvol = _num(m.get("dollar_vol"))
    if price is None or dvol is None:
        liq = 1
    elif price >= PX_MIN and dvol >= DVOL_MIN:
        liq = 0
    else:
        liq = 2
    rs = _num(m.get("rs_rank"))
    adr = _num(m.get("adr_pct"))
    momentum = (1 if (rs is not None and rs >= RS_MIN) else 0) \
        + (1 if (adr is not None and adr >= ADR_MIN) else 0)
    return (liq, momentum)


def gate_score(m: dict | None) -> int:
    """Compact 0-4 for observability ('why did X rank here'):
    confirmed-liquid=2 / unconfirmed=1 / confirmed-illiquid=0, plus momentum."""
    liq, momentum = gate_bands(m)
    return {0: 2, 1: 1, 2: 0}[liq] + momentum


def pass_rates(metrics_map: dict) -> dict:
    """Per-gate pass counts across a fill's metrics, for spotting ADR/$-vol
    co-collapse in quiet tape (RS is a 1-99 percentile — it can't collapse
    market-wide, so watch the absolute gates)."""
    out = {"rs": 0, "dvol": 0, "adr": 0, "px": 0, "n": 0}
    for m in (metrics_map or {}).values():
        m = m or {}
        out["n"] += 1
        rs, adr = _num(m.get("rs_rank")), _num(m.get("adr_pct"))
        px, dv = _num(m.get("price")), _num(m.get("dollar_vol"))
        if rs is not None and rs >= RS_MIN:
            out["rs"] += 1
        if adr is not None and adr >= ADR_MIN:
            out["adr"] += 1
        if px is not None and px >= PX_MIN:
            out["px"] += 1
        if dv is not None and dv >= DVOL_MIN:
            out["dvol"] += 1
    return out


def _get_rows_cached(syms: tuple) -> dict:
    key = frozenset(syms)
    now = time.monotonic()
    hit = _ROWS_CACHE.get(key)
    if hit and (now - hit[0]) < _ROWS_TTL:
        return hit[1]
    try:
        rows = snapshot_db.get_rows(list(syms))
    except Exception:
        _logger.warning("groups_gates: screener get_rows failed; gating this fill "
                        "without liquidity data", exc_info=True)
        return {}                      # do NOT cache a transient failure — retry next call
    _ROWS_CACHE[key] = (now, rows)
    if len(_ROWS_CACHE) > 256:          # keep the cache tiny; fill-sets repeat
        _ROWS_CACHE.clear()
        _ROWS_CACHE[key] = (now, rows)
    return rows


def swing_metrics(syms: list, rs: dict, today: dict) -> dict:
    """{sym: {rs_rank, dollar_vol, adr_pct, price}} for gating. Never raises.

    price/$-vol are LIVE: current = screener_close * (1 + today_pct/100), with a
    fallback to the close when there is no live pct. rs_rank comes from `rs`
    (the rs_ranking cache) ONLY. A screener row older than _STALE_SECS is
    treated as missing (guards a silently-stalled nightly build).
    """
    syms = [s.upper() for s in syms if s]
    if not syms:
        return {}
    rows = _get_rows_cached(tuple(sorted(syms)))
    now = time.time()
    out = {}
    for hy in syms:
        row = rows.get(hy)
        stale = bool(row) and row.get("built_at") is not None \
            and (now - float(row["built_at"])) > _STALE_SECS
        usable = row if (row and not stale) else None
        prev_close = _num(usable.get("price")) if usable else None
        avg_vol = _num(usable.get("avg_volume_30d")) if usable else None
        adr = _num(usable.get("adr_pct")) if usable else None
        pct = _num((today or {}).get(hy))
        cur_price = (prev_close * (1 + pct / 100.0)) if (prev_close is not None and pct is not None) else prev_close
        dvol = (cur_price * avg_vol) if (cur_price is not None and avg_vol is not None) else None
        out[hy] = {
            "rs_rank": ((rs or {}).get(hy) or {}).get("rs_rank"),
            "dollar_vol": dvol,
            "adr_pct": adr,
            "price": cur_price,
        }
    return out
