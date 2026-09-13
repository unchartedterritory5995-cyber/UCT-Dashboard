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

Every rate carries its n. A denominator of 0 records value NULL, never 0%.
"""
from __future__ import annotations

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
_WORD = re.compile(r"[a-z0-9$%.]+")


# ── golden files ─────────────────────────────────────────────────────────────

def golden_file(data_dir) -> tuple[Optional[pathlib.Path], Optional[str]]:
    """golden-v1.jsonl when present, else the v0 draft (CONTRACTS §6.4)."""
    base = pathlib.Path(data_dir) / "golden"
    for name, version in (("golden-v1.jsonl", "golden-v1"), ("golden-v0.draft.jsonl", "golden-v0-draft")):
        if (base / name).exists():
            return base / name, version
    return None, None


def load_golden(path) -> list[dict]:
    out = []
    for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.append(json.loads(line))
    return out


def split_for(record: dict) -> str:
    """The record's own split when it carries one; else sha24(gid) parity."""
    if record.get("split") in SPLITS:
        return record["split"]
    return "dev" if int(ids.sha24(record["gid"])[-1], 16) % 2 == 0 else "test"


@dataclass(frozen=True)
class Expected:
    gid: str
    record_type: str
    ticker: Optional[str]
    stance: Optional[str]
    direction: Optional[str]
    statement: Optional[str]
    quote: str


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
    return set(_WORD.findall(str(text or "").casefold()))


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if (a or b) else 0.0


def _overlap_ratio(a: tuple[int, int], b: tuple[int, int]) -> float:
    inter = max(0, min(a[1], b[1]) - max(a[0], b[0]))
    shortest = min(a[1] - a[0], b[1] - b[0])
    return inter / shortest if shortest > 0 else 0.0


def match_segment(expected: list[Expected], predicted: list, segment_text: str) -> dict:
    spans = []
    for e in expected:
        idx = segment_text.find(e.quote)
        if idx >= 0:
            spans.append((idx, idx + len(e.quote)))
    scored = [p for p in predicted if any(_overlap_ratio((p.q_start, p.q_end), s) > 0 for s in spans)]
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
    return {"tp": tp, "fp": fp, "fn": fn, "lenient_tp": lenient_tp, "scored_predictions": len(scored),
            "unscored_predictions": len(predicted) - len(scored), "outcomes": outcomes}


def _rate(num: int, den: int) -> Optional[float]:
    return round(num / den, 6) if den else None


def score(segment_results: Iterable[dict]) -> dict:
    tp, fp, fn, lenient = Counter(), Counter(), Counter(), Counter()
    scored = unscored = 0
    for r in segment_results:
        tp.update(r["tp"])
        fp.update(r["fp"])
        fn.update(r["fn"])
        lenient.update(r["lenient_tp"])
        scored += r["scored_predictions"]
        unscored += r["unscored_predictions"]
    per_type = {}
    for rtype in writer.RECORD_TYPES:
        t, f_p, f_n = tp[rtype], fp[rtype], fn[rtype]
        if not (t or f_p or f_n):
            continue
        per_type[rtype] = {"tp": t, "fp": f_p, "fn": f_n, "precision": _rate(t, t + f_p), "recall": _rate(t, t + f_n),
                           "n_expected": t + f_n, "n_predicted_scored": t + f_p,
                           "type_ticker_recall": _rate(lenient[rtype], t + f_n)}
    return {"per_type": per_type, "n_expected": sum(tp.values()) + sum(fn.values()),
            "scored_predictions": scored, "unscored_predictions": unscored}


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
                per_type: dict) -> dict:
    previous = None
    for run in _runs(conn, EVAL_KIND):
        m = run["metrics"]
        if (m.get("gate") or {}).get("decision") != "accepted":
            continue
        if m.get("golden_version") != golden_version or m.get("split") != split:
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
        for key in ("model", "effort", "golden_version", "split", "per_type"):
            if key not in payload:
                raise ValueError(f"an extractor_golden evaluation needs {key!r}")
        payload["gate"] = decide_gate(conn, extractor_version=extractor_version, model=payload["model"],
                                      effort=payload["effort"], golden_version=payload["golden_version"],
                                      split=payload["split"], per_type=payload["per_type"])
    run_id = ids.sha24(kind, extractor_version, payload.get("model"), now, time.time_ns())
    conn.execute("INSERT INTO wisdom_eval_runs (run_id, kind, extractor_version, method_version, n, metrics_json, "
                 "created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                 (run_id, kind, extractor_version, METHOD_VERSION, int(n), json.dumps(payload, sort_keys=True), now))
    if kind == EVAL_KIND:
        for rtype, m in payload["per_type"].items():
            slice_json = json.dumps({"record_type": rtype, "split": payload["split"], "model": payload["model"],
                                     "extractor_version": extractor_version, "golden_version": payload["golden_version"],
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
                "golden_version": m.get("golden_version"), "gate": gate, "per_type": m.get("per_type"),
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
               "per_type": per_type, "receipt_id": receipt_id, "source": "receipt",
               "cost_usd": receipt.get("cost_usd"), "measured_at": receipt.get("created_at")}
    out = record_eval(conn, kind=EVAL_KIND, extractor_version=version, metrics=metrics,
                      n=sum(v["n_expected"] for v in per_type.values()), now_iso=now_iso)
    out["duplicate"] = False
    return out


# ── drift and calibration ────────────────────────────────────────────────────

def drift(run_a: dict, run_b: dict) -> dict:
    """run_x: {segment_id: [record keys]}. Multiset agreement per segment, by type."""
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
    return {"segments": len(segments), "identical_segments": identical,
            "mean_jaccard": round(sum(jaccards) / len(jaccards), 6) if jaccards else None, "by_type": by_type}


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
