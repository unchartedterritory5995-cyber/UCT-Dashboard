"""MD-1 kind `levels.darkpool` (owner: terminal-data, data wave 1) — one stock's dark pool price levels.

A thin adapter over `services/signature/darkpool_levels.fetch_dp_levels(sym)` (the read behind
`GET /api/signature/darkpool-levels`): UCT clusters the stock's CONFIRMED dark pool prints over the last
`rules.DPL_WINDOW_DAYS` sessions into price zones and keeps the top `rules.DPL_TOP_K` by dollar value. A local
SQLite read (the nightly-confirmed print ledger); no provider call, no write.

A FAILURE IS NEVER "NO LEVELS"
  * the service raising, or a payload with `levels: null` / an `error` → `unavailable`;
  * an empty `levels` list with no error is a healthy answer (no cluster reached the floor): `ok`, with a note.

TIME (MD-1 §3; this is the "trustworthy as_of" MD-1 §4.4 deferred `darkpool` for)
  * The payload's `asOf` is epoch seconds of the BUILD (a computation time), so it is never `as_of`; it rides as
    `data.computed_at`.
  * `as_of` = the newest confirmed print date among the returned levels (`lastDate`), as that session's close. When
    no level carries a full date, `as_of` is null with a note. Every read is `historical` (completed sessions only);
    the kind is DECLARED `periodic` (recomputed as the nightly ledger grows), the less fresh read being allowed.
  * Whether the ledger itself is up to date is NOT checked here (a quiet stock is not a stale ledger); a note says so.

MODEL-ISOLATED (ADR-005): the levels are computed by UCT (its own bin width, dollar floor and ranking) from vendor
prints. A UCT-derived value, shown to the member only. Gamma walls (`/api/signature/gex-walls`) are a separate kind
since data wave 3: `levels.gamma` (gamma_levels.py), which reads only what the route already holds, never a build.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

KIND = "levels.darkpool"
SOURCE = "uct-darkpool-levels"
LEVEL_FIELDS = ("price", "notional", "printCount", "lastDate", "lo", "hi", "rank")
#: the member route's own symbol rule (api/routers/signature.py `_SYM_RE`), railed equal in the tests
SYMBOL_RE = re.compile(r"^[A-Za-z][A-Za-z.\-]{0,9}$")
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NOTE_FAILED = "dark pool levels could not be read for {sym}"
NOTE_WHAT = ("price zones where confirmed dark pool prints bunched up over the last {days} sessions, the top {k} by "
             "dollar value, each ${floor:,.0f} or more; computed by UCT from the nightly-confirmed print ledger, "
             "never intraday")
NOTE_NONE = "no dark pool cluster reached the floor for {sym} in this window; that is not a failed read"
NOTE_AS_OF = "as_of is the newest confirmed print date among these levels, as that session's close"
NOTE_NO_DATE = "the levels carry no full print date, so as_of is not given"
NOTE_LEDGER = "whether the print ledger itself is up to date is not checked by this read"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    sym = params.get("symbol")
    if not isinstance(sym, str) or not SYMBOL_RE.match(sym.strip()):
        return "`symbol` must be one ticker (letters, dots and dashes, starting with a letter)"
    return None


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v else None


def read_darkpool_levels(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = params["symbol"].strip().upper()
    from api.services.signature import darkpool_levels as svc
    from api.services.signature import rules
    try:
        payload = svc.fetch_dp_levels(sym)
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never "no levels"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(sym=sym))
    if not isinstance(payload, dict) or payload.get("error") or not isinstance(payload.get("levels"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(sym=sym))

    levels = []
    for lv in payload["levels"]:
        if not isinstance(lv, dict) or _num(lv.get("price")) is None:
            continue
        levels.append({**{k: lv.get(k) for k in LEVEL_FIELDS}, "price": _num(lv["price"])})
    built = _num(payload.get("asOf"))
    computed_at = env.utc_iso(datetime.fromtimestamp(built, tz=timezone.utc)) if built and built > 0 else None
    notes = [NOTE_WHAT.format(days=rules.DPL_WINDOW_DAYS, k=rules.DPL_TOP_K, floor=rules.DPL_MIN_CLUSTER_NOTIONAL)]
    days = sorted(str(lv["lastDate"]) for lv in levels if _ISO_DAY.match(str(lv.get("lastDate") or "")))
    as_of = None
    if not levels:
        notes.append(NOTE_NONE.format(sym=sym))
    elif days:
        from api.services.uct_agent.marketdata.themes import _session_close_utc
        as_of = _session_close_utc(int(days[-1].replace("-", "")))
        notes.append(NOTE_AS_OF)
    else:
        notes.append(NOTE_NO_DATE)
    notes.append(NOTE_LEDGER)
    # `sym` / `levels` / `windowDays` / `datesCovered` / `asOf` keep the route's own names: the LVL panel's pure
    # helper (levelsModel.js darkPoolRead) reads them
    data = {"sym": sym, "levels": levels, "windowDays": payload.get("windowDays"),
            "datesCovered": payload.get("datesCovered"), "version": payload.get("version"), "asOf": built,
            "computed_at": computed_at, "newest_print_date": days[-1] if days else None}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=as_of, source=SOURCE, data=data,
                             stale=False, notes=notes, provider_calls=0)
