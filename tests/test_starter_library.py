"""E-8 — the starter library: the firm's setups as ORDINARY definitions.

⭐ THE ONE CLAIM THIS FILE EXISTS TO PROVE: a starter, once installed, is
INDISTINGUISHABLE from a definition a member typed — same document shape, same
``def_hash``, same store, same read-back — and a member-authored definition whose
tree matches a starter's has the SAME ``def_hash``. ``def_hash`` is ``astHash``
is ``compute.fn``: the tree IS the implementation, so sameness here is an
assertion rather than a resemblance.

⛔ AND THE HALF A FEATURE TEST CANNOT SEE. A ``starter: true`` on the document, an
``is_builtin`` column on the store, or a branch in the WRITER all produce a
definition that behaves differently from one a member typed, and every one of
them stays invisible to a test that opens the library and clicks a card. So this
file asserts on the SAVED ROW, on the store's COLUMN SET read from
``sqlite_master``, and on the writer's own AST.

⚠️ THE BYTE-FOR-BYTE "typed and picked produce the same document" CASE LIVES IN
``BuilderSheet.starters.test.jsx``, NOT HERE, and that is deliberate rather than
an omission. ``buildDefinition`` is a JavaScript function; a Python helper that
built a document "the same way" would be a second authority over the document's
shape, and it would agree on the day it was written. What Python can prove — and
does, below — is that the two lanes agree on the TREE, the HASH and the
READ-BACK, and that the store keeps no second class of row.
"""
from __future__ import annotations

import ast as pyast
import copy
import io
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import tempfile

import pytest

from api.services import ast_freshness
from api.services import ast_lint
from api.services import concept_vocabulary
from api.services import definition_concierge
from api.services import scan_definition
from api.services import starter_library as sl
from api.services import user_definitions as svc

ROOT = pathlib.Path(__file__).resolve().parents[1]
PARSE_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "parse.js"
SENTENCE_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "sentence.js"

#: ⛔ THE WORDS THAT WOULD MAKE A STARTER A SECOND CLASS OF OBJECT. Every one of
#: them is a real shape somebody could reach for: a flag on the document, a
#: column on the store, a keyword on the writer. ⚠️ ``factory`` was tried and
#: REMOVED — it matches ``sqlite3.Connection.row_factory``, and a token that
#: fires on shipped, unrelated code turns a gate into a thing people delete.
SPECIAL_TOKENS = ("starter", "builtin", "built_in", "is_starter", "source_setup",
                  "curated", "preset_def")

USER = "u_member_one"
OTHER = "u_member_two"


# ─── the JS lane ─────────────────────────────────────────────────────────────

class LaneUnavailable(RuntimeError):
    """The node lane could not run. NOT a skip: a lane that cannot run has not
    agreed with anything, and three of this file's claims are only checkable
    there."""


_JS_HOOK = r"""
import { readFile } from 'node:fs/promises'
export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8')
    return { format: 'module', shortCircuit: true, source: `export default ${source}\n` }
  }
  return nextLoad(url, context)
}
"""

_JS_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./hook.mjs', import.meta.url)

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)

const parse = await import(pathToFileURL(payload.parse).href)
const sentence = await import(pathToFileURL(payload.sentence).href)

const out = {}
for (const [name, source] of Object.entries(payload.sources)) {
  const p = parse.parseFormula(source)
  if (!p.ok) { out[name] = { ok: false, error: `${p.guard}: ${p.error}` }; continue }
  let said = null, err = null
  try { said = sentence.sentenceFor(p.ast, {}) } catch (e) { err = String(e && e.message || e) }
  out[name] = { ok: true, ast: p.ast, hash: parse.astHash(p.ast), sentence: said, sentenceError: err }
}
process.stdout.write(JSON.stringify(out))
"""


def _js(sources: dict) -> dict:
    """One node process, payload on STDIN.

    ⛔ STDIN, NEVER ``-e``. A ``-e`` string carrying a formula SPLIT under
    cmd.exe on this branch and selected ten of the wrong things. And the reader
    is pinned ``encoding='utf-8'``: without it Python decodes the child as cp1252
    and a single box-drawing character raises inside the reader thread.
    """
    exe = shutil.which("node")
    if not exe:
        raise LaneUnavailable("node is not on PATH")
    tmpdir = tempfile.mkdtemp(prefix="starter_library_js_")
    try:
        for name, source in (("hook.mjs", _JS_HOOK), ("driver.mjs", _JS_DRIVER)):
            with io.open(os.path.join(tmpdir, name), "w", encoding="utf-8",
                         newline="\n") as fh:
                fh.write(source)
        proc = subprocess.run(
            [exe, os.path.join(tmpdir, "driver.mjs")], cwd=str(ROOT),
            input=json.dumps({"parse": str(PARSE_JS), "sentence": str(SENTENCE_JS),
                              "sources": sources}),
            capture_output=True, text=True, encoding="utf-8", errors="replace")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    if proc.returncode != 0:
        raise LaneUnavailable(
            f"the JS lane exited {proc.returncode}: {(proc.stderr or proc.stdout)[-1500:]}")
    return json.loads(proc.stdout)


@pytest.fixture(scope="module")
def js_lane():
    return _js({e["setup"]: e["source"] for e in sl.catalog()})


# ─── helpers ─────────────────────────────────────────────────────────────────

def _document(name: str, source: str, tree: dict, *, def_id: str,
              version: int = 1) -> dict:
    """The stored shape, built ONCE and used for both lanes of every comparison.

    ⚠️ IT IS A TEST FIXTURE, NOT A SECOND `buildDefinition`. The claim it serves
    is never "these two documents look alike" — the same helper produced both, so
    that would be vacuous — it is that the STORE treats them identically and that
    their ``compute.fn`` is the same number. ``buildDefinition``'s own byte-level
    equality is proven in `BuilderSheet.starters.test.jsx`, where it lives.
    """
    return {
        "schemaVersion": 1,
        "id": def_id,
        "version": version,
        "meta": {"name": name, "shortName": name[:12], "repaint": "non-repainting"},
        "compute": {"kind": "ast", "fn": svc.ast_hash(tree), "rev": 1,
                    "ast": copy.deepcopy(tree), "source": source},
        "placement": {"target": "pane", "pane": {"height": 0.15}},
        "inputs": [],
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
    }


@pytest.fixture
def store(tmp_path, monkeypatch):
    """The definition store AND the alert DB the rev-migration reads.

    ⛔ THE ATTRIBUTE MOVES, NOT ONLY THE ENV VAR. ``_DB_PATH`` is captured at
    import, so setting ``USER_DEFINITIONS_DB_PATH`` afterwards does nothing — and
    the default resolves to the shared ``C:\\data`` volume this box really has.

    ⚠️ AND THE ALERT DB IS PART OF THE FIXTURE, exactly as
    ``test_user_definitions.py`` records: a rev-bumping ``save()`` calls the
    force-migration, which reads ``indicator_alerts``. Pointed at the default
    that is the shared 20k-row ``auth.db`` — six tests once passed on another
    suite's residue and called it a fixture.
    """
    from api.services import alert_rev_migration as rev
    from api.services import indicator_alert_service as ias

    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()

    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _string_constants(path: pathlib.Path) -> set:
    with io.open(path, encoding="utf-8") as fh:
        tree = pyast.parse(fh.read())
    return {n.value for n in pyast.walk(tree)
            if isinstance(n, pyast.Constant) and isinstance(n.value, str)}


def _identifiers_and_strings(source: str) -> list:
    """Every place a starter could hide in a module: names, attributes, arguments,
    keywords and string constants (a column name lives inside a SQL string)."""
    tree = pyast.parse(source)
    out: list[str] = []
    for node in pyast.walk(tree):
        if isinstance(node, pyast.Name):
            out.append(node.id)
        elif isinstance(node, pyast.Attribute):
            out.append(node.attr)
        elif isinstance(node, pyast.arg):
            out.append(node.arg)
        elif isinstance(node, pyast.keyword) and node.arg:
            out.append(node.arg)
        elif isinstance(node, (pyast.FunctionDef, pyast.AsyncFunctionDef, pyast.ClassDef)):
            out.append(node.name)
        elif isinstance(node, pyast.Constant) and isinstance(node.value, str):
            out.append(node.value)
    return out


def _special_hits(source: str) -> list:
    return sorted({
        f"{tok} in {item[:60]!r}"
        for item in _identifiers_and_strings(source)
        for tok in SPECIAL_TOKENS
        if tok in item.lower()
    })


# =============================================================================
# 1. THE ONE THAT DECIDES THE TASK
# =============================================================================

def test_a_STARTER_IS_AN_ORDINARY_DEFINITION_and_NOTHING_MARKS_IT_AS_SPECIAL(store):
    """🔴 AMENDMENT 2 §A2.1 — same store, same ``def_hash``, same read-back.

    A starter's tree and a member's identical typed tree are saved through the
    SAME ``user_definitions.save``, and the two rows are compared column by
    column with the columns read off the table rather than typed.
    """
    entry = sl.catalog()[0]
    starter_doc = _document(entry["setup"], entry["source"], entry["ast"],
                            def_id="u_0000000000a1")
    member_doc = _document("My own screen", entry["source"], entry["ast"],
                           def_id="u_0000000000b2")

    svc.save(USER, "u_0000000000a1", starter_doc)
    svc.save(USER, "u_0000000000b2", member_doc)

    a = svc.get(USER, "u_0000000000a1")
    b = svc.get(USER, "u_0000000000b2")

    # ⭐ THE HASH IS THE IDENTITY, AND IT IS THE SAME NUMBER.
    assert a["ast_hash"] == b["ast_hash"] == svc.ast_hash(entry["ast"])
    assert a["definition"]["compute"]["fn"] == a["ast_hash"]
    assert scan_definition.def_hash(a["definition"]) == \
        scan_definition.def_hash(b["definition"])

    # …and every other stored fact about the two rows is identical.
    ignore = {"def_id", "created_at", "definition"}
    assert {k: v for k, v in a.items() if k not in ignore} == \
           {k: v for k, v in b.items() if k not in ignore}

    # ⛔ THE STORE'S COLUMN SET, DERIVED FROM `sqlite_master` — never a typed
    # table name. A `PRAGMA table_info` against a name this test spelled would
    # pass just as happily against a store that had grown a second table.
    with sqlite3.connect(svc._DB_PATH) as c:
        tables = [r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%'")]
        assert tables, "no table was created — the probe would pass vacuously"
        for table in tables:
            cols = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
            assert cols, f"{table} has no columns"
            offenders = sorted(c for c in cols
                               for tok in SPECIAL_TOKENS if tok in c.lower())
            assert offenders == [], (
                f"{table} carries {offenders} — a starter with a column of its "
                "own is a second class of object one layer below where any "
                "feature test can see it")


def test_the_column_probe_is_NOT_VACUOUS(store):
    """⛔ THE CONTROL. A planted ``is_builtin`` column must be FOUND, or the
    assertion above is a sentence rather than a gate."""
    with sqlite3.connect(svc._DB_PATH) as c:
        c.execute("ALTER TABLE user_definitions ADD COLUMN is_builtin INTEGER")
        cols = {r[1] for r in c.execute("PRAGMA table_info(user_definitions)")}
    offenders = sorted(col for col in cols
                       for tok in SPECIAL_TOKENS if tok in col.lower())
    assert offenders == ["is_builtin"]


def test_the_save_path_has_NO_STARTER_BRANCH__BY_AST():
    """⛔ THE OTHER HALF, AND A GREP CANNOT SEE IT.

    A starter that is special-cased in the WRITER produces an identical row and a
    different history. This walks the store and its router with ``ast`` — names,
    attributes, arguments, keywords, function names and string constants (a
    column name lives inside the schema STRING) — and asserts nothing in either
    module names a starter.
    """
    for module in ("api/services/user_definitions.py",
                   "api/routers/user_definitions.py"):
        path = ROOT / module
        assert path.exists(), path
        with io.open(path, encoding="utf-8") as fh:
            source = fh.read()
        assert _special_hits(source) == [], (
            f"{module} names a starter — a second branch through the one write "
            "door is a second set of gates to keep in step")


def test_the_writer_census_is_NOT_VACUOUS():
    """The control: each of the three shapes it exists to catch is found."""
    planted = (
        "def save(user_id, def_id, definition, starter=False):\n"
        "    SCHEMA = 'CREATE TABLE t (is_builtin INTEGER)'\n"
        "    return _write(definition, curated=starter)\n"
    )
    hits = _special_hits(planted)
    assert any("starter" in h for h in hits)
    assert any("builtin" in h for h in hits)
    assert any("curated" in h for h in hits)


# =============================================================================
# 2. THE TAXONOMY IS DERIVED AND THE PARTITION IS TOTAL
# =============================================================================

def test_the_catalog_is_DERIVED_from_SETUP_GROUPS_and_the_COUNT_IS_NOT_TYPED():
    """⛔ The taxonomy is ``SETUP_GROUPS``' and this file holds no copy of it.

    ⚠️ AND THE COUNT IS READ, NEVER ASSERTED AS A LITERAL. AMENDMENT 2 said 31
    across 4 families, corrected itself to 32, and had conflated two files while
    doing it. A literal here would rot the day somebody adds a setup — which is a
    thing that happens.
    """
    names = sl.setups()
    assert names, "the taxonomy read as empty; every check below would pass vacuously"
    shipped = {e["setup"] for e in sl.catalog()}
    assert shipped <= names, sorted(shipped - names)
    assert shipped == sl.grounded_setups()

    refused = sl.ungrounded_setups()
    assert shipped | set(refused) == names, (
        "every setup is either shipped with a working scan or NAMED as "
        "ungrounded — a taxonomy entry that is silently absent is a starter "
        f"nobody decided about: {sorted(names - shipped - set(refused))}")
    assert not (shipped & set(refused)), sorted(shipped & set(refused))

    # Every entry's family is the taxonomy's, read back off the taxonomy.
    for e in sl.catalog():
        assert e["family"] == sl.family_of(e["setup"])
        assert e["family"] in {g["family"] for g in sl.taxonomy()}


def test_a_NEW_setup_in_the_TAXONOMY_lands_RED_until_somebody_decides(tmp_path,
                                                                     monkeypatch):
    """⭐ THE PROPERTY THAT MAKES THE DERIVATION LOAD-BEARING.

    A hand-listed catalogue agrees with today's taxonomy and stays silent when
    the taxonomy grows. Here the taxonomy grows and the partition NAMES the new
    entry — which is the only reason the list is read rather than written down.
    """
    with io.open(sl.SETUP_GROUPS_PATH, encoding="utf-8") as fh:
        src = fh.read()
    grown = tmp_path / "setupGroups.js"
    with io.open(grown, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(src.replace("'Red to Green',", "'Red to Green', 'Brand New Setup',"))
    monkeypatch.setattr(sl, "SETUP_GROUPS_PATH", grown)
    monkeypatch.setattr(concept_vocabulary, "SETUP_GROUPS_PATH", grown)

    assert "Brand New Setup" in sl.setups()
    assert sl.report()["undecided"] == ["Brand New Setup"]
    assert "Brand New Setup" not in sl.grounded_setups()
    assert "Brand New Setup" not in sl.ungrounded_setups()


def test_the_TWO_READERS_of_setupGroups_agree__and_a_divergence_RAISES(tmp_path,
                                                                      monkeypatch):
    """⛔ ONE FILE, TWO PARSERS, AND THEY ARE PINNED TO EACH OTHER.

    ``concept_vocabulary.firm_setups`` reads the flat names; this module also
    reads the GROUP each name sits in. A divergence would let a starter attribute
    itself to a setup the concept vocabulary says does not exist, with every test
    green on both sides — so it raises by name.
    """
    assert sl.setups() == concept_vocabulary.firm_setups()

    broken = tmp_path / "setupGroups.js"
    with io.open(broken, "w", encoding="utf-8", newline="\n") as fh:
        # The SECOND block carries no `label:`, so `firm_setups` sees its names
        # and `taxonomy` does not — one file, two parsers, two answers.
        fh.write("export const SETUP_GROUPS = [\n"
                 "  { label: 'Swing', setups: ['Only One'] },\n"
                 "  { setups: ['Invisible To One Reader'] },\n"
                 "]\n")
    monkeypatch.setattr(sl, "SETUP_GROUPS_PATH", broken)
    monkeypatch.setattr(concept_vocabulary, "SETUP_GROUPS_PATH", broken)
    with pytest.raises(ValueError, match="disagree"):
        sl.taxonomy()


def test_the_TWO_READERS_of_setupCatalog_AGREE_and_the_PATH_IS_ONE_CONSTANT(tmp_path):
    """⛔ ONE FILE, TWO PARSERS AGAIN — and this pair is newer and less obvious.

    ``setupCatalog.js`` is read HERE for the ``taxonomy_conflict`` report (names
    only) and in ``concept_vocabulary`` for the ``setup_catalog`` citation kind
    (names, family, direction, essence, pivot). Neither module can import the
    other's reader — this one already imports the vocabulary, so the dependency
    only runs one way — so the two are pinned by NAME SET here, exactly as the
    ``setupGroups.js`` pair above is. A divergence would let a starter be
    grounded in a definition the conflict report says does not exist.
    """
    assert sl.SETUP_CATALOG_PATH == concept_vocabulary.SETUP_CATALOG_PATH, (
        "two spellings of one file's location is the second authority this "
        "repo pays for most often")
    with io.open(sl.SETUP_CATALOG_PATH, encoding="utf-8") as fh:
        src = fh.read()
    names_only = set(sl._CATALOG_NAME.findall(src))
    definitions = set(concept_vocabulary.setup_definitions())
    assert names_only, "the names-only reader saw nothing; this rail is vacuous"
    assert names_only == definitions, sorted(names_only ^ definitions)

    # ⚠️ THE CONTROL: the two readers CAN disagree, so the equality above is a
    # measurement. The names-only regex sees any `name:` line in the file; the
    # citation reader is scoped to the SETUP_CATALOG array.
    strayed = tmp_path / "setupCatalog.js"
    with io.open(strayed, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(src + "\nexport const ORPHAN = {\n  name: 'Zz Outside The Array',\n}\n")
    with io.open(strayed, encoding="utf-8") as fh:
        loose = set(sl._CATALOG_NAME.findall(fh.read()))
    assert loose - set(concept_vocabulary.setup_definitions(strayed)) == \
        {"Zz Outside The Array"}


#: THE SECOND MACHINE-READABLE CLAIM SHAPE A REFUSAL CAN CARRY, beside
#: ``no `column```: a setup the firm has written down no DEFINITION for. The
#: truth side is ``setupCatalog.js``, read by the same function the citation
#: kind resolves against — never prose, and never a second copy of the list.
_LIBRARY_SILENT = "the Setup Library publishes no definition of"


def test_a_refusal_LEANING_ON_THE_SETUP_LIBRARYS_SILENCE_is_TRUE_TODAY():
    """⭐ THE SAME ANTI-STALENESS TOOTH AS THE MISSING-COLUMN RAIL, aimed at the
    other kind of gap a refusal can blame.

    ``setup_catalog`` grounds a LITERAL-FREE tree in the firm's own published
    definition, so "the firm has published no definition of this setup" became a
    real, checkable blocker the day that kind shipped — and it is a blocker the
    owner can clear by writing one paragraph in the Setup Library. A reason that
    goes on citing the gap after the definition is published still satisfies
    every SHAPE rail above (names its setup, long enough, distinct) while
    teaching a member the firm cannot say what it now says. So the claim is
    measured on every run: the day the Setup Library gains the entry, the
    refusal leaning on its absence goes RED BY NAME and gets re-adjudicated.
    """
    published = concept_vocabulary.setup_definitions()
    assert published, "the Setup Library read as empty; this rail is vacuous"
    refusals = sl.declared_refusals()
    leaning = sorted(s for s, r in refusals.items() if _LIBRARY_SILENT in r)
    assert leaning, (
        "no refusal cites the Setup Library's silence — either every refused "
        "setup is now published (re-adjudicate them) or this tooth has nothing "
        "to check and would pass forever")
    stale = sorted(s for s in leaning if s in published)
    assert stale == [], (
        "these refusals say the firm has published no definition of a setup the "
        f"Setup Library now DOES define: {stale}. A literal-free scan for one of "
        "them may now be groundable — re-adjudicate, do not re-word.")

    # ⚠️ THE CONTROL, with a REAL subject: several refused setups already have a
    # published definition, so planting the claim on one must be caught.
    victim = sorted(set(refusals) & set(published))[0]
    planted = dict(refusals)
    planted[victim] = f"{victim} is refused because {_LIBRARY_SILENT} {victim}."
    caught = sorted(s for s, r in planted.items()
                    if _LIBRARY_SILENT in r and s in published)
    assert caught == [victim], caught


def test_the_report_records_the_TWO_TAXONOMIES_THAT_DO_NOT_AGREE():
    """⚠️ MEASURED ON EVERY RUN, NOT REMEMBERED. ``setupGroups.js`` and
    ``setupCatalog.js`` both claim to be the firm's setup list and they name
    different setups. The owner has to reconcile them; until then this states
    exactly how far apart they are, by NAME rather than by count."""
    conflict = sl.report()["taxonomy_conflict"]
    assert conflict["available"] is True
    assert conflict["setup_groups_only"], (
        "the two taxonomies agree — either they were reconciled (delete this "
        "test's premise) or the reader is reading nothing")
    assert conflict["setup_catalog_only"]
    assert set(conflict["in_both"]) < sl.setups()
    assert set(conflict["setup_groups_families"]) != set(
        conflict["setup_catalog_families"])


# =============================================================================
# 3. REFUSAL, NEVER APPROXIMATION
# =============================================================================

def test_an_UNGROUNDABLE_setup_is_NAMED_and_NEVER_APPROXIMATED():
    """⛔ AMENDMENT 1's refusal rule, applied to the library.

    A discretionary setup with no expressible condition gets a REASON, not a
    plausible-looking scan. A starter that half-means "High Tight Flag" is worse
    than no starter: the member trusts the firm's name on it.
    """
    refused = sl.ungrounded_setups()
    assert refused, "nothing is refused — the refusal rail would pass vacuously"
    for setup, reason in refused.items():
        assert reason, setup
        assert setup in reason, (
            f"the reason for {setup!r} does not name it: {reason!r}")
        assert len(reason) > 40, (
            f"{setup!r} is refused with {reason!r} — a member who is told only "
            "'not available' learns nothing about what they meant")
    assert not (set(refused) & {e["setup"] for e in sl.catalog()})


def test_the_reasons_are_NOT_ONE_SENTENCE_REPEATED():
    """⛔ A single template with the name substituted in would satisfy the rail
    above while telling a member nothing. The reasons must actually differ."""
    reasons = list(sl.ungrounded_setups().values())
    assert len(set(reasons)) == len(reasons)
    # Strip the setup name and the tails must still be distinct.
    stripped = {r.replace(s, "") for s, r in sl.ungrounded_setups().items()}
    assert len(stripped) == len(reasons)


CLOSED_TABLE_PATH = (ROOT / "app" / "src" / "components" / "chart" / "engine"
                     / "ast" / "closedTable.json")

#: THE ONE MACHINE-READABLE SHAPE OF A MISSING-COLUMN CLAIM: ``no `column```.
#: A refusal reason is prose, but the column it blames is an identifier, and
#: this is the citation form the catalogue's reasons use when they lean on a
#: column's ABSENCE (as opposed to merely mentioning one that exists). The
#: truth side is never prose — it is ``json.load`` over the closed table.
_MISSING_CITE = re.compile(r"\bno\s+`([A-Za-z_][A-Za-z0-9_]*)`", re.IGNORECASE)


def test_a_reason_citing_a_MISSING_column_names_one_the_table_ACTUALLY_lacks():
    """⭐ WAVE-6 T5's MECHANICAL-TRUTH RAIL. The refusal reasons are CLAIMS
    about the closed table, and the two claim shapes they carry are verified
    against the artifact on every run rather than trusted — because a reason
    that has quietly stopped being true still satisfies every SHAPE rail above
    (names its setup, long enough, distinct) while teaching a member a
    vocabulary gap the table no longer has.

    1. ``no `column``` — the missing-column citation — must name a column
       ABSENT from ``closedTable.json``'s declared scalars, truth side
       json-loaded from the manifest, never read off prose. ⭐ THE DAY SUCH A
       COLUMN IS PROMOTED, THE REASON LEANING ON ITS ABSENCE GOES RED BY NAME
       and gets re-adjudicated — the staleness class that let ``ipo_age_days``
       enter the vocabulary while 'IPO Base' still said no listing-age column
       exists anywhere.

    2. No reason may cite ``_no_offset`` as a live blocker. ``291c9d8a``
       shipped the bounded backward offset, and the SHIPPED PARSER proves it
       here by parsing ``close[1]`` — the staleness class that left five
       offset-blocked refusals standing after the gap closed. And if the
       offset ever LEAVES the grammar this test goes red the other way,
       because every reason re-adjudicated against its existence would be
       stale again in the opposite direction.
    """
    with io.open(CLOSED_TABLE_PATH, encoding="utf-8") as fh:
        table = json.load(fh)
    declared = set(table["scalars"])
    assert declared, "the closed table declares no scalars — every check " \
                     "below would pass vacuously"

    refusals = sl.declared_refusals()
    assert refusals, "no declared refusals — the rail has nothing to check"

    # ── tooth 2: the offset node is REAL, proven by the shipped parser.
    probe = _js({"probe": "close[1]"})["probe"]
    assert probe["ok"], (
        "the shipped parser refuses `close[1]` — the offset node left the "
        "grammar, and every reason re-adjudicated against its existence "
        f"(291c9d8a) is stale the other way: {probe.get('error')}")
    deniers = sorted(s for s, r in refusals.items() if "_no_offset" in r)
    assert deniers == [], (
        f"{deniers} still cite `_no_offset` as a blocker, but the offset node "
        "shipped (291c9d8a) and the parser just proved it above — these "
        "refusals need re-adjudication, not repetition")

    # ── tooth 1: every missing-column citation is TRUE against the manifest.
    cited = {s: _MISSING_CITE.findall(r) for s, r in refusals.items()}
    stale = sorted(f"{s} claims `{c}` is missing" for s, cols in cited.items()
                   for c in cols if c in declared)
    assert stale == [], (
        "these refusals blame a column that closedTable.json now DECLARES — "
        f"the setup needs re-adjudication, not a stale sentence: {stale}")

    # …and the citation form is actually in use, or the tooth bites nothing.
    assert any(cols for cols in cited.values()), (
        "no refusal carries a ``no `column``` citation — the missing-column "
        "tooth has nothing to check and would pass forever")

    # ── the control: a planted FALSE claim is caught by the same machinery.
    planted = "Foo is refused because the table ships no `rs_rank` column."
    caught = [c for c in _MISSING_CITE.findall(planted) if c in declared]
    assert caught == ["rs_rank"], caught


def test_every_DECLARED_starter_ACTUALLY_RESOLVES():
    """🔴 THE RAIL THAT MAKES AN APPROXIMATION IMPOSSIBLE TO SLIP IN QUIETLY.

    A starter whose grounding refuses degrades GRACEFULLY into a named refusal —
    which is right for a citation that rotted underneath us, and wrong for a
    catalogue somebody just edited. Without this, filling a refused setup's slot
    with a plausible-looking scan carrying an invented number would leave every
    other assertion in this file green: the partition still closes, the reason
    still names the setup, and the only trace is that a sentence the firm wrote
    was replaced by one a resolver generated.

    So the SHIPPED file has to be internally consistent: every entry under
    ``starters`` resolves, and everything else is a DECLARED reason somebody
    reviewed.
    """
    declared = set(sl.entries())
    assert declared, "the catalogue declares no starters"
    unresolved = sorted(declared - sl.grounded_setups())
    assert unresolved == [], (
        "these starters are DECLARED but do not resolve, so each has silently "
        "become a machine-generated refusal in place of a reviewed one: "
        + "; ".join(f"{n}: {sl.ungrounded_setups().get(n)}" for n in unresolved))
    assert declared & set(sl.declared_refusals()) == set()


def test_a_STARTER_THAT_LOSES_ITS_GROUNDING_becomes_a_NAMED_REFUSAL():
    """⭐ NOT A SILENT DROP. A starter whose citation stopped resolving is exactly
    the case a disappearance would hide, and exactly the case somebody has to act
    on — so it moves into the refusal list, by name, carrying the resolver's own
    sentence."""
    doc = copy.deepcopy(sl._thaw(sl.CATALOG))
    victim = sl.catalog()[0]["setup"]
    doc["starters"][victim]["grounding"] = [
        {"kind": "starter_screen", "screen": "starter_that_never_existed"}]

    assert victim not in sl.grounded_setups(vocab=doc)
    reason = sl.ungrounded_setups(vocab=doc)[victim]
    assert victim in reason
    assert "starter_that_never_existed" in reason
    # …and the partition still closes.
    assert sl.report(vocab=doc)["undecided"] == []


def test_a_RETUNED_THRESHOLD_goes_red_NAMING_THE_NUMBER():
    """⭐ E-5a's rail, inherited: no number in a starter may be the author's.

    ``rs_rank >= 80`` is shippable because the firm publishes a preset labelled
    ``Over 80``. 75 is nobody's published threshold, and the refusal has to SAY
    75 — a refusal that merely said "ungrounded" would leave an author guessing
    which of four numbers was rejected.
    """
    doc = copy.deepcopy(sl._thaw(sl.CATALOG))
    victim = None
    for name, spec in doc["starters"].items():
        found = _retune(spec["ast"], 80, 75)
        if found:
            victim = name
            break
    assert victim, "no starter carries the 80 this test retunes"
    reason = sl.ungrounded_setups(vocab=doc)[victim]
    assert "75" in reason, reason
    assert victim in reason


def _retune(node, old, new) -> bool:
    if not isinstance(node, dict):
        return False
    if node.get("type") == "num" and node.get("value") == old:
        node["value"] = new
        return True
    return any(_retune(a, old, new) for a in node.get("args") or ())


def test_an_APPROXIMATE_SCAN_for_a_refused_setup_cannot_quietly_ship():
    """⛔ M5's shape. Handing a refused setup a plausible-looking scan with an
    invented number does not fill the slot: the grounding rail refuses it and the
    setup stays named."""
    doc = copy.deepcopy(sl._thaw(sl.CATALOG))
    victim = "Wick Play"
    assert victim in doc["_ungrounded"]
    doc["_ungrounded"].pop(victim)
    doc["starters"][victim] = {
        "source": "upper_wick_pct >= 40",
        "ast": {"type": "op", "name": ">=", "args": [
            {"type": "series", "name": "upper_wick_pct"},
            {"type": "num", "value": 40}]},
        "grounding": [{"kind": "filter_preset", "key": "rs_rank",
                       "preset": "Over 80"}],
    }
    assert victim not in sl.grounded_setups(vocab=doc)
    reason = sl.ungrounded_setups(vocab=doc)[victim]
    assert victim in reason
    assert "40" in reason or "upper_wick_pct" in reason


# =============================================================================
# 4. EVERY STARTER CLEARS THE SHIPPED GATES
# =============================================================================

def test_every_starter_PARSES_LINTS_and_IS_A_CONDITION():
    """⛔ A starter that refuses at save time is a broken front door.

    Each entry's tree goes through the SHIPPED chain — the canonical-shape check,
    the budget, the repaint lint, the freshness lint and ``is_boolean_tree`` — in
    this test, not at first click.
    """
    rows = sl.catalog()
    assert rows, "the catalogue is empty; every assertion below is vacuous"
    for e in rows:
        svc.assert_canonical(e["ast"])
        assert scan_definition.is_boolean_tree(e["ast"]), e["setup"]
        assert e["repaint"] in ast_lint.REPAINT_MODES, e["setup"]
        assert e["freshness"] in ast_freshness.FRESHNESS_MODES, e["setup"]
        # ⭐ AND THE CLEAN VERDICT, READ OFF THE SHIPPED VOCABULARY RATHER THAN
        # TYPED. A starter that needs a repaint acknowledgement before it can be
        # saved is a broken front door in the other direction.
        assert e["repaint"] == ast_lint.REPAINT_MODES[0], (
            f"{e['setup']} is {e['repaint']}")


def test_every_starter_is_GROUNDED_in_an_artifact_THE_FIRM_SHIPS():
    """⛔ RESOLVED, NOT TRUSTED. Each citation is looked up in the artifact it
    names, and every kind used is one the resolver declares."""
    for e in sl.catalog():
        assert e["grounding"], e["setup"]
        for cite in e["grounding"]:
            assert cite["kind"] in concept_vocabulary.GROUNDING_KINDS
            assert cite["detail"]


def test_a_DEFINITION_GROUNDED_starter_STATES_NO_NUMBER_AND_SCREENS_ON_NO_COLUMN():
    """⛔⛔ THE CONTAINMENT THAT MAKES THE FIFTH CITATION KIND SAFE TO SHIP.

    ``setup_catalog`` grounds a starter in the firm's own PUBLISHED DEFINITION
    of the setup — prose, which cannot publish a threshold — so it hands back an
    empty ``publishes`` and an empty ``columns``. The consequence, and the whole
    reason a prose artifact may ground anything at all: a starter standing on a
    definition ALONE can carry no numeric literal and can screen on no
    table-declared scalar, because there is nothing for those two rails to draw
    on. It vouches for a SHAPE and can never launder a number.

    ⛔ DERIVED FROM THE CITATION KINDS IN USE, never from a setup name typed
    here — the day a second definition-grounded starter ships it is covered
    without an edit, and the day one quietly gains a literal it goes red.
    """
    rows = [e for e in sl.catalog()
            if {c["kind"] for c in e["grounding"]} == {"setup_catalog"}]
    assert rows, (
        "no starter is grounded by the firm's published definition alone — this "
        "rail has nothing to check, and the fifth citation kind is unused")
    for e in rows:
        assert concept_vocabulary.literals_in(e["ast"]) == set(), (
            f"{e['setup']} states a number while citing only a definition, "
            "which publishes none")
        assert concept_vocabulary.scalars_in(e["ast"]) == set(), e["setup"]
        for cite in e["grounding"]:
            assert cite["publishes"] == [] and cite["columns"] == [], cite
            # …and the citation quotes the firm's own words rather than merely
            # naming the setup: the detail carries the published definition.
            assert cite["cite"]["describes"], cite
            assert all(str(p) in cite["detail"].replace("’", "'")
                       for p in cite["cite"]["describes"]), cite

    # ⚠️ THE CONTROL: bolt a literal onto one of them and the SAME resolver
    # refuses it NAMING the number, because a definition publishes nothing.
    doc = copy.deepcopy(sl._thaw(sl.CATALOG))
    victim = rows[0]["setup"]
    doc["starters"][victim]["ast"] = {"type": "op", "name": "&&", "args": [
        doc["starters"][victim]["ast"],
        {"type": "op", "name": ">", "args": [
            {"type": "series", "name": "close"}, {"type": "num", "value": 11}]}]}
    reason = sl.ungrounded_setups(vocab=doc)[victim]
    assert victim in reason and "11" in reason, reason


def test_the_ATTRIBUTION_is_the_ENTRY_KEY_and_never_reads_as_a_verified_playbook():
    """⭐ A PLAYBOOK IS AN ATTRIBUTION, NEVER A GROUNDING (adjudication A-1) — and
    the catalogue does not spell the setup name a second time: the attribution is
    the entry's own KEY, so a typo cannot make a starter attest to a different
    setup than the one it is filed under.

    ⚠️ AND THE TRI-STATE MUST NEVER READ AS A PASS. ``brain_service`` never
    raises; with no Brain Pack installed the KB half is UNVERIFIED, which is
    reported rather than patched around.
    """
    for e in sl.catalog():
        assert e["attribution"]["setup"] == e["setup"]
        assert e["attribution"]["playbook_verified"] in (True, None)
        assert e["attribution"]["playbook_verified"] is not False
    # …and nothing in the file re-spells a setup name as a grounding kind.
    for spec in sl.entries().values():
        for cite in spec.get("grounding") or ():
            assert cite.get("kind") != "playbook"
            assert "setup" not in cite


def test_no_starter_entry_carries_a_FAMILY_a_SENTENCE_or_a_HASH():
    """⛔ THREE THINGS THE FILE MUST NOT OWN, because each already has an owner:
    the family is the taxonomy's, the read-back is ``sentence.js``'s, and the
    handle is ``astHash``'s."""
    forbidden = ("family", "sentence", "blurb", "description", "def_hash",
                 "hash", "fn", "readback", "read_back")
    for setup, spec in sl.entries().items():
        overlap = sorted(set(spec) & set(forbidden))
        assert overlap == [], f"{setup} carries {overlap}"


# =============================================================================
# 5. THE READ-BACK IS THE TREE'S
# =============================================================================

def test_the_card_sentence_is_DERIVED_from_the_tree_by_the_ONE_PRODUCER():
    """⛔ D-A5. A hand-written blurb is a second description of one tree, and the
    prose one is the one that drifts."""
    for e in sl.catalog():
        assert e["sentence"] == definition_concierge.sentence_for(e["ast"], {})
        assert e["sentence"].strip()


def test_the_TWO_LANES_agree_on_the_TREE_the_HASH_and_the_READ_BACK(js_lane):
    """⭐ THE CROSS-LANE RAIL, AND IT IS WHY PYTHON MAY WALK A TREE IT DID NOT BUILD.

    No parser lives on this side (decision D-A1). The frozen ``ast`` beside each
    ``source`` is therefore trusted by the server and must be proven: here the
    SHIPPED parser re-parses every starter's source and the three answers — the
    tree, ``astHash`` and the read-back — are compared against Python's.
    """
    rows = sl.catalog()
    assert rows and len(js_lane) == len(rows)
    for e in rows:
        got = js_lane[e["setup"]]
        assert got["ok"], got.get("error")
        assert got["ast"] == e["ast"], (
            f"{e['setup']}: the frozen tree is not what the parser produces")
        assert got["hash"] == svc.ast_hash(e["ast"])
        assert got["sentenceError"] is None, got["sentenceError"]
        assert got["sentence"] == e["sentence"], (
            f"{e['setup']}: the two lanes describe one tree differently")


# =============================================================================
# 6. NO SECOND REGISTRY, NO STORE ROW
# =============================================================================

def test_the_catalog_returns_NO_DEF_HASH_and_WRITES_NO_ROW(store):
    """⛔ M8's shape. A catalogue that pre-computed hashes would be a second
    registry, and two authorities over one identity is this repo's most repeated
    defect."""
    before = svc.stats()
    rows = sl.catalog()
    blob = json.dumps(rows)
    assert "sha256:" not in blob, "a hash reached the catalogue"
    for e in rows:
        assert not [k for k in e if "hash" in k.lower() or k == "fn"], sorted(e)
    assert svc.stats() == before
    assert sl.grounded_setups() and sl.ungrounded_setups()
    assert svc.stats()["versions"] == 0


def test_installing_a_starter_TWICE_is_ONE_definition_and_editing_it_FORKS_the_hash(store):
    """⭐ ONE HASH, ONE OBJECT — and the edit story A2.3 depends on.

    Two members installing the same starter share a ``def_hash`` (and therefore
    E-3's results and E-6's record); a member who EDITS one gets a new
    ``def_hash``, a new ``rev`` and D-A3's rev semantics — which is exactly why an
    edited scan's performance starts over rather than inheriting somebody else's.
    """
    entry = sl.catalog()[0]
    mine = svc.save(USER, "u_0000000000c1",
                    _document(entry["setup"], entry["source"], entry["ast"],
                              def_id="u_0000000000c1"))
    yours = svc.save(OTHER, "u_0000000000d1",
                     _document(entry["setup"], entry["source"], entry["ast"],
                               def_id="u_0000000000d1"))
    assert mine["ast_hash"] == yours["ast_hash"]
    assert mine["rev"] == yours["rev"] == svc.FIRST_REV

    # The SAME member installing it twice under one id appends nothing.
    again = svc.save(USER, "u_0000000000c1",
                     _document(entry["setup"], entry["source"], entry["ast"],
                               def_id="u_0000000000c1"))
    assert again["appended"] is False
    assert again["version"] == mine["version"]

    # …and an EDIT forks the maths.
    edited_tree = copy.deepcopy(entry["ast"])
    assert _retune(edited_tree, 80, 90) or _retune(edited_tree, 2, 3) or \
        _retune(edited_tree, 0.66, 0.33) or _retune(edited_tree, 20, 30), \
        "no literal to retune — the fork below would be vacuous"
    after = svc.save(USER, "u_0000000000c1",
                     _document(entry["setup"], entry["source"], edited_tree,
                               def_id="u_0000000000c1", version=2))
    assert after["rev_bumped"] is True
    assert after["ast_hash"] != mine["ast_hash"]
    assert after["rev"] == mine["rev"] + 1
    # ⛔ AND THE PINNED VERSION STILL ANSWERS. A starter is append-only like
    # everything else in this store.
    assert svc.get(USER, "u_0000000000c1", version=1)["ast_hash"] == mine["ast_hash"]


# =============================================================================
# 7. THE SOURCE RAIL — a hand-list that AGREES with today's taxonomy is invisible
# =============================================================================

def test_the_module_SPELLS_NO_SETUP_NAME_and_NO_TABLE_NAME():
    """⭐ CONTRACT 4, AND E-4's M10 MEASURED WHY IT IS NOT A STYLE POINT.

    A hand-list that REPLACES a derivation is caught behaviourally; one that
    AGREES with today's taxonomy passes every behavioural test there is. Only a
    rail over the SOURCE kills it — and a derivation necessarily does not spell
    the names a hand-list necessarily does.

    ⛔ FULL EQUALITY, NEVER CONTAINMENT, so a docstring can neither satisfy nor
    defeat it: prose mentions "Wick Play" inside a sentence and never equals it.
    """
    from api.services import ast_table
    constants = _string_constants(ROOT / "api" / "services" / "starter_library.py")
    spelled_setups = constants & sl.setups()
    assert spelled_setups == set(), (
        f"starter_library.py spells {sorted(spelled_setups)} — the taxonomy "
        "gains an entry and the library silently does not")
    spelled_names = constants & ast_table.declared_names()
    assert spelled_names == set(), sorted(spelled_names)


def test_the_source_rail_is_NOT_VACUOUS(tmp_path):
    """The control: a planted hand-list is found BY NAME."""
    planted = tmp_path / "planted.py"
    with io.open(planted, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("SETUPS = ['VCP', 'Wick Play']\n")
    hits = _string_constants(planted) & sl.setups()
    assert hits == {"VCP", "Wick Play"}


def test_the_catalogue_names_no_setup_the_taxonomy_does_not_declare():
    """A starter — or a refusal — written for a name the firm does not declare is
    a decision nobody made, and it can appear in neither half of the partition."""
    r = sl.report()
    assert r["not_in_taxonomy"] == []
    assert r["refusals_not_in_taxonomy"] == []
    assert r["both"] == []


def test_the_catalogue_is_VERSIONED():
    """A change to what the firm's starters ARE is an event somebody reviews."""
    assert sl.version() == sl.CATALOG["version"]
    assert sl.version().strip()
