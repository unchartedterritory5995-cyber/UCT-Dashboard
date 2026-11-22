"""EVST, "What happened next": a member builds one historical event study of their own.

    "Every time <condition on a series>, what did <symbol> do afterwards?"

THE ENGINE IS THE EXISTING ONE. `api/services/market_intel/event_study.py` aligns, detects the
episodes and does the arithmetic; `series_adapters.py` turns each condition series into rows;
`price_reads` reads the outcome closes. Nothing here computes a return. This module only:

  * offers the series a member can pick, grouped by category, built from the adapters' own static
    metadata (`series_adapters.describe`, `research_catalog`) and never a data value (`catalog()`);
  * turns the panel's query words into the engine's request and judges it with the engine's own
    `event_study.validate`, the very call the UCT Agent's adapter makes
    (`uct_agent/marketdata/history_event_study.validate`), with this route's server-side scope
    `MEMBER_KINDS` in place of the Agent's technical-only one (`parse()`);
  * holds each study's answer per spec and per evening and builds it on ONE background thread
    (`get_study()`), shaped for the panel (`shape()`).

WHICH SERIES ARE WIRED. `MEMBER_KINDS`: market breadth (`breadth_reads.sealed_series`, finalized end
of day), technical indicators over UCT's stored daily closes (`indicator_compute`) and CFTC COT
positioning (the local cot.db, each weekly report dated by its public day). The three other adapter
kinds are NOT offered, each refused by its own adapter on this server: economic releases and market
cap read their history from cloud storage, which the research path may not read
(`econ_source_not_local`, `marketcap_source_not_local`), and no fundamental metric is cleared as a
condition (`formula_eligible`). `NOT_OFFERED` says so in words.

⛔ LOCAL ONLY. A result carries licensed prices and UCT-computed series values. It is answered to the
signed-in member and to nothing else: no model, no log line with a value, no agent kind (the UCT
Agent's `history.eventStudy` is untouched and keeps its own scope).

HOW OFTEN AND HOW MUCH (builder rule 5, `held_build.HeldBuild` through `held_reads.KeyedHeld`):
a request never computes. It gets the answer held for its spec and evening, else waits up to
`WAIT_S` on the one build it started, else is told `computing` and the panel asks again. A spec's
answer is keyed on the evening it was built for (`market_history.evening_key`: the newest session
whose evening, 20:15 New York time, has begun) and the study ends on that session (`end`), so an
event is never a session that has not closed; the next evening's request builds afresh.

BOUNDS (each one is the builder's, not an owner ruling; the engine's own bounds stand under them):
  * one condition (no combined conditions), one of four condition kinds, at most `MAX_HORIZONS` (4,
    the Agent adapter's `MAX_HORIZONS`) windows from a fixed menu of `HORIZONS` (1 session to 24
    months, inside the engine's 504 sessions / 24 months);
  * the engine computes on its own pool of 2 workers (`event_study._pool`), so at most two studies
    use a core at once whatever the number of members; at most `MAX_INFLIGHT` builds are queued or
    running, past which a request is told `busy`; a build waits at most `BUILD_DEADLINE_S` for the
    engine;
  * at most `MAX_HELD` answers are held (the least recently asked is let go); each lists at most the
    engine's `MAX_EVENTS_LISTED` (60) newest episodes.
MEASURED (2026-11-22, invented closes through the real engine on the dev PC, not production; the
heaviest study the form can ask for: every session since the shared calendar starts in 2000 an episode,
`all`, four windows up to 24 months, every session as the baseline): 6,662 sessions, 6,661 episodes,
about 0.2 s of CPU for the engine itself (`test_a_heavy_study_stays_inside_its_bound` prints it). The
store reads come on top: MKTH and STAT measured about 0.08 to 0.13 s of CPU per 6,000-row daily read,
and a technical study reads its symbol's closes for the series and again for the outcome; a breadth
series is read from its cache-first store, and its first cold build can take several seconds (it is
single-flighted by `breadth_symbols`). The shared NYSE calendar covers 2000 to 2028, so no study
reaches before 2000 whatever the store holds.
"""
from __future__ import annotations

import json
import logging
import math
import re
import threading
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Mapping, Optional

from api.services import held_build
from api.services.held_reads import KeyedHeld

_log = logging.getLogger(__name__)

#: The series kinds this route runs (its server-side scope, passed to `event_study.validate`).
MEMBER_KINDS = ("breadth", "technical", "cot")

#: The adapter kinds the engine knows that this route does not offer, each with the reason in words.
NOT_OFFERED = (
    {"kind": "econ", "name": "Economic releases",
     "why": "This server keeps its economic history in cloud storage, and the study engine reads only history stored on the server itself."},
    {"kind": "fundamental", "name": "Company fundamentals",
     "why": "None of the fundamentals metrics is cleared for use as a study condition yet."},
    {"kind": "market_cap", "name": "Market cap",
     "why": "Market cap history is not published on this server yet."},
)

CATEGORY_NAMES = {"breadth": "Market breadth", "technical": "Technical indicators", "cot": "Futures positioning (COT)"}

#: The windows a member can pick: token -> (the engine's horizon, its plain name). Fixed, so the work is bounded.
HORIZONS = {
    "1d": ({"sessions": 1}, "1 session"),
    "1w": ({"sessions": 5}, "1 week (5 sessions)"),
    "2w": ({"sessions": 10}, "2 weeks (10 sessions)"),
    "1mo": ({"months": 1}, "1 month"),
    "3mo": ({"months": 3}, "3 months"),
    "6mo": ({"months": 6}, "6 months"),
    "12mo": ({"months": 12}, "12 months"),
    "24mo": ({"months": 24}, "24 months"),
}
DEFAULT_HORIZONS = ("1mo", "3mo", "6mo")
MAX_HORIZONS = 4                 # the Agent adapter's own MAX_HORIZONS (history_event_study.MAX_HORIZONS)
OPS = ("below", "above", "cross_below", "cross_above")
OP_WORDS = {"below": "below", "above": "above", "cross_below": "crosses below", "cross_above": "crosses above"}
EPISODES = ("first", "all")
ENTRIES = ("event_close", "next_close")
MAX_THRESHOLD = 1e12
#: A technical indicator's period when the member has not set one (the builder's defaults, the common ones).
DEFAULT_PERIODS = {"rsi": 14, "pct_from_sma": 50, "bb_pct_b": 20, "pct_from_high": 252}

WAIT_S = 3.0                     # the longest a request waits on the build it started
BUILD_DEADLINE_S = 30.0          # the longest a build waits for the engine (its pool may be busy)
MAX_INFLIGHT = 6                 # builds queued or running at once, for every member together
BUSY_HOLD_S = 5.0                # a refused-for-busy spec is said `busy` this long, then tried again
MAX_HELD = 128                   # answers held (one per spec per evening)
RETRY_S = 60.0                   # a study whose series could not be read just now is tried again after this
#: Engine reasons that say "not just now" rather than "not for this study": never held as the evening's answer.
TRANSIENT = frozenset({"warming", "failed", "read_failed", "not_finalized", "not_populated", "universe_not_enabled"})

SOURCE = "UCT's stored daily closes (split-adjusted, price only) and the condition series named"

_lock = threading.Lock()
_inflight = 0


def _sentence(text: str) -> str:
    text = (text or "").strip()
    return text if not text or text.endswith(".") else text + "."


# ── the menu (value-free, read once per process) ─────────────────────────────────────────────

def _tech_name(template: str) -> str:
    """The adapter's own label template without the symbol and with N for the period."""
    name = template.replace("{sym} ", "").replace("({n})", "").replace("{n}", "N").strip()
    return name[:1].upper() + name[1:]


@lru_cache(maxsize=1)
def catalog() -> dict:
    """The series a member can pick, grouped by category, from the adapters' own static metadata.
    Never a data value: labels, units, domains, period bounds and the reasons a kind is not offered."""
    from api.services import breadth_universes as _bu
    from api.services import cot_service as _cot
    from api.services.market_intel import series_adapters as _sa

    menu = _sa.research_catalog()
    universes = list(menu["breadth"]["fields"]["universe"])
    metrics = []
    for m in menu["breadth"]["fields"]["metric"]:
        meta, err = _sa.describe({"kind": "breadth", "universe": universes[0], "metric": m})
        if err or not meta:
            continue
        metrics.append({"metric": m, "name": meta["label"].split(" · ", 1)[-1], "unit": meta["unit"], "domain": meta["domain"]})
    breadth = {"kind": "breadth", "name": CATEGORY_NAMES["breadth"], "alignment": "session",
               "universes": [{"universe": u, "name": _bu.label(u)} for u in universes], "metrics": metrics}

    indicators = []
    periods = menu["technical"]["fields"]["period"]
    for ind in menu["technical"]["fields"]["indicator"]:
        bounds = periods.get(ind)
        default = DEFAULT_PERIODS.get(ind) if bounds else None
        meta, err = _sa.describe({"kind": "technical", "symbol": "SPY", "indicator": ind,
                                  **({"period": default} if bounds else {})})
        if err or not meta:
            continue
        indicators.append({"indicator": ind, "name": _tech_name(_sa._TECH[ind][0]), "unit": meta["unit"],
                           "domain": meta["domain"],
                           "period": {"min": bounds[0], "max": bounds[1], "default": default} if bounds else None})
    technical = {"kind": "technical", "name": CATEGORY_NAMES["technical"], "alignment": "session",
                 "indicators": indicators}

    groups = []
    for g in menu["cot"]["fields"]["group"]:
        meta, err = _sa.describe({"kind": "cot", "market": "ES", "group": g})
        if err or not meta:
            continue
        groups.append({"group": g, "name": meta["label"].split(" · ", 1)[-1].replace(" (net contracts)", "")})
    markets = []
    for sym in menu["cot"]["fields"]["market"]:
        meta, err = _sa.describe({"kind": "cot", "market": sym, "group": "large_spec"})
        if err or not meta:
            continue
        markets.append({"market": sym, "name": _cot.SYMBOL_NAMES.get(sym, sym)})
    markets.sort(key=lambda m: m["name"].lower())
    cot = {"kind": "cot", "name": CATEGORY_NAMES["cot"], "alignment": "as_of", "unit": "count", "domain": "signed",
           "markets": markets, "groups": groups}

    return {
        "status": "ok",
        "categories": [breadth, technical, cot],
        "not_offered": [dict(x) for x in NOT_OFFERED],
        "ops": [{"op": o, "name": OP_WORDS[o]} for o in OPS],
        "horizons": [{"token": t, "name": name} for t, (_h, name) in HORIZONS.items()],
        "max_horizons": MAX_HORIZONS,
        "defaults": {"symbol": "SPY", "horizons": list(DEFAULT_HORIZONS), "episodes": "first", "entry": "event_close"},
        "examples": [dict(e, spec=dict(e["spec"])) for e in EXAMPLES],
    }


#: Ready-made studies, one click away, built only from the series this route serves (a test runs
#: each through `parse` and the engine's `validate`). Their wording and choice are the builder's.
EXAMPLES = (
    {"id": "nasdaq-washout",
     "name": "Fewer than 10% of Nasdaq stocks above their 50-day average: QQQ over 1, 3 and 6 months",
     "spec": {"kind": "breadth", "universe": "nasdaq", "metric": "pct_above_50sma", "op": "below", "threshold": "10",
              "symbol": "QQQ", "horizons": "1mo,3mo,6mo", "episodes": "first", "entry": "event_close"}},
    {"id": "spy-3pct-drop",
     "name": "SPY falls 3% or more in a day: SPY over 1 week, 1 month and 3 months",
     "spec": {"kind": "technical", "series": "SPY", "indicator": "day_pct", "op": "below", "threshold": "-3",
              "symbol": "SPY", "horizons": "1w,1mo,3mo", "episodes": "first", "entry": "event_close"}},
    {"id": "gold-specs-short",
     "name": "Large speculators turn net short gold futures: GLD over 1, 3 and 6 months",
     "spec": {"kind": "cot", "market": "GC", "group": "large_spec", "op": "cross_below", "threshold": "0",
              "symbol": "GLD", "horizons": "1mo,3mo,6mo", "episodes": "first", "entry": "event_close"}},
)


# ── the request (pure: reads nothing) ────────────────────────────────────────────────────────

def _word(params: Mapping[str, Any], key: str) -> str:
    v = params.get(key)
    return "" if v is None else str(v).strip()


def _symbol(raw: str) -> Optional[str]:
    from api.services.market_intel import price_reads as _pr
    return _pr.normalize_symbol(raw)


#: The engine's refusals said in this route's words: always for these reasons...
_PLAIN = {
    "unsupported_universe": "Breadth studies cover US, NYSE and Nasdaq stocks only.",
    "kind_not_enabled": "Studies here use market breadth, technical indicators or futures positioning (COT).",
    "bad_threshold": "That threshold is not a possible value for this measure (a share of stocks is 0 to 100, a count is 0 or more).",
    "bad_symbol": "Name the ticker to measure afterwards with letters and digits only (for example SPY).",
}
#: ...and for these only when the engine's own sentence names its internal words (an enum list).
_PLAIN_FALLBACK = {
    "unknown_metric": "That breadth measure is not available for studies.",
    "unknown_series": "That series is not available for studies.",
    "unknown_indicator": "That technical indicator is not available for studies.",
    "bad_period": "The period is a whole number of sessions within the indicator's range.",
}


def _refusal_text(err: dict) -> str:
    reason, detail = err.get("reason"), err.get("detail")
    if reason in _PLAIN:
        return _PLAIN[reason]
    if isinstance(detail, str) and detail.strip() and not re.search(r"[_|{}`]", detail):
        return detail
    return _PLAIN_FALLBACK.get(reason) or "That study could not be read."


def parse(params: Mapping[str, Any]) -> tuple[Optional[dict], Optional[str]]:
    """`(study, None)` or `(None, a plain sentence)`. `study` is `{"spec": the canonical words,
    "request": the engine's request}`; the request has passed the engine's own `validate` under
    `MEMBER_KINDS`. Shape only: no store is read."""
    from api.services.market_intel import event_study as _es

    kind = _word(params, "kind").lower()
    if kind not in MEMBER_KINDS:
        return None, "Pick the kind of series first: market breadth, a technical indicator or futures positioning (COT)."
    spec: dict[str, Any] = {"kind": kind}
    if kind == "breadth":
        spec["universe"] = _word(params, "universe").lower()
        spec["metric"] = _word(params, "metric").lower()
        series = {"kind": "breadth", "universe": spec["universe"], "metric": spec["metric"]}
    elif kind == "technical":
        sym = _symbol(_word(params, "series"))
        if not sym:
            return None, "Name the ticker whose indicator is measured (for example SPY)."
        spec["series"] = sym
        spec["indicator"] = _word(params, "indicator").lower()
        series = {"kind": "technical", "symbol": sym, "indicator": spec["indicator"]}
        period = _word(params, "period")
        if period:
            if not period.isdigit() or len(period) > 4:
                return None, "The period is a whole number of sessions."
            spec["period"] = int(period)
            series["period"] = int(period)
    else:
        spec["market"] = _word(params, "market").upper()
        spec["group"] = _word(params, "group").lower()
        series = {"kind": "cot", "market": spec["market"], "group": spec["group"]}

    op = _word(params, "op").lower()
    if op not in OPS:
        return None, "Pick a condition: below, above, crosses below or crosses above."
    raw_thr = _word(params, "threshold")
    try:
        thr = float(raw_thr) if raw_thr else None
    except ValueError:
        thr = None
    if thr is None or not math.isfinite(thr) or abs(thr) > MAX_THRESHOLD:
        return None, "Type the threshold as a number (for example 10 or -3)."
    thr = float(f"{thr:.6g}")

    sym = _symbol(_word(params, "symbol"))
    if not sym:
        return None, _PLAIN["bad_symbol"]

    tokens: list[str] = []
    for t in (_word(params, "horizons") or ",".join(DEFAULT_HORIZONS)).lower().split(","):
        t = t.strip()
        if not t:
            continue
        if t not in HORIZONS:
            return None, "A window is one of 1 session, 1 week, 2 weeks, 1, 3, 6, 12 or 24 months."
        if t not in tokens:
            tokens.append(t)
    if not tokens:
        return None, "Pick at least one window to measure."
    if len(tokens) > MAX_HORIZONS:
        return None, f"Pick at most {MAX_HORIZONS} windows."
    order = list(HORIZONS)
    tokens.sort(key=order.index)

    episodes = _word(params, "episodes").lower() or "first"
    entry = _word(params, "entry").lower() or "event_close"
    if episodes not in EPISODES:
        return None, "Count each run once (its first session) or every session that qualifies."
    if entry not in ENTRIES:
        return None, "Measure from the close of the event session or from the next session's close."

    request = {"condition": {"series": series, "op": op, "threshold": thr}, "symbol": sym,
               "horizons": [dict(HORIZONS[t][0]) for t in tokens], "episodes": episodes, "entry": entry,
               "non_overlapping": False, "baseline": True}
    _ok, err = _es.validate(request, allowed_kinds=MEMBER_KINDS)
    if err:
        return None, _sentence(_refusal_text(err))
    spec.update({"op": op, "threshold": thr, "symbol": sym, "horizons": tokens, "episodes": episodes, "entry": entry})
    return {"spec": spec, "request": request}, None


def spec_key(spec: dict) -> str:
    return json.dumps(spec, sort_keys=True, separators=(",", ":"))


# ── the answer for the panel ─────────────────────────────────────────────────────────────────

def _token_of(h: dict) -> Optional[str]:
    for t, (eh, _name) in HORIZONS.items():
        if eh == h:
            return t
    return None


def _finite(v) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def _method_lines(method: dict, spec: dict) -> list[str]:
    """The engine's own `method` in plain words: one line per rule the study used."""
    lines = []
    horizons = spec.get("horizons") or []
    if str(spec.get("op") or "").startswith("cross_"):
        lines.append("Episodes: every session on which the series crossed the threshold (the session before on the "
                     "other side); both sessions need a known value.")
    elif method.get("episodes") == "all":
        lines.append("Episodes: every session on which the condition held.")
    else:
        lines.append("Episodes: the first session of each run of sessions on which the condition held; a session with "
                     "no known value ends a run.")
    if method.get("entry") == "next_close":
        lines.append("Entry: the close of the next trading session (nothing is known before it).")
    else:
        lines.append("Entry: the close of the event session (the condition is known at that close).")
    lines.append(f"Return: {method.get('return') or 'price return'}.")
    if any(HORIZONS[t][0].get("sessions") for t in horizons):
        lines.append(f"Windows in sessions: {method.get('sessions') or 'NYSE trading sessions after entry'}.")
    if any(HORIZONS[t][0].get("months") for t in horizons):
        lines.append(f"Windows in months: {method.get('months') or 'the first trading session on or after entry plus N months'}.")
    lines.append(f"Left out: {method.get('excluded') or 'windows that have not ended'}.")
    lines.append("All sessions: the same windows from every trading session in the same span, for comparison.")
    return lines


def shape(res: dict, spec: dict, key: str) -> dict:
    """The engine's result (`event_study.run`) as the panel reads it. A refusal or an unavailable
    study keeps its reason and the engine's sentence; nothing is invented."""
    from api.services.market_intel import event_study_answer as _ans
    built_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if not isinstance(res, dict) or res.get("status") != "ok":
        r = res if isinstance(res, dict) else {}
        reason = r.get("reason") or "failed"
        # the engine's own sentence for this study, else the house wording of its reason (event_study_answer)
        detail = r.get("detail") if isinstance(r.get("detail"), str) and r.get("detail").strip() else _ans.answer(r).get("text")
        return {"status": "unavailable", "reason": reason, "detail": _sentence(detail),
                "spec": spec, "session": key, "built_at": built_at}
    hz_out = []
    for h in res.get("horizons") or []:
        tok = _token_of(h.get("horizon") or {})
        row = {"token": tok, "label": h.get("label"), "n": int(h.get("n") or 0),
               "incomplete": int(h.get("incomplete") or 0), "missing_price": int(h.get("missing_price") or 0)}
        if row["n"]:
            row.update({"positive": int(h.get("positive") or 0), "positive_rate": _finite(h.get("positive_rate")),
                        "mean": _finite(h.get("mean")), "median": _finite(h.get("median")),
                        "best": {k: (h.get("best") or {}).get(k) for k in ("event_date", "exit_date", "return")},
                        "worst": {k: (h.get("worst") or {}).get(k) for k in ("event_date", "exit_date", "return")}})
        hz_out.append(row)
    baseline = None
    if res.get("baseline") is not None:
        baseline = [{"token": _token_of(b.get("horizon") or {}), "label": b.get("label"), "n": int(b.get("n") or 0),
                     "positive_rate": _finite(b.get("positive_rate")), "mean": _finite(b.get("mean")),
                     "median": _finite(b.get("median"))} for b in res["baseline"]]
    events = []
    for e in reversed(res.get("events") or []):
        events.append({"event_date": e.get("event_date"), "entry_date": e.get("entry_date"),
                       "condition_value": _finite(e.get("condition_value")),
                       "returns": [{"token": _token_of(x.get("horizon") or {}), "outcome": x.get("outcome"),
                                    "exit_date": x.get("exit_date"), "return": _finite(x.get("return"))}
                                   for x in e.get("returns") or []]})
    c = res.get("counts") or {}
    req = res.get("request") or {}
    series = (req.get("condition") or {}).get("series") or {}
    return {
        "status": "ok", "spec": spec, "session": key, "built_at": built_at,
        "series": {"label": res.get("series_label"), "category": res.get("series_category"),
                   "unit": res.get("series_unit"), "domain": res.get("series_domain"),
                   "alignment": res.get("alignment"), "description": res.get("series_description"),
                   "kind": series.get("kind")},
        "coverage": dict(res.get("coverage") or {}),
        "counts": {k: c.get(k) for k in ("events_used", "events_detected", "qualifying_sessions", "episodes_or_crossings",
                                         "condition_gaps", "no_entry_price", "entry_after_price_history",
                                         "overlapping_events", "windows_spanning_suspect_jumps")},
        "horizons": hz_out, "baseline": baseline,
        "events": events, "events_truncated": bool(res.get("events_listed_truncated")),
        "notes": [str(n) for n in res.get("notes") or []],
        "caveats": [str(n) for n in _ans.caveats(res)],
        "method": {**dict(res.get("method") or {}), "lines": _method_lines(res.get("method") or {}, spec)},
        "source": SOURCE,
    }


# ── the held answers ─────────────────────────────────────────────────────────────────────────

def now_et():
    from api.services import market_history
    return market_history.now_et()


def session_key(now) -> str:
    from api.services import market_history
    return market_history.evening_key(now)


def _run(request: dict) -> dict:
    """The engine, indirected for tests."""
    from api.services.market_intel import event_study as _es
    return _es.run(request, deadline_s=BUILD_DEADLINE_S, allowed_kinds=MEMBER_KINDS)


def _build_for(key: tuple):
    spec_json, session = key

    def build(_previous: Optional[dict]) -> tuple[dict, str]:
        global _inflight
        with _lock:
            if _inflight >= MAX_INFLIGHT:
                raise held_build.Stop("unavailable", "busy", hold=BUSY_HOLD_S, note="busy: the study queue is full")
            _inflight += 1
        try:
            spec = json.loads(spec_json)
            study, why = parse({**spec, "horizons": ",".join(spec.get("horizons") or ())})
            if why or not study:
                raise held_build.Stop("unavailable", "refused", hold=BUSY_HOLD_S, note="the spec no longer validates")
            request = {**study["request"], "end": session}
            res = _run(request)
            reason = res.get("reason") if isinstance(res, dict) and res.get("status") != "ok" else None
            if reason in TRANSIENT:
                # never held for the evening: said briefly, then a new request builds again
                raise held_build.Stop("unavailable", reason, hold=BUSY_HOLD_S if reason == "warming" else RETRY_S,
                                      note=f"unavailable ({reason})")
            answer = shape(res, study["spec"], session)
            return answer, f"{answer['status']} kind={spec.get('kind')} events={(answer.get('counts') or {}).get('events_used')}"
        finally:
            with _lock:
                _inflight -= 1

    return build


_held = KeyedHeld("event-study", _build_for, lambda answer, checked: False, max_keys=MAX_HELD, wait_s=WAIT_S)

_SAID = {
    "busy": "The server is running other studies. Run this one again in a moment.",
    "warming": "The history is still loading on the server. Run the study again in a moment.",
    "refused": "That study could not be read.",
    "read_failed": "The history could not be read just now. Run the study again in a moment.",
    "not_finalized": "The breadth history cannot confirm which sessions are final right now. Run the study again later.",
    "not_populated": "The breadth history is not filled in on this server yet.",
    "universe_not_enabled": "That breadth universe is not available right now.",
    "error": "The study could not be worked out just now. Run it again in a moment.",
}


def get_study(study: dict, now=None) -> dict:
    """The answer for one parsed study (see the module docstring). Never computes on the caller's thread."""
    session = session_key(now or now_et())
    spec = study["spec"]
    got = _held.get((spec_key(spec), session))
    status = got.get("status")
    if status in ("ok", "unavailable") and got.get("spec") is not None:
        return {k: v for k, v in got.items() if k != "check"}
    if status == "computing":
        return {"status": "computing", "spec": spec, "session": session}
    reason = got.get("reason") or "error"
    return {"status": "busy" if reason in ("busy", "warming", "read_failed", "failed", "error") else "unavailable", "reason": reason,
            "detail": _SAID.get(reason, _SAID["error"]), "spec": spec, "session": session}


def reset_for_tests() -> None:
    global _inflight
    _held.reset()
    with _lock:
        _inflight = 0
