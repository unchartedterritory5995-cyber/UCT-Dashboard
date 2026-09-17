"""Extractor v0: the system prompt, the vocabulary, the output schema and the request
params (W1 §4.5-4.6, manifest §4.11 R1-R10, CONTRACTS §6.4).

extractor_version = "wx-v0-" + sha256(system prompt + contract schema + transport
revision)[:8]. The vocabulary is INSIDE the system prompt, so an approved-name
change is a prompt revision and gets a new version — and therefore needs its own
golden-gate run before it may extract the catalog.

DETERMINISM. W1 §4.6 asks for temperature 0. claude-opus-5 returns 400 for every
sampling parameter (temperature, top_p, top_k), and no assistant prefill is
accepted either, so none is ever sent (tests/test_wisdom_extract_batch.py drives a
fake that 400s on each). What makes a run repeatable instead: a byte-stable system
prompt and schema (the version hash), schema-constrained JSON output, a fixed
effort, and quote verification against the stored segment text. What remains
non-deterministic is measured, not assumed: the golden gate re-runs 10 segments
and records run-to-run drift (kind extractor_drift in wisdom_eval_runs).

THE SCHEMA has one authority, docs/wisdom/contracts/extraction-output-v0.schema.json.
api_schema() derives the transport form the Messages API accepts — $refs inlined,
keywords the structured-output grammar rejects (maxItems, minItems > 1, $schema,
$id, title) removed, and nullable types rewritten. The API compiles at most
API_MAX_UNION_PARAMS parameters with a union type (measured 2026-09-13: a 400
citing "limit: 16 parameters with unions" against the contract's 22), so a
nullable TEXT field travels as a plain string where "" means null, and only
numbers, entry_zone, principle and market_signal keep an anyOf with null. The
writer maps "" back to null (nullable_string_fields) and re-checks what was
removed (entry_zone has exactly two values).

This file is committed to a PUBLIC repository: the prompt states rules and uses
no quote from any paid session, newsletter or member.
"""
from __future__ import annotations

import copy
import functools
import hashlib
import re
import json
import pathlib
from typing import Optional

from api.services.wisdom.extract import seams

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
SCHEMA_FILE = REPO_ROOT / "docs" / "wisdom" / "contracts" / "extraction-output-v0.schema.json"
VOCAB_DRAFT_FILE = REPO_ROOT / "docs" / "wisdom" / "vocabulary" / "setup-vocabulary-v0.draft.json"

PROMPT_FAMILY = "wx-v0"
TRANSPORT_REVISION = "api-schema-t2"
MAX_TOKENS = 32000
EFFORTS = ("low", "medium", "high", "xhigh", "max")
MAX_ALIASES_PER_NAME = 6
API_MAX_UNION_PARAMS = 16
EMPTY_MEANS_NULL = "An empty string means no value."

_STRIP_KEYWORDS = frozenset({"$schema", "$id", "title", "maxItems", "minLength", "maxLength", "minimum",
                             "maximum", "multipleOf", "pattern"})
_TYPE_KEYWORDS = {
    "object": ("properties", "required", "additionalProperties"),
    "array": ("items", "minItems"),
}


# ── schema ───────────────────────────────────────────────────────────────────

@functools.lru_cache(maxsize=1)
def schema_text() -> str:
    return SCHEMA_FILE.read_text(encoding="utf-8")


def contract_schema() -> dict:
    return json.loads(schema_text())


def record_fields() -> tuple[str, ...]:
    return tuple(contract_schema()["$defs"]["record"]["required"])


def _nullable_strings(props: dict) -> frozenset:
    return frozenset(name for name, sub in props.items() if isinstance(sub, dict)
                     and isinstance(sub.get("type"), list) and set(sub["type"]) == {"string", "null"})


@functools.lru_cache(maxsize=1)
def nullable_string_fields() -> dict:
    """Where the transport sends "" for null. Key "" holds top-level record fields; any
    other key names a record field (an object, or an array of objects) whose own fields
    travel that way. Derived from the contract, never listed by hand."""
    record = contract_schema()["$defs"]["record"]["properties"]
    out = {"": _nullable_strings(record)}
    for name, sub in record.items():
        node = sub.get("items") if isinstance(sub, dict) and sub.get("type") == "array" else sub
        if isinstance(node, dict) and isinstance(node.get("properties"), dict):
            nested = _nullable_strings(node["properties"])
            if nested:
                out[name] = nested
    return out


def api_schema(schema: Optional[dict] = None) -> dict:
    schema = copy.deepcopy(schema if schema is not None else contract_schema())
    defs = schema.get("$defs") or {}

    def resolve(node):
        if isinstance(node, list):
            return [resolve(n) for n in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            ref = node["$ref"]
            if not ref.startswith("#/$defs/"):
                raise ValueError(f"unsupported $ref {ref!r}")
            target = copy.deepcopy(defs[ref.rsplit("/", 1)[-1]])
            target.update({k: v for k, v in node.items() if k != "$ref"})
            return resolve(target)
        out: dict = {}
        for key, value in node.items():
            if key in _STRIP_KEYWORDS or key == "$defs":
                continue
            if key == "minItems" and isinstance(value, int) and value > 1:
                continue
            if key == "properties" and isinstance(value, dict):
                out[key] = {name: resolve(sub) for name, sub in value.items()}
            else:
                out[key] = resolve(value)
        kind = out.get("type")
        if isinstance(kind, list) and set(kind) == {"string", "null"}:
            return {"type": "string", "description": (out.get("description", "") + " " + EMPTY_MEANS_NULL).strip()}
        if isinstance(kind, list):
            variants = []
            for t in kind:
                if t == "null":
                    continue
                variant = {"type": t}
                for kw in _TYPE_KEYWORDS.get(t, ("enum", "const", "format")):
                    if kw in out:
                        variant[kw] = out[kw]
                variants.append(variant)
            if "null" in kind:
                variants.append({"type": "null"})
            replaced = {"anyOf": variants}
            if "description" in out:
                replaced["description"] = out["description"]
            return replaced
        return out

    return resolve(schema)


# ── vocabulary ───────────────────────────────────────────────────────────────

def _normalise_vocab(items) -> list[dict]:
    out: list[dict] = []
    for item in items or []:
        if isinstance(item, str):
            name, aliases = item, []
        elif isinstance(item, dict):
            name = item.get("name")
            aliases = item.get("aliases") or item.get("aliases_as_used") or []
        else:
            continue
        if not name or not str(name).strip():
            continue
        clean = [str(a).strip() for a in aliases if str(a).strip() and str(a).strip().casefold() != str(name).casefold()]
        out.append({"name": str(name).strip(), "aliases": clean[:MAX_ALIASES_PER_NAME]})
    return out


def vocabulary() -> list[dict]:
    """[{name, aliases}] — core.vocab.list_for_prompt when S-B has landed, else the v0 draft."""
    fn = seams.seam("api.services.wisdom.core.vocab", "list_for_prompt")
    if fn is not None:
        try:
            items = _normalise_vocab(fn())
            if items:
                return items
        except Exception:
            pass
    draft = json.loads(VOCAB_DRAFT_FILE.read_text(encoding="utf-8"))
    return _normalise_vocab(draft.get("entries") or [])


def vocabulary_source() -> str:
    return "core.vocab.list_for_prompt" if seams.seam("api.services.wisdom.core.vocab", "list_for_prompt") \
        else "docs/wisdom/vocabulary/setup-vocabulary-v0.draft.json"


# ── the system prompt ────────────────────────────────────────────────────────

_RULES = """\
You extract structured teaching records from ONE segment of Uncharted Territory (UCT) trading content: a window of a live-session, workshop or education-video transcript, a section of the Sunday Scans newsletter, or a Discord message written by a team author. Return exactly one JSON object matching the output schema, with the segment_id you are given. Extract only what the text itself supports. If nothing in the segment qualifies, return an empty records list.

RECORD TYPES
CALL, NEGATIVE_CALL, MENTION, PRINCIPLE, LEVEL, MARKET_SIGNAL. One sentence can yield several records (two tickers passed on in one line; a call and the lesson it illustrates). Emit each one separately.

QUOTE RULES (a record whose quote breaks these is discarded by the server)
- quote is copied character for character from the segment text: same spelling, casing, punctuation, spacing and transcription errors. Never correct, paraphrase, shorten with "...", or add words.
- Use the shortest contiguous span that supports the record, usually one to three sentences.
- It must occur exactly once in the segment. If your span also appears elsewhere in the segment, extend it until it is unique.
- Never include the annotations the segment is displayed with: [HH:MM:SS] timestamps and {speaker} labels are not text. In a transcript, quote from inside one speaker turn.

RULES
R1 CALL needs a resolvable instrument (a ticker), a direction (long or short), and at least one of: a stated price, zone or level; a named, observable trigger ("gap down then red to green", "an undercut of the low", "a go signal on the hourly"); or a position action (taking, in it, added, trimmed, exited, stopped out). Anything less is a MENTION. "Watching it on the next pullback" with no level is a MENTION: a pullback is not an observable trigger.
R2 LISTS: a bare list of tickers is ONE MENTION record, never one record per ticker: put each unique ticker once, in the order listed, in tickers, leave ticker_as_written empty, and use the list as the quote. The server expands it into one MENTION per ticker. When the author defines what the list means, put that meaning in reason.
R3 NEGATIVE_CALL needs an explicit ticker and an explicit pass or avoid ("passed on", "an avoid", "not taking that"). A no-view ("no thoughts on it", "no view") is a MENTION with stance no_view, never a NEGATIVE_CALL. A pass that is only implied for tickers not named is not extracted.
R4 HINDSIGHT: a teaching or retrospective example of a trade that was not a forward call ("look at this one from yesterday, there was your entry") is a CALL with stance hindsight and hindsight true. Set hindsight true on any record that describes a past trade as a lesson.
R5 LEVELS AS STATED: record prices exactly as stated; never infer a price from a chart, from memory or from market knowledge. Derive a value only when the text defines it: a stop "at breakeven" equals the stated entry. Otherwise leave the number null and keep the wording (stop_text, trigger, targets[].text). A stated range goes in entry_zone as [low, high]. A reference level (HVC, gap, support, resistance, AVWAP) goes in levels, not in entry or stop.
R6 AUTHORSHIP: copy the speaker label exactly as displayed into speaker_label, or the empty string when there is none. Never guess who is speaking from voice, style or content; the server decides authorship.
R7 STATED OUTCOMES: when the author states a result ("closed it from X to Y", "got stopped"), set stated_outcome, and stated_return_pct only when a percentage is stated or follows purely from two stated prices. Never look up what happened.
R8 PRINCIPLES: a general rule or lesson is a PRINCIPLE; principle.statement restates it close to the author's own words. Do not resolve contradictions and do not judge whether a principle is canonical: extract what was said, even when it disagrees with something else the author said. empirical_claim is true when the principle asserts something measurable ("statistically", a win rate); testable_claim restates that claim in testable form, else the empty string.
R8a PRINCIPLE SHAPE, and it is strict because two runs over the same paragraph must produce the same record:
 - statement is AT MOST 30 WORDS. Say the rule, not the surrounding talk.
 - ONE CLAIM per record. If the author states two rules, emit two PRINCIPLE records. Never join them with "and also", a semicolon, or a second sentence.
 - principle.category is EXACTLY ONE OF: risk, entry, exit, sizing, psychology, market_context, scanning. Nothing else is a category.
 - Prefer the author's own words for the rule itself. Do not paraphrase a statement you could quote.
R8b MOST SEGMENTS CONTAIN NO PRINCIPLE, AND THAT IS A CORRECT ANSWER. Housekeeping, greetings, logistics, banter, a tangent, reading a chart aloud, or naming tickers without stating a rule all contain NO principle. Emit no PRINCIPLE record for them. Do not manufacture a general rule out of a specific observation about one ticker, and do not restate the segment's topic as a principle. An empty records list is a valid response to a whole segment.
R8c MARKET_SIGNAL is a stated read on the whole market, an index or a sector. market_signal.name is a SHORT NAME, at most 12 words ("breadth washout", "risk-off", "nasdaq leading") — not a sentence and not the quote. direction is exactly one of: bullish, bearish, neutral, or null when the author states a read without a side. The same rule as R8b applies: most segments contain no market signal.
R9 SPEECH-TO-TEXT: transcripts contain recognition errors. When a ticker was transcribed as a word or a company name, put your best symbol in ticker_as_written and the word as transcribed in ticker_as_heard. When a spoken price lost its scale ("9.30" said for 930), put the transcribed form in price_as_heard, your reading in price, and lower extraction_confidence. When you cannot tell which ticker was meant, set extraction_confidence to low rather than guessing silently.
R10 CHARTS: in the newsletter a short line such as "SPY (Daily)" labels the chart that follows it; attribute the prose beneath a label to that ticker and timeframe. You cannot see the images; never describe them.

FIELD RULES
- direction, stance, timeframe, trigger_timeframe, reason_class, stated_outcome, level type and extraction_confidence take only the listed values (or null where allowed).
- setup_vocab is exactly one of the vocabulary names listed below, or the empty string. Put the author's own wording for the setup in setup_name_raw whether or not it maps.
- tickers is only for a list record (R2); otherwise [].
- entry is a stated entry price. size_shares is a stated share count. Record both as stated; the server decides what is stored where.
- confidence_language holds verbatim phrases of conviction or doubt. Never turn them into a score, and keep contradictory phrases side by side.
- event_at_text keeps relative timing as worded ("Friday", "this week"); never convert it to a date.
- For NEGATIVE_CALL, reason says why it was passed and reason_class classifies it: chart, liquidity, opportunity_cost, fundamental, or none when no reason is given.
- LEVEL is a stated price level on a ticker that is not part of a CALL. MARKET_SIGNAL is a stated read on the whole market, an index or a sector (breadth, regime, risk appetite).
- Fields that do not apply are null, or [] for lists; a text field with no value is the empty string "". extraction_confidence says how clearly the text supports the record. notes is short and only for something the record needs flagged.
"""


def system_prompt(vocab: Optional[list[dict]] = None) -> str:
    vocab = vocabulary() if vocab is None else vocab
    lines = []
    for entry in vocab:
        alias = f" (also said as: {', '.join(entry['aliases'])})" if entry.get("aliases") else ""
        lines.append(f"- {entry['name']}{alias}")
    return _RULES + "\nSETUP VOCABULARY (the only values allowed in setup_vocab)\n" + "\n".join(lines) + "\n"


def extractor_version(system_text: Optional[str] = None) -> str:
    system_text = system_prompt() if system_text is None else system_text
    digest = hashlib.sha256(
        "\n\x1e\n".join([system_text, schema_text(), TRANSPORT_REVISION]).encode("utf-8")).hexdigest()
    # A LOCAL RUN MUST NEVER SHARE A VERSION WITH A PAID ONE. The digest hashes the PROMPT,
    # not the model, so without this branch a local extraction and a paid one would carry the
    # same extractor_version - and reconcile.score_silently would then compare records made by
    # two different models as if they were repeat passes of one. That is not a stability
    # measurement; it is a model comparison wearing stability of its name.
    # The PAID version is untouched here, deliberately: wx-v0-fc47bc97 is pinned in the
    # accepted golden-gate row in production, and changing it would shut the gate.
    from api.services.wisdom.extract import config

    if config.is_local():
        from api.services.wisdom.extract import local_backend

        raw = local_backend.local_model().lower()
        slug = re.sub("[^a-z0-9]+", "-", raw).strip("-")[:24]
        return f"wx-local-{slug}-{digest[:8]}"
    return f"{PROMPT_FAMILY}-{digest[:8]}"


# ── the user message ─────────────────────────────────────────────────────────

def _hms(seconds: Optional[float]) -> str:
    if seconds is None:
        return "--:--:--"
    s = int(max(0, float(seconds)))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def render_segment_body(segment: dict) -> str:
    """Transcript windows are shown as speaker turns so authorship is visible; every
    turn's text is an exact slice of the segment text. Sections and messages are shown
    as-is."""
    text = segment.get("text") or ""
    cue_map = segment.get("cue_map") or []
    if segment.get("kind") != "cue_window" or not cue_map:
        return text
    turns: list[tuple[float, Optional[str], int, int]] = []
    for offset, t, speaker, length in cue_map:
        end = offset + length
        if turns:
            t0, sp, start, prev_end = turns[-1]
            if sp == speaker and end - start <= 700 and float(t) - t0 <= 45 + (end - start) / 12:
                turns[-1] = (t0, sp, start, end)
                continue
        turns.append((float(t), speaker, offset, end))
    lines = []
    for t0, speaker, start, end in turns:
        body = text[start:end]
        if not body.strip():
            continue
        label = f" {{{speaker}}}" if speaker else ""
        lines.append(f"[{_hms(t0)}]{label} {body}")
    return "\n".join(lines)


def user_message(segment: dict, source: dict, hints: Optional[list[str]] = None) -> str:
    guests = source.get("guest_names_json") or "[]"
    try:
        guest_list = json.loads(guests) if isinstance(guests, str) else list(guests)
    except ValueError:
        guest_list = []
    head = [
        "<source>",
        f"stream: {source.get('stream') or 'unknown'}",
        f"title: {source.get('title') or ''}",
        f"show: {source.get('show') or ''}",
        f"published_at: {source.get('published_at_et') or ''}",
        f"recording_started_at: {source.get('recording_started_at_et') or ''}",
        f"host: {source.get('host_author_id') or ''}",
        f"guests: {', '.join(str(g) for g in guest_list) if guest_list else 'none'}",
        "</source>",
    ]
    attrs = [f'id="{segment.get("segment_id")}"', f'kind="{segment.get("kind")}"']
    if segment.get("path"):
        attrs.append(f'path="{str(segment["path"]).replace(chr(34), chr(39))}"')
    if segment.get("t_start_s") is not None:
        attrs.append(f'from="{_hms(segment.get("t_start_s"))}" to="{_hms(segment.get("t_end_s"))}"')
    parts = head + [f"<segment {' '.join(attrs)}>", render_segment_body(segment), "</segment>"]
    if hints:
        parts += ["<asr_hints>", *[f"- {h}" for h in hints], "</asr_hints>"]
    parts.append(f'Return the JSON object for segment_id "{segment.get("segment_id")}".')
    return "\n".join(parts)


def asr_hints(segment: dict) -> list[str]:
    if segment.get("kind") != "cue_window":
        return []
    fn = seams.seam("api.services.wisdom.core.aliases", "apply_aliases")
    if fn is None:
        return []
    try:
        _text, corrections = fn(segment.get("text") or "")
    except Exception:
        return []
    hints = []
    for c in corrections or []:
        if isinstance(c, dict):
            raw, norm = c.get("raw") or c.get("raw_value"), c.get("normalized") or c.get("normalized_value")
        elif isinstance(c, (list, tuple)) and len(c) >= 2:
            raw, norm = c[0], c[1]
        else:
            continue
        if raw and norm:
            hints.append(f"'{raw}' may mean {norm}")
    return hints[:20]


def build_params(segment: dict, source: dict, *, model: str, effort: str, max_tokens: int = MAX_TOKENS,
                 system_text: Optional[str] = None, hints: Optional[list[str]] = None) -> dict:
    """One Messages request. No temperature/top_p/top_k, no prefill, no fallbacks."""
    if effort not in EFFORTS:
        raise ValueError(f"effort must be one of {EFFORTS}")
    return {
        "model": model,
        "max_tokens": int(max_tokens),
        "system": [{"type": "text", "text": system_prompt() if system_text is None else system_text,
                    "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": user_message(segment, source, hints)}],
        "output_config": {"format": {"type": "json_schema", "schema": api_schema()}, "effort": effort},
    }
