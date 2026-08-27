"""The short written read that goes out with the into-the-close charts.

Owner, 2026-08-27: *"Also send a nice little message of insight and commentary
with it."*

Two or three sentences on what the session actually did: who led, who lagged,
whether the move was broad or narrow, and one thing to watch. It is the voice of
the desk, not a data dump - the numbers are already on the charts and in the
message header.

⛔ THE NOTE CONTAINS NO NUMERALS. Not a style rule, a safety one: a model writing
market prose will happily invent "SPY closed at 645" and this posts unattended to
a PUBLIC channel. Forbidding digits outright removes the entire class rather than
policing it - there is nothing left to fact-check. Every number a member sees is
computed by `discord_index_close` and rendered on the chart.

⛔ IT RUNS ON THE API KEY, NEVER THE SUBSCRIPTION SEAT. This is member-facing
production automation on the Railway service. Anthropic's legal terms
(code.claude.com/docs/en/legal-and-compliance) do not permit routing requests
through Pro/Max plan credentials on behalf of your users, and the 2026-08-24
audit put every uct-dashboard call site in the stays-on-API column for exactly
that reason. The cost is a rounding error either way: one short call per trading
day is a few cents a month.

Failure is SILENCE: no key, a refusal, a bad note, any exception - the charts go
out without a note. The charts are the product.
"""
from __future__ import annotations

import logging
import os
import re

log = logging.getLogger(__name__)

MODEL = "claude-sonnet-5"           # plenty for sixty words; DISCORD_CLOSE_NOTE_MODEL overrides
MIN_WORDS, MAX_WORDS = 25, 90
MAX_TOKENS = 400

_DIGIT_RE = re.compile(r"\d")
_TAG_RE = re.compile(r"</?[a-zA-Z][^<>]*>")
_LIST_LINE_RE = re.compile(r"^\s*(?:[-*•#>]+|\d+[.)])\s")
_EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF☀-➿]")
# The owner's standing rule for member-facing prose: no em-dashes, ever.
_BANNED_CHARS = ("—", "–", "@", "#")


def enabled() -> bool:
    return os.environ.get("DISCORD_CLOSE_NOTE_ENABLED", "1").strip().lower() not in ("0", "false", "off", "")


def _word_count(text: str) -> int:
    return len([w for w in re.split(r"\s+", text.strip()) if w])


def validate(text: str) -> str | None:
    """None == usable. Otherwise the reason, which is logged and retried once."""
    t = (text or "").strip()
    if not t:
        return "empty"
    if _DIGIT_RE.search(t):
        return "contains a number"
    if any(c in t for c in _BANNED_CHARS):
        return "banned character"
    if _EMOJI_RE.search(t) or _TAG_RE.search(t):
        return "markup"
    if "**" in t or "__" in t or "`" in t:
        return "markdown"
    if any(_LIST_LINE_RE.match(line) for line in t.splitlines()):
        return "list"
    wc = _word_count(t)
    if wc < MIN_WORDS or wc > MAX_WORDS:
        return f"length {wc}"
    return None


def describe(moves: dict) -> str:
    """The session as WORDS, so the model never needs a digit to reason with.
    Buckets are deliberately coarse - the exact number is on the chart."""
    def band(pct: float) -> str:
        a = abs(pct)
        way = "up" if pct > 0 else "down" if pct < 0 else "flat"
        if a < 0.25:
            return "flat"
        size = "barely" if a < 0.5 else "modestly" if a < 1.0 else "solidly" if a < 2.0 else "sharply"
        return f"{size} {way}"

    lines = []
    for sym, pct in moves.items():
        try:
            lines.append(f"{sym}: {band(float(pct))}")
        except (TypeError, ValueError):
            continue
    return "\n".join(lines)


def _prompt(facts: str) -> str:
    return (
        "You write the closing note for a trading community's daily chart post.\n\n"
        "Today's session, in words:\n" + facts + "\n\n"
        "Write two or three sentences a working trader would actually want to read: "
        "who led and who lagged, whether the move looked broad or narrow, and one thing "
        "worth watching next session.\n\n"
        "Rules:\n"
        "- NEVER write a number, a digit, a percentage or a price. Not one. The charts "
        "carry the numbers. Use words like broad, narrow, led, lagged, held, gave back.\n"
        "- Plain sentences. No markdown, no bullets, no headings, no emoji, no hashtags, "
        "no em-dashes, no @ mentions.\n"
        "- Speak like an experienced trader talking to people he respects. No hype, no "
        "certainty about tomorrow, no advice to buy or sell anything.\n"
        "- Do not mention charts, this message, or yourself.\n"
        "- Between twenty five and ninety words. Reply with the note only."
    )


def compose(moves: dict, *, client_fn=None, model: str | None = None) -> str:
    """The note, or "" when it cannot be written well. Never raises."""
    if not enabled() or not moves:
        return ""
    facts = describe(moves)
    if not facts:
        return ""
    try:
        if client_fn is not None:
            call = client_fn
        else:
            from api.services.engine import _get_anthropic_client
            c = _get_anthropic_client()
            if c is None:
                return ""

            def call(prompt: str) -> str:
                # ⛔ No temperature kwarg: the pinned SDK raises on it and the
                # Claude 5 family rejects sampling params.
                r = c.messages.create(
                    model=model or os.environ.get("DISCORD_CLOSE_NOTE_MODEL", MODEL),
                    max_tokens=MAX_TOKENS,
                    messages=[{"role": "user", "content": prompt}])
                return "".join(getattr(b, "text", "") for b in (r.content or []))
    except Exception as e:  # noqa: BLE001
        log.warning("[close-note] no client: %s", e)
        return ""

    prompt = _prompt(facts)
    for attempt in (1, 2):
        try:
            text = (call(prompt) or "").strip()
        except Exception as e:  # noqa: BLE001
            log.warning("[close-note] call failed (attempt %d): %s", attempt, e)
            return ""
        why = validate(text)
        if why is None:
            return text
        log.warning("[close-note] rejected (%s) on attempt %d", why, attempt)
        prompt = (_prompt(facts) + "\n\nYour previous reply was rejected because it "
                  + why + ". Write it again, obeying every rule.")
    return ""
