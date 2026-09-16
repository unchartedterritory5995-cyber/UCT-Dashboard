"""Diff the PUBLIC Sunday Scans post against local copies (W1 §2.3). Numbers only.

For each data/wisdom/samples/sunday_scans_<date>.txt (its header carries the post URL):
  * fetch the public post through substack_bodies.fetch_body (unauthenticated
    /api/v1/posts/{slug}; never the account, never the publisher);
  * report the audience it is served with;
  * similarity(public text, sample .txt)                    — the scraped sample
  * similarity(public text, sunday_scans_html/<slug>.html)  — the stored desk.db body
    when that copy is present (this second number is exactly the published_check test).

  python tools/wisdom/sources_sunday_scans_sample_diff.py \\
      --samples-dir C:/Users/Patrick/uct-worktrees/wisdom-loop/data/wisdom/samples
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

from sources_bootstrap import bootstrap


def sample_parts(path: str) -> tuple[str | None, str]:
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    url, body_start = None, 0
    for i, line in enumerate(lines[:12]):
        if line.startswith("Source: "):
            url = line[len("Source: "):].strip()
        if line.startswith("Description:"):
            body_start = i + 1
    return url, "\n".join(lines[body_start:])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples-dir", required=True)
    args = ap.parse_args(argv)
    bootstrap()
    from api.services import substack_bodies
    from api.services.wisdom.sources import sunday_scans as ss

    def norm_lines(text: str) -> str:
        return "\n".join(n for n in (ss.normalize_text(x) for x in text.split("\n")) if n)

    out = []
    for path in sorted(glob.glob(os.path.join(args.samples_dir, "sunday_scans_*.txt"))):
        url, sample_body = sample_parts(path)
        row = {"sample": os.path.basename(path), "url": url}
        fetched = substack_bodies.fetch_body(url) if url else None
        if not fetched:
            row["result"] = "unfetched"
            out.append(row)
            continue
        public = norm_lines(ss.html_to_text(fetched["raw"]))
        sample = norm_lines(sample_body)
        row.update({"audience": fetched.get("audience"), "public_lines": public.count("\n") + 1,
                    "sample_lines": sample.count("\n") + 1,
                    "similarity_vs_sample_txt": ss.similarity(sample, public)})
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        stored_path = os.path.join(args.samples_dir, "sunday_scans_html", f"{slug}.html")
        if os.path.exists(stored_path):
            with open(stored_path, encoding="utf-8") as fh:
                stored = norm_lines(ss.html_to_text(fh.read()))
            row["similarity_vs_stored_body"] = ss.similarity(stored, public)
            row["would_be_published_check"] = (
                "public_api_match" if fetched.get("audience") == "everyone"
                and row["similarity_vs_stored_body"] >= ss.SIMILARITY_THRESHOLD else "mismatch")
        out.append(row)
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
