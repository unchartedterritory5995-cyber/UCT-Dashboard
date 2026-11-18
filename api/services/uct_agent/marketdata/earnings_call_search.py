"""MD-1 kind `earnings.callSearch` (owner: terminal-data, data wave 2) — search the indexed earnings calls.

Who said a word or a phrase on a recent earnings call: the Agent half of the TSRC terminal panel
(app/src/pages/terminal/panels/callSearchModel.js). A thin adapter over `services/transcript_index.search(...)`, the
read behind `GET /api/earnings/transcript-search`, plus `transcript_index.stats()` for what the index holds. Both are
local SQLite reads of UCT's own full-text index: no provider call, and nothing is built.

AN EMPTY RESULT IS ONLY A FINDING WHEN THE INDEX HOLDS CALLS. A search over an empty index and a word nobody said look
the same on the search read, so `stats()` is read first: an empty index → `unavailable`, never "no call mentions it".
Kept apart the same way:
  * the service raising, or answering `error: "search unavailable"`          → `unavailable` (failed);
  * a query the service could not run as typed (`query_error`, bad syntax)    → `unavailable` (the query);
  * nothing searchable left of the query (`match: null`)                      → `unavailable` (the query);
  * a healthy search with no hit                                              → `ok`, with a note naming what the
    index holds.

THIRD-PARTY TEXT, AND NO MORE OF IT THAN THE MEMBER ROUTE GIVES. A hit's `snippet` is the index's own excerpt (about
28 words around the match, with <mark> around the matched words), returned exactly as the service cut it and never
lengthened; the transcript itself is never returned. At most MAX_LIMIT calls a read (the panel's own count; the route
allows more). There is no speaker field: the index stores a call as one text, so who said it is not known.

TIME (MD-1 §3): `as_of` = the newest indexed call's date, as the start of that Eastern day (a date, not a time; a
note says so). The index keeps recent calls only (`RETENTION_DAYS`). Whether the newest calls have been indexed yet is
not checked here, so `stale` is always false and a note says so. freshness `periodic`.

MODEL-ISOLATED (ADR-005): the excerpts are third-party transcript text whose AI-processing right is unresolved, the
same reason `catalysts.board`'s stored headlines and `analyst.actions` are isolated. Shown to the member only; the
reading capability is local-only, so an excerpt never enters a model request, a replay or a title.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "earnings.callSearch"
SOURCE = "uct-transcript-index"
MIN_QUERY = 2                           # the member route's own floor
MAX_QUERY = 120                         # the TSRC panel's own ceiling
DEFAULT_LIMIT = 10
MAX_LIMIT = 40                          # the TSRC panel's own count (the route allows up to 200)
HIT_FIELDS = ("symbol", "year", "quarter", "date", "snippet", "score")
SYMBOL_RE = re.compile(r"^[A-Za-z][A-Za-z.\-]{0,9}$")
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_WORD = re.compile(r"[^\W_]", re.UNICODE)                 # one letter or digit, in any script
_ET = ZoneInfo("America/New_York")

NOTE_WHAT = ("each hit is one company's earnings call for one fiscal quarter, best match first, with the index's own "
             "short excerpt around the match; third-party transcript text, quoted exactly as indexed. The index "
             "stores a call as one text, so who said it is not known")
NOTE_INDEX = ("the index holds {calls} earnings calls dated {oldest} to {newest}; as_of is the newest indexed call's "
              "date (a date, not a time of day)")
NOTE_INDEX_UNDATED = "the index holds {calls} earnings calls and none carries a usable date, so as_of is not given"
NOTE_UNCHECKED = "whether the most recent calls have been indexed yet is not checked by this read"
NOTE_NONE = ("no indexed call matches; that is a finding about the calls the index holds, not about calls it does "
             "not hold")
NOTE_CUT = "showing the {n} best matches of {total} calls that match"
NOTE_TOTAL_WIDER = ("{total} calls match the words in any form; exact words and quoted phrases were checked only "
                    "for the hits shown, so the total is wider than the hits")
NOTE_EXPANDED = "the search was widened to related words by the search service"
NOTE_EMPTY_INDEX = ("no earnings calls are indexed on this server yet, so nothing can be searched; that is not the "
                    "same as no call mentioning it")
NOTE_BAD_QUERY = "the search could not be run as typed: the search service did not understand the query"
NOTE_NO_WORDS = "nothing searchable was left of the query, so no search was run"
NOTE_FAILED = "the earnings call search could not be read"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    q = params.get("q")
    if not isinstance(q, str) or not MIN_QUERY <= len(q.strip()) <= MAX_QUERY:
        return f"`q` must be a word or a phrase of {MIN_QUERY} to {MAX_QUERY} characters"
    if not _WORD.search(q):
        return "`q` needs at least one letter or number"
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    sym = params.get("symbol")
    if sym is not None and (not isinstance(sym, str) or not SYMBOL_RE.match(sym.strip())):
        return "`symbol` must be one ticker (letters, dots and dashes, starting with a letter)"
    since = params.get("since")
    if since is not None:
        if not isinstance(since, str) or not _ISO_DAY.match(since):
            return "`since` must be a date as YYYY-MM-DD"
        try:
            datetime.strptime(since, "%Y-%m-%d")
        except ValueError:
            return "`since` must be a real calendar date"
    return None


def _day(v: Any) -> Optional[str]:
    s = str(v or "")[:10]
    if not _ISO_DAY.match(s):
        return None
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return None
    return s


def read_call_search(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    q = " ".join(params["q"].split())
    limit = params.get("limit", DEFAULT_LIMIT)
    symbol = params["symbol"].strip().upper() if params.get("symbol") else None
    since = params.get("since")
    try:
        from api.services import transcript_index as ix
        held = ix.stats()
        calls = held.get("transcripts") if isinstance(held, dict) else None
        if not isinstance(calls, int) or isinstance(calls, bool):
            return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
        if calls <= 0:
            return env.unavailable(KIND, params, SOURCE, NOTE_EMPTY_INDEX)
        got = ix.search(q, limit=limit, symbol=symbol, since=since)
    except Exception:  # noqa: BLE001 — a failing index is an honest unavailable, never "nobody said it"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not isinstance(got, dict) or not isinstance(got.get("hits"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if got.get("error"):
        bad = got.get("query_error") is True or "syntax" in str(got.get("error")).lower()
        return env.unavailable(KIND, params, SOURCE, NOTE_BAD_QUERY if bad else NOTE_FAILED)
    if not got.get("match"):
        return env.unavailable(KIND, params, SOURCE, NOTE_NO_WORDS)

    hits = [{k: h.get(k) for k in HIT_FIELDS} for h in got["hits"]
            if isinstance(h, dict) and str(h.get("symbol") or "").strip()][:limit]
    total = got.get("total")
    total = max(total, len(hits)) if isinstance(total, int) and not isinstance(total, bool) else len(hits)
    oldest, newest = _day(held.get("oldest")), _day(held.get("newest"))
    notes = [NOTE_WHAT]
    if newest:
        y, m, d = (int(p) for p in newest.split("-"))
        as_of = env.utc_iso(datetime(y, m, d, tzinfo=_ET))
        notes.append(NOTE_INDEX.format(calls=calls, oldest=oldest or "a date not given", newest=newest))
    else:
        as_of = None
        notes.append(NOTE_INDEX_UNDATED.format(calls=calls))
    notes.append(NOTE_UNCHECKED)
    expanded = got.get("expanded") if isinstance(got.get("expanded"), dict) else {}
    widened = {str(k): [str(x) for x in v] for k, v in expanded.items() if isinstance(v, list) and v}
    if widened:
        notes.append(NOTE_EXPANDED)
    wider = False
    if not total:
        notes.append(NOTE_NONE)
    elif len(hits) >= limit and total > len(hits):
        notes.append(NOTE_CUT.format(n=len(hits), total=total))
    elif total > len(hits):                                # the service checked exact words on the hits it kept
        wider = True
        notes.append(NOTE_TOTAL_WIDER.format(total=total))
    # `query` / `total` / `hits` keep the route's own names (the TSRC panel's model reads them)
    data = {"query": q, "symbol": symbol, "since": since, "total": total, "total_wider": wider, "hits": hits,
            "expanded": widened, "index": {"calls": calls, "oldest": oldest, "newest": newest}}
    coverage = {"evaluated": total, "answered": len(hits), "dropped": total - len(hits), "not_computable": 0}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=as_of, source=SOURCE, data=data,
                             stale=False, coverage=coverage, notes=notes, provider_calls=0)
