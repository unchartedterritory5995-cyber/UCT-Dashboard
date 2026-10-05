"""TERM-064 / FB-S2-02 — the ONE ticker resolver, railed.

What these rails prove, and what each one would catch:

1. **Parity per family, against the FROZEN code it replaced.** Every migrated family
   (AI Search query, catalyst discovery prose, RSS headlines) is run over one corpus
   by its pre-migration implementation (`tests/fixtures/ticker_resolver/`, copied
   verbatim at base 15a100749) and by the resolver. They must agree on every text
   except a CLOSED list of declared deltas, each with its reason — and a declared
   delta that no longer differs fails too, so the list cannot rot into decoration.
2. **The call sites delegate.** Each former call site returns exactly what the
   resolver returns in its context — the proof the migration is wired, not merely
   written ("prove it by moving the source").
3. **The known-ambiguous fixture.** Class shares, RS/EMA/MA/GAP/PEG: every former
   call site gives the same answer, and nothing is rewritten to a dot.
4. **An AST census that names any second resolver**, and a second that names any
   restated stop vocabulary, each against a recorded baseline that may only shrink,
   each with a control proving it can see what it looks for.
"""
from __future__ import annotations

import ast
import json
import re
import warnings
from pathlib import Path

import pytest

from api.services import ticker_resolver as R
from tests.fixtures.ticker_resolver import oracle_discovery as D
from tests.fixtures.ticker_resolver import oracle_headline as H
from tests.fixtures.ticker_resolver import oracle_query as Q

REPO = Path(__file__).resolve().parents[1]
AUTHORITY = "api/services/ticker_resolver.py"
BASELINE_PATH = Path(__file__).with_name("ticker_resolver_divergences.baseline.json")

#: A fixed universe, so parity is a fact about the code and not about today's file.
UNIVERSE = frozenset({
    "NVDA", "AMD", "AAPL", "TSLA", "AMC", "BMO", "NOW", "LOW", "MA", "PM", "COHR",
    "F", "C", "SMCI", "ALL", "DECK", "TAP", "MAIN", "CASH", "WELL", "INTC", "RKLB",
    "JPM", "GS", "RS", "EMA", "GAP", "PEG", "BRK-B", "BF-B", "GOLD", "ET", "META",
    "SNAP", "OPEN", "MU", "KYTX", "TWI", "DNOW", "CAPR",
})

CORPUS = (
    # member-typed questions (the AI Search suite's own sentences)
    "thoughts on $BRK.B?",
    "what about $BRK-B",
    "is $NVIDIA a buy",
    "$F and $C dividends",
    "what is my PM here",
    "is that happening now or later",
    "thoughts on NOW stock",
    "why is LOW moving",
    "what do you think of NVDA and $smci",
    "IS ALL OF THE MARKET UP",
    "why did COHR beat",
    "what's on deck for tomorrow?",
    "should i trim and hold cash here?",
    "is NVDA trading well above its 50-day?",
    "thoughts on nvda here?",
    "RS is breaking out",
    "RS stock looks strong",
    "$RS $EMA $MA $GAP $PEG",
    "GAP stock and EMA and PEG today",
    "MA shares after earnings",
    # model list-mode prose (the catalyst discovery pass)
    "$NVDA - earnings beat. Intel (INTC) wins contract. Rocket Lab RKLB joins index. "
    "AWS revenue up; EV demand strong; GMM rallies.",
    "$AMD - upgraded by JPM and GS analysts.",
    "analysts say buy JPM here",
    "$EUR weakens while $USD rallies; META reports AMC",
    "Reporting AMC: $TSLA; BMO: $SNAP",
    "nvda stock is up",
    # publisher headlines (the RSS pass)
    "ALERT: CAPR shares halted",
    "SK Hynix, INTC and MU rally on memory demand",
    "TWI shares slide; ITM options active",
    "GOLD prices surge as ET falls",
    "GOLD stock jumps",
    "Meta Stock Soars, Snap Shares Jump",
    "$F beats; DNOW, KYTX move",
    "FIFA USMNT LLP USA fans cheer",
    "Berkshire BRK.B holders",
    "NVDA AMD AAPL TSLA COHR SMCI INTC",
    "",
    None,
)

_SPELLING = ("ONE SPELLING: a class share is emitted in the canonical hyphen form the "
             "universe, caches, FMP and yfinance use; the dot form belongs to the Massive "
             "REST boundary only. The old answers were BRK.B (a second spelling) or BRK "
             "(a different, non-existent symbol).")
_CASHTAG = ("ONE PRECEDENCE, tier 1: a cashtag is always trusted. The headline pass had no "
            "cashtag tier and the discovery grammar was uppercase-only, so $F/$C (one "
            "letter) and $smci were silently dropped.")
_UNIVERSE_GATE = ("ONE PRECEDENCE, tier 2: a bare uppercase word must be in the cap universe. "
                  "The headline pass booked any 2-5 capital letters (ALERT, FIFA, ITM, AWS); "
                  "both of its consumers already re-validated against this same universe.")
_CUE_RESCUE = ("ONE PRECEDENCE, tier 2: a stop-listed word that IS a real ticker is reached "
               "by a strong ticker-position cue (buy JPM, GOLD stock) instead of being "
               "silently lost.")

#: (family, text) -> (pre-migration answer, resolver answer, reason). CLOSED: any
#: other disagreement fails, and an entry that stops differing fails. Measured on
#: real text before the migration: 72,039 logged AI Search queries (0 differ) and
#: 80 stored RSS items (F2 0 differ; F3 28 differ, every one a tier-2 removal of a
#: non-universe word) - see the TERM-064 results.md.
DECLARED_DELTAS: dict = {
    ("query", "thoughts on $BRK.B?"): (["BRK.B"], ["BRK-B"], _SPELLING),
    ("query", "what about $BRK-B"): (["BRK.B"], ["BRK-B"], _SPELLING),
    ("discovery_prose", "thoughts on $BRK.B?"): ({"BRK"}, {"BRK-B"}, _SPELLING),
    ("discovery_prose", "what about $BRK-B"): ({"BRK"}, {"BRK-B"}, _SPELLING),
    ("headline", "thoughts on $BRK.B?"): (["BRK"], ["BRK-B"], _SPELLING),
    ("headline", "what about $BRK-B"): (["BRK"], ["BRK-B"], _SPELLING),
    ("headline", "Berkshire BRK.B holders"): (["BRK"], [], _UNIVERSE_GATE),
    ("headline", "$F and $C dividends"): ([], ["F", "C"], _CASHTAG),
    ("headline", "$F beats; DNOW, KYTX move"): (["DNOW", "KYTX"], ["F", "DNOW", "KYTX"], _CASHTAG),
    ("discovery_prose", "what do you think of NVDA and $smci"): ({"NVDA"}, {"NVDA", "SMCI"}, _CASHTAG),
    ("headline", "what do you think of NVDA and $smci"): (["NVDA"], ["NVDA", "SMCI"], _CASHTAG),
    ("headline", CORPUS[20]): (["NVDA", "INTC", "RKLB", "AWS", "GMM"], ["NVDA", "INTC", "RKLB"], _UNIVERSE_GATE),
    ("headline", "ALERT: CAPR shares halted"): (["ALERT", "CAPR"], ["CAPR"], _UNIVERSE_GATE),
    ("headline", "SK Hynix, INTC and MU rally on memory demand"): (["SK", "INTC", "MU"], ["INTC", "MU"], _UNIVERSE_GATE),
    ("headline", "TWI shares slide; ITM options active"): (["TWI", "ITM"], ["TWI"], _UNIVERSE_GATE),
    ("headline", "FIFA USMNT LLP USA fans cheer"): (["FIFA", "USMNT", "LLP", "USA"], [], _UNIVERSE_GATE),
    ("discovery_prose", "analysts say buy JPM here"): (set(), {"JPM"}, _CUE_RESCUE),
    ("headline", "GOLD stock jumps"): ([], ["GOLD"], _CUE_RESCUE),
}


def _old(family, text):
    if family == "query":
        return Q._extract_tickers(text)
    if family == "discovery_prose":
        return D._extract_tickers_from_text(text)
    return H._extract_tickers(text)


def _new(family, text):
    if family == "query":
        return R.resolve_tickers(text, R.QUERY)
    if family == "discovery_prose":
        return set(R.resolve_tickers(text, R.DISCOVERY_PROSE))
    return R.resolve_tickers(text, R.HEADLINE)[:5]


def _call_site(family, text):
    if family == "query":
        import api.routers.ai_search as ai
        return ai._extract_tickers(text)
    if family == "discovery_prose":
        from api.services.catalyst import sources
        return sources._extract_tickers_from_text(text)
    from api.services import news_aggregator
    return news_aggregator._extract_tickers(text)


FAMILIES = ("query", "discovery_prose", "headline")


@pytest.fixture(autouse=True)
def _pinned_universe(monkeypatch):
    monkeypatch.setattr(R, "_UNI", set(UNIVERSE))
    monkeypatch.setattr(Q, "_UNI", set(UNIVERSE))
    monkeypatch.setattr(D, "UNIVERSE", set(UNIVERSE))


# ── 1. parity against the frozen code ─────────────────────────────────────────
@pytest.mark.parametrize("family", FAMILIES)
def test_parity_with_the_frozen_pre_migration_code(family):
    undeclared = []
    for text in CORPUS:
        old, new = _old(family, text), _new(family, text)
        key = (family, text)
        if key in DECLARED_DELTAS:
            want_old, want_new, _reason = DECLARED_DELTAS[key]
            assert old == want_old, f"{key}: the frozen code now answers {old!r}"
            assert new == want_new, f"{key}: the resolver now answers {new!r}"
        elif old != new:
            undeclared.append(f"{key}: {old!r} -> {new!r}")
    assert not undeclared, "undeclared behaviour change:\n" + "\n".join(undeclared)


def test_every_declared_delta_is_real_and_reasoned():
    for key, (old, new, reason) in DECLARED_DELTAS.items():
        assert key[0] in FAMILIES and key[1] in CORPUS, key
        assert old != new, f"{key} is declared but no longer differs - remove it"
        assert len(reason.strip()) >= 20, f"{key} needs a reason"


# ── 2. the call sites delegate ────────────────────────────────────────────────
@pytest.mark.parametrize("family", FAMILIES)
def test_the_former_call_site_returns_what_the_resolver_returns(family):
    for text in CORPUS:
        assert _call_site(family, text) == _new(family, text), (family, text)


def test_moving_the_source_moves_every_call_site(monkeypatch):
    """F-01's structural fix: change the authority's universe and every former call
    site follows. A call site holding its own copy would not move."""
    for family in FAMILIES:
        assert "KYTX" in set(_call_site(family, "KYTX shares rally")), family
    monkeypatch.setattr(R, "_UNI", set(UNIVERSE) - {"KYTX"})
    for family in FAMILIES:
        assert "KYTX" not in set(_call_site(family, "KYTX shares rally")), family


# ── 3. the known-ambiguous fixture ────────────────────────────────────────────
AMBIGUOUS = {
    # A class share is ONE symbol in ONE spelling, whichever way it was typed.
    "$BRK.B holders": {"BRK-B"},
    "$BRK-B holders": {"BRK-B"},
    "$bf.b and $BF-B": {"BF-B"},
    # RS/EMA/MA/GAP/PEG are real tickers: a cashtag always reaches them, untouched.
    "$RS $EMA $MA $GAP $PEG": {"RS", "EMA", "MA", "GAP", "PEG"},
}


@pytest.mark.parametrize("text,want", sorted(AMBIGUOUS.items()))
def test_every_former_call_site_gives_the_same_answer(text, want):
    answers = {family: set(_call_site(family, text)) for family in FAMILIES}
    assert all(a == want for a in answers.values()), answers


def test_a_stop_listed_real_ticker_is_reached_by_a_strong_cue_never_silently_lost():
    # QUERY stop-lists RS and MA (options jargon) and publishes the rescue: a cue.
    assert R.resolve_tickers("RS is breaking out", R.QUERY) == []
    assert R.resolve_tickers("RS stock looks strong", R.QUERY) == ["RS"]
    assert R.resolve_tickers("MA shares after earnings", R.QUERY) == ["MA"]
    # GAP is blocked only on the lowercase path; uppercase and cashtag reach it.
    assert R.resolve_tickers("buy gap here", R.QUERY) == []
    assert R.resolve_tickers("GAP stock and EMA and PEG today", R.QUERY) == ["GAP", "EMA", "PEG"]


def test_the_resolver_never_emits_the_dot_form():
    texts = [t for t in CORPUS if t] + list(AMBIGUOUS)
    for context in R.CONTEXTS:
        for text in texts:
            assert not any("." in s for s in R.resolve_tickers(text, context)), (context.name, text)


def test_the_dot_form_exists_only_at_the_massive_boundary():
    from api.services.massive import to_polygon_symbol
    assert R.canonical(" brk.b ") == "BRK-B"
    assert to_polygon_symbol(R.canonical("brk.b")) == "BRK.B"
    assert R.canonical("NVDA") == "NVDA"


def test_an_empty_universe_answers_cashtags_only_never_a_guess(monkeypatch):
    monkeypatch.setattr(R, "_UNI", set())
    for context in R.CONTEXTS:
        assert R.resolve_tickers("$NVDA and AMD and nvda stock", context) == ["NVDA"], context.name


def test_total_on_empty_and_none():
    for context in R.CONTEXTS:
        assert R.resolve_tickers(None, context) == []
        assert R.resolve_tickers("", context) == []


# ── 4. the AST census ─────────────────────────────────────────────────────────
#: The population the TERM-064 verification counted with
#: `git grep -nE "def (_)?(extract|parse|resolve)_(tickers?|symbols?)"`.
RESOLVER_NAME = re.compile(r"_?(extract|parse|resolve)_(tickers?|symbols?)")
SCAN_TOPS = ("api", "services", "tools", "scripts")


def _is_test_path(rel: str) -> bool:
    parts = rel.split("/")
    name = parts[-1]
    return (any(p in ("tests", "test", "__pycache__") for p in parts[:-1])
            or name.startswith("test_") or name.endswith("_test.py") or name == "conftest.py")


def _product_files():
    out = []
    for top in SCAN_TOPS:
        root = REPO / top
        if not root.is_dir():
            continue
        for p in root.rglob("*.py"):
            rel = p.relative_to(REPO).as_posix()
            if not _is_test_path(rel) and rel != AUTHORITY:
                out.append(rel)
    return sorted(out)


def _parse(source: str):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SyntaxWarning)
        return ast.parse(source)


def _delegates(fn) -> bool:
    for n in ast.walk(fn):
        if isinstance(n, ast.Name) and n.id in ("ticker_resolver", "resolve_tickers"):
            return True
        if isinstance(n, ast.Attribute) and n.attr == "resolve_tickers":
            return True
    return False


def resolver_defs(tree) -> list:
    """[(lineno, name)] for every function that resolves tickers WITHOUT the authority."""
    return [(n.lineno, n.name) for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and RESOLVER_NAME.match(n.name) and not _delegates(n)]


def _stop_sets() -> dict:
    # A context with no stop vocabulary (CASHTAG_POST: cashtags only) has nothing a
    # module could restate, so it is not a census subject.
    sets = {c.name: c.stop for c in R.CONTEXTS if c.stop}
    sets["lower_only"] = frozenset(R._LOWER_ONLY_STOP)
    return sets


def restated_vocabularies(tree) -> list:
    """[(lineno, context)] for every string collection that restates a stop vocabulary:
    at least 8 members shared with one context's stop words, and 60% of its own."""
    out = []
    for n in ast.walk(tree):
        if not isinstance(n, (ast.Set, ast.List, ast.Tuple)):
            continue
        vals = {e.value for e in n.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)}
        if len(vals) < 8:
            continue
        for name, stop in _stop_sets().items():
            shared = len(vals & stop)
            if shared >= 8 and shared / len(vals) >= 0.6:
                out.append((n.lineno, name))
    return out


def _baseline():
    doc = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    for section in ("functions", "vocabularies"):
        for e in doc[section]:
            assert len((e.get("reason") or "").strip()) >= 20, f"{e['path']}: a baseline entry needs a reason"
    return ({(e["path"], e["name"]) for e in doc["functions"]},
            {(e["path"], e["context"]) for e in doc["vocabularies"]})


def test_control_the_census_sees_a_second_resolver_and_not_a_delegator():
    planted = _parse(
        "import re\n"
        "def _extract_tickers(text):\n"
        "    return re.findall(r'[A-Z]{2,5}', text)\n"
        "def _extract_tickers_from_text(text):\n"
        "    return set(ticker_resolver.resolve_tickers(text))\n"
        "class K:\n"
        "    def parse_symbols(self, raw):\n"
        "        return raw.split(',')\n"
        "def extract_prices(text):\n"
        "    return []\n"
    )
    assert resolver_defs(planted) == [(2, "_extract_tickers"), (7, "parse_symbols")]


def test_control_the_census_sees_a_restated_vocabulary():
    planted = _parse("STOP = " + repr(sorted(R._TICKER_STOP)[:12]) + "\nOK = ['a', 'b', 'c']\n")
    assert restated_vocabularies(planted) == [(1, "query")]


def test_no_second_resolver_and_the_baseline_only_shrinks():
    functions, _ = _baseline()
    found, new = set(), []
    for rel in _product_files():
        try:
            tree = _parse((REPO / rel).read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for ln, name in resolver_defs(tree):
            found.add((rel, name))
            if (rel, name) not in functions:
                new.append(f"{rel}:{ln} {name}() resolves tickers itself - call ticker_resolver.resolve_tickers")
    assert found, "the census found nothing at all - the scan is broken, not the repo clean"
    stale = sorted(f"{p} {n}" for p, n in functions - found)
    assert not new, "\n".join(new)
    assert not stale, "baseline entries no longer in source - remove them:\n" + "\n".join(stale)


def test_no_restated_stop_vocabulary_and_the_baseline_only_shrinks():
    _, vocabularies = _baseline()
    found, new = set(), []
    for rel in _product_files():
        try:
            tree = _parse((REPO / rel).read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for ln, context in restated_vocabularies(tree):
            found.add((rel, context))
            if (rel, context) not in vocabularies:
                new.append(f"{rel}:{ln} restates the {context!r} stop vocabulary - read ticker_resolver")
    assert found, "the vocabulary scan found nothing at all - it is broken, not the repo clean"
    stale = sorted(f"{p} {c}" for p, c in vocabularies - found)
    assert not new, "\n".join(new)
    assert not stale, "baseline entries no longer in source - remove them:\n" + "\n".join(stale)


def test_the_authority_is_where_the_census_says_it_is():
    """The authority holds every vocabulary the census compares against, so the
    exemption for its own path is not hiding a copy somewhere else."""
    tree = _parse((REPO / AUTHORITY).read_text(encoding="utf-8"))
    assert {c for _, c in restated_vocabularies(tree)} == set(_stop_sets())
