"""One-shot fixer for the `status: UNSIGNED` frontmatter contradiction
`tools/check_gate_status_frontmatter.py` detects.

⛔ SCOPED TO THE UNIFORM SHAPE ONLY. This rewrites `status: UNSIGNED` (and
nothing else on the line) to a status reflecting the file's own real
fingerprint(s) — it refuses any file whose frontmatter line is not EXACTLY
that bare form, so a packet-level file with prose already describing a
partial state (e.g. "CP1 SIGNED... CP2+ needs a line") is never touched by
this script. Those need per-file human judgment, not a mechanical rewrite.

⛔ ASSERTS ONLY WHAT IS PROVABLE FROM THE FILE ITSELF. The new status names
the checkpoint (from `unit:` if present) and the fingerprint(s) actually
found in the body — never "BUILT" or "MERGED", which would require checking
git log and is a claim this script cannot verify from the document alone.

Usage:
    python tools/fix_gate_status_frontmatter.py            # dry run, prints the diff
    python tools/fix_gate_status_frontmatter.py --apply    # writes the files
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import check_gate_status_frontmatter as _checker

_ROOT = _checker._ROOT

#: The ONLY frontmatter status form this script will touch. A bare line, no
#: trailing prose — the multi-block packet files all carry something else.
_BARE_UNSIGNED_LINE_RE = re.compile(r"^status:\s*UNSIGNED\s*$", re.M)

_UNIT_RE = re.compile(r"^unit:\s*(.+)$", re.M)


def plan() -> list[dict]:
    out = []
    for c in _checker.find_contradictions():
        path = _ROOT / c["file"]
        text = path.read_text(encoding="utf-8")
        fm_match = _checker._FRONTMATTER_RE.match(text)
        frontmatter = fm_match.group(1)
        if not _BARE_UNSIGNED_LINE_RE.search(frontmatter):
            continue  # not the uniform shape — leave for manual review
        if len(c["fingerprints"]) != 1:
            continue  # more than one signed block — leave for manual review
        unit_m = _UNIT_RE.search(frontmatter)
        unit = unit_m.group(1).strip() if unit_m else None
        fp = c["fingerprints"][0]
        new_line = ("status: SIGNED (%s, fingerprint %s)" % (unit, fp)) if unit \
            else ("status: SIGNED (fingerprint %s)" % fp)
        new_frontmatter = _BARE_UNSIGNED_LINE_RE.sub(new_line, frontmatter)
        new_text = text[:fm_match.start(1)] + new_frontmatter + text[fm_match.end(1):]
        out.append({"file": c["file"], "path": path, "old_line": "status: UNSIGNED",
                    "new_line": new_line, "new_text": new_text})
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="write the files (default: dry run)")
    args = ap.parse_args(argv)

    items = plan()
    print("[fix-gate-status] %d file(s) match the uniform shape and will be rewritten:"
          % len(items))
    for it in items:
        print("    %s" % it["file"])
        print("        - %s" % it["old_line"])
        print("        + %s" % it["new_line"])

    all_contradictions = len(_checker.find_contradictions())
    skipped = all_contradictions - len(items)
    if skipped:
        print("[fix-gate-status] %d file(s) left for MANUAL review (non-uniform "
              "frontmatter or multiple approval blocks)" % skipped)

    if not args.apply:
        print("[fix-gate-status] DRY RUN — pass --apply to write these %d file(s)" % len(items))
        return 0

    for it in items:
        it["path"].write_text(it["new_text"], encoding="utf-8")
    print("[fix-gate-status] wrote %d file(s)" % len(items))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
