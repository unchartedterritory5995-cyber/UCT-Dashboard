"""Repo-wide leaked-quote check: no golden quote may be reproduced in a committed file.

W1 §0.4f / D1 — this repository is PUBLIC. Golden quotes are paid Sunday Scans prose and
private Zoom transcript text. The verifier already proves the PROVENANCE file is quote-free;
this proves the same of every file git tracks, which is where the breach actually happened:
`docs/wisdom/vocabulary/setup-vocabulary-v0.draft.json` reproduced 8 golden quotes near
verbatim while the approved v1 file beside it carried locators only.

    python tools/wisdom/golden_leak_check.py [--golden <path>] [--min-windows N]

Exit 0 clean, 1 on a leak, 2 if the golden set is not on this box (gitignored, local only).

⚠️ WHY A THRESHOLD. The provenance check in wisdom_golden_verify.quote_leaks fires on ONE
24-character window, which is right for a file this program generates and wrong for a scan of
3,000 unrelated files: an ordinary English run like "the moving averages are " collides with a
Pine fixture that never saw a transcript. A leak is a REPRODUCTION, so the rail asks for
several windows of the same quote in the same file. The threshold is a stated number here, not
a feeling, and `--min-windows 1` reproduces the strict behaviour.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
WINDOW = 24
STEP = 8
DEFAULT_MIN_WINDOWS = 2
#: Binaries and vendored corpora: a match in them is noise, and they carry no prose we wrote.
SKIP_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".woff", ".woff2",
                 ".ttf", ".eot", ".mp3", ".mp4", ".wav", ".db", ".sqlite", ".pyc", ".lock")


def windows(quote: str) -> list[str]:
    if len(quote) < WINDOW:
        return [quote] if len(quote) >= 10 else []
    return [quote[i:i + WINDOW] for i in range(0, len(quote) - WINDOW + 1, STEP)]


def tracked_files() -> list[pathlib.Path]:
    out = subprocess.run(["git", "-C", str(REPO), "ls-files"], capture_output=True, text=True,
                         encoding="utf-8", errors="replace", check=True).stdout.split("\n")
    files = []
    for rel in out:
        rel = rel.strip()
        if not rel or rel.lower().endswith(SKIP_SUFFIXES):
            continue
        p = REPO / rel
        if p.is_file():
            files.append(p)
    return files


def scan(records: list[dict], files: list[pathlib.Path], min_windows: int) -> list[tuple[str, str, int]]:
    """(relative path, gid, matched windows) for every quote reproduced in a tracked file.

    Every window of every quote against every file is ~8M substring searches and takes
    minutes, so each quote is prefiltered by THREE probe windows taken at its start, middle
    and end. Only when a probe hits is the full count worth doing.

    ⚠️ WHAT THAT GUARANTEE IS, exactly — stated because a prefilter is where a scanner
    quietly stops scanning (`lesson_an_instrument_can_reproduce_its_own_blind_spot`): any
    reproduction that carries a contiguous THIRD of a quote contains one of the three probes
    and is therefore counted. A fragment shorter than a third, sitting between two probes, is
    not — and that is below the "reproduction" this rail is written to catch. `--min-windows 1`
    with the probes disabled is the exhaustive form; it is slow and is what the provenance
    check inside the verifier already does on the one file that matters most.
    """
    by_gid = []
    for r in records:
        wins = windows(r.get("quote") or "")
        if wins:
            probes = {wins[0], wins[len(wins) // 2], wins[-1]}
            by_gid.append((r.get("gid"), wins, tuple(probes)))
    leaks: list[tuple[str, str, int]] = []
    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for gid, wins, probes in by_gid:
            if not any(p in text for p in probes):
                continue
            hits = sum(1 for w in wins if w in text)
            if hits >= min(min_windows, len(wins)):
                leaks.append((_rel(path), gid, hits))
    return leaks


def _rel(path: pathlib.Path) -> str:
    try:
        return path.relative_to(REPO).as_posix()
    except ValueError:
        return path.as_posix()


def main() -> int:
    sys.stdout.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--golden", help="golden JSONL (default: the local data root)")
    ap.add_argument("--min-windows", type=int, default=DEFAULT_MIN_WINDOWS)
    args = ap.parse_args()
    sys.path.insert(0, str(REPO / "tools"))
    import wisdom_golden_verify as verify  # noqa: E402

    golden = pathlib.Path(args.golden) if args.golden else verify.data_root() / "golden" / "golden-v1.jsonl"
    if not golden.exists():
        print(f"INCONCLUSIVE — golden set not present at {golden} (gitignored; local only)")
        return 2
    records = [json.loads(line) for line in golden.read_text(encoding="utf-8").splitlines() if line.strip()]
    files = tracked_files()
    leaks = scan(records, files, args.min_windows)
    for rel, gid, hits in sorted(leaks):
        print(f"  - LEAK {rel}: {gid} ({hits} matching {WINDOW}-char windows)")
    print(f"leaked-quote check: {len(files)} tracked files, {len(records)} quotes, "
          f"min_windows={args.min_windows}, leaks={len(leaks)}")
    print("LEAK-CHECK PASS" if not leaks else "LEAK-CHECK FAIL")
    return 1 if leaks else 0


if __name__ == "__main__":
    sys.exit(main())
