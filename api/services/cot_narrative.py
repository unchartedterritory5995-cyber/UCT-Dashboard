"""api/services/cot_narrative.py — grounded, cached LLM "weekly read" for the COT tab.

WHAT THIS IS
------------
The frontend computes every positioning fact deterministically (3-year COT Index
per trader group, zones, bias, crowding, streaks, precedents). This service turns
THOSE facts into ~150 words of fresh, plain-English prose once per
(symbol, report week), caches the prose forever, and never lets the model invent
a number. The prose is a rendering of the facts, not a second opinion on them.

    facts_hash(symbol, report_date, facts) -> str
    get_cached(symbol, report_date, h)     -> dict | None
    get_or_create(symbol, name, report_date, facts) -> dict
        {"status": "ok"|"disabled"|"capped"|"error", "text", "model", "cached",
         "created_at", "reason"}  — every key always present; NEVER raises.

GROUNDING GATE
--------------
After generation every number in the output is extracted, normalised (commas,
`$`, `%`, signs and trailing zeros stripped) and must appear in the set of
numbers derivable from the inputs: every numeric token anywhere in the facts
JSON (keys, string values, numeric literals), plus the market name and report
date, plus for each numeric value its absolute value, integer rounding,
one-decimal rounding, thousands forms (113553 -> 113.6 / 114, i.e. "114K"),
millions forms for values >= 1e6, and the percent form of a ratio (0.62 -> 62).
The output is also rejected under 100 or over 230 words, or if it carries any
list/markdown/markup marker or emoji. On rejection the model gets ONE retry with
the offending tokens named; if that is rejected too the result is
`{"status": "error", "reason": "ungrounded"|"length"|"markdown"}` and NOTHING is
stored — the frontend falls back to its templated read.

THE MODEL CALL
--------------
Kwarg-minimal, the shape `desk_creative._llm_kwargs` settled on 2026-08-20:
no `temperature` (the pod's SDK TypeErrors on the kwarg and the Claude 5 family
rejects sampling params at the API anyway) and `thinking` DISABLED (Claude 5
thinks by default and the thinking block eats `max_tokens`, truncating the
prose). The shape lives in `_llm_kwargs` and is pinned by a test.

COST NOTE
---------
~62 symbols x 1 CFTC report per week, cached forever per (symbol, week, facts)
=> on the order of 62 generations a week at ~1.5K input / ~300 output tokens
each. `COT_NARRATIVE_DAILY_CAP` (default 300 generations per UTC day) is a
BACKSTOP against a runaway client re-hashing facts, not a budget.

ENV
---
    COT_NARRATIVE_ENABLED    default "1"  — anything else returns status "disabled"
    COT_NARRATIVE_MODEL      default "claude-opus-5"  (owner prefers Opus for synthesis)
    COT_NARRATIVE_DAILY_CAP  default 300  generations per UTC day
All three are read at CALL time, never at import, so an operator flip (or a
test's monkeypatch) takes effect without a restart or a reload.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from api.services import cot_service

logger = logging.getLogger(__name__)

ENABLED_ENV = "COT_NARRATIVE_ENABLED"    # default "1"
MODEL_ENV   = "COT_NARRATIVE_MODEL"      # default "claude-opus-5"
CAP_ENV     = "COT_NARRATIVE_DAILY_CAP"  # default 300 (generations per UTC day)

DEFAULT_MODEL     = "claude-opus-5"
DEFAULT_DAILY_CAP = 300
MAX_FACTS_BYTES   = 12_000
MAX_TOKENS        = 450
MIN_WORDS, MAX_WORDS = 100, 230

# The table the service owns. `cot_service.init_db()` carries the same CREATE so
# a fresh db has it from startup; this copy is what makes the service work on an
# OLDER db that predates the column set. Both are IF NOT EXISTS.
_DDL = """
    CREATE TABLE IF NOT EXISTS cot_narratives (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol      TEXT NOT NULL,
        report_date TEXT NOT NULL,
        facts_hash  TEXT NOT NULL UNIQUE,
        text        TEXT NOT NULL,
        model       TEXT NOT NULL,
        created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cot_narratives_created
        ON cot_narratives(created_at);
"""

_SYSTEM_PROMPT = (
    "You are a seasoned futures trader explaining this week's Commitment of "
    "Traders positioning to a sharp friend who trades but does not live in the "
    "CFTC data. Write in plain English, in sentence case, with plain verbs, and "
    "talk to the reader directly. You are a mentor and an educator, not a "
    "dashboard: never read a number out like a readout (\"55 of 150\"); when you "
    "use a number, say what it means in words in the same sentence, and prefer "
    "the plain-words anchor over the number when the fact is a label. No emoji, "
    "no headers, no bullet points, no markdown of any kind: prose only. Never "
    "claim certainty about where price goes next. Use only the facts you are "
    "given; if a number is not in the facts, do not say it."
)


# ── config (read at call time) ────────────────────────────────────────────────

def _enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "1").strip() == "1"


def _model() -> str:
    return os.environ.get(MODEL_ENV, "").strip() or DEFAULT_MODEL


def _daily_cap() -> int:
    raw = os.environ.get(CAP_ENV, "").strip()
    try:
        return int(raw) if raw else DEFAULT_DAILY_CAP
    except ValueError:
        logger.warning("[cot_narrative] %s=%r is not an int; using %d", CAP_ENV, raw, DEFAULT_DAILY_CAP)
        return DEFAULT_DAILY_CAP


# ── hashing ───────────────────────────────────────────────────────────────────

def canonical_facts(facts) -> str:
    """The ONE serialisation of the facts: sorted keys, compact separators.
    Both the hash and the 413 size check are taken off this string."""
    return json.dumps(facts, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, default=str)


def facts_hash(symbol: str, report_date: str, facts) -> str:
    """sha1 over symbol|report_date|canonical facts JSON."""
    payload = f"{symbol.upper()}|{report_date}|{canonical_facts(facts)}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


# ── storage ───────────────────────────────────────────────────────────────────

def _ensure_table() -> None:
    with closing(cot_service._get_conn()) as conn, conn:
        conn.executescript(_DDL)


def _row_to_result(row) -> dict:
    return _result("ok", text=row["text"], model=row["model"], cached=True,
                   created_at=row["created_at"])


def get_cached(symbol: str, report_date: str, h: str) -> dict | None:
    """The stored read for this hash, as a result dict with cached=True, or None."""
    _ensure_table()
    with closing(cot_service._get_conn()) as conn:
        row = conn.execute(
            "SELECT text, model, created_at FROM cot_narratives WHERE facts_hash = ?",
            (h,),
        ).fetchone()
    return _row_to_result(row) if row else None


def _created_today_count() -> int:
    today = datetime.now(timezone.utc).date().isoformat()
    with closing(cot_service._get_conn()) as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM cot_narratives WHERE substr(created_at, 1, 10) = ?",
            (today,),
        ).fetchone()
    return int(row[0]) if row else 0


def _store(symbol: str, report_date: str, h: str, text: str, model: str) -> str:
    created_at = datetime.now(timezone.utc).isoformat()
    with closing(cot_service._get_conn()) as conn, conn:
        # OR IGNORE: two concurrent generations of the same facts race to one
        # UNIQUE row; the loser keeps its own (equally grounded) text.
        conn.execute(
            "INSERT OR IGNORE INTO cot_narratives "
            "(symbol, report_date, facts_hash, text, model, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (symbol.upper(), report_date, h, text, model, created_at),
        )
    return created_at


# ── grounding ─────────────────────────────────────────────────────────────────

# A number as prose writes it: optional sign / dollar, digits with optional
# thousands commas, optional decimals, optional percent.
_NUM_RE = re.compile(r"[-+−]?\$?\d[\d,]*(?:\.\d+)?%?")
_TAG_RE = re.compile(r"</?[a-zA-Z][^<>]*>")
_LIST_LINE_RE = re.compile(r"^\s*(?:[-*•#>]+|\d+[.)])\s")
_EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


def _normalise(token: str) -> str | None:
    """'113,553' -> '113553'; '-12.50%' -> '12.5'; '$2,500' -> '2500'; '08' -> '8'."""
    t = token.strip().lstrip("+-−").replace("$", "").replace(",", "").rstrip("%")
    if not t:
        return None
    try:
        d = Decimal(t)
    except InvalidOperation:
        return None
    return _canon(d)


def _canon(d: Decimal) -> str:
    s = format(d.normalize(), "f")
    return s[1:] if s.startswith("-") else s


def _numbers_in_text(text: str) -> list[str]:
    return _NUM_RE.findall(text)


def _walk_numbers(obj, out: list) -> None:
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            _walk_numbers(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _walk_numbers(v, out)


def _variants(v) -> set[str]:
    """Every way prose can legitimately write the numeric value `v`."""
    try:
        d = Decimal(str(v))
    except InvalidOperation:
        return set()
    if not d.is_finite():
        return set()
    a = abs(d)
    out = {_canon(d), _canon(a)}
    out.add(_canon(a.quantize(Decimal("1"))))          # integer rounding
    out.add(_canon(a.quantize(Decimal("0.1"))))        # one decimal
    if a >= 1000:
        k = a / Decimal(1000)
        out.add(_canon(k.quantize(Decimal("0.1"))))    # 113.6 (K)
        out.add(_canon(k.quantize(Decimal("1"))))      # 114 (K)
    if a >= 1_000_000:
        m = a / Decimal(1_000_000)
        out.add(_canon(m.quantize(Decimal("0.1"))))    # 2.5 (M)
        out.add(_canon(m.quantize(Decimal("1"))))      # 3 (M)
    if 0 < a < 1:
        p = a * Decimal(100)
        out.add(_canon(p.quantize(Decimal("1"))))      # ratio as a percent
        out.add(_canon(p.quantize(Decimal("0.1"))))
    return out


def _allowed_numbers(facts, *extra: str) -> set[str]:
    """The grounding set: every numeric token anywhere in the canonical facts JSON
    (keys, strings, literals) and in `extra` (market name, report date), plus the
    derived variants of every numeric VALUE."""
    allowed: set[str] = set()
    corpus = canonical_facts(facts) + " " + " ".join(extra)
    for tok in _numbers_in_text(corpus):
        n = _normalise(tok)
        if n is not None:
            allowed.add(n)
    values: list = []
    _walk_numbers(facts, values)
    for v in values:
        allowed |= _variants(v)
    return allowed


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text))


def _validate(text: str, allowed: set[str]) -> tuple[str | None, list[str]]:
    """Return (reason, offending_tokens). reason None == accepted.
    Checks run in the order markdown -> length -> grounding; the first failure
    names the reason, but the offending numbers are always collected so the
    retry instruction can list them."""
    offending: list[str] = []
    seen: set[str] = set()
    for tok in _numbers_in_text(text):
        n = _normalise(tok)
        if n is not None and n not in allowed and tok not in seen:
            seen.add(tok)
            offending.append(tok)

    has_markup = (
        any(_LIST_LINE_RE.match(line) for line in text.splitlines())
        or "**" in text or "__" in text or "`" in text
        or bool(_TAG_RE.search(text))
        or bool(_EMOJI_RE.search(text))
    )
    if has_markup:
        return "markdown", offending
    wc = _word_count(text)
    if wc < MIN_WORDS or wc > MAX_WORDS:
        return "length", offending
    if offending:
        return "ungrounded", offending
    return None, []


# ── prompt ────────────────────────────────────────────────────────────────────

def _user_prompt(symbol: str, name: str, report_date: str, facts) -> str:
    rules = [
        "140 to 190 words, in exactly two paragraphs separated by one blank line.",
        "The first time you name a trader group, say who they are in a short clause "
        "(commercials are the producers and merchants who hedge; large speculators "
        "are the trend-following funds; small speculators are the retail crowd).",
        "Name the contrarian read explicitly: what the hedgers are doing versus the "
        "trend money versus the crowd, and what that tension has tended to mean.",
    ]
    if isinstance(facts, dict) and facts.get("precedents"):
        rules.append("The facts include precedents: cite them in one sentence.")
    rules += [
        "End with ONE concrete what-to-watch sentence for the coming week.",
        "NEVER state a number that does not appear in the facts. Where the fact is "
        "a label (a zone, a bias, a streak), prefer the words to the number.",
        "No certainty about where price goes next.",
        f"Do not begin with the market's name ({name}) or with \"This week\".",
        "Plain prose only: no headers, no bullet points, no markdown, no emoji.",
    ]
    facts_json = json.dumps(facts, sort_keys=True, indent=2, ensure_ascii=False, default=str)
    return (
        f"Market: {name} ({symbol}). COT report week: {report_date}.\n\n"
        "FACTS (JSON, computed deterministically; these are the ONLY numbers you may use):\n"
        f"{facts_json}\n\n"
        "RULES:\n" + "\n".join(f"- {r}" for r in rules)
    )


def _retry_suffix(reason: str, offending: list[str]) -> str:
    parts = ["\n\nYour previous draft was rejected."]
    if offending:
        parts.append(
            "It used numbers that do not appear in the facts: "
            + ", ".join(offending)
            + ". Remove each of them or replace it with a number that appears in the facts verbatim."
        )
    if reason == "length":
        parts.append(f"It was the wrong length: write between {MIN_WORDS + 40} and {MAX_WORDS - 40} words.")
    if reason == "markdown":
        parts.append("It contained list, markdown or markup characters: write plain prose only.")
    parts.append("Rewrite it in full, following every rule above.")
    return " ".join(parts)


# ── the model call ────────────────────────────────────────────────────────────

def _llm_kwargs(model: str, user: str) -> dict:
    """The exact messages.create call shape. Kwarg-minimal on purpose (see the
    module docstring): no `temperature`, thinking disabled."""
    return {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "thinking": {"type": "disabled"},
        "system": _SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user}],
    }


def _get_client():
    # Lazy: `engine` is heavy and owns the ANTHROPIC_API_KEY check. Resolved
    # through the module at call time so `api.services.engine._get_anthropic_client`
    # is the one unambiguous patch target.
    from api.services import engine
    return engine._get_anthropic_client()


def _call_model(model: str, user: str) -> str:
    msg = _get_client().messages.create(**_llm_kwargs(model, user))
    text = "".join(getattr(b, "text", "") or "" for b in msg.content)
    return text.strip()


# ── public entry ──────────────────────────────────────────────────────────────

def _result(status: str, *, text=None, model=None, cached=False, created_at=None,
            reason=None) -> dict:
    return {"status": status, "text": text, "model": model, "cached": cached,
            "created_at": created_at, "reason": reason}


def get_or_create(symbol: str, name: str, report_date: str, facts) -> dict:
    """The weekly read for (symbol, report_date, facts): cached if we have it,
    generated + grounded + stored if not. Never raises."""
    sym = symbol.upper()
    name = (name or "").strip() or cot_service.SYMBOL_NAMES.get(sym, sym)
    if not _enabled():
        return _result("disabled", reason=f"{ENABLED_ENV} is off")

    try:
        h = facts_hash(sym, report_date, facts)
        cached = get_cached(sym, report_date, h)
        if cached is not None:
            return cached

        cap = _daily_cap()
        made_today = _created_today_count()
        if made_today >= cap:
            logger.warning("[cot_narrative] daily cap reached (%d/%d) — %s %s not generated",
                           made_today, cap, sym, report_date)
            return _result("capped", reason=f"daily cap of {cap} generations reached")
    except Exception as exc:  # storage trouble is a degraded read, not a 500
        logger.error("[cot_narrative] storage error for %s %s: %s", sym, report_date, exc)
        return _result("error", reason=f"storage: {type(exc).__name__}")

    model = _model()
    allowed = _allowed_numbers(facts, name, report_date, sym)
    prompt = _user_prompt(sym, name, report_date, facts)

    reason, offending = "ungrounded", []
    text = ""
    for attempt in (1, 2):
        try:
            text = _call_model(model, prompt)
        except Exception as exc:
            logger.error("[cot_narrative] model call failed for %s %s (attempt %d): %s: %s",
                         sym, report_date, attempt, type(exc).__name__, exc)
            return _result("error", model=model, reason=f"model: {type(exc).__name__}: {exc}"[:200])
        reason, offending = _validate(text, allowed)
        if reason is None:
            break
        logger.warning("[cot_narrative] %s %s attempt %d rejected (%s)%s", sym, report_date,
                       attempt, reason, f": {offending}" if offending else "")
        if attempt == 1:
            prompt = prompt + _retry_suffix(reason, offending)

    if reason is not None:
        return _result("error", model=model, reason=reason)

    try:
        created_at = _store(sym, report_date, h, text, model)
    except Exception as exc:
        logger.error("[cot_narrative] store failed for %s %s: %s", sym, report_date, exc)
        return _result("error", model=model, reason=f"storage: {type(exc).__name__}")
    logger.info("[cot_narrative] generated %s %s (%d words, model=%s)",
                sym, report_date, _word_count(text), model)
    return _result("ok", text=text, model=model, cached=False, created_at=created_at)
