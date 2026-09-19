"""A gate/build-record's YAML frontmatter `status:` field must not claim
UNSIGNED while the body carries a real, filled approval.

⚰️ THE INCIDENT THIS CLOSES. `tools/sign_gate.py` writes the fingerprint into
the body's `APPROVED AT SHA:` field and NOTHING else — it has never touched
YAML frontmatter, and no other tool did either. Measured 2026-09-19: several
build-record files (`d5-cp7-build-record.md` among them) carry
`status: UNSIGNED` in frontmatter, dated the SAME DAY as a real,
fully-filled approval block sitting a few lines below it —
`APPROVED AT SHA: d8c232db0`, a real hex fingerprint, not a placeholder. The
frontmatter is not a second signing surface; it is prose nobody is required
to update, and prose that is never re-checked goes stale exactly like every
other "second authority over one value" this repo's memory names.

⛔ THIS IS A READ-ONLY DETECTOR, NOT A FIXER. It reports the contradiction; a
human (or a session under explicit delegation) corrects each frontmatter line
by hand, because the RIGHT status text depends on what actually shipped —
which checkpoint, which SHA, whether more remain — and that is exactly the
kind of thing a mechanical rewrite would get wrong as often as right.

⛔ A REAL FINGERPRINT, NOT JUST A FILLED LINE. `APPROVED AT SHA:` is the field
`sign()` computes and writes; a body that has one is a body that went through
the tool. BY/ON/SCOPE can in principle be typed by hand without signing, so
the fingerprint is the one field that cannot be faked by accident — this
detector keys on it alone, matching `sign_gate.py`'s own `_AT_LINE` regex
family for consistency with the tool that writes it.

Usage:
    python tools/check_gate_status_frontmatter.py            # print every contradiction
    python tools/check_gate_status_frontmatter.py --check    # exit 1 if any exist
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

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_SCAN_ROOTS = (
    _ROOT / "docs" / "terminal-research" / "12-decisions",
    _ROOT / "docs" / "terminal-research" / "00-program-control",
)

#: Mirrors sign_gate.py's own `_H`/`_FILLED` shape: a real signed fingerprint,
#: hex, on its own AT SHA line.
_REAL_FINGERPRINT_RE = re.compile(
    r"^APPROVED AT SHA:[ \t]*([0-9a-f]{6,})[ \t]*$", re.M)

#: The frontmatter block: everything between the first two `---` lines.
_FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.S)

#: A `status:` field claiming the WHOLE packet is unsigned. Deliberately
#: narrow — a status line that says "CP1 SIGNED, CP2+ still needs a line" is
#: an ACCURATE partial state, not a contradiction, and must not fire here.
#: This only matches when "unsigned" (or an equivalent blanket phrase) is the
#: field's own leading claim, not a word appearing somewhere in a longer,
#: differentiated status.
#:
#: ⚰️ WIDENED 2026-09-19: the first version matched only UNSIGNED/NOT APPROVED/
#: NOT SIGNED and missed two real instances carrying the identical defect under
#: different wording — `packet-a-absent-bound-gate.md` ("CLOSED-AS-FINDING...
#: there is no approval block") and `d4-caching-and-serving-pre-implementation-
#: gate.md` ("UNAPPROVED — the approval block is empty"), both found only by a
#: human re-reading files this regex had already scanned and passed over.
_BLANKET_UNSIGNED_RE = re.compile(
    r"^status:\s*[⛔\s]*\**\s*"
    r"(UNSIGNED\b|UNAPPROVED\b|NOT\s+APPROVED\b|NOT\s+SIGNED\b|"
    r"CLOSED-AS-FINDING\b|PRESENTED\b.{0,40}NOT\s+approved\b)",
    re.M | re.I)


def _status_line(frontmatter: str) -> str | None:
    m = re.search(r"^status:.*$", frontmatter, re.M)
    return m.group(0) if m else None


def find_contradictions() -> list[dict]:
    out = []
    for root in _SCAN_ROOTS:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.md")):
            text = path.read_text(encoding="utf-8")
            fm_match = _FRONTMATTER_RE.match(text)
            if not fm_match:
                continue
            frontmatter = fm_match.group(1)
            if not _BLANKET_UNSIGNED_RE.search(frontmatter):
                continue
            body = text[fm_match.end():]
            fps = _REAL_FINGERPRINT_RE.findall(body)
            if not fps:
                continue
            rel = str(path.relative_to(_ROOT)).replace("\\", "/")
            out.append({
                "file": rel,
                "status_line": _status_line(frontmatter),
                "fingerprints": fps,
            })
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if any contradiction is found")
    args = ap.parse_args(argv)

    contradictions = find_contradictions()
    if not contradictions:
        print("[gate-status] OK — no frontmatter claims UNSIGNED over a real fingerprint")
        return 0

    print("[gate-status] %d file(s) claim UNSIGNED in frontmatter while the body "
          "carries a real, filled approval:" % len(contradictions))
    for c in contradictions:
        print("    %s" % c["file"])
        print("        frontmatter: %s" % c["status_line"])
        print("        real fingerprint(s): %s" % ", ".join(c["fingerprints"]))
    if args.check:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
