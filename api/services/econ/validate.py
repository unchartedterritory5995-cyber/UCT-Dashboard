"""Payload + observation validation. FAIL CLOSED.

Every check returns a list of reason strings (empty = OK). `validate_fetch`
runs them all and accepts NOTHING when any reason exists: one bad row poisons
the payload, because a provider that answers wrongly about one period cannot be
trusted about its neighbours. Reasons name periods, counts and ratios -- never a
secret, never a raw payload, never a request URL.

Reason prefixes (the part before ':') are stable machine codes:
  identity  schema  numeric  duplicate  ordering  scale  mutation  partial
  plausibility (a QUARANTINE: the payload is held, not declared corrupt)
"""
from __future__ import annotations

import math
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

from . import timeutil
from .model import RawObs

# Revision windows by registry revision.type. ('periods', n) counts the
# series' own periods back from its newest; ('years', n) is calendar time back
# from the newest period; None = unlimited.
REVISION_WINDOW = {
    "none": ("periods", 0),
    "minor_routine": ("periods", 3),
    "seasonal_factor_revision": ("years", 5),
    "annual_benchmark": ("years", 10),
    "comprehensive": None,
}
SCALE_BAND = (1 / 50, 50)       # |payload| / |stored| outside -> units/scale slip
PLAUSIBILITY_SIGMA = 12.0
PLAUSIBILITY_MIN_HISTORY = 24
FUTURE_GRACE = timedelta(days=1)

_WEEKDAY = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}


def _g(obj, key, default=None):
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _val(x):
    return getattr(x, "value", x)


def _freq(spec) -> str:
    return str(_val(_g(spec, "frequency", "")) or "").upper()


def _anchor(spec) -> str:
    return str(_val(_g(spec, "week_anchor", "")) or "").upper()


def _rev_type(spec) -> str:
    return str(_val(_g(_g(spec, "revision", {}), "type", "")) or "").lower()


def _parse(s) -> Optional[date]:
    try:
        return timeutil.as_date(s)
    except (ValueError, TypeError):
        return None


def _today(now: Optional[float]) -> date:
    ts = now if now is not None else datetime.now(timezone.utc).timestamp()
    return datetime.fromtimestamp(ts, tz=timezone.utc).date()


def _same(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return float(a) == float(b)


# ─────────────────────────────── row checks ──────────────────────────────────


def check_identity(obs: Iterable[RawObs], requested: set) -> list[str]:
    extra = sorted({o.series_id for o in obs} - set(requested))
    return [f"identity: payload carries unrequested series {extra[:5]}"] if extra else []


def check_schema(spec, obs: Iterable[RawObs]) -> list[str]:
    """Period grammar + frequency grid."""
    f, anchor = _freq(spec), _anchor(spec)
    allow_weekend = bool(_g(_g(spec, "validation", {}), "allow_weekend", False))
    out: list[str] = []
    for i, o in enumerate(obs):
        ps, pe = _parse(o.period_start), _parse(o.period_end)
        if ps is None or pe is None:
            # never echo the unparseable label itself: it is raw payload
            out.append(f"schema: malformed period label (row {i})")
            continue
        if pe < ps:
            out.append(f"schema: period_end before period_start at {ps}")
            continue
        tag = f"{ps.isoformat()}"
        if f == "M":
            if (ps, pe) != timeutil.month_bounds(ps.year, ps.month):
                out.append(f"schema: {tag} is not a calendar month")
        elif f == "Q":
            if ps.month not in (1, 4, 7, 10) or (ps, pe) != timeutil.quarter_bounds_of(ps):
                out.append(f"schema: {tag} is not a calendar quarter")
        elif f == "A":
            if (ps, pe) != timeutil.year_bounds(ps.year):
                out.append(f"schema: {tag} is not a calendar year")
        elif f == "W":
            if (pe - ps).days != 6:
                out.append(f"schema: {tag} is not a 7-day week")
            elif anchor and anchor in _WEEKDAY and pe.weekday() != _WEEKDAY[anchor]:
                out.append(f"schema: week ending {pe} is not a {anchor}")
        elif f == "D":
            if ps != pe:
                out.append(f"schema: daily period {tag} spans more than one day")
            elif timeutil.is_weekend(ps) and not allow_weekend:
                out.append(f"schema: daily observation on a weekend ({tag})")
            # federal holidays are allowed: providers publish on their own calendars
        elif f == "IRREG":
            pass
        else:
            out.append(f"schema: unknown frequency {f!r}")
            break
    return out


def check_numeric(obs: Iterable[RawObs]) -> list[str]:
    out = []
    for o in obs:
        v = o.value
        if v is None:
            continue                                   # explicit NA
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            out.append(f"numeric: non-numeric value at {o.period_start}")
        elif not math.isfinite(float(v)):
            out.append(f"numeric: non-finite value at {o.period_start}")
    return out


def check_duplicates(obs: Iterable[RawObs]) -> list[str]:
    seen: dict = {}
    out = []
    for o in obs:
        k = (o.series_id, o.period_start)
        if k in seen:
            a, b = seen[k], o
            same = (a.period_end == b.period_end and (a.flag or "") == (b.flag or "")
                    and ((a.value is None and b.value is None) or
                         (a.value is not None and b.value is not None and
                          isinstance(a.value, (int, float)) and isinstance(b.value, (int, float)) and
                          float(a.value) == float(b.value))))
            if not same:
                out.append(f"duplicate: period {o.period_start} appears twice with different contents")
        else:
            seen[k] = o
    return out


def check_ordering(obs: Iterable[RawObs], now: Optional[float] = None) -> list[str]:
    today = _today(now)
    out = []
    for o in obs:
        ps, pe = _parse(o.period_start), _parse(o.period_end)
        if ps is None or pe is None:
            continue
        if ps > today:
            out.append(f"ordering: period {ps} starts after the fetch time")
        elif pe > today + FUTURE_GRACE:
            out.append(f"ordering: period {ps} ends in the future ({pe})")
    return out


# ─────────────────────────── store-relative checks ───────────────────────────


def _stored(store, sid: str) -> dict:
    """{period_start: LatestRow} of the series' current latest vintages."""
    if store is None:
        return {}
    return {r.period_start: r for r in store.latest_rows(sid)}


def check_scale(spec, obs: list[RawObs], stored: dict) -> list[str]:
    """Magnitude vs what we already hold: a $M-vs-$bn slip is a 1000x jump.
    Overlapping periods compare like-for-like; otherwise the payload's newest
    12 values vs the stored newest 12 (medians of |v|)."""
    vals = {o.period_start: float(o.value) for o in obs
            if isinstance(o.value, (int, float)) and not isinstance(o.value, bool) and math.isfinite(o.value)}
    sto = {p: float(r.value) for p, r in stored.items() if r.value is not None}
    if not vals or not sto:
        return []
    common = sorted(set(vals) & set(sto))
    if common:
        a = [abs(vals[p]) for p in common[-24:]]
        b = [abs(sto[p]) for p in common[-24:]]
    else:
        a = [abs(vals[p]) for p in sorted(vals)[-12:]]
        b = [abs(sto[p]) for p in sorted(sto)[-12:]]
    ma, mb = statistics.median(a), statistics.median(b)
    if ma == 0 or mb == 0:
        return []
    r = ma / mb
    lo, hi = SCALE_BAND
    if r < lo or r > hi:
        units = _g(_g(spec, "units", {}), "raw", "") or ""
        return [f"scale: payload magnitude is {r:.4g}x the stored series"
                + (f" (units {str(units)[:40]!r})" if units else "") + " -- units/scale slip?"]
    return []


def check_mutation(spec, obs: list[RawObs], stored: dict) -> list[str]:
    """A value change to a period OLDER than the series' revision window."""
    rt = _rev_type(spec)
    if rt not in REVISION_WINDOW:
        return [f"mutation: unknown revision.type {rt!r} (cannot bound history changes)"]
    window = REVISION_WINDOW[rt]
    if window is None or not stored:
        return []
    order = sorted(set(stored) | {o.period_start for o in obs})
    newest = order[-1]
    pos = {p: i for i, p in enumerate(order)}
    changed = []
    for o in obs:
        r = stored.get(o.period_start)
        if r is None or _same(r.value, o.value if isinstance(o.value, (int, float)) else None):
            continue
        kind, n = window
        if kind == "periods":
            inside = (len(order) - 1 - pos[o.period_start]) < n
        else:
            nd = timeutil.as_date(newest)
            try:
                cut = nd.replace(year=nd.year - n)
            except ValueError:                       # Feb 29
                cut = nd.replace(year=nd.year - n, day=28)
            inside = timeutil.as_date(o.period_start) > cut
        if not inside:
            changed.append(o.period_start)
    if changed:
        changed.sort()
        return [f"mutation: {len(changed)} period(s) outside the {rt} revision window changed "
                f"({changed[0]}..{changed[-1]})"]
    return []


def check_partial(obs: list[RawObs], stored: dict, start: Optional[str], end: Optional[str],
                  spec=None, covered_periods: Optional[set] = None) -> list[str]:
    """A HISTORY fetch must cover every period we already hold in its range.

    Exception: a stored NULL of a DAILY series may be absent. Adapters now drop provider
    "no data" (holiday) rows of daily series (fed_ddp ND), so a DB written before that rule
    holds null rows the payload no longer carries; they were never observations."""
    # A history fetch may arrive as SEVERAL payloads for one series (BLS 10/20-year windows, DOL
    # XML history + press PDF): coverage is judged over the UNION of the call's payloads, never
    # per payload, or every window would "omit" the periods the other windows carry.
    have = set(covered_periods) if covered_periods is not None else {o.period_start for o in obs}
    daily = spec is not None and _freq(spec) == "D"
    missing = sorted(p for p, r in stored.items()
                     if (start is None or p >= start) and (end is None or p <= end) and p not in have
                     and not (daily and getattr(r, "value", 0) is None))
    if missing:
        return [f"partial: payload omits {len(missing)} stored period(s) in the requested range "
                f"({missing[0]}..{missing[-1]})"]
    return []


def check_plausibility(obs: list[RawObs], stored: dict, exempt: Optional[set] = None) -> list[str]:
    """|period-over-period change| of a NEW or CHANGED value vs the series' own
    history of changes: beyond 12 sigma -> quarantine."""
    merged = {p: (float(r.value) if r.value is not None else None) for p, r in stored.items()}
    fresh = []
    for o in obs:
        if not isinstance(o.value, (int, float)) or isinstance(o.value, bool) or not math.isfinite(o.value):
            continue
        r = stored.get(o.period_start)
        if r is None or not _same(r.value, o.value):
            fresh.append(o.period_start)
        merged[o.period_start] = float(o.value)
    if not fresh:
        return []
    fresh_set = set(fresh)
    hist = [merged[p] for p in sorted(stored) if merged.get(p) is not None and p not in fresh_set]
    diffs = [b - a for a, b in zip(hist, hist[1:])][-240:]
    if len(diffs) < PLAUSIBILITY_MIN_HISTORY:
        return []
    sd = statistics.pstdev(diffs)
    mu = statistics.fmean(diffs)
    if sd == 0:
        return []
    order = sorted(p for p in merged if merged[p] is not None)
    idx = {p: i for i, p in enumerate(order)}
    bad = []
    for p in fresh:
        i = idx.get(p)
        if not i:
            continue
        d = merged[p] - merged[order[i - 1]]
        z = abs(d - mu) / sd
        if z > PLAUSIBILITY_SIGMA and p not in (exempt or ()):
            bad.append((p, z))
    if bad:
        worst = max(bad, key=lambda x: x[1])
        return [f"plausibility: {len(bad)} change(s) beyond {PLAUSIBILITY_SIGMA:g} sigma "
                f"(worst {worst[0]} at {worst[1]:.1f} sigma) -- quarantined"]
    return []


# ─────────────────────────────── the gate ────────────────────────────────────


def validate_fetch(spec, fetch_result, store, *, now: Optional[float] = None, mode: str = "latest",
                   start: Optional[str] = None, end: Optional[str] = None,
                   requested_ids: Optional[Iterable[str]] = None,
                   covered_periods: Optional[set] = None) -> tuple[list[RawObs], list[str]]:
    """Validate this spec's slice of a FetchResult. Returns (accepted, reasons):
    accepted is EMPTY whenever reasons is non-empty (fail closed).

    mode='history' additionally refuses a payload that omits stored periods in
    [start, end] (None = unbounded on that side); mode='latest' does not.
    requested_ids = every series the request asked for (batch requests);
    defaults to just this spec's symbol.
    """
    sid = _g(spec, "symbol")
    allobs = list(getattr(fetch_result, "observations", None) or [])
    requested = set(requested_ids) if requested_ids is not None else {sid}
    requested.add(sid)
    reasons: list[str] = []
    reasons += check_identity(allobs, requested)
    obs = [o for o in allobs if o.series_id == sid]
    reasons += check_schema(spec, obs)
    reasons += check_numeric(obs)
    reasons += check_duplicates(obs)
    reasons += check_ordering(obs, now)
    if reasons:                       # row-level garbage: don't reason about history with it
        return [], _dedupe(reasons)
    uniq: dict = {}
    for o in obs:
        uniq.setdefault(o.period_start, o)
    obs = [uniq[p] for p in sorted(uniq)]
    stored = _stored(store, sid)
    reasons += check_scale(spec, obs, stored)
    reasons += check_mutation(spec, obs, stored)
    if mode == "history":
        reasons += check_partial(obs, stored, start, end, spec, covered_periods=covered_periods)
    # A registry-declared, evidenced exemption for ONE real historical period (e.g. the Sep-1945
    # war-production collapse in manufacturing payrolls): that period alone skips the sigma
    # rule; every other period of the series is still checked.
    _val = (spec.get("validation") if isinstance(spec, dict) else getattr(spec, "raw", {}).get("validation")) or {}
    _ex = {e.get("period") for e in (_val.get("plausibility_exempt") or []) if isinstance(e, dict) and e.get("evidence")}
    reasons += check_plausibility(obs, stored, exempt=_ex)
    if reasons:
        return [], _dedupe(reasons)
    return obs, []


def severity(reasons: list[str]) -> str:
    """'quarantine' when every reason is a plausibility hold, else 'reject'."""
    if reasons and all(r.startswith("plausibility:") for r in reasons):
        return "quarantine"
    return "reject" if reasons else "ok"


def _dedupe(reasons: list[str], cap: int = 20) -> list[str]:
    out, seen = [], set()
    for r in reasons:
        if r not in seen:
            seen.add(r)
            out.append(r)
    if len(out) > cap:
        out = out[:cap] + [f"... {len(out) - cap} more reason(s)"]
    return out
