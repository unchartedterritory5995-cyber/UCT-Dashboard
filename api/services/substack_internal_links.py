"""Turn a link back to Substack into a link into our own reader.

A Sunday Scans issue routinely references earlier issues. Left alone, those
anchors bounce a reader out of The Desk and onto Substack — to read an article
we are already hosting, one route away. This closes that loop.

WHY AT READ TIME, not at conversion. Whether we can serve a given post changes
as the archive backfills: post A can reference post B before B has a body. If
the decision were baked in at conversion, A would keep pointing at Substack
until something re-converted it. Resolving on the way out is always current and
costs one regex pass over an article we are already serving.

The converter marks candidates with `data-post-slug` and leaves the original
href intact, so an unresolvable link stays a working outbound link rather than
becoming a dead internal one.
"""
from __future__ import annotations

import re

# The anchor the converter emitted: an href, a data-post-slug, and (because the
# href is external) target/rel. Matching the WHOLE tag lets us replace it
# wholesale rather than patching attributes inside it.
_ANCHOR_RE = re.compile(r"<a\b[^>]*\bdata-post-slug=\"([^\"]+)\"[^>]*>")
_HREF_RE = re.compile(r'\shref="[^"]*"')
_TARGET_RE = re.compile(r'\s(?:target|rel)="[^"]*"')


def rewrite(body_html: str, readable_slugs, *, reader_path: str = "/desk/article/{slug}") -> tuple:
    """Point in-house post links at our reader. Returns (html, rewritten_count).

    Anything whose slug we cannot serve is left exactly as it was.
    """
    if not body_html or not readable_slugs:
        return body_html or "", 0

    count = 0

    def _sub(match: "re.Match") -> str:
        nonlocal count
        slug = match.group(1)
        if slug not in readable_slugs:
            return match.group(0)
        tag = match.group(0)
        tag = _HREF_RE.sub("", tag, count=1)
        # An internal route must not open in a new tab, and `rel=noopener` on a
        # same-origin link is noise.
        tag = _TARGET_RE.sub("", tag)
        tag = tag.replace("<a", f'<a href="{reader_path.format(slug=slug)}"', 1)
        count += 1
        return tag

    return _ANCHOR_RE.sub(_sub, body_html), count
