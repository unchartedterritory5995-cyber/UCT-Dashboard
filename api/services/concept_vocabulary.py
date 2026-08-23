"""The Python half of the concept vocabulary.

⭐ THIS MODULE OWNS NO VOCABULARY, exactly as ``ast_table`` owns none. It reads
``conceptVocabulary.json`` — the same bytes the browser imports — and RESOLVES
each concept's citations against the artifacts they name. It is the reader, not
the author, and every word, every threshold and every citation lives in the
file so that a change to what "trending" means is a diff somebody reviews.

⛔ THE FILE IS DATA FOR THE SAME REASON ``closedTable.json`` IS. A vocabulary
carried in prompt text is a vocabulary only one lane can see, and this repo has
now paid four times for two spellings of one fact (``williams_r`` vs
``williamsR``; ``60``/``65`` columns; "third"/"fourth" section; an acceptance
test corrected twice and still unparseable). One file, both lanes, one diff.

⭐⭐ WHAT MAKES THIS A VOCABULARY RATHER THAN AN OPINION — and it is the whole
point of the task:

  1. **Every concept cites a firm artifact that already exists**, and the
     citation is RESOLVED here rather than trusted. Five kinds, five lookups:
     a preset in ``screener/filters.py::FILTERS``; a shipped screen in
     ``screener/saved_screens.py::starters()``; a column the closed table
     declares as a scalar; a labelled branch of firm code, located by AST; and
     the firm's own PUBLISHED DEFINITION of a setup, in the Setup Library's
     ``setupCatalog.js`` — see ``_resolve_setup_catalog`` for what that fifth
     kind proves, what it deliberately does not, and why it can only ever
     ground a tree that states no number at all.
  2. **No number in a concept's tree may be the author's.** Every numeric
     literal must be derivable from the concept's own citations, and every
     scalar the tree names must be one a citation names. ``rs_rank >= 80`` is
     here because the firm ships a preset labelled ``Over 80``; ``75`` would be
     red because ``75`` is nobody's published threshold.
  3. **A word the firm cannot ground is refused BY NAME**, never approximated,
     and the refusal repeats the word so a member can say what they meant
     instead of being handed somebody's guess. A wrong scan that looks right is
     worse than a refusal (spec §1.6).
  4. **The expansion is the tree, and the word is provenance.** ``resolve``
     hands back ``source`` and ``ast``; a caller stores the TREE. A stored
     ``{"concept": "trending"}`` would make every saved scan a late binding to a
     vocabulary that moves — and ``def_hash`` would stop meaning the maths.

⚠️ NO PARSER LIVES HERE, EVER (decision D-A1, and this module inherits it). The
``ast`` beside each ``source`` was produced by ``parse.js::parseFormula`` and is
asserted byte-equal to a fresh parse in ``conceptVocabulary.test.js``. Python
walks the tree it did not build. A Python parse here would be a second grammar.

⚠️ NO READ-BACK LIVES HERE EITHER. ``sentence.js`` is the ONE producer of the
text a member confirms; a concept's frozen ``sentence`` is its output and this
module hands it back BYTE FOR BYTE — it does not prettify it, does not fall back
to the word, and does not synthesise one for a concept that carries none. Until
``56a2bca6`` the read-back could not say a table-declared SCALAR, so 19 of the
concepts carried no sentence at all (see ``_sentence_gap`` in the manifest, which
records that gap and its closing); the tri-state that made possible is kept
rather than tightened, because "the shipped module cannot say this tree" is
``sentence.js``'s answer to give and not this reader's to assume.

⚠️ NO CONDITION CHECK LIVES HERE. Whether a tree is a 0/1 condition is
``scan_definition.is_boolean_tree``'s question (E-2, CORRECTION 2's single
Python derivation off the manifest's ``yields``). This module deliberately does
not answer it — the vocabulary's own test asserts each concept's root yields
``bool`` by reading ``ast_table.yields_of`` directly, so there is no second
implementation here to drift from E-2's.
"""
from __future__ import annotations

import ast as pyast
import inspect
import io
import json
import pathlib
import re
from types import MappingProxyType
from typing import Any, Iterable, Mapping, Optional, Set

from api.services import ast_table

#: The vocabulary, resolved from THIS FILE rather than from a working directory
#: — ``ast_table.MANIFEST_PATH``'s shape, for its reason: a path resolved from
#: ``os.getcwd()`` silently finds nothing when the suite is driven from another
#: directory, and a lane that silently found no vocabulary would report a
#: passing grounding rail over an empty file.
VOCAB_PATH: pathlib.Path = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app" / "src" / "components" / "chart" / "engine" / "ast"
    / "conceptVocabulary.json"
)

#: Where the firm's setup taxonomy lives. Read, never copied — AMENDMENT 2
#: restated its size twice and was wrong both times, so nothing here counts it.
SETUP_GROUPS_PATH: pathlib.Path = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app" / "src" / "constants" / "setupGroups.js"
)

#: Where the firm PUBLISHES WHAT EACH SETUP IS — the Setup Library's field guide,
#: rendered to members at ``/model-book`` → Setups (``SetupsView.jsx`` shows the
#: ``essence`` on the card, in the rail and in its search). ``setupGroups.js``
#: above is a list of NAMES and says nothing about any shape; this file is the
#: one place the firm writes the definition down.
#:
#: ⚠️ ``starter_library`` ALSO reads this file, for its ``taxonomy_conflict``
#: report, with a names-only regex of its own. Two readers of one file is one
#: too many unless they are pinned to each other, and they are: the starter
#: library's tests assert both this constant and the NAME SET agree with that
#: module's. It is read here rather than there because a citation kind lives
#: where citations are resolved.
SETUP_CATALOG_PATH: pathlib.Path = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app" / "src" / "pages" / "modelbook" / "setupCatalog.js"
)

#: Structure keys of the vocabulary. These name the dictionaries, never a word
#: inside one.
VOCAB_VERSION_KEY = "version"
CONCEPTS_KEY = "concepts"
REFUSED_KEY = "_refused"

#: The citation kinds, each with a lookup below. A NEW kind is a DECISION — it
#: means a new class of firm artifact is being treated as authoritative — so an
#: unknown kind refuses rather than being ignored.
#:
#: ⭐ ``setup_catalog`` WAS THAT DECISION, TAKEN 2026-08-23, and it is recorded
#: here because the first four kinds all answer "who published this NUMBER?"
#: while it answers a different question: "who says this SHAPE is that setup?"
#: A literal-free formula states no number, so the first four have nothing to
#: discharge and the tree's only assertion is an IDENTITY. See
#: ``_resolve_setup_catalog``.
GROUNDING_KINDS = ("filter_preset", "starter_screen", "scalar", "classifier",
                   "setup_catalog")

#: The two refusal gates, in the concierge's existing gate-attribution style.
#: ``ambiguous`` is a word the file has DECIDED not to ground and says why;
#: ``ungrounded`` is everything else, including a shipped concept whose citation
#: has rotted. Disjoint on purpose: "we will not guess" and "we no longer can"
#: are different answers and a member deserves to know which one they hit.
GATE_AMBIGUOUS = "concept:ambiguous"
GATE_UNGROUNDED = "concept:ungrounded"


def _thaw(value: Any) -> Any:
    """A plain, mutable, JSON-serialisable copy of a frozen subtree.

    ⭐ THE EXPANSION IS HANDED OVER BY VALUE, and that is the whole of AMENDMENT
    1 consequence 1 in one function. A caller that received the frozen shared
    tree would be holding a reference into a file that moves; a caller holding a
    copy is holding maths. It is also what makes the tree storable at all —
    ``json.dumps`` refuses a ``mappingproxy``.
    """
    if isinstance(value, Mapping):
        return {k: _thaw(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_thaw(v) for v in value]
    return value


def _freeze(value: Any) -> Any:
    """Deep-freeze a decoded vocabulary. ``ast_table._freeze``'s reason: a
    mutable module-level table is a second grammar waiting to happen."""
    if isinstance(value, dict):
        return MappingProxyType({k: _freeze(v) for k, v in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(v) for v in value)
    return value


def load(path: Optional[pathlib.Path] = None) -> Mapping[str, Any]:
    """Read the concept vocabulary off disk and freeze it.

    ``io.open(..., encoding='utf-8')`` ALWAYS — a bare ``open()`` decodes as
    cp1252 on this box and has already killed a sibling harness mid-run.
    """
    p = pathlib.Path(path) if path is not None else VOCAB_PATH
    if not p.exists():
        raise FileNotFoundError(
            f"the concept vocabulary is missing at {p}. It is committed under "
            "app/ beside the closed table, and this lane READS it rather than "
            "owning a copy."
        )
    with io.open(p, encoding="utf-8") as fh:
        doc = json.load(fh)
    for key in (VOCAB_VERSION_KEY, CONCEPTS_KEY, REFUSED_KEY):
        if key not in doc:
            raise ValueError(
                f"{p} has no {key!r}. A vocabulary with no version cannot make a "
                "definition change an event; one with no refusal list cannot say "
                "no by name."
            )
    return _freeze(doc)


#: The frozen vocabulary. Read once, at import, from the SAME file the browser
#: imports.
VOCAB: Mapping[str, Any] = load()


def concepts(vocab: Optional[Mapping[str, Any]] = None) -> Mapping[str, Any]:
    """Every grounded word the vocabulary declares."""
    v = vocab if vocab is not None else VOCAB
    return v.get(CONCEPTS_KEY) or {}


def refused(vocab: Optional[Mapping[str, Any]] = None) -> Mapping[str, str]:
    """Words the vocabulary has DECIDED not to ground, each with its reason.

    ⭐ A DECLARED REFUSAL IS A FEATURE, NOT AN OMISSION. "cheap" is not missing
    because nobody got to it; it is here because the firm's own screen that uses
    the word bundles three different measures, so the word alone does not say
    which one — and inventing a P/E threshold would be an unmeasured accuracy
    claim wearing a helpful face.
    """
    v = vocab if vocab is not None else VOCAB
    return v.get(REFUSED_KEY) or {}


def version(vocab: Optional[Mapping[str, Any]] = None) -> str:
    v = vocab if vocab is not None else VOCAB
    return v[VOCAB_VERSION_KEY]


def normalise(word: Any) -> str:
    """The one spelling rule, applied at every door.

    Lower-cased and internally single-spaced, so "Leaders Pulling  Back" and
    "leaders pulling back" are one key rather than two entries that drift.
    """
    return re.sub(r"\s+", " ", str(word or "").strip()).lower()


# --------------------------------------------------------------------------- #
# walking a frozen tree
# --------------------------------------------------------------------------- #

def names_in(tree: Any) -> Set[str]:
    """Every table name the tree spells: series/scalar leaves, operators, calls.

    ⛔ THE CHECK THAT USES THIS COMPARES AGAINST ``ast_table.declared_names()``,
    which is derived from the manifest. A concept referencing a name the table
    lost must go red — hand-listing the legal names here would be the very
    second-vocabulary defect the closed table exists to prevent.
    """
    out: Set[str] = set()
    stack = [tree]
    while stack:
        node = stack.pop()
        if not isinstance(node, Mapping):
            continue
        kind = node.get("type")
        if kind in ("series", "op", "call"):
            name = node.get("name")
            if isinstance(name, str):
                out.add(name)
        for arg in node.get("args") or ():
            stack.append(arg)
    return out


def scalars_in(tree: Any, table: Optional[Mapping[str, Any]] = None) -> Set[str]:
    """The declared SCALARS the tree names. A scalar rides the ``series`` node
    type (manifest ``_scalars_node``), so the partition comes from the table."""
    return names_in(tree) & ast_table.scalar_names(table)


def literals_in(tree: Any) -> Set[float]:
    """Every numeric literal in the tree, SIGN-FOLDED.

    ⚠️ ``-3`` CANONICALISES TO ``u-`` OVER ``num 3``, so a naive walk reports
    ``3`` and a citation declaring ``-3`` would never match it. Folding happens
    ONLY when the operand is a literal: ``-(a + b)`` keeps its inner numbers
    positive, because pushing the sign inside a sum would invent a threshold
    nobody wrote and fail a concept that is perfectly well grounded.
    """
    out: Set[float] = set()

    def walk(node: Any) -> None:
        if not isinstance(node, Mapping):
            return
        if node.get("type") == "num":
            out.add(float(node.get("value")))
            return
        args = node.get("args") or ()
        if (node.get("type") == "op" and node.get("name") == "u-"
                and len(args) == 1 and isinstance(args[0], Mapping)
                and args[0].get("type") == "num"):
            out.add(-float(args[0].get("value")))
            return
        for arg in args:
            walk(arg)

    walk(tree)
    return out


# --------------------------------------------------------------------------- #
# the firm's setup taxonomy
# --------------------------------------------------------------------------- #

_SETUPS_BLOCK = re.compile(r"setups\s*:\s*\[(.*?)\]", re.DOTALL)
_SETUP_NAME = re.compile(r"'([^']+)'")


def firm_setups(path: Optional[pathlib.Path] = None) -> frozenset:
    """The firm's setup names, READ from ``setupGroups.js``.

    ⛔ DERIVED, NEVER COPIED, AND THE COUNT IS NEVER RESTATED. AMENDMENT 2 said
    "31 named setups across 4 families", corrected itself to 32, and conflated
    two separate files while doing it. A reader cannot rot that way; a copy can,
    and silently.

    Raises rather than returning an empty set: a moved or renamed file would
    otherwise make every attribution "not a firm setup" — a red that names the
    wrong thing.
    """
    p = pathlib.Path(path) if path is not None else SETUP_GROUPS_PATH
    if not p.exists():
        raise FileNotFoundError(
            f"the firm's setup taxonomy is missing at {p}; attribution is "
            "checked against it and cannot be checked against nothing."
        )
    with io.open(p, encoding="utf-8") as fh:
        src = fh.read()
    names: Set[str] = set()
    for block in _SETUPS_BLOCK.findall(src):
        names |= set(_SETUP_NAME.findall(block))
    if not names:
        raise ValueError(
            f"{p} yielded no setup names. Its shape changed; the attribution "
            "check is reading nothing and would pass vacuously."
        )
    return frozenset(names)


# --------------------------------------------------------------------------- #
# the firm's PUBLISHED DEFINITIONS of its setups
# --------------------------------------------------------------------------- #

#: The array this reads, scoped first so nothing outside it can be mistaken for
#: an entry, and the entry/field shapes inside it. ⛔ DERIVED, NEVER COPIED, and
#: no count of the entries is written anywhere in this module.
_CATALOG_BLOCK = re.compile(
    r"export const SETUP_CATALOG\s*=\s*\[(.*?)\n\]", re.DOTALL)
_CATALOG_ENTRY = re.compile(
    r"\{\s*(?://[^\n]*\n\s*)?name:\s*'([^']+)'(.*?)\n\s*\},", re.DOTALL)
_CATALOG_PIVOT = re.compile(r"pivot:\s*\{[^}]*side:\s*'([^']+)'")

#: The fields an entry must carry for a citation to resolve against it. The
#: glyph fields (``candles``, ``emas``, ``trend``) are drawing instructions and
#: are deliberately not read: nothing here should depend on how a sketch is
#: shaped.
_CATALOG_FIELDS = ("family", "direction", "essence")


def setup_definitions(path: Optional[pathlib.Path] = None) -> Mapping[str, Mapping[str, Any]]:
    """``{name: {name, family, direction, essence, pivot}}`` from ``setupCatalog.js``.

    ⛔ READ, NEVER RESTATED — ``firm_setups``' rule, for its reason. And it
    RAISES rather than returning an empty mapping: a moved file or a changed
    shape would otherwise make every definition citation refuse with "the Setup
    Library publishes no definition of X", which is a red that names the wrong
    thing and would be read as a finding about the setup.
    """
    p = pathlib.Path(path) if path is not None else SETUP_CATALOG_PATH
    if not p.exists():
        raise FileNotFoundError(
            f"the firm's setup definitions are missing at {p}; a definition "
            "citation is resolved against them and cannot be resolved against "
            "nothing.")
    with io.open(p, encoding="utf-8") as fh:
        src = fh.read()
    block = _CATALOG_BLOCK.search(src)
    if not block:
        raise ValueError(
            f"{p} declares no SETUP_CATALOG array. Its shape changed; every "
            "definition citation would refuse for the wrong reason.")
    out: dict[str, dict] = {}
    for name, body in _CATALOG_ENTRY.findall(block.group(1)):
        entry = {"name": name}
        for field in _CATALOG_FIELDS:
            found = re.search(field + r":\s*'([^']*)'", body)
            if not found or not found.group(1).strip():
                raise ValueError(
                    f"{p}: the entry for {name!r} declares no {field!r}. Its "
                    "shape changed, and a citation resolved against a "
                    "half-read entry would pass on the half that survived.")
            entry[field] = found.group(1)
        pivot = _CATALOG_PIVOT.search(body)
        entry["pivot"] = pivot.group(1) if pivot else None
        out[name] = entry
    if not out:
        raise ValueError(
            f"{p} yielded no setup definitions. Its shape changed; the "
            "definition check is reading nothing and would refuse everything.")
    return out


def _prose(text: Any) -> str:
    """One spelling rule for PROSE, applied to both sides of every quote check.

    ⚠️ THE SMART QUOTE IS THE WHOLE REASON THIS EXISTS. The Setup Library is
    authored prose and writes ``day’s`` with U+2019; a citation typed with an
    ASCII apostrophe would refuse against a definition that had not moved a
    character, and the next author would "fix" it by loosening the check. So
    the curly quotes and the long dashes are folded, whitespace is collapsed
    and case is dropped — and NOTHING else is, because every further
    normalisation is a word a citation would no longer have to get right.
    """
    s = str(text or "")
    for pair in ("’'", "‘'", '“"', '”"', "—-", "–-"):
        s = s.replace(pair[0], pair[1])
    return re.sub(r"\s+", " ", s).strip().casefold()


# --------------------------------------------------------------------------- #
# resolving one citation
# --------------------------------------------------------------------------- #

class _CitationFailed(Exception):
    """A citation that no longer resolves. Carries the sentence a member sees."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def _numbers(values: Iterable[Any]) -> Set[float]:
    out: Set[float] = set()
    for v in values:
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float)):
            out.add(float(v))
    return out


def _preset_values(preset: Mapping[str, Any]) -> Set[float]:
    return _numbers(preset.get(k) for k in ("min", "max", "value"))


def _filters_registry() -> Mapping[str, Any]:
    #: Imported lazily so this module stays cheap and side-effect free at import.
    from api.services.screener import filters as screener_filters  # noqa: PLC0415
    return screener_filters.FILTERS


def _resolve_filter_preset(cite: Mapping[str, Any]) -> dict:
    """A preset in the firm's own filter registry: the label AND the number."""
    key, label = cite.get("key"), cite.get("preset")
    registry = _filters_registry()
    entry = registry.get(key)
    if entry is None:
        raise _CitationFailed(
            f"the screener no longer declares a filter called {key!r}")
    matches = [p for p in entry.get("presets") or () if p.get("label") == label]
    if not matches:
        raise _CitationFailed(
            f"the {key!r} filter no longer ships a preset labelled {label!r} "
            f"(it ships {sorted(p.get('label') for p in entry.get('presets') or ())})")
    preset = matches[0]
    if "op" not in preset:
        raise _CitationFailed(
            f"the {key!r} preset {label!r} declares no comparison, so it states "
            "no threshold this concept could be quoting")
    return {"values": _preset_values(preset), "keys": {entry.get("column")},
            "detail": f"{key} {preset.get('op')} "
                      f"{preset.get('min', preset.get('max', preset.get('value')))}"}


def _resolve_starter_screen(cite: Mapping[str, Any]) -> dict:
    """A screen the firm SHIPS, quoted term for term."""
    from api.services.screener import saved_screens  # noqa: PLC0415
    wanted = cite.get("screen")
    screens = {s.get("id"): s for s in saved_screens.starters()}
    screen = screens.get(wanted)
    if screen is None:
        raise _CitationFailed(
            f"the screener no longer ships a starter screen called {wanted!r} "
            f"(it ships {sorted(screens)})")
    registry = _filters_registry()
    values: Set[float] = set()
    keys: Set[str] = set()
    for f in screen.get("spec", {}).get("filters") or ():
        entry = registry.get(f.get("key"))
        if entry is None:
            raise _CitationFailed(
                f"starter screen {wanted!r} filters on {f.get('key')!r}, which "
                "the filter registry no longer declares")
        keys.add(entry.get("column"))
        values |= _numbers(f.get(k) for k in ("min", "max", "value"))
    return {"values": values, "keys": keys,
            "detail": f"{screen.get('name')!r} ({wanted})"}


def _resolve_scalar(cite: Mapping[str, Any],
                    table: Optional[Mapping[str, Any]] = None) -> dict:
    """A column the screener already computes nightly and the table declares."""
    column = cite.get("column")
    if column not in ast_table.scalar_names(table):
        raise _CitationFailed(
            f"the closed table no longer declares a scalar called {column!r}")
    manifest = table if table is not None else ast_table.TABLE
    entry = manifest[ast_table.SCALARS_SECTION][column]
    #: ⭐ THE DETAIL IS THE MANIFEST'S OWN ENGLISH, not a phrase written here.
    #: The scalar already declares what it means; repeating that in this file
    #: would be the second vocabulary in miniature.
    return {"values": {0.0, 1.0}, "keys": {column},
            "detail": f"{column}: {entry.get('sentence')}"}


def _function_node(module_name: str, func_name: str) -> pyast.FunctionDef:
    import importlib  # noqa: PLC0415
    try:
        module = importlib.import_module(module_name)
    except Exception as exc:  # noqa: BLE001
        raise _CitationFailed(f"{module_name} no longer imports ({exc})") from exc
    try:
        src = inspect.getsource(module)
    except OSError as exc:  # pragma: no cover - source always present in-repo
        raise _CitationFailed(f"{module_name} has no readable source") from exc
    for node in pyast.walk(pyast.parse(src)):
        if isinstance(node, pyast.FunctionDef) and node.name == func_name:
            return node
    raise _CitationFailed(
        f"{module_name} no longer defines a function called {func_name!r}")


def _resolve_classifier(cite: Mapping[str, Any]) -> dict:
    """A labelled branch of firm code, located BY AST rather than by grep.

    ⭐ THIS IS HOW A CONCEPT QUOTES A CLASSIFICATION THE TABLE CANNOT NAME.
    ``ma_stack`` is a TEXT column and therefore excluded from the closed table,
    so "trending" cannot say ``ma_stack == 'full-bull'`` — it has to say the
    comparison chain that PRODUCES that label. Citing the branch is what keeps
    the two in step: rename the label or retune a window and this goes red.
    """
    module_name = cite.get("module")
    func = _function_node(module_name, cite.get("function"))
    labels = {n.value for n in pyast.walk(func)
              if isinstance(n, pyast.Constant) and isinstance(n.value, str)}
    if cite.get("label") not in labels:
        raise _CitationFailed(
            f"{module_name}.{cite.get('function')} no longer produces the label "
            f"{cite.get('label')!r}")
    wanted = set(cite.get("windows_from") or ())
    windows: Set[float] = set()
    for node in pyast.walk(func):
        if not isinstance(node, pyast.Call):
            continue
        target = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
        if target not in wanted:
            continue
        for arg in node.args:
            if isinstance(arg, pyast.Constant) and isinstance(arg.value, (int, float)) \
                    and not isinstance(arg.value, bool):
                windows.add(float(arg.value))
    if wanted and not windows:
        raise _CitationFailed(
            f"{module_name}.{cite.get('function')} no longer passes any window "
            f"to {sorted(wanted)}, so this concept's periods are quoting nothing")
    return {"values": windows, "keys": set(),
            "detail": f"{module_name}.{cite.get('function')} -> {cite.get('label')!r}"}


def _resolve_setup_catalog(cite: Mapping[str, Any],
                           setup: Optional[str]) -> dict:
    """THE FIRM'S OWN PUBLISHED DEFINITION of the setup this tree is attributed to.

    ⭐⭐ WHY A FIFTH KIND EXISTS AT ALL, and it is the only argument that
    justifies one. Grounding is here so a starter cannot assert a number the
    firm never published. A LITERAL-FREE formula asserts no number — the
    invented-threshold check has nothing to reject and the cited-column check
    has nothing to name — and what it does assert is an IDENTITY: *this shape is
    that setup*. The four older kinds cannot answer that, because a preset, a
    screen, a column and a classifier branch all publish NUMBERS. The artifact
    that can is the firm's own written definition of the setup, which it
    publishes in the Setup Library and shows to members.

    ⛔ AND IT PUBLISHES NOTHING — ``values`` and ``keys`` come back EMPTY, on
    purpose and permanently. That is what keeps this from being a loophole: a
    tree grounded only by a definition may contain no numeric literal and may
    screen on no table-declared scalar, because there is nothing for those two
    checks to draw on. A definition can vouch for a SHAPE and can never launder
    a threshold. Anything numeric still needs a preset, a screen or a
    classifier beside it, exactly as before.

    ⛔ THE CITATION DOES NOT NAME THE SETUP, and cannot. It resolves against the
    entry the ATTRIBUTION names — the starter library's attribution is the
    catalogue entry's own KEY — so it is structurally impossible for a starter
    filed under one setup to be grounded in another setup's definition. A
    ``setup`` field on the citation would reintroduce exactly that, which is why
    ``test_the_ATTRIBUTION_is_the_ENTRY_KEY…`` forbids the key outright.

    FOUR THINGS IT PROVES, each refusing BY NAME:

      1. the Setup Library still publishes a definition under that setup's name
         — which also forces the two setup taxonomies to AGREE for this name,
         since the attribution is checked against ``setupGroups.js``;
      2. the firm still publishes it in the DIRECTION the citation claims — a
         re-classified setup takes a long-side tree down with it;
      3. every phrase the citation QUOTES is still in the published definition,
         verbatim (modulo ``_prose``) — a reworded definition goes red rather
         than leaving a tree standing on words the firm no longer writes;
      4. those phrases SINGLE THIS SETUP OUT — no other definition the firm
         publishes contains them all. This is the tooth that separates "the
         entry describes this shape" from "some file mentions the word": quote
         something generic and the refusal names the setups it collides with.

    ⚠️ AND ONE THING IT DOES NOT PROVE, stated plainly so nobody later mistakes
    it for more: that the quoted words MEAN this tree. Reading "a gap below the
    prior day's low" as ``open < low[1]`` is a human judgement made in review,
    and the mechanical guarantee is only the negative one — if the definition
    moves, this goes red. That is the same division of labour every other kind
    already runs on (nothing proves ``Remount``'s first clause is the classifier
    it cites either), and it is why a definition citation is reviewed rather
    than merely written.
    """
    if not setup:
        raise _CitationFailed(
            "cites the firm's published definition of a setup while being "
            "attributed to no setup, so there is no entry to resolve it "
            "against; a definition citation reads the attribution's name and "
            "never one of its own")
    defs = setup_definitions()
    entry = defs.get(setup)
    if entry is None:
        raise _CitationFailed(
            f"the Setup Library publishes no definition of {setup!r}, so the "
            "firm has written down no shape for this citation to quote (it "
            f"publishes {sorted(defs)})")

    declared_direction = cite.get("direction")
    if declared_direction != entry["direction"]:
        raise _CitationFailed(
            f"the Setup Library publishes {setup!r} as a "
            f"{entry['direction']!r} setup, not the {declared_direction!r} this "
            "citation claims")

    phrases = [p for p in (cite.get("describes") or ()) if str(p).strip()]
    if not phrases:
        raise _CitationFailed(
            f"this citation quotes nothing from the Setup Library's definition "
            f"of {setup!r}, so it attests that the name exists and nothing "
            "whatever about the shape being screened")

    essence = _prose(entry["essence"])
    for phrase in phrases:
        if _prose(phrase) not in essence:
            raise _CitationFailed(
                f"the Setup Library's definition of {setup!r} no longer says "
                f"{str(phrase)!r} — it says {entry['essence']!r}")

    collides = sorted(
        name for name, other in defs.items()
        if name != setup
        and all(_prose(p) in _prose(other["essence"]) for p in phrases))
    if collides:
        raise _CitationFailed(
            f"the phrases this citation quotes also describe {collides}, so "
            f"they do not single {setup!r} out of the definitions the firm "
            "publishes and cannot vouch for this shape being that setup")

    level = cite.get("level")
    if level is not None and level != entry["pivot"]:
        raise _CitationFailed(
            f"the Setup Library draws {setup!r}'s trigger line at "
            f"{entry['pivot']!r}, not the {level!r} this citation claims")

    #: ⭐ THE DETAIL IS THE ARTIFACT'S OWN ENGLISH — ``_resolve_scalar``'s rule.
    #: The firm already wrote what this setup is; restating it here in other
    #: words would be the second vocabulary in miniature.
    return {"values": set(), "keys": set(),
            "detail": f"{setup} ({entry['family']}) — the Setup Library's "
                      f"published definition: {entry['essence']}"}


def _resolve_citation(cite: Mapping[str, Any],
                      table: Optional[Mapping[str, Any]] = None,
                      *, attributed: Optional[str] = None) -> dict:
    kind = cite.get("kind")
    if kind == "filter_preset":
        out = _resolve_filter_preset(cite)
    elif kind == "starter_screen":
        out = _resolve_starter_screen(cite)
    elif kind == "scalar":
        out = _resolve_scalar(cite, table)
    elif kind == "classifier":
        out = _resolve_classifier(cite)
    elif kind == "setup_catalog":
        out = _resolve_setup_catalog(cite, attributed)
    else:
        raise _CitationFailed(
            f"{kind!r} is not a grounding kind this reader resolves "
            f"({', '.join(GROUNDING_KINDS)}). A fifth kind is a decision about "
            "what counts as the firm's answer, not an implementation detail.")
    out["kind"] = kind
    out["cite"] = dict(cite)
    return out


def _resolve_attribution(attribution: Mapping[str, Any]) -> dict:
    """The SECOND attestation: a named firm setup.

    ⛔ NEVER A GROUNDING. A playbook is prose — it can say a setup is a pullback
    to a rising average, but it cannot mechanically produce a tree. So it can
    attribute a concept and not ground one, and a concept whose only support was
    an attribution would be an unmeasured claim.

    ⚠️ TWO CHECKS, AND ONLY ONE OF THEM RUNS EVERYWHERE. The setup name is
    checked against the firm's taxonomy on every box. The KB check runs only
    where the Brain Pack is installed — ``brain_service`` NEVER raises, it
    returns ``{"ok": False, "error": "brain not available"}`` — so an
    uninstalled pack yields ``playbook_verified: None``. That is REPORTED, not
    patched around, and it must never be mistaken for a pass.
    """
    from api.services import brain_service  # noqa: PLC0415
    setup = attribution.get("setup")
    if setup not in firm_setups():
        raise _CitationFailed(
            f"{setup!r} is not one of the firm's setups; attribution must name a "
            "setup the taxonomy actually declares")
    if not brain_service.available():
        return {"setup": setup, "playbook_verified": None,
                "detail": "brain pack not installed on this box; the KB half of "
                          "this attribution is UNVERIFIED, not verified"}
    answer = brain_service.lookup_playbook(setup)
    if answer.get("ok") is not True:
        raise _CitationFailed(
            f"the KB no longer resolves a playbook for {setup!r} "
            f"({answer.get('reason') or answer.get('error')})")
    return {"setup": setup, "playbook_verified": True,
            "detail": answer.get("source") or setup}


# --------------------------------------------------------------------------- #
# resolve
# --------------------------------------------------------------------------- #

def _refuse(gate: str, reason: str) -> dict:
    #: ⛔ NO PARTIAL EXPANSION IN A REFUSAL. Not `source`, not `ast`, not a
    #: "closest match". A member who asked for something the firm cannot ground
    #: gets a sentence naming their word, and nothing they could mistake for an
    #: answer.
    return {"ok": False, "gate": gate, "reason": reason}


def resolve_grounding(tree: Any, citations: Any, *,
                      attribution: Optional[Mapping[str, Any]] = None,
                      table: Optional[Mapping[str, Any]] = None) -> dict:
    """Is this TREE the firm's answer? Resolve its citations and prove its numbers.

    ⭐ THE GROUNDING IDIOM, EXTRACTED SO THERE IS EXACTLY ONE OF IT. E-5a wrote
    this discipline for a vernacular WORD; E-8's starter library needs the same
    discipline for a named SETUP, and the phase's own sequencing note says why it
    is one function rather than two: *"the same SETUP_GROUPS + lookup_playbook
    grounding serves both and building it twice is the defect."* A second copy
    would agree with this one on the day it was written and drift on the day a
    citation kind, a sign-folding rule or a refusal sentence moved — and the two
    callers would then disagree about what "grounded" means while both were
    green.

    Returns ``{"ok": True, "grounding": [...], "attribution": {...} | None}`` or
    ``{"ok": False, "detail": "<the rest of the sentence>"}``.

    ⛔ THE REFUSAL IS RETURNED AS A SENTENCE **TAIL**, and that is deliberate. The
    caller owns the subject — a concept says ``"cheap" …``, a starter says
    ``High Tight Flag (Powerplay) …`` — so the name a member reads is the name
    the caller was asked about, never a word this function guessed. Every tail
    reads as a predicate of that subject, which is what makes one composition
    (``f'{subject} {detail}'``) correct for both callers.

    The five checks, in the order a refusal should reach a member:

    1. every name in the tree is one the CLOSED TABLE still declares;
    2. there is at least one citation — an uncited tree is somebody's opinion;
    3. every citation RESOLVES against the artifact it names;
    4. every numeric literal in the tree is PUBLISHED by one of those citations;
    5. every table-declared scalar the tree screens on is one they NAME.

    …and then the optional sixth: an ``attribution`` names a setup the firm's own
    taxonomy declares (and, where the Brain Pack is installed, one the KB still
    resolves a playbook for). ⛔ Never a grounding — adjudication A-1: a KB
    playbook is prose that no lookup can hold to any shape, so it attests to the
    NAME and stops there. A ``setup_catalog`` citation is not that and does not
    reopen it — it resolves the firm's published DEFINITION of the attributed
    setup field by field, refuses when the words move, and publishes no number
    for a tree to spend (``_resolve_setup_catalog`` has the whole argument).
    """
    undeclared = sorted(names_in(tree) - ast_table.declared_names(table))
    if undeclared:
        return {"ok": False,
                "detail": f"expands into {undeclared}, which the closed table no "
                          "longer declares."}

    cites = tuple(citations or ())
    if not cites:
        return {"ok": False,
                "detail": "cites no firm artifact, so its definition is somebody's "
                          "opinion rather than the firm's answer."}

    resolved = []
    allowed_values: Set[float] = set()
    allowed_keys: Set[str] = set()
    #: ⛔ THE NAME, NOT THE RESOLVED ATTRIBUTION, and the ORDER IS UNCHANGED. A
    #: `setup_catalog` citation resolves against the entry the attribution
    #: NAMES, so the name has to be in hand here — but resolving the attribution
    #: early would reorder the refusals a member reads, and the taxonomy half of
    #: it still runs below and still refuses a name the firm does not declare.
    #: Both must pass, so a definition citation forces the two setup taxonomies
    #: to agree for that one name.
    attributed = (attribution or {}).get("setup")
    for cite in cites:
        try:
            got = _resolve_citation(cite, table, attributed=attributed)
        except _CitationFailed as exc:
            return {"ok": False, "detail": f"is no longer grounded: {exc.detail}"}
        resolved.append(got)
        allowed_values |= got["values"]
        allowed_keys |= got["keys"]

    invented = sorted(literals_in(tree) - allowed_values)
    if invented:
        return {"ok": False,
                "detail": f"uses the threshold(s) {invented}, which none of its "
                          f"citations publishes (they publish {sorted(allowed_values)}). A "
                          "number nobody at the firm wrote down is this file's opinion."}

    uncited = sorted(scalars_in(tree, table) - allowed_keys)
    if uncited:
        return {"ok": False,
                "detail": f"screens on {uncited}, which none of its citations names."}

    resolved_attribution = None
    if attribution:
        try:
            resolved_attribution = _resolve_attribution(attribution)
        except _CitationFailed as exc:
            return {"ok": False,
                    "detail": "is attributed to a setup that no longer "
                              f"resolves: {exc.detail}"}

    return {"ok": True, "grounding": resolved, "attribution": resolved_attribution}


def resolve(word: Any, *, vocab: Optional[Mapping[str, Any]] = None,
            table: Optional[Mapping[str, Any]] = None) -> dict:
    """Expand a vernacular word into formula SOURCE + TREE, or refuse BY NAME.

    ⛔ THREE OUTCOMES AND NO FOURTH. A grounded concept returns its source, its
    frozen tree and its resolved citations; a word the file has decided not to
    ground returns ``concept:ambiguous`` with the stated reason; anything else
    returns ``concept:ungrounded``. There is no "closest match" and no partial
    expansion — a wrong scan that looks right is worse than a refusal.

    ⛔ AND THE GROUNDING IS RESOLVED, NOT TRUSTED. Every citation is looked up in
    the artifact it names, every literal in the tree must come from one of them,
    every scalar the tree names must be one they name, and every name in the
    tree must be declared in the closed table. A concept whose support has
    rotted refuses like any other — which is what keeps this file honest as the
    screener, the KB and the table all move underneath it.
    """
    v = vocab if vocab is not None else VOCAB
    key = normalise(word)

    declined = refused(v)
    if key in declined:
        return _refuse(GATE_AMBIGUOUS, declined[key])

    spec = concepts(v).get(key)
    if spec is None:
        return _refuse(
            GATE_UNGROUNDED,
            f'"{key}" is not in the concept vocabulary, so there is no firm '
            "definition to expand it into. Say it in the screener's own terms, "
            "or ask for it to be added and reviewed.")

    tree = spec.get("ast")
    if not isinstance(tree, Mapping):
        return _refuse(
            GATE_UNGROUNDED,
            f'"{key}" carries no frozen tree, so nothing here proves its '
            "expansion parses.")

    # ⭐ ONE GROUNDING IMPLEMENTATION, CALLED. `resolve_grounding` returns the
    # refusal as a sentence TAIL and this composes the subject onto it, so the
    # five sentences a member can read are byte-identical to the ones this
    # function used to build inline — and E-8's starter library composes the
    # SETUP NAME onto exactly the same tails.
    got = resolve_grounding(tree, spec.get("grounding"),
                            attribution=spec.get("attribution"), table=table)
    if not got["ok"]:
        return _refuse(GATE_UNGROUNDED, f'"{key}" {got["detail"]}')
    resolved = got["grounding"]
    resolved_attribution = got["attribution"]

    return {
        "ok": True,
        "word": key,
        "source": spec.get("source"),
        #: BY VALUE, never the shared frozen node — see `_thaw`.
        "ast": _thaw(tree),
        #: ⛔ THE FILE'S BYTES, NEVER THIS LANE'S WORDS. `sentence.js` produced
        #: this string and the JS test re-derives it from the shipped module on
        #: every run; anything done to it here would be the second vocabulary in
        #: miniature. `None` means "sentence.js refuses this tree", never "this
        #: concept has no read-back by design" — see `_sentence_gap`.
        "sentence": spec.get("sentence"),
        "grounding": resolved,
        "attribution": resolved_attribution,
        "version": version(v),
    }


def grounding_report(vocab: Optional[Mapping[str, Any]] = None,
                     table: Optional[Mapping[str, Any]] = None) -> dict:
    """Every concept, its citations, and whether it still resolves.

    ⭐ THE ARTIFACT A REVIEW READS. A vocabulary is only trustworthy if somebody
    can see, in one place, what each word means and what makes that the firm's
    answer rather than an author's. Sorted so two runs on two boxes diff
    cleanly.
    """
    v = vocab if vocab is not None else VOCAB
    rows = []
    for word in sorted(concepts(v)):
        spec = concepts(v)[word]
        got = resolve(word, vocab=v, table=table)
        rows.append({
            "word": word,
            "ok": got["ok"],
            "source": spec.get("source"),
            "kinds": sorted({c.get("kind") for c in spec.get("grounding") or ()}),
            "cites": [c["detail"] for c in got["grounding"]] if got["ok"] else [],
            "attribution": (got.get("attribution") or {}).get("setup") if got["ok"] else None,
            "playbook_verified": (got.get("attribution") or {}).get("playbook_verified")
            if got["ok"] else None,
            "has_sentence": bool(got.get("sentence")) if got["ok"] else False,
            "reason": None if got["ok"] else got["reason"],
        })
    return {
        "version": version(v),
        "concepts": rows,
        "refused": [{"word": w, "reason": r} for w, r in sorted(refused(v).items())],
        "resolved": sum(1 for r in rows if r["ok"]),
        "unresolved": sorted(r["word"] for r in rows if not r["ok"]),
    }
