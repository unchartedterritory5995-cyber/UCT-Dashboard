"""Notebook widgets phase 2, wave 11 (Task 11.6): the routines and trackers a template can make.

A template's `routine_<k>` / `tracker_<k>` slot may name `{"template": "<key>"}` (ruling W11-R2): a routine or tracker
the template makes for the member the first time it is used. This module is the ONE table of those keys
(`journal_styles.slot_settings_of` checks a key against it, `share.share_template` lets one travel, and
`template_preview` names it), plus the two rules every use of it follows:

* the unique key (ruling W11-R13): a template-made routine or tracker is created at most once per member, keyed
  `tpl:<template key>` for an official template's tool and `gal:<gallery id>:<inline key>` for a member-shared one
  (`template_key`; the stores keep the key UNIQUE per member, and W9-R12 restores a soft-deleted one);
* the reuse question: before creating, the member is asked whether to use one of their own routines (trackers)
  instead (`best_match`, read only from their own rows).

Four routine templates DERIVE from `routines.STARTERS` (one authority: moving a starter's item moves the template);
the rest are written here. `ROUTINE_TEMPLATES` is a read-only mapping that answers fresh copies on every read, so
no caller can change a starter through it.

⛔ No day state is read here: a candidate is a name, its item texts and its kind, never a tick or a value.
"""
from __future__ import annotations

import re
import sqlite3
from collections.abc import Mapping
from typing import Any, Iterator

from api.services.journal_two.tool_errors import ToolError

#: The member's sentences when a template slot has no answer (the adoption sheet asks each question once).
S_CHOOSE_ROUTINE = "Choose a routine for each routine in this template."
S_CHOOSE_TRACKER = "Choose a tracker for each tracker in this template."

#: A unique key is at most this long (the stores' `_TEMPLATE_KEY_MAX`, W11-R13).
KEY_MAX = 64
KINDS = ("routine", "tracker")


class LibraryError(ToolError):
    """A template-library refusal a member reads (`.sentence`): a slot left without an answer. Always a 400
    with code `unresolved` (the error class is the status authority, W9-R14)."""

    status = 400
    code = "unresolved"


def _it(text: str, negative: bool = False, suggest: dict | None = None) -> dict:
    return {"text": text, "negative": negative, "suggest": suggest}


#: The template keys that ARE a starter routine (template key -> `routines.STARTERS` key).
_FROM_STARTERS: dict[str, str] = {
    "premarket_routine": "premarket",
    "preentry_checks": "preentry",
    "eod_review": "eod",
    "rules_i_keep": "rules",
}

#: The routine templates written here (not starters), item for item.
_OWN_ROUTINES: dict[str, dict] = {
    "night_before": {"name": "Night-before prep", "items": [
        _it("Build tomorrow's watchlist"),
        _it("Mark levels on my top names"),
        _it("Check tomorrow's earnings and economic calendar"),
        _it("Set tomorrow's max loss"),
        _it("Write my plan for the open"),
    ]},
    "tilt_reset": {"name": "Tilt reset", "items": [
        _it("Step away from the screen for 10 minutes"),
        _it("Write what happened in one line"),
        _it("Check my room under my daily loss limit"),
        _it("Decide: done for the day, or one A+ setup only"),
    ]},
    "weekly_review_routine": {"name": "Weekly review", "items": [
        _it("Review every trade of the week"),
        _it("Tag setups and mistakes"),
        _it("Update my playbook"),
        _it("Set one goal for next week"),
    ]},
    "swing_weekend": {"name": "Weekend swing review", "items": [
        _it("Review every open position and its stop"),
        _it("Check earnings dates for my holdings"),
        _it("Build next week's watchlist"),
        _it("Set my risk for next week"),
    ]},
    "morning_routine": {"name": "Morning routine", "items": [
        _it("Up with time to prep before the bell"),
        _it("Exercise or a walk"),
        _it("Read the morning wire"),
        _it("Review my rules"),
    ]},
    "consistency_30": {"name": "30-day consistency", "items": [
        _it("Followed my trading plan"),
        _it("Stayed under my daily loss limit", suggest={"rule": "under_daily_loss_limit"}),
        _it("Logged every trade"),
        _it("No revenge trades", True, {"rule": "no_revenge"}),
    ]},
}


def _copy(entry: Mapping) -> dict:
    return {"name": entry["name"],
            "items": [{"text": i["text"], "negative": i.get("negative") is True,
                       "suggest": dict(i["suggest"]) if isinstance(i.get("suggest"), Mapping) else None}
                      for i in entry["items"]]}


class _RoutineTemplates(Mapping):
    """`ROUTINE_TEMPLATES`: `{key: {"name", "items": [{"text", "negative", "suggest"}]}}`. The four starter keys are
    read from `routines.STARTERS` on EVERY access (never a copy taken at import), and each read is a fresh copy."""

    def _keys(self) -> list[str]:
        return [*_FROM_STARTERS, *_OWN_ROUTINES]

    def __getitem__(self, key: Any) -> dict:
        if key in _FROM_STARTERS:
            from api.services.journal_two import routines
            return _copy(routines.STARTERS[_FROM_STARTERS[key]])
        if isinstance(key, str) and key in _OWN_ROUTINES:
            return _copy(_OWN_ROUTINES[key])
        raise KeyError(key)

    def __contains__(self, key: object) -> bool:
        return isinstance(key, str) and (key in _FROM_STARTERS or key in _OWN_ROUTINES)

    def __iter__(self) -> Iterator[str]:
        return iter(self._keys())

    def __len__(self) -> int:
        return len(self._keys())


ROUTINE_TEMPLATES: Mapping[str, dict] = _RoutineTemplates()

_TRACKERS: dict[str, dict] = {
    "sleep": {"name": "Sleep", "kind": "duration", "unit": None},
    "energy": {"name": "Energy", "kind": "scale"},
    "exercise": {"name": "Exercise", "kind": "yesno"},
    "plan_followed": {"name": "Followed my trading plan", "kind": "yesno"},
}


class _TrackerTemplates(Mapping):
    """`TRACKER_TEMPLATES`: `{key: {"name", "kind", "unit"?}}`, a fresh copy on every read."""

    def __getitem__(self, key: Any) -> dict:
        if isinstance(key, str) and key in _TRACKERS:
            return dict(_TRACKERS[key])
        raise KeyError(key)

    def __contains__(self, key: object) -> bool:
        return isinstance(key, str) and key in _TRACKERS

    def __iter__(self) -> Iterator[str]:
        return iter(list(_TRACKERS))

    def __len__(self) -> int:
        return len(_TRACKERS)


TRACKER_TEMPLATES: Mapping[str, dict] = _TrackerTemplates()


def template_key(kind: str, *, template: str | None = None, gallery_id: str | None = None,
                 inline: str | None = None) -> str:
    """The unique key a template-made routine (tracker) is created under (W11-R13): `tpl:<template>` for a
    template-table key, `gal:<gallery_id>:<inline>` for a member-shared one. At most KEY_MAX characters. Raises
    ValueError for anything else (a key the stores would truncate would make two templates share one tool)."""
    if kind not in KINDS:
        raise ValueError("A template key is for a routine or a tracker.")
    if template is not None:
        if inline is not None or not isinstance(template, str) or not template:
            raise ValueError("Name a template key, or a gallery item and its inline key.")
        key = f"tpl:{template}"
    else:
        if not (isinstance(gallery_id, str) and gallery_id and isinstance(inline, str) and inline):
            raise ValueError("Name a template key, or a gallery item and its inline key.")
        key = f"gal:{gallery_id}:{inline}"
    if len(key) > KEY_MAX:
        raise ValueError("That template key is too long.")
    return key


_WORD_RE = re.compile(r"[a-z0-9]+")


def _words(text: Any) -> set[str]:
    return set(_WORD_RE.findall(text.lower())) if isinstance(text, str) else set()


def _texts(items: Any) -> set[str]:
    out = set()
    for it in items if isinstance(items, (list, tuple)) else []:
        text = it.get("text") if isinstance(it, Mapping) else it
        if isinstance(text, str) and text.strip():
            out.add(" ".join(text.lower().split()))
    return out


def candidates(user_id: str, kind: str, *, conn: sqlite3.Connection | None = None) -> list[dict]:
    """The member's own live, non-archived routines (trackers) a template's tool is compared against, in ONE read
    (`routines.match_candidates` / `trackers.match_candidates`, W9-R15). Another member's rows are never read."""
    if kind == "routine":
        from api.services.journal_two import routines
        return routines.match_candidates(user_id, conn=conn)
    if kind == "tracker":
        from api.services.journal_two import trackers
        return trackers.match_candidates(user_id, conn=conn)
    raise ValueError("A template tool is a routine or a tracker.")


def best_match(user_id: str, kind: str, wanted: Mapping, *, conn: sqlite3.Connection | None = None,
               pool: list[dict] | None = None) -> dict | None:
    """`{"id", "name"}` of the member's non-archived routine (tracker) that best matches `wanted`
    (`{"name", "items"}` for a routine, `{"name", "kind"}` for a tracker), or None.

    Score: the lower-cased word tokens the two names share, plus (routines) the item texts they share. A tracker
    must be of the same kind. Ties go to the newest `updatedAt`; a score of 0 is no match. `pool` is a
    `candidates()` answer already read in this request (one read per family per request)."""
    rows = pool if pool is not None else candidates(user_id, kind, conn=conn)
    if not isinstance(wanted, Mapping):
        return None
    name_words = _words(wanted.get("name"))
    item_texts = _texts(wanted.get("items")) if kind == "routine" else set()
    best: tuple[int, str] | None = None
    found: dict | None = None
    for row in rows:
        if not isinstance(row, Mapping) or not isinstance(row.get("id"), str):
            continue
        if kind == "tracker" and row.get("kind") != wanted.get("kind"):
            continue
        score = len(name_words & _words(row.get("name")))
        if kind == "routine":
            score += len(item_texts & _texts(row.get("items")))
        if score <= 0:
            continue
        rank = (score, row.get("updatedAt") or "")
        if best is None or rank > best:
            best, found = rank, {"id": row["id"], "name": row.get("name")}
    return found
