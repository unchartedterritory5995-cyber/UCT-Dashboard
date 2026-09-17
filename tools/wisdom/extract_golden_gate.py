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
from typing import Optional
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import extract_common as common  # noqa: E402
import gate_records  # noqa: E402

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
        self.breached = False

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
            # ⛔⛔ R36's SECOND HALF, and the first half is not safe without it. A reservation
            # derived from measured history can sit BELOW the largest real request, so the cap has
            # to be tested against what was ACTUALLY spent, after every batch, not only against
            # what was reserved before it.
            self.breached = self.spent > self.max_usd

    def refuses_next_batch(self) -> bool:
        """True once ACTUALS have passed the cap. Checked before each batch is sent."""
        return bool(getattr(self, "breached", False))


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


# ── R36: reserve from MEASURED history, not a constant ceiling (owner ruling, 2026-09-15) ────
#
# ⛔⛔ THE PROBLEM IT FIXES. `worst_case_usd` is dominated by `prompt.MAX_TOKENS = 32000`, a
# CEILING, not an estimate: the output leg alone is 32000 x $25/Mtok x 0.5 = $0.4000 per request,
# fixed, independent of the segment. Measured over the three 2026-09-15 passes, that reservation
# was **90% ceiling** and the actual bill was **14% of it** — so the cap throttled SCHEDULING (2,
# then 3, then 4 batch rounds) while spending nothing extra.
#
# ⚰️ WHAT THIS COMMENT USED TO CLAIM, AND WHY THE CORRECTION IS RECORDED RATHER THAN QUIETLY MADE.
# It read: "new entries now record `extractor_version` so a future run CAN filter by it." **No
# settle call site passed it.** The ledger carried exactly `at, batch_id, collected, model, phase,
# requests, transport, usd` — a comment claiming a fix that was never wired, which is the
# `lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run` shape. R48 (owner ruling,
# 2026-09-15) is that wiring, so the sentence is now true of entries written from here on.
#
# ⛔ TWO ESTIMATORS, IN PREFERENCE ORDER, AND THE THIRD IS THE CEILING:
#   1. `measured_token_reservation_usd` — the ruling's own form: p90 x 1.5 over MEASURED tokens
#      per request, priced through `budget.estimate_cost`. Needs entries carrying token counts,
#      which only exist from R48 onward.
#   2. `measured_reservation_usd` — p90 x 1.5 over measured **cost per request**, the same
#      quantity the cap is denominated in. Works on the 28 pre-R48 entries, which carry no tokens.
#   3. `worst_case_usd` — the constant ceiling, for an unmeasured configuration.
#
# ⛔⛔ ABSENT IS UNKNOWN, NEVER ZERO. The 28 pre-R48 entries have no `input_tokens`/`output_tokens`
# and are never to be read as having used none: estimator 1 SKIPS an entry without counts rather
# than averaging a zero into it. An absent field read as zero would drag the p90 toward nothing and
# reserve less than a real request costs — the exact failure the second half below exists to catch.
#
# ⛔ AND IT IS ONLY SAFE BECAUSE OF THE SECOND HALF. p90 x 1.5 can sit BELOW the largest real
# request — measured: p90 x 1.5 = 15,962 output tokens against an observed max of 18,857 (0.85x).
# A reservation under the biggest real request would let ACTUALS pass a cap that is only tested at
# reserve time, so `SpendCap.settle` now re-checks the cap against actuals after EVERY batch and
# refuses the next one on breach.
RESERVE_P90_MULTIPLIER = 1.5
RESERVE_MIN_HISTORY = 3
RESERVE_HISTORY_ENTRIES = 24

#: R48: two entries carrying token counts are enough to prefer the ruled token form over the
#: cost-per-request fallback. Lower than RESERVE_MIN_HISTORY on purpose — a token p90 is the
#: estimate the ruling asks for, and one clean gate phase produces one entry.
RESERVE_MIN_TOKEN_HISTORY = 2

#: The largest single-request output the three 2026-09-15 passes produced. Recorded so a future
#: tightening that would reserve less than a request of this size really costs fails a test.
OBSERVED_MAX_OUTPUT_TOKENS = 18857


def _percentile(values: list, q: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    idx = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
    return ordered[idx]


def transport_label(*, batch: bool) -> str:
    """The `transport` string the ledger actually records.

    ⛔ ONE authority, because there were two and they disagreed: `stream_call` wrote
    `transport: "stream"` while `reservation_usd` looked up `"sync"`, so stream history could
    never match its own entries. Inert today (only `run_batch_round` reserves), and left inert
    rather than left wrong — a second lookup built on a mismatched key inherits the mismatch.
    """
    return "batch" if batch else "stream"


#: The three keys `golden.calibration` sums into its own `input_tokens_mean` (golden.py:881-882).
#: ⛔ Named here rather than re-typed so the ledger's input leg and the calibration row agree by
#: construction — two definitions of "input tokens" is a second authority over one value.
INPUT_TOKEN_KEYS = ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


def _input_tokens(usage: dict) -> int:
    return sum(int(usage.get(k) or 0) for k in INPUT_TOKEN_KEYS)


def token_fields(input_tokens: int, output_tokens: int, observed: int, sent: int) -> dict:
    """The R48 token half of a ledger entry — ABSENT unless every sent request was measured.

    ⛔⛔ TWO RULES, AND BOTH ARE ABOUT NOT LYING WITH A NUMBER:

    1. **Absent, never zero.** A batch that timed out, failed to create, or collected nothing used
       an unknown number of tokens, not none. Writing `output_tokens: 0` would read to an
       estimator as a measured request that cost nothing and would pull the p90 down.
    2. **All-or-nothing against `sent`.** The counts are summed over SUCCEEDED results while the
       entry's own `requests` counts what was SENT, so a partially-collected batch would be
       divided by too large a denominator and under-estimate tokens per request. Rather than add a
       second denominator field the ruling does not name, a partial batch contributes no token
       history at all — fewer entries, never a wrong one.
    """
    if observed <= 0 or observed != sent:
        return {}
    return {"input_tokens": int(input_tokens), "output_tokens": int(output_tokens)}


def measured_token_reservation_usd(entries: list, model: str, *, batch: bool) -> Optional[float]:
    """R48/R36: p90 x 1.5 of MEASURED tokens per request, priced. None when history is too thin.

    ⛔ An entry WITHOUT token counts is skipped, never counted as zero — see the block above.
    """
    from api.services.wisdom.extract import budget

    transport = transport_label(batch=batch)
    per_in, per_out = [], []
    for entry in reversed(entries):
        if len(per_out) >= RESERVE_HISTORY_ENTRIES:
            break
        if entry.get("model") != model or entry.get("transport") != transport:
            continue
        got_in, got_out = entry.get("input_tokens"), entry.get("output_tokens")
        if got_in is None or got_out is None:
            continue  # ⛔ unknown, not zero
        requests = entry.get("requests") or 0
        if requests <= 0:
            continue
        per_in.append(float(got_in) / requests)
        per_out.append(float(got_out) / requests)
    if len(per_out) < RESERVE_MIN_TOKEN_HISTORY:
        return None
    return budget.estimate_cost(model,
                                int(round(_percentile(per_in, 0.9) * RESERVE_P90_MULTIPLIER)),
                                int(round(_percentile(per_out, 0.9) * RESERVE_P90_MULTIPLIER)),
                                batch=batch)


def measured_reservation_usd(entries: list, model: str, *, transport: str) -> Optional[float]:
    """p90 of ACTUAL cost-per-request over recent same-model, same-transport batches, x1.5.

    Returns None when there is too little history — an unmeasured configuration must fall back to
    the worst case rather than guess, which is the whole point of having a floor.
    """
    per_request = []
    for entry in reversed(entries):
        if len(per_request) >= RESERVE_HISTORY_ENTRIES:
            break
        if entry.get("model") != model or entry.get("transport") != transport:
            continue
        requests = entry.get("requests") or 0
        usd = float(entry.get("usd") or 0.0)
        if requests > 0 and usd > 0:
            per_request.append(usd / requests)
    if len(per_request) < RESERVE_MIN_HISTORY:
        return None
    return _percentile(per_request, 0.9) * RESERVE_P90_MULTIPLIER


def reservation_usd(params: dict, model: str, *, batch: bool, entries: Optional[list] = None) -> float:
    """What to RESERVE for one request: tokens if measured, else cost-per-request, else the ceiling.

    ⛔ Never above the worst case — reserving more than the ceiling would be strictly worse than
    the rule it replaces.
    """
    ceiling = worst_case_usd(params, model, batch=batch)
    entries = entries or []
    # R48: the ruling's own form first; the pre-R48 entries carry no tokens, so this is None until
    # two token-bearing entries exist and the cost-per-request fallback carries the run until then.
    measured = measured_token_reservation_usd(entries, model, batch=batch)
    if measured is None:
        measured = measured_reservation_usd(entries, model, transport=transport_label(batch=batch))
    if measured is None:
        return ceiling
    return min(ceiling, measured)


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


def validate_into(result: dict, item: dict, vocab: set, *, keep_raw: bool = False) -> dict:
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
    raw = result.pop("output", None)
    # ⛔ R12: the raw output used to die on this line, which is why a validator bug was as
    # undiagnosable offline as a scorer bug. It is now MOVED, not kept in place, and under a
    # private key that `gate_records.persist_phase` strips again the moment it has written it —
    # so nothing downstream of persistence can see it and every aggregate stays byte-identical.
    if keep_raw and raw is not None:
        result[gate_records.RAW_KEY] = raw
    return result


def stream_call(client, params: dict, model: str, spend: SpendCap, phase: str,
                ledger_extra: Optional[dict] = None) -> dict:
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
        note = {"phase": phase, "model": model, "transport": transport_label(batch=False),
                "requests": 1, "rounds": 1}
        if message is not None:
            usage = budget.usage_dict(message.usage)
            note.update(token_fields(_input_tokens(usage), int(usage.get("output_tokens") or 0),
                                     observed=1, sent=1))
        spend.settle(worst, billed, dict(ledger_extra or {}, **note))
    if message is None:
        return {"error": error, "transport_error": True, "cost": billed}
    return interpret(message, billed)


def run_batch_round(client, work: list, *, model: str, spend: SpendCap, phase: str, poll_s: float,
                    timeout_s: float, log=print, ledger_extra: Optional[dict] = None) -> dict:
    """work: [(key, params)]. Sends batches sized to what the cap can reserve, one at a time."""
    from api.services.wisdom.extract import budget

    results: dict = {}
    # R36: reserve from measured history where there is any, falling back to the worst case.
    queue = [(key, params, reservation_usd(params, model, batch=True, entries=spend.entries))
             for key, params in work]
    round_no = 0
    while queue:
        if spend.refuses_next_batch():
            log(f"  {phase} {model}: REFUSING the next batch — actuals have passed the cap "
                f"(${spend.spent:.4f} of ${spend.max_usd:.2f})")
            for key, _, _ in queue:
                results[key] = {"skipped": "cap breached by actuals"}
            break
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
            # ⛔ No token fields: the batch was never accepted, so nothing was measured. `requests`
            # is what was SENT, which is honest either way.
            spend.settle(reserved, 0.0, dict(ledger_extra or {},
                                             phase=phase, model=model, transport="batch",
                                             requests=len(requests), rounds=round_no,
                                             create_failed=type(exc).__name__))
            for key, _, _ in chunk:
                results[key] = {"error": f"{type(exc).__name__}: {str(exc)[:600]}", "transport_error": True,
                                "cost": 0.0}
            continue
        log(f"  {phase} {model}: batch {created.id} sent with {len(requests)} requests, ${reserved:.2f} reserved")
        actual, collected = 0.0, False
        tok_in, tok_out, tok_seen = 0, 0, 0
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
                    # R48: the only point in the round where per-result usage is visible before
                    # the settle in `finally`. `interpret` stores it per result too, but only for
                    # succeeded keys — accumulating here keeps the denominator honest.
                    usage = budget.usage_dict(res.message.usage)
                    tok_in += _input_tokens(usage)
                    tok_out += int(usage.get("output_tokens") or 0)
                    tok_seen += 1
                    results[key] = interpret(res.message, cost)
                else:
                    detail = getattr(getattr(getattr(res, "error", None), "error", None), "type", None)
                    results[key] = {"error": f"{res.type}:{detail}", "transport_error": True, "cost": 0.0}
            collected = True
        except Exception as exc:
            log(f"  {phase}: batch {created.id} was not collected ({type(exc).__name__}: {str(exc)[:300]}); "
                f"charged at its reservation")
        finally:
            note = {"phase": phase, "model": model, "transport": "batch", "batch_id": created.id,
                    "requests": len(requests), "collected": collected,
                    # ⚠️ `rounds` is the round ORDINAL, which at settle time equals the number of
                    # rounds this phase has sent. It is NOT the phase's final total — that value
                    # does not exist until the loop exits, by which point every entry is written.
                    "rounds": round_no}
            # ⛔ A timeout charges at the reservation and measured no tokens; token_fields refuses
            # to write a zero for it (tok_seen == 0), so the entry is silent rather than wrong.
            note.update(token_fields(tok_in, tok_out, observed=tok_seen, sent=len(requests)))
            spend.settle(reserved, actual if collected else reserved, dict(ledger_extra or {}, **note))
        for key, _, _ in chunk:
            results.setdefault(key, {"error": "missing_result", "transport_error": True, "cost": 0.0})
        log(f"  {phase} {model}: batch {created.id} collected={collected}, ${actual:.4f}")
    return results


def run_phase(client, items: list, *, model: str, effort: str, spend: SpendCap, phase: str, transport: str,
              concurrency: int, poll_s: float, timeout_s: float, keep_raw: bool = False,
              ledger_extra: Optional[dict] = None) -> list:
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
                                  timeout_s=timeout_s, ledger_extra=ledger_extra)
        else:
            got = {}
            if work:
                # alone: warms the cache
                got[work[0][0]] = stream_call(client, work[0][1], model, spend, phase, ledger_extra)
                with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
                    for key, res in zip([k for k, _ in work[1:]],
                                        pool.map(lambda w: stream_call(client, w[1], model, spend, phase,
                                                                       ledger_extra), work[1:])):
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
        res = validate_into(results[i] if results[i] is not None else {"skipped": "not sent"}, item, vocab,
                            keep_raw=keep_raw)
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
    #: R12 (owner ruling 2026-09-14). ON by default, because the failure it prevents is silent:
    #: a run that discards its inputs looks identical to one that kept them until the day you
    #: need to re-score it, and by then the only remedy is paying for the run again ($4.34 for
    #: the 57-segment gate phase). --no-persist-records exists so the cost can be measured, not
    #: so it can be skipped.
    ap.add_argument("--no-persist-records", dest="persist_records", action="store_false", default=True,
                    help="do NOT keep this run's validated records (R12); aggregates are unaffected either way")
    ap.add_argument("--gate-runs-dir", default=str(gate_records.LOCAL_ROOT),
                    help="where persisted runs go; must stay inside the gitignored data/wisdom tree (§0.4f). "
                         "Defaults to the REPO tree, not <DATA_DIR> — see gate_records.LOCAL_ROOT for why "
                         "the PC-side tool and the production chain resolve this differently (R56)")
    args = ap.parse_args()

    common.bootstrap(args.db)
    from api.services.wisdom.core import store
    from api.services.wisdom.extract import batch, config, golden, prompt

    out_dir = common.out_path(str(pathlib.Path(args.out_dir) / "x")).parent
    (out_dir / "receipts").mkdir(parents=True, exist_ok=True)
    #: ⛔ Minted ONCE, at the start, and used for the persisted directory. The report's own
    #: filename stamps at the END of the run, so it cannot serve as the run's identity — the two
    #: are joined by `gate_run_id`, which the report carries.
    gate_run_id = common.stamp()
    persist_records = bool(args.persist_records) and not args.dry_run
    #: out_path refuses anything inside the shared data root (C:\data), which is the guard that
    #: keeps a persisted run out of the owner's live files.
    gate_runs_root = common.out_path(str(pathlib.Path(args.gate_runs_dir) / "x")).parent
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
    report = {"gate_run_id": gate_run_id, "records_persisted": persist_records,
              "extractor_version": version, "model": model, "effort": effort, "transport": args.transport,
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
    # R48: what every ledger entry this run writes carries besides its own phase/transport facts.
    # ⛔ `golden_file` is the NAME only — §0.4f keeps golden CONTENT out of anything tracked, and
    # the ledger is tracked. `model` is set at the settle site, not here, so a note can never
    # disagree with the call it describes.
    ledger_extra = dict(extractor_version=version, run_id=gate_run_id, golden_file=data["golden_file"])
    phase_kw = dict(spend=spend, transport=args.transport, concurrency=args.concurrency, poll_s=args.poll_seconds,
                    timeout_s=args.batch_timeout_seconds, keep_raw=persist_records, ledger_extra=ledger_extra)
    persist_kw = dict(extractor_version=version, model=model, effort=effort, transport=args.transport)
    if persist_records:
        print(f"persisting validated records to {gate_records.run_dir(gate_runs_root, gate_run_id)}"
              f"  (R12: an E5-class scoring bug re-scores offline for $0.00)")

    def complete(summary, n):
        return summary["skipped_spend_cap"] == 0 and summary["transport_errors"] == 0 and summary["calls"] == n

    if "gate" in phases:
        results = run_phase(client, items, model=model, effort=effort, phase="gate", **phase_kw)
        if persist_records:
            got = gate_records.persist_phase(gate_runs_root, run_id=gate_run_id, phase="gate", items=items,
                                             results=results, manifest_extra={
                                                 "split": args.split, "golden_version": data["golden_version"],
                                                 "golden_sha256": data["golden_sha256"], "pilot": pilot},
                                             **persist_kw)
            print(f"  persisted {got['records']} records over {got['segments']} segments "
                  f"({got['raw_outputs']} raw outputs)")
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
            if persist_records:
                # the eval run_id only exists AFTER scoring, so it is folded in rather than
                # used as the directory name — otherwise a pilot or an INCOMPLETE phase, which
                # never records an eval, would have nowhere to persist to at all.
                gate_records.note_manifest(gate_runs_root, gate_run_id, eval_run_id=out["run_id"],
                                           gate_decision=out["gate"].get("decision"))
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
            if persist_records:
                got = gate_records.persist_phase(gate_runs_root, run_id=gate_run_id, phase="drift",
                                                 items=drift_items, results=results, **persist_kw)
                print(f"  persisted {got['records']} drift records over {got['segments']} segments")
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
            if persist_records:
                # ⚠️ the trial phase runs a DIFFERENT model, so its rows carry args.trial_model,
                # not `model` — persisting them under the gate's model would make the run
                # unreadable exactly where a model comparison is the question being asked.
                got = gate_records.persist_phase(gate_runs_root, run_id=gate_run_id, phase="trial",
                                                 items=trial_items, results=results,
                                                 extractor_version=version, model=args.trial_model,
                                                 effort=effort, transport=args.transport)
                print(f"  persisted {got['records']} trial records over {got['segments']} segments")
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
