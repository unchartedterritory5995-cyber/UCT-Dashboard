"""Generate EVIDENCE_INDEX.md from research-file frontmatter (Document C Part CCLVI).

Usage (from anywhere):
    python docs/terminal-research/00-program-control/scripts/build_evidence_index.py

Walks docs/terminal-research/, reads YAML-ish frontmatter (simple key: value
lines between the first two '---' lines), and writes a table to
00-program-control/EVIDENCE_INDEX.md. Files without frontmatter are listed
separately so gaps are visible. No third-party dependencies.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))  # docs/terminal-research
OUT = os.path.join(ROOT, "00-program-control", "EVIDENCE_INDEX.md")
SKIP_DIRS = {"charter", "contracts", "scripts"}
FIELDS = ["id", "title", "group", "category", "scope", "confidence",
          "evidence_ceiling", "uct_relevance", "status", "date"]


def read_frontmatter(path: str) -> dict | None:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            first = fh.readline()
            if first.strip() != "---":
                return None
            data: dict[str, str] = {}
            for line in fh:
                if line.strip() == "---":
                    return data
                if ":" in line:
                    key, _, value = line.partition(":")
                    data[key.strip()] = value.strip()
            return None
    except (OSError, UnicodeDecodeError):
        return None


def main() -> int:
    rows: list[tuple[str, dict]] = []
    missing: list[str] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in sorted(filenames):
            if not name.endswith(".md"):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
            if rel.startswith("00-program-control/"):
                continue  # control files are not evidence
            fm = read_frontmatter(path)
            if fm is None:
                missing.append(rel)
            else:
                rows.append((rel, fm))

    rows.sort(key=lambda r: (r[1].get("group", ""), r[1].get("id", ""), r[0]))
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# EVIDENCE INDEX (generated; do not edit by hand)",
        "",
        f"Generated {stamp} by `scripts/build_evidence_index.py` from research-file frontmatter. "
        f"{len(rows)} indexed file(s); {len(missing)} markdown file(s) without frontmatter.",
        "",
        "| Path | " + " | ".join(FIELDS) + " |",
        "|---|" + "---|" * len(FIELDS),
    ]
    for rel, fm in rows:
        cells = [fm.get(f, "").replace("|", "\\|") for f in FIELDS]
        lines.append(f"| `{rel}` | " + " | ".join(cells) + " |")
    if missing:
        lines += ["", "## Markdown files without frontmatter", ""]
        lines += [f"* `{m}`" for m in missing]
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"wrote {OUT}: {len(rows)} indexed, {len(missing)} missing frontmatter")
    return 0


if __name__ == "__main__":
    sys.exit(main())
