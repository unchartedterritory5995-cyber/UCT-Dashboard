"""MD-1 kind `earnings.callThemes` (owner: terminal-data, data wave 4) — the phrases rising across earnings calls.

For one calendar month of indexed earnings calls, the one- to three-word phrases whose share of CALLS rose the most
against the months before it, in the service's two lists (new, rising): the Agent half of the CEOS terminal panel
(app/src/pages/terminal/panels/callThemesModel.js), over the answer behind `GET /api/earnings/call-themes`
(api/services/call_themes.py).

⛔ ONLY THE LISTS THE SERVER ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The scan behind the lists reads every held call
two or three times, so the service never runs it on a request; but the member route's `get_themes` STARTS the one
background build on a server that holds nothing, and again when the held lists are older than its refresh bound. A
turn must not start that, so this adapter never calls `get_themes`. It reads `call_themes.held_themes`, the service's
own read-only accessor (this module's copy, else the stored file, read once): the held answer, or nothing →
`unavailable`, with the reason. provider_calls is always 0. A rail holds `held_themes` to `get_themes` and counts
builds through the real service state, cold and stale.

WHAT A HELD ANSWER CAN SAY, each kept apart:
  * `ok`        the month's two lists, as below; no phrase on either list is a finding, `ok` with a note;
  * `empty`     the call index holds no calls: `unavailable` (a gap on our side, never "no phrase is rising");
  * `thin`      the index holds calls, but no month has enough of them to compare: `unavailable`, with the reason;
  * `no_month`  there is no list for the month asked for: `unavailable`, naming the months that have one.

EVERY NUMBER IS THE SERVICE'S OWN: nothing is counted or ranked here. A row is the service's row: the phrase, how many
of the month's calls say it and from how many companies, the earlier share it is compared with (like for like: the
earlier calls weighted to this month's mix of industries), the rise, and up to three example tickers.
NO TRANSCRIPT TEXT beyond the phrase itself (three words at most), which is what the member route sends.

THE CUT IS STATED: at most `limit` rows of each list asked for, in the list's own order (the service's: most-said
first for new, biggest rise first for rising). The service keeps at most `LIST_CAP` rows a list and says how many
phrases passed (`qualified`), so the note names the rows returned against every phrase that passed.

TIME (MD-1 §3): `as_of` = the date of the newest earnings call the lists were worked out from (`corpus.newest`), as
the start of that Eastern day (a date, not a time; a note says so), the same rule as `earnings.callSearch`. When the
lists were worked out is a computation time: it rides as `data.built_at`. The lists are worked out once a day; a read
older than the service's own refresh bound is `stale` with a note (unknown age is stale: never claimed fresh).
freshness `periodic`.

MODEL-ISOLATED (ADR-005), for the same reason `earnings.callSearch` is: every phrase is taken from third-party
earnings call transcript text whose AI-processing right is unresolved (api/services/provider_licensing_class.py: the
transcripts row is display-only and carries a copyrighted-prose prompt exclusion), the same reason `catalysts.board`'s
stored headlines and `analyst.actions` are isolated. A phrase is shorter than an excerpt, and it is still the
vendor's text, selected and ranked by UCT's own counting. Shown to the member only; the reading capability is
local-only, so a phrase never enters a model request, a replay or a title.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "earnings.callThemes"
SOURCE = "uct-call-themes"
#: which list a member may ask for: the CEOS panel's own keys (callThemesModel.js CALL_THEME_LISTS)
LISTS = ("both", "new", "rising")
LIST_NAMES = ("new", "rising")
DEFAULT_LIMIT = 10                      # the CEOS panel's own count while both lists are on screen (BOTH_ROWS)
MAX_LIMIT = 30                          # the service's own cap per list (call_themes.LIST_CAP), railed equal
#: a row's fields, by the service's own names
ROW_FIELDS = ("phrase", "words", "calls", "pct", "companies", "base_calls", "base_pct", "base_raw_pct", "rise", "ratio",
              "related", "examples")
_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")          # the member route's own pattern
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ET = ZoneInfo("America/New_York")

NOTE_WHAT = ("the one- to three-word phrases whose share of {month}'s earnings calls rose the most against the months "
             "before it: new (near absent before) and rising (said before and clearly more now); a call counts once "
             "however often it says a phrase. Phrases are taken from third-party earnings call transcripts as UCT's "
             "index holds them; UCT's own counting, not a forecast")
NOTE_BASE = ("compared with {calls} earlier calls ({months}), weighted to this month's mix of industries: {matched}% of "
             "this month's calls could be matched to their own industry or sector")
NOTE_BASE_PLAIN = ("compared with {calls} earlier calls ({months}) as a plain comparison: no industry weighting could "
                   "be applied")
NOTE_NO_TEXT = ("no transcript text is returned: a row is a phrase of at most {words} words with its counts and up to "
                "{examples} example tickers")
NOTE_AS_OF = ("as_of is the date of the newest earnings call the lists were worked out from (a date, not a time of "
              "day); UCT worked them out at {at}, once a day after the call index updates")
NOTE_NO_AS_OF = "the held lists do not say which calls they were worked out from, so as_of is not given"
NOTE_STALE = ("these lists were worked out more than {hours} hours ago, so calls indexed since then are not in them")
NOTE_NO_BUILD_TIME = "the held lists carry no usable build time, so their age is unknown"
NOTE_NONE = ("no phrase passed the rules for {month}; that is a finding about the calls the index holds, not a failed "
             "read")
NOTE_CUT = ("showing the first {n} of {total} phrases that passed on the {name} list, in the list's own order; the "
            "weakest are the ones left out")
NOTE_NOT_HELD = ("no call themes are held on this server yet (they are worked out once a day after the call index "
                 "updates), and this read never starts that work; that is not the same as no phrase rising")
NOTE_EMPTY_INDEX = ("no earnings calls are indexed on this server, so there is nothing to compare; that is not the same "
                    "as no phrase rising")
NOTE_THIN = ("the call index holds {calls} earnings calls and no month has enough of them to compare yet; that is not "
             "the same as no phrase rising")
NOTE_NO_MONTH = "there is no list for {month}; the months that have one are {months}"
NOTE_NO_MONTHS = "there is no list for {month}, and no month has one yet"
NOTE_FAILED = "the call themes could not be read"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    month = params.get("month")
    if month is not None and (not isinstance(month, str) or not _MONTH.match(month)):
        return "`month` must be a month as YYYY-MM"
    if params.get("list", "both") not in LISTS:
        return "`list` must be one of " + ", ".join(LISTS)
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    return None


def now_s() -> float:
    return time.time()


def held_answer(month: Optional[str]) -> Optional[dict]:
    """The answer the service already holds for this month, WITHOUT starting a build. None when it holds nothing."""
    from api.services import call_themes as svc
    return svc.held_themes(month)


def _day(v: Any) -> Optional[str]:
    s = str(v or "")[:10]
    if not _ISO_DAY.match(s):
        return None
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return None
    return s


def _count(v: Any) -> Optional[int]:
    return int(v) if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return None
    return float(v)


def _row(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or not str(r.get("phrase") or "").strip() or _count(r.get("calls")) is None:
        return None
    out = {k: r.get(k) for k in ROW_FIELDS}
    out["phrase"] = " ".join(str(r["phrase"]).split())
    for k in ("words", "calls", "companies", "base_calls"):
        out[k] = _count(r.get(k))
    for k in ("pct", "base_pct", "base_raw_pct", "rise", "ratio"):
        out[k] = _num(r.get(k))                              # `ratio` is null when nothing earlier said it: never 0
    out["related"] = [str(x) for x in r.get("related") or [] if isinstance(x, str) and x.strip()]
    out["examples"] = [str(x).strip().upper() for x in r.get("examples") or [] if isinstance(x, str) and x.strip()]
    return out


def read_call_themes(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    asked = params.get("month")
    which = params.get("list", "both")
    limit = params.get("limit", DEFAULT_LIMIT)
    try:
        from api.services import call_themes as svc
        got = held_answer(asked)                            # the held lists, or nothing: never a build
        stale_after = float(svc.STALE_REBUILD_S)
        max_words, max_examples = int(svc.MAX_WORDS), int(svc.EXAMPLES)
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never "no phrase is rising"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if got is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    if not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    status = got.get("status")
    corpus = got.get("corpus") if isinstance(got.get("corpus"), dict) else {}
    months = [str(m) for m in got.get("months") or [] if isinstance(m, str) and _MONTH.match(m)]
    if status == "empty":
        return env.unavailable(KIND, params, SOURCE, NOTE_EMPTY_INDEX)
    if status == "thin":
        return env.unavailable(KIND, params, SOURCE, NOTE_THIN.format(calls=_count(corpus.get("calls")) or 0))
    if status == "no_month":
        month = str(got.get("month") or asked or "that month")
        return env.unavailable(KIND, params, SOURCE, NOTE_NO_MONTH.format(month=month, months=", ".join(months))
                               if months else NOTE_NO_MONTHS.format(month=month))
    month = got.get("month")
    if status != "ok" or not isinstance(month, str) or not _MONTH.match(month) \
            or not all(isinstance(got.get(name), list) for name in LIST_NAMES):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    names = LIST_NAMES if which == "both" else (which,)
    qualified_in = got.get("qualified") if isinstance(got.get("qualified"), dict) else {}
    lists, qualified, shown = {}, {}, {}
    for name in LIST_NAMES:
        rows = [x for x in (_row(r) for r in got[name]) if x]
        qualified[name] = max(_count(qualified_in.get(name)) or 0, len(rows))
        lists[name] = rows[:limit] if name in names else []
        shown[name] = len(lists[name])

    base = got.get("baseline") if isinstance(got.get("baseline"), dict) else {}
    base_months = [str(m) for m in base.get("months") or [] if isinstance(m, str) and _MONTH.match(m)]
    matched = _num(base.get("matched_pct"))
    notes = [NOTE_WHAT.format(month=month)]
    base_words = dict(calls=_count(base.get("calls")) or 0, months=", ".join(base_months) or "months not given")
    notes.append(NOTE_BASE.format(matched=f"{matched:g}", **base_words) if matched else NOTE_BASE_PLAIN.format(**base_words))
    notes.append(NOTE_NO_TEXT.format(words=max_words, examples=max_examples))

    built_at = None
    age = None
    try:
        built = datetime.strptime(str(got.get("built_at")), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        built_at = env.utc_iso(built)
        age = now_s() - built.timestamp()
    except (TypeError, ValueError):
        pass
    newest = _day(corpus.get("newest"))
    if newest:
        y, m, d = (int(p) for p in newest.split("-"))
        as_of = env.utc_iso(datetime(y, m, d, tzinfo=_ET))
        notes.append(NOTE_AS_OF.format(at=built_at or "a time not given"))
    else:
        as_of = None
        notes.append(NOTE_NO_AS_OF)
    # unknown is never claimed fresh: lists with no usable build time are stale
    stale = age is None or age > stale_after
    if age is None:
        notes.append(NOTE_NO_BUILD_TIME)
    elif stale:
        notes.append(NOTE_STALE.format(hours=int(stale_after // 3600)))
    if not any(qualified[name] for name in names):
        notes.append(NOTE_NONE.format(month=month))
    for name in names:
        if qualified[name] > shown[name]:
            notes.append(NOTE_CUT.format(n=shown[name], total=qualified[name], name=name))

    floor = got.get("floor") if isinstance(got.get("floor"), dict) else {}
    rules = got.get("rules") if isinstance(got.get("rules"), dict) else {}
    # `month` / `months` / `calls` / `companies` / `baseline` / `floor` / `new` / `rising` / `qualified` / `built_at` /
    # `corpus` / `rules` keep the route's own names (the CEOS panel's model reads them)
    data = {"month": month, "months": months, "list": which, "calls": _count(got.get("calls")),
            "companies": _count(got.get("companies")),
            "baseline": {"months": base_months, "calls": _count(base.get("calls")), "matched_pct": matched},
            "floor": {"calls": _count(floor.get("calls")), "companies": _count(floor.get("companies"))},
            "new": lists["new"], "rising": lists["rising"], "qualified": qualified, "shown": shown,
            "built_at": built_at, "refreshing": got.get("refreshing") is True,
            "corpus": {"calls": _count(corpus.get("calls")), "oldest": _day(corpus.get("oldest")), "newest": newest},
            "rules": {str(k): _num(v) for k, v in rules.items()}}
    total = sum(qualified[name] for name in names)
    answered = sum(shown[name] for name in names)
    coverage = {"evaluated": total, "answered": answered, "dropped": total - answered, "not_computable": 0}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=as_of, source=SOURCE, data=data,
                             stale=stale, coverage=coverage, notes=notes, provider_calls=0)
