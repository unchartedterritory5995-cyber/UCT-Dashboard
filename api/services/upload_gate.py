"""The in-flight cap an upload door answers 429 with, shared by every upload door.

Two doors use it today, each with its OWN instance and limits:
  * the editor upload doors (`api/routers/journal_two.py::_UPLOAD_GATE`,
    `UPLOAD_PER_MEMBER_INFLIGHT` / `UPLOAD_GLOBAL_INFLIGHT`);
  * the Obsidian blob upload (`api/routers/note_sync.py::_OBSIDIAN_UPLOAD_GATE`), so a vault
    sync never spends the editor doors' slots.
It lives here, not in either router, so neither router imports the other's private names
(Plan C final review M4).

Per-process state (CLAUDE.md's SINGLE-PROCESS list): a second web process doubles every cap.
"""

from __future__ import annotations

UPLOAD_BUSY_SENTENCE = "Too many uploads at once. Try again in a moment."


class UploadGate:
    """The two in-flight counts. Event-loop state only: `acquire` and `release` never await,
    so a check and its increment cannot interleave with another request."""

    def __init__(self, per_member: int, total: int) -> None:
        self.total = 0
        self.by_member: dict[str, int] = {}
        self._per_member = per_member
        self._total_cap = total

    def acquire(self, user_id: str) -> bool:
        mine = self.by_member.get(user_id, 0)
        if mine >= self._per_member or self.total >= self._total_cap:
            return False
        self.by_member[user_id] = mine + 1
        self.total += 1
        return True

    def release(self, user_id: str) -> None:
        self.total = max(0, self.total - 1)
        left = self.by_member.get(user_id, 1) - 1
        if left > 0:
            self.by_member[user_id] = left
        else:
            self.by_member.pop(user_id, None)
