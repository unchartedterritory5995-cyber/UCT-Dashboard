"""
corpus_licence.py — the ONE authority on whether a Pine script may be committed.

Owner ruling, 2026-09-09 (strict, scoped):

    A file under `corpus/committed/` must carry an EXPLICIT MPL-2.0, MIT or
    Apache-2.0 licence header in its own source. Anything else — GPL/AGPL, any
    CC variant, or no licence line at all — is reference-only: it lives in
    `corpus/reference/` as metadata, and its source is fetched into the
    gitignored local cache at test time.

    Legacy fixtures under `tests/fixtures/pine*` are EXEMPT (they predate this
    ruling; see docs/pine/LICENSING.md).

⭐ WHY "NO LICENCE LINE" IS NOT PERMISSIVE. TradingView's Terms §22 make an
open-source script MPL-2.0 by default, and an earlier corpus leaned on that. The
ruling deliberately does not: a default we infer is not a grant the author wrote,
and the file we commit carries no evidence of one. Reference-only costs us
nothing — the survey never needed the source in git, only on disk at test time.

⛔ THIS MODULE IS IMPORTED BY BOTH the CI rail (`tests/test_corpus_licence_rail.py`)
and the R1 ingest step. That is deliberate: a rail that re-implements the
predicate it guards is a second authority over one value, and the two drift on the
first edit. If you change what is permitted, change it HERE, once.
"""

from __future__ import annotations

import os
import re

#: The only licences whose source may be committed. Ordered for reporting only.
PERMITTED = ("MPL-2.0", "MIT", "Apache-2.0")

#: How many lines of a script count as "the header". A licence declared 200 lines
#: down is not a header; it is a mention.
HEADER_LINES = 60

# Detection is BROAD and permission is NARROW: we recognise the non-permitted
# licences too, purely so a failure can say WHICH one it found rather than the
# useless "no permitted licence". First match wins, most specific first.
_PATTERNS: tuple[tuple[str, str], ...] = (
    ("CC-BY-NC-ND", r"attribution[- ]noncommercial[- ]noderiv|by-nc-nd"),
    ("CC-BY-NC-SA", r"attribution[- ]noncommercial[- ]sharealike|by-nc-sa"),
    ("CC-BY-NC", r"attribution[- ]noncommercial|by-nc(?![-a-z])"),
    ("CC-BY-SA", r"attribution[- ]sharealike|by-sa(?![-a-z])"),
    ("CC-BY", r"creativecommons\.org/licenses/by/"),
    ("AGPL-3.0", r"affero general public"),
    ("GPL-3.0", r"gnu general public license v?\.?\s*3|gpl-?3|gplv3"),
    ("GPL-2.0", r"gnu general public license v?\.?\s*2|gnu license 2|gpl-?2"),
    ("LGPL", r"lesser general public"),
    ("GPL", r"gnu general public license"),
    # ── permitted, below ──
    ("MPL-2.0", r"mozilla public license.{0,60}2\.0|mozilla\.org/mpl/2\.0|mpl-?2\.0"),
    ("Apache-2.0", r"apache license.{0,60}2\.0|apache-?2\.0"),
    ("MIT", r"\bmit license\b|\bthe mit license\b|licensed under the mit\b"),
)

NONE_FOUND = "NONE-IN-SOURCE"


def detect(source: str) -> str:
    """The licence declared in the script's own header, or NONE_FOUND.

    ⚠️ Reads only the first HEADER_LINES lines, lower-cased. A script that
    mentions "MIT" in a comment about a strategy name 300 lines down has not
    licensed anything.
    """
    head = "\n".join((source or "").splitlines()[:HEADER_LINES]).lower()
    for name, rx in _PATTERNS:
        if re.search(rx, head):
            return name
    return NONE_FOUND


def is_permitted(source: str) -> bool:
    """True only for an explicit MPL-2.0 / MIT / Apache-2.0 header."""
    return detect(source) in PERMITTED


def classify(source: str) -> tuple[str, str]:
    """(licence, verdict) where verdict is 'commit' or 'reference'."""
    lic = detect(source)
    return lic, ("commit" if lic in PERMITTED else "reference")


def offenders_under(root: str) -> list[tuple[str, str]]:
    """Every .pine under `root` whose header is not a permitted licence.

    Returns [(relative_path, licence_found)], sorted. An empty list means the
    tree is clean. A missing root returns [] — the CALLER must decide whether
    that is acceptable; see the rail, which refuses to treat absence as a pass
    without saying so.
    """
    out: list[tuple[str, str]] = []
    if not os.path.isdir(root):
        return out
    for dirpath, _dirs, files in os.walk(root):
        for fn in sorted(files):
            if not fn.endswith(".pine"):
                continue
            p = os.path.join(dirpath, fn)
            with open(p, encoding="utf-8", errors="replace") as fh:
                lic, verdict = classify(fh.read())
            if verdict != "commit":
                out.append((os.path.relpath(p, root).replace("\\", "/"), lic))
    return sorted(out)
