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
it is THREE:

  1. `calendar_personalization.get_user_ticker_sets` — the four dict KEYS it
     returns. The authority.
  2. `app/src/pages/Calendar.jsx` — `ALL_SOURCES`, a hand-typed array literal.
     The source picker's universe and the default when a member has no
     preference.
  3. `app/src/pages/calendar/importance.js` — `impEff`, a hand-typed if-chain
     applying the personalization BOOST.

⭐ **THE FAILURE IS SILENT AND IT IS DOUBLE.** Add a fifth source server-side:
`ALL_SOURCES` does not contain it, so the picker cannot offer it and `_sources`
never carries it; and `impEff` does not name it, so even if it arrived it would
add a boost of **exactly 0.0** — the member's strongest new signal ranked as
though it were not theirs. Neither produces an error, a log line, or a red test.

⛔ `importance.js`'s own comment says it *"mirrors the my-sets join"* — **a
comment claiming agreement is a record that nobody wired them together**
(`lesson_a_comment_claiming_agreement_is_not_agreement`).

⭐ And the near miss is already in the tree: `Calendar.jsx` carries a ⚰️ note
that `_sources` once used `ALL_SOURCES` instead of the member's active picker,
*"boosting names via a source the user disabled (a phantom position weighting
the ranking)."* Same vocabulary, same class, already shipped once.

──────────────────────────────────────────────────────────────────────────────
⛔ WHAT THIS RAIL DOES NOT DO
──────────────────────────────────────────────────────────────────────────────

It does **not** unify the three copies — that edits product code, which is CP3
and needs the derive-vs-mirror ruling. It makes the divergence LOUD; CP3 makes
it impossible. It does **not** assert the WEIGHTS (`+3.0 / +2.0 / +1.0` are a
product judgement about how much a position outranks a flag) — only that the
NAMES agree. And it reads no production data: the vocabulary is a property of
the source, and a rail needing a member's data is a rail nobody runs.
"""
from __future__ import annotations

import ast
import pathlib
import re

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_SERVER = _REPO / "api" / "services" / "calendar_personalization.py"
_CALENDAR = _REPO / "app" / "src" / "pages" / "Calendar.jsx"
_IMPORTANCE = _REPO / "app" / "src" / "pages" / "calendar" / "importance.js"

#: ⛔ THE DECLARED VOCABULARY — the one place this list is written on purpose.
#: Read 2026-09-13 from `get_user_ticker_sets`. Everything below is DERIVED and
#: compared against it; nothing below re-types it.
#:
#: ⚠️ `all_mine` is NOT a source. It is the union the server computes for the
#: client's convenience, and treating it as a fifth source would make every
#: derived set disagree by exactly one name — which is why it is excluded HERE,
#: once, with the reason, rather than filtered at three call sites.
DECLARED_SOURCES = ("watchlist", "flagged", "positions", "uct20")
DERIVED_UNION_KEY = "all_mine"


# ═════════════════════════════════════════════════════════════════════════
# THE THREE DERIVATIONS
# ═════════════════════════════════════════════════════════════════════════

def server_sources() -> set[str]:
    """The keys `get_user_ticker_sets` actually returns, by AST.

    ⛔ AST, not a grep for quoted words: the module mentions every source name
    in prose and in four helper names, and a text scan would find them there
    too. The question is what the RETURNED DICT is keyed by.
    """
    tree = ast.parse(_SERVER.read_text(encoding="utf-8"))
    fn = next((n for n in tree.body
               if isinstance(n, ast.FunctionDef) and n.name == "get_user_ticker_sets"), None)
    assert fn is not None, "get_user_ticker_sets is gone — this rail's premise has moved"
    keys: set[str] = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Return) and isinstance(node.value, ast.Dict):
            for k in node.value.keys:
                if isinstance(k, ast.Constant) and isinstance(k.value, str):
                    keys.add(k.value)
    return keys - {DERIVED_UNION_KEY}


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


def importance_boost_sources() -> set[str]:
    """Every source name `impEff` branches on.

    ⛔ SCOPED TO THE FUNCTION BODY. `importance.js` names sources in its
    docstrings and in neighbouring helpers; a whole-file scan would pass while
    `impEff` itself had lost a branch — an instrument reporting the file's
    vocabulary instead of the function's.
    """
    src = _IMPORTANCE.read_text(encoding="utf-8")
    start = src.index("export function impEff")
    end = src.index("\n}", start)
    body = src[start:end]
    # `src.includes('positions')` — the only shape the branches use today. If it
    # changes, the non-vacuity control below goes red rather than this silently
    # returning an empty set.
    #
    # ⚰️ THE CHARACTER CLASS EXCLUDED DIGITS ON THE FIRST RUN (`[a-z_]+`), so
    # `uct20` did not match and this probe reported a THREE-name vocabulary
    # against the server's four. It read exactly like a real divergence — the
    # rail's own headline finding — and it was the instrument describing itself.
    # ⭐ The non-vacuity control above caught it FIRST (`found 3, expected >= 4`),
    # which is the entire reason that control exists: it fires on a broken
    # derivation before the comparison can publish a false finding.
    return set(re.findall(r"includes\(\s*['\"]([a-z0-9_]+)['\"]\s*\)", body))


# ═════════════════════════════════════════════════════════════════════════
# NON-VACUITY — every assertion below is satisfied by three empty sets
# ═════════════════════════════════════════════════════════════════════════

def test_NON_VACUITY_all_three_derivations_found_something():
    """⛔ A parser that silently returned nothing would make this rail
    permanently, invisibly green — and all three derivations would 'agree'."""
    s, c, i = server_sources(), calendar_all_sources(), importance_boost_sources()
    assert len(s) >= 4, f"the server derivation found {s} — it is broken"
    assert len(c) >= 4, f"the ALL_SOURCES derivation found {c} — it is broken"
    assert len(i) >= 4, f"the impEff derivation found {i} — it is broken"


def test_CONTROL_the_impEff_probe_reads_the_FUNCTION_not_the_FILE():
    """⛔ The probe must be scoped. If it read the whole file it would still see
    the names when `impEff` had lost a branch, which is the failure it exists to
    catch. Proved by checking a name that appears in the file but must NOT be in
    the function's branch set."""
    src = _IMPORTANCE.read_text(encoding="utf-8")
    assert "expected_move" in src, "control fixture moved — pick another file-only name"
    assert "expected_move" not in importance_boost_sources(), (
        "the impEff probe is reading the whole file, not the function body")


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
# THE RAIL
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


@pytest.mark.parametrize("name,derive", [
    ("Calendar.jsx ALL_SOURCES", calendar_all_sources),
    ("importance.js impEff", importance_boost_sources),
])
def test_every_CLIENT_copy_covers_the_whole_server_vocabulary(name, derive):
    """⛔⛔ THE RAIL, failing BY NAME one copy at a time.

    A source the server returns and this copy does not know about is invisible:
    in `ALL_SOURCES` the member cannot even turn it on; in `impEff` it scores a
    boost of exactly 0.0. Both are silent.
    """
    got = derive()
    missing = sorted(set(DECLARED_SOURCES) - got)
    assert not missing, (
        f"{name} does not name {missing}, which the server DOES return.\n"
        "  In ALL_SOURCES that means the source picker cannot offer it and "
        "`_sources` never carries it.\n"
        "  In impEff it means a boost of exactly 0.0 — the member's signal "
        "ranked as if it were not theirs.\n"
        "  Neither fails loudly anywhere else. Add it here, or remove it "
        "server-side.")


@pytest.mark.parametrize("name,derive", [
    ("Calendar.jsx ALL_SOURCES", calendar_all_sources),
    ("importance.js impEff", importance_boost_sources),
])
def test_no_CLIENT_copy_invents_a_source_the_server_never_returns(name, derive):
    """⛔ The other direction, and it is not symmetric. A client naming a source
    the server never returns is dead configuration that reads as a feature: the
    picker offers a toggle that can never match anything, and `impEff` carries a
    weight for a name that will never arrive."""
    extra = sorted(derive() - set(DECLARED_SOURCES))
    assert not extra, (
        f"{name} names {extra}, which `get_user_ticker_sets` does not return. "
        "That is dead configuration wearing the shape of a feature.")


def test_the_union_key_is_NOT_treated_as_a_source():
    """⛔ `all_mine` is the server's derived union. Counting it as a source would
    make every comparison above disagree by exactly one name, and the obvious
    'fix' would be to add `all_mine` to the client copies — which would give the
    union its own boost and double-count every member's every ticker."""
    tree = ast.parse(_SERVER.read_text(encoding="utf-8"))
    fn = next(n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name == "get_user_ticker_sets")
    all_keys: set[str] = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Return) and isinstance(node.value, ast.Dict):
            for k in node.value.keys:
                if isinstance(k, ast.Constant):
                    all_keys.add(k.value)
    assert DERIVED_UNION_KEY in all_keys, (
        "the server no longer returns the union key this rail excludes — "
        "re-read get_user_ticker_sets before trusting the exclusion")
    assert DERIVED_UNION_KEY not in calendar_all_sources()
    assert DERIVED_UNION_KEY not in importance_boost_sources()


def test_the_BASELINE_is_recorded_so_the_CP2_migration_can_be_proved_a_no_op():
    """⭐ SPEC-S6 §5 promises the first migration 'can be provably a no-op'.
    Nothing could prove that before this: there was no artifact saying what the
    three copies agreed on. This test IS that artifact — it pins the agreed
    vocabulary at CP1 time, so CP2 can diff against it rather than against
    somebody's memory."""
    assert server_sources() == calendar_all_sources() == importance_boost_sources() \
        == set(DECLARED_SOURCES), (
        "the three copies do not currently agree. That is a FINDING, not a "
        "broken test — record it before migrating anything.")
