"""W5 T12 (2026-11-02): the SERVER lanes' admission and flags.

Rails for `api/services/runtime_definitions.py::server_stage / effective_server_stage /
server_permitted / service_missing / server_lane_refusal` and the three ledger rows that
come with them (docs/pine/SERVER-RUNTIME-DESIGN.md sections 3.5, 3.7, 5.1, 9.1: owner
rulings Q4 and Q8).

NOTHING CALLS THESE FUNCTIONS YET (T13 onward wire the lanes to them), so no member's
behaviour changes. What this file holds, each with the mutation that proves it can fail:

  A. THE LADDER. `PINE_RUNTIME_SERVER_STAGE` takes off | admins | cohort | all; unset, empty
     or any other value reads OFF (a typo can never open a server lane); it is read on EVERY
     call; it is the pane's ladder, derived from the pane's vocabulary, not retyped.
  B. THE SERVER STAGE NEVER EXCEEDS THE PANE STAGE (ruling Q4). The effective stage is
     min(pane, server) over the whole 4 x 4 grid, and for every kind of owner the server
     answer is the audience of that lower stage. `server_permitted` CALLS `pane_permitted`
     (a patched pane answer reaches it), so the guarantee holds by construction.
  C. THE ADMISSION CHAIN (design 3.5), one rail per step and the FIRST refusal wins:
     kill list, GRADED allowlist (ruling Q8: the pane's own authority, never a copy; the
     operator variable PINE_RUNTIME_ALLOWLIST admits on the pane only, never on a server lane),
     pane stage, server stage, service set up. A kill reaches the NEXT call and deletes
     nothing. The owner is read from the row and resolved at evaluation time, every call.
  D. THE LEDGER. One mode row in `flags`, two knob rows (address, secret) in `knobs`; the
     secret row records no value; the names the code reads are the names the ledger holds.
"""
from __future__ import annotations

import copy
import inspect
import json
import os
import shutil
from pathlib import Path

import pytest

from api.services import auth_db
from api.services import feature_flag_index as ffi
from api.services import rollout
from api.services import rollout_gate as rg
from api.services import runtime_definitions as rt

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / "docs" / "feature_flags.json"
FIXTURE = ROOT / "tests" / "fixtures" / "runtime_documents" / "documents.json"
DOCS = {d["slug"]: d for d in json.loads(FIXTURE.read_text(encoding="utf-8"))["documents"]}
ADX = DOCS["adx-and-di-for-v4"]["definition"]                  # the committed allowlist's one script
DELTA = DOCS["delta-rsi-oscillator-strategy"]["definition"]    # a real script that is NOT on it
ADX_SOURCE = ADX["compute"]["source"]

ADMIN_ID, TAGGED_ID, UNTAGGED_ID = "t12-admin-1", "t12-tagged-1", "t12-untagged-1"
URL = "http://pine-runtime.railway.internal:8080"
SECRET = "t12-secret-DO-NOT-LEAK-0123456789abcdef"

KILLED, UNGRADED = "runtime:killed", "runtime:not-yet-graded"
STAGE, SERVER_STAGE = "runtime:stage", "runtime:server-stage"
UNAVAILABLE, NOT_RUNTIME = "runtime:server-unavailable", "runtime:not-runtime"

STAGE_VALUES = ("off", "admins", "cohort", "all")
RANK = {"off": 0, "admins": 1, "cohort": 2, "all": 3}          # typed here on purpose: an oracle

_ENVS = (rt.STAGE_ENV, rt.SERVER_STAGE_ENV, rt.KILL_ENV, rt.ALLOW_ENV,
         rt.SERVICE_URL_ENV, rt.SERVICE_SECRET_ENV)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in _ENVS:
        monkeypatch.delenv(k, raising=False)


@pytest.fixture
def auth_store(tmp_path, monkeypatch):
    """A per-test `auth.db` from the PRODUCT'S `init_db()`: an admin, a member tagged into the
    runtime pane's cohort by the PRODUCT'S writer, and a member who is not."""
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    monkeypatch.setattr(auth_db, "_DB_PATH", str(path))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    auth_db.init_db()
    conn = auth_db.get_connection()
    try:
        for uid in (ADMIN_ID, TAGGED_ID, UNTAGGED_ID):
            conn.execute("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?,?,?)",
                         (uid, uid + "@example.test", "x"))
        conn.execute("UPDATE users SET role='admin' WHERE id=?", (ADMIN_ID,))
        conn.commit()
    finally:
        conn.close()
    rollout.assign_cohort(rg.PINE_RUNTIME_COHORT, [TAGGED_ID])
    assert rollout.includes(TAGGED_ID, rg.PINE_RUNTIME_COHORT) is True
    return path


@pytest.fixture
def owners(monkeypatch):
    """The owner and cohort lookups as FAKES of the product's two stores (a role per id; a set of
    tagged ids), so the chain's own logic is driven fast. The REAL stores are driven by the
    `auth_store` rails: the cohort tag, the owner through the store, the role read on every call."""
    from api.services import auth_service
    roles = {ADMIN_ID: "admin", TAGGED_ID: "member", UNTAGGED_ID: "member"}
    monkeypatch.setattr(auth_service, "get_user_by_id",
                        lambda user_id: {"id": user_id, "role": roles[user_id]} if user_id in roles else None)
    monkeypatch.setattr(rollout, "includes",
                        lambda user_id, cohort: cohort == rg.PINE_RUNTIME_COHORT and user_id == TAGGED_ID)
    return roles


def _set_role(user_id, role):
    conn = auth_db.get_connection()
    try:
        conn.execute("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?,?,?)",
                     (user_id, user_id + "@example.test", "x"))
        conn.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))
        conn.commit()
    finally:
        conn.close()


def _row(defn, owner=UNTAGGED_ID):
    return {"user_id": owner, "def_id": defn["id"], "version": 1,
            "definition": copy.deepcopy(defn)}


def _arm(monkeypatch, *, pane="all", server="all", url=URL, secret=SECRET):
    """Every condition the chain asks, satisfied; a caller breaks the one it is testing."""
    monkeypatch.setenv(rt.STAGE_ENV, pane)
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, server)
    for env, value in ((rt.SERVICE_URL_ENV, url), (rt.SERVICE_SECRET_ENV, secret)):
        if value is None:                         # None means UNSET, every time, whatever came before
            monkeypatch.delenv(env, raising=False)
        else:
            monkeypatch.setenv(env, value)


def _ledger() -> dict:
    return json.loads(LEDGER.read_text(encoding="utf-8"))


def _expected_stage(raw: str) -> str:
    """The ladder as an oracle: the recognised words, case- and space-insensitive; all else off."""
    word = raw.strip().lower()
    return word if word in RANK else "off"


def _audience(stage: str, role, tagged: bool) -> bool:
    """WHO a stage reaches, as an oracle independent of the code under test."""
    return {"off": False, "admins": role == "admin",
            "cohort": role == "admin" or tagged, "all": True}[stage]


RAW_VALUES = ["", "  ", "off", "admins", "cohort", "all", "ALL ", " Admins", "COHORT", "admin",
              "everyone", "1", "true", "on", "cohorts", "Cohort-ish", "all,admins", "none", "0"]


# =====================================================================================
# A. THE LADDER
# =====================================================================================

def test_T12_A_unset_reads_off():
    assert rt.server_stage() == "off"


@pytest.mark.parametrize("raw", RAW_VALUES)
def test_T12_A_a_typo_or_an_unknown_value_reads_OFF_never_the_opposite(monkeypatch, raw):
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, raw)
    assert rt.server_stage() == _expected_stage(raw)


@pytest.mark.parametrize("raw", RAW_VALUES)
def test_T12_A_the_server_ladder_IS_the_panes_ladder(monkeypatch, raw):
    """One vocabulary, one parse: the same raw string reads the same stage under either
    variable, so neither reader can drift from the other."""
    monkeypatch.setenv(rt.STAGE_ENV, raw)
    pane = rt.stage()
    monkeypatch.delenv(rt.STAGE_ENV)
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, raw)
    assert rt.server_stage() == pane


def test_T12_A_the_server_stage_is_read_PER_CALL(monkeypatch):
    """Same process, same imported module, no reload: a module-level capture or a cache
    would make "lower it and it stops" a fiction."""
    seen = []
    for v in ("admins", "all", "off", "cohort", "bogus", "all"):
        monkeypatch.setenv(rt.SERVER_STAGE_ENV, v)
        seen.append(rt.server_stage())
    assert seen == ["admins", "all", "off", "cohort", "off", "all"]
    monkeypatch.delenv(rt.SERVER_STAGE_ENV)
    assert rt.server_stage() == "off"


def test_T12_A_the_default_and_the_vocabulary_are_pinned_in_SOURCE(tmp_path):
    assert rt.SERVER_STAGE_ENV == "PINE_RUNTIME_SERVER_STAGE"
    assert rt.STAGES == ("off", "admins", "cohort", "all")
    assert rt.PINE_RUNTIME_MODE_FLAGS["PINE_RUNTIME_SERVER_STAGE"] == (
        "off", ("off", "admins", "cohort", "all"))
    src_path = ROOT / "api" / "services" / "runtime_definitions.py"
    assert "os.environ.get(SERVER_STAGE_ENV, STAGE_OFF)" in src_path.read_text(encoding="utf-8")
    # ...and the mode-flag index derives it from that module, so the ledger can hold it to a decision
    copy_dir = tmp_path / "idx"
    copy_dir.mkdir()
    shutil.copy(src_path, copy_dir / "runtime_definitions.py")
    found = ffi.mode_flags([copy_dir], copy_dir)
    assert found["PINE_RUNTIME_SERVER_STAGE"]["default"] == "off"
    assert set(found["PINE_RUNTIME_SERVER_STAGE"]["allowed"]) == set(STAGE_VALUES)
    assert found["PINE_RUNTIME_STAGE"]["default"] == "off"        # the pane's entry is still there


def test_T12_A_the_ledger_row_is_the_code_vocabulary_both_ways():
    led = _ledger()["flags"]["PINE_RUNTIME_SERVER_STAGE"]
    code_default, code_values = rt.PINE_RUNTIME_MODE_FLAGS["PINE_RUNTIME_SERVER_STAGE"]
    assert led["default"] == code_default == "off"
    assert tuple(led["values"]) == code_values == rt.STAGES
    assert led["status"] == "dark" and led["where"] == []
    assert "min(pane stage, server stage)" in led["note"] and len(led["note"]) > 400


# =====================================================================================
# B. THE SERVER STAGE NEVER EXCEEDS THE PANE STAGE (ruling Q4)
# =====================================================================================

@pytest.mark.parametrize("pane", STAGE_VALUES)
@pytest.mark.parametrize("server", STAGE_VALUES)
def test_T12_B_the_effective_stage_is_the_LOWER_of_the_two(monkeypatch, pane, server):
    monkeypatch.setenv(rt.STAGE_ENV, pane)
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, server)
    eff = rt.effective_server_stage()
    assert eff == (pane if RANK[pane] <= RANK[server] else server)
    assert RANK[eff] <= RANK[pane] and RANK[eff] <= RANK[server]


def test_T12_B_an_unset_pane_caps_the_server_at_off(monkeypatch):
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, "all")          # the pane variable is unset: off
    assert rt.effective_server_stage() == "off"


OWNERS = [  # (label, role, user_id, tagged into the cohort)
    ("admin", "admin", ADMIN_ID, False),
    ("tagged-member", "member", TAGGED_ID, True),
    ("untagged-member", "member", UNTAGGED_ID, False),
    ("member-without-an-id", "member", None, False),
    ("no-role-no-id", None, None, False),
    ("no-role-but-a-tagged-id", None, TAGGED_ID, True),
]


@pytest.mark.parametrize("pane", STAGE_VALUES)
@pytest.mark.parametrize("server", STAGE_VALUES)
@pytest.mark.parametrize("label,role,uid,tagged", OWNERS)
def test_T12_B_server_permitted_is_the_audience_of_the_LOWER_stage_and_never_above_the_pane(
        monkeypatch, pane, server, label, role, uid, tagged):
    """The whole 4 x 4 grid, for every kind of owner. The cohort is a fake of the product's
    store here (a set of ids), so the grid is fast; the product's own store is driven below."""
    monkeypatch.setenv(rt.STAGE_ENV, pane)
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, server)
    monkeypatch.setattr(rollout, "includes",
                        lambda user_id, cohort: cohort == rg.PINE_RUNTIME_COHORT
                        and user_id == TAGGED_ID)
    lower = pane if RANK[pane] <= RANK[server] else server
    got = rt.server_permitted(role, uid)
    assert got is _audience(lower, role, tagged), (label, pane, server, got)
    if got:
        assert rt.pane_permitted(role, uid) is True           # never reaches a member the chart cannot
    assert rt.pane_permitted(role, uid) is _audience(pane, role, tagged)   # the oracle agrees with the pane


def test_T12_B_the_named_cases(monkeypatch):
    def at(pane, server, role, uid=None):
        monkeypatch.setenv(rt.STAGE_ENV, pane)
        monkeypatch.setenv(rt.SERVER_STAGE_ENV, server)
        return rt.server_permitted(role, uid)

    assert at("admins", "all", "admin") is True and at("admins", "all", "member") is False
    assert at("all", "admins", "admin") is True and at("all", "admins", "member") is False
    assert at("off", "all", "admin") is False                 # a server lane never outruns a dark pane
    assert at("all", "off", "admin") is False                 # and the server stage alone can kill it
    assert at("all", "all", "member") is True                 # control: both open reaches everyone
    assert at("all", "all", None) is True


def test_T12_B_the_pane_authority_is_CALLED_not_copied(monkeypatch):
    _arm(monkeypatch)
    monkeypatch.setattr(rt, "pane_permitted", lambda role, user_id=None: False)
    assert rt.server_permitted("admin", ADMIN_ID) is False    # the chart cannot draw it, so nor can a lane
    monkeypatch.setattr(rt, "pane_permitted", lambda role, user_id=None: True)
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, "off")
    assert rt.server_permitted("admin", ADMIN_ID) is False    # and the server stage is its own gate
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, "all")
    assert rt.server_permitted("admin", ADMIN_ID) is True     # control: both true, so true


@pytest.mark.parametrize("server", ["off", "admins", "all", "cohorts", ""])
def test_T12_B_the_SERVER_stage_is_the_cohort_kill_switch_and_is_read_FIRST(monkeypatch, server):
    """Pane at `all` reads no tag at all, so any tag read here is the SERVER cohort's. At any
    server stage but `cohort` there is none (a spy: a fail-closed answer cannot prove order, so
    this spy answers TRUE and a read that did happen could not hide behind a refusal)."""
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, server)
    calls = []
    monkeypatch.setattr(rollout, "includes", lambda *a, **k: calls.append(a) or True)
    got = rt.server_permitted("member", TAGGED_ID)
    assert calls == []
    assert got is (server == "all")


def test_T12_B_the_cohort_tag_IS_read_at_the_server_cohort_stage(auth_store, monkeypatch):
    """Control for the spy above, through the product's own store."""
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, "cohort")
    calls = []
    real = rollout.includes
    monkeypatch.setattr(rollout, "includes", lambda *a, **k: calls.append(a) or real(*a, **k))
    assert rt.server_permitted("member", TAGGED_ID) is True
    assert calls == [(TAGGED_ID, rg.PINE_RUNTIME_COHORT)]
    assert rt.server_permitted("member", UNTAGGED_ID) is False
    assert rt.server_permitted("admin", UNTAGGED_ID) is True
    assert rt.server_permitted("member", None) is False       # no id = outside the cohort


def test_T12_B_stepping_the_server_stage_back_WITHDRAWS_without_touching_a_tag(auth_store, monkeypatch):
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, "cohort")
    assert rt.server_permitted("member", TAGGED_ID) is True
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, "admins")
    assert rt.server_permitted("member", TAGGED_ID) is False
    assert rollout.includes(TAGGED_ID, rg.PINE_RUNTIME_COHORT) is True    # the tag is still there
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, "cohort")
    assert rt.server_permitted("member", TAGGED_ID) is True               # and it comes back


# =====================================================================================
# C. THE ADMISSION CHAIN (design 3.5)
# =====================================================================================

def test_T12_C_the_signature_is_the_designs():
    params = list(inspect.signature(rt.server_lane_refusal).parameters.values())
    assert [p.name for p in params] == ["row", "lane"]
    assert params[1].kind is inspect.Parameter.KEYWORD_ONLY and params[1].default is params[1].empty


def test_T12_C_everything_on_admits_the_graded_script(owners, monkeypatch):
    _arm(monkeypatch)
    assert rt.server_lane_refusal(_row(ADX), lane="alert") is None


def _break_kill(m):
    m.setenv(rt.KILL_ENV, ADX["id"])


def _break_graded(m):
    pass                                  # the row is DELTA: a real script that is not on the allowlist


def _break_pane(m):
    m.setenv(rt.STAGE_ENV, "admins")


def _break_server(m):
    m.setenv(rt.SERVER_STAGE_ENV, "admins")


def _break_service(m):
    m.delenv(rt.SERVICE_URL_ENV)


# (step, guard, row, how to break exactly this step on an otherwise fully armed world)
ONLY_THIS_STEP = [
    (1, KILLED, ADX, _break_kill),
    (2, UNGRADED, DELTA, _break_graded),
    (3, STAGE, ADX, _break_pane),
    (4, SERVER_STAGE, ADX, _break_server),
    (5, UNAVAILABLE, ADX, _break_service),
]


@pytest.mark.parametrize("step,guard,defn,breaker", ONLY_THIS_STEP,
                         ids=[f"step{s[0]}-{s[1]}" for s in ONLY_THIS_STEP])
def test_T12_C_each_step_refuses_BY_NAME_when_it_alone_fails(owners, monkeypatch, step, guard, defn, breaker):
    _arm(monkeypatch)
    assert rt.server_lane_refusal(_row(defn if defn is not DELTA else ADX), lane="alert") is None, \
        "control: the armed world admits the graded script"
    breaker(monkeypatch)
    got = rt.server_lane_refusal(_row(defn), lane="alert")
    assert got is not None and got[0] == guard, (step, got)
    assert isinstance(got[1], str) and got[1]


def _world_failing_from(m, step):
    """Steps below `step` pass; `step` and EVERY later step fail. Returns the row to ask about."""
    ungraded_from = 2
    row = DELTA if step <= ungraded_from else ADX
    _arm(m, pane="all" if step > 3 else "admins", server="all" if step > 4 else "admins",
         url=URL if step > 5 else None, secret=SECRET if step > 5 else None)
    if step == 1:
        m.setenv(rt.KILL_ENV, row["id"])
    return row


@pytest.mark.parametrize("step,guard", [(1, KILLED), (2, UNGRADED), (3, STAGE), (4, SERVER_STAGE),
                                        (5, UNAVAILABLE)])
def test_T12_C_the_FIRST_refusal_wins_when_every_later_step_fails_too(owners, monkeypatch, step, guard):
    row = _world_failing_from(monkeypatch, step)
    got = rt.server_lane_refusal(_row(row), lane="sweep")
    assert got is not None and got[0] == guard, (step, got)


def test_T12_C_steps_1_and_2_return_the_charts_own_sentence_VERBATIM(owners, monkeypatch):
    _arm(monkeypatch)
    monkeypatch.setenv(rt.KILL_ENV, ADX["id"])
    assert rt.server_lane_refusal(_row(ADX), lane="alert") == (KILLED, rt.killed(ADX["id"], ADX_SOURCE))
    monkeypatch.delenv(rt.KILL_ENV)
    assert rt.server_lane_refusal(_row(DELTA), lane="alert") == (
        UNGRADED, rt.not_graded(DELTA["compute"]["source"], graded_only=True))


def test_T12_C_the_sentences_name_the_variable_and_the_lane_and_never_a_value(owners, monkeypatch):
    _arm(monkeypatch, pane="admins", server="admins", url=None, secret=None)
    stage_sentence = rt.server_lane_refusal(_row(ADX), lane="alert")[1]
    assert "PINE_RUNTIME_STAGE=admins" in stage_sentence and "(alert lane)" in stage_sentence
    _arm(monkeypatch, pane="all", server="admins", url=None, secret=None)
    server_sentence = rt.server_lane_refusal(_row(ADX), lane="sweep")[1]
    assert "PINE_RUNTIME_SERVER_STAGE=admins" in server_sentence and "PINE_RUNTIME_STAGE=all" in server_sentence
    assert "effective stage admins" in server_sentence
    assert "(sweep lane)" in server_sentence
    _arm(monkeypatch, pane="all", server="all", url=None, secret=SECRET)
    only_url = rt.server_lane_refusal(_row(ADX), lane="backtest")[1]
    assert "PINE_RUNTIME_SERVICE_URL not set" in only_url and "PINE_RUNTIME_SERVICE_SECRET" not in only_url
    _arm(monkeypatch, pane="all", server="all", url=URL, secret=None)
    only_secret = rt.server_lane_refusal(_row(ADX), lane="record")[1]
    assert "PINE_RUNTIME_SERVICE_SECRET not set" in only_secret and "PINE_RUNTIME_SERVICE_URL" not in only_secret
    monkeypatch.delenv(rt.SERVICE_URL_ENV)
    both = rt.server_lane_refusal(_row(ADX), lane="on-demand")[1]
    assert "PINE_RUNTIME_SERVICE_URL and PINE_RUNTIME_SERVICE_SECRET not set" in both
    # a value is never echoed: not the secret, not the address, whatever fails
    _arm(monkeypatch, pane="all", server="admins", url=URL, secret=SECRET)
    monkeypatch.setenv(rt.KILL_ENV, "")
    for sentence in (stage_sentence, server_sentence, only_url, only_secret, both,
                     rt.server_lane_refusal(_row(ADX), lane="alert")[1]):
        assert SECRET not in sentence and URL not in sentence


@pytest.mark.parametrize("lane", ["alert", "on-demand", "backtest", "sweep", "record"])
def test_T12_C_the_lane_changes_the_words_never_the_guard(owners, monkeypatch, lane):
    _arm(monkeypatch, server="off")
    guard, sentence = rt.server_lane_refusal(_row(ADX), lane=lane)
    assert guard == SERVER_STAGE and f"({lane} lane)" in sentence


@pytest.mark.parametrize("lane", ["", "   ", None, 5, "  sweep "])
def test_T12_C_an_odd_lane_never_raises_and_never_changes_the_guard(owners, monkeypatch, lane):
    _arm(monkeypatch, server="off")
    guard, sentence = rt.server_lane_refusal(_row(ADX), lane=lane)
    assert guard == SERVER_STAGE
    assert ("(sweep lane)" if lane == "  sweep " else "(server lane)") in sentence


# --- the kill list: it reaches the NEXT call, and nothing is deleted ---------------------

def test_T12_C_a_kill_reaches_the_NEXT_call_and_unlisting_brings_it_back(owners, monkeypatch):
    _arm(monkeypatch)
    row = _row(ADX)
    before = copy.deepcopy(row)
    assert rt.server_lane_refusal(row, lane="alert") is None
    monkeypatch.setenv(rt.KILL_ENV, ADX["id"])                              # by definition id
    assert rt.server_lane_refusal(row, lane="alert")[0] == KILLED
    monkeypatch.setenv(rt.KILL_ENV, rt.source_hash(ADX_SOURCE)[:16])        # by a source-hash prefix
    assert rt.server_lane_refusal(row, lane="alert")[0] == KILLED
    monkeypatch.setenv(rt.KILL_ENV, rt.source_hash(ADX_SOURCE))             # by the full hash
    assert rt.server_lane_refusal(row, lane="alert")[0] == KILLED
    monkeypatch.setenv(rt.KILL_ENV, "u_00000000beef")                       # a different script
    assert rt.server_lane_refusal(row, lane="alert") is None
    monkeypatch.setenv(rt.KILL_ENV, ADX["id"])
    assert rt.server_lane_refusal(row, lane="alert")[0] == KILLED
    monkeypatch.delenv(rt.KILL_ENV)                                         # unlisted: it is back
    assert rt.server_lane_refusal(row, lane="alert") is None
    assert row == before                                                    # nothing rewritten


def test_T12_C_a_kill_beats_the_allowlist_and_every_other_step(owners, monkeypatch):
    _arm(monkeypatch, pane="off", server="off", url=None, secret=None)
    monkeypatch.setenv(rt.KILL_ENV, ADX["id"])
    assert rt.server_lane_refusal(_row(ADX), lane="alert")[0] == KILLED      # allowlisted AND killed


# --- the allowlist / graded gate (ruling Q8): the pane's authority, never a copy ----------

def test_T12_C_only_an_allowlisted_graded_script_is_admitted(owners, monkeypatch):
    _arm(monkeypatch)
    assert rt.server_lane_refusal(_row(ADX), lane="sweep") is None
    guard, sentence = rt.server_lane_refusal(_row(DELTA), lane="sweep")
    assert guard == UNGRADED and "has not yet been graded against TradingView" in sentence


def _allowlist_copy(tmp_path, mutate=None):
    doc = json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    if mutate:
        mutate(doc)
    f = tmp_path / "allow.json"
    f.write_text(json.dumps(doc), encoding="utf-8")
    return str(f)


def test_T12_C_the_allowlist_copy_mechanism_admits_when_nothing_is_broken(owners, monkeypatch, tmp_path):
    """Control for the four refusals below: an UNMUTATED copy of the committed file admits."""
    _arm(monkeypatch)
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", _allowlist_copy(tmp_path))
    assert rt.server_lane_refusal(_row(ADX), lane="alert") is None


@pytest.mark.parametrize("name,mutate", [
    ("no capture at all", lambda d: d["scripts"][0].update(captures=[])),
    ("no capture graded MATCH", lambda d: [c.update(verdict="DIVERGE") for c in d["scripts"][0]["captures"]]),
    ("no capture graded with the pane on",
     lambda d: [c.update(runtimePane="off") for c in d["scripts"][0]["captures"]]),
    ("a capability left ungraded", lambda d: d["capabilities"]["ternary"].update(status="ungraded")),
])
def test_T12_C_a_script_LISTED_but_not_MATCH_graded_is_refused_by_name(
        owners, monkeypatch, tmp_path, name, mutate):
    _arm(monkeypatch)
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", _allowlist_copy(tmp_path, mutate))
    assert rt.server_lane_refusal(_row(ADX), lane="alert")[0] == UNGRADED, name


def test_T12_C_one_MATCH_capture_is_enough_exactly_as_for_the_pane(owners, monkeypatch, tmp_path):
    """The lane asks no more and no less than the pane (R1: AT LEAST ONE MATCH capture with the
    pane on). The committed script names two; losing one of them changes nothing."""
    captures = json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))["scripts"][0]["captures"]
    assert len(captures) >= 2, "this control needs a script with two captures"
    _arm(monkeypatch)
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", _allowlist_copy(
        tmp_path, lambda d: d["scripts"][0]["captures"][0].update(verdict="DIVERGE")))
    assert rt.not_graded(ADX_SOURCE) is None                          # the pane still serves it
    assert rt.server_lane_refusal(_row(ADX), lane="alert") is None    # and so does the lane


def test_T12_C_an_EMPTY_or_missing_allowlist_serves_NOTHING(owners, monkeypatch, tmp_path):
    _arm(monkeypatch)
    empty = tmp_path / "empty.json"
    empty.write_text('{"scripts": []}', encoding="utf-8")
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(empty))
    assert rt.server_lane_refusal(_row(ADX), lane="alert")[0] == UNGRADED
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(tmp_path / "missing.json"))
    assert rt.server_lane_refusal(_row(ADX), lane="alert")[0] == UNGRADED


def test_T12_C_the_server_lane_and_the_pane_agree_on_every_document(owners, monkeypatch, tmp_path):
    """One authority: for each real document, under three allowlist states, the lane says
    "not graded" exactly when the pane's own `not_graded` does, asked for the graded list (the
    lane's question). The operator variable is the one place they differ: see the Q8 rails."""
    _arm(monkeypatch)
    states = [("committed", None, None),
              ("operator override admits DELTA", None, rt.source_hash(DELTA["compute"]["source"])),
              ("empty", str(tmp_path / "missing.json"), None)]
    for label, path, override in states:
        with monkeypatch.context() as m:
            if path:
                m.setattr(rt, "ALLOWLIST_PATH", path)
            if override:
                m.setenv(rt.ALLOW_ENV, override)
            for slug, doc in DOCS.items():
                defn = doc["definition"]
                got = rt.server_lane_refusal(_row(defn), lane="alert")
                graded_says = rt.not_graded(defn["compute"]["source"], graded_only=True)
                assert (got is not None and got[0] == UNGRADED) is (graded_says is not None), (label, slug)
                if label.startswith("operator"):
                    pane_says = rt.not_graded(defn["compute"]["source"])
                    assert (pane_says is None) is (graded_says is None or slug == "delta-rsi-oscillator-strategy")


# --- ruling Q8 (coordinator, 2026-11-02): the server lanes admit the GRADED list only ---------

DELTA_HASH = rt.source_hash(DELTA["compute"]["source"])


@pytest.mark.parametrize("entry", [DELTA_HASH, DELTA_HASH[:12], "  " + DELTA_HASH.upper() + "  "],
                         ids=["full-hash", "12-hex-prefix", "padded-upper-case"])
def test_T12_Q8_a_hash_only_in_the_operator_variable_is_REFUSED_on_every_server_lane(owners, monkeypatch, entry):
    _arm(monkeypatch)
    assert rt.server_lane_refusal(_row(DELTA), lane="alert")[0] == UNGRADED          # control
    monkeypatch.setenv(rt.ALLOW_ENV, entry)
    for lane in ("alert", "on-demand", "backtest", "sweep", "record"):
        got = rt.server_lane_refusal(_row(DELTA), lane=lane)
        assert got is not None and got[0] == UNGRADED, (lane, got)
    assert rt.server_lane_refusal(_row(ADX), lane="alert") is None                  # graded one unaffected


def test_T12_Q8_the_same_hash_is_still_ALLOWED_on_the_browser_pane(owners, monkeypatch):
    """The variable keeps working for the pane: only the server question changed."""
    monkeypatch.setenv(rt.ALLOW_ENV, DELTA_HASH)
    assert rt.not_graded(DELTA["compute"]["source"]) is None
    assert DELTA_HASH in rt.allow_list()
    assert rt.not_graded(DELTA["compute"]["source"], graded_only=True) is not None
    assert DELTA_HASH not in rt.graded_allow_list()
    assert DELTA_HASH in rt.allow_report()["env_overrides"]


def test_T12_Q8_the_graded_list_is_the_served_half_of_allow_report_and_allow_list_builds_on_it(monkeypatch, tmp_path):
    served = [r["sha256"] for r in rt.allow_report()["served"]]
    assert served and rt.graded_allow_list() == served
    assert rt.allow_list() == served                                  # no variable: the same list
    monkeypatch.setenv(rt.ALLOW_ENV, DELTA_HASH)
    assert rt.graded_allow_list() == served                           # the variable never joins it
    assert rt.allow_list() == served + [DELTA_HASH]                   # it joins the pane's list only
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(tmp_path / "missing.json"))
    assert rt.graded_allow_list() == []                               # unreadable JSON: fail closed
    assert rt.allow_list() == [DELTA_HASH]


def test_T12_Q8_the_flag_is_keyword_only_and_defaults_to_the_panes_question():
    p = inspect.signature(rt.not_graded).parameters["graded_only"]
    assert p.kind is inspect.Parameter.KEYWORD_ONLY and p.default is False


def test_T12_Q8_the_ledger_row_says_the_variable_is_pane_only():
    row = _ledger()["knobs"]["PINE_RUNTIME_ALLOWLIST"]
    assert "admits on the browser pane only" in row["note"] and "refused on a server lane" in row["note"]
    assert "never admits on a server lane" in row["owner_decision"]


def test_T12_C_each_step_CALLS_the_authority_it_names(owners, monkeypatch):
    """Patch the pane's own function and the lane's answer moves: nothing here is a copy."""
    _arm(monkeypatch)
    row = _row(ADX)
    with monkeypatch.context() as m:
        m.setattr(rt, "killed", lambda def_id, source: "patched kill")
        assert rt.server_lane_refusal(row, lane="alert") == (KILLED, "patched kill")
    with monkeypatch.context() as m:
        m.setattr(rt, "not_graded", lambda source, **kw: "patched ungraded")
        assert rt.server_lane_refusal(row, lane="alert") == (UNGRADED, "patched ungraded")
    with monkeypatch.context() as m:       # and the graded list itself is read, not copied
        m.setattr(rt, "graded_allow_list", lambda: [rt.source_hash(DELTA["compute"]["source"])])
        assert rt.server_lane_refusal(_row(DELTA), lane="alert") is None
    with monkeypatch.context() as m:
        m.setattr(rt, "pane_permitted", lambda role, user_id=None: False)
        assert rt.server_lane_refusal(row, lane="alert")[0] == STAGE
    with monkeypatch.context() as m:
        m.setattr(rt, "server_permitted", lambda role, user_id=None: False)
        assert rt.server_lane_refusal(row, lane="alert")[0] == SERVER_STAGE
    with monkeypatch.context() as m:
        m.setattr(rt, "service_missing", lambda: ["SOMETHING"])
        assert rt.server_lane_refusal(row, lane="alert")[0] == UNAVAILABLE
    assert rt.server_lane_refusal(row, lane="alert") is None               # control: unpatched admits


# --- the stages, asked of the OWNER ----------------------------------------------------

def test_T12_C_a_typo_in_the_server_stage_refuses_by_name_even_for_an_admin(owners, monkeypatch):
    for typo in ("admin", "everyone", "ALLL", "1", ""):
        _arm(monkeypatch, pane="all", server=typo)
        got = rt.server_lane_refusal(_row(ADX, owner=ADMIN_ID), lane="alert")
        assert got is not None and got[0] == SERVER_STAGE, typo
    monkeypatch.delenv(rt.SERVER_STAGE_ENV)                                  # unset = off, too
    assert rt.server_lane_refusal(_row(ADX, owner=ADMIN_ID), lane="alert")[0] == SERVER_STAGE


def test_T12_C_the_OWNER_decides_through_the_products_own_store(auth_store, monkeypatch):
    _arm(monkeypatch, pane="admins", server="admins")
    assert rt.server_lane_refusal(_row(ADX, owner=ADMIN_ID), lane="alert") is None
    assert rt.server_lane_refusal(_row(ADX, owner=UNTAGGED_ID), lane="alert")[0] == STAGE
    assert rt.server_lane_refusal(_row(ADX, owner=TAGGED_ID), lane="alert")[0] == STAGE   # a tag counts at cohort only
    assert rt.server_lane_refusal(_row(ADX, owner="t12-nobody"), lane="alert")[0] == STAGE
    no_owner = _row(ADX)
    del no_owner["user_id"]
    assert rt.server_lane_refusal(no_owner, lane="alert")[0] == STAGE
    _arm(monkeypatch, pane="cohort", server="cohort")
    assert rt.server_lane_refusal(_row(ADX, owner=ADMIN_ID), lane="alert") is None
    assert rt.server_lane_refusal(_row(ADX, owner=TAGGED_ID), lane="alert") is None
    assert rt.server_lane_refusal(_row(ADX, owner=UNTAGGED_ID), lane="alert")[0] == STAGE
    _arm(monkeypatch, pane="all", server="cohort")
    assert rt.server_lane_refusal(_row(ADX, owner=TAGGED_ID), lane="alert") is None
    assert rt.server_lane_refusal(_row(ADX, owner=UNTAGGED_ID), lane="alert")[0] == SERVER_STAGE
    _arm(monkeypatch, pane="cohort", server="all")
    assert rt.server_lane_refusal(_row(ADX, owner=UNTAGGED_ID), lane="alert")[0] == STAGE


def test_T12_C_the_owners_role_is_read_on_EVERY_call(auth_store, monkeypatch):
    _arm(monkeypatch, pane="admins", server="admins")
    row = _row(ADX, owner="t12-flip-1")
    _set_role("t12-flip-1", "member")
    assert rt.server_lane_refusal(row, lane="alert")[0] == STAGE
    _set_role("t12-flip-1", "admin")
    assert rt.server_lane_refusal(row, lane="alert") is None                 # promoted: the next call
    _set_role("t12-flip-1", "member")
    assert rt.server_lane_refusal(row, lane="alert")[0] == STAGE             # demoted: the next call


def test_T12_C_an_unreadable_owner_is_a_MEMBER_never_an_admin(owners, monkeypatch):
    from api.services import auth_service

    def boom(user_id):
        raise RuntimeError("auth.db is unreadable")

    monkeypatch.setattr(auth_service, "get_user_by_id", boom)
    _arm(monkeypatch, pane="admins", server="admins")
    assert rt.server_lane_refusal(_row(ADX, owner=ADMIN_ID), lane="alert")[0] == STAGE
    _arm(monkeypatch, pane="all", server="all")                              # the role cannot matter here
    assert rt.server_lane_refusal(_row(ADX, owner=ADMIN_ID), lane="alert") is None
    for odd in (None, [], {"role": 5}, {"role": None}, "admin"):             # odd answers are a member's too
        monkeypatch.setattr(auth_service, "get_user_by_id", lambda user_id, _odd=odd: _odd)
        _arm(monkeypatch, pane="admins", server="admins")
        assert rt.server_lane_refusal(_row(ADX, owner=ADMIN_ID), lane="alert")[0] == STAGE, odd


def test_T12_C_no_owner_id_means_no_lookup(owners, monkeypatch):
    from api.services import auth_service
    seen = []
    monkeypatch.setattr(auth_service, "get_user_by_id", lambda user_id: seen.append(user_id))
    _arm(monkeypatch, pane="admins", server="admins")
    no_owner = _row(ADX)
    no_owner["user_id"] = None
    assert rt.server_lane_refusal(no_owner, lane="alert")[0] == STAGE
    assert seen == []


# --- the service must be set up -------------------------------------------------------

def test_T12_C_the_service_is_set_up_only_with_BOTH_the_address_and_the_key(monkeypatch):
    assert rt.service_missing() == ["PINE_RUNTIME_SERVICE_URL", "PINE_RUNTIME_SERVICE_SECRET"]
    monkeypatch.setenv(rt.SERVICE_URL_ENV, URL)
    assert rt.service_missing() == ["PINE_RUNTIME_SERVICE_SECRET"]
    monkeypatch.setenv(rt.SERVICE_SECRET_ENV, SECRET)
    assert rt.service_missing() == []
    monkeypatch.delenv(rt.SERVICE_URL_ENV)
    assert rt.service_missing() == ["PINE_RUNTIME_SERVICE_URL"]
    for blank in ("", "   "):                                                 # blank is unset
        monkeypatch.setenv(rt.SERVICE_URL_ENV, blank)
        monkeypatch.setenv(rt.SERVICE_SECRET_ENV, blank)
        assert rt.service_missing() == ["PINE_RUNTIME_SERVICE_URL", "PINE_RUNTIME_SERVICE_SECRET"]


def test_T12_C_a_missing_address_or_key_refuses_before_any_request_can_be_built(owners, monkeypatch):
    _arm(monkeypatch, url=None)
    assert rt.server_lane_refusal(_row(ADX), lane="alert")[0] == UNAVAILABLE
    _arm(monkeypatch, url=URL, secret="  ")
    assert rt.server_lane_refusal(_row(ADX), lane="alert")[0] == UNAVAILABLE
    _arm(monkeypatch, url=" ", secret=SECRET)
    assert rt.server_lane_refusal(_row(ADX), lane="alert")[0] == UNAVAILABLE
    _arm(monkeypatch, url=URL, secret=SECRET)
    assert rt.server_lane_refusal(_row(ADX), lane="alert") is None           # control


# --- a row it cannot read is REFUSED, never admitted, and never raises ------------------

def _bad_rows():
    no_def_id = _row(ADX)
    del no_def_id["def_id"]
    int_def_id = _row(ADX)
    int_def_id["def_id"] = 5
    empty_def_id = _row(ADX)
    empty_def_id["def_id"] = ""
    no_source = _row(ADX)
    del no_source["definition"]["compute"]["source"]
    return [
        ("None", None), ("empty dict", {}), ("a string", "x"), ("an int", 5), ("a list", []),
        ("definition None", {"def_id": ADX["id"], "definition": None}),
        ("definition empty", {"def_id": ADX["id"], "definition": {}}),
        ("an ast document", {"def_id": "u_000000000001", "user_id": UNTAGGED_ID,
                             "definition": {"compute": {"kind": "ast"}}}),
        ("no def_id", no_def_id), ("int def_id", int_def_id), ("empty def_id", empty_def_id),
        ("runtime with no source", no_source),
    ]


@pytest.mark.parametrize("label,row", _bad_rows(), ids=[b[0] for b in _bad_rows()])
def test_T12_C_a_row_it_cannot_read_is_refused_and_never_raises(owners, monkeypatch, label, row):
    _arm(monkeypatch)
    got = rt.server_lane_refusal(row, lane="alert")
    assert got is not None, label
    assert got[0] in (NOT_RUNTIME, UNGRADED) and isinstance(got[1], str) and got[1], (label, got)
    if label != "runtime with no source":
        assert got[0] == NOT_RUNTIME, (label, got)


def test_T12_C_asking_changes_nothing(owners, monkeypatch):
    _arm(monkeypatch, pane="all", server="admins")
    row = _row(ADX)
    before_row, before_env = copy.deepcopy(row), {k: os.environ.get(k) for k in _ENVS}
    for lane in ("alert", "sweep"):
        rt.server_lane_refusal(row, lane=lane)
    assert row == before_row
    assert {k: os.environ.get(k) for k in _ENVS} == before_env


# =====================================================================================
# D. THE LEDGER
# =====================================================================================

@pytest.mark.parametrize("name,env", [("PINE_RUNTIME_SERVICE_URL", rt.SERVICE_URL_ENV),
                                      ("PINE_RUNTIME_SERVICE_SECRET", rt.SERVICE_SECRET_ENV)])
def test_T12_D_the_service_variables_have_knob_rows(name, env):
    assert name == env
    row = _ledger()["knobs"][name]
    assert row["repo"] == "uct-dashboard"
    assert row["status"] == "dark" and row["where"] == []
    assert "runtime_definitions.py" in row["read_at"]
    assert row["owner_decision"] and len(row["note"]) > 300
    assert row["default"].startswith("unset")


def test_T12_D_the_secret_row_records_NO_value():
    row = _ledger()["knobs"]["PINE_RUNTIME_SERVICE_SECRET"]
    assert row["kind"] == "secret"
    assert not {"value", "baked_value", "railway_value", "last_changed"} & set(row)
    assert "value is never recorded" in row["note"] and "no agent sets it" in row["owner_decision"]
    assert SECRET not in json.dumps(row)


def test_T12_D_every_name_the_design_lists_is_ledgered():
    led = _ledger()
    ledgered = set(led["flags"]) | set(led["knobs"])
    assert {"PINE_RUNTIME_SERVER_STAGE", "PINE_RUNTIME_SERVICE_URL", "PINE_RUNTIME_SERVICE_SECRET",
            "PINE_RUNTIME_KILL_LIST", "PINE_RUNTIME_ALLOWLIST"} <= ledgered
    assert "PINE_RUNTIME_SERVER_STAGE" in led["flags"]                      # a mode flag, held to the index
    assert not ({"PINE_RUNTIME_SERVICE_URL", "PINE_RUNTIME_SERVICE_SECRET"} & set(led["flags"]))


def test_T12_D_the_code_reads_every_name_it_ledgers(tmp_path):
    """The ledger must not describe a name the code never reads: the index finds all three in
    this one module, so a deleted read cannot leave a row behind."""
    copy_dir = tmp_path / "scan"
    copy_dir.mkdir()
    shutil.copy(ROOT / "api" / "services" / "runtime_definitions.py", copy_dir / "runtime_definitions.py")
    found = ffi.scan([copy_dir], copy_dir)
    for name in ("PINE_RUNTIME_SERVER_STAGE", "PINE_RUNTIME_SERVICE_URL", "PINE_RUNTIME_SERVICE_SECRET"):
        assert name in found, name
