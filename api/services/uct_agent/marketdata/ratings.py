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
* `provider_calls`: 0 since v1.18 (terminal data wave 12). Until then this adapter called `get_ratings`, which on a
  cache miss BUILDS the rating (three vendor reads on the caller's thread) and was counted 3 per read. It now reads
  ONLY what the server already holds, through `research.ratings_held.held_ratings` (the same cache entry
  `get_ratings` answers from, never a build): nothing held is `unavailable` ("not held"), a fund is `unavailable`
  with the RTG route's own reason. Narrowed by the wave 12 builder so the first capability over this kind
  (`stock.uctRating`, local-only) adds no vendor read to a turn; not an owner decision (MD-1 §4.4, §9 v1.18).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

SOURCE = "uct-ratings"
PROVIDER_CALLS = 0          # a held read never asks a vendor (v1.18; was 3 while the adapter could build)
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
NOTE_NOT_HELD = ("{symbol}'s UCT Rating is not held on this server yet, and this read never works it out. That is not "
                 "the same as no rating. Open RTG for {symbol} in UCT, then ask again")
NOTE_FUND = "{reason}, so no UCT Rating is stated. That is not the same as a low rating"
NOTE_FAILED = "the UCT Rating read failed; nothing is stated. That is not the same as no rating"


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


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: (the route's own record, 'held' | 'fund' | 'not_held'), WITHOUT building it
    (`research.ratings_held.held_ratings`)."""
    from api.services.research import ratings_held
    return ratings_held.held_ratings(sym)


def read_ratings(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    kind = "ratings"
    why = validate(params)
    if why:
        return env.unavailable(kind, params, SOURCE, why)
    sym = str(params["symbol"]).strip().upper()

    try:
        r, how = held_answer(sym)
    except Exception:  # noqa: BLE001 — a failed read is said, never an empty record
        return env.unavailable(kind, params, SOURCE, NOTE_FAILED)
    if how == "fund":
        reason = r.get("reason") if isinstance(r, dict) and isinstance(r.get("reason"), str) else f"{sym} is a fund"
        return env.unavailable(kind, params, SOURCE, NOTE_FUND.format(reason=reason))
    if how != "held":
        return env.unavailable(kind, params, SOURCE, NOTE_NOT_HELD.format(symbol=sym))
    if not isinstance(r, dict) or _num(r.get("composite")) is None:
        return env.unavailable(kind, params, SOURCE, f"no UCT Rating is available for {sym}", PROVIDER_CALLS)

    notes = [NOTE_UCT_DERIVED, NOTE_UNDATED_LEGS]
    price_as_of = r.get("price_as_of")
    price_as_of = price_as_of[:10] if isinstance(price_as_of, str) and _DATE_RE.match(price_as_of[:10]) else None
    from api.services.uct_agent.marketdata.sessions import last_completed_session
    latest = last_completed_session()          # half days count from their own close (agent-qa F-23)
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
