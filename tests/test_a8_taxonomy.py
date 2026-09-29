"""TERM-075 / FB-A8-01 — ONE authority for A8's vocabularies, railed by AST.

The three populations (catalyst tags K8, themes H9, cashtags M5) now derive from
`app/src/lib/taxonomy/a8Taxonomy.json` through `api/services/a8_taxonomy.py`.
These rails make a FOURTH declaration fail BY NAME (file:line), over a
population DERIVED by walking api/, tools/ and scripts/ — never a typed list of
consumers (a consumer that is not on a list is exactly the one that drifts).

⛔ AST, NOT GREP. A comment or a docstring that NAMES the vocabulary is not a
copy of it; a tuple literal that HOLDS it is. Every detector below has a control
proving it can see a planted copy and cannot see a comment.

What counts as a restated copy of a vocabulary V (a tuple/list/set literal, or
the keys of a dict literal):
  * its string elements are all members of V and there are at least two, OR
  * it holds every member of V (a superset copy).
A literal that shares a few words with V and also holds non-members is a
DIFFERENT vocabulary (the hunter's catalyst_type set shares "Earnings"/"News"
with the tags and is not a copy of them). A literal passed to
`a8_taxonomy.keyed_by(V, {...})` is a policy table CHECKED against V at import,
and is allowed.
"""
from __future__ import annotations

import ast
import functools
import json
import re
import warnings
from pathlib import Path

import pytest

from api.services import a8_taxonomy as A8

REPO = Path(__file__).resolve().parents[1]
AUTHORITY_MODULE = "api/services/a8_taxonomy.py"
CASHTAG_BASELINE_PATH = Path(__file__).with_name("a8_cashtag_grammars.baseline.json")

#: ⛔ The ONE recorded exception, and why. S7's alert-taxonomy files are frozen
#: (dark comparison + byte-identical rails), so its mirror of the tag vocabulary
#: cannot be migrated from here. It is not trusted either: its comment claims
#: agreement with the tagger, and `test_s7_mirror_equals_the_authority` WIRES that
#: claim — the copy must equal the authority, in precedence order, or this fails.
FROZEN_S7_MIRRORS = {("api/services/alert_taxonomy/catalyst_match.py", "TAGS")}


# ── the population ───────────────────────────────────────────────────────────
def _is_test_path(rel: str) -> bool:
    parts = rel.split("/")
    name = parts[-1]
    return (
        any(p in ("tests", "test", "__tests__", "node_modules", "__pycache__") for p in parts[:-1])
        or name.startswith("test_") or name.endswith("_test.py") or name == "conftest.py"
    )


@functools.lru_cache(maxsize=None)
def _product_python_files() -> tuple:
    return tuple(_walk_product_python())


def product_python_files() -> list[str]:
    return list(_product_python_files())


def _walk_product_python() -> list[str]:
    out = []
    for top in ("api", "tools", "scripts"):
        for p in (REPO / top).rglob("*.py"):
            rel = p.relative_to(REPO).as_posix()
            if _is_test_path(rel) or rel == AUTHORITY_MODULE:
                continue
            out.append(rel)
    return sorted(out)


@functools.lru_cache(maxsize=None)
def _parse(rel: str):
    """Parsed once per session and shared by every rail. SyntaxWarnings from other
    modules' invalid escapes are theirs to fix, not this rail's to print."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", SyntaxWarning)
            return ast.parse((REPO / rel).read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError):
        return None


# ── detectors (pure: source text in, findings out) ───────────────────────────
def _str_elems(nodes) -> list[str]:
    return [n.value for n in nodes if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _restates(strs: list[str], vocab: frozenset) -> bool:
    members = {s for s in strs if s in vocab}
    if len(members) < 2:
        return False
    return set(strs) <= vocab or vocab <= set(strs)


def _call_name(call: ast.Call) -> str:
    f = call.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return ""


def _parents(tree):
    par = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            par[child] = node
    return par


def restated_collections(tree, vocabularies=A8.VOCABULARIES) -> list[tuple]:
    """[(lineno, vocab_name, assigned_name_or_None)] for every literal restating a vocabulary."""
    par = _parents(tree)
    out = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
            strs = _str_elems(node.elts)
        elif isinstance(node, ast.Dict):
            strs = _str_elems([k for k in node.keys if k is not None])
        else:
            continue
        for vname, vocab in vocabularies.items():
            if not _restates(strs, vocab):
                continue
            p = par.get(node)
            if isinstance(p, ast.Call) and _call_name(p) == "keyed_by" and node in p.args[1:]:
                continue
            target = None
            while p is not None and not isinstance(p, (ast.Assign, ast.AnnAssign)):
                if isinstance(p, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module)):
                    break
                p = par.get(p)
            if isinstance(p, ast.Assign) and isinstance(p.targets[0], ast.Name):
                target = p.targets[0].id
            elif isinstance(p, ast.AnnAssign) and isinstance(p.target, ast.Name):
                target = p.target.id
            out.append((node.lineno, vname, target))
    return out


def _is_tag_read(node) -> bool:
    """`x.get("tag")`, `x.get("tag", ...)` or `x["tag"]`."""
    if isinstance(node, ast.Call) and _call_name(node) == "get" and node.args:
        a = node.args[0]
        return isinstance(a, ast.Constant) and a.value == "tag"
    if isinstance(node, ast.Subscript):
        s = node.slice
        return isinstance(s, ast.Constant) and s.value == "tag"
    return False


def bare_tag_literals(tree, tags=A8.CATALYST_TAGS) -> list[tuple]:
    """[(lineno, value)] for a bare tag literal in a TAG POSITION: a `.get("tag", X)`
    default, `<tag read> or X`, `<tag read> ==/!=/in X`, a `{"tag": X}` entry, or a
    function returning two or more distinct tags as bare literals (a tagger)."""
    out = []

    def is_tag_const(n):
        return isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value in tags

    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _is_tag_read(node) and len(node.args) > 1 and is_tag_const(node.args[1]):
            out.append((node.args[1].lineno, node.args[1].value))
        elif isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or):
            seen_read = False
            for v in node.values:
                if _is_tag_read(v):
                    seen_read = True
                elif seen_read and is_tag_const(v):
                    out.append((v.lineno, v.value))
        elif isinstance(node, ast.Compare):
            sides = [node.left, *node.comparators]
            if any(_is_tag_read(s) for s in sides):
                out.extend((s.lineno, s.value) for s in sides if is_tag_const(s))
        elif isinstance(node, ast.Dict):
            for k, v in zip(node.keys, node.values):
                if isinstance(k, ast.Constant) and k.value == "tag" and is_tag_const(v):
                    out.append((v.lineno, v.value))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            returns = []
            stack = list(node.body)
            while stack:
                n = stack.pop()
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                    continue
                if isinstance(n, ast.Return) and is_tag_const(n.value):
                    returns.append((n.value.lineno, n.value.value))
                stack.extend(ast.iter_child_nodes(n))
            if len({v for _, v in returns}) >= 2:
                out.extend(returns)
    return sorted(set(out))


#: A cashtag GRAMMAR: a literal `$` followed by a letter class — `\$([A-Z`,
#: `\$[A-Za-z`. A price (`\$[\d.]+`) is not one.
_CASHTAG_SIGNATURE = re.compile(r"\\\$\(?\[A-Z")


def cashtag_grammars(tree) -> list[tuple]:
    """[(lineno, pattern)] for every `re.<fn>("<cashtag grammar>", ...)` call."""
    out = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name) and node.func.value.id == "re"
                and node.args and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
                and _CASHTAG_SIGNATURE.search(node.args[0].value)):
            out.append((node.lineno, node.args[0].value))
    return out


def _docstring_nodes(tree) -> set:
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                ids.add(id(body[0].value))
    return ids


def theme_file_literals(tree, filename=A8.THEMES_TAXONOMY_FILENAME) -> list[int]:
    """Line numbers of a code (non-docstring) string that IS the taxonomy file's
    name or a path ending in it — a hand-built way of locating the vocabulary."""
    docs = _docstring_nodes(tree)
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docs:
            v = node.value
            if v == filename or v.endswith("/" + filename) or v.endswith("\\" + filename):
                out.append(node.lineno)
    return sorted(out)


# ── controls: every detector can see a planted copy and cannot see a comment ─
def test_control_restated_collection_is_seen_and_a_comment_is_not():
    planted = ast.parse(
        '# TAGS = ("Earnings", "Catalyst", "Gapper", "News")\n'
        'COPY = ("Catalyst", "News")\n'
        'SUPER = ["Earnings", "Catalyst", "Gapper", "News", "Other"]\n'
        'QUOTA = {"Catalyst": 1, "Earnings": 2, "Gapper": 3, "News": 4}\n'
        'CHECKED = keyed_by(TAGS, {"Catalyst": 1, "Earnings": 2, "Gapper": 3, "News": 4})\n'
        'OTHER = {"Earnings", "Analyst", "M&A"}\n'
        '"""("Earnings", "Catalyst")"""\n'
    )
    hits = restated_collections(planted, {"catalyst_tags": A8.CATALYST_TAGS})
    assert [(ln, t) for ln, _, t in hits] == [(2, "COPY"), (3, "SUPER"), (4, "QUOTA")], hits


def test_control_bare_tag_literal_positions_are_seen():
    planted = ast.parse(
        'def tagger(c):\n'
        '    if c.get("x"):\n'
        '        return "Earnings"\n'
        '    return "News"\n'
        'def label():\n'
        '    return "News"\n'
        'a = c.get("tag", "Gapper")\n'
        'b = c.get("tag") or "Catalyst"\n'
        'd = c["tag"] == "Earnings"\n'
        'e = {"tag": "News"}\n'
        'f = c.get("other", "Gapper")\n'
        '# g = c.get("tag", "Gapper")\n'
    )
    assert bare_tag_literals(planted) == [
        (3, "Earnings"), (4, "News"), (7, "Gapper"), (8, "Catalyst"), (9, "Earnings"), (10, "News"),
    ]


def test_control_cashtag_grammar_is_seen_and_a_price_is_not():
    planted = ast.parse(
        'import re\n'
        'A = re.compile(r"\\$([A-Z]{1,5})\\b")\n'
        'B = re.compile(r"raises\\s+\\$[\\d.]+")\n'
        '# C = re.compile(r"\\$([A-Z]{1,5})\\b")\n'
        'D = re.findall(r"\\$[A-Za-z]{1,6}", t)\n'
    )
    assert [ln for ln, _ in cashtag_grammars(planted)] == [2, 5]


def test_control_theme_file_literal_is_seen_and_a_docstring_is_not():
    planted = ast.parse(
        '"""Seeded from themes_taxonomy.json."""\n'
        'P = os.path.join(root, "themes_taxonomy.json")\n'
        'Q = "/app/themes_taxonomy.json"\n'
        'R = "[themes] No themes_taxonomy.json found"\n'
        '# S = "themes_taxonomy.json"\n'
    )
    assert theme_file_literals(planted) == [2, 3]


# ── the rails ────────────────────────────────────────────────────────────────
def test_the_population_is_derived_and_not_empty():
    files = product_python_files()
    assert len(files) > 500, len(files)
    # The consumers this ticket migrated are IN the derived population (a
    # population that silently dropped them would make every rail below vacuous).
    for must in ("api/services/catalyst/tagging.py", "api/services/tweet_ticker_extract.py",
                 "api/services/theme_db.py", "api/services/alert_taxonomy/catalyst_match.py"):
        assert must in files, must


def test_no_product_module_restates_an_a8_vocabulary():
    failures = []
    for rel in product_python_files():
        tree = _parse(rel)
        if tree is None:
            continue
        for ln, vname, target in restated_collections(tree):
            if (rel, target) in FROZEN_S7_MIRRORS:
                continue
            failures.append(f"{rel}:{ln} restates {vname}"
                            + (f" as {target}" if target else "")
                            + " - read api.services.a8_taxonomy (or wrap a policy table in keyed_by)")
    assert not failures, "\n".join(failures)


def test_no_bare_catalyst_tag_literal_in_a_tag_position():
    failures = []
    for rel in product_python_files():
        tree = _parse(rel)
        if tree is None:
            continue
        for ln, val in bare_tag_literals(tree):
            failures.append(f"{rel}:{ln} bare tag literal {val!r} - use a8_taxonomy.CATALYST_TAG.{val.upper()}")
    assert not failures, "\n".join(failures)


def _cashtag_baseline() -> dict:
    doc = json.loads(CASHTAG_BASELINE_PATH.read_text(encoding="utf-8"))
    return {(e["path"], e["pattern"]): e for e in doc["grammars"]}


def test_m5_cashtag_grammar_is_declared_once():
    """A byte-copy of M5's grammar outside the authority is a restated copy, always."""
    failures = []
    for rel in product_python_files():
        tree = _parse(rel)
        if tree is None:
            continue
        for ln, pat in cashtag_grammars(tree):
            if pat == A8.CASHTAG_PATTERN:
                failures.append(f"{rel}:{ln} restates M5's cashtag grammar - use a8_taxonomy.CASHTAG_RE / cashtags()")
    assert not failures, "\n".join(failures)


def test_no_new_cashtag_grammar_and_the_baseline_only_shrinks():
    """Every OTHER cashtag grammar is a recorded, reasoned divergence (each has its
    own owner ruling). A new one fails by name; one that disappeared must leave the
    baseline in the same commit, so the ledger can only shrink."""
    baseline = _cashtag_baseline()
    for e in baseline.values():
        assert len((e.get("reason") or "").strip()) >= 20, f"{e['path']}: a baseline entry needs a reason"
    found = set()
    new = []
    for rel in product_python_files():
        tree = _parse(rel)
        if tree is None:
            continue
        for ln, pat in cashtag_grammars(tree):
            if pat == A8.CASHTAG_PATTERN:
                continue  # the rail above owns this case
            found.add((rel, pat))
            if (rel, pat) not in baseline:
                new.append(f"{rel}:{ln} introduces a cashtag grammar {pat!r} - read a8_taxonomy.CASHTAG_RE")
    stale = sorted(f"{p}  {pat!r}" for (p, pat) in set(baseline) - found)
    assert not new, "\n".join(new)
    assert not stale, "baseline entries no longer in source - remove them:\n" + "\n".join(stale)


def test_the_theme_taxonomy_file_is_located_only_by_the_authority():
    failures = []
    for rel in product_python_files():
        tree = _parse(rel)
        if tree is None:
            continue
        for ln in theme_file_literals(tree):
            failures.append(f"{rel}:{ln} locates {A8.THEMES_TAXONOMY_FILENAME} by hand - use "
                            "a8_taxonomy.themes_taxonomy_path() / THEMES_TAXONOMY_FILENAME")
    assert not failures, "\n".join(failures)


def test_s7_mirror_equals_the_authority():
    """The frozen S7 copy is pinned, not trusted: its comment said it matched the
    tagger; now a test says so, in precedence order."""
    from api.services.alert_taxonomy import catalyst_match
    assert tuple(catalyst_match.TAGS) == A8.CATALYST_TAG_PRECEDENCE


def test_the_frozen_exception_still_exists_where_recorded():
    """An exception whose subject vanished is a hole waiting for a new copy."""
    for rel, name in FROZEN_S7_MIRRORS:
        tree = _parse(rel)
        assert tree is not None, rel
        targets = [t for _, _, t in restated_collections(tree)]
        assert name in targets, f"{rel}:{name} no longer restates a vocabulary - drop the exception"


# ── the authority itself ─────────────────────────────────────────────────────
def test_authority_values():
    assert A8.CATALYST_TAG_PRECEDENCE == ("Earnings", "Catalyst", "Gapper", "News")
    assert A8.CATALYST_TAG_DISPLAY_ORDER == ("Catalyst", "Earnings", "Gapper", "News")
    assert A8.CATALYST_TAG.GAPPER == "Gapper"
    assert A8.HUNTER_CATALYST_TYPE_FALLBACK in A8.HUNTER_CATALYST_TYPES
    assert A8.THEMES_TAXONOMY_FILENAME == "themes_taxonomy.json"


def test_authority_refuses_a_malformed_file(tmp_path):
    doc = json.loads(A8.AUTHORITY_PATH.read_text(encoding="utf-8"))
    bad = json.loads(json.dumps(doc))
    bad["catalyst_tags"]["display_order"] = ["Catalyst", "Earnings", "Gapper"]
    p = tmp_path / "a8.json"
    p.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(ValueError, match="permutation"):
        A8._load(p)
    bad = json.loads(json.dumps(doc))
    bad["hunter_catalyst_types"]["fallback"] = "Nope"
    p.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(ValueError, match="fallback"):
        A8._load(p)


def test_keyed_by_refuses_a_different_key_set_and_keeps_order():
    t = {"News": 1, "Catalyst": 2, "Earnings": 3, "Gapper": 4}
    assert list(A8.keyed_by(A8.CATALYST_TAGS, t)) == ["News", "Catalyst", "Earnings", "Gapper"]
    with pytest.raises(ValueError, match="missing .*Gapper"):
        A8.keyed_by(A8.CATALYST_TAGS, {"News": 1, "Catalyst": 2, "Earnings": 3})
    with pytest.raises(ValueError, match="extra .*Mover"):
        A8.keyed_by(A8.CATALYST_TAGS, {**t, "Mover": 5})


def test_cashtags_matches_m5_behaviour():
    assert A8.cashtags("$aapl beats, $USD weak, $5 vs $0.10") == {"AAPL"}
    assert A8.cashtags(None) == set()
    assert A8.cashtags("$ABCDEF") == set()


def test_themes_taxonomy_path_is_the_repo_file():
    p = A8.themes_taxonomy_path()
    assert p is not None and Path(p).resolve() == (REPO / "themes_taxonomy.json").resolve()


# ── primary vs mentioned: the resolver ───────────────────────────────────────
def test_fixture_headline_naming_two_tickers():
    """The ticket's acceptance fixture: the subject is AMD; NVDA is only mentioned."""
    text = "$AMD jumps after $NVDA raises guidance"
    assert A8.resolve_primary(text, ["NVDA", "AMD"]) == {"NVDA": False, "AMD": True}


def test_resolver_edges():
    assert A8.resolve_primary("$aapl beats", ["AAPL"]) == {"AAPL": True}
    assert A8.resolve_primary("no cashtags here", ["AAPL", "MSFT"]) == {"AAPL": True, "MSFT": True}
    assert A8.resolve_primary("", []) == {}
    assert A8.resolve_primary(None, ["X", "X"]) == {"X": True}
    # A ticker the text never names is a mention once another one is located.
    assert A8.resolve_primary("$TSLA up", ["TSLA", "RIVN"]) == {"TSLA": True, "RIVN": False}
    # Repeats do not move the subject: first appearance wins.
    assert A8.resolve_primary("$MU and $WDC; $WDC again", ["WDC", "MU"]) == {"WDC": False, "MU": True}


def test_flag_default_is_off(monkeypatch):
    monkeypatch.delenv("A8_PRIMARY_MENTION_ENABLED", raising=False)
    assert A8.primary_mention_enabled() is False
    monkeypatch.setenv("A8_PRIMARY_MENTION_ENABLED", "1")
    assert A8.primary_mention_enabled() is True
