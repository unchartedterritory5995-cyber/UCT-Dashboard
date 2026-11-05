"""RS-1 v1 — `research.company`: a structured research envelope composed from SERVED gateway kinds and ONE web search.

  gateway.read("research.company", {symbol, topic, question}, user_id=…, turn_id=…, purpose="research")

The envelope's `data` is
  {symbol, topic, facts: [{text, source, as_of, kind, stale}], interpretation: [str], unknown: [str],
   sources: [{title, url, published_at}], inputs: {kind: status}, web: {ran, cached, stripped}, facts_refused}

HARD RULES (docs/agent/audit-2026-11-02/04-MASTER-PLAN.md P4; MD-1; ADR-005; F-16):
  * Every fact is built HERE from an input envelope, and every number in a fact must be a figure one of those
    envelopes carried. `assemble()` enforces it as a gate: a fact whose text holds a figure the inputs did not
    return is REFUSED (dropped and counted), whatever built it.
  * Web text is INTERPRETATION, never fact: each sentence of the web answer is kept only when every figure in
    it is one the gateway returned (years and dates excepted); the rest are stripped and counted in `unknown`.
  * Inputs are read through the gateway with purpose "research", so a model-isolated kind (breadth, ratings —
    ADR-005) is refused before admission and can never contribute. No screener field is read (F-16).
  * Freshness is honest per fact (`as_of`, `stale` from the input envelope) and the envelope's class is the LEAST
    fresh contributing input; `as_of` is the OLDEST contributing fact's time. A live quote stays "live" only when
    its own read was live and not stale; everything else is worded as of its own time (Massive wording).
  * At most ONE web call per turn: a second research read in the same turn reuses the first's result.
  * Telemetry is value-free: counts and statuses only (never a figure, never the prose).
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

log = logging.getLogger("uct_agent.research")

KIND = "research.company"
SOURCE = "uct-agent-research"
TOPICS = ("move", "strength", "catalysts", "general")
#: the served gateway kinds a research answer composes, in the order they are read (MD-1 §4)
INPUT_KINDS = ("quote", "news.company", "earnings", "fundamentals", "themes")
MAX_FACTS = 12
MAX_INTERPRETATION = 6
MAX_UNKNOWN = 8
MAX_SOURCES = 8
MAX_QUESTION = 200
NEWS_LIMIT = 6
THEMES_LIMIT = 5
WEB_TTL_S = 600
_ET = ZoneInfo("America/New_York")
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_NUM_RE = re.compile(r"(?<![A-Za-z])[-+]?\$?\d[\d,]*(?:\.\d+)?")
_SENT_RE = re.compile(r"(?<=[.!?])\s+")
_CITE_RE = re.compile(r"\[\d+\]")
#: a WHOLE month name or abbreviation (review B2: a bare prefix matched "declined", "margin", "market", "decreased",
#: so the next number passed as a "date"). "May" only capitalised — "may" is a verb far more often than a month.
_MONTH_NAME = (r"(?:\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
               r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b(?-i:May)\b)")
_MONTH = _MONTH_NAME + r"\.?"
#: numbers that are DATES, not figures: a year, a day beside a month name (never one followed by "%": "In June 30%
#: fell" is a figure), a quarter label, a clock time, an ordinal
_DATE_NUM_RE = re.compile(
    r"\b(?:19|20)\d\d\b|" + _MONTH + r"\s+\d{1,2}(?:st|nd|rd|th)?\b(?!\s*%)|\b\d{1,2}(?:st|nd|rd|th)?(?!\s*%)\s+" + _MONTH_NAME + r"|"
    r"\b[Qq][1-4]\b|\b(?:fy|fiscal)\s*\d{2,4}\b|\b\d{1,2}:\d\d\b|\b\d{1,2}(?:st|nd|rd|th)\b", re.I)

NOTE_FACTS = "facts carry only figures the UCT data gateway returned; each names its own source and as_of"
NOTE_INTERPRETATION = ("interpretation is web commentary, not UCT data; sentences with figures UCT's data did not return "
                       "were left out")
NOTE_AS_OF = "as_of is the OLDEST contributing fact's time; the envelope's freshness class is the least fresh contributing input"
NOTE_NO_FACTS = "no UCT data contributed to this answer; as_of is not given"
NOTE_NO_TIME = "the contributing facts carry no source time (see each fact)"
NOTE_WEB_OFF = "no web lookup contributed to this answer"
NOTE_WEB_SHARED = "the web lookup was shared with an earlier research read in this turn"
UNKNOWN_KIND = "UCT's {label} data was not available for this answer"
UNKNOWN_WEB = "no web commentary was available for this answer"
UNKNOWN_WEB_BUDGET = "the web lookup was not run (the Agent's research budget did not admit it)"
UNKNOWN_WEB_TURN_USED = ("the web lookup was not run: this turn's one web lookup was already used for another research "
                         "question, so no web commentary is given for this one")
#: KN-1 owner decision 5 (separation): framed UCT knowledge reached this read, so NO web lookup was made
UNKNOWN_WEB_KNOWLEDGE = ("the web lookup was not run: this request carried UCT knowledge-base text, and that text is never "
                         "sent to a web search")
UNKNOWN_STRIPPED = "{n} web sentence{s} cited figures UCT's data did not return and {were} left out"
UNKNOWN_SOURCE_DATES = "web sources carry no publication date from the search provider"
UNKNOWN_EARNINGS_DATES = "UCT's earnings data carries no report dates for past quarters"
UNKNOWN_NEXT_REPORT = "no scheduled next report date is known in UCT's earnings data"
KIND_LABEL = {"quote": "price", "news.company": "stored news", "earnings": "earnings",
              "fundamentals": "financial statements", "themes": "theme"}
_LIVE_SOURCES = ("trade", "minute")
_PERIOD_WORDS = {"1d": "one session", "1w": "one week", "1m": "one month", "3m": "three months", "1y": "one year",
                 "ytd": "the year to date"}
_FIXED_QUERY = {"move": "why is {sym} stock moving today", "strength": "what is driving strength in {sym} stock this week",
                "catalysts": "what catalysts are coming next week for {sym} stock", "general": "{sym} stock latest news this week"}


# ── params ─────────────────────────────────────────────────────────────────────────────────────────────

def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate): a bad request spends no read and no web call."""
    sym = str(params.get("symbol") or "").strip().upper()
    if not _SYMBOL_RE.match(sym):
        return "a valid ticker symbol is required"
    topic = params.get("topic")
    if topic is not None and topic not in TOPICS:
        return f"topic must be one of {', '.join(TOPICS)}"
    q = params.get("question")
    if q is not None and (not isinstance(q, str) or len(q) > MAX_QUESTION):
        return f"question must be text of at most {MAX_QUESTION} characters"
    return None


def query_for(symbol: str, topic: str, question: Optional[str]) -> tuple[str, str]:
    """(web query, recency) — the member's own words when given, else the topic's fixed question."""
    q = " ".join(str(question or "").split())
    recency = "day" if topic == "move" else "week"
    if q:
        return q[:MAX_QUESTION], recency
    return _FIXED_QUERY[topic].format(sym=symbol), recency


# ── figures: what the gateway returned ─────────────────────────────────────────────────────────────────

def _numbers_in(v: Any, out: list) -> None:
    if isinstance(v, bool):
        return
    if isinstance(v, (int, float)):
        out.append(float(v))
    elif isinstance(v, dict):
        for x in v.values():
            _numbers_in(x, out)
    elif isinstance(v, list):
        for x in v:
            _numbers_in(x, out)


#: how far a stated figure may sit from a returned one: two-decimal rounding of the figure itself, one-decimal
#: rounding of a figure restated in thousands / millions / billions / trillions ("$46.7 billion" for 46743000000)
EXACT_TOL = 0.005
SCALED_TOL = 0.05


def allowed_figures(envelopes: Iterable[dict]) -> list[tuple[float, float]]:
    """Every number any input envelope's DATA carried, as (figure, tolerance), plus the magnitudes an answer may
    state it in (thousands, millions, billions, trillions)."""
    nums: list[float] = []
    for e in envelopes:
        if isinstance(e, dict) and e.get("status") in ("ok", "partial"):
            _numbers_in(e.get("data"), nums)
    out: dict[float, float] = {}
    for n in nums:
        a = abs(n)
        out[a] = max(out.get(a, 0.0), EXACT_TOL)
        for d in (1e3, 1e6, 1e9, 1e12):
            if a >= d:
                out[a / d] = max(out.get(a / d, 0.0), SCALED_TOL)
    return sorted(out.items())


def _figures_of(text: str) -> list[float]:
    """The figures a sentence states (dates, years, quarter labels and clock times excluded)."""
    s = _DATE_NUM_RE.sub(" ", str(text or ""))
    vals = []
    for m in _NUM_RE.finditer(s):
        raw = m.group(0).replace("$", "").replace(",", "").lstrip("+-")
        try:
            vals.append(float(raw))
        except ValueError:
            continue
    return vals


def _allowed(n: float, allowed: list[tuple[float, float]]) -> bool:
    return any(abs(n - f) <= tol for f, tol in allowed)


def unconfirmed_figures(text: str, allowed: list[tuple[float, float]]) -> list[float]:
    """The figures in `text` that no input envelope returned — an empty list means the sentence may be shown."""
    return [n for n in _figures_of(text) if not _allowed(n, allowed)]


# ── facts: built here, from input envelopes only ───────────────────────────────────────────────────────

def _parse(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(_ET)
    except ValueError:
        return None


def _et(iso: Optional[str], ref: Optional[str] = None) -> Optional[str]:
    d = _parse(iso)
    if d is None:
        return None
    r = _parse(ref)
    t = d.strftime("%I:%M %p").lstrip("0")
    return f"{t} ET" if (r is not None and r.date() == d.date()) else f"{d.strftime('%a, %b')} {d.day}, {t} ET"


def _day(iso: Optional[str]) -> Optional[str]:
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(str(iso)[:10])
    except ValueError:
        return None
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def _isnum(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _money(v: Any) -> Optional[str]:
    if not _isnum(v):
        return None
    a = abs(v)
    if a >= 1e12:
        return f"${v / 1e12:.2f}T"
    if a >= 1e9:
        return f"${v / 1e9:.2f}B"
    if a >= 1e6:
        return f"${v / 1e6:.2f}M"
    return f"${v:,.2f}" if a >= 1 else f"${v:.4f}"


def _pct(v: Any) -> Optional[str]:
    if not _isnum(v):
        return None
    return f"{'+' if v >= 0 else '−'}{abs(v):.2f}%"


def _fact(text: str, source: str, as_of: Optional[str], kind: str, stale: Any) -> dict:
    return {"text": text, "source": source, "as_of": as_of, "kind": kind, "stale": bool(stale)}


def _data(e: dict) -> dict:
    return e.get("data") if isinstance(e.get("data"), dict) else {}


def facts_from_quote(e: dict, sym: str) -> list[dict]:
    d = _data(e)
    row = d.get("quote")
    if not isinstance(row, dict) or not _isnum(row.get("last")):
        return []
    live = e.get("freshness") == "live" and not e.get("stale") and row.get("last_source") in _LIVE_SOURCES
    as_of = row.get("as_of") or e.get("as_of")
    when = _et(as_of, e.get("fetched_at"))
    chg = _pct(row.get("change_pct"))
    detail = d.get("session_detail")
    change = f", {chg} vs the previous close" if chg else ""
    if live:
        text = f"{sym} {_money(row['last'])}{change} — live, {detail or 'regular'} session, as of {when}."
    else:
        text = (f"{sym} last traded {_money(row['last'])}{change}{f' as of {when}' if when else ''}"
                f" ({detail or 'closed'}). Not a real-time price.")
    return [_fact(text, "Massive market snapshot via the UCT data gateway", as_of, "quote", e.get("stale"))]


def facts_from_news(e: dict, sym: str) -> tuple[list[dict], list[dict]]:
    items = [i for i in (_data(e).get("items") or []) if isinstance(i, dict) and i.get("headline") and i.get("as_of")]
    if not items:
        return [], []
    newest = items[0]
    # (no headline COUNT here: a count is a figure the gate would refuse, and it says nothing about the company)
    text = (f"UCT's news store holds recent headlines for {sym}; the newest, published "
            f"{_et(newest['as_of'], e.get('fetched_at'))}: “{str(newest['headline'])[:140]}”.")
    srcs = [{"title": str(i["headline"])[:140], "url": str(i.get("url") or ""), "published_at": i["as_of"]}
            for i in items[:NEWS_LIMIT]]
    return [_fact(text, "UCT news store via the UCT data gateway (not a web search)", e.get("as_of"), "news.company",
                  e.get("stale"))], srcs


def facts_from_earnings(e: dict, sym: str) -> tuple[list[dict], list[str]]:
    d = _data(e)
    out, unknown = [], []
    reported = [r for r in (d.get("reported") or []) if isinstance(r, dict) and r.get("quarter")]
    src = "UCT earnings data via the UCT data gateway"
    if reported:
        q = reported[-1]
        parts = []
        if _money(q.get("rev_actual")):
            s = f"revenue {_money(q['rev_actual'])}"
            if _money(q.get("rev_estimate")):
                s += f" vs {_money(q['rev_estimate'])} estimated"
            if _pct(q.get("rev_surprise_pct")):
                s += f" ({_pct(q['rev_surprise_pct'])} surprise)"
            parts.append(s)
        if _isnum(q.get("eps_actual")):
            s = f"EPS ${q['eps_actual']:.2f}"
            if _isnum(q.get("eps_estimate")):
                s += f" vs ${q['eps_estimate']:.2f} estimated"
            if _pct(q.get("eps_surprise_pct")):
                s += f" ({_pct(q['eps_surprise_pct'])} surprise)"
            parts.append(s)
        if parts:
            out.append(_fact(f"{sym}'s latest reported quarter ({q['quarter']}): {'; '.join(parts)}. "
                             "Reported quarters carry no report date.", src, None, "earnings", e.get("stale")))
    nxt = d.get("next_report") if isinstance(d.get("next_report"), dict) else None
    if nxt and nxt.get("report_date"):
        est = []
        if _isnum(nxt.get("eps_estimate")):
            est.append(f"EPS est. ${nxt['eps_estimate']:.2f}")
        if _money(nxt.get("rev_estimate")):
            est.append(f"revenue est. {_money(nxt['rev_estimate'])}")
        quarter = f" ({nxt['quarter']})" if nxt.get("quarter") else ""
        ests = f" · {', '.join(est)}" if est else ""
        out.append(_fact(f"{sym}'s next report is scheduled for {_day(nxt['report_date'])}{quarter}{ests} — a scheduled "
                         "event, not a result.", src, None, "earnings", e.get("stale")))
    else:
        unknown.append(UNKNOWN_NEXT_REPORT)
    if reported:
        unknown.append(UNKNOWN_EARNINGS_DATES)
    return out, unknown


_LINES = (("revenue", "revenue"), ("net_income", "net income"), ("eps_diluted", "EPS (diluted)"),
          ("free_cash_flow", "free cash flow"))


def facts_from_fundamentals(e: dict, sym: str) -> list[dict]:
    d = _data(e)
    stm = d.get("statements") if isinstance(d.get("statements"), dict) else {}
    latest: dict = {}
    period_end = None
    for key in ("income", "cashflow"):
        rows = stm.get(key) if isinstance(stm.get(key), list) else []
        r = rows[0] if rows and isinstance(rows[0], dict) else None
        if r and isinstance(r.get("values"), dict):
            latest.update(r["values"])
            period_end = period_end or r.get("period_end")
    parts = []
    for k, label in _LINES:
        v = latest.get(k)
        if k == "eps_diluted" and _isnum(v):
            parts.append(f"{label} ${v:.2f}")
        elif k != "eps_diluted" and _money(v):
            parts.append(f"{label} {_money(v)}")
    if not parts:
        return []
    period = "annual" if d.get("period") == "annual" else "quarterly"
    text = (f"{sym}'s newest {period} statements (period ending {_day(period_end) or 'an undated period'}): "
            f"{'; '.join(parts)}. Periodic disclosures, not today's figures.")
    return [_fact(text, "Yahoo Finance statements via the UCT data gateway", e.get("as_of"), "fundamentals", e.get("stale"))]


def facts_from_themes(e: dict) -> list[dict]:
    d = _data(e)
    rows = [t for t in (d.get("themes") or []) if isinstance(t, dict) and _isnum(t.get("return_pct")) and t.get("name")]
    if not rows:
        return []
    period = _PERIOD_WORDS.get(d.get("period"), "the period")
    order = "laggards" if d.get("order") == "laggards" else "leaders"
    when = f"as of the {_day(e.get('as_of'))} close" if e.get("as_of") else "including intraday prices UCT applied, not a live feed"
    listed = ", ".join(f"{t['name']} {_pct(t['return_pct'])}" for t in rows[:THEMES_LIMIT])
    text = f"UCT theme {order} over {period} ({when}): {listed}. Equal-weight theme returns, not live prices."
    return [_fact(text, "UCT Theme Tracker via the UCT data gateway", e.get("as_of"), "themes", e.get("stale"))]


# ── interpretation: web prose, figures guarded ─────────────────────────────────────────────────────────

def _clean_sentence(s: str) -> str:
    s = _CITE_RE.sub("", str(s or ""))
    s = re.sub(r"[*_#`]+", "", s)
    return " ".join(s.split()).strip()


def interpretation_from(answer: str, allowed: list[float]) -> tuple[list[str], int]:
    """(sentences kept, sentences stripped). A sentence is kept only when every figure in it was returned by an
    input envelope; the rest are counted, never shown."""
    kept, stripped = [], 0
    for raw in _SENT_RE.split(str(answer or "").replace("\n", " ")):
        s = _clean_sentence(raw)
        if len(s) < 12:
            continue
        if unconfirmed_figures(s, allowed):
            stripped += 1
            continue
        if len(kept) < MAX_INTERPRETATION:
            kept.append(s[:300])
    return kept, stripped


def _host(url: str) -> str:
    m = re.match(r"^https?://([^/]+)", str(url or ""))
    return (m.group(1) if m else str(url or "source")).replace("www.", "")


# ── assembly (pure; the gate every fact passes) ───────────────────────────────────────────────────────

def assemble(symbol: str, topic: str, *, inputs: dict[str, dict], facts: list[dict], web: Optional[dict],
             extra_unknown: Iterable[str] = (), news_sources: Iterable[dict] = ()) -> dict:
    """The research `data` from already-built parts. EVERY fact is checked here against the input envelopes'
    figures (`allowed_figures`): one that states a figure the gateway did not return is refused. Web text
    becomes interpretation under the same guard. Pure; exported for tests."""
    allowed = allowed_figures(inputs.values())
    kept_facts, refused = [], 0
    for f in facts:
        if not isinstance(f, dict) or not f.get("text"):
            continue
        if unconfirmed_figures(f["text"], allowed):
            refused += 1
            continue
        if len(kept_facts) < MAX_FACTS:
            kept_facts.append(f)
    unknown: list[str] = []
    for kind in INPUT_KINDS:
        e = inputs.get(kind)
        if e is not None and e.get("status") not in ("ok", "partial"):
            unknown.append(UNKNOWN_KIND.format(label=KIND_LABEL.get(kind, kind)))
    interpretation: list[str] = []
    sources: list[dict] = [{"title": s["title"], "url": s["url"], "published_at": s.get("published_at")}
                           for s in news_sources if s.get("url")]
    web_info = {"ran": False, "cached": False, "stripped": 0}
    if web is None:
        pass
    elif web.get("knowledge_blocked"):
        unknown.append(UNKNOWN_WEB_KNOWLEDGE)
    elif web.get("budget_refused"):
        unknown.append(UNKNOWN_WEB_BUDGET)
    elif web.get("turn_used"):
        unknown.append(UNKNOWN_WEB_TURN_USED)
    elif web.get("error") or not str(web.get("answer") or "").strip():
        unknown.append(UNKNOWN_WEB)
    else:
        interpretation, stripped = interpretation_from(web["answer"], allowed)
        web_info = {"ran": True, "cached": bool(web.get("cached")), "stripped": stripped}
        if stripped:
            unknown.append(UNKNOWN_STRIPPED.format(n=stripped, s="" if stripped == 1 else "s",
                                                   were="was" if stripped == 1 else "were"))
        cites = [str(c) for c in (web.get("citations") or []) if isinstance(c, str) and c.startswith("https://")]
        if cites:
            unknown.append(UNKNOWN_SOURCE_DATES)
        for c in cites:
            if not any(s["url"] == c for s in sources):
                sources.append({"title": _host(c), "url": c, "published_at": None})
    unknown.extend(str(u) for u in extra_unknown if u)
    seen, uniq = set(), []
    for u in unknown:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return {"symbol": symbol, "topic": topic, "facts": kept_facts, "interpretation": interpretation,
            "unknown": uniq[:MAX_UNKNOWN], "sources": sources[:MAX_SOURCES],
            "inputs": {k: (v.get("status") if isinstance(v, dict) else "unavailable") for k, v in inputs.items()},
            "web": web_info, "facts_refused": refused}


# ── the web seam: ONE call per turn, metered as the turn meters it ────────────────────────────────────

_web_cache: dict[tuple[Any, str], dict] = {}
_web_lock = threading.Lock()


def _web_lookup(ctx: dict, query: str, recency: str) -> dict:
    """The turn's own research call (`turn._research` → perplexity_search.web_search), admitted and settled through
    budget.Meter.research exactly as /api/agent/turn does. Returns the research dict, {"budget_refused": True} when
    the budget did not admit it, or {"error": …} when the provider had nothing. Never raises.

    ⛔ THE LOOKUP COUNTS AGAINST THE MEMBER'S REQUEST, FOUND BY THE SERVER. `turn_id` comes from the browser, so each
    new id would be a new turn: a request id the server opened is what the per-turn cap and the request-rate windows
    bound. No request in the follow-up window means no paid lookup (the facts are still served)."""
    from api.services.uct_agent import budget, turn
    try:
        request = budget.latest_request(ctx.get("user_id"))
        if request is None:
            return {"budget_refused": True, "citations": []}
        meter = budget.Meter(user_id=ctx.get("user_id"), request_id=None, turn_request_id=request)
        res = meter.research(lambda: turn._research(query, recency))
    except budget.BudgetRefused:
        return {"budget_refused": True, "citations": []}
    except Exception as e:  # noqa: BLE001 — a provider failure is an honest "no commentary", never a crash
        log.warning("uct_agent.research web lookup failed: %s", type(e).__name__)
        return {"error": type(e).__name__, "citations": []}
    if not isinstance(res, dict):
        return {"error": "no answer", "citations": []}
    if res.get("answer") == "research unavailable right now":
        return {"error": "unavailable", "citations": []}
    return res


def web_for_turn(ctx: dict, query: str, recency: str, symbol: str = "") -> tuple[dict, bool]:
    """(result, shared): the turn's ONE web lookup, keyed by (user, turn) for the budget and by (symbol, query) for
    its content (review B1). The SAME symbol and query again in the turn gets the first result and makes no call
    (shared); a DIFFERENT symbol or query in the same turn makes no call and gets `{"turn_used": True}` — never
    another company's commentary. Single-flight: the slot is claimed under the lock before the call, so two
    concurrent reads with one turn id cannot both call."""
    key = (ctx.get("user_id"), str(ctx.get("turn_id") or ""))
    what = (str(symbol or "").upper(), str(query or ""))
    now = time.time()
    with _web_lock:
        for k in [k for k, v in _web_cache.items() if now - v["at"] > WEB_TTL_S]:
            _web_cache.pop(k, None)
        slot = _web_cache.get(key)
        mine = slot is None
        if mine:
            slot = {"at": now, "what": what, "done": threading.Event(), "res": None}
            _web_cache[key] = slot
    if not mine:
        if slot["what"] != what:
            return {"turn_used": True, "citations": []}, False
        slot["done"].wait(timeout=60)
        res = slot["res"]
        return (res if isinstance(res, dict) else {"error": "no answer", "citations": []}), True
    try:
        slot["res"] = _web_lookup(ctx, query, recency)
    finally:
        slot["done"].set()
    return slot["res"], False


def _reset_for_test() -> None:
    with _web_lock:
        _web_cache.clear()


# ── the kind ──────────────────────────────────────────────────────────────────────────────────────────

def _read_input(kind: str, params: dict, ctx: dict) -> dict:
    from api.services.uct_agent.marketdata import gateway
    # purpose "research": a model-isolated kind refuses before admission (ADR-005); the read counts against the turn
    return gateway.read(kind, params, user_id=ctx.get("user_id"), turn_id=ctx.get("turn_id"), purpose="research")


def _least_fresh(envelopes: list[dict]) -> str:
    worst = 0
    for e in envelopes:
        f = e.get("freshness")
        if f in env.FRESHNESS and f != "unavailable":
            worst = max(worst, env.FRESHNESS.index(f))
    return env.FRESHNESS[worst]


def read_research_company(params: dict, ctx: dict) -> dict:
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = str(params["symbol"]).strip().upper()
    topic = params.get("topic") or "general"
    question = params.get("question") if isinstance(params.get("question"), str) else None

    inputs: dict[str, dict] = {}
    facts: list[dict] = []
    extra_unknown: list[str] = []
    news_sources: list[dict] = []
    reads = {"quote": {"symbol": sym}, "news.company": {"symbol": sym, "limit": NEWS_LIMIT},
             "earnings": {"symbol": sym}, "fundamentals": {"symbol": sym, "period": "quarterly", "periods": 1}}
    if topic == "strength":
        reads["themes"] = {"period": "1w", "order": "leaders", "limit": THEMES_LIMIT}
    for kind in INPUT_KINDS:
        if kind not in reads:
            continue
        e = _read_input(kind, reads[kind], ctx)
        inputs[kind] = e
        if e.get("status") not in ("ok", "partial"):
            continue
        if kind == "quote":
            facts.extend(facts_from_quote(e, sym))
        elif kind == "news.company":
            fs, srcs = facts_from_news(e, sym)
            facts.extend(fs)
            news_sources.extend(srcs)
        elif kind == "earnings":
            fs, unk = facts_from_earnings(e, sym)
            facts.extend(fs)
            extra_unknown.extend(unk)
        elif kind == "fundamentals":
            facts.extend(facts_from_fundamentals(e, sym))
        elif kind == "themes":
            facts.extend(facts_from_themes(e))

    query, recency = query_for(sym, topic, question)
    from api.services.uct_agent.knowledge import frame as kn_frame      # KN-1 owner decision 5: separation
    if kn_frame.seen(params) or kn_frame.seen(ctx):
        # the same block turn-level research has (turn.py / turn_v2._research_step): raw Brain knowledge never reaches a
        # web provider. Blocked, not cleaned; the turn's one web slot is not claimed and nothing is metered.
        web, shared = {"knowledge_blocked": True, "citations": []}, False
        log.info("uct_agent.research web skipped: knowledge_separation")
    else:
        web, shared = web_for_turn(ctx, query, recency, sym)
    data = assemble(sym, topic, inputs=inputs, facts=facts, web=web, extra_unknown=extra_unknown,
                    news_sources=news_sources)

    answered = sum(1 for e in inputs.values() if e.get("status") in ("ok", "partial"))
    dropped = len(inputs) - answered
    # value-free telemetry: counts and statuses only
    log.info("uct_agent.research topic=%s inputs=%d answered=%d facts=%d refused=%d interp=%d stripped=%d web_ran=%s "
             "cached=%s shared=%s", topic, len(inputs), answered, len(data["facts"]), data["facts_refused"],
             len(data["interpretation"]), data["web"]["stripped"], data["web"]["ran"], data["web"]["cached"], shared)
    if not data["facts"] and not data["interpretation"]:
        return env.unavailable(KIND, params, SOURCE, "neither UCT's data nor a web lookup could contribute to this answer")

    notes = [NOTE_FACTS, NOTE_INTERPRETATION]
    if shared:
        notes.append(NOTE_WEB_SHARED)
    if not data["web"]["ran"]:
        notes.append(NOTE_WEB_OFF)
    contributing = [inputs[f["kind"]] for f in data["facts"] if f.get("kind") in inputs]
    if contributing:
        freshness = _least_fresh(contributing)
        as_ofs = [f["as_of"] for f in data["facts"] if f.get("as_of")]
        as_of = min(as_ofs) if as_ofs else None
        notes.append(NOTE_AS_OF if as_of else NOTE_NO_TIME)
        stale = any(bool(f.get("stale")) for f in data["facts"])
    else:
        freshness, as_of, stale = "periodic", None, False
        notes.append(NOTE_NO_FACTS)
    status = "ok" if dropped == 0 and data["web"]["ran"] else "partial"
    coverage = {"evaluated": len(inputs), "answered": answered, "dropped": dropped, "not_computable": data["facts_refused"]}
    provider_calls = 1 if (data["web"]["ran"] and not data["web"]["cached"] and not shared) else 0
    delay = None
    if freshness == "delayed":
        delay = max(float(e.get("delay_s") or 0) for e in contributing if e.get("freshness") == "delayed")
    return env.make_envelope(KIND, params, status=status, freshness=freshness, as_of=as_of, source=SOURCE, data=data,
                             delay_s=delay, stale=stale, coverage=coverage, notes=notes, provider_calls=provider_calls)
