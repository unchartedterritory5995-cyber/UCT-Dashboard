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
import base64
import json
import os
import re
import subprocess
import sys
import tempfile

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
    """Windows clipboard via PowerShell, routed through a UTF-8 FILE.

    ⚠️ `-Raw` matters: without it PowerShell returns an array of lines and rejoins
    them with the host's newline, which changes the length AND the hash.

    ⛔⛔ AND THE CLIPBOARD MUST NOT COME BACK OVER STDOUT. PowerShell encodes its
    console output as cp1252 on this box, so any character outside that set — an
    em dash in a note field is enough — arrives as a replacement character. The
    payload is then the SAME LENGTH with DIFFERENT CONTENT, which is precisely the
    corruption a length check cannot see. This was caught by the hash, on a real
    capture, after the length matched.

    So PowerShell writes the clipboard to a temp file with an explicit UTF-8
    encoder and no BOM, and we read the file.
    """
    fd, tmp = tempfile.mkstemp(suffix=".clip.txt")
    os.close(fd)
    try:
        ps = (
            "$t = Get-Clipboard -Raw; "
            "if ($null -eq $t) { exit 2 }; "
            f"[System.IO.File]::WriteAllText('{tmp}', $t, (New-Object System.Text.UTF8Encoding $false))"
        )
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True,
        )
        if out.returncode == 2:
            raise SystemExit("the clipboard is empty")
        if out.returncode != 0:
            raise SystemExit(f"Get-Clipboard failed: {out.stderr.decode('utf-8', 'replace')[:400]}")
        with open(tmp, encoding="utf-8", newline="") as fh:
            return fh.read()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


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
    ap.add_argument("--png", action="store_true", help="payload is a data:image/png;base64 URL: decode to .png")
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
    ext = "png" if args.png else ("json" if args.json else "csv")
    path = os.path.join(out_dir, f"{args.name}.{ext}")

    if args.png:
        # ⭐ WHY A SCREENSHOT COMES THROUGH HERE AT ALL. The chart tab is often
        # `visibilityState: "hidden"` (a background or minimised window), and a
        # hidden tab never paints — TradingView leaves every canvas at its default
        # 300x150 backing store, so an extension screenshot is BLANK while the
        # numbers are perfectly fine, because those come from the model. The fix is
        # `TradingViewApi.takeClientScreenshot()`, which renders explicitly into a
        # fresh canvas instead of relying on the paint loop. Its data URL then rides
        # the same hash-verified clipboard transport as everything else.
        prefix = "data:image/png;base64,"
        if not text.startswith(prefix):
            print("MATCHED the hash but is not a data:image/png;base64 URL. Nothing written.")
            return 1
        try:
            blob = base64.b64decode(text[len(prefix):], validate=True)
        except Exception as exc:  # noqa: BLE001
            print(f"MATCHED the hash but the base64 will not decode: {exc}. Nothing written.")
            return 1
        # PNG magic, checked without escapes so this line cannot be mangled again.
        if blob[1:4] != b"PNG":
            print("decoded, but the bytes are not a PNG. Nothing written.")
            return 1
        with open(path, "wb") as fh:
            fh.write(blob)
        print(f"MATCH -> wrote {os.path.relpath(path, REPO)}  ({len(blob):,} bytes PNG)")
        return 0

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
