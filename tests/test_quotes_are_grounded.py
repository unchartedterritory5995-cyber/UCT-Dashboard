"""Every verbatim quote must actually be in the research corpus.

⭐⭐ THE STAKES. These quotes are attributed to living authors and published to
paying members. A quote that is not in the corpus is either a paraphrase wearing
quotation marks or an invention credited to a real person, and there is no
version of this library that survives shipping one.

A full audit on 2026-08-31 found the good news — 153 quotes, all present, none
fabricated — and three ATTRIBUTION defects on top of them (a book the corpus
records as never obtained, a third-party blog's sentence filed under a
publisher's id, and one "quote" splicing two different handouts). Those are
fixed. This rail is what stops them coming back.

⛔ AN ELLIPSIS IS THE INTERESTING CASE, AND IT CUTS BOTH WAYS.
  LEGITIMATE: eliding a clause inside one passage. Measured on the four
  ellipsis quotes in the catalog, the elided parts sit 43 to 147 characters
  apart in the same file — ordinary quotation.
  A DEFECT: splicing two SEPARATE published statements into one quotation
  nobody wrote. `double-bottom` carried "Max 30% ... 40% or less", which fused
  two different IBD handouts publishing two incompatible numbers, and presented
  them as a single sentence.
A checker that simply demands character-for-character contiguity calls the first
kind ungrounded and would push an author to "fix" correct quotes; one that
splits on the ellipsis and looks for the parts anywhere calls the second kind
fine.

⛔ AND DISTANCE ALONE IS NOT THE DISCRIMINATOR — this file claimed it was, and
was WRONG. Restoring the real `double-bottom` splice left a distance check
GREEN, because the corpus documents both handouts' numbers ADJACENTLY on one
line: `"Max 30%" (source 26 handout) and "40% or less" (source 25 handout)`.
The fragments are 36 characters apart. What separates them is the text BETWEEN
them — an explicit source attribution, which is the corpus saying in its own
words that these are two houses and not one sentence. The rule is therefore an
attribution marker in the gap OR an implausible distance, and it is the FIRST
that catches the defect which motivated the rail.
"""
import sys, pathlib, re, unicodedata
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc

ROOT = pathlib.Path(__file__).resolve().parents[1]
CORPUS_DIR = ROOT / "docs/superpowers/research/bases"

#: How far apart an ellipsis's fragments may sit and still be one passage.
#: origin: uct — measured, not guessed. The catalog's four real ellipsis quotes
#: span 43-147 characters; the spliced one this rail exists to catch joined two
#: separate documents. 600 leaves generous room for a long elided clause while
#: staying far below a cross-section jump.
MAX_ELLIPSIS_SPAN = 600


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKC", t)
    for a, b in (("’", "'"), ("‘", "'"), ("“", '"'),
                 ("”", '"'), ("—", "-"), ("–", "-"),
                 ("…", "...")):
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t.lower()).strip()


def _corpus():
    out = {}
    for p in sorted(CORPUS_DIR.glob("*.md")):
        out[p.name] = _norm(p.read_text(encoding="utf-8"))
    return out


def _quotes():
    return [(st.key, c.condition, c.quote)
            for st in bc.ALL_STRUCTURES for c in st.criteria if c.quote]


#: An attribution appearing BETWEEN two fragments of one "quote" means the
#: corpus is crediting them to different houses. Derived from the corpus's own
#: annotation style, which beats any distance threshold: the real splice this
#: rail exists for sits 36 characters apart.
_ATTRIBUTION = re.compile(r"\(source\s|\bhandout\b|\bsource \d")


def _locate(quote: str, corpus: dict):
    """Return (filename, span, attributed_apart) if found, else None.

    `span` is 0 for a contiguous quote, else the distance between the first and
    last fragment. `attributed_apart` is True when the text between fragments
    carries a source attribution — the corpus itself saying they are two
    different publications.
    """
    q = _norm(quote)
    parts = [p.strip() for p in q.split("...") if p.strip()] if "..." in q else [q]
    for name, body in corpus.items():
        pos = [body.find(p) for p in parts]
        if all(p >= 0 for p in pos):
            if len(pos) == 1:
                return name, 0, False
            lo, hi = min(pos), max(pos)
            lo_part = parts[pos.index(lo)]
            between = body[lo + len(lo_part):hi]
            return name, hi - lo, bool(_ATTRIBUTION.search(between))
    return None


# ─── controls, first ────────────────────────────────────────────────────────

def test_the_corpus_and_the_catalog_are_both_readable():
    """⛔ NON-VACUITY. Every assertion below is "no ungrounded quotes found".
    An empty corpus or an empty quote list satisfies that loudly."""
    corpus = _corpus()
    assert len(corpus) >= 10, f"only {len(corpus)} corpus files found at {CORPUS_DIR}"
    assert sum(len(v) for v in corpus.values()) > 200_000, "the corpus read short"
    quotes = _quotes()
    assert len(quotes) > 100, f"only {len(quotes)} quotes extracted from the catalog"


def test_the_checker_rejects_an_invented_quote():
    """The detector responds to input. Without this, a `_locate` that always
    returned a hit would satisfy the rule forever."""
    corpus = _corpus()
    assert _locate("this sentence appears in no trading book ever written",
                   corpus) is None


def test_the_checker_rejects_a_CROSS_DOCUMENT_splice():
    """⭐ THE CASE THAT MATTERS. Two real sentences from far apart, joined by an
    ellipsis, must NOT pass — that is the `double-bottom` defect."""
    corpus = _corpus()
    body = next(iter(corpus.values()))
    a, b = body[1000:1040], body[40000:40040]
    found = _locate(f"{a} ... {b}", corpus)
    assert found is None or found[1] > MAX_ELLIPSIS_SPAN, (
        "a splice across tens of thousands of characters was accepted as one "
        "quotation")


def test_the_checker_accepts_a_genuine_elision():
    """And the other direction: eliding a clause inside one passage is ordinary
    quotation and must stay green, or this rail pushes authors to damage
    correct quotes."""
    corpus = _corpus()
    body = next(iter(corpus.values()))
    a, b = body[5000:5040], body[5120:5160]
    found = _locate(f"{a} ... {b}", corpus)
    assert found is not None and found[1] <= MAX_ELLIPSIS_SPAN


# ─── the rule ───────────────────────────────────────────────────────────────

def test_every_quote_appears_in_the_corpus():
    corpus = _corpus()
    missing = [(k, q) for k, _, q in _quotes() if _locate(q, corpus) is None]
    assert not missing, (
        "these quotes are attributed to a published author and are NOT in the "
        "research corpus:\n"
        + "\n".join(f"  {k}: {q[:90]!r}" for k, q in missing))


def test_no_quote_splices_two_separate_publications():
    """⭐ MUTATION-VERIFIED against the real thing: restoring `double-bottom`'s
    "Max 30% ... 40% or less" turns this RED and names the attribution the
    corpus puts between the two fragments."""
    corpus = _corpus()
    spliced = []
    for key, _, q in _quotes():
        found = _locate(q, corpus)
        if not found:
            continue
        name, span, attributed = found
        if attributed or span > MAX_ELLIPSIS_SPAN:
            why = ("the corpus credits the fragments to DIFFERENT sources"
                   if attributed else f"fragments {span} chars apart")
            spliced.append((key, q, name, why))
    assert not spliced, (
        "these quotes join fragments the corpus does not present as one "
        "sentence — publishing them attributes to one author words that came "
        "from two:\n"
        + "\n".join(f"  {k}: {q[:70]!r} — {why} ({f})"
                    for k, q, f, why in spliced))


def test_no_criterion_cites_a_source_id_the_corpus_cannot_support():
    """A source_id is an attribution. One that names a work the corpus holds
    nothing for is a claim we cannot back — the `minervini_ttlac` defect, where
    ten quotes were credited to a book recorded as never obtained."""
    corpus = _corpus()
    ids = {c.source_id for st in bc.ALL_STRUCTURES for c in st.criteria
           if c.source_id}
    assert ids, "no source ids found — this rail is not reading the catalog"
    orphans = []
    for sid in sorted(ids):
        quoted = [c.quote for st in bc.ALL_STRUCTURES for c in st.criteria
                  if c.source_id == sid and c.quote]
        if quoted and not any(_locate(q, corpus) for q in quoted):
            orphans.append(sid)
    assert not orphans, (
        f"these source ids carry quotes that appear nowhere in the corpus: "
        f"{orphans}")


def test_an_ours_criterion_never_cites_a_source():
    """`origin="uct"` means WE supplied the number. Citing a house beside it
    would be attributing our invention to them."""
    bad = [(st.key, c.condition) for st in bc.ALL_STRUCTURES for c in st.criteria
           if c.origin == "uct" and (c.source_id or c.quote)]
    assert not bad, f"our own numbers citing a source: {bad}"
