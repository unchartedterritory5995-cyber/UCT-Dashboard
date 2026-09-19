# -*- coding: utf-8 -*-
"""OOS-1 FREEZE — deterministic corpus construction.

Applies ONLY the operations predeclared before the candidate pool was known:

  1. capture-integrity filter   (files captured by the known-broken flush-left
                                 pipeline are discarded wholesale; this is an
                                 integrity rule, not a content judgement)
  2. exact + normalised hash dedup within the staged pool
  3. near-duplicate removal      (difflib.SequenceMatcher on normalised source
                                 >= 0.85; tiebreak: earlier retrieved_at, then
                                 lower SHA-256)
  4. leakage removal             (same tests against pine_blind + pine_community)
  5. author cap                  (max 2 scripts per author, globally)
  6. quota trim                  (per-tier quota; within an over-quota cell keep
                                 the first N by ASCENDING SHA-256 of normalised
                                 source -- a cryptographic hash of the script's
                                 own text, uniformly distributed and uncorrelated
                                 with anything about its content)
  7. manifest + freeze ID        (SHA-256 over the canonical manifest bytes)
  8. license-based storage routing

⛔ NO STEP HERE MAY CONSIDER what a script contains, which Pine constructs it
uses, how hard it looks, or how any downstream system might fare on it. Every
reduction is either an integrity operation or a hash sort.

Usage:
    python tools/oos_freeze.py --plan      # dry run, prints every decision
    python tools/oos_freeze.py --apply     # writes the frozen corpus + manifest
"""
import argparse
import datetime
import difflib
import hashlib
import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAGING = ROOT / "tests" / "fixtures" / "pine_oos_staging"
FROZEN = ROOT / "tests" / "fixtures" / "pine_oos"
TIERS = ["high_engagement", "mid_engagement", "long_tail"]
QUOTA = {"high_engagement": 20, "mid_engagement": 20, "long_tail": 20}
NEAR_DUP = 0.85

# Predeclared: full source may be committed to git ONLY under an open,
# redistribution-contemplating licence. Everything else is metadata-only in git,
# with the source held locally and verifiable against the recorded hash by
# anyone who re-fetches the URL.
REDISTRIBUTABLE = [
    "mozilla public license", "mpl-2.0", "mpl 2.0",
    "mit license", "mit",
    "apache-2.0", "apache 2.0", "apache license",
    "cc0", "public domain", "unlicense",
]

# The capture-fidelity cutover, SCOPED TO THE TIER THAT WAS ACTUALLY BROKEN.
#
# Only the high_engagement sourcing agent ran the page-text/accessibility-tree
# pipeline that silently strips leading whitespace; its entire first pass measured
# 0.0% indented lines. The mid_engagement and long_tail agents used a
# whitespace-preserving method from the start and their original output was
# independently verified sound by two mechanical checks (oos_indent_check.py
# per-block-opener bodies, oos_flatten_check.py whole-file indent fraction) before
# this freeze was written.
#
# ⛔ This is a property of a CAPTURE RUN, never of a script. Applying the cutover
# to the two tiers that were never broken would discard 30+ verified-sound
# captures for no integrity reason -- and re-sourcing them would replace a blind
# selection with a fresh one, which is a real cost to corpus blindness.
CAPTURE_FIX_CUTOVER = datetime.datetime(2026, 9, 7, 9, 50, 0).timestamp()
CUTOVER_APPLIES_TO = {"high_engagement"}


def normalize(src: str) -> str:
    s = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    s = re.sub(r"//[^\n]*", "", s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def loc(src: str) -> int:
    return sum(1 for l in src.splitlines() if l.strip() and not l.strip().startswith("//"))


def bucket(n: int) -> str:
    return "short" if n <= 40 else ("medium" if n <= 90 else "long")


def has_block_opener(src: str) -> bool:
    return bool(re.search(r"^\s*(?:if|for|while|switch)\b.*[^{}\n]$", src, re.M))


def indented_fraction(src: str):
    lines = [l for l in src.splitlines() if l.strip() and not l.strip().startswith("//")]
    if not lines:
        return 0, 0
    ind = sum(1 for l in lines if l.startswith((" ", "\t")))
    return ind, len(lines)


def redistributable(lic: str) -> bool:
    l = (lic or "").strip().lower()
    if not l or l in ("not stated", "none", "unknown"):
        return False
    # A non-commercial Creative Commons term is NOT redistribution-contemplating
    # for our purposes; check it before the generic substring scan.
    if "noncommercial" in l or "nc-" in l or "nc " in l or l.startswith("cc-by-nc") or "by-nc" in l:
        return False
    return any(k in l for k in REDISTRIBUTABLE)


def load_candidates():
    out = []
    for tier in TIERS:
        d = STAGING / tier
        if not d.exists():
            continue
        for pf in sorted(d.glob("*.pine")):
            mp = pf.with_suffix(".json")
            if not mp.exists():
                out.append({"tier": tier, "file": pf.name, "path": pf, "meta": None,
                            "reject": "no-metadata"})
                continue
            try:
                meta = json.loads(mp.read_text(encoding="utf-8"))
            except Exception as e:
                out.append({"tier": tier, "file": pf.name, "path": pf, "meta": None,
                            "reject": f"bad-metadata:{e}"})
                continue
            src = pf.read_text(encoding="utf-8", errors="replace")
            norm = normalize(src)
            ind, total = indented_fraction(src)
            out.append({
                "tier": tier, "file": pf.name, "path": pf, "meta_path": mp, "meta": meta,
                "src": src, "norm": norm,
                "hash": sha256(src), "norm_hash": sha256(norm),
                "loc": loc(src), "mtime": pf.stat().st_mtime,
                "indented": ind, "code_lines": total,
                "has_block": has_block_opener(src),
                "reject": None,
            })
    return out


def load_existing():
    ex = []
    for d in [ROOT / "tests" / "fixtures" / "pine_blind", ROOT / "tests" / "fixtures" / "pine_community"]:
        if d.exists():
            for f in d.glob("*.pine"):
                s = f.read_text(encoding="utf-8", errors="replace")
                ex.append({"name": f.stem, "hash": sha256(s), "norm": normalize(s),
                           "norm_hash": sha256(normalize(s))})
    return ex


def ratio(a: str, b: str) -> float:
    la, lb = len(a), len(b)
    if la == 0 or lb == 0 or max(la, lb) / max(1, min(la, lb)) > 1.4:
        return 0.0
    sm = difflib.SequenceMatcher(None, a, b)
    if sm.quick_ratio() < NEAR_DUP:
        return 0.0
    return sm.ratio()


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--plan", action="store_true")
    g.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    log = []

    def say(s):
        log.append(s)
        # This box's console is cp1252; a report that crashes on its own bullet
        # character is a report nobody reads.
        try:
            print(s)
        except UnicodeEncodeError:
            print(s.encode("ascii", "replace").decode("ascii"))

    cands = load_candidates()
    say(f"Staged candidates on disk: {len(cands)}")
    for t in TIERS:
        say(f"  {t}: {sum(1 for c in cands if c['tier'] == t)}")

    # ── 1. capture-integrity filter ──────────────────────────────────────────
    say("\n[1] CAPTURE-INTEGRITY FILTER "
        "(discard anything captured by the known flush-left pipeline)")
    for c in cands:
        if c["reject"]:
            continue
        if c["tier"] in CUTOVER_APPLIES_TO and c["mtime"] < CAPTURE_FIX_CUTOVER:
            c["reject"] = "capture-pipeline-known-broken"
            say(f"  DROP {c['tier']}/{c['file']}: captured by the broken high-engagement pipeline")
            continue
        if c["has_block"] and c["indented"] == 0:
            c["reject"] = "flattened-block-structure"
            say(f"  DROP {c['tier']}/{c['file']}: has block openers but 0 indented lines")
    alive = [c for c in cands if not c["reject"]]
    say(f"  surviving: {len(alive)}")

    # ── 2. exact / normalised hash dedup ─────────────────────────────────────
    say("\n[2] EXACT + NORMALISED HASH DEDUP (within the staged pool)")
    seen = {}
    for c in sorted(alive, key=lambda x: (x["meta"].get("retrieved_at", ""), x["hash"])):
        for key in ("hash", "norm_hash"):
            if c[key] in seen and seen[c[key]] is not c:
                c["reject"] = f"duplicate-of:{seen[c[key]]['file']}"
                say(f"  DROP {c['tier']}/{c['file']}: identical to {seen[c[key]]['tier']}/{seen[c[key]]['file']}")
                break
        else:
            seen[c["hash"]] = c
            seen[c["norm_hash"]] = c
    alive = [c for c in alive if not c["reject"]]
    say(f"  surviving: {len(alive)}")

    # ── 3. near-duplicate removal ────────────────────────────────────────────
    say(f"\n[3] NEAR-DUPLICATE REMOVAL (normalised similarity >= {NEAR_DUP})")
    for i in range(len(alive)):
        for j in range(i + 1, len(alive)):
            a, b = alive[i], alive[j]
            if a["reject"] or b["reject"]:
                continue
            r = ratio(a["norm"], b["norm"])
            if r >= NEAR_DUP:
                # tiebreak: earlier retrieved_at, then lower SHA-256
                ka = (a["meta"].get("retrieved_at", ""), a["hash"])
                kb = (b["meta"].get("retrieved_at", ""), b["hash"])
                loser = b if ka <= kb else a
                loser["reject"] = f"near-duplicate:{r:.3f}"
                say(f"  DROP {loser['tier']}/{loser['file']}: near-dup ratio {r:.3f}")
    alive = [c for c in alive if not c["reject"]]
    say(f"  surviving: {len(alive)}")

    # ── 4. leakage vs existing corpora ───────────────────────────────────────
    say("\n[4] LEAKAGE REMOVAL (vs pine_blind + pine_community)")
    existing = load_existing()
    say(f"  checking against {len(existing)} existing scripts")
    for c in alive:
        for e in existing:
            if c["hash"] == e["hash"] or c["norm_hash"] == e["norm_hash"]:
                c["reject"] = f"leakage-exact:{e['name']}"
                say(f"  DROP {c['tier']}/{c['file']}: identical to existing {e['name']}")
                break
            r = ratio(c["norm"], e["norm"])
            if r >= NEAR_DUP:
                c["reject"] = f"leakage-near:{e['name']}:{r:.3f}"
                say(f"  DROP {c['tier']}/{c['file']}: near-dup of existing {e['name']} ({r:.3f})")
                break
    alive = [c for c in alive if not c["reject"]]
    say(f"  surviving: {len(alive)}")

    # ── 5. author cap ────────────────────────────────────────────────────────
    say("\n[5] AUTHOR CAP (max 2 per author, globally)")
    by_author = defaultdict(list)
    for c in alive:
        by_author[str(c["meta"].get("author", "UNKNOWN"))].append(c)
    for author, group in by_author.items():
        if len(group) > 2:
            # deterministic: keep the two with the lowest normalised-source SHA-256
            group.sort(key=lambda x: x["norm_hash"])
            for c in group[2:]:
                c["reject"] = f"author-cap:{author}"
                say(f"  DROP {c['tier']}/{c['file']}: author {author} over cap")
    alive = [c for c in alive if not c["reject"]]
    say(f"  surviving: {len(alive)}")

    # ── 6. quota trim ────────────────────────────────────────────────────────
    say("\n[6] QUOTA TRIM (per tier; keep first N by ASCENDING SHA-256 of normalised source)")
    selected = []
    for t in TIERS:
        cell = [c for c in alive if c["tier"] == t]
        q = QUOTA[t]
        cell.sort(key=lambda x: x["norm_hash"])
        if len(cell) > q:
            for c in cell[q:]:
                c["reject"] = "quota-trim"
                say(f"  TRIM {c['tier']}/{c['file']} (sha {c['norm_hash'][:12]})")
            cell = cell[:q]
        elif len(cell) < q:
            say(f"  !! {t}: {len(cell)}/{q} - SHORT BY {q - len(cell)}")
        selected.extend(cell)
        say(f"  {t}: {len(cell)}/{q}")

    say(f"\nSELECTED: {len(selected)} (target {sum(QUOTA.values())})")
    if len(selected) != sum(QUOTA.values()):
        say("!!!! THE CORPUS IS NOT AT TARGET. Freeze is NOT valid until it is.")

    # ── 7. manifest + freeze ID ──────────────────────────────────────────────
    selected.sort(key=lambda x: (x["tier"], x["file"]))
    entries = []
    for c in selected:
        m = c["meta"]
        entries.append({
            "tier": c["tier"],
            "file": c["file"],
            "title": m.get("title"),
            "author": m.get("author"),
            "source_url": m.get("source_url"),
            "retrieved_at": m.get("retrieved_at"),
            "pine_version": m.get("pine_version"),
            "license": m.get("license"),
            "publish_or_update_date": m.get("publish_or_update_date"),
            "declared_type": m.get("declared_type"),
            "capture_method": m.get("capture_method"),
            "non_comment_lines": c["loc"],
            "complexity_bucket": bucket(c["loc"]),
            "sha256_source": c["hash"],
            "sha256_normalized": c["norm_hash"],
            "storage": "git" if redistributable(m.get("license")) else "local-only",
        })

    canonical = json.dumps(entries, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    freeze_id = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    say(f"\n[7] FREEZE ID (SHA-256 over the canonical manifest): {freeze_id}")

    say("\n[8] STORAGE ROUTING")
    ingit = [e for e in entries if e["storage"] == "git"]
    local = [e for e in entries if e["storage"] == "local-only"]
    say(f"  committable to git (open licence): {len(ingit)}")
    say(f"  local-only (licence not stated / restrictive): {len(local)}")

    say("\n=== DISTRIBUTIONS ===")
    for label, key in [("tier", "tier"), ("complexity", "complexity_bucket"),
                       ("pine_version", "pine_version"), ("declared_type", "declared_type")]:
        cnt = defaultdict(int)
        for e in entries:
            cnt[str(e[key])] += 1
        say(f"  {label}: {dict(sorted(cnt.items()))}")

    if args.plan:
        say("\n(plan only — nothing written)")
        (STAGING / "_freeze_plan.txt").write_text("\n".join(log), encoding="utf-8")
        return 0

    # ── apply ────────────────────────────────────────────────────────────────
    #
    # ⭐ ONE DIRECTORY TO MEASURE, A LICENCE SPLIT INSIDE IT.
    #
    # An earlier draft wrote the redistributable scripts to one directory and the
    # rest to another, which satisfies the copyright rule and quietly breaks the
    # measurement: the Layer A harness reads ONE corpus directory, so half the
    # frozen corpus would silently not be measured -- and a corpus that measures
    # 24 of 60 while reporting rates over 60 is precisely the accounting defect
    # this program keeps finding.
    #
    # So every frozen script lands in ONE directory and a `.gitignore` inside it
    # excludes the non-redistributable ones from git BY NAME. Measurement sees all
    # 60; git carries only what its licence contemplates; and MANIFEST.json (which
    # IS committed) records the URL plus both hashes for all 60, so anyone can
    # re-fetch the withheld ones and verify they got the identical bytes.
    FROZEN.mkdir(parents=True, exist_ok=True)
    withheld = []
    for c, e in zip(selected, entries):
        stem = f"{c['tier']}__{c['file']}"
        shutil.copy2(c["path"], FROZEN / stem)
        (FROZEN / stem).with_suffix(".json").write_text(
            json.dumps(e, indent=2), encoding="utf-8")
        if e["storage"] != "git":
            withheld.append(stem)
    _header = (
        "# Scripts whose recorded licence does not contemplate redistribution.",
        "# They are frozen, measured and hashed like every other corpus member --",
        "# MANIFEST.json carries each one's source URL and SHA-256 -- but their",
        "# text is held locally only and never committed.",
        "# Re-fetch from the manifest URL and verify against sha256_source.",
    )
    (FROZEN / ".gitignore").write_text(
        chr(10).join(list(_header) + sorted(withheld)) + chr(10), encoding="utf-8")
    manifest = {
        "freeze_id": freeze_id,
        "frozen_at": datetime.datetime.now().astimezone().isoformat(),
        "target": sum(QUOTA.values()),
        "selected": len(entries),
        "quota": QUOTA,
        "near_dup_threshold": NEAR_DUP,
        "complexity_thresholds": {"short": "<=40", "medium": "41-90", "long": ">90"},
        "entries": entries,
    }
    (FROZEN / "MANIFEST.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (STAGING / "_freeze_log.txt").write_text("\n".join(log), encoding="utf-8")
    say(f"\nWrote {FROZEN / 'MANIFEST.json'}")
    say(f"Frozen corpus: {FROZEN}  ({len(entries)} scripts, all measurable)")
    say(f"Withheld from git by licence: {len(withheld)} (named in {FROZEN / '.gitignore'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
