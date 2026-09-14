"""Segment the full back catalog and estimate what extracting it through Batch costs.

DRY RUN BY DEFAULT: reads the gitignored samples (the 319 transcripts and the 64
Sunday Scans issues), segments them exactly as production does, and prints request
count, tokens and the Batch cost — conservative (no cache hits, p90 output) and
expected (system prompt as cache reads, p50 output) — against the budget cap.

Token figures come from the golden gate's calibration when one is given
(--calibration <out-dir>/calibration-<model>-<effort>.json: measured system tokens,
chars per body token and output tokens); otherwise stated defaults are used and the
report says so.

--submit exists for the integrator and is NOT to be run before the golden gate has
accepted the extractor version and the stream has merged. It writes sources and
segments into --db and submits through the same batch.submit_pending path the daily
job uses, so the budget and the gate still apply. It refuses without --db and
--i-understand-this-spends.

    python tools/wisdom/extract_catalog_batch.py --samples <wisdom data>/samples --out <wisdom data>/extract/catalog-estimate.json
"""
from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import extract_common as common  # noqa: E402

DEFAULT_CHARS_PER_TOKEN = 3.6
DEFAULT_SYSTEM_TOKENS = 4200
DEFAULT_OUTPUT_P50 = 3000
DEFAULT_OUTPUT_P90 = 6000
CATEGORY_STREAM = {"Live Trading Sessions": "zoom_live", "LIVE TRAIDNG": "zoom_live",
                   "Workshops & Fireside Chats": "workshop", "Interviews": "interview"}


def catalog(samples: pathlib.Path):
    from api.services.desk_session_insights import _parse_timestamped_block
    from api.services.wisdom.core import ids
    from api.services.wisdom.extract import segmenter

    sources = []
    for path in sorted((samples / "transcripts").glob("*.json"), key=lambda p: (len(p.stem), p.stem)):
        if path.name.startswith("_"):
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        cues = _parse_timestamped_block(data.get("transcript") or "")
        segs = segmenter.segment_transcript(cues, data.get("chapters") or [])
        stream = CATEGORY_STREAM.get(data.get("category"), "education")
        ref = f"edu_videos:{data.get('id')}"
        sources.append({"kind": "transcript", "stream": stream, "external_ref": ref, "title": data.get("title"),
                        "category": data.get("category"), "segments": segs,
                        "source_id": ids.sha24(stream, ref), "raw_sha256": ids.sha256_text(data.get("transcript") or "")})
    for path in sorted((samples / "sunday_scans_html").glob("*.html")):
        html = path.read_text(encoding="utf-8")
        segs = segmenter.segment_sunday_scans(segmenter.html_to_text(html))
        ref = f"substack:/p/{path.stem}"
        sources.append({"kind": "sunday_scans", "stream": "sunday_scans", "external_ref": ref, "title": path.stem,
                        "category": "Sunday Scans", "segments": segs, "source_id": ids.sha24("sunday_scans", ref),
                        "raw_sha256": ids.sha256_text(html)})
    return sources


def estimate(sources, *, model: str, calibration: dict) -> dict:
    from api.services.wisdom.extract import budget, prompt

    cpt = calibration.get("chars_per_body_token") or DEFAULT_CHARS_PER_TOKEN
    system_tokens = calibration.get("system_tokens") or DEFAULT_SYSTEM_TOKENS
    p50 = calibration.get("output_tokens_p50") or DEFAULT_OUTPUT_P50
    p90 = calibration.get("output_tokens_p90") or DEFAULT_OUTPUT_P90
    by_kind: dict = {}
    body_tokens_all = []
    for src in sources:
        slot = by_kind.setdefault(src["category"] or src["kind"], {"sources": 0, "segments": 0, "chars": 0,
                                                                   "body_tokens": 0})
        slot["sources"] += 1
        for seg in src["segments"]:
            row = seg.to_row(src["source_id"], 1)
            rendered = prompt.user_message(row, {"stream": src["stream"], "title": src["title"]})
            tokens = int(len(rendered) / cpt) + 1
            body_tokens_all.append(tokens)
            slot["segments"] += 1
            slot["chars"] += len(seg.text)
            slot["body_tokens"] += tokens
    n = len(body_tokens_all)
    body = sum(body_tokens_all)
    conservative = budget.estimate_cost(model, n * system_tokens + body, n * p90, batch=True)
    expected = budget.estimate_cost(model, n * system_tokens + body, n * p50, batch=True,
                                    cached_input_tokens=max(0, n - 1) * system_tokens)
    return {"model": model, "requests": n, "input_tokens": n * system_tokens + body, "system_tokens_each": system_tokens,
            "body_tokens": body, "body_tokens_median": statistics.median(body_tokens_all) if n else None,
            "output_tokens_conservative": n * p90, "output_tokens_expected": n * p50,
            "cost_usd_conservative": round(conservative, 2), "cost_usd_expected": round(expected, 2),
            "budget_cap_usd": budget.budget_cap_usd(), "by_category": by_kind,
            "token_source": "calibration" if calibration else "defaults (no calibration given)",
            "assumptions": {"chars_per_body_token": cpt, "output_p50": p50, "output_p90": p90,
                            "batch_discount": budget.BATCH_DISCOUNT}}


def submit(sources, args) -> int:
    from api.services.wisdom.core import store, timeutil
    from api.services.wisdom.extract import batch, segmenter

    store.init_db()
    now = timeutil.iso_et(timeutil.now_et())
    with store.write() as conn:
        for src in sources:
            conn.execute("INSERT OR IGNORE INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
                         "title, ingest_version, ingested_at) VALUES (?, ?, ?, 1, ?, ?, 'catalog-tool', ?)",
                         (src["source_id"], src["stream"], src["external_ref"], src["raw_sha256"], src["title"], now))
            segmenter.write_segments(conn, src["source_id"], 1, src["segments"])
    ctx = common.job_context(dry_run=False)
    out = batch.submit_pending(ctx, limit=args.submit_limit)
    print(json.dumps({k: v for k, v in out.items() if k != "build"}, indent=1, default=str))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--samples", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--calibration")
    ap.add_argument("--model")
    ap.add_argument("--db")
    ap.add_argument("--submit", action="store_true")
    ap.add_argument("--submit-limit", type=int, default=2000)
    ap.add_argument("--i-understand-this-spends", action="store_true")
    args = ap.parse_args()
    if args.submit and not (args.db and args.i_understand_this_spends):
        raise SystemExit("--submit needs --db and --i-understand-this-spends")
    common.bootstrap(args.db)
    from api.services.wisdom.extract import config, prompt, segmenter

    out = common.out_path(args.out)
    calibration = json.loads(pathlib.Path(args.calibration).read_text(encoding="utf-8")) if args.calibration else {}
    model = args.model or calibration.get("model") or config.configured_model()
    sources = catalog(pathlib.Path(args.samples))
    report = estimate(sources, model=model, calibration=calibration)
    report.update(extractor_version=prompt.extractor_version(), segmenter=segmenter.SEGMENTER_VERSION,
                  windows={"ticker_pad_s": segmenter.TICKER_PAD_S, "fallback_window_s": segmenter.FALLBACK_WINDOW_S,
                           "fallback_overlap_s": segmenter.FALLBACK_OVERLAP_S,
                           "max_segment_chars": segmenter.MAX_SEGMENT_CHARS,
                           "section_pack_chars": segmenter.SECTION_PACK_CHARS},
                  sources=len(sources), measured_at=common.stamp())
    common.write_json(out, report)
    print(json.dumps({k: v for k, v in report.items() if k != "by_category"}, indent=1, default=str))
    for category, slot in sorted(report["by_category"].items()):
        print(f"  {category:<32} sources {slot['sources']:>4}  segments {slot['segments']:>6}  "
              f"chars {slot['chars']:>10}  body tokens {slot['body_tokens']:>9}")
    over = report["cost_usd_conservative"] > report["budget_cap_usd"]
    print(f"conservative ${report['cost_usd_conservative']:.2f} / expected ${report['cost_usd_expected']:.2f} "
          f"vs cap ${report['budget_cap_usd']:.2f}{'  (conservative estimate exceeds the cap)' if over else ''}")
    if args.submit:
        return submit(sources, args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
