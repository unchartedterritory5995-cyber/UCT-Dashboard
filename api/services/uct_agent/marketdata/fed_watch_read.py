"""MD-1 kind `fed.watch` (owner: terminal-data, data wave 9) — the Fed watch, as held.

The Fed watch as UCT holds it, in seven blocks, each with its own state, its own source and its own date: the newest
FOMC statement and what changed from the one before (the added and removed word counts and the changed passages,
bounded), Fed speeches and testimony (bounded), the newest Fed headlines from the news wire UCT receives (bounded,
each with the time UCT received it), the next FOMC decision, the federal funds rates, the officials' median rate
projections and the New York Fed survey's median rate path: the Agent half of the FED terminal function, over the
answer of `GET /api/research/fed-watch` (`api/services/fed_watch.py`).

⛔ ONLY WHAT THE SERVER ALREADY HOLDS, NEVER A BUILD OR A REQUEST (MD-1 §5). The route's `fed_watch.get_fed_watch`
STARTS the service's background build (the Board's feeds and pages, the New York Fed's survey page and file) whenever
something is due, and even the service's read-only `fed_watch.held_answer()` asks the economics store for its three
rates series, which on a cold serving cache reads the published files from the data bucket. A turn must do neither,
so this adapter calls neither. It reads through `fed_watch_held.held_answer()`: every block as the service builds it,
under the service's own lock, except the rates, which are read only from what the economics store's serving cache
already holds. provider_calls is always 0. A rail shows `get_fed_watch` starting the build and the service's own
rates block asking the store in the same state.

EVERY BLOCK IS SAID, NONE IS DROPPED: a block that is not held, that its source refused, that could not be read, or
that is switched off on this server keeps its place in `data` with its own `state`, and a note says which and why. A
block never read on this server is `not_held` (the service's own read-only answer calls it `failed` with no recorded
look; a look that really failed keeps the service's state). Seven blocks held: `ok`; some: `partial`; none:
`unavailable`.

WHAT IS STATED: every value is the service's own, passed through and bounded. The statement's full text is NOT
carried: its date, its link, the redline's added and removed word counts and the passages that changed (each as it
reads now and as it read before, in the statement's order) are. A rate, a projection or a survey figure that is not
held is null, never 0. The rates carry the New York Fed's notice and the survey its attribution, as the panel shows
them; the Board asks to be cited, and `data.board_cite` carries its words. This week's Fed speakers and the survey's
probability ranges are left out (`data.left_out`), said.

THE CUT IS STATED: the speeches and the headlines each return at most `rows` rows, newest first, cut from the OLD
end; the changed passages at most `MAX_CHANGES`, in the statement's order, cut from the END; each with its whole count
beside what is shown.

TIME (MD-1 §3): the blocks carry different dates (the statement's day, each speech's and headline's time, the rates'
own days, the projections' release day, the survey's month), so `as_of` is null and a note says so; none of them is
ever the time of this read. `days_to_go` to the next decision counts from the day of this read in New York, as the
panel counts it. The read is `stale`, with a note, when the Board's or the New York Fed's last look did not go well
while an older read is held. Every read is `periodic`, as the kind is declared.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) has no row that clears any block for a model
provider. Row T-97 (the Board's monetary policy releases, speeches and projections on this panel) is class A, public
domain with the Board cited, and says nothing else reads it (no AI lane, no export, no external publication). Row
T-98 (the New York Fed survey block) is class A under the bank's Terms of Use as the economics registry records them,
and says the Terms of Use page itself was not read for that row. The headlines come from the news wire UCT receives,
which has no row in the register at all. The next decision comes from the economic calendar UCT holds: row T-37 (the
economic calendar, FMP, with ForexFactory's week as its other leg) is class R, FMP's AI row, row T-44, is class U
("No AI clause"), and row T-92 (ForexFactory among others) is U, not researched. The isolation is the builder's default
over the whole answer: no block is split into a kind of its own, since none is cleared. Shown to the member only; the
capability is local-only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _status_code, _whole

KIND = "fed.watch"
SOURCE = "uct-fed-watch"
DEFAULT_ROWS = 10
MAX_ROWS = 15               # the service's own speeches cap (fed_watch_parse.MAX_SPEECHES; a rail pins it)
MAX_CHANGES = 8
MAX_PASSAGE = 400
MAX_TEXT = 300
MAX_MEDIANS = 8
MAX_PATH = 6
BLOCKS = ("statement", "speeches", "headlines", "next_meeting", "rates", "projections", "survey")
STATES = ("ok", "none", "not_held", "unavailable", "failed", "unreadable", "off", "no_data")
REDLINE_STATES = ("ok", "same", "no_previous", "not_held", "unreadable", "too_long")
RATE_KEYS = ("effective", "upper", "lower")
LEFT_OUT = ("statement_text", "this_week_speakers", "survey_distributions")
#: each block in words, as a note names it
BLOCK_WORDS = {"statement": "FOMC statement", "speeches": "Fed speeches and testimony", "headlines": "Fed headlines",
               "next_meeting": "next FOMC decision", "rates": "federal funds rates", "projections": "rate projections",
               "survey": "New York Fed survey"}
#: why a block is not stated, by its state
STATE_WORDS = {"none": "its source lists none",
               "not_held": "it is not held on this server yet, and this read never asks for it. That is not the same as none",
               "unavailable": "its source refused UCT's last look and nothing is held",
               "failed": "UCT's last look did not get an answer and nothing is held",
               "unreadable": "its page could not be read", "off": "it is switched off on this server, so nothing is read",
               "no_data": "no figure is held"}
CHECK_WORDS = {"refused": "the website refused the request", "shape": "its answer could not be read",
               "rate_limited": "the website said too many requests", "timeout": "it did not answer in time",
               "source": "the website answered with an error", "error": "the read failed"}
CHECK_FAILED = "it did not go well"

NOTE_WHAT = ("the Fed watch as UCT holds it, in seven blocks, each with its own source and its own date: the newest FOMC "
             "statement and what changed from the one before (the Federal Reserve Board), Fed speeches and testimony "
             "(the Board), Fed headlines from the news wire UCT receives, the next FOMC decision (the economic calendar "
             "UCT holds, or the New York Fed survey's meeting dates), the federal funds rates (the Federal Reserve Bank "
             "of New York), the officials' median rate projections (the Board) and the New York Fed's Survey of Market "
             "Expectations. The Board's and the New York Fed's own words and figures: no UCT forecast, no summary and "
             "not advice")
NOTE_AS_OF = ("`as_of` is null: the seven blocks each carry their own date (the statement's day, each speech's and "
              "headline's time, the rates' own days, the projections' release day, the survey's month), and none of "
              "them is the time of this read")
NOTE_STATE = "the {block} block is not stated: {why}"
NOTE_REDLINE_SAME = "not one word changed from the statement of {previous}"
NOTE_REDLINE_NONE = "no earlier statement is held to compare the newest one with, so no change is stated"
NOTE_REDLINE_NOT_HELD = ("the statement before the newest one ({previous}) is not held yet, so no change is stated. That "
                         "is not the same as no change")
NOTE_REDLINE_UNREADABLE = ("the statement before the newest one ({previous}) could not be read, so no change is stated. "
                           "That is not the same as no change")
NOTE_REDLINE_TOO_LONG = "the two statements are too long to compare, so no change is stated"
NOTE_CHANGES_CUT = ("{total} passages of the statement changed and the first {shown}, in the statement's order, are "
                    "returned: the list is cut from the END")
NOTE_SPEECHES_CUT = ("{total} speeches and testimony are listed and the newest {shown} are returned: the list is cut "
                     "from the OLD end")
NOTE_SPEECHES_PART = "the {feeds} feed is not held, so its items are not in the list"
NOTE_HEADLINES = ("{matched} of the newest {scanned} headlines on the wire are about the Fed; each headline's time is "
                  "when UCT received it, and the wire gives no publication time of its own")
NOTE_HEADLINES_CUT = ("{matched} Fed headlines are held and the newest {shown} are returned: the list is cut from the "
                      "OLD end")
NOTE_DAYS_TO_GO = "`days_to_go` counts from the day of this read in New York ({today}), as the panel counts it"
NOTE_RATES_MISSING = "{n} of the three rates have no figure held and are null, never 0: {list}"
NOTE_RATES_NOTICE = "the New York Fed's notice for the two rates, as the panel shows it: {notice}"
NOTE_SURVEY = ("the survey's figures are its respondents' (market professionals'), not market prices and not a UCT "
               "forecast. {credit}")
NOTE_CHECK = ("UCT's last look for newer {what}, at {at}, did not go well ({why}): what is held is the last good read, "
              "and this read never looks again")
NOTE_LEFT_OUT = ("the statement's full text, this week's Fed speakers from the calendar and the survey's probability "
                 "ranges are left out of this answer. The Fed watch panel (FED) in UCT shows them")
NOTE_BOARD_CITE = "the Board asks to be cited as the source of its materials: {cite}"
NOTE_NOT_HELD = ("nothing of the Fed watch is held on this server yet, and this read never asks the Board, the New York "
                 "Fed or the news wire. That is not the same as no statement, no speech and no headline. Open the Fed "
                 "watch panel (FED) in UCT, then ask again")
NOTE_FAILED = "the Fed watch read failed; nothing is stated. That is not the same as no Fed news"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. The Fed watch takes no symbol."""
    if not isinstance(params, dict):
        return "the request must be an object"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer() -> tuple[dict, str]:
    """READ ONLY: (the answer from what the server holds, 'held' | 'not_held'), WITHOUT starting a build and without
    a request (`fed_watch_held.held_answer`)."""
    from api.services import fed_watch_held as svc
    return svc.held_answer()


def _text(v: Any, limit: int = MAX_TEXT) -> Optional[str]:
    return " ".join(v.split())[:limit] if isinstance(v, str) and v.strip() else None


def _url(v: Any) -> Optional[str]:
    ok = isinstance(v, str) and (v.startswith("https://www.federalreserve.gov/") or v.startswith("https://www.newyorkfed.org/"))
    return v[:300] if ok else None


def _check(c: Any) -> Optional[dict]:
    if not isinstance(c, dict) or not isinstance(c.get("state"), str):
        return None
    return {"state": c["state"], "reason": c.get("reason") if isinstance(c.get("reason"), str) else None,
            "http_status": _status_code(c.get("http_status")), "at": c.get("at") if isinstance(c.get("at"), str) else None}


def _state(raw: Any, check: Optional[dict]) -> str:
    """The service's state in this kind's words: a block never read (`failed` with no recorded look, or `computing`:
    a page not read yet) is `not_held`; `not_started` (the wire's store is not open here) is `not_held` too."""
    s = raw if isinstance(raw, str) else "failed"
    if s in ("computing", "not_started") or (s == "failed" and check is None):
        return "not_held"
    return s if s in STATES else "failed"


def changes(segments: Any) -> list[dict]:
    """The passages of a redline that changed, in the new statement's order: each as it reads now (`text`, None when
    the passage was only removed) and as it read before (`was`, None when it is new), with its added and removed word
    counts. A passage ends at a paragraph break or at a kept or added word that ends a sentence."""
    out: list[dict] = []
    cur = {"new": [], "old": [], "added": 0, "removed": 0}

    def close():
        nonlocal cur
        if cur["added"] or cur["removed"]:
            out.append({"text": " ".join(cur["new"])[:MAX_PASSAGE] or None, "was": " ".join(cur["old"])[:MAX_PASSAGE] or None,
                        "added": cur["added"], "removed": cur["removed"]})
        cur = {"new": [], "old": [], "added": 0, "removed": 0}

    for seg in segments if isinstance(segments, list) else []:
        if not isinstance(seg, dict):
            continue
        op, words = seg.get("op"), str(seg.get("text") or "").split()
        if op == "break":
            close()
            continue
        for w in words:
            if op == "same":
                cur["new"].append(w)
                cur["old"].append(w)
            elif op == "added":
                cur["new"].append(w)
                cur["added"] += 1
            elif op == "removed":
                cur["old"].append(w)
                cur["removed"] += 1
                continue
            else:
                continue
            if w.endswith((".", "?", "!")):
                close()
    close()
    return out


def _statement(raw: Any) -> tuple[dict, list[str]]:
    b = raw if isinstance(raw, dict) else {}
    check = _check(b.get("check"))
    state = _state(b.get("state"), check)
    out: dict[str, Any] = {"state": state, "source": _text(b.get("source")), "read_at": _read_at(b.get("read_at")) if b.get("read_at") else None,
                           "check": check if state == "ok" else None}
    notes: list[str] = []
    if state != "ok":
        if state in ("unreadable", "not_held") and _day(b.get("date")):
            out["date"] = _day(b.get("date"))                       # the statement listed, its page not read
        return out, notes
    m = b.get("minutes") if isinstance(b.get("minutes"), dict) else None
    out.update({"date": _day(b.get("date")), "url": _url(b.get("url")),
                "minutes": {"meeting": _text(m.get("meeting")), "url": _url(m.get("url")), "date": _day(m.get("date"))} if m else None})
    red = b.get("redline") if isinstance(b.get("redline"), dict) else {}
    rstate = red.get("state")
    rstate = "not_held" if rstate == "computing" else rstate if rstate in REDLINE_STATES else "no_previous"
    prev = red.get("previous") if isinstance(red.get("previous"), dict) else {}
    previous = {"date": _day(prev.get("date")), "url": _url(prev.get("url"))} if prev else None
    redline: dict[str, Any] = {"state": rstate, "previous": previous}
    pday = (previous or {}).get("date") or "the meeting before"
    if rstate in ("ok", "same"):
        found = changes(red.get("segments"))
        shown = found[:MAX_CHANGES]
        redline.update({"added": _whole(red.get("added")), "removed": _whole(red.get("removed")),
                        "changes": {"rows": shown, "count": len(shown), "total": len(found), "cut": len(found) > len(shown)}})
        if rstate == "same":
            notes.append(NOTE_REDLINE_SAME.format(previous=pday))
        if len(found) > len(shown):
            notes.append(NOTE_CHANGES_CUT.format(total=len(found), shown=len(shown)))
    else:
        redline.update({"added": None, "removed": None, "changes": None})
        notes.append({"no_previous": NOTE_REDLINE_NONE, "not_held": NOTE_REDLINE_NOT_HELD.format(previous=pday),
                      "unreadable": NOTE_REDLINE_UNREADABLE.format(previous=pday), "too_long": NOTE_REDLINE_TOO_LONG}[rstate])
    out["redline"] = redline
    return out, notes


def _speeches(raw: Any, limit: int) -> tuple[dict, list[str]]:
    b = raw if isinstance(raw, dict) else {}
    checks = {k: _check(v) for k, v in (b.get("checks") or {}).items() if isinstance(k, str) and _check(v)} \
        if isinstance(b.get("checks"), dict) else {}
    state = _state(b.get("state"), next(iter(checks.values()), None))
    out: dict[str, Any] = {"state": state, "source": _text(b.get("source")),
                           "read_at": _read_at(b.get("read_at")) if b.get("read_at") else None}
    notes: list[str] = []
    if state != "ok":
        return out, notes
    rows = []
    for it in b.get("items") or []:
        if not isinstance(it, dict) or not _text(it.get("title")):
            continue
        rows.append({"kind": "testimony" if it.get("kind") == "testimony" else "speech", "speaker": _text(it.get("speaker"), 60),
                     "title": _text(it.get("title")), "where": _text(it.get("where")),
                     "published": _read_at(it.get("published")) if it.get("published") else None, "url": _url(it.get("url"))})
    total = max(_whole(b.get("total")) or 0, len(rows))
    shown = rows[:limit]
    missing = [m for m in (b.get("missing") or []) if m in ("speeches", "testimony")]
    out.update({"rows": shown, "count": len(shown), "total": total, "cut": total > len(shown), "missing": missing,
                "checks": checks or None})
    if total > len(shown):
        notes.append(NOTE_SPEECHES_CUT.format(total=total, shown=len(shown)))
    if missing:
        notes.append(NOTE_SPEECHES_PART.format(feeds=" and ".join(missing)))
    return out, notes


def _headlines(raw: Any, limit: int) -> tuple[dict, list[str]]:
    b = raw if isinstance(raw, dict) else {}
    state = _state(b.get("state"), {"state": b.get("state")} if b.get("state") == "failed" else None)
    out: dict[str, Any] = {"state": state, "source": "news wire"}
    notes: list[str] = []
    if state != "ok":
        return out, notes
    rows = []
    for h in b.get("items") or []:
        ms = _num(h.get("received_at_ms")) if isinstance(h, dict) else None
        text = _text(h.get("text")) if isinstance(h, dict) else None
        if not text or ms is None or ms <= 0:
            continue
        tickers = [t for t in (h.get("tickers") or []) if isinstance(t, str) and 0 < len(t) <= 10][:6]
        rows.append({"text": text, "received_at": env.utc_iso(datetime.fromtimestamp(ms / 1000, tz=timezone.utc)),
                     "tickers": tickers})
    matched = max(_whole(b.get("matched")) or 0, len(rows))
    scanned = _whole(b.get("scanned"))
    shown = rows[:limit]
    out.update({"rows": shown, "count": len(shown), "matched": matched, "scanned": scanned, "cut": matched > len(shown),
                "newest_at": shown[0]["received_at"] if shown else None})
    notes.append(NOTE_HEADLINES.format(matched=matched, scanned=scanned if scanned is not None else "held"))
    if matched > len(shown):
        notes.append(NOTE_HEADLINES_CUT.format(matched=matched, shown=len(shown)))
    return out, notes


def _next_meeting(raw: Any) -> tuple[dict, list[str]]:
    c = raw if isinstance(raw, dict) else {}
    m = c.get("next_meeting") if isinstance(c.get("next_meeting"), dict) else {}
    if m.get("state") != "ok" or not _day(m.get("date")):
        return {"state": "not_held", "source": None}, []
    out = {"state": "ok", "source": _text(m.get("source")), "date": _day(m["date"]), "time": _text(m.get("time"), 12),
           "event": _text(m.get("event"), 80), "label": _text(m.get("label"), 40), "days_to_go": _whole(m.get("days_to_go"))}
    return out, [NOTE_DAYS_TO_GO.format(today=_day(c.get("today")) or "not given")] if out["days_to_go"] is not None else []


def _rates(raw: Any) -> tuple[dict, list[str]]:
    b = raw if isinstance(raw, dict) else {}
    state = b.get("state") if b.get("state") in ("ok", "off", "not_held", "no_data") else "failed"
    out: dict[str, Any] = {"state": state, "source": _text(b.get("source")), "notice": _text(b.get("notice"), 600)}
    notes: list[str] = []
    for k in RATE_KEYS:
        p = b.get(k) if isinstance(b.get(k), dict) else {}
        out[k] = {"value": _num(p.get("value")), "date": _day(p.get("date"))}            # not held: null, never 0
    if state == "ok":
        missing = [k for k in RATE_KEYS if out[k]["value"] is None]
        if missing:
            notes.append(NOTE_RATES_MISSING.format(n=len(missing), list=", ".join(missing)))
        if out["notice"]:
            notes.append(NOTE_RATES_NOTICE.format(notice=out["notice"]))
    return out, notes


def _projections(raw: Any) -> tuple[dict, list[str]]:
    b = raw if isinstance(raw, dict) else {}
    check = _check(b.get("check"))
    state = _state(b.get("state"), check)
    out: dict[str, Any] = {"state": state, "source": _text(b.get("source")), "check": check if state == "ok" else None}
    if state != "ok":
        return out, []
    medians = [{"label": _text(m.get("label"), 20), "value": _num(m.get("value"))} for m in (b.get("medians") or [])
               if isinstance(m, dict) and _text(m.get("label"), 20) and _num(m.get("value")) is not None][:MAX_MEDIANS]
    out.update({"date": _day(b.get("date")), "meeting": _text(b.get("meeting"), 60), "release_url": _url(b.get("release_url")),
                "page_url": _url(b.get("page_url")), "medians": medians,
                "read_at": _read_at(b.get("read_at")) if b.get("read_at") else None})
    return out, []


def _survey(raw: Any) -> tuple[dict, list[str]]:
    b = raw if isinstance(raw, dict) else {}
    check = _check(b.get("check"))
    state = _state(b.get("state"), check)
    out: dict[str, Any] = {"state": state, "source": _text(b.get("source")), "check": check if state == "ok" else None}
    if state != "ok":
        return out, []
    path = [{"label": _text(h.get("label"), 40), "date": _day(h.get("date")), "median": _num(h.get("median")),
             "p25": _num(h.get("p25")), "p75": _num(h.get("p75")), "respondents": _whole(h.get("respondents"))}
            for h in (b.get("path") or []) if isinstance(h, dict) and _text(h.get("label"), 40)][:MAX_PATH]
    before = b.get("before_meeting") if isinstance(b.get("before_meeting"), dict) else None
    out.update({"survey": _text(b.get("survey"), 40), "questions_sent": _day(b.get("questions_sent")),
                "responses_due": _day(b.get("responses_due")),
                "before_meeting": {"label": _text(before.get("label"), 40), "date": _day(before.get("date"))} if before else None,
                "path": path, "credit": _text(b.get("credit"), 300), "file_url": _url(b.get("file_url")),
                "read_at": _read_at(b.get("read_at")) if b.get("read_at") else None})
    return out, [NOTE_SURVEY.format(credit=out["credit"] or "Federal Reserve Bank of New York.")]


def read_fed_watch(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    limit = params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer()                               # what is held only: never a build, never a request
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no Fed news"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not isinstance(got, dict) or got.get("status") != "ok" or how not in ("held", "not_held"):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    try:
        parts = {"statement": _statement(got.get("statement")), "speeches": _speeches(got.get("speeches"), limit),
                 "headlines": _headlines(got.get("headlines"), limit), "next_meeting": _next_meeting(got.get("calendar")),
                 "rates": _rates(got.get("rates")), "projections": _projections(got.get("projections")),
                 "survey": _survey(got.get("survey"))}
    except Exception:  # noqa: BLE001 — a malformed block is a failed read, never a guess
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    blocks = {k: parts[k][0] for k in BLOCKS}
    held = [k for k in BLOCKS if blocks[k]["state"] == "ok"]
    if not held:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD if how == "not_held" else NOTE_FAILED)

    notes = [NOTE_WHAT, NOTE_AS_OF]
    for k in BLOCKS:
        if blocks[k]["state"] != "ok":
            notes.append(NOTE_STATE.format(block=BLOCK_WORDS[k], why=STATE_WORDS.get(blocks[k]["state"], STATE_WORDS["failed"])))
        notes.extend(parts[k][1])
    checks = [("FOMC statements", blocks["statement"].get("check")), ("rate projections", blocks["projections"].get("check")),
              ("survey files", blocks["survey"].get("check"))]
    checks += [(f"{feed} items", c) for feed, c in (blocks["speeches"].get("checks") or {}).items()
               if feed not in (blocks["speeches"].get("missing") or [])]          # a feed never held is said as missing
    looked = [(what, c) for what, c in checks if c]
    for what, c in looked:
        notes.append(NOTE_CHECK.format(what=what, at=c["at"] or "a time it did not record",
                                       why=CHECK_WORDS.get(c["reason"] or "", CHECK_FAILED)))
    notes.append(NOTE_LEFT_OUT)
    cite = _text(got.get("board_cite"), 120)
    if cite:
        notes.append(NOTE_BOARD_CITE.format(cite=cite))

    data = {**blocks, "as_of": None, "board_cite": cite, "left_out": list(LEFT_OUT)}
    coverage = {"evaluated": len(BLOCKS), "answered": len(held), "dropped": 0, "not_computable": len(BLOCKS) - len(held)}
    return env.make_envelope(KIND, params, status="ok" if len(held) == len(BLOCKS) else "partial", freshness="periodic",
                             as_of=None, source=SOURCE, data=data, stale=bool(looked), coverage=coverage, notes=notes,
                             provider_calls=0)
