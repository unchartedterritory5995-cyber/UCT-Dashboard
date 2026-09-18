"""S6 **CP1** — THE SOURCE-VOCABULARY RAIL. GATE-S6 line 1, fingerprint `b3073c67c`.

The packet's §4 CP1 row, verbatim:

    **CP1 | The source-vocabulary rail.** One DECLARED vocabulary; all three
    implementations derived from source (server dict keys by AST, `ALL_SOURCES`
    by AST, `impEff`'s branches by AST) and asserted to agree; a non-vacuity
    control; fails BY NAME on a fifth source or a dropped one. **No product
    code.**

──────────────────────────────────────────────────────────────────────────────
⛔⛔ THREE AUTHORITIES OVER ONE VOCABULARY, AND THE SPEC ONLY COUNTED TWO
──────────────────────────────────────────────────────────────────────────────

SPEC-S6 §2 names this defect and describes it as two implementations. Measured,
it was THREE, at CP1 time:

  1. `calendar_personalization.get_user_ticker_sets` — the four dict KEYS it
     returns. The authority (now `member_interest.SOURCE_BUCKETS` — see the
     CP2' note below).
  2. `app/src/pages/Calendar.jsx` — `ALL_SOURCES`, a hand-typed array literal.
     The source picker's universe and the default when a member has no
     preference. STILL a genuinely independent copy today — S6 CP2'/CP3 never
     touched the picker, only the personalization boost.
  3. `app/src/pages/calendar/importance.js` — `impEff`, a hand-typed if-chain
     applying the personalization BOOST. **RETIRED by CP3 — see below.**

⭐ **THE FAILURE IS SILENT AND IT IS DOUBLE.** Add a fifth source server-side:
`ALL_SOURCES` does not contain it, so the picker cannot offer it and `_sources`
never carries it. (impEff's half of this — a boost of exactly 0.0 for an unnamed
source — is the exact defect CP3 eliminates by having impEff carry no source
names of its own to be missing one from.)

⛔ `importance.js`'s own comment said it *"mirrors the my-sets join"* — **a
comment claiming agreement is a record that nobody wired them together**
(`lesson_a_comment_claiming_agreement_is_not_agreement`). CP3 wires them
together instead of documenting the gap.

⭐ And the near miss is already in the tree: `Calendar.jsx` carries a ⚰️ note
that `_sources` once used `ALL_SOURCES` instead of the member's active picker,
*"boosting names via a source the user disabled (a phantom position weighting
the ranking)."* Same vocabulary, same class, already shipped once.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ UPDATED FOR CP2' -- THE SERVER AUTHORITY MOVED, THIS RAIL FOLLOWS IT
──────────────────────────────────────────────────────────────────────────────

CP2' (`api/services/member_interest.py`) subsumed
`calendar_personalization.get_user_ticker_sets` rather than sitting beside
it: `get_user_ticker_sets` is now a thin delegate whose body builds its
return dict via a comprehension over `member_interest.SOURCES`, not a
literal `return {...}` with string-constant keys. **`server_sources()`
therefore no longer has anything to parse in `calendar_personalization.py`**
— the four names live in `member_interest.SOURCE_BUCKETS` now, and that is
where the authority genuinely is post-migration, not a rail preference.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ UPDATED FOR CP3 -- THE THIRD AUTHORITY IS GONE, ON PURPOSE
──────────────────────────────────────────────────────────────────────────────

CP3 (SPEC-S6 §5.1 item 2, Decision Card 2, DEFAULTABLE — the spec's own
stated default, applied 2026-09-18) removed `impEff`'s hardcoded if-chain
entirely. `impEff(imp, entry, weightBuckets)` now sums whatever bucket
weights `weightBuckets` (sourced from `member_interest.weight_buckets_payload()`
via `/api/calendar/my-sets`'s new `weight_buckets` field) says apply — it
carries **no source names of its own to compare against anything.**

This is CP1's own predicted outcome, verbatim from the section above: *"It
does not unify the three copies — that edits product code, which is CP3...
CP3 makes it impossible [for them to disagree]."* A function with no
vocabulary of its own cannot drift from one — there is nothing left to rail
by name. What replaces the old three-way comparison for `impEff` is a
POSITIVE proof that the hardcoded copy is actually gone (not merely renamed
or reformatted past what the old regex matched), with its own non-vacuity
control.

The two-way comparison (server vs. `Calendar.jsx` `ALL_SOURCES`) remains
fully live: the source PICKER is a genuinely separate concern CP3 did not
touch, and it is exactly as capable of silently missing a fifth source today
as it always was.
"""
from __future__ import annotations

import ast
import pathlib
import re

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
#: ⛔ CP2' moved the authority here from calendar_personalization.py — see
#: the "UPDATED FOR CP2'" note above.
_SERVER = _REPO / "api" / "services" / "member_interest.py"
_CALENDAR = _REPO / "app" / "src" / "pages" / "Calendar.jsx"
_IMPORTANCE = _REPO / "app" / "src" / "pages" / "calendar" / "importance.js"

#: ⛔ THE DECLARED VOCABULARY — the one place this list is written on purpose.
#: Read 2026-09-13 from `get_user_ticker_sets`, re-verified 2026-09-18 against
#: `member_interest.SOURCE_BUCKETS` post-CP2'. Everything below is DERIVED and
#: compared against it; nothing below re-types it.
#:
#: ⚠️ `all_mine` is NOT a source. It is the union the server computes for the
#: client's convenience, and treating it as a fifth source would make every
#: derived set disagree by exactly one name — which is why it is excluded HERE,
#: once, with the reason, rather than filtered at three call sites.
DECLARED_SOURCES = ("watchlist", "flagged", "positions", "uct20")
DERIVED_UNION_KEY = "all_mine"


# ═════════════════════════════════════════════════════════════════════════
# THE (now two) DERIVATIONS -- impEff's own copy was retired by CP3
# ═════════════════════════════════════════════════════════════════════════

def server_sources() -> set[str]:
    """The source names `member_interest.SOURCE_BUCKETS` actually declares,
    by AST.

    ⛔ AST, not a grep for quoted words, and not an import + attribute read:
    importing the module under test would execute it, and the whole point of
    every derivation in this file is to read the DECLARATION without running
    any of the code it describes. `SOURCE_BUCKETS` is a literal tuple of
    3-tuples (`(name, bucket, weight)`) — this walks it and takes each inner
    tuple's FIRST element.
    """
    tree = ast.parse(_SERVER.read_text(encoding="utf-8"))
    assign = next((n for n in tree.body if isinstance(n, ast.AnnAssign)
                   and isinstance(n.target, ast.Name) and n.target.id == "SOURCE_BUCKETS"), None)
    assert assign is not None, (
        "SOURCE_BUCKETS is gone from member_interest.py — this rail's "
        "premise has moved again; find the new authority before editing "
        "this function")
    names: set[str] = set()
    for elt in assign.value.elts:
        if isinstance(elt, ast.Tuple) and elt.elts:
            first = elt.elts[0]
            if isinstance(first, ast.Constant) and isinstance(first.value, str):
                names.add(first.value)
    return names - {DERIVED_UNION_KEY}


def _js_array_literal(src: str, name: str) -> set[str]:
    """The string members of `const <name> = [...]`, without a JS parser.

    ⛔ Anchored to the DECLARATION, never a bare search for the name — the file
    references `ALL_SOURCES` at three other sites and a loose match would read a
    usage as a definition.
    """
    m = re.search(r"const\s+" + re.escape(name) + r"\s*=\s*\[(.*?)\]", src, re.S)
    assert m, f"{name} is not declared as an array literal any more"
    return set(re.findall(r"['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]", m.group(1)))


def calendar_all_sources() -> set[str]:
    return _js_array_literal(_CALENDAR.read_text(encoding="utf-8"), "ALL_SOURCES")


def _impeff_body() -> str:
    """`impEff`'s own text (docstring + code), scoped to the function.

    ⛔ SCOPED TO THE FUNCTION BODY, same discipline as the retired
    `importance_boost_sources()`: `importance.js` names sources elsewhere in
    the file (docstrings, neighbouring helpers), and a whole-file scan could
    not tell "impEff still hardcodes this" from "the word appears somewhere
    else in the file."
    """
    src = _IMPORTANCE.read_text(encoding="utf-8")
    start = src.index("export function impEff")
    end = src.index("\n}", start)
    return src[start:end]


def hardcoded_source_names_in_impeff() -> set[str]:
    """Any DECLARED source name impEff still tests for via a literal
    `.includes('name')` call, by regex over the scoped body.

    ⛔ CP1's original `importance_boost_sources()` used this exact pattern to
    DERIVE impEff's vocabulary; CP3's job was to make that derivation find
    NOTHING. This function is deliberately still capable of finding the old
    shape (proved by `test_CONTROL_the_hardcode_detector_can_still_find_a_
    real_occurrence` below) — an absence that could not have been detected is
    not evidence of anything.
    """
    body = _impeff_body()
    found = set(re.findall(r"includes\(\s*['\"]([a-z0-9_]+)['\"]\s*\)", body))
    return found & set(DECLARED_SOURCES)


# ═════════════════════════════════════════════════════════════════════════
# NON-VACUITY
# ═════════════════════════════════════════════════════════════════════════

def test_NON_VACUITY_both_remaining_derivations_found_something():
    """⛔ A parser that silently returned nothing would make this rail
    permanently, invisibly green — and both derivations would 'agree'."""
    s, c = server_sources(), calendar_all_sources()
    assert len(s) >= 4, f"the server derivation found {s} — it is broken"
    assert len(c) >= 4, f"the ALL_SOURCES derivation found {c} — it is broken"


def test_CONTROL_the_hardcode_detector_can_still_find_a_real_occurrence():
    """⛔⛔ THE POSITIVE CONTROL FOR AN ABSENCE CHECK. If
    `hardcoded_source_names_in_impeff()` can never find anything — because the
    regex is broken, or scoped wrong — then `impEff` reading as "clean" proves
    nothing. Feed it impEff's OWN pre-CP3 shape as a synthetic fixture and
    confirm the detector still catches it."""
    fake = "export function impEff(imp, entry) {\n  if (src.includes('positions')) boost += 3.0\n}"
    found = set(re.findall(r"includes\(\s*['\"]([a-z0-9_]+)['\"]\s*\)", fake))
    assert found & set(DECLARED_SOURCES) == {"positions"}, (
        "the hardcode-detector regex itself is broken — it cannot even find "
        "a synthetic pre-CP3-shaped fixture, so impEff reading clean below "
        "proves nothing")


def test_CONTROL_the_ALL_SOURCES_probe_reads_the_DECLARATION_not_a_usage():
    """⛔ `ALL_SOURCES` appears at four sites in Calendar.jsx. A loose match
    would read a usage as a declaration and could not tell a shortened list from
    an unchanged one."""
    src = _CALENDAR.read_text(encoding="utf-8")
    assert src.count("ALL_SOURCES") > 1, "control fixture moved — the name is now unique"
    fake = "const ALL_SOURCES = ['only_one']\nconst x = ALL_SOURCES.map(...)\n"
    assert _js_array_literal(fake, "ALL_SOURCES") == {"only_one"}, (
        "the probe does not read the declaration it is anchored to")


# ═════════════════════════════════════════════════════════════════════════
# THE RAIL -- server vs. the source PICKER (Calendar.jsx ALL_SOURCES)
# ═════════════════════════════════════════════════════════════════════════

def test_the_SERVER_is_the_authority_and_matches_the_declaration():
    """⛔ If this fails, the DECLARATION is what moved — a source was added or
    removed server-side. Update `DECLARED_SOURCES` in the same commit, which is
    the point: the change becomes a decision somebody made on purpose."""
    got = server_sources()
    assert got == set(DECLARED_SOURCES), (
        f"the server returns {sorted(got)}, the declaration says "
        f"{sorted(DECLARED_SOURCES)}. A source changed server-side; every client "
        "copy below is now wrong and nothing else would have told you.")


def test_ALL_SOURCES_covers_the_whole_server_vocabulary():
    """⛔⛔ THE RAIL. A source the server returns and the picker does not know
    about is invisible: the member cannot even turn it on, and `_sources`
    never carries it."""
    missing = sorted(set(DECLARED_SOURCES) - calendar_all_sources())
    assert not missing, (
        f"Calendar.jsx ALL_SOURCES does not name {missing}, which the server "
        "DOES return. The source picker cannot offer it and `_sources` never "
        "carries it. Neither fails loudly anywhere else. Add it here, or "
        "remove it server-side.")


def test_ALL_SOURCES_invents_no_source_the_server_never_returns():
    """⛔ The other direction, and it is not symmetric. A client naming a source
    the server never returns is dead configuration that reads as a feature: the
    picker offers a toggle that can never match anything."""
    extra = sorted(calendar_all_sources() - set(DECLARED_SOURCES))
    assert not extra, (
        f"Calendar.jsx ALL_SOURCES names {extra}, which `get_user_ticker_sets` "
        "does not return. That is dead configuration wearing the shape of a "
        "feature.")


def test_the_union_key_is_NOT_treated_as_a_source():
    """⛔ `all_mine` is the server's derived union. Counting it as a source would
    make the comparison above disagree by exactly one name, and the obvious
    'fix' would be to add `all_mine` to `ALL_SOURCES` — which would give the
    union its own picker toggle and double-count every member's every ticker.

    ⛔ CP2' moved: `get_user_ticker_sets` (still `calendar_personalization.py`,
    NOT `member_interest.py` — it is the thin delegate, not the authority) no
    longer returns a dict LITERAL; it builds one via `out = {...}` then
    `out["all_mine"] = ...`. This checks for that subscript-assignment shape,
    not a `ast.Dict` return, which is why it reads a different file than
    `server_sources()` above and cannot share that function's AST walk.
    """
    calendar_personalization = _REPO / "api" / "services" / "calendar_personalization.py"
    tree = ast.parse(calendar_personalization.read_text(encoding="utf-8"))
    fn = next(n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name == "get_user_ticker_sets")
    assigned_keys: set[str] = set()
    for node in ast.walk(fn):
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Subscript)
                and isinstance(node.targets[0].slice, ast.Constant)):
            assigned_keys.add(node.targets[0].slice.value)
    assert DERIVED_UNION_KEY in assigned_keys, (
        "get_user_ticker_sets no longer assigns the union key this rail "
        "excludes — re-read it before trusting the exclusion")
    assert DERIVED_UNION_KEY not in calendar_all_sources()


def test_the_weight_buckets_payload_never_carries_all_mine_either():
    """The same exclusion, extended to CP3's own new wire field: a bucket
    grouping that named `all_mine` as a 'source' would give the union its own
    weight and double-count every entity that touches it."""
    from api.services import member_interest as mi
    named = set()
    for b in mi.weight_buckets_payload():
        named.update(b["sources"])
    assert DERIVED_UNION_KEY not in named


# ═════════════════════════════════════════════════════════════════════════
# CP3 -- PROVING THE THIRD AUTHORITY IS ACTUALLY GONE
# ═════════════════════════════════════════════════════════════════════════

def test_CP3_impEff_no_longer_hardcodes_any_declared_source():
    """⛔⛔ THE CP3 RAIL. Where CP1 asked "does impEff know about every
    server source", CP3 changes the question to "does impEff still carry an
    independent copy of the vocabulary AT ALL" — and the answer must now be
    no. A single surviving `.includes('positions')` here would mean CP3's
    'derive, don't mirror' migration is incomplete for that one name, silently
    reverting it to CP1's original defect."""
    leftover = hardcoded_source_names_in_impeff()
    assert not leftover, (
        f"impEff still hardcodes {sorted(leftover)} via a literal "
        "`.includes(...)` check — CP3's migration to a server-derived "
        "weightBuckets parameter is incomplete for this source.")


def test_CP3_impEff_takes_a_weightBuckets_parameter():
    """⛔ A signature check, not a behavioural one: proves the DERIVE path
    actually exists to receive the registry, rather than the hardcoded
    branches simply having been deleted with nothing put in their place
    (which `test_CP3_impEff_no_longer_hardcodes_any_declared_source` alone
    could not distinguish from this).

    ⛔ Regex, not `ast` — this file is JavaScript and Python's `ast` module
    cannot parse it (every other JS-reading function in this file is regex
    for the same reason; there is no JS parser available here).
    """
    src = _IMPORTANCE.read_text(encoding="utf-8")
    m = re.search(r"export function impEff\(([^)]*)\)", src)
    assert m, "impEff's declaration shape changed — this probe no longer anchors to it"
    params = [p.strip() for p in m.group(1).split(",")]
    assert "weightBuckets" in params, (
        f"impEff's parameters are {params} — it no longer hardcodes sources "
        "but also does not accept a weightBuckets parameter, so it cannot "
        "derive from anything either. Boost is silently always zero.")
