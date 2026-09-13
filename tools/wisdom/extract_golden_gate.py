"""Run the extractor golden gate on the dev split, the drift check and the smaller-model trial.

PC-side, on the gitignored samples and golden labels. LIVE Messages API (streaming),
so it SPENDS: every phase is capped by --max-usd, which is a TOTAL across runs,
kept in <out-dir>/spend-ledger.json (or --ledger). Before each call the worst case (full max_tokens)
is reserved; a call that could cross the cap is never made.

    phases:
      gate   run --model over every dev-split golden segment; score; record the evaluation
             (wisdom_eval_runs + wisdom_metrics in --db, gate decision computed there);
             record the calibration (p50/p90 output tokens) the budget uses.
      drift  re-run --drift-segments of the gate segments with the same model and record
             run-to-run agreement (claude-opus-5 accepts no temperature; drift is measured).
      trial  run --trial-model over the same segments; record it as an evaluation of the
             same extractor_version, which the gate accepts only on a tie or better (D5);
             print the per-type delta and the cost per record.

Outputs (quote-free) under --out-dir: receipts/<run_id>.json (counts only — push with
--push-receipt to the prod internal route), gate-report-<stamp>.json, the spend ledger,
and keys-<model>.json (record keys per segment, for drift; gitignored data only).

    python tools/wisdom/extract_golden_gate.py --data-dir <wisdom data> --db <gate.db> \
        --out-dir <wisdom data>/extract --dry-run
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


def load_gate_segments(data_dir: pathlib.Path, split: str):
    from api.services.wisdom.extract import golden

    path, golden_version = golden.golden_file(data_dir)
    if path is None:
        raise SystemExit("INCONCLUSIVE: no golden set under <data-dir>/golden")
    records = [r for r in golden.load_golden(path) if golden.split_for(r) == split]
    samples = data_dir / "samples"
    files, missing = {}, []
    for key in sorted({golden.sample_key(r) for r in records if golden.sample_key(r)}):
        if not (samples / key.partition("#")[0]).exists():
            missing.append(key)
            continue
        files[key] = golden.segments_for_sample(samples, key)
    placed, unplaced = golden.place(records, files)
    items = []
    for segment_id in sorted(placed):
        slot = placed[segment_id]
        expected = [e for rec in slot["records"] for e in golden.expected_from_record(rec)]
        items.append({"segment": slot["segment"], "source": golden.source_for_record(slot["records"][0]),
                      "expected": expected, "gids": [r["gid"] for r in slot["records"]]})
    return {"golden_version": golden_version, "golden_file": path.name, "records": len(records),
            "segments": items, "unplaced": unplaced, "missing_samples": missing}


def call_model(client, params: dict, model: str, spend: SpendCap, phase: str) -> dict:
    from api.services.wisdom.extract import batch, budget

    worst = budget.estimate_cost(model, int(batch.char_estimate_tokens(params) * 1.3), params["max_tokens"],
                                 batch=False)
    if not spend.reserve(worst):
        return {"skipped": "spend cap"}
    actual, message, error = 0.0, None, None
    try:
        with client.messages.stream(**params) as stream:
            message = stream.get_final_message()
        actual = budget.cost_from_usage(model, message.usage, batch=False)
    except Exception as exc:  # recorded, never printed with request content
        error = f"{type(exc).__name__}: {str(exc)[:600]}"
    finally:
        spend.settle(worst, actual, {"phase": phase, "model": model})
    if message is None:
        # An API/transport failure is not an extractor outcome: the phase is incomplete.
        return {"error": error, "transport_error": True, "cost": actual}
    text = next((b.text for b in message.content if getattr(b, "type", None) == "text"), None)
    out = {"cost": actual, "usage": budget.usage_dict(message.usage), "stop_reason": message.stop_reason}
    if message.stop_reason in ("refusal", "max_tokens"):
        out["error"] = message.stop_reason
        return out
    try:
        out["output"] = json.loads(text or "")
    except ValueError as exc:
        out["error"] = f"json_decode: {exc}"
    return out


def run_phase(client, items: list[dict], *, model: str, effort: str, spend: SpendCap, phase: str,
              concurrency: int) -> list[dict]:
    from api.services.wisdom.extract import prompt, writer

    system_text = prompt.system_prompt()
    vocab = {v["name"] for v in prompt.vocabulary()}

    def one(item):
        try:
            params = prompt.build_params(item["segment"], item["source"], model=model, effort=effort,
                                         system_text=system_text)
        except Exception as exc:
            return {"error": f"build: {type(exc).__name__}: {str(exc)[:200]}", "transport_error": True, "cost": 0.0}
        result = call_model(client, params, model, spend, phase)
        if "output" in result:
            try:
                validation = writer.validate_output(result["output"], segment=item["segment"],
                                                    source=item["source"], vocab_names=vocab)
                result["kept"] = validation.kept
                result["counts"] = dict(validation.counts)
            except Exception as exc:  # our validator failing is a tool bug, never a model miss
                result["error"] = f"validate: {type(exc).__name__}: {str(exc)[:200]}"
                result["transport_error"] = True
        result.pop("output", None)
        print(f"  {phase} {model} {item['segment']['segment_id'][:10]} ${result.get('cost', 0.0):.4f} "
              f"kept={len(result.get('kept') or [])} {result.get('error') or result.get('skipped') or ''}", flush=True)
        return result

    results = [None] * len(items)
    if items:
        results[0] = one(items[0])  # alone first, so the system prompt is cached for the rest
    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        for i, res in zip(range(1, len(items)), pool.map(one, items[1:])):
            results[i] = res
    return results


def score(items, results):
    from api.services.wisdom.extract import golden

    seg_results = []
    for item, res in zip(items, results):
        seg_results.append(golden.match_segment(item["expected"], (res or {}).get("kept") or [],
                                                item["segment"]["text"]))
    return golden.score(seg_results)


def summarise(results) -> dict:
    errors, skipped, broken, cost, kept = {}, 0, 0, 0.0, 0
    for r in results:
        r = r or {"skipped": "not run"}
        cost += r.get("cost", 0.0)
        kept += len(r.get("kept") or [])
        if r.get("skipped"):
            skipped += 1
        if r.get("transport_error"):
            broken += 1
        if r.get("error"):
            errors[r["error"].split(":")[0]] = errors.get(r["error"].split(":")[0], 0) + 1
    return {"calls": len(results), "skipped_spend_cap": skipped, "transport_errors": broken, "errors": errors,
            "cost_usd": round(cost, 6), "records_kept": kept,
            "cost_per_record_usd": round(cost / kept, 6) if kept else None}


def keys_by_segment(items, results) -> dict:
    return {item["segment"]["segment_id"]: [list(ch.key(pre_entity=True)) for ch in (res or {}).get("kept") or []]
            for item, res in zip(items, results)}


def print_table(title, per_type):
    print(f"\n{title}")
    print(f"  {'type':<14} {'tp':>4} {'fp':>4} {'fn':>4}  precision (n)      recall (n)")
    for rtype, m in sorted(per_type.items()):
        p = "-" if m["precision"] is None else f"{m['precision']:.3f}"
        r = "-" if m["recall"] is None else f"{m['recall']:.3f}"
        print(f"  {rtype:<14} {m['tp']:>4} {m['fp']:>4} {m['fn']:>4}  {p:>6} ({m['n_predicted_scored']:>3})     "
              f"{r:>6} ({m['n_expected']:>3})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--db", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--split", default="dev", choices=("dev", "test"))
    ap.add_argument("--phases", default="gate,drift,trial")
    ap.add_argument("--model")
    ap.add_argument("--effort")
    ap.add_argument("--trial-model", default="claude-sonnet-5")
    ap.add_argument("--drift-segments", type=int, default=10)
    ap.add_argument("--max-usd", type=float, default=15.0)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--limit", type=int, default=0, help="only the first N gate segments (pilot)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--push-receipt", help="base URL; POSTs receipts to /api/internal/wisdom/extract/eval-runs")
    ap.add_argument("--ledger", help="spend ledger shared by every capped run (default <out-dir>/spend-ledger.json)")
    args = ap.parse_args()

    common.bootstrap(args.db)
    from api.services.wisdom.core import store
    from api.services.wisdom.extract import batch, budget, config, golden, prompt

    out_dir = common.out_path(str(pathlib.Path(args.out_dir) / "x")).parent
    (out_dir / "receipts").mkdir(parents=True, exist_ok=True)
    store.init_db()
    model = args.model or config.configured_model()
    effort = args.effort or config.configured_effort()
    version = prompt.extractor_version()
    data = load_gate_segments(pathlib.Path(args.data_dir), args.split)
    items = data["segments"][: args.limit] if args.limit else data["segments"]
    phases = [p.strip() for p in args.phases.split(",") if p.strip()]
    worst_one = budget.estimate_cost(model, 12_000, prompt.MAX_TOKENS, batch=False)
    print(f"extractor_version {version}  model {model}  effort {effort}  vocabulary {prompt.vocabulary_source()}")
    print(f"golden {data['golden_file']} ({data['golden_version']}): {data['records']} {args.split} records -> "
          f"{len(items)} segments; unplaced {len(data['unplaced'])} {data['unplaced']}; "
          f"missing samples {data['missing_samples']}")
    print(f"worst case per call ${worst_one:.2f}; phases {phases}; total cap ${args.max_usd:.2f}")
    report = {"extractor_version": version, "model": model, "effort": effort, "split": args.split,
              "golden_version": data["golden_version"], "golden_records": data["records"],
              "segments": len(items), "unplaced": data["unplaced"], "missing_samples": data["missing_samples"],
              "phases": {}}
    if args.dry_run:
        print("dry run: no API call made")
        common.write_json(out_dir / f"gate-dryrun-{common.stamp()}.json", report)
        return 0

    spend = SpendCap(common.out_path(args.ledger) if args.ledger else out_dir / "spend-ledger.json", args.max_usd)
    print(f"spend so far ${spend.spent:.4f} of ${args.max_usd:.2f}")
    client = batch.make_client()
    receipts = []

    def record_evaluation(phase_model, results):
        metrics = score(items, results)
        summary = summarise(results)
        complete = summary["skipped_spend_cap"] == 0 and summary["transport_errors"] == 0 and len(results) == len(items)
        entry = {"per_type": metrics["per_type"], "summary": summary, "complete": complete,
                 "unscored_predictions": metrics["unscored_predictions"]}
        print_table(f"{args.split} split — {phase_model} ({summary['calls']} calls, ${summary['cost_usd']:.4f}, "
                    f"{summary['records_kept']} records, errors {summary['errors']})", metrics["per_type"])
        if not complete:
            print("  INCOMPLETE: the spend cap or an API/tool error stopped this phase; no evaluation recorded")
            return entry
        with store.write() as conn:
            out = golden.record_eval(conn, kind=golden.EVAL_KIND, extractor_version=version, n=metrics["n_expected"],
                                     metrics={"model": phase_model, "effort": effort,
                                              "golden_version": data["golden_version"], "split": args.split,
                                              "per_type": metrics["per_type"], "summary": summary,
                                              "unplaced": data["unplaced"], "segments": len(items),
                                              "vocabulary_source": prompt.vocabulary_source()})
        entry.update(run_id=out["run_id"], gate=out["gate"])
        print(f"  gate decision: {out['gate']['decision']} (baseline={out['gate'].get('baseline')}, "
              f"regressions={out['gate'].get('regressions')})")
        receipt = {"kind": golden.EVAL_KIND, "run_id": out["run_id"], "extractor_version": version,
                   "model": phase_model, "effort": effort, "golden_version": data["golden_version"],
                   "split": args.split, "per_type": {k: {"tp": v["tp"], "fp": v["fp"], "fn": v["fn"]}
                                                     for k, v in metrics["per_type"].items()},
                   "cost_usd": summary["cost_usd"], "created_at": out["created_at"]}
        common.write_json(out_dir / "receipts" / f"{out['run_id']}.json", receipt)
        receipts.append(receipt)
        return entry

    if "gate" in phases:
        results = run_phase(client, items, model=model, effort=effort, spend=spend, phase="gate",
                            concurrency=args.concurrency)
        report["phases"]["gate"] = record_evaluation(model, results)
        common.write_json(out_dir / f"keys-{model}.json", keys_by_segment(items, results))
        usages = [r["usage"] for r in results if r and r.get("usage")]
        chars = [len(it["segment"]["text"]) for it, r in zip(items, results) if r and r.get("usage")]
        system_tokens = None
        try:
            system_tokens = int(client.messages.count_tokens(
                model=model, system=[{"type": "text", "text": prompt.system_prompt()}],
                messages=[{"role": "user", "content": "."}],
                output_config={"format": {"type": "json_schema", "schema": prompt.api_schema()}}).input_tokens)
        except Exception as exc:
            print(f"  count_tokens for calibration failed: {type(exc).__name__}")
        calibration = golden.calibration(usages, chars, model=model, effort=effort, system_tokens=system_tokens)
        with store.write() as conn:
            golden.record_eval(conn, kind=golden.CALIBRATION_KIND, extractor_version=version, n=len(usages),
                               metrics=calibration)
        common.write_json(out_dir / f"calibration-{model}-{effort}.json", calibration)
        report["phases"]["calibration"] = calibration
        print(f"  calibration: {calibration}")

    if "drift" in phases:
        keys_file = out_dir / f"keys-{model}.json"
        first = json.loads(keys_file.read_text(encoding="utf-8")) if keys_file.exists() else {}
        drift_items = [it for it in items if it["segment"]["segment_id"] in first][: args.drift_segments]
        results = run_phase(client, drift_items, model=model, effort=effort, spend=spend, phase="drift",
                            concurrency=args.concurrency)
        second = keys_by_segment(drift_items, results)
        run_1 = {k: [tuple(x) for x in first[k]] for k in second}
        run_2 = {k: [tuple(x) for x in v] for k, v in second.items()}
        drift = golden.drift(run_1, run_2)
        drift.update(summary=summarise(results), model=model, effort=effort)
        if drift["summary"]["skipped_spend_cap"] == 0 and drift["summary"]["transport_errors"] == 0 and drift_items:
            with store.write() as conn:
                golden.record_eval(conn, kind=golden.DRIFT_KIND, extractor_version=version, n=len(drift_items),
                                   metrics=drift)
        report["phases"]["drift"] = drift
        print(f"\ndrift over {drift['segments']} segments: identical {drift['identical_segments']}/"
              f"{drift['segments']}, mean jaccard {drift['mean_jaccard']}, by type {drift['by_type']}")

    if "trial" in phases:
        results = run_phase(client, items, model=args.trial_model, effort=effort, spend=spend, phase="trial",
                            concurrency=args.concurrency)
        trial = record_evaluation(args.trial_model, results)
        base = (report["phases"].get("gate") or {}).get("per_type") or {}
        delta = {}
        for rtype in sorted(set(base) | set(trial["per_type"])):
            b, t = base.get(rtype) or {}, trial["per_type"].get(rtype) or {}
            delta[rtype] = {m: (None if b.get(m) is None or t.get(m) is None else round(t[m] - b[m], 6))
                            for m in ("precision", "recall")}
            delta[rtype].update(n_expected=t.get("n_expected"), n_predicted_scored_trial=t.get("n_predicted_scored"),
                                n_predicted_scored_base=b.get("n_predicted_scored"))
        trial["delta_vs_base"] = delta
        report["phases"]["trial"] = trial
        print(f"\ntrial {args.trial_model} minus {model}, per type: {json.dumps(delta)}")
        base_cost = (report["phases"].get("gate") or {}).get("summary", {}).get("cost_per_record_usd")
        print(f"cost per kept record: {model} {base_cost}  {args.trial_model} {trial['summary']['cost_per_record_usd']}")

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
