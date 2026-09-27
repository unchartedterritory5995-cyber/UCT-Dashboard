"""Rails for tools/notebook_bench_corpus.py -- the head-to-head benchmark corpus (wave 9, 9A, A1).

The corpus is only a fair instrument if the four apps get the SAME notes. These rails read every
format back through an independent reader and compare:
  * the UCT payload through the server's own `notes.extract_plain_text` (notes.py:161),
  * the Obsidian vault and the Notion zip through the server's own markdown converter
    (`note_connectors/convert/mddoc.py` `md_to_tiptap`) and then `extract_plain_text`,
  * the ENEX files through `xml.etree` alone.
and they hold the generator to its own promises: determinism, the committed manifest, markers
exactly once per format and never in a title, Windows-safe names, the server's body and batch
caps, and a refusal to write inside the repository.
"""
from __future__ import annotations

import ast
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from tools import notebook_bench_corpus as bc  # noqa: E402
from api.services.journal_two import notes as notes_svc  # noqa: E402
from api.services.journal_two.note_connectors.convert.mddoc import md_to_tiptap  # noqa: E402

COMMITTED_MANIFEST = REPO / "docs" / "notebook" / "benchmark" / "corpus-manifest.json"
_FRONT_MATTER = re.compile(r"\A---\n.*?\n---\n\n?", re.S)


def _collapse(s: str) -> str:
    return " ".join(s.split())


@pytest.fixture(scope="module")
def corpus():
    return bc.build_corpus()


@pytest.fixture(scope="module")
def written(tmp_path_factory, corpus):
    out = tmp_path_factory.mktemp("bench-corpus")
    manifest = bc.write(corpus, out)
    return out, manifest


def _enex_notes(out: Path) -> dict[str, tuple[str, list[str], str]]:
    """title -> (plain text via xml.etree, tags, notebook file) for every note in enex/."""
    found = {}
    for f in sorted((out / "enex").glob("*.enex")):
        root = ET.fromstring(f.read_bytes())
        assert root.tag == "en-export", f"{f.name}: root is {root.tag!r}"
        for note in root.findall("note"):
            title = note.findtext("title")
            enml = note.findtext("content")
            en_note = ET.fromstring(enml)
            assert en_note.tag == "en-note", f"{title}: content root is {en_note.tag!r}"
            assert title not in found, f"duplicate title {title!r} across notebooks"
            found[title] = ("".join(en_note.itertext()), [t.text for t in note.findall("tag")], f.name)
    return found


def _md_plain(md: str) -> str:
    return notes_svc.extract_plain_text(md_to_tiptap(md)["doc"])


# ── determinism and the committed manifest ─────────────────────────────────────────────────

def test_the_same_seed_twice_gives_an_identical_manifest():
    a = bc.manifest_bytes(bc.build_manifest(bc.build_corpus(4242, 40)))
    b = bc.manifest_bytes(bc.build_manifest(bc.build_corpus(4242, 40)))
    assert a == b
    # control: the rail can see a difference -- another seed must NOT hash the same
    c = bc.manifest_bytes(bc.build_manifest(bc.build_corpus(4243, 40)))
    assert c != a


def test_the_committed_manifest_equals_a_fresh_generation():
    assert COMMITTED_MANIFEST.is_file(), "docs/notebook/benchmark/corpus-manifest.json is missing"
    committed = COMMITTED_MANIFEST.read_bytes().replace(b"\r\n", b"\n")
    fresh = bc.manifest_bytes(bc.build_manifest(bc.build_corpus()))
    assert json.loads(committed) == json.loads(fresh), (
        "the committed manifest is stale: regenerate it with "
        "`python tools/notebook_bench_corpus.py --print-manifest`")
    assert committed == fresh


def test_the_default_is_the_ruled_992_notes(corpus):
    """D-9A5 (amending D-9A1): 990 small + the 1,000- and 2,000-paragraph notes, for every app."""
    m = bc.build_manifest(corpus)
    assert (m["counts"]["small_notes"], m["counts"]["large_notes"], m["counts"]["total_notes"]) == (990, 2, 992)
    assert m["counts"]["paste_paragraphs"] == 200
    sizes = sorted(v["paragraphs"] for k, v in m["timed_notes"].items() if k.startswith("large_"))
    assert sizes == [1000, 2000]


def test_the_written_manifest_verifies_and_a_changed_file_is_named(written, tmp_path):
    out, _ = written
    assert bc.verify(out) == []
    # control on a copy: change ONE vault file and --verify must name the vault
    import shutil
    copy = tmp_path / "copy"
    shutil.copytree(out, copy)
    victim = next((copy / "vault").rglob("*.md"))
    victim.write_bytes(victim.read_bytes() + b"tampered\n")
    problems = bc.verify(copy)
    assert any(p.startswith("vault:") for p in problems), problems


# ── the four formats carry the same notes ──────────────────────────────────────────────────

def test_plain_text_is_equal_across_all_four_formats(written, corpus):
    out, _ = written
    payload = {}
    for f in sorted((out / "uct").glob("import-batch-*.json")):
        for n in json.loads(f.read_text(encoding="utf-8"))["notes"]:
            payload[n["title"]] = notes_svc.extract_plain_text(n["bodyJson"])
    vault = {}
    for p in (out / "vault").rglob("*.md"):
        md = p.read_text(encoding="utf-8")
        assert _FRONT_MATTER.match(md), f"{p.name}: no front matter"
        vault[p.stem] = _md_plain(_FRONT_MATTER.sub("", md, count=1))
    notion = {}
    with zipfile.ZipFile(out / "notion-import.zip") as zf:
        for info in zf.infolist():
            md = zf.read(info).decode("utf-8")
            assert not md.startswith("---"), f"{info.filename}: the Notion copy carries front matter"
            notion[Path(info.filename).stem] = _md_plain(md)
    enex = {t: v[0] for t, v in _enex_notes(out).items()}
    titles = {n.title for n in corpus.notes}
    for name, got in (("payload", payload), ("vault", vault), ("notion", notion), ("enex", enex)):
        assert set(got) == titles, f"{name}: {len(got)} notes, titles differ from the model"
    mismatched = []
    for t in sorted(titles):
        texts = {k: _collapse(v[t]) for k, v in (("payload", payload), ("vault", vault),
                                                 ("notion", notion), ("enex", enex))}
        assert texts["payload"], f"{t}: empty body"
        if len(set(texts.values())) != 1:
            mismatched.append(t)
    assert not mismatched, f"{len(mismatched)} notes differ across formats, first: {mismatched[:3]}"


def test_every_marker_occurs_exactly_once_per_format_and_never_in_a_title_or_tag(written, corpus):
    out, manifest = written
    fmt_text = {
        "vault": "\n".join(p.read_text(encoding="utf-8") for p in (out / "vault").rglob("*.md")),
        "enex": "\n".join(p.read_text(encoding="utf-8") for p in (out / "enex").glob("*.enex")),
        "uct": "\n".join(p.read_text(encoding="utf-8") for p in (out / "uct").glob("*.json")),
    }
    with zipfile.ZipFile(out / "notion-import.zip") as zf:
        fmt_text["notion"] = "\n".join(zf.read(i).decode("utf-8") for i in zf.infolist())
    paste = (out / "paste-payload.html").read_text(encoding="utf-8")
    note_markers = {k: v for k, v in manifest["markers"].items() if k != "paste_end"}
    for fmt, text in fmt_text.items():
        for key, m in note_markers.items():
            assert text.count(m) == 1, f"{fmt}: marker {key} ({m}) occurs {text.count(m)} times"
        assert manifest["markers"]["paste_end"] not in text, f"{fmt}: the paste marker leaked into the notes"
    assert paste.count(manifest["markers"]["paste_end"]) == 1
    for m in note_markers.values():
        assert m not in paste, f"note marker {m} is in the paste payload"
    names = [n.title for n in corpus.notes] + [t for n in corpus.notes for t in n.tags]
    names += [p.name for p in (out / "vault").rglob("*")]
    for m in manifest["markers"].values():
        assert not any(m in s for s in names), f"marker {m} appears in a title, tag or file name"
    # the rare term is in exactly ONE note's body, and it is the note the manifest names
    holders = [n.title for n in corpus.notes
               if manifest["markers"]["rare_term"] in notes_svc.extract_plain_text(bc.to_tiptap(n.blocks))]
    assert holders == [manifest["timed_notes"]["rare"]["title"]]


def test_the_switcher_title_is_unique_and_its_words_are_used_nowhere_else(corpus, written):
    _, manifest = written
    title = manifest["switcher_title"]
    assert [n.title for n in corpus.notes].count(title) == 1
    words = title.lower().split()
    for n in corpus.notes:
        body = notes_svc.extract_plain_text(bc.to_tiptap(n.blocks)).lower()
        assert not any(w in body.split() for w in words), f"{n.title}: body uses a switcher word"
        if n.title != title:
            assert not any(w in n.title.lower().split() for w in words), f"{n.title}: shares a switcher word"


def test_timed_notes_put_the_first_marker_in_paragraph_3_past_the_list_preview(corpus):
    for role in ("small", "neutral", "large_1000", "large_2000"):
        note = next(n for n in corpus.notes if n.role == role)
        doc = bc.to_tiptap(note.blocks)
        paras = [notes_svc.extract_plain_text({"type": "doc", "content": [b]}) for b in doc["content"]]
        assert all(b["type"] == "paragraph" for b in doc["content"]), f"{role}: not all paragraphs"
        first, last = corpus.timed[role]["first_marker"], corpus.timed[role]["last_marker"]
        assert first in paras[2] and not any(first in p for i, p in enumerate(paras) if i != 2)
        assert last in paras[-1]
        assert len(paras[0]) + len(paras[1]) > bc.LIST_PREVIEW_CHARS, (
            f"{role}: paragraphs 1+2 must run past the {bc.LIST_PREVIEW_CHARS}-char list preview")
        # the UCT list row's own projection (substr(body_plain, 1, _LIST_PLAIN_CHARS)) never sees it
        plain = notes_svc.extract_plain_text(doc)
        assert first not in plain[: notes_svc._LIST_PLAIN_CHARS]
    assert bc.LIST_PREVIEW_CHARS == notes_svc._LIST_PLAIN_CHARS


def test_bodies_carry_no_cashtag_capital_word_digit_or_date(corpus):
    """A production bench account must not be enrolled in an alert by its own corpus (the wave-8
    sample notebook's trap): no cashtag, no ALL-CAPS word, no digit (so no date), no dated task."""
    for n in corpus.notes:
        plain = notes_svc.extract_plain_text(bc.to_tiptap(n.blocks))
        assert "$" not in plain, f"{n.title}: cashtag"
        assert not re.search(r"\b[A-Z]{2,}\b", plain), f"{n.title}: an ALL-CAPS word"
        assert not re.search(r"\d", plain), f"{n.title}: a digit in the body"
        if n.ticker:
            assert n.ticker.startswith("ZZQ"), f"{n.title}: ticker {n.ticker} is not synthetic"


# ── the ENEX files, the names, and the server's limits ─────────────────────────────────────

def test_enex_is_well_formed_one_file_per_top_level_folder(written, corpus):
    out, manifest = written
    notes = _enex_notes(out)
    tops = {n.folder[0] for n in corpus.notes}
    assert {p.stem for p in (out / "enex").glob("*.enex")} == tops
    assert set(manifest["enex_notebooks"]) == {f"{t}.enex" for t in tops}
    by_title = {n.title: n for n in corpus.notes}
    for title, (_, tags, fname) in notes.items():
        assert fname == f"{by_title[title].folder[0]}.enex", f"{title} is in {fname}"
        assert sorted(tags) == sorted(by_title[title].tags)
    todos = [el for f in (out / "enex").glob("*.enex")
             for note in ET.fromstring(f.read_bytes()).findall("note")
             for el in ET.fromstring(note.findtext("content")).iter("en-todo")]
    assert todos and {t.get("checked") for t in todos} == {"true", "false"}


def test_every_path_component_is_windows_and_obsidian_safe(written):
    out, _ = written
    names = []
    for root in (out / "vault", out / "enex"):
        for p in root.rglob("*"):
            names.append((p.parent, p.name if p.is_dir() else p.name.rsplit(".", 1)[0]))
    with zipfile.ZipFile(out / "notion-import.zip") as zf:
        for info in zf.infolist():
            parts = info.filename.split("/")
            parts[-1] = parts[-1].rsplit(".", 1)[0]
            names.extend(("zip:" + "/".join(parts[:i]), part) for i, part in enumerate(parts))
    problems = [bc.name_problem(n) for _, n in names]
    assert not [p for p in problems if p], [p for p in problems if p][:5]
    # case-insensitive uniqueness per directory (Windows file systems fold case): distinct names
    # in one directory must stay distinct once folded (a zip folder is listed once per member,
    # so the entries are deduplicated first)
    seen: dict = {}
    for parent, n in set((str(p), n) for p, n in names):
        seen.setdefault(parent, set()).add(n)
    dupes = {k: sorted(v) for k, v in seen.items() if len({n.lower() for n in v}) != len(v)}
    assert not dupes
    assert len(seen) > 10, "the uniqueness walk saw almost nothing -- the check is broken"
    # control: the checker is not vacuous
    assert bc.name_problem("a:b") and bc.name_problem("x#y") and bc.name_problem("CON") and bc.name_problem("dot.")


def test_the_body_cap_is_read_from_notes_py_and_the_2000_paragraph_note_fits_it(corpus):
    assert bc.max_body_json_bytes() == notes_svc.MAX_BODY_JSON_BYTES
    big = next(n for n in corpus.notes if n.role == "large_2000")
    size = len(json.dumps(bc.to_tiptap(big.blocks)).encode("utf-8"))   # notes._validate_body_json
    assert size <= notes_svc.MAX_BODY_JSON_BYTES
    notes_svc._validate_body_json(bc.to_tiptap(big.blocks))           # the server's own check passes


def test_uct_batches_stay_inside_the_servers_500_note_limit(written):
    out, _ = written
    batches = sorted((out / "uct").glob("import-batch-*.json"))
    assert [len(json.loads(b.read_text(encoding="utf-8"))["notes"]) for b in batches] == [500, 492]
    # the limit is the server's, not ours: 501 notes are refused before any database is touched
    with pytest.raises(notes_svc.NoteValidationError, match="max 500"):
        notes_svc.import_confirm("u_w9bench_limit", {"notes": [{}] * (bc.UCT_BATCH_MAX + 1)})


def test_the_uct_payload_imports_through_the_servers_own_door(written, corpus):
    """Every batch through `notes.import_confirm` (the route's function) in the test sandbox: all
    992 created, none failed, and the stored plain text is the payload's."""
    out, manifest = written
    uid = "u_w9bench_corpus_import"
    created, failed = 0, []
    for b in sorted((out / "uct").glob("import-batch-*.json")):
        res = notes_svc.import_confirm(uid, json.loads(b.read_text(encoding="utf-8")))
        created += len(res["created"])
        failed += res["failed"]
    assert (created, failed) == (manifest["counts"]["total_notes"], [])
    rows = notes_svc.list_notes(uid, q=manifest["markers"]["rare_term"])
    assert [r["title"] for r in rows] == [manifest["timed_notes"]["rare"]["title"]]


def test_the_generator_imports_nothing_from_api():
    tree = ast.parse((REPO / "tools" / "notebook_bench_corpus.py").read_text(encoding="utf-8"))
    mods = [a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names]
    mods += [n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)]
    assert mods, "the import walk found nothing -- the check is broken"
    assert not [m for m in mods if m == "api" or m.startswith("api.")], mods
    # and a real process agrees: generating a manifest loads no api module
    code = ("import sys; sys.path.insert(0, r'%s'); from tools import notebook_bench_corpus as c; "
            "c.build_manifest(c.build_corpus(1, 8)); "
            "print(sorted(m for m in sys.modules if m == 'api' or m.startswith('api.')))") % REPO
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=str(REPO))
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "[]", out.stdout


def test_an_out_inside_the_repo_or_a_shared_root_is_refused_and_writes_nothing(capsys):
    inside = REPO / "tmp-w9bench-corpus-refused"
    assert bc.main(["--out", str(inside)]) == 3
    assert not inside.exists()
    assert "inside this repository" in capsys.readouterr().out
    shared = r"C:\data\w9bench-corpus" if sys.platform == "win32" else "/data/w9bench-corpus"
    assert bc.main(["--out", shared]) == 3
    assert "shared data root" in capsys.readouterr().out
