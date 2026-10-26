"""The words a PUBLIC page numbers a member's own names with (rulings R-25, W10-R7, W10-R74 and the W10.7 walk fix).

THE ONE TABLE. A shared built widget never publishes an account, a note title, a folder, a note tag or kind, a routine,
a routine item, a tracker or a note property by name: each distinct one becomes "<word> <n>", numbered by first
appearance. `public_note_payload` numbers group labels with it (`labelKind` -> word) and
`widget_engine.payload.public_property_labels` numbers property measures with its "property" word. Both import it from
here; nothing else restates a word.
"""
from __future__ import annotations

#: label kind -> the word it is numbered with. "property" (W10-R74) numbers a property measure ("Sum of Property 1").
RELABEL_WORDS: dict[str, str] = {
    "account": "Account", "note": "Note", "folder": "Folder", "tag": "Tag", "kind": "Note kind",
    "routine": "Routine", "item": "Item", "tracker": "Tracker", "property": "Property",
}


def numbered(kind: str, n: int) -> str:
    """'Account 1', 'Property 2': the public name of the n-th distinct name of `kind`."""
    return f"{RELABEL_WORDS[kind]} {n}"
