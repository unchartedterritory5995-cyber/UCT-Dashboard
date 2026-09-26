"""Notebook export formats beside Markdown: a web page (HTML), lossless JSON and Word (.docx).

Wave 8, lane 8C, item C4 (rulings D-C2, D-C3, D-C4, D-C5, D-C8). Everything here is called
from `notes_export.py`'s archive seam (`_write_notes_archive(..., fmt=)`) and from its two
builders; nothing here reads the database.

⛔⛔ ONE MARKDOWN WRITER, NEVER TWO (the rule `POST /api/j2/notes/batch/export` states in
`api/routers/journal_two.py`). The HTML format is `notes_export.tiptap_to_markdown` rendered
by `markdown-it-py` (already a dependency) -- so a node the Markdown writer keeps, the web
page keeps, and a fix to the writer reaches both. What the renderer adds is only what the
writer's syntax already says: `$...$` becomes TeX in `<code class="math">`, `==...==` becomes
`<mark>`, and the inside of a callout or toggle island is rendered as the Markdown it is.

⛔⛔ THE SANITIZER IS AN ALLOWLIST, ON THE STDLIB PARSER. The writer passes member text
through raw (a member who typed `<b>` gets bold in every Markdown reader), and the renderer
runs with `html=True` so the writer's own islands (`<aside>`, `<details>`) survive. So the
rendered HTML is untrusted until `sanitize_html` has read it: an explicit tag and attribute
allowlist; `href`/`src` limited to http, https, mailto (links only) and relative paths (the
bundled attachments, the sibling notes, `#` anchors); every `on*` attribute, every
`javascript:` and every `data:` dropped. A tag outside the list is not deleted with its
words: it is written back as the literal text the member typed. And every text run and
attribute value is written so that `javascript:` and `on<name>=` cannot appear in the file
at all, not even as inert text (`_inert`).

⛔⛔ JSON IS THE LOSSLESS FORMAT (D-C3). `bodyJson` is the stored document VERBATIM, except
that an attachment's in-app address becomes its path inside the archive, so the file works
without an account. `lib/importer/adapters/uct.js` reads it back, and the round trip is the
proof (`lib/importer/exportFormats.roundtrip.test.js`).

⛔⛔ WORD IS STDLIB (D-C4): `zipfile` plus hand-written WordprocessingML -- no dependency. A
node Word can hold is written as Word writes it; every other node becomes the plain text of
its descendants. It never raises on a node it does not know: an export runs over content
written by every editor version a member has ever used. Its images are this note's own
attachments, embedded, and they count against the same byte cap as every other export.

The per-node table of what each format keeps is `docs/notebook/export-formats.md`, generated
from the rails' results.
"""
from __future__ import annotations

import copy
import html as _html
import json
import re
import zipfile
from html.parser import HTMLParser
from io import BytesIO
from typing import Any, Callable

from api.services.journal_two import notes_export as _nx

# ── The formats ──────────────────────────────────────────────────────────────

FORMATS = ("md", "html", "json", "docx")
FORMAT_EXTENSION = {"md": ".md", "html": ".html", "json": ".json", "docx": ".docx"}
DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FORMAT_MEDIA_TYPE = {
    "md": "text/markdown",
    "html": "text/html; charset=utf-8",
    "json": "application/json",
    "docx": DOCX_MEDIA_TYPE,
}
#: The one sentence an unknown `format=` gets (a 422), shown to the member as it stands.
UNKNOWN_FORMAT_SENTENCE = (
    "That export format isn't available. Choose Markdown, Web page (HTML), JSON or Word.")

JSON_FORMAT_NAME = "uct-notebook-note"
JSON_FORMAT_VERSION = 1


def normalize_format(raw: Any) -> str | None:
    """`md|html|json|docx` (case and surrounding space ignored), absent means Markdown, and
    anything else is None -- the caller answers 422, never a guess."""
    if raw is None:
        return "md"
    value = str(raw).strip().lower()
    if value == "":
        return "md"
    return value if value in FORMATS else None


# ── HTML: the one Markdown writer, rendered ──────────────────────────────────

def _math_renderer(content: str, opts: dict[str, Any]) -> str:
    """D-C2: math stays TeX, in `<code class="math">` (a display equation inside a `<pre>`)."""
    code = f'<code class="math">{_html.escape(content, quote=False)}</code>'
    return f"<pre>{code}</pre>\n" if opts.get("display_mode") else code


def _mark_rule(state, silent: bool) -> bool:
    """`==text==` -> `<mark>text</mark>`: the writer's highlight syntax (Obsidian's). The same
    shape the editor's own input rule accepts -- no space just inside either `==`, no line
    break, no `=` inside -- so `a == b == c` is never a highlight."""
    src, start = state.src, state.pos
    if not src.startswith("==", start) or start + 2 >= state.posMax:
        return False
    end = src.find("==", start + 2, state.posMax)
    if end < 0:
        return False
    inner = src[start + 2:end]
    if not inner or inner[0].isspace() or inner[-1].isspace() or "\n" in inner or "=" in inner:
        return False
    if not silent:
        state.push("mark_open", "mark", 1)
        old_max = state.posMax
        state.pos, state.posMax = start + 2, end
        state.md.inline.tokenize(state)
        state.posMax = old_max
        state.push("mark_close", "mark", -1)
    state.pos = end + 2
    return True


_MD_BODY = None
_MD_ISLAND = None


def _heading_ids(state) -> None:
    """Every heading gets the anchor the writer's table of contents links to
    (`notes_export._heading_slug`, GitHub-style, repeats numbered) -- so a TOC entry in the
    web page jumps to its heading. The text is the heading's own words (text and code), the
    same words `notes_export._toc_headings` reads from the stored document."""
    used: dict[str, int] = {}
    tokens = state.tokens
    for i, tok in enumerate(tokens):
        if tok.type != "heading_open" or i + 1 >= len(tokens):
            continue
        inline = tokens[i + 1]
        words = "".join(c.content for c in (inline.children or []) if c.type in ("text", "code_inline"))
        tok.attrSet("id", _nx._heading_slug(" ".join(words.split()), used))


def _markdown_it(*, math: bool):
    """The server's GFM-like markdown-it-py (the configuration `note_connectors/convert/
    mddoc.py` already reads Markdown with -- CommonMark, GFM tables, task lists) with raw
    HTML on, so the writer's own islands pass through to the sanitizer."""
    from markdown_it import MarkdownIt
    from mdit_py_plugins.tasklists import tasklists_plugin

    md = MarkdownIt("commonmark", {"html": True, "breaks": not math}).enable(["table", "strikethrough"])
    md.use(tasklists_plugin, enabled=False)
    md.inline.ruler.before("emphasis", "uct_mark", _mark_rule)
    md.core.ruler.push("uct_heading_ids", _heading_ids)
    if math:
        from mdit_py_plugins.dollarmath import dollarmath_plugin
        md.use(dollarmath_plugin, allow_labels=False, allow_space=False, allow_digits=False,
               double_inline=False, renderer=_math_renderer)
    return md


def _body_md():
    global _MD_BODY
    if _MD_BODY is None:
        _MD_BODY = _markdown_it(math=True)
    return _MD_BODY


def _island_md():
    """For the inside of a callout or toggle. The writer keeps `$` RAW inside an island (it
    is an HTML block to a Markdown reader, never parsed for math), so this renderer has no
    math rule -- `$5-$10` inside a callout is never read as a formula. Line breaks are kept
    as `<br>`: the writer joins an island's blocks with ONE newline (a blank line would end
    the HTML block), so a newline there is the only boundary left between two paragraphs."""
    global _MD_ISLAND
    if _MD_ISLAND is None:
        _MD_ISLAND = _markdown_it(math=False)
    return _MD_ISLAND


_ASIDE_ISLAND = re.compile(r'\A(<aside(?: data-variant="[a-z]+")?>)\n(.*)\n(</aside>)\s*\Z', re.S)
_DETAILS_ISLAND = re.compile(r"\A<details>\n<summary>(.*?)</summary>\n(.*)\n</details>\s*\Z", re.S)


def _island_inner(text: str) -> str:
    """The island's inner Markdown, rendered. A line that is exactly `<br>` is where the
    writer had to hide a blank line from the HTML block (`notes_export._html_island`); it is
    a blank line again here, so a code block or a paragraph break inside a callout reads as
    the member wrote it."""
    lines = ["" if ln == "<br>" else ln for ln in text.split("\n")]
    return _island_md().render("\n".join(lines))


def _render_islands(tokens) -> None:
    for tok in tokens:
        if tok.type != "html_block":
            continue
        m = _ASIDE_ISLAND.match(tok.content)
        if m:
            tok.content = f"{m.group(1)}\n{_island_inner(m.group(2))}{m.group(3)}\n"
            continue
        m = _DETAILS_ISLAND.match(tok.content)
        if m:
            summary = _island_md().renderInline(m.group(1))
            tok.content = f"<details>\n<summary>{summary}</summary>\n{_island_inner(m.group(2))}</details>\n"


def markdown_to_html(markdown: str) -> str:
    """The writer's Markdown as a SANITIZED HTML fragment (never trusted before sanitizing)."""
    md = _body_md()
    env: dict[str, Any] = {}
    tokens = md.parse(markdown or "", env)
    _render_islands(tokens)
    return sanitize_html(md.renderer.render(tokens, md.options, env))


# ── The sanitizer ────────────────────────────────────────────────────────────

_ALLOWED: dict[str, frozenset[str]] = {
    "a": frozenset({"href", "title"}),
    "aside": frozenset({"data-variant"}),
    "b": frozenset(), "blockquote": frozenset(), "br": frozenset(),
    "code": frozenset({"class"}), "del": frozenset(),
    "details": frozenset({"open"}), "em": frozenset(),
    "h1": frozenset({"id"}), "h2": frozenset({"id"}), "h3": frozenset({"id"}),
    "h4": frozenset({"id"}), "h5": frozenset({"id"}), "h6": frozenset({"id"}),
    "hr": frozenset(), "i": frozenset(),
    "img": frozenset({"src", "alt", "title", "width", "height"}),
    "input": frozenset({"type", "checked", "disabled"}),
    "li": frozenset({"class"}), "mark": frozenset(),
    "ol": frozenset({"start"}), "p": frozenset(),
    "pre": frozenset(), "s": frozenset(), "strong": frozenset(),
    "sub": frozenset(), "sup": frozenset(), "summary": frozenset(),
    "table": frozenset(), "tbody": frozenset(),
    "td": frozenset({"style", "colspan", "rowspan"}), "th": frozenset({"style", "colspan", "rowspan"}),
    "thead": frozenset(), "tr": frozenset(), "u": frozenset(),
    "ul": frozenset({"class"}),
}
_VOID = frozenset({"br", "hr", "img", "input"})
#: Wrappers the renderer itself emits around math: dropped, their contents kept.
_UNWRAP = frozenset({"div", "span"})
_CLASS_TOKEN = re.compile(r"^(?:task-list-item|contains-task-list|task-list-item-checkbox|math"
                          r"|language-[A-Za-z0-9_+#.\-]{1,40})$")
_ALIGN = re.compile(r"^\s*text-align\s*:\s*(left|center|right)\s*;?\s*$", re.I)
_DIGITS = re.compile(r"^\d{1,4}$")
_ANCHOR_ID = re.compile(r"^[\w\-]{1,200}$", re.UNICODE)
_SCHEME = re.compile(r"^([a-z][a-z0-9+.\-]*):")


def safe_url(value: str | None, *, image: bool = False) -> str | None:
    """A URL an exported page may carry, or None.

    http and https always; mailto for a link, never an image; and a RELATIVE path -- the
    bundled attachment, a sibling note, an `#anchor`. Everything else (javascript:, data:,
    vbscript:, file:, an in-app address the file cannot reach, `uct-note:`) is dropped. The
    scheme is read the way a browser reads it: control characters and spaces inside it do
    not hide it."""
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    compact = re.sub(r"[\x00-\x20\x7f]", "", v).lower()
    m = _SCHEME.match(compact)
    if m:
        scheme = m.group(1)
        if scheme in ("http", "https"):
            return v
        if scheme == "mailto" and not image:
            return v
        return None
    if compact.startswith(("//", "/", "\\")):
        return None   # another host, or an address on OUR server the file cannot reach
    return v


def _inert(text: str) -> str:
    """Text or an attribute value, escaped, and written so that neither `javascript:` nor
    `on<name>=` appears in the file even as inert characters (a reader that searches the
    file for them -- a mail filter, a naive scanner -- finds nothing). The browser shows
    the same characters: `&#58;` is `:` and `&#61;` is `=`."""
    out = _html.escape(text, quote=True)
    out = re.sub(r"(?i)(script)(:)", r"\1&#58;", out)
    return re.sub(r"(?i)\b(on[a-z]+)(=)", r"\1&#61;", out)


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.open: list[str] = []
        self.literal_depth = 0   # inside an escaped (not allowed) tag's raw text

    # A tag outside the list: its words stay, as the literal text the member typed.
    def _literal(self, text: str) -> None:
        self.out.append(_inert(text))

    def _attrs(self, tag: str, attrs: list[tuple[str, str | None]]) -> str | None:
        allowed = _ALLOWED[tag]
        kept: list[tuple[str, str | None]] = []
        for name, value in attrs:
            name = (name or "").lower()
            if name not in allowed:
                continue   # every on*, style (outside th/td), id, data-* not listed ...
            value = "" if value is None else value
            if name in ("href", "src"):
                safe = safe_url(value, image=(name == "src"))
                if safe is None:
                    continue
                kept.append((name, safe))
            elif name == "class":
                tokens = [t for t in value.split() if _CLASS_TOKEN.match(t)]
                if tokens:
                    kept.append((name, " ".join(tokens)))
            elif name == "style":
                m = _ALIGN.match(value)
                if m:
                    kept.append((name, f"text-align:{m.group(1).lower()}"))
            elif name in ("colspan", "rowspan", "start", "width", "height"):
                if _DIGITS.match(value.strip()):
                    kept.append((name, value.strip()))
            elif name == "data-variant":
                if value in _nx._CALLOUT_VARIANTS:
                    kept.append((name, value))
            elif name == "id":
                if _ANCHOR_ID.match(value):
                    kept.append((name, value))
            elif name in ("checked", "disabled", "open"):
                kept.append((name, None))
            elif name == "type":
                kept.append((name, value.lower()))
            else:
                kept.append((name, value))
        if tag == "input":
            if ("type", "checkbox") not in kept:
                return None   # only a task checkbox is an input an export shows
            if not any(n == "disabled" for n, _ in kept):
                kept.append(("disabled", None))
        if tag == "a" and any(n == "href" and _SCHEME.match(v.lower()) for n, v in kept if v):
            kept.append(("rel", "noopener noreferrer"))
        return "".join(f" {n}" if v is None else f' {n}="{_inert(v)}"' for n, v in kept)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in _UNWRAP:
            return
        if tag not in _ALLOWED:
            self._literal(self.get_starttag_text() or f"<{tag}>")
            return
        rendered = self._attrs(tag, attrs)
        if rendered is None:
            return
        self.out.append(f"<{tag}{rendered}>")
        if tag not in _VOID:
            self.open.append(tag)

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if tag in _UNWRAP:
            return
        if tag not in _ALLOWED:
            self._literal(self.get_starttag_text() or f"<{tag}/>")
            return
        rendered = self._attrs(tag, attrs)
        if rendered is None:
            return
        self.out.append(f"<{tag}{rendered}>")
        if tag not in _VOID:
            self.out.append(f"</{tag}>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in _UNWRAP or tag in _VOID:
            return
        if tag not in _ALLOWED:
            self._literal(f"</{tag}>")
            return
        if tag not in self.open:
            return   # a stray close tag closes nothing
        while self.open:
            top = self.open.pop()
            self.out.append(f"</{top}>")
            if top == tag:
                break

    def handle_data(self, data):
        self.out.append(_inert(data))

    # Comments, declarations and processing instructions are never member text: dropped.
    def handle_comment(self, data):
        pass

    def handle_decl(self, decl):
        pass

    def handle_pi(self, data):
        pass

    def unknown_decl(self, data):
        pass

    def result(self) -> str:
        self.close()
        while self.open:
            self.out.append(f"</{self.open.pop()}>")
        return "".join(self.out)


def sanitize_html(fragment: str) -> str:
    """An HTML fragment reduced to the allowlist (module docstring). Never raises."""
    s = _Sanitizer()
    try:
        s.feed(fragment or "")
    except Exception:  # noqa: BLE001 -- a parser surprise costs the fragment, never the export
        return _inert(fragment or "")
    return s.result()


_PAGE_CSS = """
:root { color-scheme: light dark; --fg: #1b1d22; --muted: #5f6570; --bg: #ffffff;
  --rule: #d9dce1; --soft: #f4f5f7; --accent: #8a6a1f; }
@media (prefers-color-scheme: dark) { :root { --fg: #e8e9ec; --muted: #a3a8b3; --bg: #121417;
  --rule: #2c3038; --soft: #1b1e23; --accent: #d8b25a; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.uct-note { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
.uct-note-header { border-bottom: 1px solid var(--rule); margin-bottom: 1.5rem; padding-bottom: 1rem; }
.uct-note-header h1 { margin: 0 0 .25rem; font-size: 2rem; line-height: 1.2; }
.uct-note-subtitle { margin: 0 0 .5rem; color: var(--muted); font-size: 1.15rem; }
.uct-note-meta, .uct-note-properties { margin: .25rem 0 0; color: var(--muted); font-size: .9rem; }
.uct-note-properties dt { font-weight: 600; float: left; clear: left; margin-right: .5rem; }
.uct-note-properties dd { margin: 0; }
.uct-note-hero { max-width: 100%; border-radius: 6px; margin-top: 1rem; }
img { max-width: 100%; height: auto; }
a { color: var(--accent); }
pre { background: var(--soft); padding: .75rem 1rem; border-radius: 6px; overflow-x: auto; }
code { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: .92em; }
code.math { color: var(--accent); }
blockquote { margin: 1rem 0; padding: .25rem 1rem; border-left: 3px solid var(--rule); color: var(--muted); }
aside { margin: 1rem 0; padding: .75rem 1rem; border-radius: 6px; background: var(--soft);
  border-left: 3px solid var(--accent); }
details { margin: 1rem 0; } summary { cursor: pointer; font-weight: 600; }
table { border-collapse: collapse; margin: 1rem 0; } th, td { border: 1px solid var(--rule); padding: .35rem .6rem; }
th { background: var(--soft); }
ul.contains-task-list { list-style: none; padding-left: 1.25rem; }
mark { background: #f5e08a; color: #1b1d22; padding: 0 .1em; }
hr { border: 0; border-top: 1px solid var(--rule); margin: 2rem 0; }
""".strip()


def html_document(*, title: str, body_html: str, subtitle: str | None = None,
                  tags: list[str] | None = None, ticker: str | None = None,
                  properties: list[dict[str, str]] | None = None, hero_src: str | None = None,
                  updated_at: str | None = None) -> str:
    """A standalone page: `<!doctype html>`, a language, a charset, a title and the styles
    inline, so the file opens the same with no network and no account. Every field here is
    escaped; `body_html` has already been sanitized."""
    head_title = _inert(title or "Untitled")
    parts = [f"<h1>{head_title}</h1>"]
    if subtitle:
        parts.append(f'<p class="uct-note-subtitle">{_inert(subtitle)}</p>')
    meta = []
    if ticker:
        meta.append(_inert(ticker))
    if tags:
        meta.append(" · ".join(_inert(str(t)) for t in tags))
    if updated_at:
        meta.append(f"Updated {_inert(str(updated_at)[:10])}")
    if meta:
        parts.append(f'<p class="uct-note-meta">{" · ".join(meta)}</p>')
    if properties:
        rows = "".join(f"<dt>{_inert(p['name'])}</dt><dd>{_inert(p['value'])}</dd>" for p in properties)
        parts.append(f'<dl class="uct-note-properties">{rows}</dl>')
    safe_hero = safe_url(hero_src, image=True) if hero_src else None
    if safe_hero:
        parts.append(f'<img class="uct-note-hero" src="{_inert(safe_hero)}" alt="">')
    header = "\n".join(parts)
    return (
        "<!doctype html>\n"
        '<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="generator" content="UCT Notebook export">\n'
        f"<title>{head_title}</title>\n<style>\n{_PAGE_CSS}\n</style>\n</head>\n<body>\n"
        '<article class="uct-note">\n'
        f'<header class="uct-note-header">\n{header}\n</header>\n'
        f'<div class="uct-note-body">\n{body_html}\n</div>\n'
        "</article>\n</body>\n</html>\n"
    )


def note_html(doc: Any, *, resolver: Callable | None, **meta: Any) -> str:
    """ONE note as a standalone page: the one Markdown writer, rendered, sanitized, wrapped."""
    markdown = _nx.tiptap_to_markdown(doc, attachment_resolver=resolver)
    return html_document(body_html=markdown_to_html(markdown), **meta)


# ── JSON: the stored document, verbatim ──────────────────────────────────────

#: The attributes that hold an attachment's in-app address, by node type. Only these are
#: rewritten -- every other byte of the body is the stored document.
_ATTACHMENT_ATTRS = {"image": ("src",), "resizableImage": ("src",), "attachmentChip": ("href",)}


def rewrite_attachment_urls(body: Any, resolver: Callable[[str], str | None] | None) -> Any:
    """A deep copy of `body` with each attachment address our resolver could bundle replaced
    by its path inside the archive (and a widget's archived image, `attrs.fallback.url`).
    Anything the resolver declines -- an external image, a missing file -- is left exactly as
    stored. Never raises; a non-dict node is copied as it is."""
    out = copy.deepcopy(body)
    if resolver is None:
        return out
    stack = [out]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        attrs = node.get("attrs")
        if isinstance(attrs, dict):
            for key in _ATTACHMENT_ATTRS.get(node.get("type"), ()):
                url = attrs.get(key)
                if isinstance(url, str) and url:
                    local = resolver(url)
                    if local:
                        attrs[key] = local
            if node.get("type") == "widgetEmbed":
                fb = attrs.get("fallback")
                if isinstance(fb, dict) and isinstance(fb.get("url"), str) and fb["url"]:
                    local = resolver(fb["url"])
                    if local:
                        fb["url"] = local
        content = node.get("content")
        if isinstance(content, list):
            stack.extend(content)
    return out


def _json_extras(extra: dict[str, Any], row: Any) -> dict[str, Any]:
    """What the Markdown front matter carries beyond the named fields, from the SAME resolved
    data (`notes_export._resolve_note_related_data` and its siblings) -- never re-derived."""
    keys = row.keys() if hasattr(row, "keys") else []
    out: dict[str, Any] = {}
    if extra.get("favorite"):
        out["favorite"] = True
    for src, dst in (("related_tickers", "relatedTickers"), ("linked_trades", "linkedTrades"),
                     ("financial_facts", "financialFacts"), ("thesis_evidence", "thesisEvidence"),
                     ("thesis_reviews", "thesisReviews")):
        if extra.get(src):
            out[dst] = extra[src]
    if "import_source" in keys and row["import_source"]:
        out["importSource"] = row["import_source"]
        if "imported_at" in keys and row["imported_at"]:
            out["importedAt"] = row["imported_at"]
    return out


def note_json(row: Any, *, body_json: Any, folder_names: list[str], properties: list[dict[str, str]],
              hero: str | None, extra: dict[str, Any]) -> dict[str, Any]:
    """The D-C3 document: `{format, version, note: {...}}`. `schemaLevel` is the newest schema
    the stored body needs (`notebook_schema.required_schema`), so an importer can tell a
    document it cannot read before it reads it."""
    from api.services.journal_two.notebook_schema import required_schema

    try:
        tags = json.loads(row["tags"] or "[]")
    except (TypeError, ValueError):
        tags = []
    return {
        "format": JSON_FORMAT_NAME,
        "version": JSON_FORMAT_VERSION,
        "note": {
            "id": row["id"],
            "title": row["title"] or "Untitled",
            "subtitle": row["subtitle"] or None,
            "folderPath": list(folder_names),
            "tags": tags if isinstance(tags, list) else [],
            "ticker": row["ticker"] or None,
            "properties": [{"name": p["name"], "type": p.get("type"), "value": p["value"]} for p in properties],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            # Rewriting an attachment address changes no node type, so the rewritten body
            # needs exactly the schema the stored one does.
            "schemaLevel": required_schema(body_json),
            "heroImage": hero,
            "bodyJson": body_json,
            **({"extras": ex} if (ex := _json_extras(extra, row)) else {}),
        },
    }


def json_text(document: dict[str, Any]) -> str:
    return json.dumps(document, ensure_ascii=False, indent=2) + "\n"


# ── Word: stdlib zipfile + hand-written WordprocessingML ─────────────────────

_NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
)
_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_R_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_EMU_PER_PX = 9525
_MAX_IMAGE_EMU = 6 * 914400          # six inches: the text width of a Letter page
_CONVERT_PIXEL_BUDGET = 40_000_000   # a WebP converted to PNG decodes; bounded
_INVALID_XML = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")
_CHECK = {True: "☑ ", False: "☐ "}   # content, not UI: the task's state as text


def _x(text: Any) -> str:
    """Text for an XML text node or attribute: escaped, with characters XML cannot hold
    removed (a pasted control character must not make the whole document unreadable)."""
    return _html.escape(_INVALID_XML.sub("", "" if text is None else str(text)), quote=True)


def _run(text: str, props: str = "") -> str:
    """One run; a newline is a `w:br`, a tab a `w:tab` -- the reader's own vocabulary."""
    rpr = f"<w:rPr>{props}</w:rPr>" if props else ""
    pieces = []
    for i, line in enumerate(str(text).split("\n")):
        if i:
            pieces.append("<w:br/>")
        for j, part in enumerate(line.split("\t")):
            if j:
                pieces.append("<w:tab/>")
            if part:
                pieces.append(f'<w:t xml:space="preserve">{_x(part)}</w:t>')
    if not pieces:
        return ""
    return f"<w:r>{rpr}{''.join(pieces)}</w:r>"


_MARK_PROPS = {
    "bold": "<w:b/>", "italic": "<w:i/>", "underline": '<w:u w:val="single"/>',
    "strike": "<w:strike/>", "code": '<w:rStyle w:val="CodeChar"/>',
    "highlight": '<w:highlight w:val="yellow"/>',
}


_HYPERLINK_STYLE = '<w:rStyle w:val="Hyperlink"/>'


def _props_for(marks: Any, *, link: bool = False) -> str:
    """Run properties in the order the schema requires (ONE rStyle first, then b, i, strike,
    u, highlight) -- a run with its properties out of order is a document Word repairs. A
    linked run takes the Hyperlink style unless it is code (a run has one style)."""
    names = {m.get("type") for m in (marks or []) if isinstance(m, dict)}
    style = _MARK_PROPS["code"] if "code" in names else (_HYPERLINK_STYLE if link else "")
    order = ("bold", "italic", "strike", "underline", "highlight")
    return style + "".join(_MARK_PROPS[n] for n in order if n in names)


def _link_of(marks: Any) -> str | None:
    for m in marks or []:
        if isinstance(m, dict) and m.get("type") == "link":
            href = (m.get("attrs") or {}).get("href") if isinstance(m.get("attrs"), dict) else None
            return href if isinstance(href, str) else None
    return None


class _Docx:
    """One note's Word document, built as it is walked."""

    def __init__(self, *, load_image: Callable[[str], tuple[bytes, str] | None] | None,
                 resolver: Callable | None, bundle_file: Callable[[str], str | None] | None = None) -> None:
        self.load_image = load_image
        self.resolver = resolver
        self.bundle_file = bundle_file
        self.unbundled_files: list[str] = []
        self.rels: list[tuple[str, str, str, bool]] = []   # (id, type, target, external)
        self.media: list[tuple[str, bytes]] = []
        self.ordered_nums: list[int] = []                  # start value per ordered-list instance
        self.pic_id = 0
        self.image_cache: dict[str, tuple[str, int, int] | None] = {}
        self.issues: list[str] = []
        self._link_ids: dict[str, str] = {}

    # ── relationships ──
    def _rel(self, rtype: str, target: str, external: bool = False) -> str:
        rid = f"rId{len(self.rels) + 3}"   # rId1 styles, rId2 numbering
        self.rels.append((rid, rtype, target, external))
        return rid

    def hyperlink_id(self, href: str) -> str | None:
        """A hyperlink relationship for an http(s) address only. Anything else -- mailto, a
        relative path, javascript: -- is not a link in the Word file: its text stays, plain."""
        safe = safe_url(href)
        if safe is None or not re.match(r"(?i)^https?:", safe.strip()):
            return None
        if safe not in self._link_ids:
            self._link_ids[safe] = self._rel(f"{_R_TYPE}/hyperlink", safe, external=True)
        return self._link_ids[safe]

    # ── images ──
    def image(self, url: str | None) -> tuple[str, int, int] | None:
        """(relationship id, cx, cy) for one of this note's attachments, embedded once."""
        if not url or self.load_image is None:
            return None
        if url in self.image_cache:
            return self.image_cache[url]
        got = None
        try:
            loaded = self.load_image(url)
        except Exception:  # noqa: BLE001 -- an image costs itself, never the document
            loaded = None
        if loaded:
            data, _name = loaded
            prepared = _prepare_image(data)
            if prepared:
                ext, blob, w, h = prepared
                name = f"image{len(self.media) + 1}.{ext}"
                self.media.append((name, blob))
                rid = self._rel(f"{_R_TYPE}/image", f"media/{name}")
                cx, cy = w * _EMU_PER_PX, h * _EMU_PER_PX
                if cx > _MAX_IMAGE_EMU:
                    cy = int(cy * _MAX_IMAGE_EMU / cx)
                    cx = _MAX_IMAGE_EMU
                got = (rid, max(cx, 1), max(cy, 1))
        self.image_cache[url] = got
        return got

    def drawing(self, img: tuple[str, int, int], alt: str) -> str:
        rid, cx, cy = img
        self.pic_id += 1
        n = self.pic_id
        return (
            '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
            f'<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{n}" name="Picture {n}" descr="{_x(alt)}"/>'
            '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:pic><pic:nvPicPr><pic:cNvPr id="{n}" name="Picture {n}"/><pic:cNvPicPr/></pic:nvPicPr>'
            f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
            "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
        )

    def ordered_list_num(self, start: int) -> int:
        self.ordered_nums.append(max(1, start))
        return 2 + len(self.ordered_nums)   # numId 1 = bullets, 2 = unused, 3.. ordered


def _prepare_image(data: bytes) -> tuple[str, bytes, int, int] | None:
    """(extension, bytes, width px, height px) from the image HEADER; a format Word does not
    read everywhere (WebP) is converted to PNG within a pixel budget. None when the bytes are
    not an image at all."""
    try:
        from PIL import Image
        with Image.open(BytesIO(data)) as im:
            fmt, (w, h) = im.format, im.size
            ext = {"PNG": "png", "JPEG": "jpeg", "GIF": "gif", "BMP": "bmp"}.get(fmt or "")
            if ext:
                return ext, data, w, h
            if w * h > _CONVERT_PIXEL_BUDGET:
                return None
            buf = BytesIO()
            im.convert("RGBA").save(buf, "PNG")
            return "png", buf.getvalue(), w, h
    except Exception:  # noqa: BLE001 -- not an image, or one Pillow cannot read
        return None


def _text_of(node: Any) -> str:
    """The plain text of a node's descendants -- the fallback for every node Word cannot
    hold (D-C4)."""
    parts: list[str] = []
    stack = [node]
    while stack:
        n = stack.pop()
        if isinstance(n, list):
            stack.extend(reversed(n))
            continue
        if not isinstance(n, dict):
            continue
        if n.get("type") == "text" and isinstance(n.get("text"), str):
            parts.append(n["text"])
        elif n.get("type") == "hardBreak":
            parts.append("\n")
        content = n.get("content")
        if isinstance(content, list):
            stack.extend(reversed(content))
    return "".join(parts)


class _Walker:
    """Walks a TipTap document into WordprocessingML body XML."""

    def __init__(self, dx: _Docx) -> None:
        self.dx = dx

    # ── inline ──
    def inline(self, nodes: Any, extra_props: str = "") -> str:
        out: list[str] = []
        for n in nodes or []:
            if not isinstance(n, dict):
                continue
            out.append(self.inline_node(n, extra_props))
        return "".join(out)

    def inline_node(self, n: dict[str, Any], extra_props: str = "") -> str:
        t = n.get("type")
        attrs = n.get("attrs") if isinstance(n.get("attrs"), dict) else {}
        if t == "text":
            text = n.get("text") if isinstance(n.get("text"), str) else ""
            href = _link_of(n.get("marks"))
            rid = self.dx.hyperlink_id(href) if href else None
            if rid:
                run = _run(text, _props_for(n.get("marks"), link=True) + extra_props)
                return f'<w:hyperlink r:id="{rid}">{run}</w:hyperlink>'
            return _run(text, _props_for(n.get("marks")) + extra_props)
        if t == "hardBreak":
            return "<w:r><w:br/></w:r>"
        if t == "inlineMath":
            latex = attrs.get("latex") if isinstance(attrs.get("latex"), str) else ""
            return _run(latex.strip(), '<w:rStyle w:val="CodeChar"/>' + extra_props) if latex.strip() else ""
        if t == "noteLink":
            return _run(self.note_link_title(attrs.get("noteId")), extra_props)
        if t == "askCitation":
            num = _nx._ask_citation_n(n.get("attrs"))
            return _run(f"[{num}]", extra_props) if num is not None else ""
        if t == "dateMention":
            date = attrs.get("date")
            return _run(date, extra_props) if isinstance(date, str) and _nx._ISO_DATE.match(date) else ""
        if t == "videoTimestamp":
            return _run(f"[{_nx._fmt_time(attrs.get('seconds'))}]", extra_props)
        if t == "attachmentChip":
            # The file's NAME (D-C4). In an archive the file itself travels beside the
            # document (bundled into attachments/); a single .docx cannot carry it, so the
            # document says so at the end instead of leaving a member to wonder.
            name = str(attrs.get("name") or "attachment")
            href = attrs.get("href") if isinstance(attrs.get("href"), str) else None
            bundled = None
            if self.dx.bundle_file and href:
                try:
                    bundled = self.dx.bundle_file(href)
                except Exception:  # noqa: BLE001
                    bundled = None
            if not bundled and href:
                self.dx.unbundled_files.append(name)
            return _run(name, "<w:i/>" + extra_props)
        if t in ("image", "resizableImage"):
            img = self.dx.image(attrs.get("src"))
            alt = str(attrs.get("alt") or "")
            if img:
                return self.dx.drawing(img, alt)
            return _run(f"[image: {alt}]" if alt else "[image]", "<w:i/>" + extra_props)
        # anything else inline: the text of its descendants
        return _run(_text_of(n), extra_props)

    def note_link_title(self, note_id: Any) -> str:
        """The target's title, through the SAME resolver the Markdown writer uses; never a
        link in the Word file (a relative target is not an http(s) address)."""
        if self.dx.resolver and isinstance(note_id, str) and note_id:
            try:
                resolved = self.dx.resolver(f"{_nx._NOTE_LINK_MARKER}{note_id}")
            except Exception:  # noqa: BLE001
                resolved = None
            if resolved:
                return str(resolved[0])
        return "linked note"

    # ── blocks ──
    @staticmethod
    def para(runs: str, ppr: str = "") -> str:
        return f"<w:p>{f'<w:pPr>{ppr}</w:pPr>' if ppr else ''}{runs}</w:p>"

    def blocks(self, nodes: Any, ctx: dict[str, Any] | None = None) -> list[str]:
        out: list[str] = []
        for n in nodes or []:
            if isinstance(n, dict):
                out.extend(self.block(n, ctx or {}))
        return out

    def _ppr(self, ctx: dict[str, Any], style: str | None = None) -> str:
        """Paragraph properties, schema order: pStyle, numPr, pBdr, shd, ind."""
        style = style or ctx.get("style")
        parts = [f'<w:pStyle w:val="{style}"/>'] if style else []
        if ctx.get("shade"):
            parts.append('<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="B08A2E"/></w:pBdr>')
            parts.append('<w:shd w:val="clear" w:color="auto" w:fill="F3EFE3"/>')
        if ctx.get("indent"):
            parts.append(f'<w:ind w:left="{ctx["indent"]}"/>')
        return "".join(parts)

    def block(self, n: dict[str, Any], ctx: dict[str, Any]) -> list[str]:
        t = n.get("type")
        attrs = n.get("attrs") if isinstance(n.get("attrs"), dict) else {}
        kids = n.get("content") if isinstance(n.get("content"), list) else []
        if t == "paragraph":
            return [self.para(self.inline(kids), self._ppr(ctx))]
        if t == "heading":
            try:
                level = max(1, min(int(attrs.get("level") or 1), 6))
            except (TypeError, ValueError):
                level = 1
            return [self.para(self.inline(kids), self._ppr(ctx, f"Heading{level}"))]
        if t in ("bulletList", "orderedList", "taskList"):
            return self.list_block(n, ctx, 0)
        if t == "blockquote":
            return self.blocks(kids, {**ctx, "style": "Quote"})
        if t == "codeBlock":
            code = "".join(c.get("text", "") for c in kids if isinstance(c, dict) and c.get("type") == "text")
            return [self.para(_run(code), self._ppr(ctx, "Code"))]
        if t == "blockMath":
            latex = attrs.get("latex") if isinstance(attrs.get("latex"), str) else ""
            return [self.para(_run(latex.strip()), self._ppr(ctx, "Code"))] if latex.strip() else []
        if t == "horizontalRule":
            return ['<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/>'
                    "</w:pBdr></w:pPr></w:p>"]
        if t == "table":
            return [self.table(n)]
        if t == "callout":
            variant = attrs.get("variant")
            label = variant.capitalize() if isinstance(variant, str) and variant in _nx._CALLOUT_VARIANTS \
                else str(attrs.get("emoji") or "\U0001F4A1")
            inner = {**ctx, "shade": True}
            return [self.para(_run(label, "<w:b/>"), self._ppr(inner))] + self.blocks(kids, inner)
        if t == "toggle":
            summary = next((c for c in kids if isinstance(c, dict) and c.get("type") == "toggleSummary"), None)
            body = next((c for c in kids if isinstance(c, dict) and c.get("type") == "toggleContent"), None)
            out = [self.para(self.inline((summary or {}).get("content"), "<w:b/>"), self._ppr(ctx))]
            return out + self.blocks((body or {}).get("content"), ctx)
        if t in ("toggleSummary", "imageCaption"):
            return [self.para(self.inline(kids), self._ppr(ctx))]
        if t in ("toggleContent", "columns", "column", "listItem", "taskItem"):
            return self.blocks(kids, ctx)
        if t in ("image", "resizableImage"):
            return [self.para(self.inline_node(n), self._ppr(ctx))]
        if t == "imageFigure":
            image = next((c for c in kids if isinstance(c, dict) and c.get("type") in ("image", "resizableImage")), None)
            caption = next((c for c in kids if isinstance(c, dict) and c.get("type") == "imageCaption"), None)
            out = [self.para(self.inline_node(image), self._ppr(ctx))] if image else []
            if caption:
                out.append(self.para(self.inline(caption.get("content"), "<w:i/>"), self._ppr(ctx)))
            return out
        if t == "widgetEmbed":
            fb = attrs.get("fallback") if isinstance(attrs.get("fallback"), dict) else {}
            label = str(attrs.get("searchText") or attrs.get("widgetId") or "widget")
            img = self.dx.image(fb.get("url") if isinstance(fb.get("url"), str) else None)
            if img:
                return [self.para(self.dx.drawing(img, label), self._ppr(ctx)),
                        self.para(_run(label, "<w:i/>"), self._ppr(ctx))]
            return [self.para(_run(f"[{label}]", "<w:i/>"), self._ppr(ctx))]
        if t == "askInsert":
            return self.ask_insert(attrs, kids, ctx)
        if t == "documentExcerpt":
            return self.excerpt(attrs, ctx)
        if t == "linkPreview":
            url = attrs.get("url") if isinstance(attrs.get("url"), str) else ""
            label = next((v.strip() for v in (attrs.get("title"), attrs.get("domain"), url)
                          if isinstance(v, str) and v.strip()), "")
            if not label:
                return []
            rid = self.dx.hyperlink_id(url) if _nx._WEB_LINK.match(url) else None
            if rid:
                line = f'<w:hyperlink r:id="{rid}">{_run(label, _HYPERLINK_STYLE)}</w:hyperlink>'
            else:
                line = _run(label)
            out = [self.para(line, self._ppr(ctx))]
            desc = attrs.get("description")
            if isinstance(desc, str) and desc.strip():
                out.append(self.para(_run(" ".join(desc.split())), self._ppr(ctx, "Quote")))
            return out
        if t == "webEmbed":
            url = attrs.get("url") if isinstance(attrs.get("url"), str) else ""
            if not _nx._WEB_LINK.match(url):
                return []
            label = _nx._EMBED_LABELS.get(attrs.get("provider"), "Embedded link")
            rid = self.dx.hyperlink_id(url)
            run = _run(label, _HYPERLINK_STYLE) if rid else _run(label)
            return [self.para(f'<w:hyperlink r:id="{rid}">{run}</w:hyperlink>' if rid else run, self._ppr(ctx))]
        if t == "tableOfContents":
            headings = [(lvl, txt) for lvl, txt in (_nx._TOC_HEADINGS.get() or []) if txt]
            if not headings:
                return []
            base = min(lvl for lvl, _ in headings)
            return [self.para(_run(txt), self._ppr({**ctx, "indent": 360 * (lvl - base)}))
                    for lvl, txt in headings]
        if t in ("hardBreak", "text", "noteLink", "askCitation", "dateMention", "videoTimestamp",
                 "attachmentChip", "inlineMath"):
            return [self.para(self.inline_node(n), self._ppr(ctx))]
        # Anything else: the plain text of its descendants, never raising, never dropping words.
        text = _text_of(n)
        return [self.para(_run(text), self._ppr(ctx))] if text.strip() else []

    def list_block(self, n: dict[str, Any], ctx: dict[str, Any], level: int) -> list[str]:
        t = n.get("type")
        attrs = n.get("attrs") if isinstance(n.get("attrs"), dict) else {}
        if t == "orderedList":
            try:
                start = int(attrs.get("start") or 1)
            except (TypeError, ValueError):
                start = 1
            num_id = self.dx.ordered_list_num(start)
        elif t == "bulletList":
            num_id = 1
        else:
            num_id = None   # a task list: the state is the prefix, no bullet
        lvl = min(level, 8)
        out: list[str] = []
        for item in n.get("content") or []:
            if not isinstance(item, dict):
                continue
            first = True
            for child in item.get("content") or []:
                if not isinstance(child, dict):
                    continue
                if child.get("type") in ("bulletList", "orderedList", "taskList"):
                    out.extend(self.list_block(child, ctx, level + 1))
                    continue
                if first and child.get("type") == "paragraph":
                    prefix = ""
                    if t == "taskList":
                        prefix = _run(_CHECK[bool((item.get("attrs") or {}).get("checked"))])
                    style = ctx.get("style") or "ListParagraph"
                    if num_id is not None:
                        ppr = f'<w:pStyle w:val="{style}"/><w:numPr><w:ilvl w:val="{lvl}"/>' \
                              f'<w:numId w:val="{num_id}"/></w:numPr>'
                    else:
                        ppr = f'<w:pStyle w:val="{style}"/><w:ind w:left="{720 * (lvl + 1)}"/>'
                    out.append(self.para(prefix + self.inline(child.get("content")), ppr))
                    first = False
                    continue
                first = False
                out.extend(self.block(child, {**ctx, "indent": 720 * (lvl + 1)}))
        return out

    def table(self, n: dict[str, Any]) -> str:
        rows = [r for r in (n.get("content") or []) if isinstance(r, dict)]
        grid: list[list[str]] = []
        covered: dict[int, set[int]] = {}
        width = 1
        for r_index, row in enumerate(rows):
            taken = covered.pop(r_index, set())
            cells_xml: list[str] = []
            col = 0

            def skip():
                nonlocal col
                while col in taken:
                    cells_xml.append('<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>')
                    col += 1

            for cell in row.get("content") or []:
                if not isinstance(cell, dict):
                    continue
                skip()
                cattrs = cell.get("attrs") if isinstance(cell.get("attrs"), dict) else {}

                def span(key):
                    try:
                        return max(1, min(int(cattrs.get(key) or 1), 64))
                    except (TypeError, ValueError):
                        return 1
                colspan, rowspan = span("colspan"), span("rowspan")
                header = cell.get("type") == "tableHeader"
                paras = []
                for c in cell.get("content") or []:
                    if isinstance(c, dict):
                        if c.get("type") == "paragraph":
                            paras.append(self.para(self.inline(c.get("content"), "<w:b/>" if header else "")))
                        else:
                            paras.extend(self.block(c, {}))
                tcpr = []
                if colspan > 1:
                    tcpr.append(f'<w:gridSpan w:val="{colspan}"/>')
                if rowspan > 1:
                    tcpr.append('<w:vMerge w:val="restart"/>')
                    for below in range(1, rowspan):
                        covered.setdefault(r_index + below, set()).update(range(col, col + colspan))
                tcpr_xml = f"<w:tcPr>{''.join(tcpr)}</w:tcPr>" if tcpr else ""
                cells_xml.append(f"<w:tc>{tcpr_xml}{''.join(paras) or '<w:p/>'}</w:tc>")
                col += colspan
            skip()
            width = max(width, col)
            header_row = bool(row.get("content")) and all(
                isinstance(c, dict) and c.get("type") == "tableHeader" for c in row.get("content"))
            trpr = "<w:trPr><w:tblHeader/></w:trPr>" if header_row and r_index == 0 else ""
            grid.append([trpr] + cells_xml)
        col_w = max(600, 9360 // width)
        # Pad ragged rows so every row spans the grid.
        body = []
        for cells in grid:
            trpr, tcs = cells[0], cells[1:]
            used = sum(int(m.group(1)) if (m := re.search(r'gridSpan w:val="(\d+)"', tc)) else 1 for tc in tcs)
            tcs = tcs + ["<w:tc><w:p/></w:tc>"] * max(0, width - used)
            body.append(f"<w:tr>{trpr}{''.join(tcs)}</w:tr>")
        grid_xml = "".join(f'<w:gridCol w:w="{col_w}"/>' for _ in range(width))
        return ('<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
                f"<w:tblGrid>{grid_xml}</w:tblGrid>{''.join(body)}</w:tbl>")

    def ask_insert(self, attrs: dict[str, Any], kids: list, ctx: dict[str, Any]) -> list[str]:
        """The provenance label in the SAME words the Markdown writer uses
        (`notes_export._ask_insert_head_parts`), then the answer as a quote and its sources."""
        label_parts, date, q_prefix, question = _nx._ask_insert_head_parts(attrs)
        runs = _run(" · ".join(label_parts), "<w:b/>")
        tail = ""
        if date:
            tail += f" · {date}"
        if question:
            tail += f" · {q_prefix}{question}"
        out = [self.para(runs + _run(tail), self._ppr(ctx, "Quote"))]
        out += self.blocks(kids, {**ctx, "style": "Quote"})
        sources = _nx._ask_sources(kids)
        if sources:
            line = "Sources as of insertion: " + " · ".join(f"[{k}] {v}" for k, v in sources.items())
            out.append(self.para(_run(line), self._ppr(ctx, "Quote")))
        return out

    def excerpt(self, attrs: dict[str, Any], ctx: dict[str, Any]) -> list[str]:
        excerpt_id = attrs.get("excerptId") or ""
        resolved = None
        if self.dx.resolver and excerpt_id:
            try:
                resolved = self.dx.resolver(f"{_nx._DOCUMENT_EXCERPT_MARKER}{excerpt_id}")
            except Exception:  # noqa: BLE001
                resolved = None
        if not resolved:
            return [self.para(_run("[excerpt source no longer available]", "<w:i/>"), self._ppr(ctx))]
        quote, citation, annotation = resolved
        out = [self.para(_run(str(quote or "")), self._ppr(ctx, "Quote")),
               self.para(_run(f"— {citation}"), self._ppr(ctx, "Quote"))]
        if annotation:
            out.append(self.para(_run(str(annotation), "<w:i/>"), self._ppr(ctx)))
        return out


def _styles_xml() -> str:
    def pstyle(sid, name, based="Normal", ppr="", rpr="", nxt="Normal"):
        based_xml = f'<w:basedOn w:val="{based}"/>' if based else ""
        return (f'<w:style w:type="paragraph" w:styleId="{sid}"><w:name w:val="{name}"/>{based_xml}'
                f'<w:next w:val="{nxt}"/><w:qFormat/>'
                f"{f'<w:pPr>{ppr}</w:pPr>' if ppr else ''}{f'<w:rPr>{rpr}</w:rPr>' if rpr else ''}</w:style>")
    headings = "".join(
        pstyle(f"Heading{n}", f"heading {n}",
               ppr=f'<w:keepNext/><w:spacing w:before="{280 - 20 * n}" w:after="80"/><w:outlineLvl w:val="{n - 1}"/>',
               rpr=f'<w:b/><w:sz w:val="{[40, 34, 30, 27, 25, 24][n - 1]}"/>')
        for n in range(1, 7))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
        '<w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>'
        '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
        "</w:docDefaults>"
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
        + pstyle("Title", "Title", ppr='<w:spacing w:after="80"/>', rpr='<w:b/><w:sz w:val="48"/>')
        + pstyle("Subtitle", "Subtitle", rpr='<w:i/><w:color w:val="5F6570"/><w:sz w:val="28"/>')
        + headings
        + pstyle("Quote", "Quote", ppr='<w:ind w:left="567"/>', rpr='<w:i/><w:color w:val="5F6570"/>')
        + pstyle("Code", "Code", ppr='<w:shd w:val="clear" w:color="auto" w:fill="F4F5F7"/><w:spacing w:after="0"/>',
                 rpr='<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/>')
        + pstyle("ListParagraph", "List Paragraph", ppr='<w:ind w:left="720"/><w:contextualSpacing/>')
        + pstyle("Meta", "Meta", rpr='<w:color w:val="5F6570"/><w:sz w:val="20"/>')
        + '<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/>'
          '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/></w:rPr></w:style>'
        + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>'
          '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>'
        + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>'
          + "".join(f'<w:{side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
                    for side in ("top", "left", "bottom", "right", "insideH", "insideV"))
          + "</w:tblBorders></w:tblPr></w:style>"
        + "</w:styles>"
    )


def _numbering_xml(ordered_starts: list[int]) -> str:
    def levels(fmt: str) -> str:
        out = []
        for lvl in range(9):
            if fmt == "bullet":
                text = ["•", "◦", "▪"][lvl % 3]
            else:
                text = f"%{lvl + 1}."
            out.append(f'<w:lvl w:ilvl="{lvl}"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/>'
                       f'<w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/>'
                       f'<w:pPr><w:ind w:left="{720 * (lvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>')
        return "".join(out)
    nums = ['<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
            '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>']
    for i, start in enumerate(ordered_starts):
        nums.append(f'<w:num w:numId="{3 + i}"><w:abstractNumId w:val="1"/>'
                    f'<w:lvlOverride w:ilvl="0"><w:startOverride w:val="{start}"/></w:lvlOverride></w:num>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>{levels("bullet")}</w:abstractNum>'
        f'<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>{levels("decimal")}</w:abstractNum>'
        + "".join(nums) + "</w:numbering>"
    )


def note_docx(doc: Any, *, title: str, subtitle: str | None = None, tags: list[str] | None = None,
              ticker: str | None = None, properties: list[dict[str, str]] | None = None,
              hero_url: str | None = None, updated_at: str | None = None,
              load_image: Callable[[str], tuple[bytes, str] | None] | None = None,
              resolver: Callable | None = None, bundle_file: Callable[[str], str | None] | None = None,
              issues: list[str] | Callable[[], list[str]] | None = None) -> bytes:
    """ONE note as a .docx (bytes). `load_image(url) -> (bytes, filename) | None` reads one of
    this note's attachments within the export's byte cap; `resolver` is the Markdown writer's
    own (note links, excerpts); `bundle_file(url)` puts a file attachment beside the document
    in an archive (None for a lone .docx). `issues` -- what the export could not include --
    is listed at the end, so a member reading the file sees what is missing, and so is every
    file attachment a lone .docx could not carry."""
    dx = _Docx(load_image=load_image, resolver=resolver, bundle_file=bundle_file)
    walker = _Walker(dx)
    body: list[str] = [walker.para(_run(title or "Untitled"), '<w:pStyle w:val="Title"/>')]
    if subtitle:
        body.append(walker.para(_run(subtitle), '<w:pStyle w:val="Subtitle"/>'))
    meta = [m for m in (ticker, " · ".join(str(t) for t in (tags or [])),
                        f"Updated {str(updated_at)[:10]}" if updated_at else "") if m]
    if meta:
        body.append(walker.para(_run(" · ".join(meta)), '<w:pStyle w:val="Meta"/>'))
    for p in properties or []:
        body.append(walker.para(_run(f"{p['name']}: ", "<w:b/>") + _run(p["value"]), '<w:pStyle w:val="Meta"/>'))
    hero = dx.image(hero_url) if hero_url else None
    if hero:
        body.append(walker.para(dx.drawing(hero, "Hero image")))
    token = _nx._TOC_HEADINGS.set(_nx._toc_headings(doc) if isinstance(doc, dict) else [])
    try:
        body.extend(walker.blocks((doc or {}).get("content") if isinstance(doc, dict) else []))
    finally:
        _nx._TOC_HEADINGS.reset(token)
    # `issues` may be a callable, read only now: the walk above is what finds most of them.
    missing = list((issues() if callable(issues) else issues) or []) + [
        f"{name} -- a file attachment; a Word document holds its name, not the file. "
        "Export the note as Markdown or JSON to keep the file." for name in dx.unbundled_files]
    if missing:
        body.append(walker.para(_run("Not included in this export"), '<w:pStyle w:val="Heading2"/>'))
        body.extend(walker.para(_run(line), '<w:pStyle w:val="Meta"/>') for line in missing)
    body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
                '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" '
                'w:footer="720" w:gutter="0"/></w:sectPr>')
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                f"<w:document {_NS}><w:body>{''.join(body)}</w:body></w:document>")

    rels = [f'<Relationship Id="rId1" Type="{_R_TYPE}/styles" Target="styles.xml"/>',
            f'<Relationship Id="rId2" Type="{_R_TYPE}/numbering" Target="numbering.xml"/>']
    for rid, rtype, target, external in dx.rels:
        mode = ' TargetMode="External"' if external else ""
        rels.append(f'<Relationship Id="{rid}" Type="{rtype}" Target="{_x(target)}"{mode}/>')
    doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                f'<Relationships xmlns="{_REL_NS}">{"".join(rels)}</Relationships>')
    exts = sorted({name.rsplit(".", 1)[1] for name, _ in dx.media})
    defaults = "".join(f'<Default Extension="{e}" ContentType="image/{e}"/>' for e in exts)
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>' + defaults +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.'
        'wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.'
        'wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.'
        'wordprocessingml.numbering+xml"/>'
        "</Types>")
    package_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                    f'<Relationships xmlns="{_REL_NS}"><Relationship Id="rId1" '
                    f'Type="{_R_TYPE}/officeDocument" Target="word/document.xml"/></Relationships>')
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", package_rels)
        zf.writestr("word/document.xml", document)
        zf.writestr("word/styles.xml", _styles_xml())
        zf.writestr("word/numbering.xml", _numbering_xml(dx.ordered_nums))
        zf.writestr("word/_rels/document.xml.rels", doc_rels)
        for name, blob in dx.media:
            zf.writestr(f"word/media/{name}", blob)
    return buf.getvalue()
