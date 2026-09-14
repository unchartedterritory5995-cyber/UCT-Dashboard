"""Run the extractor golden gate on the dev split, the drift check and the smaller-model trial.

PC-side, on the gitignored samples and golden labels. It SPENDS, under one TOTAL cap
(--max-usd) shared by every run through a persisted ledger (<out-dir>/spend-ledger.json,
or --ledger). Before any request is sent its worst case (full max_tokens, input priced as
a cache write) is reserved; a request that could cross the cap is never sent.

Transport (--transport):
  batch   (default) the Message Batches API at half price, the production path. Requests
          go in batches sized to what the cap can still reserve, one batch at a time. A
          batch that cannot be collected is charged at its full reservation.
  stream  streaming Messages calls, --concurrency at a time.

A request that stops on max_tokens is re-sent once, one effort level lower, as production
does (batch._build_items). A --limit run is a pilot: it prints, never records.

Phases:
  gate   every dev-split golden segment on --model/--effort. Scored and recorded in --db as
         an extractor_golden evaluation (the gate decision is computed there), with a
         quote-free receipt and the output-token calibration the budget uses.
  drift  --drift-segments of the gate segments again, same model and effort. Record-key
         agreement is recorded as extractor_drift (claude-opus-5 takes no temperature).
  trial  --trial-model on --trial-segments of the gate segments, stratified by stream.
         Per-type delta and cost per kept record are compared with the gate model ON THE
         SAME SEGMENTS, recorded as extractor_trial. A trial is not a gate evaluation: a
         smaller model becomes eligible only through a full gate run of its own.

    python tools/wisdom/extract_golden_gate.py --data-dir <wisdom data> --db <gate.db> --out-dir <dir> --dry-run
    railway run --service web python tools/wisdom/extract_golden_gate.py ... --phases gate,drift,trial
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import extract_common as common  # noqa: E402

TRIAL_KIND = "extractor_trial"
CACHE_WRITE_FACTOR = 1.25
CHAR_ESTIMATE_SLACK = 1.3


class SpendCap:
    """Total spend across runs, persisted; reserve-then-settle so parallel calls cannot overshoot."""

    def __init__(self, ledger: pathlib.Path, max_usd: float):
        self.ledger, self.max_usd, self.lock = ledger, float(max_usd), threading.Lock()
        data = json.loads(ledger.read_text(encoding="utf-8")) if ledger.exists() else {"entries": []}
        self.entries = data.get("entries", [])
        self.spent = sum(float(e.get("usd", 0)) for e in self.entries)
        self.reserved = 0.0

    def reserve(self, usd: float) -> bool:
        with self.lock:
            if self.spent + self.reserved + usd > self.max_usd:
                return False
            self.reserved += usd
            return True

    def settle(self, reserved: float, actual: float, note: dict) -> None:
        with self.lock:
            self.reserved -= reserved
            self.spent += actual
            self.entries.append(dict(note, usd=round(actual, 6), at=common.stamp()))
            common.write_json(self.ledger, {"entries": self.entries, "total_usd": round(self.spent, 6),
                                            "cap_usd": self.max_usd})


def load_gate_segments(data_dir: pathlib.Path, split: str, golden_name: str = ""):
    from api.services.wisdom.extract import golden

    path, golden_version = golden.golden_file(data_dir, prefer=golden_name or None)
    if path is None:
        raise SystemExit(f"INCONCLUSIVE: no golden set {golden_name or ''} under <data-dir>/golden".replace("  ", " "))
    records = [r for r in golden.load_golden(path) if golden.split_for(r) == split]
    samples = data_dir / "samples"
    files, missing = {}, []
    for key in sorted({golden.sample_key(r) for r in records if golden.sample_key(r)}):
        if not (samples / key.partition("#")[0]).exists():
            missing.append(key)
            continue
        files[key] = golden.segments_for_sample(samples, key)
    placed, unplaced = golden.place(records, files)
    items, null_rows = [], 0
    for segment_id in sorted(placed):
        slot = placed[segment_id]
        expected = [e for rec in slot["records"] for e in golden.expected_from_record(rec)]
        # A NULL row carries no expectation; it carries a span the extractor must stay out of.
        nulls = [n for n in (golden.null_from_record(rec) for rec in slot["records"]) if n]
        null_rows += len(nulls)
        items.append({"segment": slot["segment"], "source": golden.source_for_record(slot["records"][0]),
                      "expected": expected, "nulls": nulls, "gids": [r["gid"] for r in slot["records"]]})
    return {"golden_version": golden_version, "golden_file": path.name, "records": len(records),
            # §8a.1: the gate records the golden version AND the sha of the bytes it scored.
            "golden_sha256": golden.golden_sha256(path), "null_rows": null_rows,
            "segments": items, "unplaced": unplaced, "missing_samples": missing}


def stratified(items: list, n: int) -> list:
    """Round-robin over streams in segment-id order: deterministic, every stream represented."""
    if n <= 0 or n >= len(items):
        return list(items)
    by_stream: dict = {}
    for item in items:
        by_stream.setdefault(item["source"]["stream"], []).append(item)
    out, streams = [], sorted(by_stream)
    while len(out) < n:
        for stream in streams:
            if by_stream[stream] and len(out) < n:
                out.append(by_stream[stream].pop(0))
    return out


def worst_case_usd(params: dict, model: str, *, batch: bool) -> float:
    from api.services.wisdom.extract import batch as xbatch, budget

    tokens = int(xbatch.char_estimate_tokens(params) * CHAR_ESTIMATE_SLACK * CACHE_WRITE_FACTOR)
    return budget.estimate_cost(model, tokens, int(params["max_tokens"]), batch=batch)


def interpret(message, cost: float) -> dict:
    from api.services.wisdom.extract import budget

    text = next((b.text for b in message.content if getattr(b, "type", None) == "text"), None)
    out = {"cost": cost, "usage": budget.usage_dict(message.usage), "stop_reason": message.stop_reason}
    if message.stop_reason in ("refusal", "max_tokens"):
        out["error"] = message.stop_reason
        return out
    try:
        out["output"] = json.loads(text or "")
    except ValueError as exc:
        out["error"] = f"json_decode: {exc}"
    return out


def validate_into(result: dict, item: dict, vocab: set) -> dict:
    from api.services.wisdom.extract import writer

    if "output" in result:
        try:
            validation = writer.validate_output(result["output"], segment=item["segment"], source=item["source"],
                                                vocab_names=vocab)
            result["kept"] = validation.kept
            result["counts"] = dict(validation.counts)
        except Exception as exc:  # our validator failing is a tool bug, never a model miss
            result["error"] = f"validate: {type(exc).__name__}: {str(exc)[:300]}"
            result["transport_error"] = True
    result.pop("output", None)
    return result


def stream_call(client, params: dict, model: str, spend: SpendCap, phase: str) -> dict:
    from api.services.wisdom.extract import budget

    worst = worst_case_usd(params, model, batch=False)
    if not spend.reserve(worst):
        return {"skipped": "spend cap"}
    billed, message, error = 0.0, None, None
    try:
        with client.messages.stream(**params) as stream:
            message = stream.get_final_message()
        billed = budget.cost_from_usage(model, message.usage, batch=False)
    except Exception as exc:  # recorded, never printed with request content
        error = f"{type(exc).__name__}: {str(exc)[:600]}"
        # a 4xx is refused before generation; anything else may have billed part of the call
        billed = 0.0 if getattr(exc, "status_code", None) in (400, 401, 403, 404, 413, 422) else worst
    finally:
        spend.settle(worst, billed, {"phase": phase, "model": model, "transport": "stream"})
    if message is None:
        return {"error": error, "transport_error": True, "cost": billed}
    return interpret(message, billed)


def run_batch_round(client, work: list, *, model: str, spend: SpendCap, phase: str, poll_s: float,
                    timeout_s: float, log=print) -> dict:
    """work: [(key, params)]. Sends batches sized to what the cap can reserve, one at a time."""
    from api.services.wisdom.extract import budget

    results: dict = {}
    queue = [(key, params, worst_case_usd(params, model, batch=True)) for key, params in work]
    round_no = 0
    while queue:
        chunk, reserved = [], 0.0
        for entry in queue:
            if not spend.reserve(entry[2]):
                break
            chunk.append(entry)
            reserved += entry[2]
        if not chunk:
            for key, _, _ in queue:
                results[key] = {"skipped": "spend cap"}
            break
        queue = queue[len(chunk):]
        round_no += 1
        requests = [{"custom_id": f"g{phase[:1]}{round_no:02d}x{i:03d}", "params": params}
                    for i, (_, params, _) in enumerate(chunk)]
        keys = {req["custom_id"]: key for req, (key, _, _) in zip(requests, chunk)}
        try:
            created = client.messages.batches.create(requests=requests)
        except Exception as exc:
            spend.settle(reserved, 0.0, {"phase": phase, "model": model, "transport": "batch",
                                         "create_failed": type(exc).__name__})
            for key, _, _ in chunk:
                results[key] = {"error": f"{type(exc).__name__}: {str(exc)[:600]}", "transport_error": True,
                                "cost": 0.0}
            continue
        log(f"  {phase} {model}: batch {created.id} sent with {len(requests)} requests, ${reserved:.2f} reserved")
        actual, collected = 0.0, False
        try:
            deadline = time.monotonic() + timeout_s
            while True:
                status = client.messages.batches.retrieve(created.id)
                if status.processing_status == "ended":
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"still {status.processing_status} after {timeout_s}s")
                time.sleep(poll_s)
            for entry in client.messages.batches.results(created.id):
                key = keys.get(entry.custom_id)
                if key is None:
                    continue
                res = entry.result
                if res.type == "succeeded":
                    cost = budget.cost_from_usage(model, res.message.usage, batch=True)
                    actual += cost
                    results[key] = interpret(res.message, cost)
                else:
                    detail = getattr(getattr(getattr(res, "error", None), "error", None), "type", None)
                    results[key] = {"error": f"{res.type}:{detail}", "transport_error": True, "cost": 0.0}
            collected = True
        except Exception as exc:
            log(f"  {phase}: batch {created.id} was not collected ({type(exc).__name__}: {str(exc)[:300]}); "
                f"charged at its reservation")
        finally:
            spend.settle(reserved, actual if collected else reserved,
                         {"phase": phase, "model": model, "transport": "batch", "batch_id": created.id,
                          "requests": len(requests), "collected": collected})
        for key, _, _ in chunk:
            results.setdefault(key, {"error": "missing_result", "transport_error": True, "cost": 0.0})
        log(f"  {phase} {model}: batch {created.id} collected={collected}, ${actual:.4f}")
    return results


def run_phase(client, items: list, *, model: str, effort: str, spend: SpendCap, phase: str, transport: str,
              concurrency: int, poll_s: float, timeout_s: float) -> list:
    from api.services.wisdom.extract import config, prompt

    system_text = prompt.system_prompt()
    vocab = {v["name"] for v in prompt.vocabulary()}
    results: list = [None] * len(items)
    efforts = {i: effort for i in range(len(items))}
    pending = list(range(len(items)))
    for attempt in (1, 2):
        work = []
        for i in pending:
            try:
                work.append((i, prompt.build_params(items[i]["segment"], items[i]["source"], model=model,
                                                    effort=efforts[i], system_text=system_text)))
            except Exception as exc:
                results[i] = {"error": f"build: {type(exc).__name__}: {str(exc)[:300]}", "transport_error": True,
                              "cost": 0.0}
        if transport == "batch":
            got = run_batch_round(client, work, model=model, spend=spend, phase=phase, poll_s=poll_s,
                                  timeout_s=timeout_s)
        else:
            got = {}
            if work:
                got[work[0][0]] = stream_call(client, work[0][1], model, spend, phase)  # alone: warms the cache
                with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
                    for key, res in zip([k for k, _ in work[1:]],
                                        pool.map(lambda w: stream_call(client, w[1], model, spend, phase), work[1:])):
                        got[key] = res
        retry = []
        for i, res in got.items():
            res["effort"] = efforts[i]
            if attempt == 1:
                res["usage_first"] = res.get("usage")
            else:
                prev = results[i] or {}
                res["cost"] = prev.get("cost", 0.0) + res.get("cost", 0.0)
                res["usage_first"] = prev.get("usage_first")
                res["retried_after"] = prev.get("error")
            results[i] = res
            if attempt == 1 and res.get("error") == "max_tokens" and config.lower_effort(efforts[i]) != efforts[i]:
                efforts[i] = config.lower_effort(efforts[i])
                retry.append(i)
        pending = retry
        if not pending:
            break
    for i, item in enumerate(items):
        res = validate_into(results[i] if results[i] is not None else {"skipped": "not sent"}, item, vocab)
        results[i] = res
        print(f"  {phase} {model} {item['segment']['segment_id'][:10]} effort={res.get('effort')} "
              f"${res.get('cost', 0.0):.4f} kept={len(res.get('kept') or [])} "
              f"{res.get('error') or res.get('skipped') or ''}{' (retried after max_tokens)' if res.get('retried_after') else ''}",
              flush=True)
    return results


def summarise(results) -> dict:
    errors, skipped, broken, retried, cost, kept = {}, 0, 0, 0, 0.0, 0
    for r in results:
        r = r or {"skipped": "not run"}
        cost += r.get("cost", 0.0)
        kept += len(r.get("kept") or [])
        skipped += int(bool(r.get("skipped")))
        broken += int(bool(r.get("transport_error")))
        retried += int(bool(r.get("retried_after")))
        if r.get("error"):
            name = r["error"].split(":")[0]
            errors[name] = errors.get(name, 0) + 1
    return {"calls": len(results), "skipped_spend_cap": skipped, "transport_errors": broken,
            "retried_after_max_tokens": retried, "errors": errors, "cost_usd": round(cost, 6), "records_kept": kept,
            "cost_per_record_usd": round(cost / kept, 6) if kept else None}


def segment_scores(items, results) -> dict:
    from api.services.wisdom.extract import golden

    out = {}
    for item, res in zip(items, results):
        res = res or {}
        r = golden.match_segment(item["expected"], res.get("kept") or [], item["segment"]["text"],
                                 nulls=item.get("nulls") or ())
        out[item["segment"]["segment_id"]] = {
            "tp": dict(r["tp"]), "fp": dict(r["fp"]), "fn": dict(r["fn"]), "lenient_tp": dict(r["lenient_tp"]),
            "scored_predictions": r["scored_predictions"], "unscored_predictions": r["unscored_predictions"],
            "null_fp": dict(r["null_fp"]), "null_declared": dict(r["null_declared"]),
            "null_segments_with_fp": dict(r["null_segments_with_fp"]), "null_spans": r["null_spans"],
            "null_spans_not_found": r["null_spans_not_found"],
            "cost": res.get("cost", 0.0), "kept": len(res.get("kept") or []), "error": res.get("error"),
            "stream": item["source"]["stream"]}
    return out


def keys_by_segment(items, results) -> dict:
    return {item["segment"]["segment_id"]: [list(ch.key(pre_entity=True)) for ch in (res or {}).get("kept") or []]
            for item, res in zip(items, results)}


def print_table(title, per_type):
    print(f"\n{title}")
    print(f"  {'type':<14} {'tp':>4} {'fp':>4} {'fn':>4}  precision (n)      recall (n)      "
          f"null FP (segments)")
    for rtype, m in sorted(per_type.items()):
        p = "-" if m["precision"] is None else f"{m['precision']:.3f}"
        r = "-" if m["recall"] is None else f"{m['recall']:.3f}"
        # The null column is printed as a COUNT over a named denominator, never as a bare rate:
        # "0 of 44" and "no NULL segment declared this type" must not read the same.
        n_null = m.get("null_segments") or 0
        null = f"{m.get('fp_null', 0):>3} in {m.get('null_segments_with_fp', 0)}/{n_null}" if n_null else "     -"
        print(f"  {rtype:<14} {m['tp']:>4} {m['fp']:>4} {m['fn']:>4}  {p:>6} ({m['n_predicted_scored']:>3})     "
              f"{r:>6} ({m['n_expected']:>3})      {null}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--db", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--ledger", help="spend ledger shared by every capped run (default <out-dir>/spend-ledger.json)")
    ap.add_argument("--split", default="dev", choices=("dev", "test"))
    ap.add_argument("--phases", default="gate,drift,trial")
    ap.add_argument("--model")
    ap.add_argument("--effort")
    ap.add_argument("--transport", default="batch", choices=("batch", "stream"))
    ap.add_argument("--trial-model", default="claude-sonnet-5")
    ap.add_argument("--trial-segments", type=int, default=20)
    ap.add_argument("--drift-segments", type=int, default=10)
    #: ⛔ ONE PROGRAM-LEVEL TOTAL, carried in the ledger across every extractor_version,
    #: model and run (owner ruling D-R2, 2026-09-14). It is NOT the remaining headroom:
    #: SpendCap.reserve tests `spent + reserved + usd > max_usd` against the total the
    #: ledger already carries, so passing the remainder would silently halve the budget
    #: and truncate a run into an INCOMPLETE evaluation. Raised 15 -> 40 for Wave 1.5's
    #: multi-pass extraction.
    ap.add_argument("--max-usd", type=float, default=40.0)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--poll-seconds", type=float, default=20.0)
    ap.add_argument("--batch-timeout-seconds", type=float, default=3 * 3600.0)
    ap.add_argument("--limit", type=int, default=0, help="pilot: only the first N gate segments; nothing recorded")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--push-receipt", help="base URL; POSTs receipts to /api/internal/wisdom/extract/eval-runs")
    #: Pin the golden set by FILE NAME. Default is the newest present (golden.GOLDEN_FILES),
    #: which becomes golden-v1.1 the moment that file lands — so an operator who wants the
    #: OLD set back (to compare two golden versions on one extractor) has to be able to ask.
    ap.add_argument("--golden-file", default="", help="e.g. golden-v1.jsonl (default: the newest present)")
    args = ap.parse_args()

    common.bootstrap(args.db)
    from api.services.wisdom.core import store
    from api.services.wisdom.extract import batch, config, golden, prompt

    out_dir = common.out_path(str(pathlib.Path(args.out_dir) / "x")).parent
    (out_dir / "receipts").mkdir(parents=True, exist_ok=True)
    store.init_db()
    model = args.model or config.configured_model()
    effort = args.effort or config.configured_effort()
    version = prompt.extractor_version()
    tag = f"{model}-{effort}-{version}"
    data = load_gate_segments(pathlib.Path(args.data_dir), args.split, args.golden_file)
    items = data["segments"][: args.limit] if args.limit else data["segments"]
    phases = [p.strip() for p in args.phases.split(",") if p.strip()]
    pilot = bool(args.limit)
    worst_one = worst_case_usd(prompt.build_params(items[0]["segment"], items[0]["source"], model=model,
                                                   effort=effort), model, batch=args.transport == "batch") if items else 0
    print(f"extractor_version {version}  model {model}  effort {effort}  transport {args.transport}  "
          f"vocabulary {prompt.vocabulary_source()}")
    print(f"golden {data['golden_file']} ({data['golden_version']} sha {data['golden_sha256'][:12]}): "
          f"{data['records']} {args.split} records ({data['null_rows']} NULL) -> "
          f"{len(items)} segments; unplaced {data['unplaced']}; missing samples {data['missing_samples']}")
    print(f"worst case per request ${worst_one:.2f}; phases {phases}; total cap ${args.max_usd:.2f}"
          f"{'; PILOT (--limit): nothing is recorded' if pilot else ''}")
    report = {"extractor_version": version, "model": model, "effort": effort, "transport": args.transport,
              "split": args.split, "golden_version": data["golden_version"],
              "golden_sha256": data["golden_sha256"], "golden_records": data["records"],
              "golden_null_rows": data["null_rows"],
              "segments": len(items), "unplaced": data["unplaced"], "missing_samples": data["missing_samples"],
              "pilot": pilot, "phases": {}}
    if args.dry_run:
        print("dry run: no API call made")
        common.write_json(out_dir / f"gate-dryrun-{common.stamp()}.json", report)
        return 0

    spend = SpendCap(common.out_path(args.ledger) if args.ledger else out_dir / "spend-ledger.json", args.max_usd)
    print(f"spend so far ${spend.spent:.4f} of ${args.max_usd:.2f}")
    client = batch.make_client()
    receipts = []
    phase_kw = dict(spend=spend, transport=args.transport, concurrency=args.concurrency, poll_s=args.poll_seconds,
                    timeout_s=args.batch_timeout_seconds)

    def complete(summary, n):
        return summary["skipped_spend_cap"] == 0 and summary["transport_errors"] == 0 and summary["calls"] == n

    if "gate" in phases:
        results = run_phase(client, items, model=model, effort=effort, phase="gate", **phase_kw)
        scores = segment_scores(items, results)
        common.write_json(out_dir / f"segment-scores-{tag}.json", scores)
        common.write_json(out_dir / f"keys-{tag}.json", keys_by_segment(items, results))
        metrics = golden.score(list(scores.values()))
        summary = summarise(results)
        entry = {"per_type": metrics["per_type"], "summary": summary, "complete": complete(summary, len(items)),
                 "unscored_predictions": metrics["unscored_predictions"],
                 "null_segments": metrics["null_segments"],
                 "null_false_positives": metrics["null_false_positives"]}
        print_table(f"{args.split} split — {model} {effort} ({summary['calls']} calls, ${summary['cost_usd']:.4f}, "
                    f"{summary['records_kept']} records, errors {summary['errors']}, "
                    f"retried {summary['retried_after_max_tokens']})", metrics["per_type"])
        if not entry["complete"]:
            print("  INCOMPLETE: the spend cap or an API/tool error stopped this phase; no evaluation recorded")
        elif pilot:
            print("  PILOT: not recorded")
        else:
            with store.write() as conn:
                out = golden.record_eval(conn, kind=golden.EVAL_KIND, extractor_version=version,
                                         n=metrics["n_expected"],
                                         metrics={"model": model, "effort": effort, "transport": args.transport,
                                                  "golden_version": data["golden_version"],
                                                  "golden_sha256": data["golden_sha256"], "split": args.split,
                                                  "per_type": metrics["per_type"], "summary": summary,
                                                  "unplaced": data["unplaced"], "segments": len(items),
                                                  "vocabulary_source": prompt.vocabulary_source()})
            entry.update(run_id=out["run_id"], gate=out["gate"])
            print(f"  gate decision: {out['gate']['decision']} (baseline={out['gate'].get('baseline')}, "
                  f"regressions={out['gate'].get('regressions')})")
            receipt = {"kind": golden.EVAL_KIND, "run_id": out["run_id"], "extractor_version": version,
                       "model": model, "effort": effort, "golden_version": data["golden_version"],
                       "golden_sha256": data["golden_sha256"],
                       # ⛔ fp_null is carried BESIDE fp, never instead of it. `import_receipt`
                       # re-derives precision from tp/fp alone, so a receipt that reported only the
                       # null half would understate false positives on the pod by exactly the
                       # predictions the positive labels already caught.
                       "split": args.split,
                       "per_type": {k: {"tp": v["tp"], "fp": v["fp"], "fn": v["fn"],
                                        "fp_null": v.get("fp_null", 0),
                                        "null_segments": v.get("null_segments", 0)}
                                    for k, v in metrics["per_type"].items()},
                       "cost_usd": summary["cost_usd"], "created_at": out["created_at"]}
            common.write_json(out_dir / "receipts" / f"{out['run_id']}.json", receipt)
            receipts.append(receipt)
        report["phases"]["gate"] = entry

        usages = [r["usage_first"] for r in results if r and r.get("usage_first")]
        chars = [len(it["segment"]["text"]) for it, r in zip(items, results) if r and r.get("usage_first")]
        system_tokens = None
        try:
            system_tokens = int(client.messages.count_tokens(
                model=model, system=[{"type": "text", "text": prompt.system_prompt()}],
                messages=[{"role": "user", "content": "."}],
                output_config={"format": {"type": "json_schema", "schema": prompt.api_schema()}}).input_tokens)
        except Exception as exc:
            print(f"  count_tokens for calibration failed: {type(exc).__name__}")
        calibration = golden.calibration(usages, chars, model=model, effort=effort, system_tokens=system_tokens)
        calibration["max_tokens_stops_first_attempt"] = sum(
            1 for r in results if r and (r.get("retried_after") == "max_tokens" or r.get("error") == "max_tokens"))
        common.write_json(out_dir / f"calibration-{tag}.json", calibration)
        if not pilot and usages:
            with store.write() as conn:
                golden.record_eval(conn, kind=golden.CALIBRATION_KIND, extractor_version=version, n=len(usages),
                                   metrics=calibration)
        report["phases"]["calibration"] = calibration
        print(f"  calibration: {calibration}")

    if "drift" in phases:
        keys_file = out_dir / f"keys-{tag}.json"
        first = json.loads(keys_file.read_text(encoding="utf-8")) if keys_file.exists() else {}
        drift_items = stratified([it for it in items if it["segment"]["segment_id"] in first], args.drift_segments)
        if not drift_items:
            print("\ndrift: no gate record keys for this model, effort and version; skipped")
        else:
            results = run_phase(client, drift_items, model=model, effort=effort, phase="drift", **phase_kw)
            second = keys_by_segment(drift_items, results)
            # ⚰️ THE SECOND RUN'S KEYS USED TO BE COMPUTED AND THROWN AWAY, so the only surviving
            # evidence for a drift number was the aggregate it produced. When the 2026-09-14 run
            # reported PRINCIPLE at 0.115 the obvious next question — is that different principles
            # or the same ones reworded? — could not be answered without paying for the run again.
            # A measurement that discards its own inputs cannot be diagnosed, only repeated.
            common.write_json(out_dir / f"keys-drift-{tag}.json", second)
            drift = golden.drift({k: [tuple(x) for x in first[k]] for k in second},
                                 {k: [tuple(x) for x in v] for k, v in second.items()})
            drift.update(summary=summarise(results), model=model, effort=effort, transport=args.transport)
            # ⛔ STABILITY IS A SHIPPING GATE (Wave 1.5 item 1). Decided BEFORE the row is
            # recorded, so the stored drift run carries its own verdict and a later reader
            # cannot mistake "measured" for "accepted".
            with store.read() as conn:
                drift["stability"] = golden.decide_stability(conn, extractor_version=version, model=model,
                                                            effort=effort, by_type=drift["by_type"])
            if complete(drift["summary"], len(drift_items)) and not pilot:
                with store.write() as conn:
                    golden.record_eval(conn, kind=golden.DRIFT_KIND, extractor_version=version, n=len(drift_items),
                                       metrics=drift)
            report["phases"]["drift"] = drift
            print(f"\ndrift over {drift['segments']} segments: identical {drift['identical_segments']}/"
                  f"{drift['segments']}, mean jaccard {drift['mean_jaccard']}, "
                  f"cost ${drift['summary']['cost_usd']:.4f}")
            print(f"  {'type':<14} {'run_1':>6} {'run_2':>6} {'agreed':>7}  jaccard   floor {golden.STABILITY_FLOOR}")
            for rtype, slot in sorted(drift["by_type"].items()):
                j = "  -   " if slot["jaccard"] is None else f"{slot['jaccard']:.3f}"
                mark = "  BELOW FLOOR -> N=3 voting" if slot["below_floor"] else ""
                print(f"  {rtype:<14} {slot['run_1']:>6} {slot['run_2']:>6} {slot['agreed']:>7}  {j}{mark}")
            st = drift["stability"]
            print(f"  stability decision: {st['decision']} (baseline={st['baseline']}, "
                  f"compared_to={st['compared_to']}), below floor: {st['below_floor'] or 'none'}")
            for r in st["regressions"]:
                print(f"    REGRESSION {r['record_type']} jaccard {r['previous']} -> {r['current']} ({r['why']})")

    if "trial" in phases:
        scores_file = out_dir / f"segment-scores-{tag}.json"
        base_scores = json.loads(scores_file.read_text(encoding="utf-8")) if scores_file.exists() else {}
        trial_items = stratified([it for it in items if it["segment"]["segment_id"] in base_scores],
                                 args.trial_segments)
        if not trial_items:
            print("\ntrial: no gate scores for this model, effort and version; skipped")
        else:
            results = run_phase(client, trial_items, model=args.trial_model, effort=effort, phase="trial", **phase_kw)
            trial_scores = segment_scores(trial_items, results)
            ids = [it["segment"]["segment_id"] for it in trial_items]
            base = golden.score([base_scores[s] for s in ids])
            trial = golden.score([trial_scores[s] for s in ids])
            summary = summarise(results)
            base_cost = sum(base_scores[s]["cost"] for s in ids)
            base_kept = sum(base_scores[s]["kept"] for s in ids)
            delta = {}
            for rtype in sorted(set(base["per_type"]) | set(trial["per_type"])):
                b, t = base["per_type"].get(rtype) or {}, trial["per_type"].get(rtype) or {}
                delta[rtype] = {m: (None if b.get(m) is None or t.get(m) is None else round(t[m] - b[m], 6))
                                for m in ("precision", "recall")}
                delta[rtype].update(n_expected=(t or b).get("n_expected"),
                                    n_predicted_scored_trial=t.get("n_predicted_scored"),
                                    n_predicted_scored_base=b.get("n_predicted_scored"))
            entry = {"trial_model": args.trial_model, "base_model": model, "effort": effort,
                     "transport": args.transport, "segments": len(ids), "segment_ids": ids,
                     "per_type_trial": trial["per_type"], "per_type_base_same_segments": base["per_type"],
                     "delta": delta, "summary": summary,
                     "cost_usd": {"trial": summary["cost_usd"], "base": round(base_cost, 6)},
                     "cost_per_kept_record_usd": {
                         "trial": summary["cost_per_record_usd"],
                         "base": round(base_cost / base_kept, 6) if base_kept else None},
                     "complete": complete(summary, len(ids))}
            print_table(f"trial subset ({len(ids)} segments) — {model} {effort}", base["per_type"])
            print_table(f"trial subset ({len(ids)} segments) — {args.trial_model} {effort}", trial["per_type"])
            print(f"\ntrial {args.trial_model} minus {model} on the same segments, per type: {json.dumps(delta)}")
            print(f"cost on those segments: {model} ${base_cost:.4f} ({base_kept} records) | {args.trial_model} "
                  f"${summary['cost_usd']:.4f} ({summary['records_kept']} records); per kept record "
                  f"{entry['cost_per_kept_record_usd']}")
            if entry["complete"] and not pilot:
                with store.write() as conn:
                    golden.record_eval(conn, kind=TRIAL_KIND, extractor_version=version, n=len(ids),
                                       metrics={k: v for k, v in entry.items() if k != "segment_ids"})
            else:
                print("  trial not recorded (incomplete or pilot)")
            report["phases"]["trial"] = entry

    report["spend_total_usd"] = round(spend.spent, 6)
    common.write_json(out_dir / f"gate-report-{common.stamp()}.json", report)
    print(f"\ntotal spend recorded: ${spend.spent:.4f} of ${args.max_usd:.2f}")

    if args.push_receipt and receipts:
        import os

        import httpx

        secret = os.environ.get("PUSH_SECRET", "")
        if not secret:
            print("no PUSH_SECRET in the environment; receipts not pushed")
        for receipt in receipts:
            if not secret:
                break
            resp = httpx.post(args.push_receipt.rstrip("/") + "/api/internal/wisdom/extract/eval-runs",
                              json=receipt, timeout=30.0,
                              headers={"Authorization": f"Bearer {secret}", "User-Agent": "Mozilla/5.0 wisdom-gate"})
            print(f"pushed receipt {receipt['run_id']} ({receipt['model']}): HTTP {resp.status_code}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
