"""D13 cost gate: 50 Sunday Scans chart images first — print cost and label quality, then decide.

DRY RUN BY DEFAULT (no spend, no network): collects every chart image from the
gitignored Sunday Scans HTML, labels each with the nearest EARLIER short line (R10),
picks a deterministic 50 spread across issues, and estimates vision tokens and cost
for the 50 and for the whole set at Batch rates, at full resolution and downsampled.

  --probe-sizes  fetch the 50 PUBLIC CDN images to read their real dimensions (network,
                 no spend). Without it, dimensions come from the HTML attributes when
                 present, else the stated default.
  --spend        run the 50 through the Messages API (needs ANTHROPIC_API_KEY and a
                 --max-usd cap), reading ticker, timeframe and drawn levels, and report
                 actual cost and label agreement (the model's ticker vs the label's) as k/n.
                 Production vision stays behind WISDOM_VISION_ENABLED.

    python tools/wisdom/extract_vision_trial.py --samples <wisdom data>/samples --out <wisdom data>/extract/vision-trial.json
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import pathlib
import random
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import extract_common as common  # noqa: E402

LONG_EDGE_FULL = 2576
LONG_EDGE_DOWNSAMPLED = 1568
TOKENS_PER_PIXEL = 1 / 750
DEFAULT_SIZE = (1456, 900)
PROMPT_TOKENS = 700
OUTPUT_TOKENS_ASSUMED = 900
VISION_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["legible", "ticker", "timeframe", "drawn_levels", "annotations"],
    "properties": {
        "legible": {"type": "boolean"},
        "ticker": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "timeframe": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "drawn_levels": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["price", "kind", "label"],
            "properties": {"price": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                           "kind": {"type": "string"},
                           "label": {"anyOf": [{"type": "string"}, {"type": "null"}]}}}},
        "annotations": {"type": "array", "items": {"type": "string"}},
    },
}
VISION_PROMPT = ("This is a stock chart from a trading newsletter. Read only what is drawn or printed on it: the "
                 "ticker and timeframe shown on the chart, every horizontal level or zone the author drew (price as "
                 "printed on the axis or label, else null), and short annotation texts. Never infer a price that is "
                 "not legible. Set legible false when the chart cannot be read.")


def image_tokens(width: int, height: int, long_edge: int) -> int:
    scale = min(1.0, long_edge / max(width, height))
    return int(math.ceil((width * scale) * (height * scale) * TOKENS_PER_PIXEL))


def collect(samples: pathlib.Path) -> list[dict]:
    from api.services.wisdom.extract import segmenter

    images = []
    for path in sorted((samples / "sunday_scans_html").glob("*.html")):
        for i, img in enumerate(segmenter.html_images(path.read_text(encoding="utf-8"))):
            images.append(dict(img, issue=path.stem, ordinal=i))
    return images


def _dims(img: dict) -> tuple[int, int]:
    try:
        w, h = int(img.get("width") or 0), int(img.get("height") or 0)
    except (TypeError, ValueError):
        w = h = 0
    if w and h:
        return w, h
    m = re.search(r"w_(\d+)", img.get("src") or "")
    if m:
        w = int(m.group(1))
        return w, int(w * DEFAULT_SIZE[1] / DEFAULT_SIZE[0])
    return DEFAULT_SIZE


def pick(images: list[dict], n: int) -> list[dict]:
    by_issue: dict = {}
    for img in images:
        by_issue.setdefault(img["issue"], []).append(img)
    rng = random.Random("wisdom-d13-v0")
    order = sorted(by_issue)
    chosen = []
    while len(chosen) < n and any(by_issue.values()):
        for issue in order:
            pool = by_issue[issue]
            if pool and len(chosen) < n:
                chosen.append(pool.pop(rng.randrange(len(pool))))
    return chosen


def _fetch(url: str) -> bytes:
    import httpx

    resp = httpx.get(url, timeout=30.0, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 wisdom-vision"})
    resp.raise_for_status()
    return resp.content


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--samples", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--model", default="claude-opus-5")
    ap.add_argument("--probe-sizes", action="store_true")
    ap.add_argument("--spend", action="store_true")
    ap.add_argument("--max-usd", type=float)
    args = ap.parse_args()
    if args.spend and not args.max_usd:
        raise SystemExit("--spend needs --max-usd")
    common.bootstrap(None)
    from api.services.wisdom.core import flags
    from api.services.wisdom.extract import budget

    out = common.out_path(args.out)
    images = collect(pathlib.Path(args.samples))
    chosen = pick(images, args.n)
    rows = []
    for img in chosen:
        width, height = _dims(img)
        if args.probe_sizes:
            try:
                from io import BytesIO

                from PIL import Image

                width, height = Image.open(BytesIO(_fetch(img["src"]))).size
            except Exception as exc:
                img["probe_error"] = type(exc).__name__
        rows.append({"issue": img["issue"], "label": img.get("label"), "src": img["src"], "width": width,
                     "height": height, "tokens_full": image_tokens(width, height, LONG_EDGE_FULL),
                     "tokens_downsampled": image_tokens(width, height, LONG_EDGE_DOWNSAMPLED)})
    report = {"images_in_samples": len(images), "sample_n": len(rows), "model": args.model,
              "vision_flag_on": flags.vision_enabled(), "dimensions": "probed" if args.probe_sizes else "html/url/default"}
    for variant in ("tokens_full", "tokens_downsampled"):
        mean_tokens = sum(r[variant] for r in rows) / len(rows) if rows else 0
        per_image = budget.estimate_cost(args.model, int(mean_tokens) + PROMPT_TOKENS, OUTPUT_TOKENS_ASSUMED, batch=True)
        report[variant] = {"mean_image_tokens": round(mean_tokens, 1), "batch_usd_per_image": round(per_image, 5),
                           "batch_usd_sample": round(per_image * len(rows), 3),
                           "batch_usd_all_images_in_samples": round(per_image * len(images), 2),
                           "batch_usd_2953_images": round(per_image * 2953, 2)}
    report["assumptions"] = {"prompt_tokens": PROMPT_TOKENS, "output_tokens": OUTPUT_TOKENS_ASSUMED,
                             "tokens_per_pixel": TOKENS_PER_PIXEL, "long_edge_full": LONG_EDGE_FULL,
                             "long_edge_downsampled": LONG_EDGE_DOWNSAMPLED}

    if args.spend:
        from api.services.wisdom.extract import batch

        client = batch.make_client()
        spent, agree, readable, results = 0.0, 0, 0, []
        for row in rows:
            worst = budget.estimate_cost(args.model, row["tokens_full"] + PROMPT_TOKENS, 4000, batch=False)
            if spent + worst > args.max_usd:
                results.append({"src": row["src"], "skipped": "spend cap"})
                continue
            try:
                data = _fetch(row["src"])
                media = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg"
                msg = client.messages.create(
                    model=args.model, max_tokens=4000,
                    output_config={"format": {"type": "json_schema", "schema": VISION_SCHEMA}, "effort": "medium"},
                    messages=[{"role": "user", "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": media,
                                                     "data": base64.standard_b64encode(data).decode("ascii")}},
                        {"type": "text", "text": VISION_PROMPT}]}])
                cost = budget.cost_from_usage(args.model, msg.usage, batch=False)
                spent += cost
                reading = json.loads(next(b.text for b in msg.content if b.type == "text"))
                label_ticker = (re.match(r"^\$?([A-Z][A-Z0-9.\-]{0,9})", row.get("label") or "") or [None, None])[1]
                ok = bool(label_ticker and reading.get("ticker") and reading["ticker"].upper().lstrip("$") == label_ticker)
                agree += int(ok)
                readable += int(bool(reading.get("legible")))
                results.append({"src": row["src"], "cost_usd": round(cost, 5), "label_ticker": label_ticker,
                                "read_ticker": reading.get("ticker"), "agrees": ok,
                                "levels_read": len(reading.get("drawn_levels") or []),
                                "usage": budget.usage_dict(msg.usage)})
            except Exception as exc:
                results.append({"src": row["src"], "error": type(exc).__name__})
        attempted = len([r for r in results if "cost_usd" in r])
        report["spend"] = {"spent_usd": round(spent, 4), "attempted": attempted,
                           "label_agreement": f"{agree}/{attempted}", "legible": f"{readable}/{attempted}",
                           "results": results,
                           "usd_per_image_live": round(spent / attempted, 5) if attempted else None,
                           "batch_usd_2953_images_from_live": round(spent / attempted * 0.5 * 2953, 2) if attempted else None}
    report["sample"] = rows
    common.write_json(out, report)
    print(json.dumps({k: v for k, v in report.items() if k not in ("sample",)}, indent=1, default=str)[:6000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
