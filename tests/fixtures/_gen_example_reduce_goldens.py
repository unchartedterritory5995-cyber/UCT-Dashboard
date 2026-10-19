"""The old-mode goldens for P3b Task 2 (test 16): what `public_note_payload.reduce` makes of every
fixture in tests/test_public_note_payload.py, in `share`, `publish` and `gallery`.

⛔ EVIDENCE BEFORE CHANGE (R-RAW). This file was run, and its output
`tests/fixtures/example_reduce_old_mode_goldens.json` committed, on the tree BEFORE the `example`
mode touched `public_note_payload.py`. `tests/test_example_reduce.py` re-reduces the same cases and
compares the JSON text byte for byte, so a change to the reducer that moves an old mode by one key
or one character goes red. Re-running this after the change would bless whatever the reducer does
now: only re-run it for a deliberate, reviewed change to an old mode.

    python -m tests.fixtures._gen_example_reduce_goldens

The case list is DERIVED from the payload rail's own fixtures (imported, never retyped), plus
every registered widget id and every trader block id, so a fixture added there is covered here.
"""
from __future__ import annotations

import copy
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Iterator

OUT = Path(__file__).resolve().parent / "example_reduce_old_mode_goldens.json"
OLD_MODES = ("share", "publish", "gallery")


def cases() -> Iterator[tuple[str, dict, dict | None]]:
    """(case id, body, note_links) for every body the old-mode golden pins."""
    from api.services.journal_two import trader_blocks
    from tests import test_public_note_payload as tp

    for name in sorted(tp.FIXTURES):
        yield f"fixture:{name}", tp.FIXTURES[name](), None
    for wid in sorted(set(tp.widget_ids()) | set(trader_blocks.BLOCK_IDS)):
        yield f"widget:{wid}", tp.doc(tp._widget(wid)), None
    yield "leaky-note", tp.LEAKY_NOTE["bodyJson"], None
    yield "leaky-note+links", tp.LEAKY_NOTE["bodyJson"], tp.NOTE_LINKS_IN_PUBLICATION
    urls = list(tp.IN_APP_URLS) + list(tp.FOREIGN_HOST_IN_APP) + [
        tp.WEB_PAGE, tp.WEB_IMAGE, f"{tp.OWN_ATT}inline/p.png", f"{tp.OTHER_ATT}inline/q.png"]
    for attr in sorted(tp.URL_ATTRS):
        for i, u in enumerate(urls):
            yield f"url-attr:{attr}:{i}", tp.URL_ATTRS[attr](u), None
    for i, u in enumerate(urls):
        for j, body in enumerate(tp._address_texts(u)):
            yield f"address-text:{i}:{j}", body, None
    for c in sorted(tp.NESTED_CONTAINERS):
        for n in sorted(tp.MASSIVE_NODES):
            yield f"nested:{c}:{n}", tp.NESTED_CONTAINERS[c](tp.MASSIVE_NODES[n]()), None
        for n in sorted(tp.APPROVED_NODES):
            yield f"nested:{c}:{n}", tp.NESTED_CONTAINERS[c](tp.APPROVED_NODES[n][0]()), None
    yield "facts", tp.doc(*[{"type": "financialFact", "attrs": {"factId": f}} for f in (
        *sorted(tp.FACTS), "fact-not-this-note")]), None
    mail = {"type": "link", "attrs": {"href": "mailto:me@example.com"}}
    yield "emails", tp.doc(tp.p(tp.t("write to me@example.com or "), tp.t("here", mail), tp.t(" -- or the site", {
        "type": "link", "attrs": {"href": "https://example.com/contact"}}))), None
    yield "task-checked", tp.doc({"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": True}, "content": [tp.p(tp.t("done"))]}]}), None
    yield "notelinks", tp.doc(tp.p({"type": "noteLink", "attrs": {"noteId": tp.OTHER}}, tp.t(" / "),
                                   {"type": "noteLink", "attrs": {"noteId": "not-published"}})), \
        tp.NOTE_LINKS_IN_PUBLICATION
    # prose the example mode rewrites (money, P&L figures, brokers): the OLD modes must keep it as is
    yield "example-prose", tp.doc(
        tp.p(tp.t("made $1,240 on NVDA, up 3.2R, at Schwab")),
        tp.p(tp.t("NVDA 132.40 support; -$500k and $2.5M; Down 4% today; RS up 4% vs SPY")),
        tp.p(tp.t("Charles Schwab, Interactive Brokers, E*TRADE, Public.com, NVDA 3.2R target"))), None
    yield "images", tp.doc(
        {"type": "image", "attrs": {"src": f"{tp.OWN_ATT}inline/a.png", "alt": "a", "width": 300}},
        {"type": "image", "attrs": {"src": f"{tp.OTHER_ATT}inline/b.png"}},
        {"type": "image", "attrs": {"src": tp.WEB_IMAGE, "title": "t"}},
        {"type": "imageFigure", "content": [{"type": "image", "attrs": {"src": f"{tp.OWN_ATT}inline/c.png"}},
                                            {"type": "imageCaption", "content": [tp.t("cap $9")]}]}), None


def reduce_old(body: dict, mode: str, note_links: dict | None) -> str:
    """The reduced body as the JSON TEXT the golden holds (key order included)."""
    from api.services.journal_two import public_note_payload as pnp
    from tests import test_public_note_payload as tp
    out = pnp.reduce(copy.deepcopy(body), mode=mode, owner_id=tp.OWNER, note_id=tp.NOTE,
                     attachment_base=tp.BASE, facts=tp.FACTS, note_links=note_links)
    return json.dumps(out, ensure_ascii=False)


def build() -> dict[str, dict[str, str]]:
    golden: dict[str, dict[str, str]] = {}
    for case_id, body, links in cases():
        assert case_id not in golden, f"duplicate case id {case_id}"
        golden[case_id] = {mode: reduce_old(body, mode, links) for mode in OLD_MODES}
    return golden


def main() -> None:
    data = json.dumps(build(), ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    fd, tmp = tempfile.mkstemp(dir=str(OUT.parent), prefix=".goldens-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(data)
        os.replace(tmp, OUT)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    print(f"wrote {OUT.name}: {data.count(chr(10))} lines")


if __name__ == "__main__":
    main()
