"""Model output -> wisdom_records, with every labeling rule the code can enforce
(W1 §4.2, §4.5, §4.7, D14, D16a; manifest §4.11 R1-R10; CONTRACTS §6.4).

Two halves on purpose:
  * validate_output() is PURE — no store, no network. The golden gate scores the
    same validation production runs, so a rule cannot be applied in one and not
    the other.
  * write_output() persists what survived, idempotently.

WHAT A RECORD HAS TO SURVIVE (each rejection or downgrade is COUNTED by name):
  1. its quote occurs exactly once in the segment text (quote_absent / quote_ambiguous);
  2. R1: a CALL has a ticker, a direction, and a level, a named trigger or a position
     action — else MENTION; "next pullback" alone is not an observable trigger;
  3. R3: a no-view is never a NEGATIVE_CALL; a NEGATIVE_CALL names its ticker;
  4. D14: a guest authors MENTION and PRINCIPLE only — a guest never CALLs;
  5. §2.1: CALL and NEGATIVE_CALL only from the four CALL authors;
  6. W1 §4.2: a CALL needs a resolved entity (core.entities.resolve). With no
     resolver installed every CALL is downgraded — a ticker shape is not a
     resolution — and the reason says which case it was;
  7. R4: stance hindsight <=> hindsight true;
  8. setup_vocab must be an approved vocabulary name, else null (raw name kept).

PRIVATE FIELDS (D16a): size_shares, and entry on an OPEN position, never reach
wisdom.db. They go to core.private.put_private; when that store is absent or
refuses, the value is DROPPED and counted. record_hash is computed over the record
with those fields already removed, so not even a hash of a private value is stored.

IDEMPOTENCY: UNIQUE(segment_id, extractor_version, record_hash) plus an overlap
key (source, source version, extractor version, record_type, ticker, normalised
quote) so the same statement read through two overlapping windows is stored once.
Nothing is ever deleted: re-extraction marks older provisional records superseded.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Callable, Optional

from api.services.wisdom.core import authors, ids, timeutil
from api.services.wisdom.extract import prompt, seams, segmenter

log = logging.getLogger(__name__)

WRITER_VERSION = "wr-v0"
RECORD_TYPES = ("CALL", "NEGATIVE_CALL", "MENTION", "PRINCIPLE", "LEVEL", "MARKET_SIGNAL")
TICKER_TYPES = frozenset({"CALL", "NEGATIVE_CALL", "MENTION", "LEVEL"})
CALL_TYPES = frozenset({"CALL", "NEGATIVE_CALL"})
GUEST_TYPES = frozenset({"MENTION", "PRINCIPLE"})
STANCES = frozenset({"watching", "taking", "in_it", "added", "trimmed", "exited", "stopped_out", "hindsight",
                     "passed", "avoid", "no_view"})
POSITION_STANCES = frozenset({"taking", "in_it", "added", "trimmed", "exited", "stopped_out"})
OPEN_POSITION_STANCES = frozenset({"taking", "in_it", "added", "trimmed"})
ENUMS = {
    "direction": frozenset({"long", "short"}),
    "stance": STANCES,
    "timeframe": frozenset({"1", "5", "15", "30", "60", "D", "W", "M"}),
    "trigger_timeframe": frozenset({"1", "5", "15", "30", "60", "D", "W", "M", "intraday"}),
    "reason_class": frozenset({"chart", "liquidity", "opportunity_cost", "fundamental", "none"}),
    "stated_outcome": frozenset({"profit", "loss", "breakeven", "stopped", "still_holding"}),
}
CONFIDENCES = frozenset({"high", "medium", "low"})
NUMERIC_FIELDS = ("entry", "stop", "size_shares", "stated_return_pct")
PRIVATE_FIELDS = ("size_shares", "open_entry")
TICKER_SHAPE = re.compile(r"^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$")
_PULLBACK_ONLY = re.compile(r"(?i)\bpull\s*-?\s*backs?\b")
PROVENANCE_FIELDS = ("quote", "ticker_as_written", "ticker_as_heard", "direction", "stance", "setup_name_raw",
                     "setup_vocab", "timeframe", "trigger_timeframe", "trigger", "entry", "entry_zone", "stop",
                     "stop_text", "targets", "levels", "thesis", "confidence_language", "reason", "reason_class",
                     "stated_outcome", "stated_return_pct", "event_at_text", "principle", "market_signal")


def normalize_quote_key(quote: str) -> str:
    return " ".join(str(quote or "").casefold().split())


def normalize_ticker(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    t = value.strip().lstrip("$").strip().upper()
    return t or None


def _num(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


@dataclass
class Checked:
    fields: dict
    model_type: str
    pre_entity_type: str
    record_type: str
    ticker: Optional[str]
    quote: str
    q_start: int
    q_end: int
    author_id: Optional[str]
    is_guest: bool
    speaker_confidence: Optional[str]
    entity: Optional[dict]
    private: dict
    record_hash: str
    hindsight: bool
    reasons: list = field(default_factory=list)

    def key(self, pre_entity: bool = False) -> tuple:
        rtype = self.pre_entity_type if pre_entity else self.record_type
        if rtype == "PRINCIPLE":
            stmt = (self.fields.get("principle") or {}).get("statement") or self.quote
            return (rtype, normalize_quote_key(stmt))
        if rtype == "MARKET_SIGNAL":
            return (rtype, normalize_quote_key((self.fields.get("market_signal") or {}).get("name") or ""))
        return (rtype, self.ticker, self.fields.get("stance"), self.fields.get("direction"))


@dataclass
class Validation:
    kept: list
    counts: Counter

    def as_dict(self) -> dict:
        return {"kept": len(self.kept), "counts": dict(self.counts)}


# ── seams ────────────────────────────────────────────────────────────────────

def _resolver(resolver: Any) -> Optional[Callable]:
    if resolver == "auto":
        return seams.seam("api.services.wisdom.core.entities", "resolve")
    return resolver


def _private_put(private_put: Any) -> Optional[Callable]:
    if private_put == "auto":
        return seams.seam("api.services.wisdom.core.private", "put_private")
    return private_put


# ── authorship ───────────────────────────────────────────────────────────────

def _guest_names(source: dict) -> list[str]:
    raw = source.get("guest_names_json") or "[]"
    try:
        names = json.loads(raw) if isinstance(raw, str) else list(raw)
    except ValueError:
        return []
    return [str(n).strip() for n in names if str(n).strip()]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.casefold()).strip("-")[:40] or "unknown"


def resolve_author(label: Optional[str], segment: dict, source: dict) -> tuple[Optional[str], bool, Optional[str]]:
    """(author_id, is_guest, speaker_confidence). Authorship is fixed by authors.json and
    the source metadata, never inferred from voice (§2.1, D14, R6)."""
    guests = _guest_names(source)
    if label:
        folded = label.strip().casefold()
        for guest in guests:
            g = guest.casefold()
            if folded == g or folded.startswith(g) or g.startswith(folded):
                return f"guest:{_slug(guest)}", True, "medium"
        author = authors.author_for_alias(label)
        if author:
            return author, False, "high"
        if segment.get("author_id"):
            return segment["author_id"], False, segment.get("speaker_confidence") or "medium"
        return None, False, "low"
    if segment.get("author_id"):
        return segment["author_id"], False, segment.get("speaker_confidence") or "medium"
    if source.get("host_author_id") and not guests and source.get("stream") in ("zoom_live", "education", "discord"):
        return source["host_author_id"], False, "low"
    return None, False, "low"


# ── validation ───────────────────────────────────────────────────────────────

def _canonical_hash(fields: dict, model_type: str) -> str:
    body = dict(fields)
    body["record_type"] = model_type
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                                     default=str).encode("utf-8")).hexdigest()


def _has_price_info(r: dict) -> bool:
    return any([
        r.get("entry") is not None, r.get("entry_zone"), r.get("stop") is not None, r.get("stop_text"),
        any(_num((lv or {}).get("price")) is not None for lv in r.get("levels") or []),
        any(_num((tg or {}).get("price")) is not None for tg in r.get("targets") or []),
    ])


def _check(raw: dict, *, text: str, segment: dict, source: dict, vocab: set, resolve: Optional[Callable],
           as_of: Any, call_authors: frozenset, counts: Counter):
    fields_order = prompt.record_fields()
    r = {name: raw.get(name) for name in fields_order}
    if any(name not in raw for name in fields_order):
        counts["missing_fields_filled_null"] += 1
    # The transport carries a nullable text field as "" (prompt.API_MAX_UNION_PARAMS).
    for parent, names in prompt.nullable_string_fields().items():
        holders = [r] if not parent else (r.get(parent) if isinstance(r.get(parent), list) else [r.get(parent)])
        for holder in holders:
            if isinstance(holder, dict):
                for name in names:
                    if isinstance(holder.get(name), str) and not holder[name].strip():
                        holder[name] = None
    model_type = r.get("record_type")
    if model_type not in RECORD_TYPES:
        return "record_type_invalid"
    quote = r.get("quote")
    if not isinstance(quote, str) or not quote.strip():
        return "quote_missing"
    quote = quote.strip()
    occurrences = text.count(quote)
    if occurrences == 0:
        return "quote_absent"
    if occurrences > 1:
        return "quote_ambiguous"
    r["quote"] = quote
    q_start = text.index(quote)

    for name, allowed in ENUMS.items():
        if r.get(name) is not None and r[name] not in allowed:
            counts[f"invalid_enum:{name}"] += 1
            r[name] = None
    if r.get("extraction_confidence") not in CONFIDENCES:
        r["extraction_confidence"] = "low"
    for name in NUMERIC_FIELDS:
        if r.get(name) is not None and _num(r[name]) is None:
            counts[f"invalid_number:{name}"] += 1
            r[name] = None
    zone = r.get("entry_zone")
    if zone is not None:
        if isinstance(zone, list) and len(zone) == 2 and all(_num(z) is not None for z in zone):
            r["entry_zone"] = sorted(float(z) for z in zone)
        else:
            counts["entry_zone_not_a_pair"] += 1
            r["entry_zone"] = None
    for name in ("tickers", "targets", "levels", "confidence_language"):
        if not isinstance(r.get(name), list):
            r[name] = []
    if r.get("setup_vocab") is not None and r["setup_vocab"] not in vocab:
        counts["setup_vocab_not_in_vocabulary"] += 1
        r["setup_vocab"] = None

    reasons: list[str] = []
    rtype = model_type
    ticker = normalize_ticker(r.get("ticker_as_written"))
    hindsight = bool(r.get("hindsight")) or r.get("stance") == "hindsight"
    r["hindsight"] = hindsight

    if rtype in TICKER_TYPES and not ticker:
        return f"{rtype.lower()}_without_ticker"
    if rtype == "PRINCIPLE":
        principle = r.get("principle")
        if not isinstance(principle, dict) or not str(principle.get("statement") or "").strip():
            return "principle_without_statement"
    if rtype == "MARKET_SIGNAL":
        signal = r.get("market_signal")
        if not isinstance(signal, dict) or not str(signal.get("name") or "").strip():
            return "market_signal_without_name"

    if r.get("stance") == "no_view" and rtype in CALL_TYPES:
        rtype = "MENTION"
        reasons.append("no_view_is_never_a_call")
    if rtype == "CALL":
        if r.get("direction") is None:
            rtype, _ = "MENTION", reasons.append("call_without_direction")
        elif not (_has_price_info(r) or r.get("trigger") or r.get("stance") in POSITION_STANCES or hindsight):
            rtype, _ = "MENTION", reasons.append("call_without_level_trigger_or_action")
        elif (r.get("trigger") and _PULLBACK_ONLY.search(str(r["trigger"])) and not _has_price_info(r)
              and r.get("stance") not in POSITION_STANCES and not hindsight):
            rtype, _ = "MENTION", reasons.append("trigger_not_observable")

    label = r.get("speaker_label") if isinstance(r.get("speaker_label"), str) else None
    author_id, is_guest, speaker_confidence = resolve_author(label or segment.get("speaker_label"), segment, source)
    if is_guest and rtype not in GUEST_TYPES:
        if not ticker:
            return "guest_record_without_ticker"
        rtype = "MENTION"
        reasons.append("guest_authors_mention_or_principle_only")
    if rtype in CALL_TYPES and author_id not in call_authors:
        rtype = "MENTION"
        reasons.append("not_a_call_author")
    pre_entity_type = rtype

    entity = None
    if ticker:
        if resolve is not None:
            try:
                entity = resolve(ticker, as_of)
            except Exception:
                log.exception("[wisdom-extract] entity resolve failed for %s", ticker)
                entity = None
        if rtype == "CALL" and not (isinstance(entity, dict) and entity.get("entity_id")):
            rtype = "MENTION"
            if resolve is None:
                reasons.append("call_entity_unresolved:no_resolver" if TICKER_SHAPE.match(ticker)
                               else "call_entity_unresolved:ticker_shape")
            else:
                reasons.append("call_entity_unresolved")

    private: dict = {}
    if r.get("size_shares") is not None:
        private["size_shares"] = r["size_shares"]
        r["size_shares"] = None
    open_position = (r.get("stance") in OPEN_POSITION_STANCES or r.get("stated_outcome") == "still_holding")
    if r.get("entry") is not None and open_position and not hindsight:
        private["open_entry"] = r["entry"]
        r["entry"] = None

    for reason in reasons:
        counts[f"downgrade:{reason}"] += 1
    if hindsight:
        counts["hindsight_tagged"] += 1
    record_hash = _canonical_hash(r, model_type)
    return Checked(fields=r, model_type=model_type, pre_entity_type=pre_entity_type, record_type=rtype,
                   ticker=ticker, quote=quote, q_start=q_start, q_end=q_start + len(quote), author_id=author_id,
                   is_guest=is_guest, speaker_confidence=speaker_confidence,
                   entity=entity if isinstance(entity, dict) else None, private=private, record_hash=record_hash,
                   hindsight=hindsight, reasons=reasons)


def validate_output(output: Any, *, segment: dict, source: dict, resolver: Any = "auto",
                    vocab_names: Optional[set] = None, as_of: Any = None) -> Validation:
    counts: Counter = Counter()
    if not isinstance(output, dict) or not isinstance(output.get("records"), list):
        counts["bad_output"] += 1
        return Validation([], counts)
    if output.get("segment_id") not in (None, segment.get("segment_id")):
        counts["segment_id_mismatch"] += 1
    text = segment.get("text") or ""
    vocab = set(vocab_names) if vocab_names is not None else {v["name"] for v in prompt.vocabulary()}
    resolve = _resolver(resolver)
    call_authors = authors.call_authors()

    expanded: list[dict] = []
    for raw in output["records"]:
        if not isinstance(raw, dict):
            counts["reject:not_an_object"] += 1
            continue
        listed = [normalize_ticker(t) for t in (raw.get("tickers") or []) if isinstance(t, str)]
        listed = list(dict.fromkeys(t for t in listed if t))
        if raw.get("record_type") == "MENTION" and listed and not normalize_ticker(raw.get("ticker_as_written")):
            counts["list_record_expanded"] += 1
            for ticker in listed:
                expanded.append(dict(raw, ticker_as_written=ticker, tickers=[]))
            continue
        expanded.append(raw)

    kept: list[Checked] = []
    seen: set = set()
    for raw in expanded:
        checked = _check(raw, text=text, segment=segment, source=source, vocab=vocab, resolve=resolve,
                         as_of=as_of, call_authors=call_authors, counts=counts)
        if isinstance(checked, str):
            counts[f"reject:{checked}"] += 1
            continue
        if checked.record_hash in seen:
            counts["duplicate_in_output"] += 1
            continue
        seen.add(checked.record_hash)
        kept.append(checked)
    counts["kept"] = len(kept)
    return Validation(kept, counts)


# ── persistence ──────────────────────────────────────────────────────────────

def load_segment(conn, segment_id: str) -> Optional[dict]:
    row = conn.execute("SELECT * FROM wisdom_segments WHERE segment_id = ?", (segment_id,)).fetchone()
    if row is None:
        return None
    seg = dict(row)
    seg["cue_map"] = segmenter.cue_map_for(conn, segment_id)
    return seg


def load_source(conn, source_id: str, version: Optional[int] = None) -> Optional[dict]:
    if version is None:
        row = conn.execute("SELECT * FROM wisdom_sources WHERE source_id = ?", (source_id,)).fetchone()
    else:
        row = conn.execute("SELECT * FROM wisdom_sources WHERE source_id = ? AND version = ?",
                           (source_id, int(version))).fetchone()
        if row is None:
            row = conn.execute("SELECT * FROM wisdom_sources WHERE source_id = ?", (source_id,)).fetchone()
    return dict(row) if row is not None else None


def _stated_at(source: dict, segment: dict, t_start: Optional[float]) -> tuple[Optional[str], Optional[str]]:
    started = timeutil.parse_iso(source.get("recording_started_at_et"))
    if segment.get("kind") == "cue_window" and started is not None and t_start is not None:
        return timeutil.iso_et(started + timedelta(seconds=float(t_start))), "minute"
    published = timeutil.parse_iso(source.get("published_at_et"))
    if published is None:
        return None, None
    if source.get("stream") == "discord":
        return timeutil.iso_et(published), "minute"
    return timeutil.iso_et(published), "day"


def _span_of(sub: Optional[str], checked: Checked) -> tuple[int, int]:
    if isinstance(sub, str) and sub.strip():
        idx = checked.quote.casefold().find(sub.strip().casefold())
        if idx >= 0:
            return checked.q_start + idx, checked.q_start + idx + len(sub.strip())
    return checked.q_start, checked.q_end


def _vocab_id(conn, name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    try:
        row = conn.execute("SELECT vocab_id FROM wisdom_vocab WHERE name = ?", (name,)).fetchone()
    except Exception:
        return None
    return row[0] if row else None


def write_output(conn, *, segment: dict, source: dict, output: Any, extractor_version: str,
                 resolver: Any = "auto", private_put: Any = "auto", vocab_names: Optional[set] = None,
                 now_iso: Optional[str] = None) -> dict:
    """Persist one segment's output inside the caller's write transaction."""
    as_of = source.get("published_at_et") or source.get("recording_started_at_et")
    validation = validate_output(output, segment=segment, source=source, resolver=resolver,
                                 vocab_names=vocab_names, as_of=as_of)
    counts: Counter = Counter(validation.counts)
    put = _private_put(private_put)
    candidate = seams.seam("api.services.wisdom.core.vocab", "record_candidate")
    now = now_iso or timeutil.iso_et(timeutil.now_et())
    segment_id = segment["segment_id"]
    cue_map = segment.get("cue_map") or []
    written_ids: list[str] = []

    for ch in validation.kept:
        exists = conn.execute(
            "SELECT record_id FROM wisdom_records WHERE segment_id = ? AND extractor_version = ? AND record_hash = ?",
            (segment_id, extractor_version, ch.record_hash)).fetchone()
        if exists:
            counts["already_written"] += 1
            continue
        dedupe_key = ids.sha24(segment.get("source_id"), segment.get("source_version"), extractor_version,
                               ch.record_type, ch.ticker or "", normalize_quote_key(ch.quote))
        if conn.execute("SELECT 1 FROM wisdom_extract_record_keys WHERE dedupe_key = ?", (dedupe_key,)).fetchone():
            counts["dedupe_overlapping_window"] += 1
            continue
        record_id = ids.sha24(segment_id, extractor_version, ch.record_hash)
        f = ch.fields
        t_start = segmenter.time_at(cue_map, ch.q_start - 0) if cue_map else segment.get("t_start_s")
        t_end = segmenter.time_at(cue_map, max(ch.q_start, ch.q_end - 1)) if cue_map else segment.get("t_end_s")
        stated_at, precision = _stated_at(source, segment, t_start)
        principle_key = None
        if ch.record_type == "PRINCIPLE" and isinstance(f.get("principle"), dict):
            statement = str(f["principle"].get("statement") or "")
            principle_key = "p_" + ids.sha24("principle", ch.author_id or "", normalize_quote_key(statement))
        entity = ch.entity or {}
        zone = f.get("entry_zone") or [None, None]
        conn.execute(
            "INSERT OR IGNORE INTO wisdom_records (record_id, record_type, segment_id, source_id, source_version, "
            "extractor_version, record_hash, author_id, is_guest, stated_at_et, stated_at_precision, event_at_text, "
            "entity_id, ticker, ticker_as_written, ticker_as_heard, tickers_json, entity_confidence, direction, "
            "stance, setup_name_raw, vocab_id, timeframe, trigger_timeframe, trigger_text, entry, entry_zone_lo, "
            "entry_zone_hi, stop, stop_text, targets_json, levels_json, thesis, confidence_language_json, reason, "
            "reason_class, stated_outcome, stated_return_pct, hindsight, principle_key, market_signal_json, "
            "extraction_confidence, status, has_private, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
            "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'provisional', 0, ?)",
            (record_id, ch.record_type, segment_id, segment.get("source_id"), segment.get("source_version"),
             extractor_version, ch.record_hash, ch.author_id, int(ch.is_guest), stated_at, precision,
             f.get("event_at_text"), entity.get("entity_id"), ch.ticker, f.get("ticker_as_written"),
             f.get("ticker_as_heard"), json.dumps(f.get("tickers") or []), entity.get("confidence"),
             f.get("direction"), f.get("stance"), f.get("setup_name_raw"),
             _vocab_id(conn, f.get("setup_vocab")), f.get("timeframe"), f.get("trigger_timeframe"),
             f.get("trigger"), f.get("entry"), zone[0], zone[1], f.get("stop"), f.get("stop_text"),
             json.dumps(f.get("targets") or []), json.dumps(f.get("levels") or []), f.get("thesis"),
             json.dumps(f.get("confidence_language") or []), f.get("reason"), f.get("reason_class"),
             f.get("stated_outcome"), f.get("stated_return_pct"), int(ch.hindsight), principle_key,
             json.dumps(f["market_signal"]) if isinstance(f.get("market_signal"), dict) else None,
             f.get("extraction_confidence"), now))
        conn.execute("INSERT OR IGNORE INTO wisdom_extract_record_keys (dedupe_key, record_id, created_at) "
                     "VALUES (?, ?, ?)", (dedupe_key, record_id, now))

        stored_private = False
        for name, value in ch.private.items():
            if put is None:
                counts[f"private_dropped_no_store:{name}"] += 1
                continue
            try:
                ok = bool(put(record_id, name, value, f"segment:{segment_id}#{ch.q_start}-{ch.q_end}"))
            except Exception:
                log.exception("[wisdom-extract] put_private failed for %s", record_id)
                ok = False
            if ok:
                stored_private = True
                counts[f"private_stored:{name}"] += 1
            else:
                counts[f"private_dropped_store_refused:{name}"] += 1
        if stored_private:
            conn.execute("UPDATE wisdom_records SET has_private = 1 WHERE record_id = ?", (record_id,))

        for name in PROVENANCE_FIELDS:
            value = ch.quote if name == "quote" else f.get(name)
            if value in (None, [], ""):
                continue
            start, end = _span_of(f.get("ticker_as_written") if name == "ticker_as_written" else None, ch)
            conn.execute(
                "INSERT OR IGNORE INTO wisdom_field_provenance (record_id, field, segment_id, char_start, char_end, "
                "t_start_s, t_end_s, bbox_json, extractor_version, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
                (record_id, name, segment_id, start, end, t_start, t_end, extractor_version,
                 f.get("extraction_confidence")))

        if principle_key:
            p = f["principle"]
            known = conn.execute("SELECT 1 FROM wisdom_principles WHERE principle_key = ?", (principle_key,)).fetchone()
            if not known:
                conn.execute(
                    "INSERT OR IGNORE INTO wisdom_principles (principle_key, statement, category, author_id, is_guest, "
                    "first_seen_at, empirical_claim, testable_claim, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'provisional')",
                    (principle_key, str(p.get("statement")), str(p.get("category") or "risk"), ch.author_id,
                     int(ch.is_guest), stated_at or now, int(bool(p.get("empirical_claim"))), p.get("testable_claim")))
                relation = "states"
            else:
                relation = "reinforces"
                conn.execute("UPDATE wisdom_principles SET times_reinforced = times_reinforced + 1 "
                             "WHERE principle_key = ?", (principle_key,))
            conn.execute("INSERT OR IGNORE INTO wisdom_principle_support (principle_key, record_id, relation) "
                         "VALUES (?, ?, ?)", (principle_key, record_id, relation))

        if f.get("setup_name_raw") and not f.get("setup_vocab"):
            if candidate is None:
                counts["vocab_candidate_pending_no_store"] += 1
            else:
                try:
                    candidate(f["setup_name_raw"], record_id=record_id, author_id=ch.author_id,
                              locator=f"segment:{segment_id}#{ch.q_start}-{ch.q_end}")
                    counts["vocab_candidate_recorded"] += 1
                except Exception:
                    log.exception("[wisdom-extract] record_candidate failed")
                    counts["vocab_candidate_failed"] += 1
        written_ids.append(record_id)
        counts["written"] += 1

    counts["superseded"] += supersede_segment(conn, segment_id, extractor_version, written_ids)
    return dict(counts)


def _identity(conn, record_id: str) -> Optional[tuple]:
    row = conn.execute(
        "SELECT r.record_type, r.ticker, p.char_start, p.char_end, s.text FROM wisdom_records r "
        "JOIN wisdom_field_provenance p ON p.record_id = r.record_id AND p.field = 'quote' "
        "JOIN wisdom_segments s ON s.segment_id = r.segment_id WHERE r.record_id = ?", (record_id,)).fetchone()
    if row is None:
        return None
    quote = (row[4] or "")[row[2]:row[3]]
    return (row[0], row[1], normalize_quote_key(quote))


def supersede_segment(conn, segment_id: str, extractor_version: str, new_record_ids: list[str]) -> int:
    """A newer extractor version's reading of a segment supersedes older PROVISIONAL records
    of that segment. Confirmed records are the owner's and are never touched. Never a delete."""
    old = conn.execute(
        "SELECT record_id FROM wisdom_records WHERE segment_id = ? AND extractor_version != ? "
        "AND status = 'provisional'", (segment_id, extractor_version)).fetchall()
    return _mark_superseded(conn, [r[0] for r in old], new_record_ids)


def supersede_source_versions(conn, source_id: str, current_version: int, extractor_version: str) -> int:
    old = conn.execute(
        "SELECT record_id FROM wisdom_records WHERE source_id = ? AND source_version < ? AND status = 'provisional'",
        (source_id, int(current_version))).fetchall()
    new = conn.execute(
        "SELECT record_id FROM wisdom_records WHERE source_id = ? AND source_version = ? AND extractor_version = ?",
        (source_id, int(current_version), extractor_version)).fetchall()
    return _mark_superseded(conn, [r[0] for r in old], [r[0] for r in new])


def _mark_superseded(conn, old_ids: list[str], new_ids: list[str]) -> int:
    if not old_ids:
        return 0
    by_identity = {}
    for rid in new_ids:
        ident = _identity(conn, rid)
        if ident is not None:
            by_identity.setdefault(ident, rid)
    for rid in old_ids:
        ident = _identity(conn, rid)
        conn.execute("UPDATE wisdom_records SET status = 'superseded', superseded_by = ? WHERE record_id = ?",
                     (by_identity.get(ident), rid))
    return len(old_ids)
