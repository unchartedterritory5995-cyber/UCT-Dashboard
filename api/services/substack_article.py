"""Convert a Substack post body into UCT Intelligence article markup.

The Desk renders these posts natively (Articles -> reader) instead of linking
out, so Substack's editor chrome has to come off and our own affordances have to
go on.

WHITELIST, NEVER BLACKLIST. An unknown tag is unwrapped and an unknown attribute
is dropped, so `<script>`, `on*=` handlers and `javascript:` URLs cannot survive
by CONSTRUCTION rather than by enumeration. That matters more than it looks:
publications are admin-configurable (`POST /api/desk/publications` takes any
feed URL), so this parser runs against markup we do not control, and its output
goes into `dangerouslySetInnerHTML`.

Stdlib only -- `html.parser`, no bs4/lxml/bleach. Same call the poller beside it
already made for XML ("no feedparser dependency").

THREE THINGS SUBSTACK GETS RIGHT that a naive whitelist would destroy, and that
this converter deliberately preserves on every <img>:
  * srcset          -- 424/848/1272/1456w variants, already generated
  * width + height  -- intrinsic dimensions; dropping them reintroduces the
                       layout shift they exist to prevent, 62 times per issue
  * loading="lazy"  -- a Sunday Scans issue carries 62 images
Stripping those would make our reader measurably SLOWER than the Substack page
we are replacing. The one image attribute we rewrite is `sizes`: Substack ships
`100vw`, which is a lie inside our 760px reader column and makes a phone pull
the 1456w file.

WHAT GETS DROPPED, and the one trap in doing it: the per-image restack/expand
icon buttons (124 per issue), their inline SVG, and the subscribe form. The trap
is that `class="button primary"` is on BOTH the subscribe form's submit input
AND the whop membership anchor, so keying the drop on that class kills every
call-to-action in the post. The subscribe form is therefore identified by its
WRAPPER (`subscription-widget*` / `data-component-name="SubscribeWidgetToDOM"`),
which the whop button does not carry.
"""
from __future__ import annotations

import html as _html
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Bump when the OUTPUT of convert() changes. Stored per row so a converter
# improvement re-converts from the stored raw body with zero network traffic.
CONVERTER_VERSION = 1

# Matches the max reader measure in ArticleReader.module.css. Kept as a module
# constant rather than inlined so the two can be pinned together by a test.
READER_MAX_PX = 760
_READER_SIZES = f"(max-width: 820px) 100vw, {READER_MAX_PX}px"

# Average adult reading speed. Only ever used to render "N min read".
_WORDS_PER_MINUTE = 225

_VOID = frozenset({
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
})

_ALLOWED = frozenset({
    "p", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "small",
    "a", "ul", "ol", "li", "blockquote", "hr", "br",
    "figure", "figcaption", "img",
    "code", "pre", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
    "sup", "sub", "caption",
})

# Tag goes, children stay. Substack wraps nearly everything in layout divs --
# `<div><hr></div>` is its normal way of emitting a horizontal rule.
_UNWRAP = frozenset({
    "div", "span", "picture", "section", "article", "main", "header",
    "footer", "aside", "nav", "font", "center", "tt", "hgroup", "html", "body",
})

# Dropped WITH their subtree.
_DROP_TREE = frozenset({
    "script", "style", "noscript", "iframe", "object", "embed", "form",
    "input", "select", "option", "textarea", "button", "svg", "math",
    "video", "audio", "canvas", "template", "source", "track", "link",
    "meta", "base", "applet", "frame", "frameset",
})

# Substack furniture, dropped with its subtree wherever it appears. Substring
# match against the element's class attribute.
_DROP_CLASS_TOKENS = (
    "subscription-widget",   # the free-subscribe form (incl. -wrap-editor)
    "image-link-expand",     # the restack / view-fullscreen icon pair
    "pencraft",              # Substack's internal design-system wrappers
    "poll-embed",
    "comments-section",
    "footer-buttons",
    "post-ufi",              # like / restack / share bar
)

# Same, keyed on Substack's own component marker.
_DROP_COMPONENT_NAMES = (
    "SubscribeWidgetToDOM",
    "SubscribeWidget",
    "CommentsToDOM",
    "ShareToDOM",
    "PollToDOM",
    "LatestPostsToDOM",
    "SubscribeWithCaptionToDOM",
)

_ATTRS: dict[str, tuple[str, ...]] = {
    "a": ("href", "title"),
    "img": ("src", "srcset", "sizes", "width", "height", "alt", "loading", "decoding"),
    "td": ("colspan", "rowspan"),
    "th": ("colspan", "rowspan", "scope"),
    "ol": ("start",),
}

_SAFE_SCHEMES = frozenset({"http", "https", "mailto"})

# The label the Sunday Scans generator emits as ONE h3 with a <br>, followed by
# the week's symbols. Matching the label (not the shape of the text after it) is
# deliberate: a bare "several short all-caps words" test also matches ordinary
# headings like "WHAT WE WILL COVER TODAY".
_CHARTS_COVERED_RE = re.compile(r"charts?\s+covered", re.I)
_TICKER_RE = re.compile(r"^[A-Z][A-Z.\-]{0,5}$")

# A srcset candidate boundary: a comma followed by whitespace, or a comma
# immediately preceding the next absolute URL. See _safe_srcset.
_SRCSET_SPLIT_RE = re.compile(r",(?=\s)|,(?=https?://)")

_WS_RE = re.compile(r"\s+")
_SLUG_STRIP_RE = re.compile(r"[^a-z0-9]+")
_HEADINGS = frozenset({"h2", "h3", "h4", "h5", "h6"})


@dataclass
class ConvertedArticle:
    """Everything the reader needs, derived in one pass over the source."""
    html: str = ""
    sections: list[dict] = field(default_factory=list)
    tickers: list[str] = field(default_factory=list)
    images: int = 0
    words: int = 0
    reading_minutes: int = 0
    converter_version: int = CONVERTER_VERSION


def _slugify(text: str) -> str:
    s = _SLUG_STRIP_RE.sub("-", (text or "").strip().lower()).strip("-")
    return s[:60] or "section"


def _safe_url(raw: str | None) -> str | None:
    """Return the URL if it can't execute script, else None.

    Anchors and site-relative paths pass through. Everything else must carry an
    allow-listed scheme -- which rejects `javascript:`, `data:` and `vbscript:`
    without naming them.
    """
    u = (raw or "").strip()
    if not u:
        return None
    if u.startswith("#") or (u.startswith("/") and not u.startswith("//")):
        return u
    parts = urlsplit(u)
    scheme = (parts.scheme or "").lower()
    if scheme == "mailto" and parts.path:
        return u
    if scheme in _SAFE_SCHEMES and parts.netloc:
        return u
    return None


def _safe_srcset(raw: str | None) -> str | None:
    """Sanitize each candidate in a srcset, keeping the width descriptors.

    Split on ", " and NOT on "," -- Substack's CDN puts its transform options
    in the path (`.../$s_!IyPQ!,w_424,c_limit,f_auto,...`), so a bare comma
    split shreds every URL into fragments that still look like valid absolute
    URLs and so survive validation. The result is a well-formed srcset pointing
    at nothing, on all 62 images.
    """
    if not raw:
        return None
    out = []
    for candidate in _SRCSET_SPLIT_RE.split(raw):
        candidate = candidate.strip()
        if not candidate:
            continue
        bits = candidate.split()
        url = _safe_url(bits[0])
        if not url:
            continue
        descriptor = bits[1] if len(bits) > 1 else ""
        out.append(f"{url} {descriptor}".strip())
    return ", ".join(out) or None


def _with_utm(url: str, utm: dict[str, str] | None) -> str:
    """Tag an outbound conversion link so the native reader's contribution is
    measurable. Existing params win -- we never overwrite a hand-set campaign."""
    if not utm:
        return url
    parts = urlsplit(url)
    existing = dict(parse_qsl(parts.query, keep_blank_values=True))
    merged = {**utm, **existing}
    return urlunsplit((parts.scheme, parts.netloc, parts.path,
                       urlencode(merged), parts.fragment))


class _Converter(HTMLParser):
    """Streaming whitelist rewriter. See module docstring for the contract."""

    def __init__(self, *, utm: dict[str, str] | None, reader_sizes: str,
                 ticker_href: str) -> None:
        super().__init__(convert_charrefs=True)
        self._utm = utm
        self._sizes = reader_sizes
        self._ticker_href = ticker_href

        self._out: list[str] = []
        self._stack: list[tuple[str, str | None]] = []   # (source tag, emitted tag or None)
        self._drop_depth = 0

        # Heading buffering: an id can only be computed once the text is known,
        # so heading output is diverted until the closing tag.
        self._heading: dict | None = None

        self._seen_slugs: dict[str, int] = {}
        self.sections: list[dict] = []
        self.tickers: list[str] = []
        self.images = 0
        self._words = 0
        # Most recent short text run -- the chart label ("GLW (Daily)") that
        # precedes each figure. Used as alt text, which Substack leaves empty.
        self._last_label = ""

    # -- output plumbing -------------------------------------------------------
    def _emit(self, s: str) -> None:
        if self._heading is not None:
            self._heading["buf"].append(s)
        else:
            self._out.append(s)

    @staticmethod
    def _attr_str(pairs: list[tuple[str, str]]) -> str:
        return "".join(
            f' {k}="{_html.escape(v, quote=True)}"' for k, v in pairs if v is not None
        )

    # -- drop decisions --------------------------------------------------------
    def _is_dropped(self, tag: str, attrs: dict[str, str]) -> bool:
        if tag in _DROP_TREE:
            return True
        classes = (attrs.get("class") or "").lower()
        if classes and any(tok in classes for tok in _DROP_CLASS_TOKENS):
            return True
        component = attrs.get("data-component-name") or ""
        if component in _DROP_COMPONENT_NAMES:
            return True
        return False

    # -- tag handlers ----------------------------------------------------------
    def handle_starttag(self, tag: str, attrlist) -> None:
        tag = tag.lower()
        if self._drop_depth:
            if tag not in _VOID:
                self._drop_depth += 1
            return

        attrs = {(k or "").lower(): (v or "") for k, v in attrlist}

        if self._is_dropped(tag, attrs):
            if tag not in _VOID:
                self._drop_depth = 1
            return

        if tag == "img":
            self._emit_img(attrs)
            return

        if tag in _HEADINGS and self._heading is None:
            self._heading = {"tag": tag, "buf": [], "text": []}
            self._stack.append((tag, tag))
            return

        if tag in _ALLOWED:
            kept = self._keep_attrs(tag, attrs)
            self._emit(f"<{tag}{self._attr_str(kept)}>")
            if tag not in _VOID:
                self._stack.append((tag, tag))
            return

        # Unknown or layout-only: unwrap.
        if tag not in _VOID:
            self._stack.append((tag, None))

    def handle_startendtag(self, tag, attrlist) -> None:
        # `<img/>`: start only. The base class would also fire an end tag.
        self.handle_starttag(tag, attrlist)
        if tag.lower() not in _VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self._drop_depth:
            if tag not in _VOID:
                self._drop_depth -= 1
            return
        if tag in _VOID:
            return

        if self._heading is not None and tag == self._heading["tag"]:
            self._close_heading()
            if self._stack and self._stack[-1][0] == tag:
                self._stack.pop()
            return

        # Tolerate mis-nesting: close everything opened above the match.
        for i in range(len(self._stack) - 1, -1, -1):
            if self._stack[i][0] == tag:
                while len(self._stack) > i:
                    _src, emitted = self._stack.pop()
                    if emitted:
                        self._emit(f"</{emitted}>")
                return
        # Stray end tag with no open counterpart: ignore.

    def handle_data(self, data: str) -> None:
        if self._drop_depth or not data:
            return
        self._words += len(data.split())
        if self._heading is not None:
            self._heading["text"].append(data)
        else:
            stripped = data.strip()
            if 0 < len(stripped) <= 60:
                self._last_label = stripped
        self._emit(_html.escape(data, quote=False))

    # -- element-specific emitters --------------------------------------------
    def _keep_attrs(self, tag: str, attrs: dict[str, str]) -> list[tuple[str, str]]:
        allowed = _ATTRS.get(tag, ())
        kept: list[tuple[str, str]] = []
        for name in allowed:
            if name not in attrs:
                continue
            value = attrs[name]
            if name == "href":
                url = _safe_url(value)
                if not url:
                    continue
                if "whop.com" in url:
                    url = _with_utm(url, self._utm)
                kept.append(("href", url))
                if urlsplit(url).netloc:
                    kept.append(("target", "_blank"))
                    kept.append(("rel", "noopener noreferrer"))
                continue
            kept.append((name, value))
        return kept

    def _emit_img(self, attrs: dict[str, str]) -> None:
        src = _safe_url(attrs.get("src"))
        if not src:
            return
        self.images += 1
        pairs: list[tuple[str, str]] = [("src", src)]

        srcset = _safe_srcset(attrs.get("srcset"))
        if srcset:
            pairs.append(("srcset", srcset))
            # The whole point of the rewrite: Substack's `100vw` overfetches in
            # a 760px column.
            pairs.append(("sizes", self._sizes))

        for dim in ("width", "height"):
            value = (attrs.get(dim) or "").strip()
            if value.isdigit():
                pairs.append((dim, value))

        alt = (attrs.get("alt") or "").strip()
        if not alt and self._last_label:
            # Substack leaves alt empty on every chart; the label immediately
            # above it ("GLW (Daily)") is the only description that exists.
            alt = self._last_label
        pairs.append(("alt", alt))

        pairs.append(("loading", (attrs.get("loading") or "lazy").strip() or "lazy"))
        pairs.append(("decoding", "async"))
        pairs.append(("class", "uctArticleImage"))
        pairs.append(("data-lightbox", "1"))
        self._emit(f"<img{self._attr_str(pairs)}>")

    def _close_heading(self) -> None:
        heading = self._heading
        self._heading = None
        if heading is None:
            return

        tag = heading["tag"]
        text = _WS_RE.sub(" ", "".join(heading["text"])).strip()
        inner = "".join(heading["buf"])

        slug = _slugify(text)
        seen = self._seen_slugs.get(slug, 0)
        self._seen_slugs[slug] = seen + 1
        anchor = slug if seen == 0 else f"{slug}-{seen + 1}"

        chips = self._charts_covered_chips(text)
        if chips is not None:
            label, chip_html = chips
            self._out.append(
                f'<{tag} id="{_html.escape(anchor, quote=True)}">'
                f"<strong>{_html.escape(label, quote=False)}</strong></{tag}>"
            )
            self._out.append(chip_html)
            self.sections.append({"id": anchor, "text": label, "level": int(tag[1])})
            return

        self._out.append(f'<{tag} id="{_html.escape(anchor, quote=True)}">{inner}</{tag}>')
        if text:
            self.sections.append({"id": anchor, "text": text, "level": int(tag[1])})

    def _charts_covered_chips(self, text: str) -> tuple[str, str] | None:
        """Turn the generator's "Charts Covered <br><br> SYM SYM SYM" heading
        into tappable chips. Returns (label, html) or None if this isn't one."""
        match = _CHARTS_COVERED_RE.search(text)
        if not match:
            return None
        tail = text[match.end():].strip("  :-—")
        candidates = [t.strip() for t in tail.split() if t.strip()]
        symbols = [t for t in candidates if _TICKER_RE.match(t)]
        # Require most of the tail to look like symbols, and enough of them that
        # an ordinary sentence can't qualify.
        if len(symbols) < 4 or len(symbols) < len(candidates) * 0.8:
            return None
        seen: set[str] = set()
        ordered = [s for s in symbols if not (s in seen or seen.add(s))]
        self.tickers.extend(s for s in ordered if s not in self.tickers)
        chips = "".join(
            f'<a class="uctTickerChip" data-ticker="{_html.escape(s, quote=True)}"'
            f' href="{_html.escape(self._ticker_href.format(sym=s), quote=True)}">'
            f"{_html.escape(s, quote=False)}</a>"
            for s in ordered
        )
        label = text[:match.end()].strip()
        return label, f'<div class="uctTickerChips">{chips}</div>'

    # -- result ----------------------------------------------------------------
    def finish(self) -> None:
        self.close()
        if self._heading is not None:
            self._close_heading()
        while self._stack:
            _src, emitted = self._stack.pop()
            if emitted:
                self._out.append(f"</{emitted}>")

    @property
    def html(self) -> str:
        return "".join(self._out)

    @property
    def words(self) -> int:
        return self._words


def convert(raw_html: str, *, utm: dict[str, str] | None = None,
            reader_sizes: str = _READER_SIZES,
            ticker_href: str = "/research/{sym}") -> ConvertedArticle:
    """Substack post body -> UCT article markup + the metadata derived with it.

    Safe to call on untrusted input: the parser whitelists tags and attributes,
    so anything unrecognised is unwrapped or dropped rather than passed through.
    """
    if not raw_html or not raw_html.strip():
        return ConvertedArticle()

    parser = _Converter(utm=utm, reader_sizes=reader_sizes, ticker_href=ticker_href)
    parser.feed(raw_html)
    parser.finish()

    words = parser.words
    return ConvertedArticle(
        html=parser.html,
        sections=parser.sections,
        tickers=parser.tickers,
        images=parser.images,
        words=words,
        reading_minutes=max(1, round(words / _WORDS_PER_MINUTE)) if words else 0,
        converter_version=CONVERTER_VERSION,
    )
