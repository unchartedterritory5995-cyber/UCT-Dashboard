"""Verify the Wisdom Loop golden set against the raw samples it was drawn from.

A golden label is only a label if the text it claims to label exists — and, from
v1 on, only if its locator, its author, its private split and its record shape
agree with the sources and the contracts it claims to follow.

⛔ The golden JSONL files and the samples are GITIGNORED on purpose: this
repository is publicly readable (anonymous GitHub API 200, 2026-09-13), and the
records quote paid-session transcripts, Discord team channels and the owner's
positions. Only the quote-free provenance files are committed.

Two record formats, detected per record:

  v0 (data/wisdom/golden/golden-v0.draft.jsonl) — {gid, sample_file, quote, labels, ...}
    * the sample named by sample_file is present (absent = INCONCLUSIVE, never PASS);
    * the quote occurs EXACTLY ONCE in that sample's normalised text;
    * every labels.contradictions quote does the same;
    * list records (labels.list_kind) carry the unique-ticker count and duplicates they claim.
    On PASS it writes docs/wisdom/golden/golden-v0.provenance.json (unchanged v0 behaviour).

  v1 (data/wisdom/golden/golden-v1.jsonl) — {gid, golden_version, record_type, author_id,
    is_guest, stream, locator, quote, expected, private, relations, status, verification,
    verified_by, evidence, split, notes}. Everything v0 checks, plus:
    * the locator agrees with the source: cue_t_s + speaker_label for transcripts,
      section_path + paragraph for Sunday Scans, channel + message id for Discord;
    * the author agrees with the source: a speaker alias from authors.json, the signed
      section or the D4 ruling for Sunday Scans, the Discord author id. Any other
      attribution method (self-identification, adjacency, a pending alias) is allowed
      only on a PROVISIONAL record;
    * CALLs come only from a can_author_calls author; a guest (D14) authors MENTION or
      PRINCIPLE only, with is_guest=true;
    * `expected` is a valid extraction-output-v0 record (docs/wisdom/contracts) and obeys
      the type rules: R1 for a CALL, an explicit pass for a NEGATIVE_CALL, a no-view is
      only ever a MENTION, the hindsight flag matches the stance, a LEVEL carries a price,
      a MARKET_SIGNAL a signal, a PRINCIPLE a principle;
    * the private split (W1 §0.4d): a share count never sits in `expected`, an open
      position's stated entry never sits in `expected`, and no private number is echoed
      in an expected price field;
    * "as worded" fields are verbatim: event_at_text, ticker_as_heard, stop_text, every
      confidence_language phrase and every level price_as_heard occur in the quote, and
      ticker_as_written occurs in the quote or its segment label (or the Discord message);
    * setup_vocab is a Setup Vocabulary v0 name; relations point at gids that exist;
    * split == "dev" iff int(sha256(gid)[:8], 16) is even;
    * a provisional record has a review-queue item (when the queue file is present);
    * --provenance: the quote-free provenance file matches (drift FAILS; --write-provenance
      rewrites it) or is written when absent, and is asserted quote-free before writing;
    * --require-strata: the W1 §2.4 stratification minimums hold (a shortfall is named).

Normalisation (the ONE definition — extractors must use the same one):
  * *.txt (Sunday Scans text export): the file text as-is.
  * *.transcript_cues.json (Zoom cues) and transcripts/<id>.json (edu_videos transcript,
    one "[H:MM:SS] text" line per cue): each cue's text with a leading "<speaker>: "
    prefix removed (prefix = up to 40 chars before the first ": "), cues joined by a
    single space.
  * *.html (published Sunday Scans body): text of every block element (p, div, h1-h6,
    li, figure ...) and every <br> becomes its own line, whitespace inside a line
    collapsed to single spaces, entities decoded, <script>/<style>/<svg>/<button>
    dropped, empty lines dropped, lines joined by "\\n".
  * discord/<channel_key>.jsonl: the stored `content` of the message named by the
    record's external_ref (quoted member text was already stripped at fetch time).

Exit codes: 0 PASS · 1 a MEASURED failure · 2 INCONCLUSIVE (samples missing) ·
3 records PASS but the stratification minimums fall short (named).

    python tools/wisdom_golden_verify.py                     # v0 defaults
    python tools/wisdom_golden_verify.py --golden <v1.jsonl> --provenance docs/wisdom/golden/golden-v1.provenance.json --require-strata
    python tools/wisdom_golden_verify.py --self-check
"""
from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from html.parser import HTMLParser

REPO = pathlib.Path(__file__).resolve().parents[1]
# ⭐ R19 (2026-09-14): the category normaliser has ONE home, shared with the catalog
# reader. It used to be duplicated as a "LIVE TRAIDNG" key in the map below.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "wisdom"))
from category_norm import normalize_category  # noqa: E402
DOCS = REPO / "docs" / "wisdom"
V0_GOLDEN_REL = pathlib.Path("golden") / "golden-v0.draft.jsonl"
PROVENANCE = DOCS / "golden" / "golden-v0.provenance.json"
AUTHORS_PATH = DOCS / "authors.json"
SCHEMA_PATH = DOCS / "contracts" / "extraction-output-v0.schema.json"
VOCAB_PATH = DOCS / "vocabulary" / "setup-vocabulary-v0.draft.json"
RESOLUTIONS_PATH = DOCS / "speakers" / "session-resolutions-v1.json"

RECORD_TYPES = ("CALL", "NEGATIVE_CALL", "MENTION", "PRINCIPLE", "LEVEL", "MARKET_SIGNAL")
# wisdom-db-v0.sql wisdom_sources.stream CHECK
STREAMS = frozenset(("zoom_live", "workshop", "interview", "education", "discord", "x", "sunday_scans",
                     "sunday_scans_chart", "zoom_frame", "model_book", "owner_feedback"))
# wisdom-db-v0.sql wisdom_review_queue.tab CHECK
REVIEW_TABS = frozenset(("golden", "vocabulary", "contradictions", "attribution", "extraction_audit",
                         "drafts", "sources", "capture", "authors"))
STATUSES = frozenset(("confirmed", "provisional"))
VERIFICATIONS = frozenset(("text-only", "text+bars", "text+positions", "text+bars+positions"))
CALL_STANCES = frozenset(("watching", "taking", "in_it", "added", "trimmed", "exited", "stopped_out", "hindsight"))
NEGATIVE_STANCES = frozenset(("passed", "avoid"))
MENTION_STANCES = frozenset((None, "no_view"))
OPEN_STANCES = frozenset(("taking", "in_it", "added", "trimmed"))
POSITION_ACTION_STANCES = frozenset(("taking", "in_it", "added", "trimmed", "exited", "stopped_out", "hindsight"))
RELATIONS = frozenset(("reinforces", "contradicts", "qualifies", "same_sentence"))
PRIVATE_KEYS = frozenset(("size_shares", "open_entry", "derived_stop", "entry_as_heard", "size_as_heard",
                          "fills", "size_text", "trim_fraction"))
MECHANICAL_ATTRIBUTION = frozenset(("speaker_label", "guest_speaker_label", "signed_section", "D4 ruling",
                                    "discord_author_id",
                                    # §8a.2: a table lookup against a committed, evidence-citing entry.
                                    "session_resolution",
                                    # the owner's own answer, which is the strongest authority there is.
                                    "owner_ruling"))
#: Methods that may be used ONLY on a label authors.json declares ambiguous. Letting either
#: one appear on an ordinary label would turn the §8a.2 escape hatch into a way to hand any
#: record any author with no source agreeing.
AMBIGUOUS_ONLY_ATTRIBUTION = frozenset(("session_resolution", "owner_ruling"))
TEAM_UNRESOLVED = "team-unresolved"
#: §8b.7 — team-unresolved is out of the UCT-see rate and out of every publish path.
TEAM_UNRESOLVED_EXCLUSIONS = ("uct_see_rate", "publish")
#: §8a.4 — the ceiling on a ticker inferred from an adjacent line.
INFERRED_ENTITY_CONFIDENCE_MAX = 0.5
# transcripts/_index.json category -> wisdom stream.
# ⛔ Keys are CANONICAL spellings only. Every lookup goes through normalize_category()
# first (R19), so a typo'd or differently-cased label resolves to a key already here —
# a typo mapped in two places is two authorities over one value.
CATEGORY_STREAM = {
    "Live Trading Sessions": "zoom_live", "Evening Update": "zoom_live",
    "Post-Market Recaps": "zoom_live", "Thoughts on the Market": "zoom_live", "Sunday Scans": "zoom_live",
    "Workshops & Fireside Chats": "workshop", "Interviews": "interview",
}
LIVE_SESSION_CATEGORY = "Live Trading Sessions"

STRATA_MIN = {
    "total": 100,
    "record_type": {"CALL": 30, "NEGATIVE_CALL": 12, "MENTION": 20, "PRINCIPLE": 20, "LEVEL": 8, "MARKET_SIGNAL": 5},
    "author": {"bracco": 10, "chartmaster": 8, "manrav": 8},
    "live_session_transcripts": 20,
    "sunday_scans_issues": 15,
    "discord_team_authors": ("bracco", "chartmaster", "manrav"),
}

_SPEAKER_MAX = 40


# ── normalisation ──────────────────────────────────────────────────────────────

def strip_speaker(text: str) -> str:
    head, sep, rest = text.partition(": ")
    if sep and 0 < len(head) <= _SPEAKER_MAX:
        return rest
    return text


def speaker_of(text: str) -> str | None:
    head, sep, _ = text.partition(": ")
    return head if sep and 0 < len(head) <= _SPEAKER_MAX else None


def _join_cues(entries: list[tuple[int, str]]) -> tuple[str, list[tuple[int, int, str | None]]]:
    """Cue texts (speaker stripped) joined by one space, plus (offset, t_s, speaker) per cue."""
    parts: list[str] = []
    index: list[tuple[int, int, str | None]] = []
    pos = 0
    for t, raw in entries:
        text = strip_speaker(raw)
        if parts:
            pos += 1
        index.append((pos, t, speaker_of(raw)))
        parts.append(text)
        pos += len(text)
    return " ".join(parts), index


_TS_LINE = re.compile(r"^\[(?:(\d+):)?(\d{1,2}):(\d{2})\]\s?(.*)$")


def transcript_entries(transcript: str) -> list[tuple[int, str]]:
    entries: list[tuple[int, str]] = []
    last_t = 0
    for line in transcript.splitlines():
        m = _TS_LINE.match(line)
        if m:
            h, mi, s, rest = m.groups()
            last_t = int(h or 0) * 3600 + int(mi) * 60 + int(s)
            entries.append((last_t, rest))
        elif line.strip():
            entries.append((last_t, line.strip()))
    return entries


_BLOCK_TAGS = frozenset("p div h1 h2 h3 h4 h5 h6 li ul ol blockquote figure figcaption pre table tr td th hr "
                        "section article header footer".split())
_HEADING_TAGS = frozenset(("h1", "h2", "h3", "h4"))
_SKIP_TAGS = frozenset(("script", "style", "svg", "button", "noscript"))


class _HtmlLines(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[tuple[str, bool]] = []
        self._buf: list[str] = []
        self._skip = 0
        self._heading = 0

    def _flush(self) -> None:
        text = " ".join("".join(self._buf).split())
        self._buf = []
        if text:
            self.lines.append((text, self._heading > 0))

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self._skip += 1
            return
        if self._skip:
            return
        if tag == "br" or tag in _BLOCK_TAGS:
            self._flush()
        if tag in _HEADING_TAGS:
            self._heading += 1

    def handle_startendtag(self, tag, attrs):
        if self._skip or tag in _SKIP_TAGS:
            return
        if tag == "br" or tag in _BLOCK_TAGS:
            self._flush()

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag in _BLOCK_TAGS:
            self._flush()
        if tag in _HEADING_TAGS:
            self._heading = max(0, self._heading - 1)

    def handle_data(self, data):
        if not self._skip:
            self._buf.append(data)


def html_lines(raw: str) -> list[tuple[str, bool]]:
    p = _HtmlLines()
    p.feed(raw)
    p.close()
    p._flush()
    return p.lines


# Sunday Scans structure: which section (and so which author) a line belongs to.
_APOS = str.maketrans({"’": "'", "‘": "'"})
SECTION_OWNERS = (
    ("bracco's breakdown", "bracco", "signed_section"),
    ("tsdr's weekly outlook", "tsdr", "signed_section"),
    ("intro", "tsdr", "D4 ruling"),
    ("earnings & economic calendar", "tsdr", "D4 ruling"),
    ("market breadth", "tsdr", "D4 ruling"),
    ("market themes", "tsdr", "D4 ruling"),
    ("index & etf", "tsdr", "D4 ruling"),
    ("notable news", "tsdr", "D4 ruling"),
    ("closing", "tsdr", "D4 ruling"),
)
SUBSECTIONS = ("current positions", "charts covered", "honorable mention")
CHART_LABEL = re.compile(r"^\$?[A-Z][A-Z0-9.\-]{0,9}(?:[ /&,]+\$?[A-Z][A-Z0-9.\-]{0,9})*\s*\([A-Za-z ,&]*\)?$")


def _section_owner(text: str, is_heading: bool, html_mode: bool) -> tuple[str, str] | None:
    if html_mode and not is_heading:
        return None
    if not html_mode and (len(text) > 60 or text.rstrip()[-1:] in ".!?"):
        return None
    key = text.translate(_APOS).lower()
    for prefix, author, method in SECTION_OWNERS:
        if key.startswith(prefix):
            return author, method
    return None


def sunday_scans_structure(lines: list[tuple[str, bool]], html_mode: bool) -> list[dict]:
    section, author, method = "(preamble)", "tsdr", "D4 ruling"
    label: str | None = None
    para = 0
    out = []
    for text, is_heading in lines:
        owner = _section_owner(text, is_heading, html_mode)
        if owner:
            section, (author, method), label, para = text, owner, None, 0
        else:
            key = text.translate(_APOS).lower()
            if key.startswith(SUBSECTIONS):
                label, para = text.split(":")[0].strip(), 0
            elif CHART_LABEL.match(text):
                label, para = text, 0
            else:
                para += 1
        out.append({"section_path": section if label is None else f"{section} > {label}",
                    "paragraph": para, "author": author, "attribution": method})
    return out


class Source:
    def __init__(self, kind: str, body: str, file_sha256: str, *, cues=None, blocks=None, meta=None):
        self.kind = kind
        self.body = body
        self.file_sha256 = file_sha256
        self.text_sha256 = hashlib.sha256(body.encode("utf-8")).hexdigest()
        self.cues = cues or []                 # [(offset, t_s, speaker)]
        self.blocks = blocks or []             # [(offset, info)]
        self.meta = meta or {}

    def cue_at(self, offset: int):
        i = bisect.bisect_right([c[0] for c in self.cues], offset) - 1
        return self.cues[i] if i >= 0 else None

    def block_at(self, offset: int):
        i = bisect.bisect_right([b[0] for b in self.blocks], offset) - 1
        return self.blocks[i][1] if i >= 0 else None


def _lines_with_offsets(lines: list[tuple[str, bool]], infos: list[dict]) -> tuple[str, list]:
    blocks, pos = [], 0
    for (text, _), info in zip(lines, infos):
        blocks.append((pos, info))
        pos += len(text) + 1
    return "\n".join(t for t, _ in lines), blocks


def load_source(samples: pathlib.Path, sample: str, message_id: str | None = None) -> Source | None:
    path = samples / sample
    if not path.exists():
        return None
    raw = path.read_bytes()
    file_sha = hashlib.sha256(raw).hexdigest()
    name = path.name
    if name.endswith(".transcript_cues.json"):
        cues = json.loads(raw.decode("utf-8-sig"))["cues"]
        body, index = _join_cues([(int(c.get("t") or 0), c["text"]) for c in cues])
        m = re.search(r"(\d+)", name)
        return Source("cues", body, file_sha, cues=index, meta={"edu_id": int(m.group(1)) if m else None})
    if path.parent.name == "transcripts" and name.endswith(".json"):
        d = json.loads(raw.decode("utf-8-sig"))
        body, index = _join_cues(transcript_entries(d.get("transcript") or ""))
        return Source("transcript", body, file_sha, cues=index,
                      meta={"edu_id": d.get("id"), "category": d.get("category"), "title": d.get("title")})
    if name.endswith(".html"):
        lines = html_lines(raw.decode("utf-8-sig"))
        body, blocks = _lines_with_offsets(lines, sunday_scans_structure(lines, html_mode=True))
        return Source("html", body, file_sha, blocks=blocks, meta={"slug": path.stem})
    if name.endswith(".txt"):
        body = path.read_text(encoding="utf-8-sig")
        lines = [(ln, False) for ln in body.split("\n")]
        _, blocks = _lines_with_offsets(lines, sunday_scans_structure(lines, html_mode=False))
        m = re.search(r"^Source:\s*\S*?(/p/[\w\-]+)", body, re.M)
        return Source("txt", body, file_sha, blocks=blocks, meta={"slug_path": m.group(1) if m else None})
    if name.endswith(".jsonl") and path.parent.name == "discord":
        for line in raw.decode("utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("message_id") == message_id:
                return Source("discord", row.get("content") or "", file_sha,
                              meta={"channel_id": row.get("channel_id"), "message_id": row.get("message_id"),
                                    "author_discord_id": row.get("author_id"), "created_at": row.get("created_at")})
        return None
    return None


def normalised_text(path: pathlib.Path) -> str:
    """v0 entry point, kept: the normalised text of a .txt or .transcript_cues.json sample."""
    src = load_source(path.parent, path.name)
    if src is None:
        raise FileNotFoundError(path)
    return src.body


def quote_sha256(quote: str) -> str:
    return hashlib.sha256(unicodedata.normalize("NFC", " ".join(quote.split())).encode("utf-8")).hexdigest()


def split_for(gid: str) -> str:
    return "dev" if int(hashlib.sha256(gid.encode("utf-8")).hexdigest()[:8], 16) % 2 == 0 else "test"


# ── contracts ──────────────────────────────────────────────────────────────────

def load_contracts() -> dict:
    authors = json.loads(AUTHORS_PATH.read_text(encoding="utf-8"))
    alias: dict[str, str] = {}
    by_id: dict[str, dict] = {}
    for a in authors["authors"]:
        by_id[a["author_id"]] = a
        for label in [a["display_name"], a["author_id"], *a.get("aliases", [])]:
            alias[label.lower()] = a["author_id"]
    non_call: dict[str, dict] = {}
    for s in authors.get("non_call_speakers", []):
        sid = s["label"].lower()
        non_call[sid] = s
        alias[s["label"].lower()] = sid
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    vocab = json.loads(VOCAB_PATH.read_text(encoding="utf-8"))
    ambiguous = frozenset(str(e["label"]).strip().lower()
                          for e in authors.get("ambiguous_speaker_labels", []) if e.get("label"))
    resolutions: dict[tuple[str, str], dict] = {}
    if RESOLUTIONS_PATH.exists():
        raw = json.loads(RESOLUTIONS_PATH.read_text(encoding="utf-8"))
        kinds = frozenset(raw.get("evidence_kinds") or ())
        for entry in raw.get("resolutions") or []:
            cited = [ev for ev in (entry.get("evidence") or []) if (ev or {}).get("kind") in kinds]
            resolutions[(str(entry.get("external_ref")), str(entry.get("label", "")).strip().lower())] = {
                "author_id": entry.get("author_id"), "cited": cited}
    return {"alias": alias, "authors": by_id, "non_call": non_call,
            "call_authors": frozenset(k for k, v in by_id.items() if v.get("can_author_calls")),
            "schema": schema, "record_schema": schema["$defs"]["record"],
            "ambiguous_labels": ambiguous, "session_resolutions": resolutions,
            "vocab": frozenset(e["name"] for e in vocab["entries"])}


_TYPE_CHECK = {
    "string": lambda v: isinstance(v, str),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
    "array": lambda v: isinstance(v, list),
    "object": lambda v: isinstance(v, dict),
}


def validate(value, schema: dict, root: dict, path: str = "$") -> list[str]:
    """The JSON-schema subset the extraction contract uses."""
    if "$ref" in schema:
        node = root
        for part in schema["$ref"].lstrip("#/").split("/"):
            node = node[part]
        return validate(value, node, root, path)
    if "enum" in schema and value not in schema["enum"]:
        return [f"{path}: {value!r} not in enum"]
    t = schema.get("type")
    if t is not None:
        types = t if isinstance(t, list) else [t]
        if not any(_TYPE_CHECK[x](value) for x in types):
            return [f"{path}: {type(value).__name__} is not {types}"]
    errs: list[str] = []
    if isinstance(value, dict):
        props = schema.get("properties", {})
        errs += [f"{path}: missing {k}" for k in schema.get("required", []) if k not in value]
        if schema.get("additionalProperties") is False:
            errs += [f"{path}: unexpected key {k}" for k in value if k not in props]
        for k, v in value.items():
            if k in props:
                errs += validate(v, props[k], root, f"{path}.{k}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errs.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errs.append(f"{path}: more than {schema['maxItems']} items")
        if "items" in schema:
            for i, v in enumerate(value):
                errs += validate(v, schema["items"], root, f"{path}[{i}]")
    return errs


def blank_expected(record_type: str, quote: str) -> dict:
    """A complete extraction-output-v0 record with every field at its empty value."""
    return {
        "record_type": record_type, "quote": quote, "speaker_label": None, "ticker_as_written": None,
        "ticker_as_heard": None, "tickers": [], "direction": None, "stance": None, "setup_name_raw": None,
        "setup_vocab": None, "timeframe": None, "trigger_timeframe": None, "trigger": None, "entry": None,
        "entry_zone": None, "stop": None, "stop_text": None, "targets": [], "levels": [], "size_shares": None,
        "thesis": None, "confidence_language": [], "reason": None, "reason_class": None, "stated_outcome": None,
        "stated_return_pct": None, "event_at_text": None, "hindsight": False, "principle": None,
        "market_signal": None, "extraction_confidence": "high", "notes": None,
    }


# ── v0 ────────────────────────────────────────────────────────────────────────

def check(records: list[dict], samples: pathlib.Path) -> tuple[int, list[str], dict]:
    """v0 records (sample_file + labels). Unchanged semantics."""
    problems: list[str] = []
    provenance: dict = {}
    texts: dict[str, tuple[str, str]] = {}
    missing = set()

    def text_for(name: str):
        if name not in texts:
            src = load_source(samples, name)
            if src is None:
                missing.add(name)
                return None
            texts[name] = (src.body, src.file_sha256)
        return texts[name]

    seen = set()
    for r in records:
        gid = r.get("gid", "?")
        if gid in seen:
            problems.append(f"{gid}: duplicate gid")
        seen.add(gid)
        got = text_for(r["sample_file"])
        if got is None:
            continue
        body, sha = got
        q = r["quote"]
        count = body.count(q)
        if count != 1:
            problems.append(f"{gid}: quote found {count}x in {r['sample_file']} (must be exactly 1): {q[:70]!r}")
            continue
        start = body.index(q)
        provenance[gid] = {"sample_file": r["sample_file"], "sample_sha256": sha,
                           "char_start": start, "char_end": start + len(q)}
        for c in (r.get("labels") or {}).get("contradictions") or []:
            cg = text_for(c["sample_file"])
            if cg is not None and cg[0].count(c["quote"]) != 1:
                problems.append(f"{gid}: contradiction quote found {cg[0].count(c['quote'])}x in {c['sample_file']}")
        labels = r.get("labels") or {}
        if labels.get("list_kind"):
            toks = q.split()
            uniq = list(dict.fromkeys(toks))
            dups = sorted({t for t in toks if toks.count(t) > 1})
            if labels.get("tickers_expected_unique") != len(uniq):
                problems.append(f"{gid}: tickers_expected_unique={labels.get('tickers_expected_unique')} but source has {len(uniq)} unique")
            if sorted(labels.get("duplicates_in_source") or []) != dups:
                problems.append(f"{gid}: duplicates_in_source={labels.get('duplicates_in_source')} but source has {dups}")
    if missing:
        return 2, [f"sample not present: {m}" for m in sorted(missing)] + problems, provenance
    return (1 if problems else 0), problems, provenance


# ── v1 ────────────────────────────────────────────────────────────────────────

V1_KEYS = ("gid", "golden_version", "record_type", "author_id", "is_guest", "stream", "locator", "quote",
           "expected", "private", "relations", "status", "verification", "verified_by", "evidence", "split", "notes")


def _numbers(expected: dict) -> set[float]:
    out: set[float] = set()
    for k in ("entry", "stop"):
        if isinstance(expected.get(k), (int, float)):
            out.add(float(expected[k]))
    for v in expected.get("entry_zone") or []:
        out.add(float(v))
    for key in ("targets", "levels"):
        for item in expected.get(key) or []:
            if isinstance(item.get("price"), (int, float)):
                out.add(float(item["price"]))
    return out


def _private_numbers(private: dict) -> set[float]:
    out: set[float] = set()
    for k, v in private.items():
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float)):
            out.add(float(v))
        elif isinstance(v, list):
            out |= {float(x) for x in v if isinstance(x, (int, float)) and not isinstance(x, bool)}
    return out


def _edu_id(sample: str) -> int | None:
    m = re.search(r"(\d+)", pathlib.PurePosixPath(sample).name)
    return int(m.group(1)) if m else None


def check_v1(records: list[dict], samples: pathlib.Path, contracts: dict,
             review_subjects: set[str] | None = None,
             categories: dict[int, str] | None = None) -> tuple[int, list[str], dict]:
    problems: list[str] = []
    provenance: dict = {}
    missing: set[str] = set()
    cache: dict[tuple, Source | None] = {}
    categories = categories or {}
    gids = [r.get("gid") for r in records]
    known = set(gids)
    by_gid = {r.get("gid"): r for r in records}

    def source(sample: str, message_id: str | None = None):
        key = (sample, message_id)
        if key not in cache:
            cache[key] = load_source(samples, sample, message_id)
            if cache[key] is None:
                missing.add(sample if message_id is None else f"{sample}#{message_id}")
        return cache[key]

    seen: set[str] = set()
    for r in records:
        gid = r.get("gid", "?")
        bad = lambda msg, gid=gid: problems.append(f"{gid}: {msg}")  # noqa: E731
        if gid in seen:
            bad("duplicate gid")
        seen.add(gid)
        absent = [k for k in V1_KEYS if k not in r]
        if absent:
            bad(f"missing keys {absent}")
            continue
        if r["golden_version"] != "v1":
            bad(f"golden_version {r['golden_version']!r} != 'v1'")
        rt = r["record_type"]
        if rt not in RECORD_TYPES:
            bad(f"record_type {rt!r}")
            continue
        if r["stream"] not in STREAMS:
            bad(f"stream {r['stream']!r} not in the contract enum")
        loc = r["locator"] or {}
        sample, ext = loc.get("sample"), loc.get("external_ref") or ""
        if not sample or not ext:
            bad("locator needs sample and external_ref")
            continue
        msg_id = ext.rsplit(":", 1)[-1] if ext.startswith("discord:") else None
        src = source(sample, msg_id)
        if src is None:
            continue
        q = r["quote"]
        count = src.body.count(q) if q else 0
        if count != 1:
            bad(f"quote found {count}x in {sample} (must be exactly 1): {q[:70]!r}")
            continue
        start = src.body.index(q)

        # locator + stream + attribution against the source
        attribution = (r["evidence"] or {}).get("attribution") or {}
        method = attribution.get("method")
        expect_author: str | None = None
        if src.kind in ("cues", "transcript"):
            edu = src.meta.get("edu_id") or _edu_id(sample)
            if ext != f"edu_videos:{edu}":
                bad(f"external_ref {ext!r} != edu_videos:{edu}")
            _, t, spk = src.cue_at(start)
            if loc.get("cue_t_s") != t:
                bad(f"locator.cue_t_s={loc.get('cue_t_s')} but the quote starts in the cue at {t}s")
            if loc.get("speaker_label") != spk:
                bad(f"locator.speaker_label={loc.get('speaker_label')!r} but the cue label is {spk!r}")
            category = src.meta.get("category") or categories.get(edu)
            want_stream = CATEGORY_STREAM.get(normalize_category(category), "education") if category else None
            if want_stream and r["stream"] != want_stream:
                bad(f"stream {r['stream']!r} but category {category!r} maps to {want_stream!r}")
            # ── §8a.2 RAIL: a label authors.json calls ambiguous is an alias of NOBODY ──
            # ⚰️ This is the rail for the defect that produced the ruling: the shared Zoom host
            # account was a tsdr alias, so 'speaker_label' quietly attributed another person's
            # trade to the owner. Dropping the alias fixed the instance; this closes the door.
            # A resolution must name THIS session and cite evidence, or the answer is nobody.
            ambiguous = (spk or "").strip().lower() in contracts["ambiguous_labels"]
            if ambiguous and method == "speaker_label":
                bad(f"speaker label {spk!r} is declared ambiguous in authors.json: it is an alias of nobody "
                    f"(§8a.2). Use session_resolution with cited evidence, or owner_ruling.")
            if method in AMBIGUOUS_ONLY_ATTRIBUTION and not ambiguous:
                bad(f"attribution method {method!r} is only for an ambiguous speaker label, but {spk!r} is not one")
            if method == "session_resolution":
                entry = contracts["session_resolutions"].get((ext, (spk or "").strip().lower()))
                if entry is None:
                    bad(f"no session resolution for {ext} + {spk!r} in {_rel(RESOLUTIONS_PATH)} (§8a.2)")
                elif not entry["cited"]:
                    bad(f"session resolution for {ext} + {spk!r} cites no evidence of a declared kind (§8a.2)")
                else:
                    expect_author = entry["author_id"]
            elif method == "owner_ruling":
                if r["author_id"] != TEAM_UNRESOLVED:
                    bad(f"attribution method 'owner_ruling' on {r['author_id']!r}: the owner's recorded answer "
                        f"here is UNKNOWN, so the author is {TEAM_UNRESOLVED!r} and nobody else")
                expect_author = r["author_id"]
            elif method == "speaker_label":
                expect_author = contracts["alias"].get((spk or "").lower())
                if expect_author is None:
                    bad(f"speaker label {spk!r} is not an alias in authors.json")
            elif method == "guest_speaker_label":
                slug = re.sub(r"[^a-z0-9]+", "_", (spk or "").lower()).strip("_")
                expect_author = f"guest:{slug}"
        elif src.kind in ("html", "txt"):
            info = src.block_at(start)
            slug_path = f"/p/{src.meta['slug']}" if src.kind == "html" else src.meta.get("slug_path")
            if ext != f"substack:{slug_path}":
                bad(f"external_ref {ext!r} != substack:{slug_path}")
            if loc.get("section_path") != info["section_path"]:
                bad(f"locator.section_path={loc.get('section_path')!r} but source says {info['section_path']!r}")
            if loc.get("paragraph") != info["paragraph"]:
                bad(f"locator.paragraph={loc.get('paragraph')} but source says {info['paragraph']}")
            if r["stream"] != "sunday_scans":
                bad(f"stream {r['stream']!r} for a Sunday Scans sample")
            if method in ("signed_section", "D4 ruling"):
                expect_author = info["author"]
                if method != info["attribution"]:
                    bad(f"attribution method {method!r} but the section is {info['attribution']!r}")
        elif src.kind == "discord":
            if ext != f"discord:{src.meta['channel_id']}:{src.meta['message_id']}":
                bad(f"external_ref {ext!r} does not match the stored message")
            if r["stream"] != "discord":
                bad(f"stream {r['stream']!r} for a Discord sample")
            if method == "discord_author_id":
                expect_author = next((k for k, a in contracts["authors"].items()
                                      if a.get("discord_user_id") == src.meta["author_discord_id"]), None)
        if method not in MECHANICAL_ATTRIBUTION:
            if r["status"] != "provisional":
                bad(f"attribution method {method!r} is not mechanical, so the record must be provisional")
        elif expect_author != r["author_id"]:
            bad(f"author_id {r['author_id']!r} but {method} says {expect_author!r}")

        # author rules
        author = r["author_id"]
        is_guest = r["is_guest"] is True
        known_author = (author in contracts["authors"] or author in contracts["non_call"]
                        or author == TEAM_UNRESOLVED)
        # ── §8b.7 RAIL: team-unresolved is MENTION only, and is out of the numbers ──
        # An unknown speaker that can author a CALL is worse than no record: it puts a
        # trade in somebody's mouth and then counts it in his hit rate.
        if author == TEAM_UNRESOLVED:
            if rt != "MENTION":
                bad(f"{TEAM_UNRESOLVED} may author MENTION only (§8a.2/§8b.7), not {rt}")
            excluded = (r["evidence"] or {}).get("excluded_from") or []
            missing_ex = [x for x in TEAM_UNRESOLVED_EXCLUSIONS if x not in excluded]
            if missing_ex:
                bad(f"{TEAM_UNRESOLVED} record must declare evidence.excluded_from {list(TEAM_UNRESOLVED_EXCLUSIONS)}; "
                    f"missing {missing_ex} (§8b.7)")
        if is_guest:
            if not str(author).startswith("guest:"):
                bad("is_guest=true needs author_id 'guest:<name>'")
            if rt not in ("MENTION", "PRINCIPLE"):
                bad(f"a guest may author MENTION or PRINCIPLE only (D14), not {rt}")
        elif not known_author:
            bad(f"author_id {author!r} is not in authors.json")
        if rt == "CALL" and author not in contracts["call_authors"]:
            bad(f"CALL by {author!r}, who may not author CALLs")

        # expected: contract shape + type rules
        e = r["expected"]
        errs = validate(e, contracts["record_schema"], contracts["schema"], "expected")
        problems.extend(f"{gid}: {x}" for x in errs)
        if errs:
            continue
        if e["record_type"] != rt:
            bad(f"expected.record_type {e['record_type']!r} != {rt!r}")
        if e["quote"] != q:
            bad("expected.quote differs from quote")
        stance = e["stance"]
        entity = (r["evidence"] or {}).get("entity") or {}
        if rt == "CALL":
            if stance not in CALL_STANCES:
                bad(f"CALL stance {stance!r}")
            if e["direction"] is None:
                bad("CALL needs a direction (R1)")
            if not entity.get("ticker"):
                bad("CALL needs a resolved instrument (evidence.entity.ticker)")
            has_level = any(e[k] not in (None, [], "") for k in ("entry", "entry_zone", "stop", "stop_text",
                                                                  "targets", "levels", "trigger"))
            if not (has_level or stance in POSITION_ACTION_STANCES or (r["private"] or {}).get("open_entry")):
                bad("CALL has no stated level, named trigger or position action (R1) — that is a MENTION")
            if (stance == "hindsight") != bool(e["hindsight"]):
                bad("hindsight flag must match stance=hindsight (R4)")
        else:
            if e["hindsight"]:
                bad("hindsight=true outside a CALL")
        if rt == "NEGATIVE_CALL":
            if stance not in NEGATIVE_STANCES:
                bad(f"NEGATIVE_CALL stance {stance!r} (a no-view is never a pass, R3)")
            if not (e["ticker_as_written"] or e["ticker_as_heard"]) or not entity.get("ticker"):
                bad("NEGATIVE_CALL needs an explicit ticker (R3)")
        if rt == "MENTION" and stance not in MENTION_STANCES:
            bad(f"MENTION stance {stance!r}")
        if rt in ("PRINCIPLE", "LEVEL", "MARKET_SIGNAL") and stance is not None:
            bad(f"{rt} carries stance {stance!r}")
        if (rt == "PRINCIPLE") != (e["principle"] is not None):
            bad("principle object must be set on a PRINCIPLE and only there")
        if (rt == "MARKET_SIGNAL") != (e["market_signal"] is not None):
            bad("market_signal must be set on a MARKET_SIGNAL and only there")
        if rt == "LEVEL":
            if not any(lv.get("price") is not None for lv in e["levels"]):
                bad("LEVEL needs at least one stated price")
            if not entity.get("ticker"):
                bad("LEVEL needs a resolved instrument (evidence.entity.ticker)")
        # ── §8a.4 RAIL: a ticker inferred from an adjacent line pays for itself ──
        # The column existed with no writer bound to it (F6), which is a rule that LOOKS
        # implemented. Golden carries the fields, so the gate can score them.
        if entity.get("inferred"):
            conf = entity.get("entity_confidence")
            if not isinstance(conf, (int, float)) or isinstance(conf, bool) or conf > INFERRED_ENTITY_CONFIDENCE_MAX:
                bad(f"inferred ticker needs entity_confidence <= {INFERRED_ENTITY_CONFIDENCE_MAX} (§8a.4), got {conf!r}")
            if e["extraction_confidence"] != "low":
                bad(f"inferred ticker needs extraction_confidence 'low' (§8a.4), got {e['extraction_confidence']!r}")
            passing = [b for b in ((r["evidence"] or {}).get("bars") or [])
                       if b.get("ticker") == entity.get("ticker") and b.get("result") is True]
            if entity.get("bar_range_pass") is not True or not passing:
                bad(f"inferred ticker {entity.get('ticker')!r} must record a PASSING bar-range check on that "
                    f"same ticker before storage (§8a.4); on failure it is a MENTION with no entity")
        if e["setup_vocab"] is not None and e["setup_vocab"] not in contracts["vocab"]:
            bad(f"setup_vocab {e['setup_vocab']!r} is not a Setup Vocabulary v0 name")
        # fields the contract defines as "as worded" must be verbatim
        for field in ("event_at_text", "ticker_as_heard", "stop_text"):
            if e[field] is not None and e[field] not in q:
                bad(f"expected.{field} {e[field]!r} is not verbatim in the quote")
        for phrase in e["confidence_language"]:
            if phrase not in q:
                bad(f"confidence_language {phrase[:40]!r} is not verbatim in the quote")
        for lv in e["levels"]:
            if lv.get("price_as_heard") and lv["price_as_heard"] not in q:
                bad(f"level price_as_heard {lv['price_as_heard']!r} is not verbatim in the quote")
        if e["ticker_as_written"]:
            segment = src.body if src.kind == "discord" else q + "\n" + str(loc.get("section_path") or "")
            if e["ticker_as_written"] not in segment:
                bad(f"ticker_as_written {e['ticker_as_written']!r} is in neither the quote nor its segment label")

        # private split (W1 §0.4d)
        private = r["private"]
        if not isinstance(private, dict):
            bad("private must be an object ({} when nothing is private)")
            private = {}
        unknown = set(private) - PRIVATE_KEYS
        if unknown:
            bad(f"private has unknown keys {sorted(unknown)}")
        if e["size_shares"] is not None:
            bad("size_shares in expected — share counts live in private only")
        if stance in OPEN_STANCES and (e["entry"] is not None or e["entry_zone"]):
            bad(f"stance {stance!r} is an open position: its stated entry belongs in private.open_entry")
        echoed = _numbers(e) & _private_numbers(private)
        if echoed:
            bad(f"private value(s) {sorted(echoed)} echoed in an expected price field")

        # lists, contradictions, relations
        ev = r["evidence"] or {}
        if ev.get("list_kind"):
            toks = q.replace(",", " ").split()
            uniq = list(dict.fromkeys(toks))
            dups = sorted({t for t in toks if toks.count(t) > 1})
            if e["tickers"] != uniq:
                bad(f"expected.tickers has {len(e['tickers'])} but the list has {len(uniq)} unique in order")
            if sorted(ev.get("duplicates_in_source") or []) != dups:
                bad(f"duplicates_in_source={ev.get('duplicates_in_source')} but source has {dups}")
        for c in ev.get("contradictions") or []:
            csrc = source(c["sample"])
            if csrc is not None and csrc.body.count(c["quote"]) != 1:
                bad(f"contradiction quote found {csrc.body.count(c['quote'])}x in {c['sample']}")
        for rel in r["relations"] or []:
            if rel.get("relation") not in RELATIONS:
                bad(f"relation {rel.get('relation')!r}")
            if rel.get("gid") not in known:
                bad(f"relation points at unknown gid {rel.get('gid')!r}")
            elif rel.get("relation") == "reinforces":
                other = by_gid[rel["gid"]]
                if rt == "PRINCIPLE" and other["record_type"] == "PRINCIPLE":
                    k1, k2 = ev.get("principle_key"), (other.get("evidence") or {}).get("principle_key")
                    if not k1 or k1 != k2:
                        bad(f"reinforces {rel['gid']} but principle_key {k1!r} != {k2!r}")

        # status / verification / split / queue
        if r["status"] not in STATUSES:
            bad(f"status {r['status']!r}")
        if r["verification"] not in VERIFICATIONS:
            bad(f"verification {r['verification']!r}")
        else:
            if ("bars" in r["verification"]) != bool(ev.get("bars")):
                bad("verification says bars iff evidence.bars is non-empty")
            if ("positions" in r["verification"]) != bool(ev.get("positions")):
                bad("verification says positions iff evidence.positions is non-empty")
        if r["verified_by"] != "auto":
            bad(f"verified_by {r['verified_by']!r} (this set is auto-verified)")
        if r["split"] != split_for(gid):
            bad(f"split {r['split']!r} != {split_for(gid)!r} (sha256(gid)[:8] parity)")
        if review_subjects is not None and r["status"] == "provisional" and gid not in review_subjects:
            bad("provisional without a review-queue item")

        provenance[gid] = {
            "record_type": rt, "author_id": author, "stream": r["stream"], "locator": loc,
            "quote_sha256": quote_sha256(q),
            "span": {"char_start": start, "char_end": start + len(q), "text_sha256": src.text_sha256},
            "status": r["status"], "verification": r["verification"], "split": r["split"],
        }
    if missing:
        return 2, [f"sample not present: {m}" for m in sorted(missing)] + problems, provenance
    return (1 if problems else 0), problems, provenance



# ── v1.1 NULL segments ────────────────────────────────────────────────────────
#
# A NULL row asserts an ABSENCE over a span: "no CALL / no PRINCIPLE / no MARKET_SIGNAL is in
# this text". It is what lets the gate score a FALSE POSITIVE — a positive label can only ever
# make a miss visible. On golden-v1's dev split the gate scored 119 of the 882 records it kept;
# the other 763 were claims about paragraphs nobody had labelled and could not be counted
# against the extractor at all.
#
# ⛔ AN ABSENCE IS NOT MECHANICALLY DECIDABLE IN GENERAL, and this file must not pretend it is.
# What IS mechanical is a set of screens over the text, each of which has to come back empty:
#
#   * no instrument token  -> CALL, NEGATIVE_CALL, MENTION and LEVEL are not CONSTRUCTIBLE.
#     Each needs an instrument (R1, R3, the MENTION rule), so no instrument means no record.
#   * no price token       -> LEVEL additionally needs a stated price.
#   * lexicon screen       -> PRINCIPLE and MARKET_SIGNAL. This one is a SCREEN, NOT A PROOF: a
#     generalisable teaching statement has no lexical signature, so absence of vocabulary is
#     not absence of meaning. Those two types are always PROVISIONAL, and a false positive
#     scored against them is a REVIEW ITEM, not a verdict.
#
# ⛔ THE INSTRUMENT SCREEN IS DELIBERATELY NOT `segmenter.detect_mentions`. That function is
# UNIVERSE-GATED — an uppercase token counts only when cap_universe.json knows it — and the
# first pass of this selection used it and passed messages naming SOXL, CBRS, ETHU, NBIL, SNDU
# and KORU as "no instrument here". Absence of knowledge is not absence of a ticker
# (`lesson_a_symbol_universe_does_not_settle_a_ticker_match`). The screen below rejects on the
# SHAPE of a token, and adds company names and sector words because the extractor resolves
# "Micron" and "semis" to instruments that no uppercase regex will ever see.

NULL_KIND = "null_segment"
NULL_KEYS = ("gid", "golden_version", "kind", "null_for", "record_type", "author_id", "is_guest", "stream",
             "locator", "quote", "expected", "private", "relations", "status", "verification", "verified_by",
             "evidence", "split", "notes")
#: type -> (method, mechanical). The ONE authority on what a NULL row can honestly claim.
NULL_METHODS = {
    "CALL": ("no_instrument_token", True),
    "NEGATIVE_CALL": ("no_instrument_token", True),
    "MENTION": ("no_instrument_token", True),
    "LEVEL": ("no_instrument_token+no_price_token", True),
    "PRINCIPLE": ("lexicon_screen+read", False),
    "MARKET_SIGNAL": ("lexicon_screen+read", False),
}
_NULL_CASHTAG = re.compile(r"\$[A-Za-z]{1,6}\b")
_NULL_UPPER = re.compile(r"\b[A-Z]{2,6}\b")
_NULL_PRICE = re.compile(r"\$\s?\d|(?<![\w.])\d{1,5}(?:,\d{3})*\.\d{1,2}(?![\w.])")
#: Uppercase tokens that are never an instrument in this corpus. Anything NOT here is treated as
#: a possible ticker, which is the safe direction for a claim of absence.
_NULL_UPPER_OK = frozenset("""
A I AM PM ET EST EDT CT PT AI IT ON NO OK OR SO TO IN IS IF AT BY OF AN AS BE DO GO UP MY WE HE
ALL AND ARE BUT NOT YES NEW ONE TWO BIG LOW HIGH OUT FOR YOU CAN NOW THE WAS HAS HAD HOW WHY WHO
US USA UK EU NYSE SEC IRS FOMC FED CPI PPI PCE GDP NFP PMI JOLTS UMICH ISM ADP ECB BOJ
EPS ER IPO ETF ETFS CEO CFO COO CTO AH PT DD IMO TBH LOL HAGW FWIW BTW ASAP FYI TL DR
EMA SMA MA RS HVC EP PEG ORB VWAP ADR ATR RSI MACD ATH HOD LOD YTD EOD MTD QTD NH NL
UCT TSDR SUBSTACK ZOOM DISCORD YOUTUBE TC PDF API URL HTML CSS JSON ID OS PC TV APP
Q1 Q2 Q3 Q4 H1 H2 FY MON TUE WED THU FRI SAT SUN JAN FEB MAR APR JUN JUL AUG SEP OCT NOV DEC
LIVE TRADING SCANS SUNDAY MARKET WEEK DAY MONTH YEAR HOUR MIN SEC
""".split())
_NULL_COMPANY = re.compile(
    r"\b(nvidia|tesla|apple|amazon|google|alphabet|meta|facebook|microsoft|netflix|micron|"
    r"broadcom|intel|palantir|coinbase|robinhood|nike|walmart|costco|boeing|disney|oracle|"
    r"salesforce|adobe|qualcomm|sandisk|seagate|western digital|super ?micro|arm holdings|"
    r"bitcoin|ethereum|solana|dogecoin|berkshire|goldman|morgan stanley|jpmorgan|"
    r"united parcel|fedex|starbucks|mcdonald|pepsi|coca[- ]cola|exxon|chevron|pfizer|moderna|"
    r"lilly|novo|astrazeneca|paypal|block|square|uber|lyft|airbnb|doordash|snowflake|"
    r"datadog|crowdstrike|cloudflare|shopify|spotify|roblox|unity|rivian|lucid|ford|"
    r"general motors|caterpillar|deere|lockheed|raytheon|northrop|palo alto)\b", re.I)
_NULL_SECTOR = re.compile(
    r"\b(semis?|semiconductors?|banks?|financials?|megacaps?|mega[- ]cap|small[- ]caps?|"
    r"russell|nasdaq|s&p|spx|dow jones|indices|the index|memory names?|leaders?|"
    r"biotech|energy names?|miners?|crypto names?|quantum names?|nuclear names?|"
    r"growth names?|momentum names?|utilities|healthcare|industrials|staples|discretionary)\b", re.I)
_NULL_PRINCIPLE_LEX = re.compile(
    r"\b(always|never|every time|the rule|rule is|you should|you have to|you must|the key is|"
    r"discipline|risk manage|stop loss|position siz|cut (?:your )?loss|let (?:your )?winners|"
    r"the mistake|principle|expectancy|probabilit|be careful|have a system|"
    r"sit on (?:your|my) hands|less is more)\w*", re.I)
_NULL_SIGNAL_LEX = re.compile(
    r"\b(distribution day|follow[- ]through|risk[- ]on|risk[- ]off|washout|capitulat|rotation|"
    r"uptrend|downtrend|correction|bull market|bear market|oversold|overbought|"
    r"under the hood|t2108|t2100|advance/decline)\w*", re.I)


def null_screens(text: str) -> dict:
    """Every screen a NULL row's claim rests on, as MEASUREMENTS. Each value is the list of hits;
    the claim holds only where the list is empty, and the lists are stored so a later run can
    re-derive them and fail on drift instead of trusting the row's own word."""
    return {
        "cashtags": sorted(set(_NULL_CASHTAG.findall(text))),
        "upper_tokens": sorted({t for t in _NULL_UPPER.findall(text) if t not in _NULL_UPPER_OK}),
        "companies": sorted({m.group(0).lower() for m in _NULL_COMPANY.finditer(text)}),
        "sectors": sorted({m.group(0).lower() for m in _NULL_SECTOR.finditer(text)}),
        "prices": sorted({m.group(0) for m in _NULL_PRICE.finditer(text)}),
        "principle_lexicon": sorted({m.group(0).lower() for m in _NULL_PRINCIPLE_LEX.finditer(text)}),
        "signal_lexicon": sorted({m.group(0).lower() for m in _NULL_SIGNAL_LEX.finditer(text)}),
    }


_NULL_SCREEN_FOR = {"no_instrument_token": ("cashtags", "upper_tokens", "companies", "sectors"),
                    "no_instrument_token+no_price_token": ("cashtags", "upper_tokens", "companies", "sectors",
                                                           "prices"),
                    "lexicon_screen+read": ("principle_lexicon", "signal_lexicon")}


def null_checks_for(types, screens: dict) -> dict:
    """The `evidence.null_checks` a row with these declared types MUST carry, derived from the
    screens. Deriving it rather than reading it is the whole point: a row that claims a
    mechanical method its own text does not support has to fail, not be believed."""
    out = {}
    for t in sorted(types):
        method, mechanical = NULL_METHODS[t]
        hits = sorted({h for key in _NULL_SCREEN_FOR[method] for h in screens[key]})
        out[t] = {"method": method, "mechanical": mechanical, "screen_hits": hits}
    return out


def null_status(checks: dict) -> str:
    """⛔ confirmed only when EVERY declared type rests on a mechanical method AND every screen
    it rests on came back empty. One non-mechanical type makes the whole ROW provisional, because
    `status` is a row-level field and the weakest claim on the row is what it can honestly say."""
    if any(not c["mechanical"] or c["screen_hits"] for c in checks.values()):
        return "provisional"
    return "confirmed"


def check_null(records: list[dict], samples: pathlib.Path, contracts: dict,
               categories: dict[int, str] | None = None,
               base_sha256: str | None = None) -> tuple[int, list[str], dict]:
    # `contracts` is taken and not read: it is the authors/aliases table, and a NULL row makes no
    # authorship claim (see the attribution block below). The parameter stays so this signature
    # matches check_v1's and a future rule that DOES need it has somewhere to read it from.
    """Everything check_v1 checks about a locator, an author and a quote — and then the screens.

    ⛔ THE REVIEW-QUEUE RULE IS PER CLASS HERE, NOT PER ROW. v1 requires a review item for every
    provisional record; 44 NULL rows provisional for the SAME reason ("a principle has no lexical
    signature") would file 44 copies of one ruling, and a ruling repeated is a ruling unproved
    (`lesson_a_guard_repeated_is_a_guard_unproved`). A provisional NULL row instead names the
    ruling in `evidence.review_item`, and every row resting on the same non-mechanical methods
    must name the SAME one — so the owner vetoes the rule once, and the check can still tell
    that nobody quietly minted a second, softer ruling for a row they wanted to keep.
    """
    problems: list[str] = []
    provenance: dict = {}
    missing: set[str] = set()
    cache: dict[tuple, Source | None] = {}
    categories = categories or {}
    by_method_set: dict[tuple, set] = {}

    def source(sample: str, message_id: str | None = None):
        key = (sample, message_id)
        if key not in cache:
            cache[key] = load_source(samples, sample, message_id)
            if cache[key] is None:
                missing.add(sample if message_id is None else f"{sample}#{message_id}")
        return cache[key]

    seen: set[str] = set()
    for r in records:
        gid = r.get("gid", "?")
        bad = lambda msg, gid=gid: problems.append(f"{gid}: {msg}")  # noqa: E731
        if gid in seen:
            bad("duplicate gid")
        seen.add(gid)
        absent = [k for k in NULL_KEYS if k not in r]
        if absent:
            bad(f"missing keys {absent}")
            continue
        if r["golden_version"] != "v1.1":
            bad(f"golden_version {r['golden_version']!r} != 'v1.1'")
        # ⛔ record_type must be NULL on a NULL row. Setting it to one of the six would make the
        # row readable as a positive label of that type by anything that keys off record_type.
        if r["record_type"] is not None:
            bad(f"record_type {r['record_type']!r} on a NULL row (it asserts an absence, not a type)")
        if r["expected"] != [] or r["private"] != {} or r["relations"] != []:
            bad("a NULL row carries expected=[], private={} and relations=[]")
        declared = r["null_for"]
        if not isinstance(declared, list) or not declared or any(t not in NULL_METHODS for t in declared):
            bad(f"null_for {declared!r} must be a non-empty subset of {sorted(NULL_METHODS)}")
            continue
        if len(set(declared)) != len(declared):
            bad(f"null_for {declared!r} repeats a type")
        if r["stream"] not in STREAMS:
            bad(f"stream {r['stream']!r} not in the contract enum")
        loc = r["locator"] or {}
        sample, ext = loc.get("sample"), loc.get("external_ref") or ""
        if not sample or not ext:
            bad("locator needs sample and external_ref")
            continue
        msg_id = ext.rsplit(":", 1)[-1] if ext.startswith("discord:") else None
        src = source(sample, msg_id)
        if src is None:
            continue
        q = r["quote"]
        count = src.body.count(q) if q else 0
        if count != 1:
            bad(f"quote found {count}x in {sample} (must be exactly 1)")
            continue
        start = src.body.index(q)

        # ── locator against the source, exactly as a positive row — but NO AUTHOR CLAIM ──
        # ⛔ A NULL ROW HAS NO AUTHOR, and that is a decision, not an omission. An absence is a
        # property of the TEXT, not of a speaker: naming one adds nothing the locator does not
        # already carry, and it would force an attribution onto the shared "Uncharted Territory"
        # Zoom label, which §8a.2 declares an alias of NOBODY. Three of the segments selected for
        # v1.1 sit under exactly that label. The speaker label and section path stay in the
        # locator, so the human information survives without a claim about who said it.
        attribution = (r["evidence"] or {}).get("attribution") or {}
        method = attribution.get("method")
        if r["author_id"] is not None:
            bad(f"author_id {r['author_id']!r}: a NULL row asserts an absence and names no author")
        if method != "not_applicable":
            bad(f"attribution method {method!r}: a NULL row declares 'not_applicable', explicitly")
        if src.kind in ("cues", "transcript"):
            edu = src.meta.get("edu_id") or _edu_id(sample)
            if ext != f"edu_videos:{edu}":
                bad(f"external_ref {ext!r} != edu_videos:{edu}")
            _, t, spk = src.cue_at(start)
            if loc.get("cue_t_s") != t:
                bad(f"locator.cue_t_s={loc.get('cue_t_s')} but the quote starts in the cue at {t}s")
            if loc.get("speaker_label") != spk:
                bad(f"locator.speaker_label={loc.get('speaker_label')!r} but the cue label is {spk!r}")
            category = src.meta.get("category") or categories.get(edu)
            want_stream = CATEGORY_STREAM.get(normalize_category(category), "education") if category else None
            if want_stream and r["stream"] != want_stream:
                bad(f"stream {r['stream']!r} but category {category!r} maps to {want_stream!r}")
        elif src.kind in ("html", "txt"):
            info = src.block_at(start)
            slug_path = f"/p/{src.meta['slug']}" if src.kind == "html" else src.meta.get("slug_path")
            if ext != f"substack:{slug_path}":
                bad(f"external_ref {ext!r} != substack:{slug_path}")
            if loc.get("section_path") != info["section_path"]:
                bad(f"locator.section_path={loc.get('section_path')!r} but source says {info['section_path']!r}")
            if loc.get("paragraph") != info["paragraph"]:
                bad(f"locator.paragraph={loc.get('paragraph')} but source says {info['paragraph']}")
            if r["stream"] != "sunday_scans":
                bad(f"stream {r['stream']!r} for a Sunday Scans sample")
        elif src.kind == "discord":
            if ext != f"discord:{src.meta['channel_id']}:{src.meta['message_id']}":
                bad(f"external_ref {ext!r} does not match the stored message")
            if r["stream"] != "discord":
                bad(f"stream {r['stream']!r} for a Discord sample")

        # ── the screens: re-derived, never read back ──
        screens = null_screens(q)
        want = null_checks_for(declared, screens)
        got = ((r["evidence"] or {}).get("null_checks") or {})
        if got != want:
            bad(f"evidence.null_checks disagrees with the text: stored {sorted(got)} -> "
                f"{[(k, v.get('method'), v.get('screen_hits')) for k, v in sorted(got.items())]}, "
                f"derived {[(k, v['method'], v['screen_hits']) for k, v in sorted(want.items())]}")
        for t, c in want.items():
            if c["mechanical"] and c["screen_hits"]:
                bad(f"{t} claims the mechanical method {c['method']!r} but the screen found {c['screen_hits']}")
        want_status = null_status(want)
        if r["status"] != want_status:
            bad(f"status {r['status']!r} but the checks derive {want_status!r}")
        if r["verification"] != "text-only":
            bad(f"verification {r['verification']!r}: a NULL row is text-only by construction")
        if r["verified_by"] != "auto":
            bad(f"verified_by {r['verified_by']!r} (this set is auto-verified)")
        if r["split"] != split_for(gid):
            bad(f"split {r['split']!r} != {split_for(gid)!r} (sha256(gid)[:8] parity)")
        if r["is_guest"] is not False:
            bad("is_guest must be false on a NULL row: an absence is not authored by a guest")
        if want_status == "provisional":
            item = (r["evidence"] or {}).get("review_item")
            soft = tuple(sorted(t for t, c in want.items() if not c["mechanical"]))
            if not isinstance(item, str) or not item:
                bad("a provisional NULL row must name its class-level ruling in evidence.review_item")
            else:
                by_method_set.setdefault(soft, set()).add(item)

        # ⛔ THE SECTION HEADING IS INSIDE THE QUOTE, so it cannot be published. A Sunday Scans
        # SECTION segment begins with its own heading line, which means a NULL row's quote — the
        # whole segment — literally starts with `section_path`. Committing it would put 40-odd
        # characters of quote text in a public file, and `quote_leaks` correctly refuses the
        # write. It is hashed rather than dropped so drift is still detectable.
        pub_loc = dict(loc)
        if pub_loc.get("section_path"):
            pub_loc["section_path_sha256"] = quote_sha256(pub_loc.pop("section_path"))
        provenance[gid] = {
            "kind": NULL_KIND, "null_for": sorted(declared), "stream": r["stream"],
            "locator": pub_loc, "quote_sha256": quote_sha256(q),
            "span": {"char_start": start, "char_end": start + len(q), "text_sha256": src.text_sha256},
            "null_checks": {t: {"method": c["method"], "mechanical": c["mechanical"]} for t, c in want.items()},
            "status": r["status"], "verification": r["verification"], "split": r["split"],
        }
    for soft, items in by_method_set.items():
        if len(items) > 1:
            problems.append(f"NULL rows provisional for {list(soft)} name {len(items)} different rulings "
                            f"{sorted(items)}; one class, one ruling")
    # ── the set-level summary, DERIVED and therefore drift-checked like every other entry ──
    # ⛔ It is regenerated from the records on every run rather than hand-maintained beside them.
    # A counts block typed once and never recomputed is the defect this repo keeps paying for: a
    # hand-typed enumeration beside the list it claims to describe.
    if provenance:
        rows = [r for r in records if r.get("gid") in provenance]
        by_stream: dict[str, int] = {}
        by_split: dict[str, int] = {}
        by_status: dict[str, int] = {}
        by_type_n: dict[str, int] = {}
        for r in rows:
            by_stream[r["stream"]] = by_stream.get(r["stream"], 0) + 1
            by_split[r["split"]] = by_split.get(r["split"], 0) + 1
            by_status[r["status"]] = by_status.get(r["status"], 0) + 1
            for t_ in r["null_for"]:
                by_type_n[t_] = by_type_n.get(t_, 0) + 1
        provenance["_null_set"] = {
            "representation": "kind='null_segment' + null_for=[types]; expected=[] and record_type=null. "
                              "The row contributes a SPAN and no label, so a prediction inside it is "
                              "scorable as a false positive for the declared types and for nothing else.",
            "base": {"golden_version": "golden-v1", "sha256": base_sha256},
            "null_rows": len(rows), "by_stream": by_stream, "by_split": by_split, "by_status": by_status,
            "types_asserted_absent": by_type_n,
            "methods": {t: {"method": m, "mechanical": mech} for t, (m, mech) in sorted(NULL_METHODS.items())},
            "author": "none — an absence is a property of the text, not of a speaker (§8a.2)",
            "samples": sorted({(r["locator"] or {}).get("sample") for r in rows}),
        }
    if missing:
        return 2, [f"sample not present: {m}" for m in sorted(missing)] + problems, provenance
    return (1 if problems else 0), problems, provenance


def quote_leaks(provenance_text: str, records: list[dict]) -> list[str]:
    """gids whose quote (or any 24-char window of it) appears in the provenance text."""
    leaks = []
    for r in records:
        q = r.get("quote") or ""
        if len(q) < 24:
            if len(q) >= 10 and q in provenance_text:
                leaks.append(r.get("gid"))
            continue
        if any(q[i:i + 24] in provenance_text for i in range(0, len(q) - 23, 8)):
            leaks.append(r.get("gid"))
    return leaks


def load_review_queue(path: pathlib.Path, gids: set[str]) -> tuple[set[str], list[str]]:
    subjects: set[str] = set()
    problems: list[str] = []
    keys = ("item_id", "tab", "subject_ref", "summary", "old_json", "new_json", "evidence_json", "recommendation")
    seen: set[str] = set()
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        item = json.loads(line)
        missing = [k for k in keys if k not in item]
        if missing:
            problems.append(f"review-queue line {n}: missing {missing}")
            continue
        if item["item_id"] in seen:
            problems.append(f"review-queue line {n}: duplicate item_id {item['item_id']}")
        seen.add(item["item_id"])
        if item["tab"] not in REVIEW_TABS:
            problems.append(f"review-queue line {n}: tab {item['tab']!r} not in the contract enum")
        if item["subject_ref"] not in gids:
            problems.append(f"review-queue line {n}: subject_ref {item['subject_ref']!r} is not a golden gid")
        subjects.add(item["subject_ref"])
    return subjects, problems


def strata(records: list[dict], categories: dict[int, str], minimums: dict = STRATA_MIN) -> tuple[list[str], list[str]]:
    lines: list[str] = []
    short: list[str] = []
    total = len(records)
    by_type: dict[str, int] = {}
    by_author: dict[str, int] = {}
    matrix: dict[tuple, int] = {}
    live: set[int] = set()
    issues: set[str] = set()
    discord_by_author: dict[str, int] = {}
    for r in records:
        rt, au = r["record_type"], r["author_id"]
        by_type[rt] = by_type.get(rt, 0) + 1
        by_author[au] = by_author.get(au, 0) + 1
        key = (rt, au, r["status"], r["verification"])
        matrix[key] = matrix.get(key, 0) + 1
        ext = (r.get("locator") or {}).get("external_ref") or ""
        if ext.startswith("edu_videos:"):
            vid = int(ext.split(":", 1)[1])
            if normalize_category(categories.get(vid)) == LIVE_SESSION_CATEGORY:
                live.add(vid)
        elif ext.startswith("substack:"):
            issues.add(ext)
        elif ext.startswith("discord:"):
            discord_by_author[au] = discord_by_author.get(au, 0) + 1
    lines.append(f"strata total={total} (min {minimums['total']})")
    if total < minimums["total"]:
        short.append(f"total {total}/{minimums['total']}")
    for rt, need in minimums["record_type"].items():
        got = by_type.get(rt, 0)
        lines.append(f"  type {rt:<14} {got:>3} (min {need})")
        if got < need:
            short.append(f"record_type {rt} {got}/{need}")
    for au, need in minimums["author"].items():
        got = by_author.get(au, 0)
        lines.append(f"  author {au:<12} {got:>3} (min {need})")
        if got < need:
            short.append(f"author {au} {got}/{need}")
    tsdr = by_author.get("tsdr", 0)
    lines.append(f"  author tsdr         {tsdr:>3} of {total} (majority needs > {total // 2})")
    if not tsdr * 2 > total:
        short.append(f"author tsdr {tsdr}/{total} is not a majority")
    lines.append(f"  live-session transcripts {len(live)} (min {minimums['live_session_transcripts']})")
    if len(live) < minimums["live_session_transcripts"]:
        short.append(f"live-session transcripts {len(live)}/{minimums['live_session_transcripts']}")
    lines.append(f"  sunday scans issues {len(issues)} (min {minimums['sunday_scans_issues']})")
    if len(issues) < minimums["sunday_scans_issues"]:
        short.append(f"sunday scans issues {len(issues)}/{minimums['sunday_scans_issues']}")
    for au in minimums["discord_team_authors"]:
        got = discord_by_author.get(au, 0)
        lines.append(f"  discord records by {au:<12} {got:>3} (min 1)")
        if got < 1:
            short.append(f"discord records by {au} 0/1")
    lines.append("  matrix type x author x status x verification:")
    for (rt, au, st, ver), n in sorted(matrix.items()):
        lines.append(f"    {rt:<14} {au:<18} {st:<12} {ver:<20} {n}")
    return lines, short


# ── data root and entry point ─────────────────────────────────────────────────

def data_root(explicit: str | None = None) -> pathlib.Path:
    """data/wisdom is gitignored, so a secondary worktree has none — find the checkout that does."""
    if explicit:
        return pathlib.Path(explicit)
    if os.environ.get("WISDOM_DATA_ROOT"):
        return pathlib.Path(os.environ["WISDOM_DATA_ROOT"])
    local = REPO / "data" / "wisdom"
    if (local / V0_GOLDEN_REL).exists():
        return local
    git = shutil.which("git")
    if git:
        try:
            out = subprocess.run([git, "-C", str(REPO), "worktree", "list", "--porcelain"], capture_output=True,
                                 text=True, encoding="utf-8", errors="replace", timeout=30, check=False).stdout
        except (OSError, subprocess.SubprocessError):
            out = ""
        for line in out.splitlines():
            if line.startswith("worktree "):
                cand = pathlib.Path(line[len("worktree "):].strip()) / "data" / "wisdom"
                if (cand / V0_GOLDEN_REL).exists():
                    return cand
    return local


def load_records(path: pathlib.Path) -> list[dict]:
    out = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise SystemExit(f"FAIL line {n}: not JSON ({exc})")
    return out


def load_categories(samples: pathlib.Path) -> dict[int, str]:
    idx = samples / "transcripts" / "_index.json"
    if not idx.exists():
        return {}
    return {int(it["id"]): it.get("category") for it in json.loads(idx.read_text(encoding="utf-8"))}


def _rel(p: pathlib.Path) -> str:
    try:
        return str(p.resolve().relative_to(REPO))
    except ValueError:
        return str(p)


def _write_atomic(path: pathlib.Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    # platform newlines, exactly like the v0 tool's write_text, so a v0 run leaves the committed file unchanged
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def run(golden: pathlib.Path, samples: pathlib.Path, provenance_path: pathlib.Path | None,
        review_queue: pathlib.Path | None, require_strata: bool, write_provenance: bool,
        frozen: str | None = None) -> int:
    if frozen:
        # ⛔ The freeze is a number in LEDGER.md, and a number in a document is a claim about a
        # moment. This makes it a command: the set the gate scores is byte-identical to the set
        # the owner froze, or the run stops.
        got = hashlib.sha256(golden.read_bytes()).hexdigest()
        if got != frozen.strip().lower():
            print(f"FAIL — golden-v1 is not the frozen set: sha256={got} but --frozen said {frozen.strip().lower()}")
            return 1
        print(f"FROZEN OK — sha256={got}")
    records = load_records(golden)
    # ⛔ NULL rows are split out FIRST. They carry a locator like a v1 row and would otherwise be
    # handed to check_v1, which requires an `expected` record and a record_type — a NULL row has
    # neither, on purpose, and the resulting failures would read as bad labels rather than as a
    # format the checker has not been taught.
    nulls = [r for r in records if r.get("kind") == NULL_KIND]
    v1 = [r for r in records if r.get("kind") != NULL_KIND and "locator" in r]
    v0 = [r for r in records if r.get("kind") != NULL_KIND and "locator" not in r]
    by_type: dict[str, int] = {}
    for r in v0 + v1:
        by_type[r["record_type"]] = by_type.get(r["record_type"], 0) + 1
    null_by_type: dict[str, int] = {}
    for r in nulls:
        for t_ in r.get("null_for") or []:
            null_by_type[t_] = null_by_type.get(t_, 0) + 1
    print(f"records={len(records)} (v0={len(v0)} v1={len(v1)} null={len(nulls)}) by_type={by_type}")
    if nulls:
        print(f"NULL segments: {len(nulls)} asserting absence, by type {null_by_type}")
    code, problems, prov = 0, [], {}
    if v0:
        c, p, pv = check(v0, samples)
        code, problems, prov = max(code, c), problems + p, {**prov, **pv}
    categories = load_categories(samples)
    if v1:
        contracts = load_contracts()
        subjects = None
        gids = {r.get("gid") for r in records}
        if review_queue is not None and review_queue.exists():
            subjects, qp = load_review_queue(review_queue, gids)
            problems += qp
            if qp:
                code = max(code, 1)
            print(f"review queue: {len(subjects)} subjects in {_rel(review_queue)}")
        c, p, pv = check_v1(v1, samples, contracts, subjects, categories)
        code, problems, prov = max(code, c), problems + p, {**prov, **pv}
    if nulls:
        # The base sha is READ FROM THE FILE, never asserted: an absent golden-v1 records null
        # rather than a remembered number (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`).
        base = golden.parent / "golden-v1.jsonl"
        base_sha = hashlib.sha256(base.read_bytes()).hexdigest() if base.exists() else None
        c, p, pv = check_null(nulls, samples, load_contracts(), categories, base_sha)
        code, problems, prov = max(code, c), problems + p, {**prov, **pv}
    for p in problems:
        print("  -", p)
    if code == 0 and provenance_path is not None:
        text = json.dumps(prov, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
        leaks = quote_leaks(text, records)
        if leaks:
            print(f"FAIL — provenance would carry quote text for {leaks}")
            return 1
        if (v1 or nulls) and provenance_path.exists() and not write_provenance:
            old = json.loads(provenance_path.read_text(encoding="utf-8"))
            drift = sorted(g for g in set(old) | set(prov) if old.get(g) != prov.get(g))
            if drift:
                for g in drift[:40]:
                    print(f"  - DRIFT {g}: committed provenance differs from the samples")
                print(f"FAIL — provenance drift on {len(drift)} records (rerun with --write-provenance to accept)")
                return 1
            print(f"PASS — provenance for {len(prov)} records matches {_rel(provenance_path)}")
        else:
            _write_atomic(provenance_path, text)
            print(f"PASS — provenance for {len(prov)} records -> {_rel(provenance_path)}")
    elif code == 0:
        print(f"PASS — {len(prov)} records")
    else:
        print("INCONCLUSIVE" if code == 2 else "FAIL")
        return code
    if require_strata:
        # Strata are about who authored WHAT; a NULL row authors nothing and must not count
        # toward a per-type minimum it would silently inflate.
        lines, short = strata(v1 or [r for r in records if r.get("kind") != NULL_KIND], categories)
        print("\n".join(lines))
        if short:
            for s in short:
                print(f"  SHORTFALL: {s}")
            print(f"STRATA SHORTFALL ({len(short)})")
            return 3
        print("STRATA PASS")
    return 0


# ── self-check ────────────────────────────────────────────────────────────────

def self_check() -> int:
    """Prove the checker can see a presence AND can fail on an absence, for every rule it enforces."""
    bad = 0

    def expect(name: str, got, want, detail="") -> None:
        nonlocal bad
        ok = got == want
        bad += not ok
        print(f"  {'ok ' if ok else 'BAD'} {name}: {got!r} (want {want!r}) {detail}")

    with tempfile.TemporaryDirectory() as d:
        dp = pathlib.Path(d)
        # ── v0 cases, unchanged ──
        (dp / "s.txt").write_text("alpha beta. gamma delta. alpha beta.", encoding="utf-8")
        (dp / "c.transcript_cues.json").write_text(json.dumps(
            {"cues": [{"t": 1, "text": "Patrick (TSDR): hello there"}, {"t": 2, "text": "Ravi: ok. 9:30 works"}]}),
            encoding="utf-8")
        base = {"gid": "X", "sample_file": "s.txt"}
        cases = [
            ("control: unique quote passes", [dict(base, quote="gamma delta.")], 0),
            ("absent quote fails", [dict(base, quote="epsilon")], 1),
            ("ambiguous quote fails", [dict(base, quote="alpha beta.")], 1),
            ("missing sample is INCONCLUSIVE, not PASS", [dict(base, sample_file="nope.txt", quote="x")], 2),
            ("cue join strips speakers", [{"gid": "Y", "sample_file": "c.transcript_cues.json", "quote": "hello there ok. 9:30 works"}], 0),
            ("speaker prefix is NOT part of the text", [{"gid": "Y", "sample_file": "c.transcript_cues.json", "quote": "Ravi: ok"}], 1),
            ("list count mismatch fails", [dict(base, quote="gamma delta.", labels={"list_kind": "x", "tickers_expected_unique": 9, "duplicates_in_source": []})], 1),
        ]
        for name, recs, want in cases:
            code, probs, _ = check(recs, dp)
            expect(f"v0 {name}", code, want, probs[:1])

        # ── v1 fixtures ──
        (dp / "sunday_scans_html").mkdir()
        (dp / "sunday_scans_html" / "sunday-scans-zz.html").write_text(
            "<p>Welcome text.</p><h3>INTRO</h3><p>Risk first, always.</p>"
            "<h3>Bracco&#8217;s Breakdown &amp; Top Ideas</h3><div><hr></div>"
            "<p><strong>ABC (Daily)</strong><br>Fixture line about ABC for the parser.</p>"
            "<svg><polyline points='1 2'></polyline></svg><button>x</button>"
            "<h3>TSDR&#8217;s Weekly Outlook &amp; Watchlist</h3><p><em><strong>Current Positions<br>XYZ QRS </strong></em></p>",
            encoding="utf-8")
        (dp / "transcripts").mkdir()
        (dp / "transcripts" / "_index.json").write_text(json.dumps(
            [{"id": 7, "category": "Live Trading Sessions"}, {"id": 8, "category": "Workshops & Fireside Chats"}]),
            encoding="utf-8")
        (dp / "transcripts" / "7.json").write_text(json.dumps({"id": 7, "category": "Live Trading Sessions", "transcript":
            "[0:05] Patrick (TSDR): good morning\n[1:02:03] Patrick (TSDR): fixture pass on DEF, too thin.\n[1:02:09] Brac: ok"}),
            encoding="utf-8")
        (dp / "transcripts" / "8.json").write_text(json.dumps({"id": 8, "category": "Workshops & Fireside Chats", "transcript":
            "[0:10] zen: cut losers fast and let winners run."}), encoding="utf-8")
        (dp / "discord").mkdir()
        (dp / "discord" / "tsdr.jsonl").write_text(json.dumps(
            {"message_id": "55", "channel_id": "882459873823043655", "author_id": "339816805805588480",
             "created_at": "2026-09-11T14:22:00Z", "content": "fixture holding XYZW from the open", "attachments": []}) + "\n",
            encoding="utf-8")

        html_src = load_source(dp, "sunday_scans_html/sunday-scans-zz.html")
        expect("html: svg/button dropped, entities decoded", "points" in html_src.body or "x\n" in html_src.body, False)
        info = html_src.block_at(html_src.body.index("Fixture line about ABC"))
        expect("html: chart label inside a signed section", (info["section_path"], info["paragraph"], info["author"]),
               ("Bracco's Breakdown & Top Ideas".replace("'", "’") + " > ABC (Daily)", 1, "bracco"))
        info = html_src.block_at(html_src.body.index("XYZ QRS"))
        expect("html: Current Positions is a subsection", info["section_path"].endswith("> Current Positions"), True)
        tr_src = load_source(dp, "transcripts/7.json")
        expect("transcript: cue time + speaker at a quote", tr_src.cue_at(tr_src.body.index("fixture pass"))[1:],
               (3723, "Patrick (TSDR)"))

        contracts = load_contracts()

        def rec(gid, rtype, quote, sample, ext, stream, author, locator_extra, method, **over):
            e = blank_expected(rtype, quote)
            e.update(over.pop("exp", {}))
            r = {"gid": gid, "golden_version": "v1", "record_type": rtype, "author_id": author,
                 "is_guest": False, "stream": stream,
                 "locator": dict({"external_ref": ext, "sample": sample}, **locator_extra),
                 "quote": quote, "expected": e, "private": {}, "relations": [], "status": "confirmed",
                 "verification": "text-only", "verified_by": "auto",
                 "evidence": {"attribution": {"method": method}}, "split": split_for(gid), "notes": None}
            for k, v in over.items():
                if k == "evidence":
                    r["evidence"].update(v)
                else:
                    r[k] = v
            return r

        mention = rec("T-1", "MENTION", "Fixture line about ABC for the parser.", "sunday_scans_html/sunday-scans-zz.html",
                      "substack:/p/sunday-scans-zz", "sunday_scans", "bracco",
                      {"section_path": "Bracco’s Breakdown & Top Ideas > ABC (Daily)", "paragraph": 1},
                      "signed_section", evidence={"entity": {"ticker": "ABC"}})
        neg = rec("T-2", "NEGATIVE_CALL", "fixture pass on DEF, too thin.", "transcripts/7.json", "edu_videos:7",
                  "zoom_live", "tsdr", {"cue_t_s": 3723, "speaker_label": "Patrick (TSDR)"}, "speaker_label",
                  exp={"stance": "passed", "ticker_as_written": "DEF", "reason_class": "liquidity"},
                  evidence={"entity": {"ticker": "DEF"}})
        guest = rec("T-3", "PRINCIPLE", "cut losers fast and let winners run.", "transcripts/8.json", "edu_videos:8",
                    "workshop", "guest:zen", {"cue_t_s": 10, "speaker_label": "zen"}, "guest_speaker_label",
                    is_guest=True, exp={"principle": {"statement": "Cut losers fast.", "category": "risk",
                                                      "empirical_claim": False, "testable_claim": None}})
        disc = rec("T-4", "CALL", "fixture holding XYZW from the open", "discord/tsdr.jsonl", "discord:882459873823043655:55",
                   "discord", "tsdr", {}, "discord_author_id",
                   exp={"stance": "in_it", "direction": "long", "ticker_as_written": "XYZW"},
                   evidence={"entity": {"ticker": "XYZW"}})
        good = [mention, neg, guest, disc]

        def v1(recs, subjects=None):
            code, probs, _ = check_v1(recs, dp, contracts, subjects, load_categories(dp))
            return code, probs

        def mutate(r, **changes):
            r = json.loads(json.dumps(r))
            for path, value in changes.items():
                node = r
                parts = path.split("__")
                for part in parts[:-1]:
                    node = node[part]
                node[parts[-1]] = value
            return r

        code, probs = v1(good)
        expect("v1 control: html + transcript + guest + discord records pass", code, 0, probs[:2])
        v1_cases = [
            ("wrong paragraph fails", [mutate(mention, locator__paragraph=0)]),
            ("signed-section author mismatch fails", [mutate(mention, author_id="tsdr")]),
            ("wrong cue_t_s fails", [mutate(neg, locator__cue_t_s=3720)]),
            ("guest CALL fails (D14)", [mutate(guest, record_type="CALL", expected__record_type="CALL",
                                               expected__principle=None, expected__direction="long")]),
            ("no-view on a NEGATIVE_CALL fails (R3)", [mutate(neg, expected__stance="no_view")]),
            ("share count in expected fails", [mutate(disc, expected__size_shares=100)]),
            ("open-position entry in expected fails", [mutate(disc, expected__entry=925)]),
            ("private number echoed in expected fails", [mutate(neg, private={"open_entry": 12.5},
                                                                expected__levels=[{"type": "other", "price": 12.5, "price_as_heard": None}])]),
            ("CALL with no level/trigger/action is a MENTION (R1)", [mutate(disc, expected__stance="watching")]),
            ("wrong split fails", [mutate(mention, split="test" if mention["split"] == "dev" else "dev")]),
            ("bad enum in expected fails", [mutate(neg, expected__reason_class="vibes")]),
            ("unknown setup_vocab fails", [mutate(mention, expected__setup_vocab="Moon Pattern")]),
            ("relation to a missing gid fails", [mutate(mention, relations=[{"relation": "reinforces", "gid": "T-99"}])]),
            ("discord author mismatch fails", [mutate(disc, author_id="bracco")]),
            ("non-mechanical attribution must be provisional", [mutate(neg, evidence__attribution={"method": "adjacency"})]),
            ("bars verification without bars evidence fails", [mutate(neg, verification="text+bars")]),
            ("a non-verbatim event_at_text fails", [mutate(neg, expected__event_at_text="Friday")]),
            ("ticker_as_written absent from quote and label fails", [mutate(neg, expected__ticker_as_written="QQQ")]),
        ]
        for name, recs in v1_cases:
            code, probs = v1(recs)
            expect(f"v1 {name}", code, 1, probs[:1])
        # ── §8a.2 / §8b.7 / §8a.4 — the rails P4 added, each with a control that passes ──
        amb_label = next(iter(contracts["ambiguous_labels"]), None)
        expect("authors.json declares at least one ambiguous label", bool(amb_label), True)
        (dp / "transcripts" / "9.json").write_text(json.dumps({"id": 9, "category": "Live Trading Sessions",
            "transcript": "[0:20] Uncharted Territory: fixture mention of GHI under the shared label."}),
            encoding="utf-8")
        idx = json.loads((dp / "transcripts" / "_index.json").read_text(encoding="utf-8"))
        idx.append({"id": 9, "category": "Live Trading Sessions"})
        (dp / "transcripts" / "_index.json").write_text(json.dumps(idx), encoding="utf-8")
        shared = rec("T-6", "MENTION", "fixture mention of GHI under the shared label.", "transcripts/9.json",
                     "edu_videos:9", "zoom_live", TEAM_UNRESOLVED,
                     {"cue_t_s": 20, "speaker_label": "Uncharted Territory"}, "owner_ruling",
                     evidence={"entity": {"ticker": "GHI"}, "excluded_from": list(TEAM_UNRESOLVED_EXCLUSIONS)})
        code, probs = v1([shared])
        expect("v1 control: an owner-ruled unknown speaker passes as a team-unresolved MENTION", code, 0, probs[:1])
        # A session resolution passes ONLY against the committed, evidence-citing table.
        resolved_key = next(iter(contracts["session_resolutions"]), None)
        expect("session-resolutions table is loaded", bool(resolved_key), True)
        ambiguous_cases = [
            ("ambiguous label via speaker_label fails (the alias defect)",
             [mutate(shared, evidence__attribution={"method": "speaker_label"}, author_id="tsdr")]),
            ("owner_ruling that names a person fails",
             [mutate(shared, author_id="tsdr")]),
            ("session_resolution with no table entry fails",
             [mutate(shared, evidence__attribution={"method": "session_resolution"}, author_id="tsdr")]),
            ("session_resolution on a NON-ambiguous label fails",
             [mutate(neg, evidence__attribution={"method": "session_resolution"})]),
            # ⛔ PRINCIPLE, not CALL: a team-unresolved CALL is ALSO caught by the older
            # can_author_calls rail, so a CALL case cannot tell this guard from that one.
            # §8a.2 names both ("never CALL, never PRINCIPLE attribution") and only the
            # PRINCIPLE half rests on this guard alone.
            ("team-unresolved may not author a PRINCIPLE",
             [mutate(shared, record_type="PRINCIPLE", expected__record_type="PRINCIPLE",
                     expected__stance=None,
                     expected__principle={"statement": "A fixture principle.", "category": "risk",
                                          "empirical_claim": False, "testable_claim": None})]),
            ("team-unresolved may not author a CALL either",
             [mutate(shared, record_type="CALL", expected__record_type="CALL", expected__direction="long",
                     expected__stance="in_it")]),
            ("team-unresolved without the publish/see-rate exclusions fails",
             [mutate(shared, evidence__excluded_from=["uct_see_rate"])]),
        ]
        for name, recs in ambiguous_cases:
            code, probs = v1(recs)
            expect(f"v1 {name}", code, 1, probs[:1])

        # ⛔ A RAIL MUST FAIL FOR ITS OWN REASON. With the §8a.2 guard deleted, the two
        # cases above still fail — on the older "not an alias in authors.json" rail — so
        # they cannot tell whether the guard is there at all
        # (`lesson_mutations_can_cancel_each_other`). These two reproduce the exact defect
        # the ruling was written for and nothing else catches: a label declared ambiguous
        # AND left in an alias list, and a resolution entry attached to an ordinary label.
        def v1x(recs, over):
            merged = dict(contracts)
            merged.update(over)
            code, probs, _ = check_v1(recs, dp, merged, None, load_categories(dp))
            return code, probs

        readded = {"alias": {**contracts["alias"], "uncharted territory": "tsdr"}}
        code, probs = v1x([mutate(shared, evidence__attribution={"method": "speaker_label"},
                                  author_id="tsdr")], readded)
        expect("v1 an ambiguous label RE-ADDED to an alias list still resolves to nobody", code, 1, probs[:1])
        planted = {"session_resolutions": {
            **contracts["session_resolutions"],
            ("edu_videos:7", "patrick (tsdr)"): {"author_id": "tsdr", "cited": [{"kind": "session_title"}]}}}
        code, probs = v1x([mutate(neg, evidence__attribution={"method": "session_resolution"})], planted)
        expect("v1 a session resolution attached to an ORDINARY label is refused", code, 1, probs[:1])

        inferred = mutate(disc, gid="T-7", split=split_for("T-7"),
                          expected__extraction_confidence="low", verification="text+bars",
                          evidence__entity={"ticker": "XYZW", "inferred": True, "entity_confidence": 0.5,
                                            "bar_range_pass": True},
                          evidence__bars=[{"check": "inside the range", "ticker": "XYZW", "result": True}])
        code, probs = v1([inferred])
        expect("v1 control: a compliant §8a.4 inferred ticker passes", code, 0, probs[:1])
        inferred_cases = [
            ("inferred ticker with entity_confidence > 0.5 fails",
             [mutate(inferred, evidence__entity={"ticker": "XYZW", "inferred": True, "entity_confidence": 0.8,
                                                 "bar_range_pass": True})]),
            ("inferred ticker without extraction_confidence 'low' fails",
             [mutate(inferred, expected__extraction_confidence="high")]),
            ("inferred ticker with no passing bar-range check fails",
             [mutate(inferred, evidence__entity={"ticker": "XYZW", "inferred": True, "entity_confidence": 0.5},
                     evidence__bars=[], verification="text-only")]),
            ("inferred ticker whose bar check is on ANOTHER ticker fails",
             [mutate(inferred, evidence__bars=[{"check": "inside the range", "ticker": "OTHER", "result": True}])]),
        ]
        for name, recs in inferred_cases:
            code, probs = v1(recs)
            expect(f"v1 {name}", code, 1, probs[:1])

        prov_rec = mutate(neg, status="provisional", evidence__attribution={"method": "adjacency"})
        expect("v1 provisional without a queue item fails", v1([prov_rec], subjects=set())[0], 1)
        expect("v1 control: provisional with a queue item passes", v1([prov_rec], subjects={"T-2"})[0], 0)
        expect("v1 missing discord message is INCONCLUSIVE", v1([mutate(disc, locator__external_ref="discord:882459873823043655:99")])[0], 2)

        _, _, prov = check_v1(good, dp, contracts, None, load_categories(dp))
        text = json.dumps(prov, ensure_ascii=False)
        expect("control: provenance is quote-free", quote_leaks(text, good), [])
        expect("planted quote in provenance is caught", quote_leaks(text + good[1]["quote"], good), ["T-2"])
        _, short = strata(good, load_categories(dp))
        expect("strata shortfall is named on a 4-record set", any(s.startswith("record_type CALL") for s in short), True)
        zero = {"total": 0, "record_type": {}, "author": {}, "live_session_transcripts": 1, "sunday_scans_issues": 1,
                "discord_team_authors": ()}
        good_tsdr = good + [mutate(neg, gid="T-5", split=split_for("T-5"))]
        _, short = strata(good_tsdr, load_categories(dp), zero)
        expect("control: minimums met -> no shortfall", short, [])


        # ── v1.1 NULL segments ──────────────────────────────────────────────
        # ⛔ NON-VACUITY FIRST. Every case below turns on a screen coming back EMPTY, and an
        # empty result is a failed invocation until proven otherwise: if the screens matched
        # nothing ever, every NULL row would pass and the checker would be decoration.
        loud = null_screens("Bought $NVDA and MSFT at 10.50, Micron too. Never average down. T2108 washout.")
        expect("null screens see a cashtag", loud["cashtags"], ["$NVDA"])
        # NVDA is here too, from inside the cashtag: the two screens overlap ON PURPOSE, so a
        # cashtag regex that stopped matching would not open a hole.
        expect("null screens see a bare ticker", loud["upper_tokens"], ["MSFT", "NVDA"])
        expect("null screens see a company name", loud["companies"], ["micron"])
        expect("null screens see a price", loud["prices"], ["10.50"])
        expect("null screens see principle vocabulary", loud["principle_lexicon"], ["never"])
        expect("null screens see signal vocabulary", loud["signal_lexicon"], ["t2108", "washout"])
        # ⛔ and the screen must NOT be the product's own universe-gated detector: SOXL and CBRS
        # are real tickers that cap_universe.json does not know, and the first version of this
        # selection passed messages naming them as "no instrument here".
        expect("an off-universe ticker is still an instrument", null_screens("all out of SOXL and CBRS")["upper_tokens"],
               ["CBRS", "SOXL"])

        MECH = ["CALL", "NEGATIVE_CALL", "MENTION", "LEVEL"]

        def nrec(gid, quote, types, sample="transcripts/7.json", ext="edu_videos:7", stream="zoom_live",
                 locator_extra=None, **over):
            checks = null_checks_for(types, null_screens(quote))
            ev = {"attribution": {"method": "not_applicable"}, "null_checks": checks,
                  "review_item": "RQ-selfcheck", "v1_labels_in_this_span": 0}
            r = {"gid": gid, "golden_version": "v1.1", "kind": NULL_KIND, "null_for": list(types),
                 "record_type": None, "author_id": None, "is_guest": False, "stream": stream,
                 "locator": dict({"external_ref": ext, "sample": sample},
                                 **(locator_extra if locator_extra is not None
                                    else {"cue_t_s": 5, "speaker_label": "Patrick (TSDR)"})),
                 "quote": quote, "expected": [], "private": {}, "relations": [],
                 "status": null_status(checks), "verification": "text-only", "verified_by": "auto",
                 "evidence": ev, "split": split_for(gid), "notes": None}
            for k, v in over.items():
                r[k] = v
            return r

        def nul(recs):
            code, probs, _ = check_null(recs, dp, contracts, load_categories(dp))
            return code, probs

        mech_only = nrec("N-T1", "good morning", MECH)
        all_six = nrec("N-T2", "good morning", MECH + ["PRINCIPLE", "MARKET_SIGNAL"])
        expect("null control: a well-formed row passes", nul([mech_only])[0], 0, nul([mech_only])[1][:1])
        expect("null: four mechanical types are CONFIRMED", mech_only["status"], "confirmed")
        expect("null: adding PRINCIPLE/MARKET_SIGNAL makes the ROW provisional", all_six["status"], "provisional")
        expect("null control: the provisional row still passes", nul([all_six])[0], 0, nul([all_six])[1][:1])
        expect("null: a status that does not follow from the checks fails",
               nul([mutate(all_six, status="confirmed")])[0], 1)
        expect("null: a row that names an author fails", nul([mutate(mech_only, author_id="tsdr")])[0], 1)
        expect("null: a row with a record_type fails", nul([mutate(mech_only, record_type="MENTION")])[0], 1)
        expect("null: a row carrying an expected record fails",
               nul([mutate(mech_only, expected={"record_type": "MENTION"})])[0], 1)
        expect("null: a wrong cue_t_s fails", nul([mutate(mech_only, locator__cue_t_s=9999)])[0], 1)
        expect("null: an unknown type in null_for fails", nul([mutate(mech_only, null_for=["NOPE"])])[0], 1)
        expect("null: an empty null_for fails", nul([mutate(mech_only, null_for=[])])[0], 1)
        expect("null: a missing sample is INCONCLUSIVE, not PASS",
               nul([mutate(mech_only, locator__sample="transcripts/999.json")])[0], 2)
        # ⛔ the load-bearing one: the stored claim is re-derived from the text, never believed
        lying = json.loads(json.dumps(all_six))
        lying["evidence"]["null_checks"]["PRINCIPLE"] = {"method": "no_instrument_token", "mechanical": True,
                                                         "screen_hits": []}
        expect("null: a row claiming a method its text does not support fails", nul([lying])[0], 1)
        planted = nrec("N-T3", "fixture pass on DEF, too thin.", MECH)
        expect("null: a quote carrying a ticker fails the mechanical screen", nul([planted])[0], 1)
        # one class, one ruling — 44 copies of a single judgement is not 44 judgements
        other = json.loads(json.dumps(all_six))
        other["gid"] = "N-T4"
        other["split"] = split_for("N-T4")
        other["evidence"]["review_item"] = "RQ-different"
        expect("null: two rulings for one provisional class fails", nul([all_six, other])[0], 1)
        other["evidence"]["review_item"] = "RQ-selfcheck"
        expect("null control: one ruling for the class passes", nul([all_six, other])[0], 0)
        _, _, nprov = check_null([all_six], dp, contracts, load_categories(dp))
        expect("null control: provenance is quote-free",
               quote_leaks(json.dumps(nprov, ensure_ascii=False), [all_six]), [])

    print("SELF-CHECK", "PASS" if not bad else f"FAIL ({bad})")
    return 0 if not bad else 1


def main() -> int:
    try:
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--golden", help="golden JSONL (default: <data root>/golden/golden-v0.draft.jsonl)")
    ap.add_argument("--provenance", help="quote-free provenance JSON to match or write (default: the v0 file for v0)")
    ap.add_argument("--samples", help="samples directory (default: <golden>/../../samples)")
    ap.add_argument("--review-queue", help="review-queue JSONL (default: review-queue-v1.jsonl beside a v1 golden)")
    ap.add_argument("--data-root", help="data/wisdom directory (default: this checkout, else another worktree)")
    ap.add_argument("--require-strata", action="store_true", help="check the W1 §2.4 stratification minimums")
    ap.add_argument("--write-provenance", action="store_true", help="accept drift and rewrite the provenance file")
    ap.add_argument("--frozen", metavar="SHA256",
                    help="refuse to run unless the golden file's sha256 is this (the LEDGER freeze, as a command)")
    args = ap.parse_args()
    if args.self_check:
        return self_check()
    if args.golden:
        golden = pathlib.Path(args.golden)
        provenance = pathlib.Path(args.provenance) if args.provenance else None
    else:
        golden = data_root(args.data_root) / V0_GOLDEN_REL
        provenance = pathlib.Path(args.provenance) if args.provenance else PROVENANCE
    if not golden.exists():
        print(f"INCONCLUSIVE — golden set not present at {golden} (gitignored; local only)")
        return 2
    if provenance is not None and not provenance.is_absolute():
        provenance = REPO / provenance
    samples = pathlib.Path(args.samples) if args.samples else golden.parent.parent / "samples"
    queue = pathlib.Path(args.review_queue) if args.review_queue else golden.parent / "review-queue-v1.jsonl"
    return run(golden, samples, provenance, queue, args.require_strata, args.write_provenance, args.frozen)


if __name__ == "__main__":
    sys.exit(main())
