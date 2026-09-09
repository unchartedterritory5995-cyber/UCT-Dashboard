"""
verify_clipboard.py — the shell-side half of a TradingView reference capture.

Reads the clipboard, checks it against the receipt the page reported, and writes
the fixture **only if both the length and the hash match**.

⭐⭐ THE CHECK IS THE POINT, NOT A FORMALITY. The OS clipboard is one machine-wide
resource and this box routinely runs more than one agent session. The prior
capture programme hit exactly this: a concurrent session overwrote the clipboard
mid-copy and the paste landed as a silent no-op. A capture written from a stomped
clipboard is wrong in a way nothing downstream can detect — every number after it
is confidently about the wrong thing. So a mismatch writes NOTHING and says so.

Usage
-----
    python tools/visual_conformance/verify_clipboard.py \
        --set A --name volume-spy-1d-250 --chars 18622 --fnv1a 1313922158

    # metadata rather than CSV
    python tools/visual_conformance/verify_clipboard.py \
        --set A --name volume-spy-1d-250.meta --json --chars 1304 --fnv1a 476708305
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_ROOT = os.path.join(REPO, "tests", "fixtures", "vendor", "reference")

SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$")


def fnv1a(s: str) -> int:
    """FNV-1a over UTF-16 code units — identical to `__uctHash` in capture_page.js.

    ⚠️ Python iterates str by CODE POINT, JavaScript by UTF-16 CODE UNIT. They
    agree for everything in the BMP, which every capture payload is (digits,
    commas, ASCII field names). A payload carrying an astral character would
    diverge; the length check would catch it first.
    """
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def read_clipboard() -> str:
    """Windows clipboard via PowerShell.

    ⚠️ `-Raw` matters: without it PowerShell returns an array of lines and rejoins
    them with the host's newline, which changes the length AND the hash.
    """
    out = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
        capture_output=True,
    )
    if out.returncode != 0:
        raise SystemExit(f"Get-Clipboard failed: {out.stderr.decode('utf-8', 'replace')[:400]}")
    return out.stdout.decode("utf-8", "replace")


def main() -> int:
    # NOTE: deliberately NOT `description=__doc__`. This console is cp1252 and the
    # module docstring carries non-ASCII; argparse would crash printing --help.
    ap = argparse.ArgumentParser(
        description="Verify the clipboard against the page-reported receipt, then write the fixture."
    )
    ap.add_argument("--set", dest="set_id", required=True, help="reference set: A, B, C, D")
    ap.add_argument("--name", required=True, help="fixture basename, no extension")
    ap.add_argument("--chars", type=int, required=True, help="length the page reported")
    ap.add_argument("--fnv1a", type=int, required=True, help="hash the page reported")
    ap.add_argument("--json", action="store_true", help="payload is JSON: validate and re-indent")
    args = ap.parse_args()

    if not SLUG.match(args.set_id) or not SLUG.match(args.name):
        raise SystemExit("set and name must be plain slugs")

    raw = read_clipboard()
    # ⚠️ The browser hashed LF; Windows hands back CRLF. Normalise BEFORE hashing.
    # A 250-row capture differs by exactly 250 characters, which is its own check.
    text = raw.replace("\r\n", "\n").rstrip("\n")

    got_chars, got_hash = len(text), fnv1a(text)
    print(f"clipboard: raw={len(raw)}  normalised={got_chars}  fnv1a={got_hash}")
    print(f"expected : chars={args.chars}  fnv1a={args.fnv1a}")

    if got_chars != args.chars or got_hash != args.fnv1a:
        print(
            "MISMATCH - the clipboard was stomped, truncated, or never received the copy.\n"
            "Nothing was written. Re-stage in the page and copy again; if it keeps failing,\n"
            "another session on this machine is using the clipboard."
        )
        return 1

    out_dir = os.path.join(OUT_ROOT, args.set_id)
    os.makedirs(out_dir, exist_ok=True)
    ext = "json" if args.json else "csv"
    path = os.path.join(out_dir, f"{args.name}.{ext}")

    if args.json:
        try:
            payload = json.loads(text)
        except Exception as exc:  # noqa: BLE001
            print(f"MATCHED the hash but is not valid JSON: {exc}. Nothing written.")
            return 1
        body = json.dumps(payload, indent=1) + "\n"
    else:
        body = text + "\n"

    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)

    lines = text.split("\n")
    print(f"MATCH -> wrote {os.path.relpath(path, REPO)}  ({len(lines)} lines)")
    if not args.json:
        print(f"  header: {lines[0]}")
        print(f"  first : {lines[1] if len(lines) > 1 else '(none)'}")
        print(f"  last  : {lines[-1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
