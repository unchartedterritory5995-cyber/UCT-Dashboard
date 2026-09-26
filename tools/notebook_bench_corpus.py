"""The head-to-head benchmark corpus: ONE in-memory model per note, written four ways.

Wave 9, lane 9A, item A1. The instrument for the UCT vs Notion vs Evernote vs Obsidian speed
benchmark (docs/notebook/benchmark/protocol.md). This file writes the SAME notes in the four
shapes those apps import, so every app is timed against identical content:

  * ``vault/``            an Obsidian vault: one ``.md`` per note, YAML front matter (created,
                          updated, tags, optional ticker), nested folders up to three levels.
  * ``notion-import.zip`` the same ``.md`` tree, BODY ONLY (no front matter): Notion's markdown
                          import is not known to read YAML front matter as properties, and text it
                          does not understand would land in the page body (not verified -- the
                          protocol checks it at run time). Tags and dates therefore do not travel
                          to Notion; the body text is identical.
  * ``enex/<Top>.enex``   Evernote: one ENEX file per TOP-LEVEL folder. The notebook name is the
                          FILE name -- the UCT adapter reads it from there
                          (app/src/pages/journal-2-0/lib/importer/adapters/evernote.js:9-11), and
                          so does Evernote. Deeper folders flatten into their top-level notebook
                          (recorded per notebook in the manifest). Checklists are ENML
                          ``<en-todo checked="..."/>``.
  * ``uct/import-batch-NNN.json`` the ``POST /api/j2/notes/import/confirm`` payload shape
                          (api/services/journal_two/notes.py:856-865), at most 500 notes per file
                          (notes.py:893-894). The automated UCT runner seeds from these.

Plus ``paste-payload.html`` (200 paragraphs, the H8 paste op) and ``corpus-manifest.json``
(counts, markers, per-format tree sha256, the generator version).

Size (ruling D-9A5, amending D-9A1): **990 small notes + a 1,000- and a 2,000-paragraph note =
992 notes for EVERY app**, so Evernote Starter (1,000 notes) holds the corpus with margin and all
four apps get the same corpus. ``--notes`` is the SMALL-note count. Small-note body length is
log-normal with a median near 65 words, the recipe ``tools/seed_large_notebook.py`` uses
(header ``:13-17``, draw ``:189``: ``lognormvariate(4.2, 1.0)`` clamped to 15..4,000) -- cited,
not imported, because that module imports ``api``.

Content rules (ruling D-9A1): headings, paragraphs, bullet lists, checklists, bold / italic spans
and plain links only. NO tables, images, math, code, embeds or attachments -- the four apps do
not import those alike. No cashtag, no ALL-CAPS word, no date in any body, and no dated task: a
production bench account must not be enrolled in any alert by its own corpus (the wave-8 sample
notebook's trap, ``wave8-dispatch-plan.md`` D-C6). Tickers, where a note has one, are synthetic
(``ZZQ*``) and live only in the front matter / payload field, never in prose.

Markers (in the manifest), each a lowercase nonsense token in the convention of
``tools/notebook_scale_benchmark.py``'s ``_RARE_MARKER`` (``zzqbenchmarkrareterm``):
  * ``rare_term``      in exactly ONE note's body -- the H4 search target;
  * ``switcher_title`` a unique title built from words no other title or body uses -- the H5 target;
  * per timed note a ``first_marker`` in PARAGRAPH 3 (past any list-preview length: paragraphs 1+2
    are longer than the 400 characters the UCT list row carries, ``notes.py`` ``_LIST_PLAIN_CHARS``,
    and still inside the first screen) and a ``last_marker`` in its FINAL paragraph;
  * the paste payload's ``end_marker``.
A marker never appears in a title, a tag or any other note; the rails count it per format.

⛔ THIS FILE IMPORTS NOTHING FROM ``api/``. A bare run must not be able to reach ``C:\\data``.
``MAX_BODY_JSON_BYTES`` is READ from notes.py's source with ``ast`` (never imported, never
retyped), and every body is asserted to fit it. ``--out`` is refused inside this repository and
inside a shared data root (``notebook_perf_harness.refuse_shared_root`` -- one implementation).

    python tools/notebook_bench_corpus.py --out C:\\Users\\<you>\\bench-corpus      # write it
    python tools/notebook_bench_corpus.py --verify C:\\Users\\<you>\\bench-corpus   # re-check it
    python tools/notebook_bench_corpus.py --print-manifest                          # manifest only

Exit: 0 written / verified; 1 ``--verify`` found a difference (named); 3 refused (bad args, an
``--out`` inside the repo or a shared data root, a non-empty ``--out``).
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import io
import json
import os
import random
import re
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape as _xml_escape
from xml.sax.saxutils import quoteattr as _xml_quoteattr

REPO = Path(__file__).resolve().parents[1]
NOTES_PY = REPO / "api" / "services" / "journal_two" / "notes.py"

GENERATOR_VERSION = "notebook-bench-corpus/1"
DEFAULT_SEED = 20260926
DEFAULT_SMALL_NOTES = 990          # ruling D-9A5: 990 small + 2 large = 992 for every app
LARGE_SIZES = (1000, 2000)         # the two large notes, in paragraphs
PASTE_PARAGRAPHS = 200
UCT_BATCH_MAX = 500                # notes.py:893-894 -- "too many notes in one batch (max 500)"
UCT_IMPORT_SOURCE = "notebook-bench-corpus"
LIST_PREVIEW_CHARS = 400           # notes.py `_LIST_PLAIN_CHARS`: what a UCT list row carries
MANIFEST_NAME = "corpus-manifest.json"
# Every file the four formats hold is written from this fixed instant's calendar (an ENEX export
# date, a zip entry time). Nothing in the corpus reads the wall clock.
EPOCH = datetime(2025, 1, 6, 14, 30, 0, tzinfo=timezone.utc)

# ── the words (all lowercase; nothing here is a ticker in prose, a company name or a date) ─────

_BODY_WORDS = (
    "price volume base range trend pullback breakout support level entry exit stop target risk "
    "plan review setup session morning afternoon week month quarter chart candle wick body line "
    "average slope tight loose quiet heavy light early late patient calm steady rising falling "
    "higher lower strong weak clean messy note idea lesson habit rule process checklist journal "
    "sizing position scale partial trim hold patience discipline focus market sector group leader "
    "laggard theme rotation cycle pause reset follow through confirm reject retest reclaim "
    "undercut shelf ledge ridge valley river harbor lantern meadow orchard copper amber cedar "
    "granite willow ember signal noise tape rhythm pattern context bias edge sample outcome "
    "expectancy drawdown recovery streak account buffer margin reason evidence question answer "
    "later today tomorrow before after while because when then again still only never always "
    "the a an of to in on at for with from by and or but so if it this that these those is was "
    "are were be been has have had will would could should may might must can not no yes more "
    "less most least each every some any all both few many much small large new old first last "
    "next other same different good better best poor worse right wrong fair true clear open"
).split()
_TITLE_ADJ = ("quiet amber steady early calm bright hollow narrow gentle silver russet pale "
              "brisk mellow sunlit misty rugged tidy frosted sheltered").split()
_TITLE_NOUN = ("harbor lantern ledger orchard ridge meadow river willow cedar granite ember "
               "valley shelf ledge beacon compass journal notebook sketch outline").split()
# The switcher title is built from these alone; no other title or body uses any of them.
_RESERVED_WORDS = ("vireo cobalt almanac quokka zephyr marzipan tamarind obelisk").split()
_TOP_FOLDERS = ("Daily log", "Research", "Playbooks", "Reviews", "Ideas", "Reading")
BENCH_FOLDER = "Bench"             # the timed notes live here, alone, easy to find in every app
_SUB_FOLDERS = ("Spring", "Summer", "Autumn", "Winter")
_TAGS = ("review idea watch plan lesson draft followup routine question summary process "
         "checklist habit context sizing reset theme rotation evening morning weekly monthly "
         "archive-me reread").split()
_SYNTH_TICKERS = ("ZZQA", "ZZQB", "ZZQC", "ZZQD", "ZZQE")
_MARKER_PREFIX = "zzqb"            # notebook_scale_benchmark.py's `_RARE_MARKER` convention

# Title / path-component safety: none of these characters (Windows, Obsidian links, Notion).
FORBIDDEN_NAME_CHARS = set('\\/:*?"<>|#^[]')
_WINDOWS_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)),
                     *(f"lpt{i}" for i in range(1, 10))}


def max_body_json_bytes() -> int:
    """``MAX_BODY_JSON_BYTES`` READ from notes.py by ``ast`` -- the server's one authority,
    never imported (this module imports nothing from ``api/``) and never retyped."""
    tree = ast.parse(NOTES_PY.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "MAX_BODY_JSON_BYTES" for t in node.targets):
            return int(ast.literal_eval(node.value))
    raise RuntimeError(f"MAX_BODY_JSON_BYTES not found in {NOTES_PY}")


# ── the model ────────────────────────────────────────────────────────────────────────────────

@dataclass
class Span:
    """One inline run: plain text, or text carrying ONE mark (bold, italic or a link)."""
    text: str
    mark: str | None = None        # None | "bold" | "italic" | "link"
    href: str | None = None


@dataclass
class Block:
    kind: str                      # "heading" | "paragraph" | "bullets" | "checklist"
    spans: list[Span] = field(default_factory=list)            # heading / paragraph
    items: list[list[Span]] = field(default_factory=list)      # bullets / checklist
    checked: list[bool] = field(default_factory=list)          # checklist
    level: int = 2                                             # heading


@dataclass
class Note:
    index: int
    key: str
    title: str
    folder: tuple[str, ...]
    tags: list[str]
    ticker: str | None
    created: datetime
    updated: datetime
    blocks: list[Block]
    role: str | None = None        # "small" | "neutral" | "large_1000" | "large_2000" | "rare" | "switcher"


@dataclass
class Corpus:
    seed: int
    small_notes: int
    notes: list[Note]
    markers: dict
    timed: dict
    paste_blocks: list[Block]


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _en_date(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _sentence(rng: random.Random, n: int) -> list[str]:
    words = [rng.choice(_BODY_WORDS) for _ in range(n)]
    words[0] = words[0].capitalize()
    if n > 6 and rng.random() < 0.3:
        k = rng.randint(2, n - 3)
        words[k] = words[k] + ","
    words[-1] = words[-1] + "."
    return words


def _paragraph_words(rng: random.Random, n_words: int) -> list[str]:
    out: list[str] = []
    while len(out) < n_words:
        out.extend(_sentence(rng, min(rng.randint(6, 14), max(3, n_words - len(out)))))
    return out


def _spans_from_words(rng: random.Random, words: list[str], link_base: str, allow_marks: bool = True) -> list[Span]:
    """Words -> spans, with an occasional bold, italic or link run over 1-3 whole words."""
    spans: list[Span] = []
    i, n, link_k = 0, len(words), 0
    buf: list[str] = []

    def flush() -> None:
        if buf:
            spans.append(Span(" ".join(buf) + " "))
            buf.clear()

    while i < n:
        r = rng.random() if allow_marks else 1.0
        if r < 0.05 and i < n - 1:
            mark = ("bold", "italic", "link")[rng.randrange(3)]
            k = min(n - i, rng.randint(1, 3))
            flush()
            text = " ".join(words[i:i + k])
            href = None
            if mark == "link":
                link_k += 1
                href = f"{link_base}/{link_k}"
            spans.append(Span(text, mark, href))
            if i + k < n:
                spans.append(Span(" "))
            i += k
            continue
        buf.append(words[i])
        i += 1
    if buf:
        spans.append(Span(" ".join(buf)))
    # merge adjacent plain spans and strip a trailing space off the last run
    merged: list[Span] = []
    for s in spans:
        if merged and s.mark is None and merged[-1].mark is None:
            merged[-1] = Span(merged[-1].text + s.text)
        else:
            merged.append(s)
    if merged and merged[-1].mark is None:
        merged[-1] = Span(merged[-1].text.rstrip())
        if not merged[-1].text:
            merged.pop()
    return merged


def _plain_para(words: list[str]) -> Block:
    return Block("paragraph", spans=[Span(" ".join(words))])


def _word_count(rng: random.Random) -> int:
    """tools/seed_large_notebook.py:189 -- lognormvariate(4.2, 1.0), clamped to 15..4000."""
    return max(15, min(4000, int(rng.lognormvariate(4.2, 1.0))))


def _random_blocks(rng: random.Random, n_words: int, link_base: str) -> list[Block]:
    blocks: list[Block] = []
    left = n_words
    # Levels 2 and 3 only: a level-1 heading can be read as the PAGE title by an importer (Notion's
    # markdown import is believed to; not verified), which would move text out of the body.
    if rng.random() < 0.3:
        blocks.append(Block("heading", spans=[Span(" ".join(_sentence(rng, rng.randint(2, 5)))[:-1])],
                            level=rng.choice((2, 3))))
    while left > 0:
        r = rng.random()
        prev_list = bool(blocks) and blocks[-1].kind in ("bullets", "checklist")
        if r < 0.12 and not prev_list and left >= 6:
            n_items = rng.randint(2, 5)
            items = [_spans_from_words(rng, _sentence(rng, rng.randint(3, 8)), link_base) for _ in range(n_items)]
            blocks.append(Block("bullets", items=items))
            left -= sum(len(" ".join(s.text for s in it).split()) for it in items)
        elif r < 0.22 and not prev_list and left >= 6:
            n_items = rng.randint(2, 5)
            items = [_spans_from_words(rng, _sentence(rng, rng.randint(3, 7)), link_base) for _ in range(n_items)]
            blocks.append(Block("checklist", items=items, checked=[rng.random() < 0.4 for _ in items]))
            left -= sum(len(" ".join(s.text for s in it).split()) for it in items)
        elif r < 0.28 and blocks and blocks[-1].kind != "heading":
            blocks.append(Block("heading", spans=[Span(" ".join(_sentence(rng, rng.randint(2, 5)))[:-1])],
                                level=rng.choice((2, 3))))
        else:
            take = min(left, rng.randint(20, 60))
            blocks.append(Block("paragraph", spans=_spans_from_words(rng, _paragraph_words(rng, take), link_base)))
            left -= take
    return blocks


def _timed_blocks(rng: random.Random, n_paras: int, first_marker: str, last_marker: str) -> list[Block]:
    """A timed note: ``n_paras`` paragraphs, the first marker in paragraph 3, the last in the
    final paragraph. Paragraphs 1+2 run past the UCT list row's 400 characters of plain text
    (``notes.py`` ``_LIST_PLAIN_CHARS``) so paragraph 3 is never in a list preview."""
    paras: list[Block] = []
    for i in range(n_paras):
        words = _paragraph_words(rng, 45 if i < 2 else rng.randint(18, 32))
        if i == 2:
            words.insert(min(4, len(words) - 1), first_marker)
        if i == n_paras - 1:
            words.insert(len(words) - 1, last_marker)
        if i in (2, n_paras - 1):
            paras.append(_plain_para(words))       # a marker never sits inside a mark
        else:
            paras.append(Block("paragraph", spans=_spans_from_words(rng, words, "https://example.com/bench/timed")))
    return paras


def _letters(rng: random.Random, n: int) -> str:
    return "".join(rng.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(n))


def build_corpus(seed: int = DEFAULT_SEED, small_notes: int = DEFAULT_SMALL_NOTES) -> Corpus:
    """The ONE in-memory model. Every format below is written from it; nothing reads the clock."""
    if small_notes < 4:
        raise ValueError("--notes must be at least 4 (the small, neutral, rare and switcher notes)")
    rng = random.Random(seed)
    suffix = _letters(rng, 6)
    markers = {
        "rare_term": f"{_MARKER_PREFIX}rare{suffix}",
        "small_first": f"{_MARKER_PREFIX}smallfirst{suffix}",
        "small_last": f"{_MARKER_PREFIX}smalllast{suffix}",
        "neutral_first": f"{_MARKER_PREFIX}neutralfirst{suffix}",
        "neutral_last": f"{_MARKER_PREFIX}neutrallast{suffix}",
        "large_1000_first": f"{_MARKER_PREFIX}onekfirst{suffix}",
        "large_1000_last": f"{_MARKER_PREFIX}oneklast{suffix}",
        "large_2000_first": f"{_MARKER_PREFIX}twokfirst{suffix}",
        "large_2000_last": f"{_MARKER_PREFIX}twoklast{suffix}",
        "paste_end": f"{_MARKER_PREFIX}pasteend{suffix}",
    }
    reserved = list(_RESERVED_WORDS)
    rng.shuffle(reserved)
    switcher_title = " ".join(reserved[:3]).capitalize()

    notes: list[Note] = []

    def stamp(old: bool = False, newest: int | None = None) -> tuple[datetime, datetime]:
        if newest is not None:                      # the timed notes: the newest in the library
            created = EPOCH + timedelta(days=430, minutes=newest)
            return created, created + timedelta(minutes=1)
        if old:                                     # the search / switcher targets: the oldest
            created = EPOCH - timedelta(days=rng.randint(30, 60), minutes=rng.randint(0, 600))
            return created, created + timedelta(minutes=rng.randint(1, 50))
        created = EPOCH + timedelta(days=rng.randint(0, 400), minutes=rng.randint(0, 1439))
        return created, created + timedelta(days=rng.randint(0, 20), minutes=rng.randint(0, 600))

    def random_folder() -> tuple[str, ...]:
        top = rng.choice(_TOP_FOLDERS)
        depth = rng.choices((1, 2, 3), weights=(45, 35, 20))[0]
        path = [top]
        if depth >= 2:
            path.append(rng.choice(_SUB_FOLDERS))
        if depth >= 3:
            path.append(f"Week {rng.randint(1, 6):02d}")
        return tuple(path)

    def random_tags() -> list[str]:
        return sorted(rng.sample(_TAGS, rng.choice((0, 1, 1, 2, 2, 3))))

    # Indices 0..3 are the special small notes; 4..small_notes-1 the ordinary ones; then the two
    # large ones. Every note consumes the SAME rng stream in this order, so a seed fixes them all.
    special = {0: "small", 1: "neutral", 2: "rare", 3: "switcher"}
    for i in range(small_notes):
        role = special.get(i)
        key = f"bench:{seed}:{i:04d}"
        base = f"https://example.com/bench/{i:04d}"
        if role == "small":
            title, folder = "Bench small note", (BENCH_FOLDER,)
            created, updated = stamp(newest=0)
            blocks = _timed_blocks(rng, 5, markers["small_first"], markers["small_last"])
            tags, ticker = ["routine"], None
        elif role == "neutral":
            title, folder = "Bench neutral note", (BENCH_FOLDER,)
            created, updated = stamp(newest=1)
            blocks = _timed_blocks(rng, 5, markers["neutral_first"], markers["neutral_last"])
            tags, ticker = ["routine"], None
        else:
            adj, noun1, noun2 = rng.choice(_TITLE_ADJ), rng.choice(_TITLE_NOUN), rng.choice(_TITLE_NOUN)
            title = f"{adj.capitalize()} {noun1} {noun2} {i:04d}"
            folder = random_folder()
            created, updated = stamp(old=role in ("rare", "switcher"))
            blocks = _random_blocks(rng, _word_count(rng), base)
            tags = random_tags()
            ticker = rng.choice(_SYNTH_TICKERS) if rng.random() < 0.25 else None
            if role == "switcher":
                title = switcher_title
            if role == "rare":
                # into a plain paragraph of its own, so the term never sits inside a mark
                blocks.append(_plain_para(_paragraph_words(rng, 12)[:-1] + [markers["rare_term"] + "."]))
        notes.append(Note(i, key, title, folder, tags, ticker, created, updated, blocks, role))
    for j, size in enumerate(LARGE_SIZES):
        i = small_notes + j
        role = f"large_{size}"
        created, updated = stamp(newest=2 + j)
        notes.append(Note(i, f"bench:{seed}:{i:04d}", f"Bench large note {size}", (BENCH_FOLDER,),
                          ["reread"], None, created, updated,
                          _timed_blocks(rng, size, markers[f"{role}_first"], markers[f"{role}_last"]), role))

    paste_blocks: list[Block] = []
    for p in range(PASTE_PARAGRAPHS):
        words = _paragraph_words(rng, rng.randint(20, 40))
        if p == PASTE_PARAGRAPHS - 1:
            words.insert(len(words) - 1, markers["paste_end"])
            paste_blocks.append(_plain_para(words))
        else:
            paste_blocks.append(Block("paragraph", spans=_spans_from_words(rng, words, "https://example.com/bench/paste")))

    by_role = {n.role: n for n in notes if n.role}
    timed = {
        "small": _timed_entry(by_role["small"], markers["small_first"], markers["small_last"]),
        "neutral": _timed_entry(by_role["neutral"], markers["neutral_first"], markers["neutral_last"]),
        "large_1000": _timed_entry(by_role["large_1000"], markers["large_1000_first"], markers["large_1000_last"]),
        "large_2000": _timed_entry(by_role["large_2000"], markers["large_2000_first"], markers["large_2000_last"]),
        "rare": {"title": by_role["rare"].title, "key": by_role["rare"].key,
                 "folder": list(by_role["rare"].folder), "term": markers["rare_term"]},
        "switcher": {"title": switcher_title, "key": by_role["switcher"].key,
                     "folder": list(by_role["switcher"].folder)},
    }
    return Corpus(seed, small_notes, notes, markers, timed, paste_blocks)


def _timed_entry(note: Note, first: str, last: str) -> dict:
    return {"title": note.title, "key": note.key, "folder": list(note.folder),
            "paragraphs": sum(1 for b in note.blocks if b.kind == "paragraph"),
            "first_marker": first, "last_marker": last}


# ── the four writers (each derived from the model; none reads another) ─────────────────────────

def _tt_text(span: Span) -> dict:
    node: dict = {"type": "text", "text": span.text}
    if span.mark == "link":
        node["marks"] = [{"type": "link", "attrs": {"href": span.href}}]
    elif span.mark:
        node["marks"] = [{"type": span.mark}]
    return node


def _tt_para(spans: list[Span]) -> dict:
    node: dict = {"type": "paragraph"}
    if spans:
        node["content"] = [_tt_text(s) for s in spans]
    return node


def to_tiptap(blocks: list[Block]) -> dict:
    """The TipTap document the UCT payload carries -- the shape ``md_to_tiptap`` produces for
    the same markdown (api/services/journal_two/note_connectors/convert/mddoc.py)."""
    content = []
    for b in blocks:
        if b.kind == "heading":
            content.append({"type": "heading", "attrs": {"level": b.level},
                            "content": [_tt_text(s) for s in b.spans]})
        elif b.kind == "paragraph":
            content.append(_tt_para(b.spans))
        elif b.kind == "bullets":
            content.append({"type": "bulletList", "content": [
                {"type": "listItem", "content": [_tt_para(it)]} for it in b.items]})
        elif b.kind == "checklist":
            content.append({"type": "taskList", "content": [
                {"type": "taskItem", "attrs": {"checked": c}, "content": [_tt_para(it)]}
                for it, c in zip(b.items, b.checked)]})
    return {"type": "doc", "content": content}


def _md_inline(spans: list[Span]) -> str:
    out = []
    for s in spans:
        if s.mark == "bold":
            out.append(f"**{s.text}**")
        elif s.mark == "italic":
            out.append(f"*{s.text}*")
        elif s.mark == "link":
            out.append(f"[{s.text}]({s.href})")
        else:
            out.append(s.text)
    return "".join(out)


def to_markdown(blocks: list[Block]) -> str:
    parts = []
    for b in blocks:
        if b.kind == "heading":
            parts.append("#" * b.level + " " + _md_inline(b.spans))
        elif b.kind == "paragraph":
            parts.append(_md_inline(b.spans))
        elif b.kind == "bullets":
            parts.append("\n".join("- " + _md_inline(it) for it in b.items))
        elif b.kind == "checklist":
            parts.append("\n".join(f"- [{'x' if c else ' '}] " + _md_inline(it)
                                   for it, c in zip(b.items, b.checked)))
    return "\n\n".join(parts) + "\n"


def front_matter(note: Note) -> str:
    lines = ["---", f"created: {_iso(note.created)}", f"updated: {_iso(note.updated)}"]
    if note.tags:
        lines.append("tags:")
        lines.extend(f"  - {t}" for t in note.tags)
    if note.ticker:
        lines.append(f"ticker: {note.ticker}")
    lines.append("---")
    return "\n".join(lines) + "\n"


def _enml_inline(spans: list[Span]) -> str:
    out = []
    for s in spans:
        t = _xml_escape(s.text)
        if s.mark == "bold":
            out.append(f"<b>{t}</b>")
        elif s.mark == "italic":
            out.append(f"<i>{t}</i>")
        elif s.mark == "link":
            out.append(f"<a href={_xml_quoteattr(s.href or '')}>{t}</a>")
        else:
            out.append(t)
    return "".join(out)


def to_enml(blocks: list[Block]) -> str:
    """ENML. Every block ends with a newline so a plain ``itertext()`` keeps blocks apart."""
    body = []
    for b in blocks:
        if b.kind == "heading":
            body.append(f"<h{b.level}>{_enml_inline(b.spans)}</h{b.level}>")
        elif b.kind == "paragraph":
            body.append(f"<div>{_enml_inline(b.spans)}</div>")
        elif b.kind == "bullets":
            body.append("<ul>\n" + "\n".join(f"<li><div>{_enml_inline(it)}</div></li>" for it in b.items) + "\n</ul>")
        elif b.kind == "checklist":
            body.extend(f'<div><en-todo checked="{"true" if c else "false"}"/>{_enml_inline(it)}</div>'
                        for it, c in zip(b.items, b.checked))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
            '<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">\n'
            "<en-note>\n" + "\n".join(body) + "\n</en-note>")


def to_enex(notes: list[Note], export_date: datetime) -> str:
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">',
           f'<en-export export-date="{_en_date(export_date)}" application="notebook_bench_corpus" '
           f'version="{GENERATOR_VERSION}">']
    for n in notes:
        out.append("<note>")
        out.append(f"<title>{_xml_escape(n.title)}</title>")
        out.append(f"<created>{_en_date(n.created)}</created>")
        out.append(f"<updated>{_en_date(n.updated)}</updated>")
        out.extend(f"<tag>{_xml_escape(t)}</tag>" for t in n.tags)
        out.append(f"<content><![CDATA[{to_enml(n.blocks)}]]></content>")
        out.append("</note>")
    out.append("</en-export>")
    return "\n".join(out) + "\n"


def payload_note(note: Note) -> dict:
    """One note in the ``import_confirm`` shape (notes.py:856-865)."""
    item = {"importKey": note.key, "title": note.title, "bodyJson": to_tiptap(note.blocks),
            "tags": list(note.tags), "createdAt": _iso(note.created), "updatedAt": _iso(note.updated),
            "folderPath": list(note.folder)}
    if note.ticker:
        item["ticker"] = note.ticker
    return item


def paste_html(blocks: list[Block]) -> str:
    body = "\n".join(f"<p>{_enml_inline(b.spans)}</p>" for b in blocks)
    return ('<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>Bench paste payload</title></head>\n'
            f"<body>\n{body}\n</body></html>\n")


def paste_plain(blocks: list[Block]) -> str:
    return "\n\n".join("".join(s.text for s in b.spans) for b in blocks) + "\n"


def note_relpath(note: Note) -> str:
    return "/".join(list(note.folder) + [note.title + ".md"])


def render(corpus: Corpus) -> dict[str, dict[str, bytes]]:
    """Every file of every format, as bytes, keyed by format then by relative POSIX path. The
    notion zip's MEMBERS are listed here; the zip itself is assembled from them by ``write``."""
    vault, notion, uct = {}, {}, {}
    for n in corpus.notes:
        md = to_markdown(n.blocks)
        vault[note_relpath(n)] = (front_matter(n) + "\n" + md).encode("utf-8")
        notion[note_relpath(n)] = md.encode("utf-8")
    enex: dict[str, bytes] = {}
    tops = sorted({n.folder[0] for n in corpus.notes})
    for top in tops:
        members = [n for n in corpus.notes if n.folder[0] == top]
        enex[f"{top}.enex"] = to_enex(members, EPOCH).encode("utf-8")
    items = [payload_note(n) for n in corpus.notes]
    for b in range(0, len(items), UCT_BATCH_MAX):
        batch = {"source": UCT_IMPORT_SOURCE, "destFolderId": None, "notes": items[b:b + UCT_BATCH_MAX]}
        uct[f"import-batch-{b // UCT_BATCH_MAX + 1:03d}.json"] = (
            json.dumps(batch, indent=1, sort_keys=True) + "\n").encode("utf-8")
    paste = {"paste-payload.html": paste_html(corpus.paste_blocks).encode("utf-8"),
             "paste-payload.txt": paste_plain(corpus.paste_blocks).encode("utf-8")}
    return {"vault": vault, "notion": notion, "enex": enex, "uct": uct, "paste": paste}


def tree_sha256(files: dict[str, bytes]) -> str:
    """sha256 over sorted ``<relpath>  <sha256(bytes)>`` lines -- a digest of a TREE that does not
    depend on how it was stored (a zip's compressed bytes vary with the zlib build; its members
    do not)."""
    lines = [f"{p}  {hashlib.sha256(files[p]).hexdigest()}" for p in sorted(files)]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def build_manifest(corpus: Corpus, rendered: dict[str, dict[str, bytes]] | None = None) -> dict:
    rendered = rendered or render(corpus)
    cap = max_body_json_bytes()
    largest = max(len(json.dumps(to_tiptap(n.blocks)).encode("utf-8")) for n in corpus.notes)
    folders = sorted({"/".join(n.folder[:k]) for n in corpus.notes for k in range(1, len(n.folder) + 1)})
    notebooks = {}
    for name in sorted(rendered["enex"]):
        top = name[: -len(".enex")]
        members = [n for n in corpus.notes if n.folder[0] == top]
        notebooks[name] = {"notebook": top, "notes": len(members),
                           "subfolders_flattened_into_it": len({"/".join(n.folder[1:]) for n in members
                                                                if len(n.folder) > 1})}
    return {
        "generator": "tools/notebook_bench_corpus.py",
        "generator_version": GENERATOR_VERSION,
        "seed": corpus.seed,
        "ruling": "D-9A5 (amending D-9A1): 990 small notes + a 1,000- and a 2,000-paragraph note "
                  "= 992 notes for EVERY app; no attachments",
        "counts": {
            "small_notes": corpus.small_notes,
            "large_notes": len(LARGE_SIZES),
            "total_notes": len(corpus.notes),
            "folders": len(folders),
            "top_level_folders": len({n.folder[0] for n in corpus.notes}),
            "tags": len({t for n in corpus.notes for t in n.tags}),
            "notes_with_ticker": sum(1 for n in corpus.notes if n.ticker),
            "uct_batches": len(rendered["uct"]),
            "paste_paragraphs": len(corpus.paste_blocks),
        },
        "limits": {
            "max_body_json_bytes": cap,
            "max_body_json_bytes_source": "api/services/journal_two/notes.py MAX_BODY_JSON_BYTES (read by ast)",
            "largest_body_json_bytes": largest,
            "uct_batch_max": UCT_BATCH_MAX,
            "list_preview_chars": LIST_PREVIEW_CHARS,
        },
        "markers": dict(corpus.markers),
        "switcher_title": corpus.timed["switcher"]["title"],
        "timed_notes": corpus.timed,
        "enex_notebooks": notebooks,
        "formats": {
            "vault": {"path": "vault/", "files": len(rendered["vault"]), "tree_sha256": tree_sha256(rendered["vault"])},
            "notion": {"path": "notion-import.zip", "files": len(rendered["notion"]),
                       "tree_sha256": tree_sha256(rendered["notion"]),
                       "note": "members hashed, not the zip bytes"},
            "enex": {"path": "enex/", "files": len(rendered["enex"]), "tree_sha256": tree_sha256(rendered["enex"])},
            "uct": {"path": "uct/", "files": len(rendered["uct"]), "tree_sha256": tree_sha256(rendered["uct"])},
            "paste": {"path": "paste-payload.html", "files": len(rendered["paste"]),
                      "tree_sha256": tree_sha256(rendered["paste"])},
        },
    }


def manifest_bytes(manifest: dict) -> bytes:
    return (json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


# ── safety ──────────────────────────────────────────────────────────────────────────────────

def name_problem(name: str) -> str | None:
    """Why ``name`` is not a safe file/folder name on Windows and in Obsidian, or None."""
    if not name or name != name.strip():
        return f"{name!r}: empty or padded with whitespace"
    bad = sorted(set(name) & FORBIDDEN_NAME_CHARS)
    if bad:
        return f"{name!r}: contains {''.join(bad)!r}"
    if name.endswith("."):
        return f"{name!r}: ends with a dot"
    if name.split(".")[0].lower() in _WINDOWS_RESERVED:
        return f"{name!r}: a reserved Windows device name"
    if len(name) > 120:
        return f"{name!r}: longer than 120 characters"
    return None


def refuse_out(out: str) -> str | None:
    """Why ``--out`` is refused, or None: inside this repository, or inside a shared data root."""
    if str(REPO / "tools") not in sys.path:
        sys.path.insert(0, str(REPO / "tools"))
    from notebook_perf_harness import refuse_shared_root  # one implementation (harness :206)
    why = refuse_shared_root(out)
    if why:
        return why
    resolved = os.path.normcase(os.path.abspath(out))
    repo = os.path.normcase(os.path.abspath(REPO))
    if resolved == repo or resolved.startswith(repo.rstrip("\\/") + os.sep):
        return f"{out!r} resolves to {resolved!r}, inside this repository ({repo}); the corpus is never committed"
    return None


def _assert_model(corpus: Corpus) -> None:
    """The model's own invariants, checked before anything is written."""
    titles = [n.title for n in corpus.notes]
    assert len({t.lower() for t in titles}) == len(titles), "titles are not unique (case-insensitive)"
    for n in corpus.notes:
        for part in list(n.folder) + [n.title]:
            p = name_problem(part)
            assert p is None, p
        assert 1 <= len(n.folder) <= 3, f"{n.title}: folder depth {len(n.folder)}"
    cap = max_body_json_bytes()
    for n in corpus.notes:
        size = len(json.dumps(to_tiptap(n.blocks)).encode("utf-8"))   # notes.py _validate_body_json
        assert size <= cap, f"{n.title}: body JSON {size} bytes > MAX_BODY_JSON_BYTES {cap}"
    vals = list(corpus.markers.values())
    for a in vals:
        assert not any(a != b and a in b for b in vals), f"marker {a!r} is inside another marker"
    for role in ("small", "neutral", "large_1000", "large_2000"):
        note = next(n for n in corpus.notes if n.role == role)
        lead = " ".join("".join(s.text for s in b.spans) for b in note.blocks[:2])
        assert len(lead) > LIST_PREVIEW_CHARS, (
            f"{note.title}: paragraphs 1+2 are {len(lead)} chars; paragraph 3's marker must sit past "
            f"the {LIST_PREVIEW_CHARS}-char list preview")


def write(corpus: Corpus, out: Path) -> dict:
    """Write every format under ``out`` (which must not exist or must be empty) and return the
    manifest, which is written LAST as ``corpus-manifest.json``."""
    _assert_model(corpus)
    rendered = render(corpus)
    manifest = build_manifest(corpus, rendered)
    out.mkdir(parents=True, exist_ok=True)
    for rel, data in rendered["vault"].items():
        p = out / "vault" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    by_rel = {note_relpath(n): n for n in corpus.notes}
    for rel, n in by_rel.items():                  # Obsidian's "modified" sort follows the model
        ts = n.updated.timestamp()
        os.utime(out / "vault" / rel, (ts, ts))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in sorted(rendered["notion"]):
            info = zipfile.ZipInfo(rel, date_time=(EPOCH.year, EPOCH.month, EPOCH.day, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, rendered["notion"][rel])
    (out / "notion-import.zip").write_bytes(buf.getvalue())
    for fmt in ("enex", "uct"):
        (out / fmt).mkdir(exist_ok=True)
        for rel, data in rendered[fmt].items():
            (out / fmt / rel).write_bytes(data)
    for rel, data in rendered["paste"].items():
        (out / rel).write_bytes(data)
    (out / MANIFEST_NAME).write_bytes(manifest_bytes(manifest))
    return manifest


def read_tree(out: Path) -> dict[str, dict[str, bytes]]:
    """The four formats as they are ON DISK under ``out`` -- what ``--verify`` hashes."""
    def walk(root: Path) -> dict[str, bytes]:
        if not root.is_dir():
            return {}
        return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    notion: dict[str, bytes] = {}
    zp = out / "notion-import.zip"
    if zp.is_file():
        with zipfile.ZipFile(zp) as zf:
            notion = {i.filename: zf.read(i) for i in zf.infolist() if not i.is_dir()}
    paste = {name: (out / name).read_bytes() for name in ("paste-payload.html", "paste-payload.txt")
             if (out / name).is_file()}
    return {"vault": walk(out / "vault"), "notion": notion, "enex": walk(out / "enex"),
            "uct": walk(out / "uct"), "paste": paste}


def verify(out: Path) -> list[str]:
    """Recompute the manifest from its own seed and note count, and re-hash the files on disk.
    Returns every difference, named; an empty list is a verified corpus."""
    mpath = out / MANIFEST_NAME
    if not mpath.is_file():
        return [f"no {MANIFEST_NAME} in {out}"]
    stored = json.loads(mpath.read_text(encoding="utf-8"))
    problems = []
    if stored.get("generator_version") != GENERATOR_VERSION:
        problems.append(f"generator_version {stored.get('generator_version')!r} != this file's {GENERATOR_VERSION!r}")
    fresh = build_manifest(build_corpus(int(stored.get("seed", -1)), int(stored.get("counts", {}).get("small_notes", 0))))
    for k in sorted(set(fresh) | set(stored)):
        if fresh.get(k) != stored.get(k):
            problems.append(f"manifest key {k!r} differs from a fresh generation")
    on_disk = read_tree(out)
    for fmt, spec in sorted(stored.get("formats", {}).items()):
        got = tree_sha256(on_disk.get(fmt, {}))
        if got != spec.get("tree_sha256"):
            problems.append(f"{fmt}: files on disk hash to {got[:12]}, the manifest says "
                            f"{str(spec.get('tree_sha256'))[:12]} ({len(on_disk.get(fmt, {}))} files found)")
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--notes", type=int, default=DEFAULT_SMALL_NOTES,
                    help=f"small notes (default {DEFAULT_SMALL_NOTES}, ruling D-9A5); the two large notes are added")
    ap.add_argument("--out", default=None, help="write the corpus here (outside the repo, outside C:\\data)")
    ap.add_argument("--verify", default=None, metavar="DIR", help="recompute and compare a written corpus")
    ap.add_argument("--print-manifest", action="store_true", help="print the manifest (LF bytes) and write nothing")
    args = ap.parse_args(argv)
    if sum(bool(x) for x in (args.out, args.verify, args.print_manifest)) != 1:
        print("pass exactly one of --out, --verify or --print-manifest")
        return 3
    if args.notes < 4:
        print("REFUSED: --notes must be at least 4")
        return 3
    if args.print_manifest:
        corpus = build_corpus(args.seed, args.notes)
        _assert_model(corpus)
        sys.stdout.flush()
        sys.stdout.buffer.write(manifest_bytes(build_manifest(corpus)))
        sys.stdout.buffer.flush()
        return 0
    if args.verify:
        problems = verify(Path(args.verify))
        if problems:
            print(f"CORPUS DIFFERS: {len(problems)} problem(s) in {args.verify}")
            for p in problems:
                print(f"  - {p}")
            return 1
        print(f"CORPUS VERIFIED: {args.verify} matches a fresh generation and its own manifest")
        return 0
    why = refuse_out(args.out)
    if why:
        print(f"REFUSED: {why}")
        return 3
    out = Path(args.out)
    if out.exists() and any(out.iterdir()):
        print(f"REFUSED: {out} is not empty; the corpus is written into an empty directory only")
        return 3
    manifest = write(build_corpus(args.seed, args.notes), out)
    c = manifest["counts"]
    print(f"CORPUS WRITTEN: {out} -- {c['total_notes']} notes ({c['small_notes']} small + "
          f"{c['large_notes']} large), {c['top_level_folders']} top-level folders, "
          f"{c['uct_batches']} UCT batches; manifest {MANIFEST_NAME}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
