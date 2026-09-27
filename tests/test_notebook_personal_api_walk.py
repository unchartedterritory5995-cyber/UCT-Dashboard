"""Rails for the production personal-API walk's daily step (tools/notebook_personal_api_walk.py).

Review M-2 (wave 10, lane 10D, fix round 1): the walk decided "today's daily note does not
exist yet" from a title (weekday from the local locale) among the first 100 notes of the
root Daily folder. The server decides it by `j2_notes.daily_date` under a unique index, so
a renamed, moved or archived daily note — or a 101st note — read as absent, and the walk
appended its line into a note bench@ owns and left it in production.

What these rails hold, each against a STUBBED SERVER that answers the list and read doors
the way the real ones do (the list door carries no `dailyDate`; only the full note does):

  * today's note under a DIFFERENT title in a different folder -> the walk does not append;
  * today's note ARCHIVED -> the walk does not append;
  * today's note past the first page of the list -> found, no append;
  * CONTROL: no note carries today's `dailyDate` (one even carries today's TITLE) -> the
    walk DOES post the append — so "no append" above is the gate, not a stub that cannot
    see a post;
  * no root Daily folder, or one whose name only matches after trimming -> no append (the
    door would CREATE a folder);
  * a library the walk cannot read in full -> no append (absence unproven);
  * the folder name and title are note_daily's, not restated.

The code under test is the tool's own `daily_step`, imported from the file.
"""
from __future__ import annotations

import ast
import datetime as dt
import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
WALK = REPO / "tools" / "notebook_personal_api_walk.py"
sys.path.insert(0, str(REPO))

TODAY = dt.date(2026, 9, 27)
APPEND = "/api/j2/personal/daily/append"


def _load():
    spec = importlib.util.spec_from_file_location("nb_personal_api_walk_under_test", WALK)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def walk():
    return _load()


class _Resp:
    def __init__(self, status, body=None):
        self.status, self._body = status, body if body is not None else {}

    def json(self):
        return self._body


class _Server:
    """bench@'s library as the doors answer it. `notes`: dicts with id, title, folderId,
    and optionally dailyDate / archived. Records every POST."""

    def __init__(self, notes, folders, *, read_fails=()):
        self.notes, self.folders, self.read_fails = notes, folders, set(read_fails)
        self.posts = []

    def get(self, path, params=None):
        params = params or {}
        if path == "/api/j2/note-folders":
            return _Resp(200, {"folders": self.folders})
        if path == "/api/j2/notes":
            archived = params.get("folder_id") == "__archived__"
            rows = [n for n in self.notes if bool(n.get("archived")) == archived]
            off, lim = int(params.get("offset", 0)), int(params.get("limit", 100))
            # ⛔ like _row_to_note_summary: a LIST row carries no dailyDate
            page = [{"id": n["id"], "title": n["title"], "folderId": n.get("folderId")}
                    for n in rows[off:off + lim]]
            return _Resp(200, {"notes": page, "total": len(rows), "limit": lim, "offset": off})
        if path.startswith("/api/j2/notes/"):
            nid = path.rsplit("/", 1)[1]
            if nid in self.read_fails:
                return _Resp(500)
            for n in self.notes:
                if n["id"] == nid:
                    return _Resp(200, {"note": {"id": nid, "title": n["title"],
                                                "folderId": n.get("folderId"),
                                                "dailyDate": n.get("dailyDate")}})
            return _Resp(404)
        return _Resp(404)

    def post(self, path, headers=None, data=None):
        self.posts.append(path)
        if path == APPEND:
            return _Resp(200, {"note": {"id": "made-by-this-run"}, "created": True,
                               "day": TODAY.isoformat()})
        return _Resp(404)


DAILY = {"id": "f-daily", "name": "Daily", "parentId": None}
OTHER = {"id": "f-other", "name": "Trading", "parentId": None}


def _run(walk, server):
    steps, rec = [], {"made": {"note_ids": []}}

    def step(name, result, http=None, **detail):
        steps.append({"step": name, "result": result, "http": http, **detail})
    code = walk.daily_step(server, server, {"Authorization": "Bearer x"}, TODAY, step, rec)
    return code, steps, rec


def test_todays_note_under_another_title_is_found_by_dailyDate_and_not_appended(walk):
    """The review's scenario. (Mutation: gate on the title again -> the append posts.)"""
    server = _Server(
        [{"id": "n-other", "title": "Friday thoughts", "folderId": "f-other"},
         {"id": "n-today", "title": "Renamed by the member", "folderId": "f-other",
          "dailyDate": TODAY.isoformat()}],
        [DAILY, OTHER])
    code, steps, rec = _run(walk, server)
    assert APPEND not in server.posts, "the walk appended into a note it did not make"
    assert steps[-1]["result"] == "NOT RUN" and steps[-1].get("note_id") == "n-today"
    assert rec["made"]["note_ids"] == [] and code == 0


def test_an_archived_daily_note_is_still_todays_and_not_appended(walk):
    server = _Server(
        [{"id": "n-arch", "title": walk.daily_title(TODAY), "folderId": "f-daily",
          "dailyDate": TODAY.isoformat(), "archived": True}],
        [DAILY])
    _code, steps, _rec = _run(walk, server)
    assert APPEND not in server.posts and steps[-1]["result"] == "NOT RUN"


def test_todays_note_past_the_first_page_is_found(walk):
    filler = [{"id": f"n{i}", "title": f"note {i}", "folderId": "f-daily"} for i in range(150)]
    filler.append({"id": "n-late", "title": "whatever", "folderId": "f-daily",
                   "dailyDate": TODAY.isoformat()})
    server = _Server(filler, [DAILY])
    _code, steps, _rec = _run(walk, server)
    assert APPEND not in server.posts and steps[-1].get("note_id") == "n-late"


def test_CONTROL_with_no_note_dated_today_the_walk_does_append(walk):
    """Non-vacuity: the stub can see a post, so the "not appended" rails above are the
    gate talking. A note carrying today's TITLE but no dailyDate is not today's note
    to the server either — the door would make a new one — so the walk appends."""
    server = _Server(
        [{"id": "n-lookalike", "title": walk.daily_title(TODAY), "folderId": "f-daily"},
         {"id": "n-yesterday", "title": "x", "folderId": "f-daily",
          "dailyDate": (TODAY - dt.timedelta(days=1)).isoformat()}],
        [DAILY])
    code, steps, rec = _run(walk, server)
    assert server.posts == [APPEND]
    assert steps[-1]["result"] == "PASS" and code == 0
    assert rec["made"]["note_ids"] == ["made-by-this-run"], "only what this run made is the walk's"


@pytest.mark.parametrize("folders", [[], [OTHER], [{"id": "f-sp", "name": " Daily", "parentId": None}],
                                     [{"id": "f-sub", "name": "Daily", "parentId": "f-other"}, OTHER]])
def test_without_the_doors_own_daily_folder_nothing_is_posted(walk, folders):
    """The door would CREATE a root Daily folder; the walk never creates one."""
    server = _Server([], folders)
    _code, steps, _rec = _run(walk, server)
    assert server.posts == [] and steps[-1]["result"] == "NOT RUN"


def test_a_library_the_walk_cannot_read_in_full_is_not_written_into(walk):
    unreadable = _Server([{"id": "n1", "title": "a", "folderId": "f-daily"}], [DAILY],
                         read_fails={"n1"})
    _c, steps, _r = _run(walk, unreadable)
    assert unreadable.posts == [] and "cannot prove" in steps[-1]["why"]
    too_big = _Server([{"id": f"n{i}", "title": "t", "folderId": "f-daily"}
                       for i in range(walk.DAILY_SCAN_CAP + 5)], [DAILY])
    _c, steps, _r = _run(walk, too_big)
    assert too_big.posts == [] and "cannot prove" in steps[-1]["why"]


def test_the_folder_name_and_title_are_note_dailys_not_restated(walk):
    from api.services.journal_two import note_daily
    assert walk.DAILY_FOLDER_NAME is note_daily.DAILY_FOLDER_NAME
    assert walk.daily_title is note_daily.daily_title
    tree = ast.parse(WALK.read_text(encoding="utf-8"))
    assigned = {t.id for n in ast.walk(tree) if isinstance(n, (ast.Assign, ast.AnnAssign))
                for t in (n.targets if isinstance(n, ast.Assign) else [n.target])
                if isinstance(t, ast.Name)}
    assert "DAILY_FOLDER_NAME" not in assigned, "the folder name is restated in the tool"
    assert "strftime('%A')" not in WALK.read_text(encoding="utf-8"), \
        "a locale weekday is back in the tool"
