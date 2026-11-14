"""RS screens unit U6 (integration), part 1: ONE source for what the client is tested on.

The server half (U4) and the client half (U5) were built in parallel to a written
contract. The client's tests ran on a hand-typed copy of the starters, so a server change
could leave them green and the product wrong. From this unit on the client's fixture
(``app/src/pages/screener/focus/__tests__/rsScreensFixture.js``) READS two files this
suite pins:

  * ``tests/fixtures/rs_screens_starters.json``: the five screens as served (pinned by
    ``tests/test_rs_screens_u4_starters.py``);
  * ``tests/fixtures/rs_screens_served.json``: what is served AROUND the five and the
    client also reads: the seven hidden starters, the Setup label's member-facing words,
    the method page, and the registry entries and views the five use (pinned here).

Refresh both on a deliberate change with ``UPDATE_RS_SCREENS_GOLDEN=1``.

Why each rail exists:
  * the client's editor holds ONE clause per filter key (``shell/useScreenSpec.js``
    ``specToFilters``), so a screen or an option that carried two clauses on one key
    would lose one of them the moment a member opened it, with no error;
  * the client tells options apart by ``op, min, max, value, values`` and nothing else
    (``focus/rsScreens.js`` ``sig``), so a clause that carried any other operand would
    make two different options read as the same one;
  * a ranked screen is ordered by its rank, so the client cannot ask an option's sort of
    it: an option that set a sort there would silently drop the rank instead.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest

from api.services.screener import filters, methodology, rs_screens, rs_setup
from api.services.screener import saved_screens as ss

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
STARTERS_GOLDEN = FIXTURES / "rs_screens_starters.json"
SERVED_GOLDEN = FIXTURES / "rs_screens_served.json"
CLIENT_FIXTURE = ROOT / "app" / "src" / "pages" / "screener" / "focus" / "__tests__" / "rsScreensFixture.js"

FIVE = ("starter_rs_top_rating", "starter_rs_new_high", "starter_rs_nh_before_price",
        "starter_rs_leaders", "starter_rs_exit_warning_5")
#: The operands the client compares, per operator (`focus/rsScreens.js` `sig`).
OPERANDS = {"gte": {"min"}, "gt": {"min"}, "lte": {"max"}, "lt": {"max"},
            "between": {"min", "max"}, "eq": {"value"}, "in": {"values"}, "not_in": {"values"}}


@pytest.fixture
def on(monkeypatch):
    """A pod that serves the screens: RS_V2, the rating history and the screens all on.
    `meta()` measures its range bands off the table; there is none here, so that read
    is stubbed and every entry is the registry's own."""
    from api.services.screener import distribution
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    monkeypatch.setattr(filters, "_rs_history_on", lambda: True)
    monkeypatch.setattr(distribution, "distributions", lambda: {"basis": None})


def _five():
    by = {s["id"]: s for s in ss.starters()}
    return [by[i] for i in FIVE]


def filter_keys(five) -> list:
    """Every filter key the five name, in a spec or in an option, each once, in order."""
    out = []
    for s in five:
        for f in list(s["spec"]["filters"]) + [f for c in s["controls"] for o in c["options"]
                                              for f in o["filters"]]:
            if f["key"] not in out:
                out.append(f["key"])
    return out


def served_meta(five) -> dict:
    """``GET /api/screener/meta`` cut down to what the five need: the registry entry of
    every filter key they name (the client labels chips, the why strip and the Filters
    drawer from these) and the views they open. Read with the RS families armed, as on a
    pod that serves the screens."""
    meta = filters.meta()
    by = {f["key"]: f for f in meta["filters"]}
    keys = filter_keys(five)
    missing = [k for k in keys if k not in by]
    assert not missing, f"the five filter on keys meta() does not serve: {missing}"
    views = {s["spec"]["view"] for s in five}
    return {"filters": [by[k] for k in keys],
            "views": [v for v in meta["views"] if v["key"] in views]}


def served_around_the_five() -> dict:
    """What the client reads beside the five, as the routes serve it."""
    hidden = [s for s in ss.starters() if s.get("hidden")]
    words = rs_setup.SETUP_LABELS
    return {
        "about": ("Captured by tests/test_rs_screens_u6_golden.py (UPDATE_RS_SCREENS_GOLDEN=1 "
                  "rewrites); read by app/src/pages/screener/focus/__tests__/rsScreensFixture.js."),
        # GET /api/screener/saved-screens -> starters[] with hidden: true, in payload order
        "hidden": hidden,
        # the Setup label's words: the Filters drawer and the method page print the
        # server's, the row caption prints the client's own copy (contract section 3)
        "words": {"setup": {k: words[k] for k in rs_setup.SETUPS},
                  "flags": {k: words[k] for k in rs_setup.FLAGS},
                  "tight": words["tight"]},
        # GET /api/screener/methodology -> rs_screens
        "method": methodology.all_methods()["rs_screens"],
        # GET /api/screener/meta, the entries and views the five use
        "meta": served_meta(_five()),
    }


def test_what_is_served_around_the_five_matches_the_golden(on):
    served = served_around_the_five()
    if os.environ.get("UPDATE_RS_SCREENS_GOLDEN") == "1":
        # newline="\n": the fixture is LF in the repository on every platform
        SERVED_GOLDEN.write_text(json.dumps(served, indent=2) + "\n", encoding="utf-8", newline="\n")
    assert json.loads(SERVED_GOLDEN.read_text(encoding="utf-8")) == served
    assert json.loads(json.dumps(served)) == served, "it survives the route's own encoding"
    assert [s["id"] for s in served["hidden"]][0] == "starter_momentum_leaders"
    assert {s["id"] for s in served["hidden"]} == set(rs_screens.RETIRED_IDS)


def test_the_payload_order_the_client_fixture_assumes(on):
    """`rsScreensFixture.js` lays the starters out as the payload does: "Leaders (RS >= 90)"
    among the core starters, then the five together, then the six hidden RS lists."""
    ids = [s["id"] for s in ss.starters()]
    first = ids.index(FIVE[0])
    assert ids[first:first + 5] == list(FIVE)
    assert ids.index("starter_momentum_leaders") < first
    rest = [i for i in rs_screens.RETIRED_IDS if i != "starter_momentum_leaders"]
    assert ids[first + 5:first + 5 + len(rest)] == rest


def test_no_screen_and_no_option_holds_two_clauses_on_one_key(on):
    """The client keeps one clause per key. Two on one key would be one, silently."""
    for s in _five():
        keys = [f["key"] for f in s["spec"]["filters"]]
        assert len(keys) == len(set(keys)), (s["id"], sorted(k for k in keys if keys.count(k) > 1))
        for c in s["controls"]:
            for o in c["options"]:
                okeys = [f["key"] for f in o["filters"]]
                assert len(okeys) == len(set(okeys)), (s["id"], c["id"], o["id"])


def test_every_clause_carries_only_the_operands_the_client_compares(on):
    for s in _five():
        clauses = list(s["spec"]["filters"]) + [f for c in s["controls"] for o in c["options"]
                                               for f in o["filters"]]
        for f in clauses:
            assert f["op"] in OPERANDS, (s["id"], f)
            assert set(f) == {"key", "op"} | OPERANDS[f["op"]], (s["id"], f)
        sorts = [s["spec"].get("sort")] + [o.get("sort") for c in s["controls"] for o in c["options"]]
        for sort in filter(None, sorts):
            assert set(sort) <= {"key", "dir", "then"} and sort["dir"] in ("asc", "desc"), (s["id"], sort)
            if "then" in sort:
                assert set(sort["then"]) == {"key", "dir"} and sort["then"]["dir"] in ("asc", "desc")


def test_a_ranked_screen_has_no_option_that_sets_a_sort(on):
    ranked = [s for s in _five() if s["spec"].get("rank")]
    assert [s["id"] for s in ranked] == ["starter_rs_leaders"]
    for s in ranked:
        assert "sort" not in s["spec"], s["id"]
        assert not [o["id"] for c in s["controls"] for o in c["options"] if "sort" in o], s["id"]


def test_the_client_fixture_reads_these_two_files_and_types_no_starter():
    """The other side of the join. The fixture must name both goldens, and must not grow
    a hand-typed RS starter again (an `id: 'starter_rs_...'` literal object)."""
    src = CLIENT_FIXTURE.read_text(encoding="utf-8")
    assert STARTERS_GOLDEN.name in src and SERVED_GOLDEN.name in src
    assert not re.search(r"\bid:\s*['\"]starter_rs_", src), "an RS starter is typed in the client fixture"
    assert STARTERS_GOLDEN.is_file() and SERVED_GOLDEN.is_file()


# ───────────────────────── the two preferences (part 2) ─────────────────────────

def test_the_two_rs_preferences_are_accepted_declared_and_the_keys_the_client_writes():
    """A quick-control choice and the dismissed first-visit line are stored as account
    preferences. The server refuses a key that is not on its allow list (a choice would
    answer 400 and be forgotten), and the Settings card "What syncs across your devices"
    is drawn from the manifest. Both are read as the manifest's own server rail reads
    them (`tests/test_persistence_manifest_server_keys.py`), never by importing the app."""
    from tests.test_persistence_manifest_server_keys import _manifest, _server_keys
    src = (ROOT / "app" / "src" / "pages" / "screener" / "focus" / "rsScreens.js").read_text(encoding="utf-8")
    client = dict(re.findall(r"export const (RS_CONTROLS_PREF|RS_NOTE_PREF) = '([a-z_]+)'", src))
    assert client == {"RS_CONTROLS_PREF": "screener_rs_controls", "RS_NOTE_PREF": "screener_rs_note_seen"}
    allowed = _server_keys()
    entries = {e["key"]: e for e in _manifest()["entries"]}
    for key in client.values():
        assert key in allowed, f"{key}: the server would refuse this preference with a 400"
        entry = entries.get(key)
        assert entry, f"{key}: not declared in the persistence manifest"
        assert entry["store"] == "server-preference" and entry["scope"] == "cross-device", entry
        assert entry["serverAllowlisted"] is True and entry["surface"] == "Screener", entry
        assert all((ROOT / f).is_file() for f in entry["files"]), entry["files"]
