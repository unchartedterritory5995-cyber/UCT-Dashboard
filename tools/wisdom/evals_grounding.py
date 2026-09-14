"""The 6.4 grounding eval (grounding-v1) against an explicit wisdom.db.

Same function the weekly chain calls: api.services.wisdom.evals.grounding.run_grounding.

    python tools/wisdom/evals_grounding.py --db <wisdom.db> --set <askai-wisdom-v1.json>
        [--load-samples <gitignored samples dir>]   # fixture corpus: sources + segments into --db
        [--with-wisdom] [--generate-answers --max-usd 5] [--dry-run]

--generate-answers spends Anthropic credit (one Messages call per question, stopped at --max-usd,
never above $5). Run it under `railway run --service web` from the linked directory so the key is
never read from a file; usage is printed at the end.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from tools.wisdom import evals_common  # noqa: E402

HARD_USD_CEILING = 5.0


def load_samples(samples_dir: str) -> dict:
    """Load the gitignored sample corpus as FIXTURE sources + segments (local file only)."""
    import hashlib
    import re

    from api.services.wisdom.core import ids, store

    counts = {"sources": 0, "segments": 0}
    now = "fixture"

    def add_source(conn, stream, external_ref, raw):
        sid = ids.sha24(stream, external_ref)
        conn.execute("INSERT OR IGNORE INTO wisdom_sources (source_id, stream, external_ref, raw_sha256, "
                     "ingest_version, ingested_at) VALUES (?, ?, ?, ?, 'fixture-samples', ?)",
                     (sid, stream, external_ref, hashlib.sha256(raw.encode("utf-8")).hexdigest(), now))
        counts["sources"] += 1
        return sid

    def add_segments(conn, sid, kind, texts):
        for ordinal, text in enumerate(t for t in texts if t.strip()):
            conn.execute("INSERT OR IGNORE INTO wisdom_segments (segment_id, source_id, source_version, ordinal, "
                         "kind, text, text_sha256, normalizer_version) VALUES (?, ?, 1, ?, ?, ?, ?, 'fixture')",
                         (ids.sha24(sid, 1, ordinal), sid, ordinal, kind, text,
                          hashlib.sha256(text.encode("utf-8")).hexdigest()))
            counts["segments"] += 1

    def windows(lines, size=8):
        return [" ".join(lines[i:i + size]) for i in range(0, len(lines), size)]

    stamp = re.compile(r"^\[\d+:\d{2}(?::\d{2})?\]\s*")
    with store.write() as conn:
        for name in sorted(os.listdir(samples_dir)):
            path = os.path.join(samples_dir, name)
            if name.startswith("sunday_scans_") and name.endswith(".txt"):
                raw = open(path, encoding="utf-8", errors="replace").read()
                sid = add_source(conn, "sunday_scans", f"sample:{name}", raw)
                add_segments(conn, sid, "section", [p for p in raw.split("\n") if len(p.split()) >= 6])
        tdir = os.path.join(samples_dir, "transcripts")
        for name in sorted(os.listdir(tdir)) if os.path.isdir(tdir) else []:
            if not name[0].isdigit():
                continue
            data = json.load(open(os.path.join(tdir, name), encoding="utf-8", errors="replace"))
            raw = data.get("transcript") or ""
            sid = add_source(conn, "education", f"edu_videos:{data.get('id')}", raw)
            lines = [stamp.sub("", ln).strip() for ln in raw.splitlines()]
            add_segments(conn, sid, "cue_window", windows([ln for ln in lines if ln], 10))
        ddir = os.path.join(samples_dir, "discord")
        for name in sorted(os.listdir(ddir)) if os.path.isdir(ddir) else []:
            if not name.endswith(".jsonl"):
                continue
            rows = [json.loads(line) for line in open(os.path.join(ddir, name), encoding="utf-8") if line.strip()]
            sid = add_source(conn, "discord", f"sample:discord:{name}", json.dumps([r.get("message_id") for r in rows]))
            add_segments(conn, sid, "message", [str(r.get("content") or "") for r in rows])
    return counts


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", required=True)
    ap.add_argument("--set", dest="set_path")
    ap.add_argument("--load-samples")
    ap.add_argument("--with-wisdom", action="store_true")
    ap.add_argument("--generate-answers", action="store_true")
    ap.add_argument("--max-usd", type=float, default=HARD_USD_CEILING)
    ap.add_argument("--model", default="claude-opus-5")
    ap.add_argument("--now")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    if args.max_usd > HARD_USD_CEILING:
        raise SystemExit(f"--max-usd {args.max_usd} is above the ${HARD_USD_CEILING} ceiling for this stream")
    evals_common.bootstrap(args.db)

    from api.services.wisdom.core import store
    from api.services.wisdom.evals import grounding

    store.init_db()
    if args.load_samples:
        print("fixture corpus:", load_samples(evals_common.require_file(args.load_samples, "--load-samples")))
    ctx = evals_common.job_context("tools_evals_grounding", dry_run=args.dry_run, now_iso=args.now)
    answerer = grounding.AnthropicAnswerer(model=args.model, max_usd=args.max_usd) if args.generate_answers else None
    out = grounding.run_grounding(ctx, with_wisdom=args.with_wisdom, set_path=args.set_path, answerer=answerer,
                                  generate_answers=args.generate_answers)
    per_question = out.pop("per_question", None)
    print(json.dumps(out, indent=2, default=str))
    if per_question:
        uncovered = [q["qid"] for q in per_question if not q["covered"]]
        print(f"uncovered questions ({len(uncovered)}): {', '.join(uncovered) or '-'}")
    if answerer is not None:
        print("usage:", json.dumps(answerer.usage()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
