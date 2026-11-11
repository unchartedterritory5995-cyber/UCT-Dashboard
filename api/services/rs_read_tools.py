"""UCT Relative Strength (RS) read tools: ONE implementation for every assistant.

Two read-only tools (engineering map 2026-11-08, decision D16, unit 4-07):

* ``rs_reading(symbol, benchmark="SPY")`` reads ONE ticker's RS chart readout
  through the server lane (``registry_defs.serve("rsLine", sym, "D",
  {"benchmark": b})``) and returns the readout's own glance summaries as plain
  text: the benchmark label, the rating summary and its ``asof``, the RS line
  (legend) summary, the last RS high, the agreement (sensitivity), the regime
  label and the checks summary, plus the rotation, quality and VARS summaries
  when the installed row carries them. ⛔ Never a raw column, never a number the
  readout did not print: a block the envelope lacks is reported as missing, and
  a block whose summary is empty answers the readout's own fallback words.
* ``explain_term(term)`` looks a term up in ``api/data/rs_teaching.json`` (the
  4-02 export of ``app/src/content/rs/teaching.js``): the readout cards first,
  then the glossary, then the misconceptions, matched case-insensitively on the
  key, the label / term, an alias or the myth. It returns the JSON's words
  verbatim plus the Desk Learn link path when the entry has a lesson. An unknown
  term answers "not a UCT RS term" with the nearest three (difflib, ties broken
  by the file's own order, so the answer is deterministic).

RS is the stock against the market. RSI is a different, lesser indicator: these
tools never present it as an alternative, and "is RS the same as RSI?" resolves
to the ``rsIsNotRsi`` misconception, answered "No, they are different things"
plus its truth.

⭐ PLAIN SERVICE, THIN WRAPPERS. Everything (ticker validation, reading the
envelope into summaries, matching, nearest three, the Learn links) lives here and
returns plain dicts. Compass voice (``voice_tool_impls._get_rs_reading`` /
``_explain_rs``) and Compass chat (``coach_chat_tools``, through
``_voice_delegate``) only wrap it; the descriptions and parameter schemas are the
constants below, so the surfaces cannot drift. The gate
(``RS_COMPASS_TOOLS_ENABLED``) is the Compass registrations' business, not this
module's.

⭐ HOW THE UCT AGENT WOULD ADOPT THEM (not registered now: there is no spec yet).
The validators have the gateway's ``Kind.validate`` shape, ``(params) -> None |
reason``, over ``{"symbol", "benchmark"?}`` and ``{"term"}``. A registrar module
named in ``api/services/uct_agent/marketdata/gateway.REGISTRARS`` would add::

    registry.register(Kind(
        name="rs.reading", fn=_rs_reading_kind, validate=rs_read_tools.validate_reading_params,
        freshness="historical", category="market", owner="agent-md", max_symbols=1,
        description=rs_read_tools.READING_DESCRIPTION))
    registry.register(Kind(
        name="rs.explain", fn=_rs_explain_kind, validate=rs_read_tools.validate_term_params,
        freshness="periodic", category="knowledge", owner="agent-kn", max_symbols=0,
        description=rs_read_tools.EXPLAIN_DESCRIPTION))

where each ``fn(params, ctx)`` calls ``rs_reading(params["symbol"],
params.get("benchmark", "SPY"))`` / ``explain_term(params["term"])`` and wraps
the dict with ``envelope.make_envelope(kind, params, status="ok" if out["ok"]
else "unavailable", freshness=..., as_of=None, source="uct-rs", data=out,
notes=[...], provider_calls=0)`` (``as_of`` None needs a note saying why; the
rating's ``rating_asof`` is a session date, not a UTC instant), and the operator
adds the kind names to ``UCT_AGENT_DATA_KINDS``. Nothing here changes.
"""
from __future__ import annotations

import difflib
import functools
import json
import logging
import re
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

_TEACHING_PATH = Path(__file__).resolve().parent.parent / "data" / "rs_teaching.json"

#: The app's symbol rule for the RS lane: ``api/routers/signature._SYM_RE``, the
#: regex the ``/api/signature/columns`` route validates with before it serves
#: ``rsLine``. Mirrored (not imported) so validation stays pure and cheap;
#: ``tests/test_compass_rs_tools.py`` pins the two patterns equal.
SYMBOL_PATTERN = r"^[A-Za-z][A-Za-z.\-]{0,9}$"
_SYM_RE = re.compile(SYMBOL_PATTERN)
DEFAULT_BENCHMARK = "SPY"
MAX_TERM = 80

READING_DESCRIPTION = (
    "UCT Relative Strength (RS) reading for ONE ticker: how the stock is doing against the market "
    "(default benchmark SPY), in the RS chart readout's own words: the benchmark, the RS Rating "
    "and the date it was rated, the RS line against its average, the last RS new high, whether "
    "SPY / RSP / the sector agree, the market regime and the four UCT checks. Plain summaries "
    "only; a missing piece says it is missing. RS compares the stock with the market and is NOT "
    "RSI: never offer RSI as an alternative. One ticker per call: never call it in a loop over a "
    "list (a watchlist question goes to grade_watchlist). A reading of strength, not a trade signal. Call for "
    "'is NVDA leading the market', 'what is AAPL's RS', 'how is TSLA doing against QQQ'."
)
READING_PARAMETERS = {
    "ticker": {"type": "string", "description": "One ticker, e.g. NVDA."},
    "benchmark": {"type": "string", "description": "SPY (default), RSP, QQQ, IWM, SECTOR or INDUSTRY."},
}
EXPLAIN_DESCRIPTION = (
    "Explain a UCT Relative Strength (RS) term in the indicator's own words: a readout card "
    "(Benchmark, Rating, RS line, Last RS high, Before price, On a red day, Checks), a glossary "
    "term (gold dot, blue dot, RS new high, Mansfield RS, rotation quadrant, leader and laggard, "
    "UCT RS Rating, UCT RS Phases, UCT RS vs 21 EMA...) or a common myth ('RS is RSI', 'a rising RS line means the "
    "price is going up'). Returns the text verbatim plus the Desk lesson link when there is one. "
    "For 'is RS the same as RSI' pass 'RSI' and answer 'No, they are different things' with the "
    "returned truth; never present RSI as an alternative to RS. Call for 'what does the gold "
    "dot mean', 'what is the RS Rating', 'is RS the same as RSI'."
)
EXPLAIN_PARAMETERS = {
    "term": {"type": "string", "description": "The RS term, label or myth, e.g. 'gold dot'."},
}

#: The Desk lessons (``app/src/lib/deskVideoHref.js`` ``RS_LEARN_VIDEOS``,
#: mirrored by ``tests/fixtures/indicators/rs_learn_videos.json``; the test file
#: pins this table to that fixture).
LEARN_VIDEOS: dict[str, dict[str, Any]] = {
    "rsLine": {"youtubeId": "sM-aFdyOps4", "t": 1, "label": "Manrav on the RS line: Relative Strength Workshop"},
    "phase": {"youtubeId": "sM-aFdyOps4", "t": 1, "label": "Manrav on the RS line and its 21 EMA"},
    "newHigh": {"youtubeId": "QCTOJgCQmjw", "t": 1, "label": "Chartmaster on tracking relative strength"},
    "beforePrice": {"youtubeId": "_0ZvKLYznLo", "t": 1814, "label": "Chartmaster: RS shows before price confirms"},
    "redDay": {"youtubeId": "mfswYu5UlX8", "t": 341, "label": "Chartmaster: RS highs on red market days"},
    "fourChecks": {"youtubeId": "mfswYu5UlX8", "t": 726, "label": "Chartmaster: the four RS checks"},
}
#: Which lesson a readout card links to: the ``card.learn`` of each rsLine readout
#: row in ``app/src/components/chart/engine/nativeRegistry.js`` (pinned by the test).
CARD_LEARN: dict[str, str] = {
    "benchmarkName": "rsLine", "phase": "phase", "rsHigh": "newHigh",
    "beforePrice": "beforePrice", "redDay": "redDay", "checks": "fourChecks",
}
#: The three glossary terms that ARE a lesson's subject (the glossary carries no
#: link of its own): the RS line, the RS new high, the RS new high before price.
GLOSSARY_LEARN: dict[str, str] = {
    "rsLine": "rsLine", "rsNewHigh": "newHigh", "rsNewHighBeforePrice": "beforePrice",
}
#: Matching vocabulary only (never content): ways a member asks about a myth. The
#: JSON's misconceptions carry no aliases, and "RSI" must reach the RS-is-not-RSI
#: correction rather than "not a UCT RS term".
MISCONCEPTION_ALIASES: dict[str, tuple[str, ...]] = {
    "rsIsNotRsi": ("RSI", "relative strength index", "RS vs RSI", "RS versus RSI", "RS or RSI",
                   "RS and RSI", "is RS RSI", "is RS the same as RSI"),
}

#: The readout's glance rows, in readout order: (field, the card whose label
#: names it, the payload block, the block key, the readout's own fallback words
#: when the block is present but the summary is empty, else None).
_GLANCE = (
    ("benchmark", "benchmarkName", "benchmark", "label", None),
    ("rating", "ratingSummary", "rating", "summary", "not yet rated"),
    ("rs_line", "phase", "legend", "summary", None),
    ("last_rs_high", "rsHigh", "lastRsHigh", "summary", None),
    ("sensitivity", "sensitivity", "sensitivity", "summary", None),
    ("regime", "regime", "regime", "label", "needs more history"),
    ("checks", "checks", "checks", "summary", "needs more history"),
)
#: The Phase 3 blocks, read only when the envelope carries them (the v4 row).
_OPTIONAL = (("rotation", "Rotation"), ("quality", "RS quality"), ("vars", "VARS"))
#: The RS Rating Reading's block (rsLine rev 5, Deepvue round 2): the stored daily
#: rating over time, ``payload.ratingHistory.summary`` ("82, up 6 in 20 sessions").
#: Read only when the envelope carries it AND it describes this Reading: a server
#: that did not draw the Reading says "not the chosen reading", and that says
#: nothing about the stock, so the field is left out rather than narrated.
_RATING_HISTORY = ("ratingHistory", "rating_history", "RS Rating history")
_RATING_HISTORY_NOT_DRAWN = "not the chosen reading"
#: The inputs the tool asks for: the benchmark, and the RS Rating Reading so the
#: rating-history block is computed. Every summary the tool reads is taken before
#: the view blanks any column, so the Reading changes no other field; a server whose
#: row does not declare the Reading drops it (`resolve_inputs`) and answers as before.
_READING_VIEW = "rating"
MISSING = "missing from this reading"
NOT_AVAILABLE = "not available"


# ── teaching JSON ────────────────────────────────────────────────────────────

@functools.lru_cache(maxsize=1)
def teaching() -> dict:
    """``api/data/rs_teaching.json``, parsed once per process."""
    with open(_TEACHING_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(s: Any) -> str:
    text = " ".join(str(s or "").strip().lower().split())
    return text.rstrip("?.!").strip()


def _compact(s: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", _norm(s))


def learn_link(lesson_key: Optional[str]) -> Optional[dict]:
    """``{key, label, path}`` for a lesson, the path in ``deskVideoHref``'s shape
    (``/desk?section=videos&v=<id>`` plus ``&t=<s>`` only when s >= 1), or None."""
    entry = LEARN_VIDEOS.get(lesson_key or "")
    if not entry:
        return None
    t = entry.get("t")
    seek = f"&t={int(t)}" if isinstance(t, (int, float)) and int(t) >= 1 else ""
    return {"key": lesson_key, "label": entry["label"],
            "path": f"/desk?section=videos&v={entry['youtubeId']}{seek}"}


def _entries() -> list[dict]:
    """Every teaching entry in lookup order (cards, glossary, misconceptions),
    each with the names it answers to."""
    t = teaching()
    out: list[dict] = []
    for key in sorted(t.get("cards") or {}):
        card = t["cards"][key]
        out.append({"kind": "card", "key": key, "name": card.get("label") or key,
                    "names": [key, card.get("label")], "src": card})
    for g in t.get("glossary") or []:
        out.append({"kind": "glossary", "key": g["key"], "name": g.get("term") or g["key"],
                    "names": [g["key"], g.get("term")] + list(g.get("aliases") or []), "src": g})
    for m in t.get("misconceptions") or []:
        out.append({"kind": "misconception", "key": m["key"], "name": m.get("myth") or m["key"],
                    "names": [m["key"], m.get("myth")] + list(MISCONCEPTION_ALIASES.get(m["key"], ())),
                    "src": m})
    return out


def _no_comma(truth: str) -> str:
    """``No, `` + the truth, its first letter lowered unless it opens an acronym (RS...)."""
    if len(truth) >= 2 and truth[0].isupper() and truth[1].islower():
        truth = truth[0].lower() + truth[1:]
    return f"No, {truth}"


def _answer(e: dict) -> dict:
    src = e["src"]
    out: dict[str, Any] = {"ok": True, "found": True, "kind": e["kind"], "key": e["key"]}
    if e["kind"] == "card":
        out.update(label=src.get("label"), what=src.get("what"), origin=src.get("origin"),
                   evidence=src.get("evidence"))
        learn = learn_link(CARD_LEARN.get(e["key"]))
        parts = [f"{src.get('label')}: {src.get('what')}", f"Origin: {src.get('origin')}"]
        if src.get("evidence"):
            parts.append(f"Evidence: {src.get('evidence')}")
    elif e["kind"] == "glossary":
        out.update(term=src.get("term"), definition=src.get("definition"),
                   aliases=list(src.get("aliases") or []))
        learn = learn_link(GLOSSARY_LEARN.get(e["key"]))
        parts = [f"{src.get('term')}: {src.get('definition')}"]
    else:
        out.update(myth=src.get("myth"), truth=src.get("truth"), answer=_no_comma(str(src.get("truth") or "")))
        learn = None
        parts = [f"Myth: {src.get('myth')}", out["answer"]]
    out["learn"] = learn
    if learn:
        parts.append(f"Lesson: {learn['label']} ({learn['path']})")
    out["narration"] = " ".join(parts)
    return out


def nearest(term: str, n: int = 3) -> list[dict]:
    """The ``n`` entries closest to ``term``: the best difflib ratio over each
    entry's compacted names, ties broken by lookup order. Deterministic."""
    q = _compact(term)
    scored = []
    for i, e in enumerate(_entries()):
        best = max((difflib.SequenceMatcher(None, q, _compact(name)).ratio()
                    for name in e["names"] if name), default=0.0)
        scored.append((-round(best, 6), i, e))
    scored.sort(key=lambda s: (s[0], s[1]))
    return [{"kind": e["kind"], "key": e["key"], "name": e["name"]} for _, _, e in scored[:n]]


def validate_term_params(params: Any) -> Optional[str]:
    """``Kind.validate`` shape over ``{"term"}``: None when well formed."""
    term = (params or {}).get("term") if isinstance(params, dict) else None
    if not isinstance(term, str) or not term.strip():
        return "name the RS term to explain"
    if len(term) > MAX_TERM:
        return f"a term is at most {MAX_TERM} characters"
    return None


def explain_term(term: str) -> dict:
    """The teaching entry ``term`` names, verbatim, or "not a UCT RS term" with
    the nearest three. Never raises."""
    why = validate_term_params({"term": term})
    if why:
        return {"ok": False, "error": why, "narration": why}
    q, qc = _norm(term), _compact(term)
    try:
        entries = _entries()
    except Exception:                                   # noqa: BLE001 — a missing export is an honest refusal
        log.exception("rs_read_tools: rs_teaching.json unreadable")
        msg = "The RS teaching text is not available right now."
        return {"ok": False, "error": msg, "narration": msg}
    hits = [e for e in entries
            if any(name and (_norm(name) == q or (qc and _compact(name) == qc)) for name in e["names"])]
    if hits:
        out = _answer(hits[0])
        # Every other entry with the same name (the Benchmark card and the Benchmark
        # glossary term), verbatim too, so a later entry is never unreachable.
        out["also"] = [{k: v for k, v in _answer(e).items() if k not in ("ok", "found")}
                       for e in hits[1:]]
        return out
    near = nearest(term)
    msg = f"'{term.strip()}' is not a UCT RS term."
    return {"ok": True, "found": False, "term": term.strip(), "message": msg, "nearest": near,
            "narration": f"{msg} The nearest UCT RS terms are: " + "; ".join(x["name"] for x in near) + "."}


# ── the reading ──────────────────────────────────────────────────────────────

def _benchmarks() -> tuple[str, ...]:
    from api.services.signature import registry_defs
    return tuple(registry_defs.RS_LINE_BENCHMARKS)


def validate_reading_params(params: Any) -> Optional[str]:
    """``Kind.validate`` shape over ``{"symbol", "benchmark"?}``: None when well
    formed. The symbol rule is the RS route's; the benchmark is one of the rsLine
    row's menu (``registry_defs.RS_LINE_BENCHMARKS``; a custom ticker is a chart
    choice, not a tool one)."""
    p = params if isinstance(params, dict) else {}
    sym = str(p.get("symbol") or "").strip()
    if not _SYM_RE.match(sym):
        return "a valid ticker symbol is required"
    bench = str(p.get("benchmark") or DEFAULT_BENCHMARK).strip().upper()
    menu = _benchmarks()
    if bench not in menu:
        return f"the benchmark must be one of {', '.join(menu)}"
    return None


def _fetch_envelope(sym: str, benchmark: str) -> dict:
    """One ``rsLine`` envelope on the daily chart. The router module is imported
    so its ``register_provider("rsLine", ...)`` has run (the provider and its bar
    reader live there); it is imported once per process like any module."""
    import api.routers.signature  # noqa: F401 — registers the rsLine provider
    from api.services.signature import registry_defs
    return registry_defs.serve("rsLine", sym, "D", {"benchmark": benchmark, "view": _READING_VIEW})


def _text(v: Any) -> Optional[str]:
    return v.strip() if isinstance(v, str) and v.strip() else None


def _labels() -> dict:
    try:
        cards = teaching().get("cards") or {}
    except Exception:                                   # noqa: BLE001 — labels are cosmetic
        cards = {}
    return {k: (c.get("label") or k) for k, c in cards.items()}


def summarize_envelope(sym: str, benchmark: str, envelope: Any) -> dict:
    """The glance summaries of one ``rsLine`` envelope as plain text. Pure."""
    payload = envelope.get("payload") if isinstance(envelope, dict) else None
    if not isinstance(payload, dict):
        err = _text((envelope or {}).get("error")) if isinstance(envelope, dict) else None
        msg = f"No RS readout is available for {sym}" + (f": {err}." if err else ": the readout block is missing.")
        return {"ok": False, "symbol": sym, "benchmark_requested": benchmark, "error": msg, "narration": msg}
    labels = _labels()
    fields: dict[str, Optional[str]] = {}
    missing: list[str] = []
    lines: list[str] = []
    for field, card, block_key, attr, fallback in _GLANCE:
        block = payload.get(block_key)
        if not isinstance(block, dict):
            fields[field] = MISSING
            missing.append(field)
        else:
            text = _text(block.get(attr))
            if text is None:
                reason = _text(block.get("reason"))
                text = fallback or (f"{NOT_AVAILABLE}: {reason}" if reason else NOT_AVAILABLE)
            fields[field] = text
        lines.append(f"{labels.get(card, card)}: {fields[field]}")
        if field == "benchmark" and isinstance(block, dict) and _text(block.get("note")):
            fields["benchmark_note"] = _text(block.get("note"))
            lines.append(f"Benchmark note: {fields['benchmark_note']}")
        if field == "rating":
            asof = _text(block.get("asof")) if isinstance(block, dict) else None
            fields["rating_asof"] = asof
            if asof:
                lines[-1] += f" (rated as of {asof})"
    for block_key, label in _OPTIONAL:
        block = payload.get(block_key)
        if not isinstance(block, dict):
            continue
        reason = _text(block.get("reason"))
        fields[block_key] = _text(block.get("summary")) or (f"{NOT_AVAILABLE}: {reason}" if reason else NOT_AVAILABLE)
        lines.append(f"{label}: {fields[block_key]}")
    block_key, field, label = _RATING_HISTORY
    block = payload.get(block_key)
    summary = _text(block.get("summary")) if isinstance(block, dict) else None
    if summary and _text(block.get("reason")) != _RATING_HISTORY_NOT_DRAWN:
        # The server's own words; its U+00A0 spaces (which hold a number to its
        # unit in the readout row) read as plain spaces in speech and chat.
        fields[field] = summary.replace("\u00a0", " ")
        lines.append(f"{label}: {fields[field]}")
    head = f"{sym} UCT Relative Strength, daily, against {fields.get('benchmark') or benchmark}"
    return {"ok": True, "symbol": sym, "benchmark_requested": benchmark,
            "state": _text(payload.get("state")), "fields": fields, "missing": missing,
            "narration": head + ". " + ". ".join(lines) + ".",
            "note": "RS compares the stock with the benchmark; it is not RSI. A reading of strength, not a trade signal."}


def rs_reading(symbol: str, benchmark: str = DEFAULT_BENCHMARK) -> dict:
    """ONE ticker's RS readout summaries (see the module docstring). Never raises.
    One call runs the full provider (about 150 ms warm): never loop it."""
    bench = str(benchmark or DEFAULT_BENCHMARK).strip().upper()
    why = validate_reading_params({"symbol": symbol, "benchmark": bench})
    if why:
        return {"ok": False, "error": why, "narration": why}
    sym = str(symbol).strip().upper()
    try:
        envelope = _fetch_envelope(sym, bench)
    except Exception as exc:                            # noqa: BLE001 — a tool answers, it never 500s
        log.warning("rs_read_tools: rsLine serve failed for %s/%s: %s", sym, bench, type(exc).__name__)
        msg = f"The RS reading for {sym} could not be computed right now."
        return {"ok": False, "symbol": sym, "benchmark_requested": bench, "error": msg, "narration": msg}
    return summarize_envelope(sym, bench, envelope)
