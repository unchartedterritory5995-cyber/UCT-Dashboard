"""The extractor golden gate (W1 §4.6, §6.5; CONTRACTS §6.4; manifest §7.5).

A version may extract the catalog only when its dev-split metrics are recorded in
wisdom_eval_runs AND no per-type precision or recall regressed against the
previous ACCEPTED evaluation on the same golden version. The first evaluation on
a golden version is the baseline and is accepted with its numbers recorded.

The gate key is (extractor_version, model). A smaller-model trial (D5) is just
another evaluation of the same extractor_version under a different model: it is
compared with the accepted Opus run and accepted only on a tie or better, which is
exactly "switch only on a tie".

MATCHING (method golden-match-v0), per golden-bearing segment:
  * CALL / NEGATIVE_CALL / MENTION / LEVEL: same record_type, same ticker, and the
    labelled stance and direction when the label states them. One prediction
    matches at most one label.
  * PRINCIPLE: statement similarity — max(token Jaccard of the labelled statement vs
    the predicted statement, token Jaccard of the two quotes, character overlap of
    the two quote spans) >= PRINCIPLE_SIMILARITY_MIN.
  * Types are scored BEFORE the entity downgrade (writer pre_entity_type): entity
    resolution is S-B's resolver, measured on its own; every other writer rule
    (quote once, R1, R3, guests, CALL authors) is applied.
  * Golden labels are not exhaustive for a segment, so PRECISION IS SCOPED: only
    predictions whose quote overlaps a labelled quote in that segment count; the
    rest are reported as unscored, never silently dropped.
  * NULL SEGMENTS (golden-v1.1) close that hole where a labeller could close it. A NULL
    row asserts an ABSENCE over a span — "no CALL / no PRINCIPLE / no MARKET_SIGNAL is
    here" — for a declared set of record types. A prediction landing in that span whose
    pre_entity_type is one of those types is a FALSE POSITIVE, because the labeller read
    the span and said there is nothing of that type in it.

    ⛔ WHY THIS EXISTS (owner ruling, 2026-09-14). On golden-v1 the dev-split gate kept
    882 records and SCORED 119: the other 763 were claims about paragraphs nobody had
    labelled, so a record INVENTED about unlabelled text could not appear as a false
    positive at all. The headline precision covered ~14% of the output. A positive label
    can only ever make a MISS visible; only an anti-label can make an INVENTION visible.

    ⛔ A NULL row is scored ONLY for the types it declares. A prediction of an undeclared
    type inside a NULL span stays unscored — the labeller did not answer that question,
    and answering it for them is how an instrument manufactures a finding.

Every rate carries its n. A denominator of 0 records value NULL, never 0%.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import time
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, Optional

from api.services.wisdom.core import ids, timeutil
from api.services.wisdom.extract import prompt, writer

METHOD_VERSION = "golden-match-v0"
EVAL_KIND = "extractor_golden"
DRIFT_KIND = "extractor_drift"
CALIBRATION_KIND = "extractor_calibration"
PRINCIPLE_SIMILARITY_MIN = 0.5
SPLITS = ("dev", "test")
_EXTRACTOR_VERSION_RE = re.compile(r"^wx-v\d+-[0-9a-f]{8}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_WORD = re.compile(r"[a-z0-9$%.]+")


# ── golden files ─────────────────────────────────────────────────────────────

#: Newest first. A later set is preferred only because it is a SUPERSET of the one before
#: it: golden-v1.1 is every golden-v1 row byte-identical plus the NULL segments, so a run
#: that picks it up scores strictly more than it used to, never something different.
#: ⛔ The version string is still only the FILE NAME. It is `golden_sha256` that says which
#: bytes a run scored, and `decide_gate` compares on the sha — so promoting v1.1 here makes
#: the next run an honest new BASELINE rather than a comparison against v1's numbers.
GOLDEN_FILES = (("golden-v1.1.jsonl", "golden-v1.1"),
                ("golden-v1.jsonl", "golden-v1"),
                ("golden-v0.draft.jsonl", "golden-v0-draft"))


def golden_file(data_dir, prefer: Optional[str] = None) -> tuple[Optional[pathlib.Path], Optional[str]]:
    """The newest golden set present, or the one `prefer` names (CONTRACTS §6.4).

    `prefer` is the file name ("golden-v1.jsonl"), so an operator can re-run the gate against
    a SPECIFIC set — comparing v1 and v1.1 on the same extractor needs both to be runnable,
    and "whatever is newest on disk" cannot express that."""
    base = pathlib.Path(data_dir) / "golden"
    for name, version in GOLDEN_FILES:
        if prefer and name != prefer:
            continue
        if (base / name).exists():
            return base / name, version
    return None, None


def golden_sha256(path) -> str:
    """The sha256 of the golden file's BYTES — CONTRACTS §8a.1's freeze, which says every
    gate run records "the golden version and sha it scored".

    ⛔ WHY THE SHA AND NOT THE NAME (reviewer finding, 2026-09-14). `golden_version` came
    from the FILE NAME: golden-v1.jsonl -> "golden-v1", which is true of any bytes anyone
    puts at that path. So the gate's regression check could compare today's metrics against
    a baseline measured on a DIFFERENT set of records and still say "accepted", and the
    freeze was enforceable only by a human remembering to pass --frozen to an offline
    verifier. A name that agrees with itself is not evidence
    (`lesson_an_identity_join_is_not_a_correctness_check`). Now the sha is recorded on
    every run and the comparison is keyed on it: change the bytes and the next run is an
    honest new BASELINE, never a false pass."""
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def load_golden(path) -> list[dict]:
    out = []
    for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.append(json.loads(line))
    return out


def split_for(record: dict) -> str:
    """The record's own split when it carries one (CONTRACTS §6.4: consumers READ the
    stored field and never recompute it).

    ⛔ The fallback is for a record that carries no split at all, and it must be §6.4's
    formula — `int(sha256(gid)[:8], 16)` even. It used to be the parity of the LAST hex
    digit of sha24(gid), a different function of the same input that disagreed with the
    contract on 1007 of 2000 synthetic gids — a coin flip, and a SECOND AUTHORITY over
    one value (`lesson_a_second_authority_over_one_value`). It is unreachable for
    golden-v1, whose records all carry `split`; that is exactly why it could be wrong
    for months without anyone noticing."""
    if record.get("split") in SPLITS:
        return record["split"]
    digest = hashlib.sha256(str(record["gid"]).encode("utf-8")).hexdigest()
    return "dev" if int(digest[:8], 16) % 2 == 0 else "test"


@dataclass(frozen=True)
class Expected:
    gid: str
    record_type: str
    ticker: Optional[str]
    stance: Optional[str]
    direction: Optional[str]
    statement: Optional[str]
    quote: str


#: A golden-v1.1 NULL row: this span, and none of these types is in it.
NULL_KIND = "null_segment"


@dataclass(frozen=True)
class NullSpan:
    gid: str
    quote: str
    types: frozenset


def is_null_record(record: dict) -> bool:
    """⛔ ONE discriminator, and it is a declared `kind` rather than the shape of `expected`.
    Shape-sniffing ("expected is a list, so it must be an anti-label") would make a row that
    lost its `expected` key through an editing mistake read as a deliberate assertion of
    absence — the worst possible direction for this particular field, because an accidental
    NULL row turns every correct extraction inside it into a false positive."""
    return record.get("kind") == NULL_KIND


def null_types(record: dict) -> frozenset:
    """The record types a NULL row asserts are absent. Anything outside `writer.RECORD_TYPES`
    is dropped rather than trusted: a typo'd type name must narrow the claim, never widen it."""
    declared = record.get("null_for")
    if not isinstance(declared, list):
        return frozenset()
    return frozenset(t for t in declared if t in writer.RECORD_TYPES)


def null_from_record(record: dict) -> Optional[NullSpan]:
    types = null_types(record)
    quote = record_quote(record)
    if not (is_null_record(record) and types and quote):
        return None
    return NullSpan(str(record.get("gid")), quote, types)


def sample_key(record: dict) -> Optional[str]:
    """The sample a label was drawn from. Discord samples are one file per channel, so the
    key names the message: 'discord/<channel>.jsonl#<message_id>'."""
    locator = record.get("locator") or {}
    sample = locator.get("sample") or record.get("sample_file")
    if not sample:
        return None
    if str(sample).startswith("discord/"):
        return f"{sample}#{str(locator.get('external_ref') or '').rsplit(':', 1)[-1]}"
    return str(sample)


def record_quote(record: dict) -> str:
    return record.get("quote") or (record.get("expected") or {}).get("quote") or ""


def _evidence_tickers(record: dict) -> list[str]:
    entity = (record.get("evidence") or {}).get("entity") or {}
    if isinstance(entity.get("tickers"), list):
        return [t for t in (writer.normalize_ticker(x) for x in entity["tickers"]) if t]
    ticker = writer.normalize_ticker(entity.get("ticker"))
    return [ticker] if ticker else []


def _expected_v1(record: dict) -> list[Expected]:
    e = record["expected"]
    rtype = record.get("record_type") or e.get("record_type")
    quote = record_quote(record)
    gid = str(record.get("gid"))
    if rtype == "PRINCIPLE":
        statement = (e.get("principle") or {}).get("statement") or quote
        return [Expected(gid, rtype, None, None, None, str(statement), quote)]
    if rtype == "MARKET_SIGNAL":
        name = (e.get("market_signal") or {}).get("name")
        return [Expected(gid, rtype, writer.normalize_ticker(e.get("ticker_as_written")), None, None, name, quote)]
    stance = e.get("stance") if e.get("stance") in writer.STANCES else None
    direction = e.get("direction") if e.get("direction") in ("long", "short") else None
    tickers = [t for t in (writer.normalize_ticker(x) for x in e.get("tickers") or []) if t]
    if not tickers:
        ticker = writer.normalize_ticker(e.get("ticker_as_written"))
        tickers = [ticker] if ticker else _evidence_tickers(record)[:1]
    return [Expected(gid, rtype, t, stance, direction, None, quote) for t in dict.fromkeys(tickers)]


def expected_from_record(record: dict) -> list[Expected]:
    # ⛔ A NULL row yields NO expectation, and that is the whole point: it must contribute a
    # SPAN (so predictions inside it become scorable) without contributing a label to match.
    # If it leaked one Expected here, every NULL segment would also manufacture a false
    # NEGATIVE for a record that was never supposed to be there.
    if is_null_record(record):
        return []
    if isinstance(record.get("expected"), dict):
        return _expected_v1(record)
    labels = record.get("labels") or {}
    rtype = record.get("record_type")
    quote = record.get("quote") or ""
    gid = str(record.get("gid"))
    if rtype == "PRINCIPLE":
        return [Expected(gid, rtype, None, None, None, str(labels.get("statement") or quote), quote)]
    stance = labels.get("stance") if labels.get("stance") in writer.STANCES else None
    direction = labels.get("direction") if labels.get("direction") in ("long", "short") else None
    if labels.get("list_kind"):
        tickers = [writer.normalize_ticker(tok) for tok in quote.split()]
    elif isinstance(labels.get("tickers"), list):
        tickers = [writer.normalize_ticker(t) for t in labels["tickers"]]
    else:
        tickers = [writer.normalize_ticker(labels.get("ticker"))]
    out = [Expected(gid, rtype, t, stance, direction, None, quote) for t in dict.fromkeys(tickers) if t]
    sibling = labels.get("sibling_expected")
    if isinstance(sibling, dict) and writer.normalize_ticker(sibling.get("ticker")):
        sib_stance = sibling.get("stance") if sibling.get("stance") in writer.STANCES else None
        out.append(Expected(gid, rtype, writer.normalize_ticker(sibling["ticker"]), sib_stance, None, None, quote))
    return out


def place(records: Iterable[dict], segments_by_file: dict) -> tuple[dict, list[str]]:
    """segment_id -> {segment, file, records}; plus the gids no single segment contains."""
    placed: dict = {}
    unplaced: list[str] = []
    for record in records:
        key = sample_key(record)
        quote = record_quote(record) or "\x00"
        candidates = [s for s in segments_by_file.get(key, []) if (s.get("text") or "").count(quote) == 1]
        if not candidates:
            unplaced.append(str(record.get("gid")))
            continue
        best = min(candidates, key=lambda s: (len(s["text"]), s.get("ordinal", 0)))
        slot = placed.setdefault(best["segment_id"], {"segment": best, "file": key, "records": []})
        slot["records"].append(record)
    return placed, unplaced


def segments_for_sample(samples_dir, key: str) -> list[dict]:
    """Segment one gitignored sample exactly as production segments its source."""
    from api.services.wisdom.core import authors
    from api.services.wisdom.extract import segmenter

    sample, _, message_id = key.partition("#")
    path = pathlib.Path(samples_dir) / sample
    source_id = "golden:" + key
    if sample.startswith("discord/"):
        message = None
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                if str(row.get("message_id")) == message_id:
                    message = row
                    break
        if message is None:
            return []
        segs = segmenter.segment_discord_message(message.get("content") or "")
        author = authors.author_for_discord_user(message.get("author_id"))
        for seg in segs:
            seg.author_id, seg.speaker_confidence = author, ("high" if author else "low")
    elif sample.endswith(".transcript_cues.json"):
        segs = segmenter.segment_transcript(json.loads(path.read_text(encoding="utf-8-sig"))["cues"], [])
    elif sample.startswith("transcripts/"):
        from api.services.desk_session_insights import _parse_timestamped_block

        data = json.loads(path.read_text(encoding="utf-8"))
        segs = segmenter.segment_transcript(_parse_timestamped_block(data.get("transcript") or ""),
                                            data.get("chapters") or [])
    elif sample.endswith(".html"):
        segs = segmenter.segment_sunday_scans(segmenter.html_to_text(path.read_text(encoding="utf-8")))
    else:
        segs = segmenter.segment_sunday_scans(path.read_text(encoding="utf-8-sig"))
    return [seg.to_row(source_id, 1) for seg in segs]


def source_for_record(record: dict) -> dict:
    """A synthetic wisdom_sources row for a golden sample (the gate runs PC-side on samples)."""
    locator = record.get("locator") or {}
    stream = record.get("stream") or "unknown"
    session = (record.get("evidence") or {}).get("session_date")
    return {"source_id": "golden:" + (sample_key(record) or ""), "stream": stream,
            "external_ref": locator.get("external_ref"),
            "published_at_et": f"{session}T16:00:00-04:00" if session else None, "recording_started_at_et": None,
            "guest_names_json": "[]", "title": None, "show": None,
            "host_author_id": "tsdr" if stream in ("zoom_live", "workshop", "education") else None}


# ── matching and scoring ─────────────────────────────────────────────────────

def _tokens(text: Optional[str]) -> set:
    """All-word tokens for SIMILARITY scoring — keeps `$`, `%` and `.`, so `$nvda`,
    `30%` and `1.5r` survive as single tokens. Its counterpart for the fuzzy-agreement
    lens is `_key_tokens`, which deliberately strips those; the two had the same name
    until 2026-09-14 and this one lost."""
    return set(_WORD.findall(str(text or "").casefold()))


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if (a or b) else 0.0


def _overlap_ratio(a: tuple[int, int], b: tuple[int, int]) -> float:
    inter = max(0, min(a[1], b[1]) - max(a[0], b[0]))
    shortest = min(a[1] - a[0], b[1] - b[0])
    return inter / shortest if shortest > 0 else 0.0


def match_segment(expected: list[Expected], predicted: list, segment_text: str,
                  nulls: Iterable[NullSpan] = ()) -> dict:
    spans = []
    for e in expected:
        idx = segment_text.find(e.quote)
        if idx >= 0:
            spans.append((idx, idx + len(e.quote)))
    # ⛔ A NULL span that is NOT FOUND in this text contributes nothing and is reported, never
    # treated as covering the whole segment. A span we cannot locate is a span we cannot say
    # anything about (`lesson_a_swallowed_error_becomes_a_confident_finding`).
    null_spans, null_missing = [], []
    for n in nulls:
        idx = segment_text.find(n.quote)
        if idx >= 0:
            null_spans.append(((idx, idx + len(n.quote)), n.types))
        else:
            null_missing.append(n.gid)
    scored_at = [i for i, p in enumerate(predicted)
                 if any(_overlap_ratio((p.q_start, p.q_end), s) > 0 for s in spans)]
    scored = [predicted[i] for i in scored_at]
    tp, fp, fn = Counter(), Counter(), Counter()
    lenient_tp = Counter()
    used: set = set()
    outcomes = []
    def same_instrument(e: Expected, p) -> bool:
        if e.record_type == "MARKET_SIGNAL":
            return not (e.ticker and p.ticker) or e.ticker == p.ticker
        return p.ticker == e.ticker

    for e in [x for x in expected if x.record_type != "PRINCIPLE"]:
        hit = None
        for i, p in enumerate(scored):
            if i in used or p.pre_entity_type != e.record_type or not same_instrument(e, p):
                continue
            if e.stance and p.fields.get("stance") != e.stance:
                continue
            if e.direction and p.fields.get("direction") != e.direction:
                continue
            hit = i
            break
        if hit is None:
            fn[e.record_type] += 1
            if any(p.pre_entity_type == e.record_type and same_instrument(e, p) for p in scored):
                lenient_tp[e.record_type] += 1
            outcomes.append({"gid": e.gid, "record_type": e.record_type, "ticker": e.ticker, "matched": False})
        else:
            used.add(hit)
            tp[e.record_type] += 1
            lenient_tp[e.record_type] += 1
            outcomes.append({"gid": e.gid, "record_type": e.record_type, "ticker": e.ticker, "matched": True})
    for e in [x for x in expected if x.record_type == "PRINCIPLE"]:
        e_span = (segment_text.find(e.quote), segment_text.find(e.quote) + len(e.quote))
        best, best_i = 0.0, None
        for i, p in enumerate(scored):
            if i in used or p.pre_entity_type != "PRINCIPLE":
                continue
            statement = (p.fields.get("principle") or {}).get("statement")
            sim = max(_jaccard(_tokens(e.statement), _tokens(statement)), _jaccard(_tokens(e.quote), _tokens(p.quote)),
                      _overlap_ratio(e_span, (p.q_start, p.q_end)))
            if sim > best:
                best, best_i = sim, i
        if best_i is not None and best >= PRINCIPLE_SIMILARITY_MIN:
            used.add(best_i)
            tp["PRINCIPLE"] += 1
            lenient_tp["PRINCIPLE"] += 1
            outcomes.append({"gid": e.gid, "record_type": "PRINCIPLE", "matched": True, "similarity": round(best, 3)})
        else:
            fn["PRINCIPLE"] += 1
            outcomes.append({"gid": e.gid, "record_type": "PRINCIPLE", "matched": False,
                             "similarity": round(best, 3)})
    for i, p in enumerate(scored):
        if i not in used:
            fp[p.pre_entity_type] += 1
    # ── NULL segments: the other half of precision ───────────────────────────
    # Only predictions the LABEL scope did not already reach are considered here, so a
    # prediction that overlaps both a label and a NULL span is counted exactly once — by the
    # label, which is the stronger evidence (it can still be a true positive).
    in_label_scope = set(scored_at)
    null_fp = Counter()
    for i, p in enumerate(predicted):
        if i in in_label_scope:
            continue
        for span, types in null_spans:
            if p.pre_entity_type in types and _overlap_ratio((p.q_start, p.q_end), span) > 0:
                fp[p.pre_entity_type] += 1
                null_fp[p.pre_entity_type] += 1
                break
    # The DENOMINATOR for a null false-positive rate is segments, not rows: two NULL rows that
    # land in one segment assert absence over one piece of text the extractor saw once.
    declared_here = frozenset().union(*[t for _, t in null_spans]) if null_spans else frozenset()
    null_declared = Counter(declared_here)
    null_hit = Counter({t: 1 for t in declared_here if null_fp[t]})
    return {"tp": tp, "fp": fp, "fn": fn, "lenient_tp": lenient_tp, "scored_predictions": len(scored),
            "unscored_predictions": len(predicted) - len(scored) - sum(null_fp.values()),
            "outcomes": outcomes, "null_fp": null_fp, "null_declared": null_declared,
            "null_segments_with_fp": null_hit, "null_spans": len(null_spans),
            "null_spans_not_found": null_missing}


def _rate(num: int, den: int) -> Optional[float]:
    return round(num / den, 6) if den else None


def score(segment_results: Iterable[dict]) -> dict:
    tp, fp, fn, lenient = Counter(), Counter(), Counter(), Counter()
    null_fp, null_declared, null_hit = Counter(), Counter(), Counter()
    scored = unscored = null_segments = 0
    for r in segment_results:
        tp.update(r["tp"])
        fp.update(r["fp"])
        fn.update(r["fn"])
        lenient.update(r["lenient_tp"])
        scored += r["scored_predictions"]
        unscored += r["unscored_predictions"]
        # .get, because a segment-scores file written before golden-v1.1 carries none of these
        # and must still re-score to the same numbers it did on the day it was measured.
        null_fp.update(r.get("null_fp") or {})
        null_declared.update(r.get("null_declared") or {})
        null_hit.update(r.get("null_segments_with_fp") or {})
        null_segments += 1 if (r.get("null_spans") or 0) else 0
    per_type = {}
    for rtype in writer.RECORD_TYPES:
        t, f_p, f_n, n_null = tp[rtype], fp[rtype], fn[rtype], null_declared[rtype]
        # ⛔ n_null belongs in this condition. A type asserted absent across 44 segments and
        # never hallucinated once has tp=fp=fn=0, and dropping it here would delete the single
        # most useful measurement the NULL segments produce — "zero false positives, n=44" —
        # leaving it indistinguishable from a type nobody asked about.
        if not (t or f_p or f_n or n_null):
            continue
        per_type[rtype] = {"tp": t, "fp": f_p, "fn": f_n, "precision": _rate(t, t + f_p), "recall": _rate(t, t + f_n),
                           "n_expected": t + f_n, "n_predicted_scored": t + f_p,
                           "type_ticker_recall": _rate(lenient[rtype], t + f_n),
                           "fp_null": null_fp[rtype], "null_segments": n_null,
                           "null_segments_with_fp": null_hit[rtype],
                           # share of NULL segments in which this type was invented at least once
                           "null_fp_rate": _rate(null_hit[rtype], n_null)}
    return {"per_type": per_type, "n_expected": sum(tp.values()) + sum(fn.values()),
            "scored_predictions": scored, "unscored_predictions": unscored,
            "null_segments": null_segments, "null_false_positives": sum(null_fp.values())}


# ── recording and the gate ───────────────────────────────────────────────────

def _runs(conn, kind: str) -> list[dict]:
    rows = conn.execute("SELECT run_id, kind, extractor_version, method_version, n, metrics_json, created_at "
                        "FROM wisdom_eval_runs WHERE kind = ? ORDER BY created_at DESC, rowid DESC", (kind,)).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        try:
            item["metrics"] = json.loads(item.pop("metrics_json") or "{}")
        except ValueError:
            item["metrics"] = {}
        out.append(item)
    return out


def decide_gate(conn, *, extractor_version: str, model: str, effort: str, golden_version: str, split: str,
                per_type: dict, golden_sha256: str) -> dict:
    previous = None
    for run in _runs(conn, EVAL_KIND):
        m = run["metrics"]
        if (m.get("gate") or {}).get("decision") != "accepted":
            continue
        if m.get("golden_version") != golden_version or m.get("split") != split:
            continue
        # ⛔ the same NAME is not the same SET: comparing across different bytes is a
        # regression check against records the previous run never saw (golden_sha256).
        if m.get("golden_sha256") != golden_sha256:
            continue
        if run["extractor_version"] == extractor_version and m.get("model") == model and m.get("effort") == effort:
            continue
        previous = run
        break
    if previous is None:
        return {"decision": "accepted", "baseline": True, "compared_to": None, "regressions": []}
    regressions = []
    old_types = previous["metrics"].get("per_type") or {}
    for rtype, old in old_types.items():
        new = per_type.get(rtype) or {}
        for metric, n_key in (("precision", "n_predicted_scored"), ("recall", "n_expected")):
            before, after = old.get(metric), new.get(metric)
            if before is not None and (after is None or after < before - 1e-9):
                regressions.append({"record_type": rtype, "metric": metric, "previous": before,
                                    "previous_n": old.get(n_key), "current": after, "current_n": new.get(n_key)})
    return {"decision": "blocked" if regressions else "accepted", "baseline": False,
            "compared_to": previous["run_id"], "compared_extractor_version": previous["extractor_version"],
            "compared_model": previous["metrics"].get("model"), "regressions": regressions}


def record_eval(conn, *, kind: str, extractor_version: Optional[str], metrics: dict, n: int,
                now_iso: Optional[str] = None) -> dict:
    """Insert one wisdom_eval_runs row (and, for the gate, its wisdom_metrics rows).
    For EVAL_KIND the gate decision is computed HERE, against the store's own history."""
    now = now_iso or timeutil.iso_et(timeutil.now_et())
    payload = dict(metrics)
    if kind == EVAL_KIND:
        for key in ("model", "effort", "golden_version", "split", "per_type", "golden_sha256"):
            if key not in payload:
                raise ValueError(f"an extractor_golden evaluation needs {key!r}")
        # R98, session 25: A RUN THAT SCORED NOTHING MUST REFUSE, NEVER ACCEPT. `import_receipt`
        # already guards its own path ("receipt has no per_type counts") before ever calling
        # this function — but that guard sat ONE LAYER UP, so a DIRECT caller (the gate tool
        # itself, persisting the run it just measured) had no such check. Inside a container
        # where the golden set was never deployed, a zero-sample run finds no prior history to
        # compare against and decide_gate's baseline branch — correct when there IS a scored
        # sample and no history — returns `accepted, baseline: True` for a verdict that measured
        # NOTHING, superseding whatever real verdict came before it. This is the hole
        # `docs/wisdom/HARD-RULES.md`'s "never run the golden gate inside the container" rule
        # exists to name; fixing it here (the shared choke point BOTH import_receipt and a
        # direct gate run pass through) is what lets that rule be narrowed rather than repealed.
        if not payload.get("per_type"):
            raise ValueError("an extractor_golden evaluation with no per_type counts scored "
                             "nothing; refusing rather than recording a baseline accept")
        # §8a.1: a run that cannot say WHICH BYTES it scored is not a gate run.
        if not _SHA256_RE.match(str(payload["golden_sha256"] or "")):
            raise ValueError("golden_sha256 must be the sha256 of the golden file's bytes")
        payload["gate"] = decide_gate(conn, extractor_version=extractor_version, model=payload["model"],
                                      effort=payload["effort"], golden_version=payload["golden_version"],
                                      split=payload["split"], per_type=payload["per_type"],
                                      golden_sha256=payload["golden_sha256"])
    run_id = ids.sha24(kind, extractor_version, payload.get("model"), now, time.time_ns())
    conn.execute("INSERT INTO wisdom_eval_runs (run_id, kind, extractor_version, method_version, n, metrics_json, "
                 "created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                 (run_id, kind, extractor_version, METHOD_VERSION, int(n), json.dumps(payload, sort_keys=True), now))
    if kind == EVAL_KIND:
        for rtype, m in payload["per_type"].items():
            slice_json = json.dumps({"record_type": rtype, "split": payload["split"], "model": payload["model"],
                                     "extractor_version": extractor_version, "golden_version": payload["golden_version"],
                                     "golden_sha256": payload["golden_sha256"],
                                     "status": "combined"}, sort_keys=True)
            for metric, num, den in (("extractor_precision", m["tp"], m["tp"] + m["fp"]),
                                     ("extractor_recall", m["tp"], m["tp"] + m["fn"])):
                conn.execute("INSERT INTO wisdom_metrics (metric_run_id, metric, slice_json, numerator, denominator, "
                             "value, method_version, computed_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                             (run_id, metric, slice_json, int(num), int(den), _rate(num, den), METHOD_VERSION, now,
                              f"gate {payload['gate']['decision']}"))
    return {"run_id": run_id, "gate": payload.get("gate"), "created_at": now}


def gate_status(conn, *, extractor_version: Optional[str] = None, model: Optional[str] = None,
                effort: Optional[str] = None, split: str = "dev") -> dict:
    """The latest evaluation of THIS configuration — extractor_version, model AND effort. An
    effort the gate never measured is not accepted, even for an accepted version and model."""
    from api.services.wisdom.extract import config

    model = model or config.configured_model()
    effort = effort or config.configured_effort()
    version = extractor_version or prompt.extractor_version()
    for run in _runs(conn, EVAL_KIND):
        m = run["metrics"]
        if (run["extractor_version"] != version or m.get("model") != model or m.get("effort") != effort
                or m.get("split") != split):
            continue
        gate = m.get("gate") or {}
        return {"accepted": gate.get("decision") == "accepted", "extractor_version": version, "model": model,
                "effort": effort, "run_id": run["run_id"], "created_at": run["created_at"],
                "golden_version": m.get("golden_version"), "golden_sha256": m.get("golden_sha256"),
                "gate": gate, "per_type": m.get("per_type"),
                "n": run["n"],
                "reason": None if gate.get("decision") == "accepted" else "the latest evaluation is blocked"}
    return {"accepted": False, "extractor_version": version, "model": model, "effort": effort, "run_id": None,
            "reason": "no golden-gate evaluation is recorded for this extractor_version, model and effort"}


def import_receipt(conn, receipt: dict, now_iso: Optional[str] = None) -> dict:
    """Record a PC-side gate run in this store. Counts are re-derived from tp/fp/fn and the
    decision is recomputed against THIS store's history; nothing in the receipt is trusted
    beyond its counts. Idempotent on the receipt's run_id."""
    if not isinstance(receipt, dict):
        raise ValueError("receipt must be an object")
    receipt_id = str(receipt.get("run_id") or "")
    version = str(receipt.get("extractor_version") or "")
    if receipt.get("kind") != EVAL_KIND or not receipt_id or not _EXTRACTOR_VERSION_RE.match(version):
        raise ValueError("not an extractor_golden receipt")
    model, golden_version, split = receipt.get("model"), receipt.get("golden_version"), receipt.get("split")
    if not isinstance(model, str) or not isinstance(golden_version, str) or split not in SPLITS:
        raise ValueError("receipt needs model, golden_version and a dev/test split")
    if not _SHA256_RE.match(str(receipt.get("golden_sha256") or "")):
        raise ValueError("receipt needs the golden_sha256 it scored (§8a.1)")
    if receipt.get("effort") not in prompt.EFFORTS:
        raise ValueError("receipt effort is not a valid effort")
    for run in _runs(conn, EVAL_KIND):
        if run["metrics"].get("receipt_id") == receipt_id:
            return {"run_id": run["run_id"], "gate": run["metrics"].get("gate"), "duplicate": True}
    per_type = {}
    for rtype, m in (receipt.get("per_type") or {}).items():
        if rtype not in writer.RECORD_TYPES or not isinstance(m, dict):
            raise ValueError(f"bad per_type entry {rtype!r}")
        try:
            t, f_p, f_n = (int(m["tp"]), int(m["fp"]), int(m["fn"]))
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"per_type {rtype} needs integer tp/fp/fn")
        if min(t, f_p, f_n) < 0:
            raise ValueError("counts cannot be negative")
        per_type[rtype] = {"tp": t, "fp": f_p, "fn": f_n, "precision": _rate(t, t + f_p), "recall": _rate(t, t + f_n),
                           "n_expected": t + f_n, "n_predicted_scored": t + f_p}
    if not per_type:
        raise ValueError("receipt has no per_type counts")
    metrics = {"model": model, "effort": receipt["effort"], "golden_version": golden_version, "split": split,
               "golden_sha256": receipt["golden_sha256"],
               "per_type": per_type, "receipt_id": receipt_id, "source": "receipt",
               "cost_usd": receipt.get("cost_usd"), "measured_at": receipt.get("created_at")}
    out = record_eval(conn, kind=EVAL_KIND, extractor_version=version, metrics=metrics,
                      n=sum(v["n_expected"] for v in per_type.values()), now_iso=now_iso)
    out["duplicate"] = False
    return out


# ── drift and calibration ────────────────────────────────────────────────────

#: Below this, a record type is not reproducible enough to publish under a named author,
#: and Wave 1.5 item 2 sends it to N=3 stability voting instead of single-pass extraction.
#: Owner ruling 2026-09-14. Measured on 2026-09-14 with golden-v1, as the JACCARD this
#: gate computes: PRINCIPLE 0.115, MARKET_SIGNAL 0.125 — both far under; CALL 0.630,
#: MENTION 0.663.
#: ⚰️ PRINCIPLE read 0.207 here until 2026-09-14 session 2, which is the DICE coefficient
#: of the same counts (2x6/(30+28)); the other three were Jaccard. One of four attributed
#: numbers computed by a different formula from the gate, in the docstring of the constant
#: that governs the type the whole wave is about.
STABILITY_FLOOR = 0.8


#: Free-text record keys. For these the key IS the statement, so a paraphrase is a different
#: record by construction — see `_fuzzy_agreed`.
FREE_TEXT_KEY_TYPES = ("PRINCIPLE", "MARKET_SIGNAL")
#: Token-set overlap at which two free-text statements are treated as the same claim worded
#: differently. Deliberately generous: this lens exists to put an UPPER bound on how much of the
#: measured drift is paraphrase, so it should over-merge rather than under-merge.
PARAPHRASE_TOKEN_OVERLAP = 0.6
_KEY_WORD_RE = re.compile(r"[a-z0-9']+")


#: ⛔ PAIRS WHOSE SWAP REVERSES THE ADVICE. A token-set overlap cannot see a negation:
#: measured 2026-09-14, "never average down into a loser" vs "always average down into a loser"
#: scores 0.667, and "size down when the regime turns hostile" vs "size up ... friendly" scores
#: 0.625 — both over the 0.6 threshold, so both merged as "the same claim, reworded". For a
#: PRINCIPLE that is the worst error available: the negation IS the teaching, and merging the two
#: would report the extractor as STABLE at the moment it contradicted itself.
#: ⭐ Antonym PAIRS, not a list of polarity words: a bare list refuses the legitimate paraphrase
#: "the stop is your north star always", which adds `always` with no `never` to contradict.
_ANTONYMS = (("never", "always"), ("up", "down"), ("long", "short"), ("buy", "sell"),
             ("above", "below"), ("more", "less"), ("add", "trim"), ("tight", "wide"),
             ("over", "under"), ("before", "after"), ("first", "last"))


def _polarity_conflict(text_a: str, text_b: str) -> bool:
    """True when one statement says a word and the other says its opposite.

    ⚰️ IT TOKENIZES ITSELF, and that is the whole fix. The first version took the sets `_tokens`
    had already built — and `_tokens` drops words of two characters or fewer, so `up` was never
    in them and the (up, down) pair could not fire. "size down when the regime turns hostile"
    and "size up when the regime turns friendly" went on merging, with the guard installed and
    apparently working: the never/always case passed, so the guard looked alive.
    ⭐ A filter tuned for one purpose (similarity, where short words are noise) silently disabled
    another that reused it (polarity, where the short words ARE the meaning).
    """
    a = set(_KEY_WORD_RE.findall(str(text_a or "").casefold()))
    b = set(_KEY_WORD_RE.findall(str(text_b or "").casefold()))
    for x, y in _ANTONYMS:
        if (x in a and y in b) or (y in a and x in b):
            return True
    return False


def _key_tokens(text: Optional[str]) -> set:
    """Content words for the FUZZY-AGREEMENT lens: short words dropped, and the
    regex deliberately excludes `$ % .` so wording differences dominate.

    ⛔ RENAMED FROM `_tokens`, WHICH IS WHAT IT USED TO SHADOW. There were two
    top-level `_tokens` definitions in this module — this one at line 689 and the
    similarity scorer's at 329 — and Python keeps the LAST, so `match_segment`'s
    `_jaccard(_tokens(...), _tokens(...))` had been running THIS function since
    c9d6af653. The two are not interchangeable:

        "Buy $NVDA above 30% on a 1.5R stop"
        scorer intended : ['$nvda', '1.5r', '30%', 'a', 'above', 'buy', 'on', 'stop']
        actually got    : ['above', 'buy', 'nvda', 'stop']

    ⚠️ In a TRADING extraction gate that is the worst possible loss: the cashtag
    loses its `$`, and the percentage and the R-multiple disappear entirely — the
    three token classes that carry the trade. Same defect class as the `_parse_mdy`
    incident (`api/live_massive_router.py`, 2026-09-01): two top-level definitions,
    the later one winning, every call site written against the earlier.
    """
    return {w for w in _KEY_WORD_RE.findall(str(text or "").casefold()) if len(w) > 2}


def _fuzzy_agreed(a_keys: list, b_keys: list) -> int:
    """Greedy count of free-text records that are THE SAME CLAIM worded differently.

    ⛔ WHY THIS LENS EXISTS, and it is the most important thing about the drift number.
    `writer.Chunk.key` is structured for CALL and MENTION — `(type, ticker, stance, direction)` —
    but for PRINCIPLE and MARKET_SIGNAL it is `(type, normalize_quote_key(statement))`, and
    `normalize_quote_key` only casefolds and collapses whitespace. So "your stop is your north
    star" and "the stop is your north star" are DIFFERENT RECORDS, and two runs that found the
    same principle and worded it differently score zero agreement.

    ⭐ That means the measured 0.115 for PRINCIPLE conflates two things that call for opposite
    responses: the extractor finding DIFFERENT principles (a real stability problem, and the
    reason not to publish), and the extractor finding the SAME principle and rewording it (a
    property of the identity function, which N=3 voting would pay 3x to average over without
    fixing). Reporting only the strict number would buy the expensive answer to the cheap
    problem (`lesson_an_identity_join_is_not_a_correctness_check`).

    ⚠️ This is an UPPER bound on agreement, not a replacement identity: a generous threshold can
    merge two genuinely different claims that share vocabulary. It is reported BESIDE the strict
    figure, never instead of it.
    """
    pool = list(b_keys)
    agreed = 0
    for key in a_keys:
        target = _key_tokens(key[1] if len(key) > 1 else "")
        best_i, best = None, 0.0
        for i, other in enumerate(pool):
            if other[0] != key[0]:
                continue
            cand = _key_tokens(other[1] if len(other) > 1 else "")
            if _polarity_conflict(key[1] if len(key) > 1 else "",
                                  other[1] if len(other) > 1 else ""):
                continue          # opposite advice is never the same claim reworded
            union = target | cand
            score = len(target & cand) / len(union) if union else 0.0
            if score > best:
                best_i, best = i, score
        if best_i is not None and best >= PARAPHRASE_TOKEN_OVERLAP:
            pool.pop(best_i)
            agreed += 1
    return agreed


def drift(run_a: dict, run_b: dict) -> dict:
    """run_x: {segment_id: [record keys]}. Multiset agreement per segment, and PER TYPE.

    ⛔ PER-TYPE STABILITY IS A GATE METRIC (owner ruling, Wave 1.5 item 1), not a curiosity.
    The 2026-09-14 measurement is why: a whole-run `mean_jaccard` of 0.505 hides that CALL and
    MENTION are middling while PRINCIPLE agrees on 6 of ~30 and MARKET_SIGNAL on 4 of ~17 —
    and PRINCIPLE is exactly what D18 would publish into the Brain KB under a named author.
    One number averaged over types would have let the unreproducible half ship behind the
    reproducible half (`lesson_a_hit_rate_is_meaningless_without_its_base_rate`).

    ⭐ The per-type figure is a MULTISET Jaccard over record keys: agreed / (run_1 + run_2 −
    agreed), where `agreed` is Σ min(a,b). Using the multiset rather than the key SET matters
    because emitting the same principle twice is a different failure from emitting two
    different ones, and a set would score both identically.
    """
    segments = sorted(set(run_a) | set(run_b))
    identical, jaccards = 0, []
    by_type: dict = {}
    for sid in segments:
        a, b = Counter(run_a.get(sid) or []), Counter(run_b.get(sid) or [])
        inter, union = sum((a & b).values()), sum((a | b).values())
        jaccards.append(inter / union if union else 1.0)
        identical += int(a == b)
        for key in set(a) | set(b):
            slot = by_type.setdefault(key[0], {"run_1": 0, "run_2": 0, "agreed": 0})
            slot["run_1"] += a[key]
            slot["run_2"] += b[key]
            slot["agreed"] += min(a[key], b[key])
    # ⛔ The SAME comparison under a paraphrase-tolerant identity, for the free-text types only.
    # The gap between the two numbers is the answer to "how much of this drift is the extractor
    # finding different things, and how much is it wording the same thing differently" — which
    # decides whether N=3 voting is worth 3x the extraction bill (Wave 1.5 items 2 and 6).
    for sid in segments:
        a_free = [k for k in (run_a.get(sid) or []) if k and k[0] in FREE_TEXT_KEY_TYPES]
        b_free = [k for k in (run_b.get(sid) or []) if k and k[0] in FREE_TEXT_KEY_TYPES]
        for rtype in FREE_TEXT_KEY_TYPES:
            a_t = [k for k in a_free if k[0] == rtype]
            b_t = [k for k in b_free if k[0] == rtype]
            if a_t or b_t:
                by_type.setdefault(rtype, {"run_1": 0, "run_2": 0, "agreed": 0}).setdefault("agreed_paraphrase", 0)
                by_type[rtype]["agreed_paraphrase"] += _fuzzy_agreed(a_t, b_t)
    for slot in by_type.values():
        union = slot["run_1"] + slot["run_2"] - slot["agreed"]
        # ⛔ union == 0 means the type never appeared in EITHER run. That is "not measured",
        # never "perfectly stable" — a 1.0 here would read as the best score in the table and
        # would be the one type nobody looked at.
        slot["jaccard"] = round(slot["agreed"] / union, 6) if union else None
        slot["below_floor"] = bool(slot["jaccard"] is not None and slot["jaccard"] < STABILITY_FLOOR)
        if "agreed_paraphrase" in slot:
            # the same union, a looser identity: an UPPER bound on agreement, never the verdict
            para_union = slot["run_1"] + slot["run_2"] - slot["agreed_paraphrase"]
            slot["jaccard_paraphrase"] = round(slot["agreed_paraphrase"] / para_union, 6) if para_union else None
            if slot["jaccard"] is not None and slot["jaccard_paraphrase"] is not None:
                slot["paraphrase_share"] = round(slot["jaccard_paraphrase"] - slot["jaccard"], 6)
    return {"segments": len(segments), "identical_segments": identical,
            "mean_jaccard": round(sum(jaccards) / len(jaccards), 6) if jaccards else None,
            "by_type": by_type, "stability_floor": STABILITY_FLOOR,
            "below_floor": sorted(t for t, s in by_type.items() if s["below_floor"])}


def decide_stability(conn, *, extractor_version: str, model: str, effort: str, by_type: dict) -> dict:
    """Does this version's per-type stability regress against the last accepted measurement?

    ⛔ A SECOND GATE, DELIBERATELY SEPARATE FROM decide_gate. Drift is measured by re-running the
    SAME segments the gate already ran and diffing the record keys, so it cannot exist until the
    gate phase has produced its keys file — the ordering is forced, and folding stability into
    `decide_gate` would mean deciding before the evidence exists. A version ships only when BOTH
    decisions accept, which is what "a version that drops stability below the current baseline
    does not ship" means operationally.

    ⛔ ABSENT IS NOT PASSING. A type the previous run measured and this one did not is reported
    as `not_measured`, never silently dropped from the comparison — that is how a regression
    hides (`lesson_a_projection_drops_what_it_does_not_name`).
    """
    previous = None
    for run in _runs(conn, DRIFT_KIND):
        m = run["metrics"]
        if (m.get("stability") or {}).get("decision") == "blocked":
            continue
        if run["extractor_version"] == extractor_version and m.get("model") == model and m.get("effort") == effort:
            continue
        previous = run
        break
    current = {t: s.get("jaccard") for t, s in (by_type or {}).items()}
    floor_breaches = sorted(t for t, s in (by_type or {}).items() if s.get("below_floor"))
    if previous is None:
        return {"decision": "accepted", "baseline": True, "compared_to": None, "regressions": [],
                "per_type_jaccard": current, "below_floor": floor_breaches}
    regressions = []
    old_types = (previous["metrics"].get("by_type") or {})
    for rtype, old in old_types.items():
        before = old.get("jaccard")
        if before is None:
            continue
        after = current.get(rtype)
        if after is None:
            regressions.append({"record_type": rtype, "metric": "jaccard", "previous": before,
                                "current": None, "why": "not_measured"})
        elif after < before - 1e-9:
            regressions.append({"record_type": rtype, "metric": "jaccard", "previous": before,
                                "current": after, "why": "less stable than the baseline"})
    return {"decision": "blocked" if regressions else "accepted", "baseline": False,
            "compared_to": previous["run_id"], "compared_extractor_version": previous["extractor_version"],
            "regressions": regressions, "per_type_jaccard": current, "below_floor": floor_breaches}


def _percentile(values: list, pct: float) -> Optional[int]:
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round(pct / 100 * (len(ordered) - 1)))))
    return int(ordered[idx])


def calibration(usages: list[dict], segment_chars: list[int], *, model: str, effort: str,
                system_tokens: Optional[int] = None) -> dict:
    outs = [u.get("output_tokens", 0) for u in usages]
    ins = [u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
           for u in usages]
    body_tokens = sum(max(1, i - (system_tokens or 0)) for i in ins)
    return {"model": model, "effort": effort, "n": len(usages),
            "output_tokens_p50": _percentile(outs, 50), "output_tokens_p90": _percentile(outs, 90),
            "output_tokens_mean": round(sum(outs) / len(outs), 1) if outs else None,
            "output_tokens_max": max(outs) if outs else None,
            "input_tokens_mean": round(sum(ins) / len(ins), 1) if ins else None,
            "system_tokens": system_tokens,
            "chars_per_body_token": round(sum(segment_chars) / body_tokens, 4) if (system_tokens and usages) else None,
            "cache_read_share": round(sum(u.get("cache_read_input_tokens", 0) for u in usages) / sum(ins), 4)
            if sum(ins) else None}
