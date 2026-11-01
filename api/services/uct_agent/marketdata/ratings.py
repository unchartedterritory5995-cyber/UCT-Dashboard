"""MD-1 kind `ratings` (owner: agent-md) — contract MD-1 v1.4 §4.4. MODEL-ISOLATED.

UCT Ratings: a UCT-DERIVED composite 0–99 plus component ratings (eps, rs, growth, value, smr, accdis,
sponsorship) and a pass/fail Stock Checkup. It is an adapter over `services/research/ratings.get_ratings`,
the research page's own service. It is NEVER a third-party analyst rating: no vendor badge, and the source
is "uct-ratings".

⛔ MODEL ISOLATION (agent-lead ruling 2026-11-01): UCT-derived, so registered `model_isolated=True`. The gateway
serves it only for purpose "answer" and refuses any other purpose before admission.

* Scale: `composite` and components 1–99, higher is stronger. `method` / `basis` say whether a value is a
  percentile rank against the cap universe (`universe_n` names) or a hand-calibrated absolute band.
* `as_of` = the close of `price_as_of`'s session: the price leg's last bar, the only concrete date the
  service carries. The fundamental and ownership legs are undated, and a note says so.
* freshness `periodic`; `stale` when `price_as_of` predates the last completed session (MD-1 §4: 1 day).
* `complete=False` (an input leg failed) → `partial`, with a note.
* `provider_calls`: 3 per read, one per input leg. The service's cache state is not visible, so this is
  conservative (MD-1 §6.3).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

SOURCE = "uct-ratings"
PROVIDER_CALLS = 3
COMPONENTS = ("eps", "rs", "growth", "value", "smr", "accdis", "sponsorship")
DATA_FIELDS = ("symbol", "composite", "components", "checkup", "method", "basis", "coverage", "universe_n",
               "sector", "group_rs", "price_as_of", "complete")
_ET = ZoneInfo("America/New_York")
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NOTE_UCT_DERIVED = "UCT Ratings are UCT's own computed scores (1–99), not a third-party analyst rating"
NOTE_UNDATED_LEGS = "the fundamental and ownership inputs carry no date; as_of is the price data's last session"
NOTE_INCOMPLETE = "one or more inputs could not be read; the scores are built on what was available"
NOTE_PRICE_BEHIND = "the price data ends {date}, before the last completed session ({session})"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    sym = str(params.get("symbol") or "").strip().upper()
    if not _SYMBOL_RE.match(sym):
        return "a valid ticker symbol is required"
    return None


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _session_close_utc(ymd: int) -> str:
    from api.services import bars_fetch
    s = str(ymd)
    close = datetime(int(s[:4]), int(s[4:6]), int(s[6:]), tzinfo=_ET) + timedelta(
        minutes=bars_fetch._session_close_minutes(ymd))
    return env.utc_iso(close)


def read_ratings(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    kind = "ratings"
    why = validate(params)
    if why:
        return env.unavailable(kind, params, SOURCE, why)
    sym = str(params["symbol"]).strip().upper()

    from api.services import bars_fetch
    from api.services.research import ratings as svc
    r = svc.get_ratings(sym)
    if not isinstance(r, dict) or _num(r.get("composite")) is None:
        return env.unavailable(kind, params, SOURCE, f"no UCT Rating is available for {sym}", PROVIDER_CALLS)

    notes = [NOTE_UCT_DERIVED, NOTE_UNDATED_LEGS]
    price_as_of = r.get("price_as_of")
    price_as_of = price_as_of[:10] if isinstance(price_as_of, str) and _DATE_RE.match(price_as_of[:10]) else None
    latest = bars_fetch._last_closed_session_yyyymmdd()
    if price_as_of:
        ymd = int(price_as_of.replace("-", ""))
        as_of = _session_close_utc(ymd)
        stale = ymd < latest
        if stale:
            s = str(latest)
            notes.append(NOTE_PRICE_BEHIND.format(date=price_as_of, session=f"{s[:4]}-{s[4:6]}-{s[6:]}"))
    else:
        as_of, stale = None, True
        notes.append("the price data carries no date either, so no as_of can be given")
    complete = bool(r.get("complete"))
    if not complete:
        notes.append(NOTE_INCOMPLETE)

    comps = r.get("components") if isinstance(r.get("components"), dict) else {}
    data = {"symbol": sym, "composite": _num(r.get("composite")),
            "components": {c: _num(comps.get(c)) if not isinstance(comps.get(c), str) else comps.get(c)
                           for c in COMPONENTS},
            "checkup": r.get("checkup") if isinstance(r.get("checkup"), list) else [],
            "method": r.get("method"), "basis": r.get("basis"),
            "coverage": r.get("coverage") if isinstance(r.get("coverage"), dict) else None,
            "universe_n": r.get("universe_n"), "sector": r.get("sector"), "group_rs": _num(r.get("group_rs")),
            "price_as_of": price_as_of, "complete": complete}
    return env.make_envelope(kind, params, status="ok" if complete else "partial", freshness="periodic",
                             as_of=as_of, source=SOURCE, data=data, stale=stale, notes=notes,
                             provider_calls=PROVIDER_CALLS)
