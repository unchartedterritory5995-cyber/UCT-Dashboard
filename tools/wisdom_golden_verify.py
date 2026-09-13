"""Verify the Wisdom Loop golden set against the raw samples it was drawn from.

A golden label is only a label if the text it claims to label exists. This tool
checks, for every record in data/wisdom/golden/golden-v0.draft.jsonl.

⛔ The golden JSONL and the samples are GITIGNORED on purpose: this repository is
publicly readable (anonymous GitHub API 200, 2026-09-13), and the records quote
paid-session transcripts and name the owner's positions. Only the quote-free
provenance file below is committed. For every record it checks:

  * the sample file the record names is present (samples are gitignored under
    data/wisdom/samples/, so a fresh checkout has none — that is INCONCLUSIVE,
    never a pass);
  * the record's `quote` occurs EXACTLY ONCE in that sample's normalised text
    (zero = the label points at nothing; two+ = the span is ambiguous);
  * every quote listed under labels.contradictions does the same;
  * list records (labels.list_kind) carry the unique-ticker count and the
    duplicates they claim.

On success it writes docs/wisdom/golden/golden-v0.provenance.json: sample
sha256 + char span per record, so a later re-pull of a sample that drifts is
detectable by hash.

Normalisation (the ONE definition — extractors must use the same one):
  * *.txt (Sunday Scans): the file text as-is.
  * *.transcript_cues.json (Zoom): each cue's text with a leading
    "<speaker>: " prefix removed (prefix = up to 40 chars before the first
    ": "), cues joined by a single space.

Exit codes: 0 PASS · 1 a MEASURED failure · 2 INCONCLUSIVE (samples missing).

    python tools/wisdom_golden_verify.py
    python tools/wisdom_golden_verify.py --self-check
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
GOLDEN = REPO / "data" / "wisdom" / "golden" / "golden-v0.draft.jsonl"
SAMPLES = REPO / "data" / "wisdom" / "samples"
PROVENANCE = REPO / "docs" / "wisdom" / "golden" / "golden-v0.provenance.json"

_SPEAKER_MAX = 40


def strip_speaker(text: str) -> str:
    head, sep, rest = text.partition(": ")
    if sep and 0 < len(head) <= _SPEAKER_MAX:
        return rest
    return text


def normalised_text(path: pathlib.Path) -> str:
    raw = path.read_text(encoding="utf-8-sig")
    if path.name.endswith(".transcript_cues.json"):
        cues = json.loads(raw)["cues"]
        return " ".join(strip_speaker(c["text"]) for c in cues)
    return raw


def load_records(path: pathlib.Path) -> list[dict]:
    out = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise SystemExit(f"FAIL line {n}: not JSON ({exc})")
    return out


def check(records: list[dict], samples: pathlib.Path) -> tuple[int, list[str], dict]:
    problems: list[str] = []
    provenance: dict = {}
    texts: dict[str, tuple[str, str]] = {}
    missing = set()

    def text_for(name: str):
        if name not in texts:
            p = samples / name
            if not p.exists():
                missing.add(name)
                return None
            body = normalised_text(p)
            texts[name] = (body, hashlib.sha256(p.read_bytes()).hexdigest())
        return texts[name]

    seen = set()
    for r in records:
        gid = r.get("gid", "?")
        if gid in seen:
            problems.append(f"{gid}: duplicate gid")
        seen.add(gid)
        got = text_for(r["sample_file"])
        if got is None:
            continue
        body, sha = got
        q = r["quote"]
        count = body.count(q)
        if count != 1:
            problems.append(f"{gid}: quote found {count}x in {r['sample_file']} (must be exactly 1): {q[:70]!r}")
            continue
        start = body.index(q)
        provenance[gid] = {"sample_file": r["sample_file"], "sample_sha256": sha,
                           "char_start": start, "char_end": start + len(q)}
        for c in (r.get("labels") or {}).get("contradictions") or []:
            cg = text_for(c["sample_file"])
            if cg is not None and cg[0].count(c["quote"]) != 1:
                problems.append(f"{gid}: contradiction quote found {cg[0].count(c['quote'])}x in {c['sample_file']}")
        labels = r.get("labels") or {}
        if labels.get("list_kind"):
            toks = q.split()
            uniq = list(dict.fromkeys(toks))
            dups = sorted({t for t in toks if toks.count(t) > 1})
            if labels.get("tickers_expected_unique") != len(uniq):
                problems.append(f"{gid}: tickers_expected_unique={labels.get('tickers_expected_unique')} but source has {len(uniq)} unique")
            if sorted(labels.get("duplicates_in_source") or []) != dups:
                problems.append(f"{gid}: duplicates_in_source={labels.get('duplicates_in_source')} but source has {dups}")
    if missing:
        return 2, [f"sample not present: {m}" for m in sorted(missing)] + problems, provenance
    return (1 if problems else 0), problems, provenance


def self_check() -> int:
    """Prove the checker can see a presence AND can fail on an absence."""
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        dp = pathlib.Path(d)
        (dp / "s.txt").write_text("alpha beta. gamma delta. alpha beta.", encoding="utf-8")
        (dp / "c.transcript_cues.json").write_text(json.dumps(
            {"cues": [{"t": 1, "text": "Patrick (TSDR): hello there"}, {"t": 2, "text": "Ravi: ok. 9:30 works"}]}),
            encoding="utf-8")
        base = {"gid": "X", "sample_file": "s.txt"}
        cases = [
            ("control: unique quote passes", [dict(base, quote="gamma delta.")], 0),
            ("absent quote fails", [dict(base, quote="epsilon")], 1),
            ("ambiguous quote fails", [dict(base, quote="alpha beta.")], 1),
            ("missing sample is INCONCLUSIVE, not PASS", [dict(base, sample_file="nope.txt", quote="x")], 2),
            ("cue join strips speakers", [{"gid": "Y", "sample_file": "c.transcript_cues.json", "quote": "hello there ok. 9:30 works"}], 0),
            ("speaker prefix is NOT part of the text", [{"gid": "Y", "sample_file": "c.transcript_cues.json", "quote": "Ravi: ok"}], 1),
            ("list count mismatch fails", [dict(base, quote="gamma delta.", labels={"list_kind": "x", "tickers_expected_unique": 9, "duplicates_in_source": []})], 1),
        ]
        bad = 0
        for name, recs, want in cases:
            code, probs, _ = check(recs, dp)
            ok = code == want
            bad += not ok
            print(f"  {'ok ' if ok else 'BAD'} {name}: exit {code} (want {want}) {probs[:1]}")
    print("SELF-CHECK", "PASS" if not bad else f"FAIL ({bad})")
    return 0 if not bad else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        return self_check()
    if not GOLDEN.exists():
        print(f"INCONCLUSIVE — golden set not present at {GOLDEN.relative_to(REPO)} (gitignored; local only)")
        return 2
    records = load_records(GOLDEN)
    code, problems, prov = check(records, SAMPLES)
    by_type: dict[str, int] = {}
    for r in records:
        by_type[r["record_type"]] = by_type.get(r["record_type"], 0) + 1
    print(f"records={len(records)} by_type={by_type}")
    for p in problems:
        print("  -", p)
    if code == 0:
        PROVENANCE.parent.mkdir(parents=True, exist_ok=True)
        PROVENANCE.write_text(json.dumps(prov, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        print(f"PASS — provenance for {len(prov)} records -> {PROVENANCE.relative_to(REPO)}")
    else:
        print("INCONCLUSIVE" if code == 2 else "FAIL")
    return code


if __name__ == "__main__":
    sys.exit(main())
