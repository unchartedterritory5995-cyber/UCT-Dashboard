"""THE FIRM'S SETUPS AS ORDINARY DEFINITIONS (E-8).

⭐ THE ONE IDEA, AND EVERYTHING ELSE IN THIS FILE SERVES IT: a starter scan is an
ORDINARY DEFINITION. Same store, same ``def_hash``, same read-back, same save
path, editable on arrival. There is no privileged "firm setup" type, no parallel
storage and no special-case branch anywhere in the write path — which is why
this module writes NOTHING and returns NO ``def_hash``. Installing a starter is
the member's action through the shipped door (``buildDefinition`` →
``validateUserDefinitions`` → ``saveUserDefinition`` → ``installUserDefinitions``),
and the identity is ``astHash``'s.

⛔ A CATALOGUE THAT PRE-COMPUTED HASHES WOULD BE A SECOND REGISTRY. Two
authorities over one identity is this repo's most repeated defect; here it would
mean a starter's answers could be filed under a name nothing else agrees with.
So ``catalog()`` hands back a SOURCE and a TREE and stops.

────────────────────────────────────────────────────────────────────────────────
WHY THIS IS A READER AND NOT AN AUTHOR
────────────────────────────────────────────────────────────────────────────────
``starterScans.json`` is DATA for the reason ``closedTable.json`` and
``conceptVocabulary.json`` are: a catalogue carried in code is a catalogue only
one lane can see, and the browser renders these cards while the server proves
them. One file, both lanes, one diff.

────────────────────────────────────────────────────────────────────────────────
THE TAXONOMY IS READ, NEVER RESTATED — AND TWO FILES CLAIM TO BE IT
────────────────────────────────────────────────────────────────────────────────
``app/src/constants/setupGroups.js`` is authoritative here. It is what the Model
Book store keys on, what ``concept_vocabulary.firm_setups`` already checks an
attribution against, and what this module reads for BOTH the set of setups and
the FAMILY each one belongs to — which is why no entry in the catalogue carries
a ``family`` of its own.

⚠️ ``app/src/pages/modelbook/setupCatalog.js`` carries a DIFFERENT taxonomy with
different families and different display names, and the two do not agree. That
is a finding for the owner, recorded in ``report()`` (``taxonomy_conflict``) so
it is measured on every run rather than remembered. ⛔ No count of either lives
in this file: AMENDMENT 2 restated one and was wrong twice, which is exactly what
a restated count does.

────────────────────────────────────────────────────────────────────────────────
GROUNDING IS E-5a's, CALLED — NOT A SECOND COPY
────────────────────────────────────────────────────────────────────────────────
``concept_vocabulary.resolve_grounding`` resolves the citations, proves every
numeric literal is PUBLISHED by one of them and every scalar NAMED by one of
them, and resolves the attribution against the firm's taxonomy (and the KB where
the Brain Pack is installed). The phase's own sequencing note says why that is
one function: *"the same SETUP_GROUPS + lookup_playbook grounding serves both and
building it twice is the defect."*

⛔ AND A PLAYBOOK IS NEVER A GROUNDING (controller adjudication A-1). The setup
name rides as an ``attribution``, and this module does not spell it either — it
is the entry's own KEY, so a typo cannot make a starter attest to a different
setup than the one it is filed under.

────────────────────────────────────────────────────────────────────────────────
REFUSAL, NOT APPROXIMATION
────────────────────────────────────────────────────────────────────────────────
Not every name in the firm's taxonomy is expressible as ``<ast> != 0`` over the
closed table. A setup with no expressible condition is NAMED and given a reason;
it never gets a plausible-looking scan. The member trusts the firm's name on a
starter, so a scan that half-means "High Tight Flag" is worse than no scan
(AMENDMENT 1's refusal rule, applied to the library).

⭐ AND THE PARTITION IS TOTAL BY CONSTRUCTION: every name the taxonomy declares
is either shipped with a working scan or named as ungrounded. A taxonomy entry
that is silently absent is a starter nobody decided about, and
``tests/test_starter_library.py`` reds by name the day one appears.
"""
from __future__ import annotations

import io
import json
import pathlib
import re
from types import MappingProxyType
from typing import Any, Iterable, Mapping, Optional

from api.services import ast_budget
from api.services import ast_freshness
from api.services import ast_lint
from api.services import concept_vocabulary
from api.services import definition_concierge
from api.services import scan_definition
from api.services import user_definitions

#: The catalogue, resolved from THIS FILE rather than from a working directory —
#: ``ast_table.MANIFEST_PATH``'s shape, for its reason: a path resolved from
#: ``os.getcwd()`` silently finds nothing when the suite is driven from another
#: directory, and a lane that silently found no catalogue would report a passing
#: partition over an empty file.
CATALOG_PATH: pathlib.Path = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app" / "src" / "components" / "chart" / "engine" / "ast"
    / "starterScans.json"
)

#: ⛔ THE TAXONOMY'S PATH IS E-5a's CONSTANT, IMPORTED. Two modules already read
#: this file; a second spelling of its location is a second thing to keep in step.
SETUP_GROUPS_PATH: pathlib.Path = concept_vocabulary.SETUP_GROUPS_PATH

#: Structure keys. These name the dictionaries, never a setup inside one.
VERSION_KEY = "version"
STARTERS_KEY = "starters"
UNGROUNDED_KEY = "_ungrounded"

#: The gate names a caller can branch on. Closed on purpose, for
#: ``scan_definition.GATES``' reason: an open-ended reason string is prose a
#: surface has to pattern-match, which is how a refusal becomes a 500.
GATES = ("taxonomy", "tree", "budget", "condition", "grounding", "readback",
         "declared")


def _freeze(value: Any) -> Any:
    """Deep-freeze the decoded catalogue. ``ast_table._freeze``'s reason: a
    mutable module-level catalogue is a second authority waiting to happen."""
    if isinstance(value, dict):
        return MappingProxyType({k: _freeze(v) for k, v in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(v) for v in value)
    return value


def _thaw(value: Any) -> Any:
    """A plain, mutable, JSON-serialisable copy of a frozen subtree.

    ⭐ THE TREE IS HANDED OVER BY VALUE. A caller that received the shared frozen
    node would be holding a reference into a file that moves; a caller holding a
    copy is holding maths — and it is also what makes the tree storable at all,
    since ``json.dumps`` refuses a ``mappingproxy``.
    """
    if isinstance(value, Mapping):
        return {k: _thaw(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_thaw(v) for v in value]
    return value


def load(path: Optional[pathlib.Path] = None) -> Mapping[str, Any]:
    """Read the starter catalogue off disk and freeze it.

    ``io.open(..., encoding='utf-8')`` ALWAYS — a bare ``open()`` decodes as
    cp1252 on this box and has already killed a sibling harness mid-run.
    """
    p = pathlib.Path(path) if path is not None else CATALOG_PATH
    if not p.exists():
        raise FileNotFoundError(
            f"the starter catalogue is missing at {p}. It is committed under "
            "app/ beside the closed table and the concept vocabulary, and this "
            "lane READS it rather than owning a copy."
        )
    with io.open(p, encoding="utf-8") as fh:
        doc = json.load(fh)
    for key in (VERSION_KEY, STARTERS_KEY, UNGROUNDED_KEY):
        if key not in doc:
            raise ValueError(
                f"{p} has no {key!r}. A catalogue with no version cannot make a "
                "change to the firm's starters an event; one with no refusal list "
                "cannot say no by name."
            )
    return _freeze(doc)


#: The frozen catalogue. Read once, at import, from the SAME file the browser
#: imports.
CATALOG: Mapping[str, Any] = load()


def version(vocab: Optional[Mapping[str, Any]] = None) -> str:
    v = vocab if vocab is not None else CATALOG
    return v[VERSION_KEY]


def entries(vocab: Optional[Mapping[str, Any]] = None) -> Mapping[str, Any]:
    """The raw declared starters, keyed by setup name. Unvalidated on purpose —
    ``catalog()`` is what decides which of these actually ship."""
    v = vocab if vocab is not None else CATALOG
    return v.get(STARTERS_KEY) or {}


def declared_refusals(vocab: Optional[Mapping[str, Any]] = None) -> Mapping[str, str]:
    """Setups the catalogue has DECIDED not to express, each with its reason.

    ⭐ A DECLARED REFUSAL IS THE FEATURE, NOT THE OMISSION. "Wick Play" is not
    missing because nobody got to it; it is here because the columns exist and
    the firm publishes no threshold on them, so every number the scan could use
    would be the catalogue author's.
    """
    v = vocab if vocab is not None else CATALOG
    return v.get(UNGROUNDED_KEY) or {}


# --------------------------------------------------------------------------- #
# the firm's taxonomy — READ, with the family
# --------------------------------------------------------------------------- #

_GROUP_RE = re.compile(
    r"label:\s*'([^']+)'\s*,\s*setups:\s*\[(.*?)\]\s*,?\s*\}", re.DOTALL)
_SETUP_NAME = re.compile(r"'([^']+)'")


def taxonomy(path: Optional[pathlib.Path] = None) -> tuple:
    """``({'family': label, 'setups': (...)}, …)`` read off ``setupGroups.js``.

    ⛔ DERIVED, NEVER COPIED, AND NEITHER THE GROUP COUNT NOR THE SETUP COUNT IS
    WRITTEN DOWN ANYWHERE IN THIS REPO'S PYTHON. AMENDMENT 2 said "31 named
    setups across 4 families", corrected itself to 32, and conflated two separate
    files while doing it. A reader cannot rot that way; a copy can, silently.

    ⭐ AND THE FLAT SET IS CROSS-CHECKED AGAINST
    ``concept_vocabulary.firm_setups()``. Two readers of one file is one reader
    too many unless they are pinned to each other: this raises rather than
    returning a taxonomy the attribution check would disagree with, because a
    divergence would let a starter attribute itself to a setup the concept
    vocabulary says does not exist — with every test green on both sides.
    """
    p = pathlib.Path(path) if path is not None else SETUP_GROUPS_PATH
    if not p.exists():
        raise FileNotFoundError(
            f"the firm's setup taxonomy is missing at {p}; the starter library "
            "is a view over it and cannot be a view over nothing.")
    with io.open(p, encoding="utf-8") as fh:
        src = fh.read()
    groups = []
    for label, block in _GROUP_RE.findall(src):
        names = tuple(_SETUP_NAME.findall(block))
        if names:
            groups.append({"family": label, "setups": names})
    if not groups:
        raise ValueError(
            f"{p} yielded no setup groups. Its shape changed; the catalogue is "
            "reading nothing and every derived check would pass vacuously.")
    flat = {n for g in groups for n in g["setups"]}
    firm = set(concept_vocabulary.firm_setups(p))
    if flat != firm:
        raise ValueError(
            f"the two readers of {p.name} disagree: this module sees "
            f"{sorted(flat - firm)} that concept_vocabulary.firm_setups() does "
            f"not, and it sees {sorted(firm - flat)} that this module does not. "
            "One file, two parsers, two answers — fix the parsers, never the "
            "symptom.")
    return tuple(groups)


def setups(path: Optional[pathlib.Path] = None) -> frozenset:
    """Every setup name the firm's taxonomy declares."""
    return frozenset(n for g in taxonomy(path) for n in g["setups"])


def family_of(setup: str, path: Optional[pathlib.Path] = None) -> Optional[str]:
    """The taxonomy group a setup belongs to, or ``None`` if it declares none.

    ⛔ READ, NOT STORED. A ``family`` field on a catalogue entry would be a second
    authority over which group a setup is in, and the day the owner moves a setup
    between groups the library would go on grouping it the old way.
    """
    for group in taxonomy(path):
        if setup in group["setups"]:
            return group["family"]
    return None


# --------------------------------------------------------------------------- #
# admitting one starter
# --------------------------------------------------------------------------- #

class _Refused(Exception):
    """A starter that cannot ship, its gate, and the sentence a member reads."""

    def __init__(self, gate: str, detail: str) -> None:
        if gate not in GATES:
            raise ValueError(f"{gate!r} is not one of {GATES}")
        super().__init__(detail)
        self.gate = gate
        self.detail = detail


def _citation_row(cite: Mapping[str, Any]) -> dict:
    """One resolved citation, in a shape that survives ``json.dumps``.

    ⚠️ ``resolve_grounding`` hands back SETS — they are what the literal and
    column checks intersect against — and a catalogue entry that cannot be
    serialised cannot cross a wire to the surface that renders it. Sorted so two
    runs on two boxes diff cleanly.
    """
    return {
        "kind": cite["kind"],
        "cite": dict(cite["cite"]),
        "detail": cite["detail"],
        #: ⭐ WHAT THIS CITATION PUBLISHES — the numbers a starter's literals are
        #: allowed to be, and the columns it may screen on. Rendered nowhere yet;
        #: carried because "grounded" without "grounded in WHAT" is a badge.
        "publishes": sorted(cite["values"]),
        "columns": sorted(c for c in cite["keys"] if c),
    }


def _admit(setup: str, spec: Mapping[str, Any], *,
           table: Optional[Mapping[str, Any]] = None) -> dict:
    """Every gate a starter has to clear, in the order a member would hit them.

    ⛔ THE GATES ARE THE SHIPPED ONES, CALLED. ``assert_canonical`` is the store's,
    ``check_budget`` is the engine's, ``is_boolean_tree`` is E-2's single Python
    derivation off the manifest's ``yields``, ``lint_repaint`` is the badge the
    save door refuses a disagreement with, ``resolve_grounding`` is E-5a's, and
    ``sentence_for`` is the ONE producer of the read-back. A private copy of any
    of them here would be a second set of gates to keep in step — which is the
    shape ``BuilderSheet``'s own header says this programme retires.

    ⚠️ NO PARSER RUNS HERE, EVER (decision D-A1). The tree beside each ``source``
    was produced by ``parse.js::parseFormula`` and is asserted byte-equal to a
    fresh parse in ``StarterLibrary.test.jsx``; Python walks the tree it did not
    build.
    """
    tree = spec.get("ast")
    if not isinstance(tree, Mapping):
        raise _Refused("tree", "carries no frozen tree, so nothing here proves "
                               "its expansion parses.")
    tree = _thaw(tree)
    try:
        user_definitions.assert_canonical(tree)
    except ValueError as exc:
        raise _Refused("tree", f"does not carry a canonical tree: {exc}") from exc

    try:
        ast_budget.check_budget(tree)
    except Exception as exc:  # noqa: BLE001 - budget refusals carry their own guard
        raise _Refused("budget", f"exceeds the engine's budget: {exc}") from exc

    # ⛔ THE FAIL-CLOSED DIRECTION. A real-valued tree admitted as a scan makes
    # `<tree> != 0` true for every symbol whose value is not exactly zero — the
    # screen returns the whole board and looks like a very good day.
    if not scan_definition.is_boolean_tree(tree, table):
        raise _Refused(
            "condition",
            "is not a yes-or-no condition: its tree returns a number, and a scan "
            "is `<tree> != 0` on the last confirmed bar.")

    got = concept_vocabulary.resolve_grounding(
        tree, spec.get("grounding"), attribution={"setup": setup}, table=table)
    if not got["ok"]:
        raise _Refused("grounding", got["detail"])

    # ⛔ THE READ-BACK IS DERIVED HERE AND NOWHERE ELSE. `sentence_for` is the one
    # producer; a `sentence` frozen in the catalogue would be a second
    # description of one tree, and the prose one is the one that drifts (D-A5).
    try:
        sentence = definition_concierge.sentence_for(tree, {})
    except Exception as exc:  # noqa: BLE001 - the read-back's own refusal class
        raise _Refused(
            "readback",
            f"has no read-back — the shipped sentence module refuses its tree "
            f"({exc}) — and a member must be able to see what they are installing."
        ) from exc

    return {
        "setup": setup,
        "family": family_of(setup),
        "source": spec.get("source"),
        #: BY VALUE, never the shared frozen node — see `_thaw`.
        "ast": tree,
        "sentence": sentence,
        "grounding": [_citation_row(c) for c in got["grounding"]],
        "attribution": got["attribution"],
        "repaint": ast_lint.lint_repaint(tree)["mode"],
        "freshness": ast_freshness.freshness_for(tree)["mode"],
    }


# --------------------------------------------------------------------------- #
# the three doors
# --------------------------------------------------------------------------- #

def _partition(*, table: Optional[Mapping[str, Any]] = None,
               vocab: Optional[Mapping[str, Any]] = None) -> dict:
    """One walk of the taxonomy producing every answer the module gives.

    ⛔ ONE WALK, THREE DOORS. ``catalog`` / ``grounded_setups`` /
    ``ungrounded_setups`` deriving the partition three times would be three
    authorities over one question, and two of them would eventually disagree.
    """
    declared = entries(vocab)
    refusals = dict(declared_refusals(vocab))
    shipped: list[dict] = []
    refused: dict[str, str] = {}

    for group in taxonomy():
        for setup in group["setups"]:
            spec = declared.get(setup)
            if spec is not None:
                try:
                    shipped.append(_admit(setup, spec, table=table))
                    continue
                except _Refused as exc:
                    # ⭐ A ROTTED STARTER BECOMES A NAMED REFUSAL RATHER THAN
                    # DISAPPEARING. A starter whose citation stopped resolving is
                    # exactly the case a silent drop would hide, and it is the
                    # case somebody has to act on.
                    refused[setup] = f"{setup} {exc.detail}"
                    continue
            if setup in refusals:
                refused[setup] = refusals[setup]

    return {
        "shipped": shipped,
        "refused": refused,
        #: Entries whose KEY is not a setup the taxonomy declares. They can be
        #: neither shipped nor refused — a starter for a setup that does not
        #: exist is a decision nobody made — so they are surfaced here and gated
        #: by a test rather than silently ignored.
        "not_in_taxonomy": sorted(set(declared) - setups()),
        #: The mirror: a reason written for a name the taxonomy does not declare.
        "refusals_not_in_taxonomy": sorted(set(refusals) - setups()),
        #: A name that is both shipped and declared-refused. Both cannot be true.
        "both": sorted(set(declared) & set(refusals)),
        #: The whole point of the partition: a taxonomy entry nobody decided
        #: about. Empty is the only acceptable value and a test says so.
        "undecided": sorted(
            setups() - {e["setup"] for e in shipped} - set(refused)),
    }


def catalog(*, table: Optional[Mapping[str, Any]] = None,
            vocab: Optional[Mapping[str, Any]] = None) -> list[dict]:
    """Every setup that ships with a working starter scan, in taxonomy order.

    Each entry: ``{setup, family, source, ast, sentence, grounding, attribution,
    repaint, freshness}``.

    ⛔ NO ``def_hash`` AND NO STORE ROW. Installing is the member's action through
    the shipped save path and the handle is ``astHash``'s; a catalogue that
    pre-computed one would be a second registry.
    """
    return _partition(table=table, vocab=vocab)["shipped"]


def grounded_setups(*, table: Optional[Mapping[str, Any]] = None,
                    vocab: Optional[Mapping[str, Any]] = None) -> set:
    """The ``SETUP_GROUPS`` names a working scan can be written for today."""
    return {e["setup"] for e in _partition(table=table, vocab=vocab)["shipped"]}


def ungrounded_setups(*, table: Optional[Mapping[str, Any]] = None,
                      vocab: Optional[Mapping[str, Any]] = None) -> dict:
    """``{setup: the reason it is REFUSED}`` — never approximated.

    ⭐ EVERY REASON NAMES ITS OWN SETUP. A member who picks a name and is told
    "not available" learns nothing; one who is told *which column is missing, or
    which threshold nobody has published* can say what they meant instead — and
    the owner reading the same sentence knows what to author next.
    """
    return dict(_partition(table=table, vocab=vocab)["refused"])


def report(*, table: Optional[Mapping[str, Any]] = None,
           vocab: Optional[Mapping[str, Any]] = None) -> dict:
    """Every starter, its citations, and the whole partition — the review artifact.

    ⭐ THE THING A REVIEW READS. A starter library is only trustworthy if somebody
    can see, in one place, which of the firm's setups ship, what makes each one
    the firm's answer rather than an author's, and what the rest are waiting on.
    Sorted so two runs on two boxes diff cleanly.
    """
    part = _partition(table=table, vocab=vocab)
    groups = taxonomy()
    shipped_by = {e["setup"]: e for e in part["shipped"]}
    return {
        "version": version(vocab),
        "families": [
            {"family": g["family"],
             "setups": list(g["setups"]),
             "shipped": [n for n in g["setups"] if n in shipped_by]}
            for g in groups
        ],
        "starters": [
            {"setup": e["setup"], "family": e["family"], "source": e["source"],
             "sentence": e["sentence"], "repaint": e["repaint"],
             "freshness": e["freshness"],
             "cites": [c["detail"] for c in e["grounding"]],
             "attribution": (e["attribution"] or {}).get("setup"),
             "playbook_verified": (e["attribution"] or {}).get("playbook_verified")}
            for e in part["shipped"]
        ],
        "ungrounded": [{"setup": k, "reason": part["refused"][k]}
                       for k in sorted(part["refused"])],
        "undecided": part["undecided"],
        "not_in_taxonomy": part["not_in_taxonomy"],
        "refusals_not_in_taxonomy": part["refusals_not_in_taxonomy"],
        "both": part["both"],
        #: ⚠️ MEASURED ON EVERY RUN, NOT REMEMBERED. Two files in this repo carry
        #: setup taxonomies and they do not agree; the owner has to reconcile
        #: them, and until then this says exactly how far apart they are.
        "taxonomy_conflict": _taxonomy_conflict(),
    }


# --------------------------------------------------------------------------- #
# the second taxonomy — measured, not reconciled here
# --------------------------------------------------------------------------- #

SETUP_CATALOG_PATH: pathlib.Path = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app" / "src" / "pages" / "modelbook" / "setupCatalog.js"
)

_CATALOG_NAME = re.compile(r"^\s*name:\s*'([^']+)'", re.MULTILINE)
_CATALOG_FAMILY = re.compile(
    r"export const SETUP_FAMILIES\s*=\s*\[(.*?)\]", re.DOTALL)


def _taxonomy_conflict() -> dict:
    """How far apart ``setupGroups.js`` and ``setupCatalog.js`` are, by NAME.

    ⛔ NOT A COUNT COMPARISON. Two files agreeing on a total while naming
    different setups is the worse failure and the one a count cannot see, so this
    reports the three name sets and lets the owner read them.
    """
    if not SETUP_CATALOG_PATH.exists():
        return {"available": False}
    with io.open(SETUP_CATALOG_PATH, encoding="utf-8") as fh:
        src = fh.read()
    other = set(_CATALOG_NAME.findall(src))
    fams = _CATALOG_FAMILY.search(src)
    families = _SETUP_NAME.findall(fams.group(1)) if fams else []
    mine = setups()
    return {
        "available": True,
        "setup_groups_families": [g["family"] for g in taxonomy()],
        "setup_catalog_families": families,
        "in_both": sorted(mine & other),
        "setup_groups_only": sorted(mine - other),
        "setup_catalog_only": sorted(other - mine),
    }


def _names(items: Iterable[Any]) -> list:
    return sorted(str(i) for i in items)
