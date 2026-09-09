"""
corpus_ingest.py — build `corpus/` from the survey cache, under the licence ruling.

R1 step 0. Takes the 537 entries of `docs/pine/corpus-expansion-plan.json`, resolves
each one's fetched source, and writes two trees:

    corpus/committed/<slug>.pine    the SOURCE, verbatim, headers intact
                                    — only for an explicit MPL-2.0 / MIT / Apache-2.0 header
    corpus/reference/<slug>.json    METADATA for every entry, permitted or not
                                    — url, author, licence, version, category, our_status

⛔ THE GATE IS `corpus_licence.classify`, THE SAME FUNCTION THE CI RAIL USES. That is
the whole point of that module: a rail that re-implements the predicate it guards is a
second authority over one value, and the two drift on the first edit. This script does
not decide what is permitted; it asks.

⭐ AND IT RESOLVES SOURCES TWO WAYS. The plan's own `local_source` field is null for 133
of the 537 entries — not because they were never fetched (all 537 are in the fetch log
with status "ok") but because the plan never recorded the path. Falling back to the fetch
log's `slug` resolves every one of them, and it moves the commit-eligible count from
196 to 266. A plan field that is merely ABSENT looks exactly like a script that could not
be had; only the second source of truth tells them apart.

Usage
-----
    python tools/pine_survey/corpus_ingest.py            # write it
    python tools/pine_survey/corpus_ingest.py --dry-run  # report only

Idempotent: re-running rewrites identical bytes.
"""

from __future__ import annotations

import argparse
import collections
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, REPO)

from tools.pine_survey.corpus_licence import classify  # noqa: E402

PLAN = os.path.join(REPO, "docs", "pine", "corpus-expansion-plan.json")
CACHE = os.path.join(HERE, "cache")
SRC_DIR = os.path.join(CACHE, "sources")
FETCH_LOG = os.path.join(CACHE, "meta", "fetch_log.json")
CORPUS = os.path.join(REPO, "corpus")
COMMITTED = os.path.join(CORPUS, "committed")
REFERENCE = os.path.join(CORPUS, "reference")


def load(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def resolve_source(entry, have, log):
    """The cached filename for a plan entry, or None.

    ⚠️ TWO ROUTES ON PURPOSE. `local_source` is null for 133 entries whose source is
    nonetheless on disk; the fetch log's `slug` finds them. Trusting only the first
    silently under-counts the corpus by a third.
    """
    base = os.path.basename(entry.get("local_source") or "")
    if base and base in have:
        return base
    slug = (log.get(entry["scriptIdPart"]) or {}).get("slug")
    if slug and slug + ".pine" in have:
        return slug + ".pine"
    return None


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Build corpus/committed and corpus/reference from the survey cache."
    )
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args()

    plan = load(PLAN)
    log = load(FETCH_LOG)
    have = set(os.listdir(SRC_DIR))

    stats = collections.Counter()
    committed, reference, unresolved = [], [], []

    for e in plan["entries"]:
        base = resolve_source(e, have, log)
        if not base:
            unresolved.append(e)
            stats["unresolved"] += 1
            continue
        with io.open(os.path.join(SRC_DIR, base), encoding="utf-8") as fh:
            src = fh.read()
        licence, verdict = classify(src)
        stats[licence] += 1
        # ⚠️ len(".pine") is 5, NOT 6. `base[:-6]` silently ate the last character
        # of every name — two entries then collided on one filename, which is the
        # only reason it was noticed at all. Slice by the suffix length, never a
        # hand-counted literal.
        slug = base[: -len(".pine")] if base.endswith(".pine") else base
        record = {
            "scriptIdPart": e["scriptIdPart"],
            "title": e.get("title"),
            "author": e.get("author"),
            "url": e.get("url_guess"),
            "agreeCount": e.get("agreeCount"),
            "category": e.get("category"),
            "pine_version": e.get("pine_version_if_known"),
            "declaration": e.get("declaration"),
            "licence": licence,
            "verdict": verdict,
            "source_file": ("corpus/committed/%s.pine" % slug) if verdict == "commit" else None,
            "cached_source": "tools/pine_survey/cache/sources/%s" % base,
            "our_status": "committed" if verdict == "commit" else "reference-only",
        }
        (committed if verdict == "commit" else reference).append((slug, src, record))

    print("licence spread across %d plan entries:" % len(plan["entries"]))
    for k, v in stats.most_common():
        print("  %4d  %s" % (v, k))
    print()
    print("commit-eligible : %d" % len(committed))
    print("reference-only  : %d" % len(reference))
    print("unresolved      : %d" % len(unresolved))

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    os.makedirs(COMMITTED, exist_ok=True)
    os.makedirs(REFERENCE, exist_ok=True)

    wrote_src = 0
    for slug, src, rec in committed:
        # ⛔ Belt and braces: never write a source the gate did not clear. The rail
        # checks this too, but a script that can write an offender relies on the rail
        # to catch it, and a rail is a last line, not a first one.
        assert rec["verdict"] == "commit", slug
        path = os.path.join(COMMITTED, slug + ".pine")
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(src if src.endswith("\n") else src + "\n")
        wrote_src += 1

    wrote_meta = 0
    for slug, _src, rec in committed + reference:
        path = os.path.join(REFERENCE, slug + ".json")
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(rec, fh, indent=1, ensure_ascii=False)
            fh.write("\n")
        wrote_meta += 1

    index = {
        "generated_by": "tools/pine_survey/corpus_ingest.py",
        "plan": "docs/pine/corpus-expansion-plan.json",
        "policy": "docs/pine/LICENSING.md",
        "gate": "tools/pine_survey/corpus_licence.classify",
        "counts": {
            "plan_entries": len(plan["entries"]),
            "committed": len(committed),
            "reference_only": len(reference),
            "unresolved": len(unresolved),
        },
        "licences": dict(stats),
    }
    with io.open(os.path.join(CORPUS, "index.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(index, fh, indent=1, ensure_ascii=False)
        fh.write("\n")

    print("\nwrote %d sources to corpus/committed/" % wrote_src)
    print("wrote %d metadata records to corpus/reference/" % wrote_meta)
    print("wrote corpus/index.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
