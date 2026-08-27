"""Every `closedTable.json::<key>` written in source must resolve in the manifest.

⛔ THIS EXISTS BECAUSE ONE RULING WAS CITED TO A KEY THAT NEVER EXISTED, IN THREE
FILES, ACROSS TWO LANES. `ast_interpret.py`, `interpret.js` and `pcf.js` each told
the reader that the criterion for declaring a composition was *"stated in
closedTable.json"* under a key the manifest has never had. Nothing failed: the
comment reads exactly like the thirty citations beside it that DO resolve, and a
citation is the one kind of claim a reader trusts without checking — that is the
whole reason to write one. So the ruling lived only in a commit message while
three comments insisted it lived in the artifact both lanes read.

⭐ THE CITATION LIST IS DERIVED FROM THE SOURCE, NEVER TYPED. A roster of
"citations we know about" would go stale the first time somebody wrote a new one,
which is the defect this rail is about. The scan finds them; the manifest answers
them; and the two SIZE assertions below stop the whole thing passing on an empty
sweep (a wrong root, a broken regex, a non-repo cwd).

⚠️ A CITATION IS NOT ALWAYS A MANIFEST KEY, and the exceptions are a DECLARED
ROSTER WITH A REASON PER ENTRY rather than a count or a loosened regex — a bare
count freezes a population and everyone reads the scarcity back as a fact, and a
loosened regex would stop seeing the defect this file was written for.
"""
from __future__ import annotations

import io
import json
import os
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json"

#: Where source lives. Docs and the SDD briefs are deliberately OUT: a brief
#: records what somebody believed on the day they wrote it, including citations
#: that were wrong — which is exactly the history this rail must not erase.
_ROOTS = ("api", "app/src", "tools", "tests", "scripts")
_EXTS = (".py", ".js", ".jsx", ".mjs", ".ts", ".tsx")
_SKIP_DIRS = frozenset({"node_modules", "__pycache__", ".venv", "venv", "dist",
                        "build", ".git", ".pytest_cache", "coverage"})

#: One path segment: a name, optionally with an `[index]` placeholder.
_SEG = r"[A-Za-z_][A-Za-z0-9_]*(?:\[[A-Za-z0-9_]*\])?"

#: ⚠️ THE SKIP CLASS IS WHY THIS SEES A CITATION SPLIT ACROSS A LINE BREAK.
#: `ast_freshness.py` wraps one mid-token (`closedTable.json::` / newline /
#: `_scalars_node`), and a pattern that demanded the key on the same line would
#: have reported that file as citing nothing — a silent hole in the census rather
#: than a failure. Backticks and quotes are skipped for the same reason: the
#: citation is usually written inside them.
_CITE = re.compile(
    r"closedTable\.json::(?:[\s`'\"*#])*(" + _SEG + r"(?:\." + _SEG + r")*)"
)

#: Sections whose ENTRIES are citable by their own bare name — `accum.recurrence`
#: means the `recurrence` field of the `accum` function, and writing
#: `functions.accum.recurrence` would be the same fact spelled longer.
_ENTRY_SECTIONS = ("functions", "scalars", "series", "operators", "clock")

#: ⛔ NOT-A-MANIFEST-KEY, DECLARED WITH THE REASON, ONE ENTRY PER SITE.
#: Both directions are asserted: an entry here that the scan no longer finds is
#: rot and fails too, so this roster cannot quietly outlive what it excuses.
_NOT_A_KEY = {
    ("app/src/components/chart/engine/__tests__/enumerationSites.test.js", "D3"):
        "a LEDGER ROW id, not a manifest key. The enumeration census names its "
        "own rows `<site>::<row-id>`, and this one happens to sit on "
        "closedTable.json. Same punctuation, different namespace.",
    ("app/src/components/chart/engine/__tests__/enumerationSites.test.js", "the"):
        "prose, not a path. That ledger row writes the file's English description "
        "after the separator (`the closed table — every name a user formula may "
        "call`), so the first word is a word, not a key. ⚠️ The literal is NOT "
        "reproduced here: this file is inside its own scan, and quoting a bad "
        "citation to explain it would create one.",
}


def _manifest() -> dict:
    return json.loads(io.open(MANIFEST, encoding="utf-8").read())


def _source_files() -> list[str]:
    out = []
    for root in _ROOTS:
        base = ROOT / root
        if not base.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
            for name in filenames:
                if name.endswith(_EXTS):
                    p = pathlib.Path(dirpath, name)
                    out.append(p.relative_to(ROOT).as_posix())
    return sorted(out)


def _citations() -> list[tuple[str, int, str]]:
    """``(path, line, cited_path)`` for every citation written in source."""
    hits = []
    for rel in _source_files():
        try:
            text = io.open(ROOT / rel, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        # ⚰️ NO SUBSTRING FAST-PATH HERE. One was written as a literal
        # `"<manifest>::"` and the pattern MATCHED IT — the closing quote is in
        # the skip class, so this file cited a key called `not`. A rail that
        # scans its own source must never spell the thing it is looking for.
        for m in _CITE.finditer(text):
            hits.append((rel, text.count("\n", 0, m.start()) + 1, m.group(1)))
    return hits


def _resolve(table: dict, cited: str) -> str | None:
    """``None`` when it resolves; otherwise the sentence saying what is wrong.

    An `[index]` placeholder means "any entry of this collection", so the segment
    after it is looked up in a representative VALUE rather than in the collection
    itself — `series[name].field` is a real fact about every series entry.
    """
    segs = cited.split(".")
    node: object = table
    walked: list[str] = []
    for i, raw in enumerate(segs):
        indexed = raw.endswith("]")
        seg = raw.split("[", 1)[0]
        if i == 0:
            if seg in table:
                node = table[seg]
            else:
                owner = next(
                    (s for s in _ENTRY_SECTIONS
                     if isinstance(table.get(s), dict) and seg in table[s]), None)
                if owner is None:
                    return (f"`{seg}` is not a top-level key of the manifest and is "
                            f"not an entry in any of {list(_ENTRY_SECTIONS)}")
                node = table[owner][seg]
        else:
            if not isinstance(node, dict) or seg not in node:
                inside = ".".join(walked) or "the manifest"
                return f"`{seg}` is not a key of `{inside}`"
            node = node[seg]
        walked.append(seg)
        if indexed:
            if not isinstance(node, dict) or not node:
                return f"`{seg}` is written with an [index] but is not a collection"
            node = next(iter(node.values()))
    return None


# ═══════════════════════════════════════════════════════════════════════════ #
# THE RAIL
# ═══════════════════════════════════════════════════════════════════════════ #

def test_every_closed_table_citation_in_source_resolves_to_a_real_key():
    table = _manifest()
    offenders = []
    for rel, line, cited in _citations():
        if (rel, cited) in _NOT_A_KEY:
            continue
        why = _resolve(table, cited)
        if why is not None:
            offenders.append(f"{rel}:{line}  closedTable.json::{cited}  —  {why}")
    assert not offenders, (
        "these comments send a reader to the manifest for a ruling the manifest "
        "does not carry. A citation is the one claim a reader does not check, so "
        "a dangling one keeps a decision in a commit message forever. Point it at "
        "the real key, state the ruling where it is implemented, or — if it is "
        "genuinely not a manifest path — add it to `_NOT_A_KEY` WITH ITS "
        "REASON:\n  " + "\n  ".join(offenders)
    )


def test_the_citation_scan_actually_READ_the_repository():
    """⛔ Everything above passes on an empty list. A census must assert the SIZE
    of what it read — and the lanes it read it from, because a scan that saw only
    Python would pass while the JS half of a mirrored citation dangled."""
    files = _source_files()
    assert len(files) > 500, f"expected hundreds of source files, walked {len(files)}"

    hits = _citations()
    assert len(hits) >= 40, (
        f"only {len(hits)} citations found; this repo carried 56 when the rail was "
        "written. A collapse means the pattern or the roots stopped matching, not "
        "that the citations were cleaned up.")

    py = {r for r, _, _ in hits if r.startswith("api/") and r.endswith(".py")}
    js = {r for r, _, _ in hits if r.startswith("app/src/") and r.endswith(".js")}
    assert py, "no citation was read from a Python file under api/ — one lane is unscanned"
    assert js, "no citation was read from a JS file under app/src/ — one lane is unscanned"

    # …and the mirror this rail was written for is covered on BOTH sides.
    assert "api/services/ast_interpret.py" in py
    assert "app/src/components/chart/engine/ast/interpret.js" in js


def test_the_resolver_can_say_NO():
    """⛔ THE CONTROL. A resolver that answered `None` to everything would make the
    rail above green forever, which is indistinguishable from the rail working.
    Each case names a DIFFERENT way to be wrong, so a resolver that only checked
    the first segment could not pass this."""
    table = _manifest()

    # the actual defect this file exists for
    assert _resolve(table, "_functions_compositions") is not None
    # a nested key that is not there, under a parent that is
    assert _resolve(table, "_functions_excluded.aroonUp") is not None
    # a function name that is not declared
    assert _resolve(table, "definitelyNotAFunction") is not None
    # an [index] on something that is not a collection
    assert _resolve(table, "tableVersion[x]") is not None

    # …and the shapes that genuinely occur all resolve, so the control above is
    # not passing because the resolver rejects everything.
    for good in ("_functions_excluded", "_functions_excluded.variance", "sessionMaxBars",
                 "accum.recurrence", "functions.accum.recurrence", "series[name].field",
                 "scalars", "_session"):
        assert _resolve(table, good) is None, good


def test_the_not_a_key_roster_is_still_earning_its_place():
    """⚠️ ANTI-ROT, BOTH DIRECTIONS. An exemption that no longer matches anything
    is a licence nobody revoked — and the next citation to land on that file and
    spelling would inherit it silently."""
    present = {(rel, cited) for rel, _, cited in _citations()}
    stale = sorted(k for k in _NOT_A_KEY if k not in present)
    assert not stale, (
        "these exemptions no longer match any citation in the source. Delete them "
        f"rather than leaving a standing licence: {stale}")
    for key, reason in _NOT_A_KEY.items():
        assert len(reason) > 40, f"{key} is exempted without a real reason"


def test_the_manifest_this_rail_reads_is_the_shipped_one():
    """A resolver pointed at the wrong file would answer `None` to nothing and
    `not None` to everything — loud, but for the wrong reason. Pin the subject."""
    table = _manifest()
    assert MANIFEST.is_file(), MANIFEST
    assert len(table) > 30, f"the manifest has only {len(table)} top-level keys"
    for required in ("functions", "series", "scalars", "_functions_excluded"):
        assert required in table, required


@pytest.mark.parametrize("cited", ["_functions_excluded", "series[name].field"])
def test_the_pattern_finds_a_citation_wrapped_the_way_source_wraps_them(cited):
    """⛔ The pattern must survive the FORMS this repo writes citations in —
    including split across a line break mid-token, which `ast_freshness.py` does
    and which a same-line pattern would silently miss."""
    for text in (f"``closedTable.json::{cited}``",
                 f"`closedTable.json::{cited}`",
                 f"see closedTable.json::{cited} for why",
                 f"(``closedTable.json::\n    {cited}``)",
                 f" *  `closedTable.json::{cited}` — the ruling"):
        m = _CITE.search(text)
        assert m is not None, text
        assert m.group(1) == cited.split("\n")[0].strip(), (text, m.group(1))
