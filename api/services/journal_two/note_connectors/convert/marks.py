"""The ONE rule for which marks a text run may carry together (D3 item 2).

The editor's schema decides what a valid mark set is, and two of its rules bite a converter
that composes marks from nested source markup:

  * the `code` mark excludes EVERY other mark (`@tiptap/extension-code`: `excludes: "_"`);
  * every other mark excludes only ITSELF (ProseMirror's default), so a run carries at most one
    mark of a type (a link inside a link keeps the inner one, as the editor's parser does).

`schema.nodeFromJSON(doc).check()` throws "Invalid collection of marks" for any other set, and
until D3 the shared converters wrote `link+code` (`[`x`](url)`) and `bold+code` (`**`x`**`).

Ruling (D3 item 2): a LINK must survive. Where a run is both a link and code, the link (and the
run's other marks) stays and the code mark goes. Where a run is code and anything else but a
link, the code mark stays and the others go, as the editor's own parser does. The client lane
applies the same ruling before its parse (`lib/importer/convert.js::liftLinksOutOfCode`).
"""

from __future__ import annotations

from typing import Any


def exclusive_marks(marks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`marks` as a set the editor's schema accepts, by the ruling above. Order is kept (the
    schema sorts marks by its own rank on load); a later mark of a type replaces an earlier
    one, as an inner element's mark does in the editor's parser."""
    out: list[dict[str, Any]] = []
    for mark in marks:
        kind = mark.get("type")
        out = [m for m in out if m.get("type") != kind]
        out.append(mark)
    if any(m.get("type") == "code" for m in out):
        if any(m.get("type") == "link" for m in out):
            return [m for m in out if m.get("type") != "code"]
        return [m for m in out if m.get("type") == "code"]
    return out
