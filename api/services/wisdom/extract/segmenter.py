"""Source text -> SEGMENTS, the unit the extractor sees (W1 §4.5-4.7, CONTRACTS §6.4).

Three shapes, one output type:

  * transcripts  -> cue windows, built per chapter. Inside a chapter, every cue that
    names a ticker gets a window of ±TICKER_PAD_S; windows closer than
    MIN_GAP_WINDOW_S merge. The rest of the chapter is covered by FALLBACK_WINDOW_S
    windows overlapping by FALLBACK_OVERLAP_S, so nothing a ticker detector misses
    (company names, ASR-mangled symbols, principles) falls out of coverage. Any span
    longer than TILE_THRESHOLD_S is tiled the same way. EVERY window edge overlaps
    its neighbour by FALLBACK_OVERLAP_S (a ticker window and the gap beside it
    included), and a chapter's last window runs CHAPTER_OVERLAP_S past the cut, so a
    sentence spoken across any edge lands whole in at least one segment. Duplicate
    records from the overlap are removed by the writer's overlap dedupe.
  * Sunday Scans -> sections. A section starts at a top heading (INTRO, Calendar,
    Breadth, Index & ETFs, <author>'s Breakdown, Weekly Outlook), a sub heading
    (Current Positions, Charts Covered, Honorable Mention) or a chart label
    ("SNDK (Daily)"). Consecutive small sections of one top heading are packed up
    to SECTION_PACK_CHARS so a 45-chart issue is not 45 requests.
  * Discord -> one message per segment.

THE NORMALISATION IS tools/wisdom_golden_verify.py's, byte for byte: a cue's
leading "<speaker>: " (head up to 40 chars) is stripped, and cue texts are joined
by ONE space; a Sunday Scans text file is used as-is. Every segment's text is a
contiguous slice [char_start:char_end] of that normalised source text, which is
what lets a golden quote verified against the source be found inside a segment,
and what the writer's "quote occurs exactly once" check is measured against.
tests/test_wisdom_extract_segmenter.py pins the parity against the tool itself.

MAX_SEGMENT_CHARS bounds the text of one request (≈3k tokens); a window over it is
split at cue boundaries with FALLBACK_OVERLAP_S of overlap.
"""
from __future__ import annotations

import functools
import json
import pathlib
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Iterable, Optional

from api.services.wisdom.core import ids

SEGMENTER_VERSION = "seg-v0"
NORMALIZER_VERSION = "seg-v0/norm-v0"

TICKER_PAD_S = 60.0
FALLBACK_WINDOW_S = 240.0
FALLBACK_OVERLAP_S = 30.0
CHAPTER_OVERLAP_S = FALLBACK_OVERLAP_S
MIN_CHAPTER_S = 60.0
MIN_GAP_WINDOW_S = 60.0
TILE_THRESHOLD_S = FALLBACK_WINDOW_S + MIN_GAP_WINDOW_S
MAX_SEGMENT_CHARS = 12_000
SECTION_PACK_CHARS = 2_500
SPEAKER_MAX = 40
TURN_MAX_CHARS = 700
TURN_GAP_S = 45.0

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
UNIVERSE_FILE = REPO_ROOT / "api" / "data" / "cap_universe.json"


# ── normalisation (mirror of tools/wisdom_golden_verify.py) ─────────────────

def strip_speaker(text: str) -> tuple[Optional[str], str]:
    head, sep, rest = text.partition(": ")
    if sep and 0 < len(head) <= SPEAKER_MAX:
        return head, rest
    return None, text


@dataclass(frozen=True)
class Cue:
    t: float
    speaker: Optional[str]
    text: str


def cues_from_raw(raw_cues: Iterable[dict]) -> list[Cue]:
    """[{t, text}] (t seconds, int/float/str) -> Cues. Every cue is kept, empty
    ones included, because the golden normalisation joins every cue."""
    out: list[Cue] = []
    last_t = 0.0
    for raw in raw_cues or []:
        try:
            t = float(raw.get("t"))
        except (TypeError, ValueError):
            t = last_t
        speaker, body = strip_speaker(str(raw.get("text") or ""))
        out.append(Cue(t=t, speaker=speaker, text=body))
        last_t = t
    return out


def normalized_cue_text(cues: list[Cue]) -> tuple[str, list[int]]:
    """(joined text, start offset of each cue's text)."""
    offsets: list[int] = []
    pos = 0
    for i, cue in enumerate(cues):
        if i:
            pos += 1
        offsets.append(pos)
        pos += len(cue.text)
    return " ".join(c.text for c in cues), offsets


# ── ticker mentions (window boundaries only; never a record) ────────────────

_CASHTAG = re.compile(r"\$([A-Za-z]{1,5})\b")
_UPPER = re.compile(r"\b([A-Z]{2,5})\b")
_MENTION_STOP = frozenset({
    "AM", "PM", "OK", "US", "USA", "CEO", "CFO", "IPO", "ETF", "ETFS", "EPS", "ATH", "EMA", "SMA",
    "MA", "RS", "HVC", "EP", "PEG", "ORB", "VWAP", "ADR", "ATR", "RSI", "MACD", "AI", "IT", "ON",
    "ALL", "ARE", "BE", "CAN", "GO", "NOW", "SO", "UP", "FOR", "YOU", "OUT", "ONE", "TWO", "NEW",
    "BIG", "DD", "LOL", "IMO", "TBH", "FOMC", "CPI", "PPI", "GDP", "FED", "YTD", "EOD", "AH", "PT",
    "ER", "NYSE", "UCT", "TSDR", "LIVE", "AND", "THE", "BUT", "NOT", "YES", "HOD", "LOD", "HIGH",
    "LOW", "BUY", "SELL", "LONG", "GAP", "VIX", "OR", "IF", "AT", "BY", "TO", "OF", "IN", "IS",
    "MY", "WE", "HE", "AN", "AS", "DO", "NO", "OH", "UK", "EU", "TV", "PDF", "API", "ID",
})


@functools.lru_cache(maxsize=1)
def load_universe() -> frozenset:
    try:
        data = json.loads(UNIVERSE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return frozenset()
    return frozenset(str(t).upper() for t in data if isinstance(t, str))


def detect_mentions(text: str, universe: Optional[frozenset] = None) -> list[str]:
    universe = load_universe() if universe is None else universe
    found: list[str] = []
    for m in _CASHTAG.finditer(text):
        sym = m.group(1).upper()
        if sym not in found:
            found.append(sym)
    for m in _UPPER.finditer(text):
        sym = m.group(1)
        if sym in _MENTION_STOP or sym not in universe or sym in found:
            continue
        found.append(sym)
    return found


# ── the segment ──────────────────────────────────────────────────────────────

@dataclass
class Segment:
    ordinal: int
    kind: str                      # cue_window | section | message
    text: str
    char_start: int
    char_end: int
    t_start_s: Optional[float] = None
    t_end_s: Optional[float] = None
    path: Optional[str] = None
    speaker_label: Optional[str] = None
    author_id: Optional[str] = None
    speaker_confidence: Optional[str] = None
    cue_map: list = field(default_factory=list)    # [[local_offset, t_s, speaker, length], ...]
    mentions: list = field(default_factory=list)

    def segment_id(self, source_id: str, source_version: int) -> str:
        return ids.sha24(source_id, source_version, self.ordinal)

    def to_row(self, source_id: str, source_version: int) -> dict:
        return {
            "segment_id": self.segment_id(source_id, source_version),
            "source_id": source_id,
            "source_version": int(source_version),
            "ordinal": self.ordinal,
            "kind": self.kind,
            "path": self.path,
            "t_start_s": self.t_start_s,
            "t_end_s": self.t_end_s,
            "char_start": self.char_start,
            "char_end": self.char_end,
            "speaker_label": self.speaker_label,
            "author_id": self.author_id,
            "speaker_confidence": self.speaker_confidence,
            "text": self.text,
            "text_sha256": ids.sha256_text(self.text),
            "normalizer_version": NORMALIZER_VERSION,
            "cue_map": self.cue_map,
        }


# ── transcripts ──────────────────────────────────────────────────────────────

def _tile(a: float, b: float) -> list[tuple[float, float]]:
    if b - a <= TILE_THRESHOLD_S:
        return [(a, b)]
    step = FALLBACK_WINDOW_S - FALLBACK_OVERLAP_S
    out: list[tuple[float, float]] = []
    s = a
    while s + FALLBACK_WINDOW_S < b:
        out.append((s, s + FALLBACK_WINDOW_S))
        s += step
    if out and b - out[-1][1] < MIN_GAP_WINDOW_S:
        out[-1] = (out[-1][0], b)
    else:
        out.append((s, b))
    return out


def time_windows(anchors: Iterable[float], start: float, end: float) -> list[tuple[float, float]]:
    """Cover [start, end) with ticker windows and fallback tiles (see module doc)."""
    if end <= start:
        return []
    spans: list[list[float]] = []
    for t in sorted(a for a in anchors if start <= a < end):
        lo, hi = max(start, t - TICKER_PAD_S), min(end, t + TICKER_PAD_S)
        if spans and lo - spans[-1][1] < MIN_GAP_WINDOW_S:
            spans[-1][1] = max(spans[-1][1], hi)
        else:
            spans.append([lo, hi])
    pieces: list[tuple[float, float]] = []
    if not spans:
        pieces.append((start, end))
    else:
        if spans[0][0] - start < MIN_GAP_WINDOW_S:
            spans[0][0] = start
        if end - spans[-1][1] < MIN_GAP_WINDOW_S:
            spans[-1][1] = end
        cur = start
        for lo, hi in spans:
            if lo > cur:
                pieces.append((cur, lo))
            pieces.append((lo, hi))
            cur = hi
        if cur < end:
            pieces.append((cur, end))
    windows: list[tuple[float, float]] = []
    for a, b in pieces:
        windows.extend(_tile(a, b))
    # Tiles overlap by construction; a ticker window and the gap beside it would only
    # abut, and a sentence spoken across that edge would land in neither window whole.
    for i in range(len(windows) - 1):
        lo, hi = windows[i]
        if windows[i + 1][0] >= hi - 1e-9:
            windows[i] = (lo, min(end, hi + FALLBACK_OVERLAP_S))
    return windows


def _chapter_bounds(chapter_starts: Iterable[float], start: float, end: float) -> list[tuple[float, float]]:
    cuts = sorted({float(c) for c in chapter_starts if start < float(c) < end})
    kept: list[float] = []
    prev = start
    for c in cuts:
        if c - prev < MIN_CHAPTER_S:
            continue
        kept.append(c)
        prev = c
    if kept and end - kept[-1] < MIN_CHAPTER_S:
        kept.pop()
    edges = [start] + kept + [end]
    return [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]


def segment_transcript(raw_cues: Iterable[dict], chapters: Optional[Iterable[dict]] = None,
                       *, universe: Optional[frozenset] = None) -> list[Segment]:
    cues = cues_from_raw(raw_cues)
    if not cues:
        return []
    text, offsets = normalized_cue_text(cues)
    # A monotone envelope over cue times: windowing needs order, the join must keep file order.
    times: list[float] = []
    for cue in cues:
        times.append(max(cue.t, times[-1]) if times else cue.t)
    start, end = times[0], times[-1] + 1.0
    chapter_starts = []
    chapter_titles: dict[float, str] = {}
    for ch in chapters or []:
        try:
            ct = float(ch.get("t"))
        except (TypeError, ValueError, AttributeError):
            continue
        chapter_starts.append(ct)
        chapter_titles[ct] = str(ch.get("title") or "")
    mention_idx = {i for i, cue in enumerate(cues) if detect_mentions(cue.text, universe)}

    ranges: list[tuple[int, int, str]] = []
    for c_lo, c_hi in _chapter_bounds(chapter_starts, start, end):
        title = ""
        for ct in sorted(chapter_titles):
            if ct <= c_lo + 1e-6:
                title = chapter_titles[ct]
        anchors = [times[i] for i in mention_idx if c_lo <= times[i] < c_hi]
        windows = time_windows(anchors, c_lo, c_hi)
        if windows and c_hi < end:
            # Chapter timestamps are set by hand; a sentence spoken across the cut must land
            # whole in one segment, so the chapter's last window runs on past it.
            windows[-1] = (windows[-1][0], min(end, c_hi + CHAPTER_OVERLAP_S))
        for w_lo, w_hi in windows:
            idx = [i for i in range(len(cues)) if w_lo <= times[i] < w_hi]
            if idx:
                ranges.extend((a, b, title) for a, b in _split_by_chars(cues, times, idx[0], idx[-1] + 1))

    segments: list[Segment] = []
    seen: set[tuple[int, int]] = set()
    for i0, i1, title in ranges:
        if (i0, i1) in seen:
            continue
        seen.add((i0, i1))
        c_start = offsets[i0]
        c_end = offsets[i1 - 1] + len(cues[i1 - 1].text)
        seg_text = text[c_start:c_end]
        speakers = {cues[i].speaker for i in range(i0, i1)}
        named = {s for s in speakers if s}
        cue_map = [[offsets[i] - c_start, times[i], cues[i].speaker, len(cues[i].text)] for i in range(i0, i1)]
        segments.append(Segment(
            ordinal=len(segments), kind="cue_window", text=seg_text, char_start=c_start, char_end=c_end,
            t_start_s=times[i0], t_end_s=times[i1] if i1 < len(times) else times[-1],
            path=title or None, speaker_label=next(iter(named)) if len(named) == 1 and len(speakers) == 1 else None,
            cue_map=cue_map, mentions=detect_mentions(seg_text, universe),
        ))
    return segments


def _split_by_chars(cues: list[Cue], times: list[float], i0: int, i1: int) -> list[tuple[int, int]]:
    total = sum(len(cues[i].text) + 1 for i in range(i0, i1))
    if total <= MAX_SEGMENT_CHARS:
        return [(i0, i1)]
    out: list[tuple[int, int]] = []
    a = i0
    while a < i1:
        size, b = 0, a
        while b < i1 and (b == a or size + len(cues[b].text) + 1 <= MAX_SEGMENT_CHARS):
            size += len(cues[b].text) + 1
            b += 1
        out.append((a, b))
        if b >= i1:
            break
        back = b
        while back - 1 > a and times[b - 1] - times[back - 1] < FALLBACK_OVERLAP_S:
            back -= 1
        a = max(back, a + 1)
    return out


# ── Sunday Scans ─────────────────────────────────────────────────────────────

_APOSTROPHES = re.compile(r"[’‘`´�]")
_CHART_LABEL = re.compile(r"^\$?[A-Za-z0-9][\w.&/,'\- ]{0,40}?\s*\(([^()]{1,48})\)\s*$")
_TIMEFRAME_WORD = re.compile(
    r"(?i)\b(daily|weekly|hourly|monthly|intraday|\d+\s*(?:m|min|mins|minute|minutes|h|hr|hour))\b")
_SUB_HEADING_PREFIXES = ("current positions", "charts covered", "honorable mention", "positions")
OPENING_PATH = "(opening)"


def _norm_heading(line: str) -> str:
    return " ".join(_APOSTROPHES.sub("'", line).split()).casefold()


def top_heading(line: str) -> Optional[str]:
    raw = line.strip()
    if not raw or raw.startswith("-") or len(raw) > 80:
        return None
    s = _norm_heading(raw)
    if s == "intro" or s.startswith("intro/"):
        return "INTRO"
    if s.startswith("earnings & economic calendar") or s.startswith("schedule of economic data") or s == "calendar":
        return "Calendar"
    if s.startswith("market breadth"):
        return "Breadth"
    if s.startswith("index & etf") or s.startswith("index and etf"):
        return "Index & ETFs"
    if re.match(r"^[\w .]+'s breakdown", s):
        return " ".join(_APOSTROPHES.sub("'", raw).split())
    if "weekly outlook" in s:
        return " ".join(_APOSTROPHES.sub("'", raw).split())
    if s.startswith("closing comments"):
        return "Closing Comments"
    return None


def is_chart_label(line: str) -> bool:
    text = line.strip()
    if len(text) > 60 or text.endswith("."):
        return False
    m = _CHART_LABEL.match(text)
    return bool(m and _TIMEFRAME_WORD.search(m.group(1)))


def is_sub_heading(line: str) -> bool:
    s = _norm_heading(line.strip())
    return len(s) <= 60 and any(s == p or s.startswith(p + " ") or s.startswith(p + "s") or s.startswith(p + " -")
                                for p in _SUB_HEADING_PREFIXES)


def section_author(top: str) -> tuple[Optional[str], str]:
    """(author_id, speaker_confidence). Signed sections name their author; unsigned
    sections are credited to TSDR per the D4 ruling."""
    from api.services.wisdom.core import authors

    s = _norm_heading(top)
    m = re.match(r"^([\w .]+)'s breakdown", s)
    if m:
        author = authors.author_for_alias(m.group(1).strip())
        if author:
            return author, "high"
    for token in re.findall(r"[\w()]+", top):
        author = authors.author_for_alias(token)
        if author:
            return author, "high"
    return "tsdr", "medium"


def segment_sunday_scans(text: str) -> list[Segment]:
    lines = [(m.start(), m.group(0)) for m in re.finditer(r"[^\n]*\n?", text) if m.group(0)]
    units: list[dict] = []
    top: Optional[str] = None
    for start, raw in lines:
        line = raw.rstrip("\r\n")
        heading = top_heading(line)
        if heading:
            top = heading
            units.append({"top": top, "label": None, "start": start})
            continue
        if top is None:
            continue
        if is_chart_label(line) or is_sub_heading(line):
            units.append({"top": top, "label": line.strip(), "start": start})
    if not units:
        return _chunk_plain(text) if text.strip() else []
    if units[0]["start"] > 0 and text[:units[0]["start"]].strip():
        # Everything before the first heading: the welcome, the table of contents and, in
        # some issues, the whole intro. Kept (recall), credited per D4 like any unsigned part.
        units.insert(0, {"top": OPENING_PATH, "label": None, "start": 0})
    for i, unit in enumerate(units):
        unit["end"] = units[i + 1]["start"] if i + 1 < len(units) else len(text)

    packs: list[dict] = []
    for unit in units:
        size = unit["end"] - unit["start"]
        last = packs[-1] if packs else None
        if (last and last["top"] == unit["top"] and unit["label"] is not None
                and (unit["end"] - last["start"]) <= SECTION_PACK_CHARS):
            last["end"] = unit["end"]
            last["labels"].append(unit["label"])
            continue
        packs.append({"top": unit["top"], "start": unit["start"], "end": unit["end"],
                      "labels": [unit["label"] or "(prose)"]})
        if size > MAX_SEGMENT_CHARS:
            packs[-1]["oversize"] = True

    segments: list[Segment] = []
    for pack in packs:
        author, confidence = section_author(pack["top"])
        labels = [lbl for lbl in pack["labels"] if lbl != "(prose)"]
        path = pack["top"] + (" > " + " | ".join(labels) if labels else "")
        for a, b in _line_chunks(text, pack["start"], pack["end"]):
            seg_text = text[a:b]
            if not seg_text.strip():
                continue
            segments.append(Segment(
                ordinal=len(segments), kind="section", text=seg_text, char_start=a, char_end=b, path=path,
                author_id=author, speaker_confidence=confidence, mentions=detect_mentions(seg_text),
            ))
    return segments


def _line_chunks(text: str, start: int, end: int) -> list[tuple[int, int]]:
    if end - start <= MAX_SEGMENT_CHARS:
        return [(start, end)]
    out: list[tuple[int, int]] = []
    a = start
    while a < end:
        b = min(end, a + MAX_SEGMENT_CHARS)
        if b < end:
            nl = text.rfind("\n", a + 1, b)
            if nl > a:
                b = nl + 1
        out.append((a, b))
        a = b
    return out


def _chunk_plain(text: str) -> list[Segment]:
    return [Segment(ordinal=i, kind="section", text=text[a:b], char_start=a, char_end=b,
                    author_id="tsdr", speaker_confidence="medium", mentions=detect_mentions(text[a:b]))
            for i, (a, b) in enumerate(_line_chunks(text, 0, len(text)))]


class _BlockText(HTMLParser):
    _BLOCKS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "figcaption", "pre", "td", "th"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self.images: list[dict] = []
        self._buf: list[str] = []
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._BLOCKS:
            self._flush()
            self._depth += 1
        elif tag == "br":
            self._buf.append(" ")
        elif tag == "img":
            attr = dict(attrs)
            if attr.get("src"):
                self.images.append({"src": attr["src"], "after_block": len(self.blocks),
                                    "width": attr.get("width"), "height": attr.get("height")})

    def handle_endtag(self, tag):
        if tag in self._BLOCKS:
            self._flush()
            self._depth = max(0, self._depth - 1)

    def handle_data(self, data):
        self._buf.append(data)

    def _flush(self):
        line = " ".join("".join(self._buf).split())
        if line:
            self.blocks.append(line)
        self._buf = []

    def close(self):
        super().close()
        self._flush()


def html_to_text(html: str) -> str:
    """Published Substack HTML -> one line per block, the shape of the text archive."""
    parser = _BlockText()
    parser.feed(html or "")
    parser.close()
    return "\n".join(parser.blocks)


def html_images(html: str) -> list[dict]:
    """[{src, label, width, height}] with label = the nearest EARLIER short line (R10)."""
    parser = _BlockText()
    parser.feed(html or "")
    parser.close()
    out = []
    for img in parser.images:
        label = None
        for block in reversed(parser.blocks[: img["after_block"]]):
            if len(block) <= 60:
                label = block
                break
        out.append({"src": img["src"], "label": label, "width": img["width"], "height": img["height"]})
    return out


# ── Discord ──────────────────────────────────────────────────────────────────

def segment_discord_message(content: str) -> list[Segment]:
    if not content or not content.strip():
        return []
    return [Segment(ordinal=0, kind="message", text=content, char_start=0, char_end=len(content),
                    mentions=detect_mentions(content))]


# ── dispatch + persistence ───────────────────────────────────────────────────

def segments_for_payload(payload: dict) -> list[Segment]:
    kind = (payload or {}).get("kind")
    if kind == "transcript":
        return segment_transcript(payload.get("cues") or [], payload.get("chapters") or [])
    if kind == "sunday_scans":
        text = payload.get("text")
        if text is None and payload.get("html") is not None:
            text = html_to_text(payload["html"])
        return segment_sunday_scans(text or "")
    if kind == "discord":
        return segment_discord_message(payload.get("content") or "")
    raise ValueError(f"unknown payload kind {kind!r}")


def write_segments(conn, source_id: str, source_version: int, segments: list[Segment]) -> int:
    """INSERT OR IGNORE: re-segmenting a source version never duplicates a row."""
    written = 0
    for seg in segments:
        row = seg.to_row(source_id, source_version)
        cur = conn.execute(
            "INSERT OR IGNORE INTO wisdom_segments (segment_id, source_id, source_version, ordinal, kind, path, "
            "t_start_s, t_end_s, char_start, char_end, speaker_label, author_id, speaker_confidence, text, "
            "text_sha256, normalizer_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (row["segment_id"], source_id, int(source_version), row["ordinal"], row["kind"], row["path"],
             row["t_start_s"], row["t_end_s"], row["char_start"], row["char_end"], row["speaker_label"],
             row["author_id"], row["speaker_confidence"], row["text"], row["text_sha256"], NORMALIZER_VERSION),
        )
        written += cur.rowcount or 0
        if seg.cue_map:
            conn.execute(
                "INSERT OR IGNORE INTO wisdom_extract_segment_maps (segment_id, cue_map_json, segmenter_version) "
                "VALUES (?, ?, ?)",
                (row["segment_id"], json.dumps(seg.cue_map, separators=(",", ":")), SEGMENTER_VERSION),
            )
    return written


def cue_map_for(conn, segment_id: str) -> list:
    row = conn.execute("SELECT cue_map_json FROM wisdom_extract_segment_maps WHERE segment_id = ?",
                       (segment_id,)).fetchone()
    if not row:
        return []
    try:
        return json.loads(row[0])
    except ValueError:
        return []


def time_at(cue_map: list, local_offset: int) -> Optional[float]:
    """The start time of the cue containing `local_offset` in the segment text."""
    best = None
    for entry in cue_map or []:
        if entry[0] <= local_offset:
            best = entry[1]
        else:
            break
    return best
