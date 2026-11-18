"""⭐ WHAT CREATE INDICATOR REMEMBERS ABOUT A MEMBER: the choices they made when it asked.

Owner direction, 2026-11-18: "Learn about the member and what they want and do." The first time a
choice that changes the maths is open, the door asks (`definition_conversation.door_question`).
The member's ANSWER is remembered here, and from then on the door uses it and SAYS so ("Using an
exponential average, as you chose before") instead of asking again.

THE STORE IS THE MEMBER'S OWN ACCOUNT. One row of the existing `user_preferences` table (auth.db),
key ``create_indicator_memory``: the same store Settings already reads and writes for that member
and no one else. Nothing here is a second store, and nothing here is shared between members.

ONLY CLOSED VALUES. A remembered choice is a registry question's id, one of that question's own
values (a choice id or a number), the label the member tapped, a count, a date and where it came
from. ⛔ NO SENTENCE A MEMBER WROTE IS EVER STORED: `parse` drops anything that is not that shape,
on the way in and on the way out, so a value written into the account by hand cannot reach the
door either.

IT NEVER BREAKS A TURN. Reading fails open (nothing remembered); writing fails quiet (logged). The
door works without a memory at all, which is how every test that does not ask for one runs it.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

#: The `user_preferences` key. One document per member.
KEY = "create_indicator_memory"
VERSION = 1
#: Where a remembered choice came from. Only an answer (or the member's own edit in Settings)
#: makes a choice; nothing is inferred into this list.
SOURCES = ("answer", "settings")
MAX_CHOICES = 24
MAX_DOC_CHARS = 4000
_ID = re.compile(r"^[a-z][a-z_]{0,31}$")
_VALUE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,23}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_LABEL_CHARS = 80


def empty() -> Dict[str, Any]:
    return {"v": VERSION, "choices": {}}


def _clean_choice(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    value, label = raw.get("value"), raw.get("label")
    if isinstance(value, bool) or not isinstance(label, str) or not label.strip() or len(label) > MAX_LABEL_CHARS:
        return None
    if isinstance(value, (int, float)):
        if value != value or not (-1e9 < value < 1e9):
            return None
    elif not (isinstance(value, str) and _VALUE.match(value)):
        return None
    times, last, source = raw.get("times"), raw.get("last"), raw.get("from")
    return {
        "value": value, "label": label.strip(),
        "times": times if isinstance(times, int) and not isinstance(times, bool) and 0 < times < 10_000_000 else 1,
        "last": last if isinstance(last, str) and _DATE.match(last) else None,
        "from": source if source in SOURCES else "answer",
    }


def parse(raw: Any) -> Dict[str, Any]:
    """The stored document, sanitised: only well-shaped, closed entries survive. Never raises."""
    try:
        doc = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return empty()
    if not isinstance(doc, dict) or not isinstance(doc.get("choices"), dict):
        return empty()
    out = empty()
    for qid, choice in list(doc["choices"].items())[:MAX_CHOICES]:
        clean = _clean_choice(choice)
        if isinstance(qid, str) and _ID.match(qid) and clean is not None:
            out["choices"][qid] = clean
    return out


def dump(doc: Dict[str, Any]) -> str:
    return json.dumps(parse(doc), separators=(",", ":"), ensure_ascii=False)


def _account_reader(user_id: Any) -> Optional[str]:
    from api.services.auth_service import get_user_preferences
    return get_user_preferences(str(user_id)).get(KEY)


def _account_writer(user_id: Any, value: Optional[str]) -> None:
    from api.services.auth_service import delete_user_preference, set_user_preference
    if value is None:
        delete_user_preference(str(user_id), KEY)
    else:
        set_user_preference(str(user_id), KEY, value)


class Memory:
    """One member's remembered choices. `reader(user_id) -> stored text or None` and
    `writer(user_id, text or None)` default to the member's own account row."""

    def __init__(self, user_id: Any, *, reader: Optional[Callable[[Any], Optional[str]]] = None,
                 writer: Optional[Callable[[Any, Optional[str]], None]] = None,
                 today: Callable[[], dt.date] = dt.date.today) -> None:
        self.user_id = user_id
        self._reader = reader if reader is not None else _account_reader
        self._writer = writer if writer is not None else _account_writer
        self._today = today

    def read(self) -> Dict[str, Any]:
        try:
            return parse(self._reader(self.user_id))
        except Exception:                          # noqa: BLE001 -- a memory that cannot be read is no memory
            logger.warning("[indicator-memory] could not be read; nothing is remembered this turn")
            return empty()

    def choice(self, question_id: str) -> Optional[Dict[str, Any]]:
        return self.read()["choices"].get(question_id)

    def remember(self, question_id: str, value: Any, label: str, *, source: str = "answer") -> bool:
        """The member chose `value` (shown to them as `label`) for this question. The newest
        answer wins; the count restarts when the choice changes. True when it was stored."""
        fresh = _clean_choice({"value": value, "label": label, "times": 1,
                               "last": self._today().isoformat(), "from": source})
        if fresh is None or not (isinstance(question_id, str) and _ID.match(question_id)):
            return False
        try:
            doc = self.read()
            before = doc["choices"].get(question_id)
            if before and before["value"] == fresh["value"]:
                fresh["times"] = before["times"] + 1
            doc["choices"][question_id] = fresh
            text = dump(doc)
            if len(text) > MAX_DOC_CHARS:
                return False
            self._writer(self.user_id, text)
            return True
        except Exception:                          # noqa: BLE001 -- never breaks the turn
            logger.warning("[indicator-memory] could not be written; the choice is not remembered")
            return False

    def forget(self, question_id: Optional[str] = None) -> bool:
        """Forget one choice, or everything (the row is removed: nothing else holds a copy)."""
        try:
            if question_id is None:
                self._writer(self.user_id, None)
                return True
            doc = self.read()
            if doc["choices"].pop(question_id, None) is None:
                return False
            self._writer(self.user_id, dump(doc) if doc["choices"] else None)
            return True
        except Exception:                          # noqa: BLE001
            logger.warning("[indicator-memory] could not be changed")
            return False
