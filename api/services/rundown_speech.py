"""
Server-side extraction of the Morning Wire briefing as listenable text.

This is the single source of truth for what Read Aloud speaks: it pulls the
human-written briefing (the `.rd-sections` container — Today's Focus + the
narrative paragraphs) out of the rundown HTML and skips the data-dashboard
widgets, which read as gibberish. The frontend fetches this so the text it
sends to TTS is identical to what the pre-warm job synthesizes — guaranteeing
the pre-warmed audio is a cache hit (instant + no usage charge).

Stdlib only (html.parser) — no BeautifulSoup dependency on Railway.
"""

import re
from html.parser import HTMLParser

_BLOCK = {
    "div", "p", "li", "ul", "ol", "section", "article", "header", "footer",
    "h1", "h2", "h3", "h4", "h5", "h6", "table", "tr", "br", "hr", "blockquote",
}
_VOID = {
    "br", "hr", "img", "input", "meta", "link", "area", "base", "col",
    "embed", "source", "track", "wbr",
}


class _Extractor(HTMLParser):
    def __init__(self, target_class):
        super().__init__(convert_charrefs=True)
        self.target_class = target_class
        self.capture_all = target_class is None
        self.depth = 0
        self.capture_start = None  # depth at which the target opened
        self.parts = []
        self.found = False

    @property
    def _capturing(self):
        return self.capture_all or self.capture_start is not None

    def handle_starttag(self, tag, attrs):
        if tag in _VOID:
            if self._capturing and tag in _BLOCK:
                self.parts.append("\n")
            return
        self.depth += 1
        if self.capture_start is None and not self.capture_all and tag == "div":
            classes = (dict(attrs).get("class") or "").split()
            if self.target_class in classes:
                self.capture_start = self.depth
                self.found = True
        if self._capturing and tag in _BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in _VOID:
            return
        if self._capturing and tag in _BLOCK:
            self.parts.append("\n")
        self.depth -= 1
        if self.capture_start is not None and self.depth < self.capture_start:
            self.capture_start = None

    def handle_data(self, data):
        if self._capturing:
            self.parts.append(data)


def _clean(parts) -> str:
    raw = "".join(parts)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in raw.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def extract_rundown_speech_text(html: str) -> str:
    """Return the briefing text (Today's Focus + narrative) from rundown HTML.

    Reads `.rd-sections`; falls back to block-aware text of the whole fragment
    if that container is absent (older/other rundown shapes)."""
    if not html:
        return ""
    p = _Extractor("rd-sections")
    p.feed(html)
    if p.found and _clean(p.parts).strip():
        return _clean(p.parts)
    fb = _Extractor(None)
    fb.feed(html)
    return _clean(fb.parts)


_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


def split_sentences(text: str) -> list[str]:
    """Split into sentence-ish units for follow-along highlight timing."""
    if not text:
        return []
    return [s.strip() for s in _SENT_SPLIT.split(text) if s.strip()]
