"""MD-1 kind `cot.byTrader` (owner: terminal-data, data wave 11) — futures positioning by trader type, as held.

The CFTC's finer Commitments of Traders reports (Traders in Financial Futures for financial contracts, Disaggregated for
physical commodities), as UCT stores them. For one market: its report, the class traders watch most in it (leveraged
funds, or managed money), and its newest two weeks for every trader class (long, short and spreading contracts and
trader counts), open interest, the largest traders' share of each side, and the CFTC records the weeks came from; the
net, the week's change and the share of open interest are worked out in the browser with the COT panel's own
arithmetic. For the board: every listed market's watched class, its newest two weeks. The Agent half of the COT panel's
"By trader type" table and the board's funds column, over the answers of `GET /api/cot/{symbol}/breakdown` and
`GET /api/cot/breakdown` (`api/services/cot_finer.py`), with the route's own field names.

⛔ ONLY WHAT THE SERVER ALREADY STORES, NEVER A DOWNLOAD (MD-1 §5). The files are read from the CFTC by ONE scheduled run
(`cot_finer.run_scheduled`, twice a day, never on a request); the route's reads, `cot_finer.market_answer` and
`board_answer`, are small indexed reads of the stored weeks that never download, build or start a run. This adapter calls
exactly those reads. provider_calls is always 0. A rail shows `run_scheduled` starting the run in the same state.

NOTHING STORED IS SAID, NEVER "NO POSITIONS": before the first file is read (`not_built`), for a market the held files
carry no record of (`no_record`) and when the store cannot be read (`unavailable`) the read is `unavailable` with that
reason. A side the CFTC printed none for is null, never 0. A market word the legacy reader does not key is never guessed:
it is resolved by `cot.positioning`'s own resolver (`cot.resolve`), and an unknown one is `unavailable`, said.

WHAT IS STATED: every count is the CFTC's, as stored, passed through; nothing is recomputed here. One market returns its
newest `WEEKS` weeks only (the net and its week's change need two); its 3-year range is left out, and a note says the
COT panel shows it. The board returns every listed market the store holds (at most the 66 the legacy reader keys).

TIME (MD-1 §3): `as_of` = the report date (the Tuesday the positions describe) as the start of that Eastern day: for the
board, the OLDEST newest-report across the markets read, so the board never claims a newer week than every market has.
The CFTC publishes each Tuesday's positions the following Friday. The read is `stale`, with a note, when that date is
older than the report the CFTC should have published by now (`cot_service.expected_latest_report_date`, the legacy
reader's own holiday-aware rule). Every read is `periodic`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the reports are the CFTC's, public domain
(docs/terminal-research/09-security-licensing-cost/licensing-register.md, row T-105, class A, "As T-82"), and the row
names the use it covers and no other: "Nothing else reads it yet (no AI lane, no export, no external publication)". The
legacy report's AI lane (row T-82) runs behind its own grounding gate, which this kind is not. With no row clearing it for
a model provider, the narrower rule is taken: the same rule as `ownership.funds` (row T-104). Shown to the member only;
the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _whole, day_as_of

KIND = "cot.byTrader"
SOURCE = "cftc-cot-finer"
WEEKS = 2                                  # the newest two weeks: the net and its week's change
MAX_WORD = 40
REPORTS = ("tff", "disaggregated")         # cot_finer.REPORTS (a rail pins the two together)
#: a class's counts, by the service's own names (cot_finer._POSITION_COLS less the keys)
SIDE_FIELDS = ("long", "short", "spread", "traders_long", "traders_short", "traders_spread")
#: the store's own states (cot_finer.market_answer / board_answer) and what each says
STATE_WORDS = {"not_built": "no file has been read from the CFTC on this server yet",
               "no_record": "the CFTC files UCT holds carry no record of this market in the finer reports",
               "unavailable": "the stored reports could not be read"}
CREDIT = ("Source: CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), as of the Tuesday it covers, "
          "published the following Friday.")

NOTE_WHAT = ("{what} by trader type as UCT stores it from the CFTC's {report} report (futures only): each class's long, "
             "short and spreading contracts and trader counts, and open interest, for the newest {weeks} weeks. Public "
             "data, not advice")
NOTE_WHAT_BOARD = ("every listed market's watched class (leveraged funds in Traders in Financial Futures, managed money in "
                   "Disaggregated) as UCT stores it from the CFTC (futures only), its newest two weeks. Public data, not advice")
NOTE_AS_OF = ("`as_of` is the report date, the Tuesday the positions describe ({day}); the CFTC published it the following "
              "Friday. It is never the time of the read")
NOTE_BOARD_DATES = ("{n} of the {total} markets have an older newest week than {newest}: `as_of` is the oldest newest week, "
                    "so the board never claims a newer week than every market has")
NOTE_STALE = "the newest stored report is {got}; the report expected by now is {want}, so this is not the latest week"
NOTE_ONE_WEEK = "only one week is stored for this market, so no week's change is stated (never a change of 0)"
NOTE_NO_RECORD_BOARD = "{n} listed markets have no record in the finer reports UCT holds: {codes}"
NOTE_CHECK = "the server's last look at the CFTC did not go well ({state}); these are the weeks it stored before"
NOTE_LEFT_OUT = "the 3-year range of each class is not in this read: the COT panel shows it"
NOTE_NOT_COVERED = ("UCT's COT data does not cover {word!r} (the markets the legacy report keys), and this read never "
                    "guesses one. That is not the same as no positioning")
NOTE_NOT_STORED = "positioning by trader type is not stated: {why}. This read never downloads. That is not the same as no positions"
NOTE_FAILED = "the positioning by trader type read failed; nothing is stated. That is not the same as no positions"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. `market` is a member's word or a stored code, or null for
    the board."""
    if not isinstance(params, dict):
        return "the request must be an object"
    m = params.get("market")
    if m is not None and (not isinstance(m, str) or not m.strip() or len(m) > MAX_WORD):
        return f"`market` must be a futures market's name or code of at most {MAX_WORD} characters, or null for the board"
    return None


def resolve(word: str) -> Optional[str]:
    """A member's word or a stored code -> the stored COT code, or None: `cot.positioning`'s own resolver, never a guess."""
    from api.services.uct_agent.marketdata import cot
    return cot.resolve(word)


def held_market(code: str) -> dict:
    """READ ONLY: one market's newest `WEEKS` stored weeks (`cot_finer.market_answer`: indexed reads, never a download)."""
    from api.services import cot_finer
    return cot_finer.market_answer(code, WEEKS)


def held_board() -> dict:
    """READ ONLY: every listed market's watched class (`cot_finer.board_answer`: indexed reads, never a download)."""
    from api.services import cot_finer
    return cot_finer.board_answer()


def expected_report() -> str:
    """The report the CFTC should have published by now (`cot_service.expected_latest_report_date`; pure: the calendar)."""
    from api.services import cot_finer, cot_service
    return cot_service.expected_latest_report_date(cot_finer.now_et()).isoformat()


def market_name(code: str) -> Optional[str]:
    from api.services import cot_service
    return cot_service.SYMBOL_NAMES.get(code)


def _sides(c: Any) -> Optional[dict]:
    return {k: _whole(c.get(k)) for k in SIDE_FIELDS} if isinstance(c, dict) else None


def _check(got: dict) -> Optional[str]:
    chk = got.get("check") if isinstance(got.get("check"), dict) else None
    return str(chk.get("state"))[:40] if chk and chk.get("state") else None


def read_positions(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    word = params.get("market")
    try:
        if word is None:
            return _board(params, held_board())
        code = resolve(word)
        if code is None:
            return env.unavailable(KIND, params, SOURCE, NOTE_NOT_COVERED.format(word=" ".join(word.split())[:MAX_WORD]))
        return _market(params, code, held_market(code))
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _stale(notes: list, newest: Optional[str]) -> bool:
    want = expected_report()
    if newest and newest < want:
        notes.append(NOTE_STALE.format(got=newest, want=want))
        return True
    return False


def _market(params: dict, code: str, got: Any) -> dict:
    state = got.get("state") if isinstance(got, dict) else None
    if state != "ok":
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_STORED.format(why=STATE_WORDS.get(state, STATE_WORDS["unavailable"])))
    if got.get("report") not in REPORTS:
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    keys = [str(c.get("key")) for c in (got.get("classes") or []) if isinstance(c, dict) and c.get("key")]
    rows = []
    for r in (got.get("rows") or [])[-WEEKS:]:
        if isinstance(r, dict) and _day(r.get("date")) and isinstance(r.get("classes"), dict):
            rows.append({"date": _day(r["date"]), "open_interest": _whole(r.get("open_interest")),
                         "traders_total": _whole(r.get("traders_total")),
                         "classes": {k: _sides(r["classes"].get(k)) for k in keys}})
    if not rows:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_STORED.format(why=STATE_WORDS["no_record"]))
    newest = rows[-1]["date"]
    name = market_name(code)
    notes = [NOTE_WHAT.format(what=f"{name or code} ({code}) positioning", report=got.get("report_name") or got["report"],
                              weeks=len(rows)),
             NOTE_AS_OF.format(day=newest)]
    stale = _stale(notes, newest)
    if len(rows) < 2:
        notes.append(NOTE_ONE_WEEK)
    chk = _check(got)
    if chk:
        notes.append(NOTE_CHECK.format(state=chk))
    notes.append(NOTE_LEFT_OUT)
    conc = got.get("concentration") if isinstance(got.get("concentration"), dict) else None
    data = {"market": code, "name": name, "report": got["report"], "report_name": got.get("report_name"),
            "watch": got.get("watch"),
            "classes": [{"key": str(c.get("key")), "cftc": str(c.get("cftc") or "")[:80], "spread": c.get("spread") is True,
                         "traders": c.get("traders") is True} for c in (got.get("classes") or []) if isinstance(c, dict) and c.get("key")],
            "rows": rows,
            "records": [{"cftc_code": str(r.get("cftc_code") or "")[:12] or None, "market_name": str(r.get("market_name") or "")[:120] or None,
                         "match": "name" if r.get("match") == "name" else "code", "first": _day(r.get("first")), "last": _day(r.get("last"))}
                        for r in (got.get("records") or []) if isinstance(r, dict)][-5:],
            "concentration": {"date": _day(conc.get("date")), **{k: _num(v) for k, v in conc.items() if k != "date"}} if conc else None,
            "credit": CREDIT, "stale_for": ["behind_schedule"] if stale else [], "left_out": ["range"]}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=day_as_of(newest), source=SOURCE, data=data,
                             stale=stale, delay_s=3 * 86400, notes=notes, provider_calls=0)


def _board(params: dict, got: Any) -> dict:
    state = got.get("state") if isinstance(got, dict) else None
    if state != "ok":
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_STORED.format(why=STATE_WORDS.get(state, STATE_WORDS["unavailable"])))
    markets = {}
    for code, m in (got.get("markets") or {}).items():
        if not isinstance(m, dict) or not _day(m.get("date")) or m.get("report") not in REPORTS:
            continue
        prev = m.get("previous") if isinstance(m.get("previous"), dict) else None
        markets[str(code)[:12]] = {"report": m["report"], "watch": m.get("watch"), "name": market_name(str(code)),
                                   "date": _day(m["date"]), "open_interest": _whole(m.get("open_interest")),
                                   **{k: _whole(m.get(k)) for k in ("long", "short", "spread")},
                                   "previous": {"date": _day(prev.get("date")), "open_interest": _whole(prev.get("open_interest")),
                                                **{k: _whole(prev.get(k)) for k in ("long", "short", "spread")}} if prev else None}
    if not markets:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_STORED.format(why=STATE_WORDS["no_record"]))
    dates = sorted(m["date"] for m in markets.values())
    oldest, newest = dates[0], dates[-1]
    no_record = [str(c)[:12] for c in (got.get("no_record") or [])]
    notes = [NOTE_WHAT_BOARD, NOTE_AS_OF.format(day=oldest)]
    behind = [c for c, m in markets.items() if m["date"] < newest]
    if behind:
        notes.append(NOTE_BOARD_DATES.format(n=len(behind), total=len(markets), newest=newest))
    stale = _stale(notes, oldest)
    if no_record:
        notes.append(NOTE_NO_RECORD_BOARD.format(n=len(no_record), codes=", ".join(no_record[:20])))
    chk = _check(got)
    if chk:
        notes.append(NOTE_CHECK.format(state=chk))
    notes.append(NOTE_LEFT_OUT)
    data = {"market": None, "watch": {k: v for k, v in (got.get("watch") or {}).items() if k in REPORTS},
            "markets": markets, "no_record": no_record, "newest": newest, "credit": CREDIT,
            "stale_for": ["behind_schedule"] if stale else [], "left_out": ["range"]}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=day_as_of(oldest), source=SOURCE, data=data,
                             stale=stale, delay_s=3 * 86400,
                             coverage={"evaluated": len(markets) + len(no_record), "answered": len(markets), "dropped": 0,
                                       "not_computable": len(no_record)},
                             notes=notes, provider_calls=0)
