"""Rails for the Task 11.21 Step 4 campaign tooling (tools/notebook_campaign/): the two refusals, the
persona file against the plan's own table, the sentences against their sources, and the pure helpers the
verdicts and the defect ledger are built from. No browser, no sandbox, no api import."""
import json
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "notebook_campaign"))
import run_campaign as rc  # noqa: E402
import seed_members as sm  # noqa: E402

PLAN = REPO / "docs" / "superpowers" / "plans" / "2026-10-24-notebook-widgets-p2-w11.md"
SPEC = json.loads((REPO / "tools" / "notebook_campaign" / "personas.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("path", [r"C:\data", r"C:\DATA\auth.db", r"c:\data\sub", "/data", "/data/x"])
def test_the_shared_data_root_is_refused(path):
    assert sm.refuse_shared_root(path)


@pytest.mark.parametrize("path", [r"C:\data-nbw-campaign", r"C:\Users\x\data", r"C:\database"])
def test_a_sandbox_dir_is_not_refused(path):
    assert sm.refuse_shared_root(path) is None


@pytest.mark.parametrize("base", ["https://uctintelligence.com", "http://uctintelligence.com:8131",
                                  "http://10.0.0.5:8131", "http://localhost.evil.example", "ftp://127.0.0.1"])
def test_a_non_local_base_is_refused(base):
    assert rc.refuse_non_local(base)


@pytest.mark.parametrize("base", ["http://127.0.0.1:8131", "http://localhost:8131/", "http://[::1]:8131"])
def test_a_local_base_is_allowed(base):
    assert rc.refuse_non_local(base) is None


def plan_rows() -> dict:
    """Pnn -> (persona, exercises), parsed from the plan's 50-persona table (the authority)."""
    rows = {}
    for line in PLAN.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\| (P\d\d) \| (.+?) \| (.+?) \|$", line)
        if m:
            rows[m[1]] = (m[2], m[3])
    return rows


def test_fifty_personas_in_the_plans_order_each_exercising_its_plan_row():
    rows = plan_rows()
    assert len(rows) == 50
    ids = [p["id"] for p in SPEC["personas"]]
    assert ids == [f"P{n:02d}" for n in range(1, 51)]
    for p in SPEC["personas"]:
        assert p["exercises"] == rows[p["id"]][1], p["id"]


def test_every_persona_has_a_unique_email_and_at_least_one_script_step():
    emails = [p["email"] for p in SPEC["personas"]]
    assert len(set(emails)) == 50
    for p in SPEC["personas"]:
        assert p["scripts"] and all(s["steps"] for s in p["scripts"]), p["id"]


def test_every_step_names_an_action_the_runner_has():
    for p in SPEC["personas"]:
        for s in p["scripts"]:
            for st in s["steps"]:
                assert st["do"] in rc.ACTIONS, (p["id"], st["do"])


def test_every_sentence_a_step_names_is_in_the_catalogue():
    keys = set(SPEC["sentences"])
    for p in SPEC["personas"]:
        for s in p["scripts"]:
            for st in s["steps"]:
                for k in (st.get("expect") or []) + (st.get("expect_absent") or []) + (st.get("expect_public") or []):
                    assert k in keys, (p["id"], k)
                for f in ("live_startswith", "live_not_startswith"):
                    if f in st:
                        assert st[f] in keys


def test_every_in_tree_sentence_is_still_in_its_source():
    """A sentence is quoted from its source, never typed as a second authority: its fragment must be in the
    file it names. Sources on another branch are read with git by the runner and, if absent, reported."""
    got = rc.verify_sentences(SPEC, REPO)
    local = [k for k, s in SPEC["sentences"].items() if not s["source"].startswith("origin/")]
    assert local
    bad = {k: got[k]["why"] for k in local if not got[k]["ok"]}
    assert not bad, bad


def test_a_drifted_sentence_is_refused(tmp_path):
    spec = {"sentences": {"x": {"text": "Not in the file.", "source": "README.md:1"}}}
    (tmp_path / "README.md").write_text("Something else.\n", encoding="utf-8")
    assert rc.verify_sentences(spec, tmp_path)["x"]["ok"] is False


@pytest.mark.parametrize("text,bad", [("$0 today", ["$0"]), ("0% of trades", ["0%"]), ("Used by 0 traders", ["Used by 0"]),
                                      ("(0)", ["(0)"]), ("NaN", ["NaN"]), ("[object Object]", ["[object Object]"]),
                                      ("0 trades", ["0 trades"])])
def test_zeros_are_found(text, bad):
    assert rc.zeros_in(text) == bad


@pytest.mark.parametrize("text", ["$0.50 fee", "10% of trades", "$1,000", "100 trades", "20:00", "R known on 3 of 10"])
def test_real_numbers_are_not_zeros(text):
    assert rc.zeros_in(text) == []


def test_the_run_verdict_is_never_a_pass_with_a_finding_or_an_inconclusive_step():
    ok = {"verdict": "PASS"}
    assert rc.run_verdict([ok, ok]) == "PASS"
    assert rc.run_verdict([ok, {"verdict": "INCONCLUSIVE"}]) == "INCONCLUSIVE"
    assert rc.run_verdict([ok, {"verdict": "PASS", "findings": [{"kind": "console"}]}]) == "FAIL"
    assert rc.run_verdict([{"verdict": "FAIL"}, {"verdict": "INCONCLUSIVE"}]) == "FAIL"
    assert rc.run_verdict([]) == "INCONCLUSIVE"


def test_defect_ids_continue_the_ledger():
    assert rc.next_defect_ids([], 2) == ["D-W11-001", "D-W11-002"]
    assert rc.next_defect_ids([{"id": "D-W11-007"}, {"id": "x"}], 1) == ["D-W11-008"]


def test_one_defect_seen_twice_is_one_key_and_two_defects_are_two():
    a = rc.defect_key("no serious axe finding", "target-size (79.4px by 22px) aria-controls=\"_r_i_ _r_h_\"")
    b = rc.defect_key("no serious axe finding", "target-size (56.7px by 22px) aria-controls=\"_r_g_ _r_f_\"")
    c = rc.defect_key("no serious axe finding", "color-contrast (2.1:1)")
    assert a == b and a != c


def test_the_js_regex_bridge_keeps_a_case_flag():
    assert rc.js_regex_test("(?i)split by") == 't => new RegExp("split by", "i").test(t)'
    assert rc.js_regex_test("x") == 't => new RegExp("x", "").test(t)'


def test_the_fuzz_corpus_is_read_from_its_rail_not_retyped():
    corpus = sm.fuzz_corpus(REPO)
    assert "a; DROP TABLE j2_trades" in corpus and "q" * 200 in corpus
    assert set(sm.MARKUP) <= set(corpus)


# ── wave 11 steps (tools/notebook_campaign/w11_steps.py): route shapes, builders, judges, the loopback door ──

import subprocess  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402

import w11_steps as w11  # noqa: E402

MERGED_REFS = ("origin/feat/notebook-widgets-p2", w11.BE_REF)


def merged_text(rel: str, needle: str) -> str:
    """`rel` from the first tree that has the wave 11 code (`needle`): this checkout, the merged branch, then the
    backend branch. A file no tree has is a red rail, never a skip."""
    p = REPO / rel
    if p.is_file():
        t = p.read_text(encoding="utf-8", errors="replace")
        if needle in t:
            return t
    for ref in MERGED_REFS:
        r = subprocess.run(["git", "show", f"{ref}:{rel}"], cwd=str(REPO), capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        if r.returncode == 0 and needle in r.stdout:
            return r.stdout
    raise AssertionError(f"no tree holds {rel} with {needle!r}")


#: router file -> (the APIRouter object its routes hang on, that object's prefix). Review m11: the decorator must be
#: `@<that object>.<method>("<path>"` at the start of a line, and the object must be assigned with that prefix
#: (notebook_routines.py holds routines_router AND trackers_router, both with "/{rid}" routes).
PREFIXES = {w11.GALLERY_ROUTER: ("router", "/api/j2/template-gallery"),
            w11.STYLES_ROUTER: ("router", "/api/j2"),
            w11.ROUTINES_ROUTER: ("routines_router", "/api/j2/routines"),
            w11.NOTES_ROUTER: ("router", "/api/j2"),
            w11.ALERTS_ROUTER: ("router", "")}
NEEDLE = {w11.GALLERY_ROUTER: "use-template", w11.STYLES_ROUTER: "/unarchive"}


def decorated(text: str, obj: str, method: str, path: str) -> bool:
    return re.search(rf'^@{obj}\.{method.lower()}\(\s*"{re.escape(path)}"', text, re.M) is not None


def prefixed(text: str, obj: str, prefix: str) -> bool:
    if not prefix:
        return re.search(rf"^{obj} = APIRouter\(\)", text, re.M) is not None
    return re.search(rf'^{obj} = APIRouter\(\s*prefix="{re.escape(prefix)}"', text, re.M) is not None


@pytest.mark.parametrize("name", sorted(w11.ROUTES))
def test_every_wave11_route_the_steps_call_is_declared_by_its_router(name):
    method, rel, path = w11.ROUTES[name]
    text = merged_text(rel, NEEDLE.get(rel, "@"))
    obj, prefix = PREFIXES[rel]
    assert decorated(text, obj, method, path), (name, rel, obj, path)
    assert prefixed(text, obj, prefix), (rel, obj, prefix)


def test_control_the_route_rail_reds_on_a_route_that_does_not_exist_or_hangs_on_another_router():
    text = merged_text(w11.GALLERY_ROUTER, "use-template")
    assert decorated(text, "router", "POST", "/{gallery_id}/use-template")
    assert not decorated(text, "router", "POST", "/{gallery_id}/use-templates")
    routines = merged_text(w11.ROUTINES_ROUTER, "@")
    assert decorated(routines, "trackers_router", "PUT", "/{tid}/days/{day}")           # the tracker log
    assert not decorated(routines, "routines_router", "PUT", "/{tid}/days/{day}")        # is not a routine route
    assert not prefixed(routines, "trackers_router", "/api/j2/routines")


def test_the_builders_build_the_paths_the_routes_declare():
    """Each builder's path, read back through its route's template, is that route under its router's prefix."""
    gid, sid, rid, nid = "g-1", "s-1", "r-1", "n-1"
    built = {"library": w11.b_library(), "item": w11.b_item(gid), "preview_mine": w11.b_preview_mine(gid),
             "share_preview": w11.b_share_preview("template", sid),
             "publish_style": w11.b_publish_style(sid, title="T", category="journal"),
             "publish_tool": w11.b_publish_tool("routine", rid, title="T"),
             "adopt_style": w11.b_adopt_style(gid, key=None), "adopt_tool": w11.b_adopt_tool(gid, key=None),
             "use_template": w11.b_use_template(gid, key=None), "helpful": w11.b_helpful(gid),
             "unhelpful": w11.b_helpful(gid, on=False), "helpful_prompt": w11.b_helpful_prompt(nid),
             "helpful_answer": w11.b_helpful_answer(gid, "yes"), "templates": w11.b_templates("live"),
             "archive": w11.b_style_action(sid, "archive"), "unarchive": w11.b_style_action(sid, "unarchive"),
             "delete_typed": w11.b_style_action(sid, "delete", typed_name="x"),
             "restore": w11.b_style_action(sid, "restore"), "routine_get": w11.b_routine_get(rid),
             "routine_put": w11.b_routine_put(rid, {"name": "x"}),
             "routine_tick": w11.b_routine_tick(rid, "2026-11-23", "i1"), "note_get": w11.b_note(nid),
             "routine_days": w11.b_routine_days([rid], ["2026-11-23"]),
             "alerts": w11.b_alerts()}
    assert set(built) == set(w11.ROUTES)
    ids = {"gallery_id": gid, "style_id": sid, "rid": rid, "note_id": nid, "day": "2026-11-23", "item_id": "i1"}
    for name, spec in built.items():
        method, rel, tmpl = w11.ROUTES[name]
        want = PREFIXES[rel][1] + re.sub(r"\{(\w+)\}", lambda m: ids[m[1]], tmpl)
        assert spec["method"] == method, name
        assert spec["path"].split("?")[0] == want, (name, spec["path"], want)


def test_a_keyed_press_carries_the_idempotency_header_and_an_unkeyed_one_does_not():
    k = w11.new_key()
    assert re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", k)
    assert w11.b_use_template("g", key=k)["headers"] == {"Idempotency-Key": k}
    assert w11.b_adopt_style("g", key=k)["headers"] == {"Idempotency-Key": k}
    assert w11.b_use_template("g", key=None)["headers"] == {}
    assert w11.new_key() != k


def test_builder_bodies_send_only_what_the_route_reads():
    assert w11.b_use_template("g", key=None)["body"] == {}
    assert w11.b_use_template("g", key=None, choices={"routine_a": {"use": "r1"}}, title="T")["body"] == {
        "choices": {"routine_a": {"use": "r1"}}, "title": "T"}
    assert w11.b_share_preview("routine", "r1")["body"] == {"kind": "routine", "id": "r1"}
    assert w11.b_publish_style("s", title="T", category="journal")["body"] == {
        "styleId": "s", "title": "T", "category": "journal"}
    assert w11.b_style_action("s", "delete", typed_name="Name")["body"] == {"typedName": "Name"}
    assert w11.b_routine_tick("r", "2026-11-23", "i")["body"] == {"ticked": True}
    assert w11.b_routine_put("r", {"name": "x"}, if_match=3)["headers"] == {"If-Match": "3"}
    assert w11.b_routine_put("r", {"name": "x"})["headers"] == {}
    assert w11.b_library("before_open")["path"] == "/api/j2/template-gallery/library?group=before_open"
    assert w11.b_item("a/b")["path"].endswith("/a%2Fb")          # an id is one path segment, never two


@pytest.mark.parametrize("bad", ["", None, 3])
def test_a_builder_refuses_an_id_that_is_not_one(bad):
    with pytest.raises(ValueError):
        w11.b_item(bad)


def test_the_templates_tab_has_three_views_and_four_actions():
    with pytest.raises(ValueError):
        w11.b_templates("trash")
    with pytest.raises(ValueError):
        w11.b_style_action("s", "purge")


def test_the_oversized_body_is_over_the_cap_and_still_json():
    spec = w11.b_oversized("/x")
    assert len(spec["raw"]) > w11.W11_MAX_BODY_BYTES
    assert json.loads(spec["raw"])["pad"]
    assert spec["headers"]["Content-Type"] == "application/json"


def test_the_mirrored_limits_are_the_backends():
    gal = merged_text(w11.GALLERY_ROUTER, "W11_MAX_BODY_BYTES")
    assert re.search(r"^W11_MAX_BODY_BYTES = 16 \* 1024$", gal, re.M) and w11.W11_MAX_BODY_BYTES == 16 * 1024
    notes = merged_text("api/services/journal_two/notes.py", "MAX_TITLE_CHARS")
    assert re.search(rf"^MAX_TITLE_CHARS = {w11.MAX_TITLE_CHARS}$", notes, re.M)
    tg = merged_text("api/services/journal_two/template_gallery.py", "IDEMPOTENCY_HEADER")
    assert f'IDEMPOTENCY_HEADER = "{w11.IDEMPOTENCY_HEADER}"' in tg


# judges

def R_(status, body=None, text=None):
    return w11.make_resp(status, text if text is not None else (json.dumps(body) if body is not None else ""))


def ref(code, message):
    return {"detail": {"code": code, "message": message}}


def test_a_judge_with_nothing_read_is_inconclusive_never_a_pass():
    assert w11._done([])["verdict"] == w11.INCONCLUSIVE
    assert w11._done([{"what": "x", "ok": True, "read": ""}])["verdict"] == w11.PASS
    assert w11._done([{"what": "x", "ok": False, "read": ""}], inconclusive="why")["verdict"] == w11.FAIL


def test_judge_refusal_reads_status_code_and_sentence():
    ok = w11.judge_refusal(R_(428, ref("conflict", "Reload.")), 428, "conflict", "Reload.")
    assert ok["verdict"] == w11.PASS
    assert w11.judge_refusal(R_(409, ref("conflict", "Reload.")), 428, "conflict", "Reload.")["verdict"] == w11.FAIL
    assert w11.judge_refusal(R_(428, ref("invalid", "Reload.")), 428, "conflict", "Reload.")["verdict"] == w11.FAIL
    assert w11.judge_refusal(R_(428, ref("conflict", "Other.")), 428, "conflict", "Reload.")["verdict"] == w11.FAIL
    big = "That is too much to send at once."
    assert w11.judge_refusal(R_(413, ref("invalid", big)), 413, "invalid", big)["verdict"] == w11.PASS
    # the old router reader's shape is NOT what a wave 11 door answers (review C1)
    assert w11.judge_refusal(R_(413, {"detail": "Request too large"}), 413, "invalid", big)["verdict"] == w11.FAIL
    plain = w11.judge_refusal(R_(400, {"detail": "Choose live."}), 400, None, "Choose live.")
    assert plain["verdict"] == w11.PASS
    pend = w11.judge_refusal(R_(409, ref("old", "m")), 409, "new", "m", interim_code="old")
    assert pend["verdict"] == w11.PENDING          # the generic interim path (no step uses it today)


def test_key_reused_is_final_and_conflict_is_a_fail():
    s = "That was already sent for something else. Press it again to send this one."
    assert w11.judge_key_reused(R_(409, ref("key_reused", s)), s)["verdict"] == w11.PASS
    assert w11.judge_key_reused(R_(409, ref("conflict", s)), s)["verdict"] == w11.FAIL       # A9 landed (I4)
    assert w11.judge_key_reused(R_(409, ref("conflict", "other")), s)["verdict"] == w11.FAIL     # wrong sentence
    assert w11.judge_key_reused(R_(200, {"replayed": True}), s)["verdict"] == w11.FAIL
    assert w11.judge_key_reused(R_(409, ref("in_flight", s)), s)["verdict"] == w11.FAIL


def test_listing_moved_is_final_and_conflict_is_a_fail():
    s = "This template changed while it was being added. Nothing was made. Try again."
    assert w11.judge_listing_moved(R_(409, ref("listing_moved", s)), s)["verdict"] == w11.PASS
    assert w11.judge_listing_moved(R_(409, ref("conflict", s)), s)["verdict"] == w11.FAIL     # W11-R60 landed
    assert w11.judge_listing_moved(R_(409, ref("conflict", "That is already on its way.")), s)["verdict"] == w11.FAIL


def test_judge_replay():
    a = R_(200, {"note": {"id": "n1"}})
    b = R_(200, {"note": {"id": "n1"}, "replayed": True})
    assert w11.judge_replay(a, b, "note.id")["verdict"] == w11.PASS
    assert w11.judge_replay(a, R_(200, {"note": {"id": "n2"}, "replayed": True}), "note.id")["verdict"] == w11.FAIL
    assert w11.judge_replay(a, R_(200, {"note": {"id": "n1"}}), "note.id")["verdict"] == w11.FAIL     # not replayed
    empty = w11.judge_replay(R_(200, {"note": {}}), R_(200, {"note": {}, "replayed": True}), "note.id")
    assert empty["verdict"] == w11.FAIL
    assert w11.judge_replay(a, R_(409, ref("conflict", "x")), "note.id")["verdict"] == w11.FAIL


def test_judge_unkeyed_never_accepts_a_428():
    a, b = R_(200, {"note": {"id": "n1"}}), R_(200, {"note": {"id": "n2"}})
    assert w11.judge_unkeyed(a, b, "note.id")["verdict"] == w11.PASS
    assert w11.judge_unkeyed(a, R_(428, ref("conflict", "x")), "note.id")["verdict"] == w11.FAIL
    assert w11.judge_unkeyed(a, R_(200, {"note": {"id": "n1"}}), "note.id")["verdict"] == w11.FAIL


IN_FLIGHT = "That is already on its way. Try again in a moment."


def test_in_flight_race_that_never_raced_is_inconclusive():
    made, rep = R_(200, {"note": {"id": "n1"}}), R_(200, {"note": {"id": "n1"}, "replayed": True})
    got = w11.judge_in_flight([made, rep, rep, rep], "note.id", IN_FLIGHT)
    assert got["verdict"] == w11.INCONCLUSIVE and "not forced" in got["why"]


def test_in_flight_race_with_the_409_passes_and_its_failures_fail():
    made, rep = R_(200, {"note": {"id": "n1"}}), R_(200, {"note": {"id": "n1"}, "replayed": True})
    busy = R_(409, ref("conflict", IN_FLIGHT))
    assert w11.judge_in_flight([made, busy, rep], "note.id", IN_FLIGHT)["verdict"] == w11.PASS
    two = R_(200, {"note": {"id": "n2"}})
    assert w11.judge_in_flight([made, two, busy], "note.id", IN_FLIGHT)["verdict"] == w11.FAIL        # two notes
    wrong = R_(409, ref("key_reused", IN_FLIGHT))
    assert w11.judge_in_flight([made, wrong], "note.id", IN_FLIGHT)["verdict"] == w11.FAIL
    assert w11.judge_in_flight([made, R_(500, text="boom"), busy], "note.id", IN_FLIGHT)["verdict"] == w11.FAIL
    # review I1: nothing made is a defect, whatever else answered
    assert w11.judge_in_flight([busy] * 4, "note.id", IN_FLIGHT)["verdict"] == w11.FAIL
    assert w11.judge_in_flight([rep, rep, rep, busy], "note.id", IN_FLIGHT)["verdict"] == w11.FAIL
    assert w11.judge_in_flight([made], "note.id", IN_FLIGHT)["verdict"] == w11.FAIL           # no twin answered


def test_a_transport_failure_is_inconclusive_never_a_product_fail():
    lost = R_(0, text="URLError")
    made, busy = R_(200, {"note": {"id": "n1"}}), R_(409, ref("conflict", IN_FLIGHT))
    assert w11.judge_in_flight([lost] * 3, "note.id", IN_FLIGHT)["verdict"] == w11.INCONCLUSIVE
    assert w11.judge_in_flight([made, busy, lost], "note.id", IN_FLIGHT)["verdict"] == w11.INCONCLUSIVE
    assert w11.judge_busy([R_(200, {}), lost], BUSY)["verdict"] == w11.INCONCLUSIVE
    assert w11.judge_too_long_engine(lost, "x")["verdict"] == w11.INCONCLUSIVE


def test_in_flight_leaves_a_moved_listing_to_its_own_judge():
    moved = "This template changed while it was being added. Nothing was made. Try again."
    made = R_(200, {"note": {"id": "n1"}})
    got = w11.judge_in_flight([made, R_(409, ref("conflict", moved))], "note.id", IN_FLIGHT, listing_moved=moved)
    assert got["verdict"] == w11.INCONCLUSIVE           # the moved listing is not the in-flight answer


BUSY = "Busy right now. Try again in a moment."


def test_busy_pool_judge():
    ok = R_(200, {"cards": []})
    assert w11.judge_busy([ok, ok, ok], BUSY)["verdict"] == w11.INCONCLUSIVE
    assert w11.judge_busy([ok, R_(503, ref("busy", BUSY)), ok], BUSY)["verdict"] == w11.PASS
    assert w11.judge_busy([ok, R_(503, ref("too_long", BUSY))], BUSY)["verdict"] == w11.FAIL
    assert w11.judge_busy([ok, R_(500, text="x"), R_(503, ref("busy", BUSY))], BUSY)["verdict"] == w11.FAIL
    assert w11.judge_busy([R_(429, ref("rate", "Too many")), R_(503, ref("busy", BUSY))], BUSY)["verdict"] == w11.PASS


def test_engine_too_long_judge():
    tl = "This is a lot of data to add up. Try a shorter range or fewer splits."
    assert w11.judge_too_long_engine(R_(200, {"cards": []}), tl)["verdict"] == w11.INCONCLUSIVE
    assert w11.judge_too_long_engine(R_(503, ref("too_long", tl)), tl)["verdict"] == w11.PASS
    assert w11.judge_too_long_engine(R_(500, text="x"), tl)["verdict"] == w11.FAIL
    assert w11.judge_too_long_engine(R_(503, ref("busy", BUSY)), tl)["verdict"] == w11.INCONCLUSIVE    # m6


def test_readers():
    assert w11.detail_of({"detail": {"code": "c", "message": "m"}}) == ("c", "m")
    assert w11.detail_of({"detail": "plain"}) == (None, "plain")
    assert w11.detail_of(None) == (None, None)
    line = "[routine: Night-before prep · For Mon Nov 23]"
    doc = {"type": "doc", "content": [{"type": "paragraph"}, {"type": "widgetEmbed", "attrs": {
        "widgetId": "routine", "params": {"routineId": "r1", "day": "2026-11-23", "bind": "next-trading-day"},
        "searchText": line}}, {"type": "widgetEmbed", "attrs": {"widgetId": "built", "params": {}}}]}
    assert w11.tool_embeds(doc) == [{"family": "routine", "id": "r1", "day": "2026-11-23", "bind": "next-trading-day",
                                     "searchText": line}]
    assert w11.note_body({"bodyJson": json.dumps(doc)}) == doc and w11.note_body({}) is None
    bell = [{"type": "routine_reminder", "data": {"routineId": "r1", "day": "2026-11-27"}},
            {"type": "routine_reminder", "data": {"routineId": "r2", "day": "2026-11-27"}},
            {"type": "other", "data": {"routineId": "r1", "day": "2026-11-27"}}]
    assert len(w11.reminders_for(bell, "r1", "2026-11-27")) == 1
    assert len(w11.reminders_for({"alerts": bell}, "r1", "2026-11-28")) == 0
    lib = {"templates": [{"id": "a", "title": "Setup study"}, {"id": "b", "title": "Pre-market prep"}]}
    assert w11.library_template(lib, "Pre-market prep")["id"] == "b" and w11.library_template(lib, "x") is None


# the loopback door, against a stub on 127.0.0.1

class Stub:
    """A loopback HTTP server whose answers come from `answer(method, path, headers, body) -> (status, obj)`."""

    def __init__(self, answer):
        self.seen, self.answer, self.lock, self.live, self.peak = [], answer, threading.Lock(), 0, 0
        stub = self

        class H(BaseHTTPRequestHandler):
            def _do(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(n) if n else b""
                with stub.lock:
                    stub.live += 1
                    stub.peak = max(stub.peak, stub.live)
                    stub.seen.append({"method": self.command, "path": self.path, "headers": dict(self.headers),
                                      "body": body})
                try:
                    status, obj = stub.answer(self.command, self.path, dict(self.headers), body)
                finally:
                    with stub.lock:
                        stub.live -= 1
                raw = json.dumps(obj).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            do_GET = do_POST = do_PUT = do_DELETE = _do

            def log_message(self, *a):
                pass
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


@pytest.fixture
def stub():
    s = Stub(lambda *a: (200, {"ok": True}))
    yield s
    s.close()


def test_http_call_sends_method_path_headers_body_and_the_session(stub):
    got = w11.http_call(stub.base, w11.b_use_template("g1", key="k-1", title="T"), "sess-1")
    assert got.status == 200 and got.body == {"ok": True}
    seen = stub.seen[0]
    assert seen["method"] == "POST" and seen["path"] == "/api/j2/template-gallery/g1/use-template"
    assert seen["headers"]["Idempotency-Key"] == "k-1" and seen["headers"]["Cookie"] == "uct_session=sess-1"
    assert json.loads(seen["body"]) == {"title": "T"}


def test_http_call_reads_a_refusal_as_an_answer_not_an_exception(stub):
    stub.answer = lambda *a: (409, ref("conflict", IN_FLIGHT))
    got = w11.http_call(stub.base, w11.b_use_template("g", key=None), None)
    assert got.status == 409 and w11.detail_of(got.body) == ("conflict", IN_FLIGHT)


def no_socket(monkeypatch):
    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: pytest.fail("a socket was opened"))
    monkeypatch.setattr(w11, "_opener", lambda: pytest.fail("a socket was opened"))


@pytest.mark.parametrize("base", ["https://uctintelligence.com", "http://10.0.0.5:8131",
                                  "http://uctintelligence.com\\@127.0.0.1:8131", "http://user@127.0.0.1:8131",
                                  "http://127.0.0.1:8131@uctintelligence.com", "http://127.0.0.1:abc",
                                  "http://127.0.0.1 :8131", "http://127.0.0.1:8131\\", "http:\\\\127.0.0.1:8131",
                                  "http://127.0.0.1:08131", "http://127.0.0.1:"])
def test_the_loopback_door_refuses_every_other_host_on_every_call(base, monkeypatch):
    no_socket(monkeypatch)
    assert w11.refuse_non_local(base)
    assert rc.refuse_non_local(base)
    with pytest.raises(PermissionError):
        w11.http_call(base, w11.b_library(), "s")
    with pytest.raises(PermissionError):
        w11.race(base, [w11.b_library()], "s")


@pytest.mark.parametrize("base", ["http://uctintelligence.com\\@127.0.0.1:8131", "http://127.0.0.1:8131\\",
                                  "http://localhost@127.0.0.1:8131", "http://127.0.0.1:8131/\\x"])
def test_m1_a_backslash_or_userinfo_is_refused_before_parsing_and_says_so(base):
    """Review m1: refused for what it IS (a backslash or `@`), before urlparse is asked anything, so no later
    parser difference can matter. The netloc checks behind it are a second layer, not the reason."""
    why = w11.refuse_non_local(base)
    assert why and "backslash, userinfo" in why


@pytest.mark.parametrize("base", ["http://127.0.0.1:8131", "http://LOCALHOST:8131", "http://[::1]:8131",
                                  "http://localhost"])
def test_control_a_plain_loopback_origin_is_allowed(base):
    assert w11.refuse_non_local(base) is None


def test_a_redirect_is_never_followed_and_the_cookie_never_leaves():
    other = Stub(lambda *a: (200, {"elsewhere": True}))
    target = other.base.replace("127.0.0.1", "localhost") + "/api/alerts"

    class Redirecting(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", target)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *a):
            pass
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Redirecting)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        got = w11.http_call(f"http://127.0.0.1:{srv.server_address[1]}", w11.b_alerts(), "secret-session")
        assert got.status == 302                     # the 3xx IS the answer
        assert other.seen == []                      # nothing (no Cookie) reached the next host
    finally:
        srv.shutdown()
        srv.server_close()
        other.close()


def test_race_sends_its_requests_together(stub):
    def slow(*a):
        time.sleep(0.4)
        return 200, {"ok": True}
    stub.answer = slow
    out = w11.race(stub.base, [w11.b_library() for _ in range(4)], "s")
    assert [r.status for r in out] == [200] * 4 and stub.peak >= 3


# the actions, through Campaign.step, against the stub: the INCONCLUSIVE and EXPECTED-PENDING paths

SENT = {k: SPEC["sentences"][k]["text"] for k in ("key_in_flight", "key_reused", "listing_moved")}


def fake_run(tmp_path, base):
    g = object.__new__(rc.Campaign)
    g.base, g.out, g.run_id, g.spec = base, tmp_path, "t", SPEC
    g.caps = {"w11": True, "restart": False, "clock": False, "sql_clock": False}
    g.sentences = {k: {"ok": True} for k in SPEC["sentences"]}
    g.session_override, g.manifest, g.facts, g.once_ran = {}, {"members": {}}, {}, {}
    g.clock_server = None
    g.benign, g.walk = (), None
    R = object.__new__(rc.Run)
    R.g, R.p, R.vp, R.mode = g, {"id": "P39"}, "1200", "pointer"
    R.member, R.alias, R.remembered, R.pages, R.contexts = {"session": "s39"}, {}, {}, {}, {}
    R.dir, R.tag, R.keyboard, R.size, R.touch = tmp_path / "P39", "t", False, (1200, 800), False
    R.session_refusal = None
    return g, R


def library_then(stub, answer):
    def a(method, path, headers, body):
        if path.startswith("/api/j2/template-gallery/library"):
            return 200, {"templates": [{"id": "g-pmp", "title": "Pre-market prep"}], "groups": []}
        return answer(method, path, headers, body)
    stub.answer = a


def step(g, R, st, sid="x.01"):
    return g.step(R, {"id": "x", "title": "t"}, st, sid, None)


def test_an_in_flight_step_that_never_races_reads_inconclusive_not_pass(stub, tmp_path):
    made = {"n": 0}

    def use(*a):
        with stub.lock:
            made["n"] += 1
            n = made["n"]
        return 200, {"note": {"id": "n1"}, **({"replayed": True} if n > 1 else {})}
    library_then(stub, use)
    g, R = fake_run(tmp_path, stub.base)
    row = step(g, R, {"do": "w11_in_flight", "template": "Pre-market prep"})
    assert row["verdict"] == "INCONCLUSIVE" and "not forced" in row["error"]
    keys = {s["headers"].get("Idempotency-Key") for s in stub.seen if "use-template" in s["path"]}
    assert len(keys) == 1 and None not in keys                 # four presses, ONE key


def test_an_in_flight_step_with_the_409_passes(stub, tmp_path):
    made = {"n": 0}

    def use(*a):
        with stub.lock:
            made["n"] += 1
            n = made["n"]
        return (200, {"note": {"id": "n1"}}) if n == 1 else (409, ref("conflict", SENT["key_in_flight"]))
    library_then(stub, use)
    g, R = fake_run(tmp_path, stub.base)
    row = step(g, R, {"do": "w11_in_flight", "template": "Pre-market prep"})
    assert row["verdict"] == "PASS", row


@pytest.mark.parametrize("code,want", [("conflict", "FAIL"), ("key_reused", "PASS")])
def test_a_key_reused_step_passes_on_key_reused_and_fails_on_conflict(stub, tmp_path, code, want):
    def ans(method, path, headers, body):
        if path.endswith("/use-template"):
            return 200, {"note": {"id": "n1"}}
        return 409, ref(code, SENT["key_reused"])
    library_then(stub, ans)
    g, R = fake_run(tmp_path, stub.base)
    row = step(g, R, {"do": "w11_key_reused", "template": "Pre-market prep"})
    assert row["verdict"] == want, row
    assert rc.run_verdict([row]) == want
    paths = [s["path"] for s in stub.seen if s["method"] == "POST"]
    assert paths[-2].endswith("/use-template") and paths[-1].endswith("/adopt")
    k = [s["headers"].get("Idempotency-Key") for s in stub.seen if s["method"] == "POST"]
    assert k[-1] == k[-2]


def test_listing_moved_and_an_unknown_template_read_inconclusive(stub, tmp_path):
    library_then(stub, lambda *a: (200, {}))
    g, R = fake_run(tmp_path, stub.base)
    row = step(g, R, {"do": "w11_listing_moved"})
    assert row["verdict"] == "INCONCLUSIVE" and "not forceable" in row["error"]
    row = step(g, R, {"do": "w11_use", "template": "No such"}, "x.02")
    assert row["verdict"] == "INCONCLUSIVE" and "No such" in row["error"]


def test_a_non_local_base_makes_a_w11_step_inconclusive_and_sends_nothing(tmp_path, monkeypatch):
    no_socket(monkeypatch)
    g, R = fake_run(tmp_path, "https://uctintelligence.com")
    row = step(g, R, {"do": "w11_browse"})
    assert row["verdict"] == "INCONCLUSIVE" and "PermissionError" in row["error"]


def _templates_tab(stub, lands_after_restore):
    state = {"view": "live"}

    def ans(method, path, headers, body):
        if "?view=" in path:
            v = path.rsplit("=", 1)[1]
            return 200, {"styles": [{"id": "c1", "name": "Copy"}] if v == state["view"] else []}
        act_ = path.rsplit("/", 1)[1]
        if act_ == "delete":
            assert json.loads(body) == {"typedName": "Copy"}
        state["view"] = {"archive": "archived", "unarchive": "live", "delete": "deleted",
                         "restore": lands_after_restore}[act_]
        return 200, {"style": {"id": "c1", "archivedAt": "2026-11-23T00:00:00Z" if state["view"] == "archived" else None}}
    stub.answer = ans


def test_the_restore_step_walks_the_templates_tab_doors(stub, tmp_path):
    _templates_tab(stub, "archived")
    g, R = fake_run(tmp_path, stub.base)
    R.alias["copy"] = {"id": "c1", "name": "Copy"}
    row = step(g, R, {"do": "w11_restore"})
    assert row["verdict"] == "PASS", [c for c in row["checks"] if not c["ok"]]
    assert [s["path"].rsplit("/", 1)[1] for s in stub.seen if s["method"] == "POST"] == [
        "archive", "unarchive", "archive", "delete", "restore", "unarchive"]


def test_a_restore_that_lands_live_instead_of_archived_fails(stub, tmp_path):
    _templates_tab(stub, "live")
    g, R = fake_run(tmp_path, stub.base)
    R.alias["copy"] = {"id": "c1", "name": "Copy"}
    assert step(g, R, {"do": "w11_restore"})["verdict"] == "FAIL"


def test_a_restore_with_no_copy_is_inconclusive(stub, tmp_path):
    g, R = fake_run(tmp_path, stub.base)
    assert step(g, R, {"do": "w11_restore"})["verdict"] == "INCONCLUSIVE"
    assert stub.seen == []


def test_the_if_match_step_expects_428_conflict(stub, tmp_path):
    need = SPEC["sentences"]["need_if_match"]["text"]

    def ans(method, path, headers, body):
        if method == "GET":
            return 200, {"id": "r1", "name": "Pre-market routine"}
        assert "If-Match" not in headers
        return 428, ref("conflict", need)
    stub.answer = ans
    g, R = fake_run(tmp_path, stub.base)
    R.alias["use_routine"] = {"id": "r1", "name": "Pre-market routine"}
    assert step(g, R, {"do": "w11_if_match_missing"})["verdict"] == "PASS"
    stub.answer = lambda m, p, h, b: (200, {"id": "r1"})
    assert step(g, R, {"do": "w11_if_match_missing"}, "x.02")["verdict"] == "FAIL"


def test_the_use_step_replays_with_one_key_and_reads_the_bound_day(stub, tmp_path):
    line = "[routine: Night-before prep · For Mon Nov 23]"
    embed = {"type": "widgetEmbed", "attrs": {"widgetId": "routine",
                                              "params": {"routineId": "r9", "day": "2026-11-23"}, "searchText": line}}
    keys = []

    def ans(method, path, headers, body):
        keys.append(headers.get("Idempotency-Key"))
        out = {"note": {"id": "n1", "bodyJson": {"type": "doc", "content": [embed]}},
               "style": {"id": "c1", "name": "C"},
               "created": {"routines": [{"id": "r9", "name": "Night-before prep"}], "widgets": [], "trackers": []}}
        if len(keys) > 1:
            out.update(replayed=True, created={"routines": [], "widgets": [], "trackers": []})
        return 200, out
    library_then(stub, ans)
    g, R = fake_run(tmp_path, stub.base)
    st = {"do": "w11_use", "template": "Pre-market prep",
          "expect_embed": {"family": "routine", "day": "2026-11-23", "label": "For Mon Nov 23"}}
    row = step(g, R, st)
    assert row["verdict"] == "PASS", [c for c in row["checks"] if not c["ok"]]
    assert len(keys) == 2 and keys[0] == keys[1] and keys[0]
    assert R.alias["use_routine"]["id"] == "r9" and R.alias["copy"] == {"id": "c1", "name": "C"}
    keys.clear()
    st["expect_embed"]["day"] = "2026-11-24"
    assert step(g, R, st, "x.02")["verdict"] == "FAIL"


def test_a_strict_pick_without_a_suggestion_is_inconclusive_and_auto_goes_without():
    with pytest.raises(rc.Inconclusive):
        rc.choices_from_preview(None, "T", strict=True)
    with pytest.raises(rc.Inconclusive):
        rc.choices_from_preview({"questions": [{"slot": "routine_a", "use": None}]}, "T", strict=True)
    assert rc.choices_from_preview({"questions": [{"slot": "routine_a", "use": None}]}, "T", strict=False) is None
    assert rc.choices_from_preview(None, "T", strict=False) is None
    assert rc.choices_from_preview({"questions": [{"slot": "routine_a", "use": {"id": "r1", "name": "M"}}]}, "T",
                                   strict=True) == {"routine_a": {"use": "r1"}}


def test_a_once_script_runs_in_the_first_run_only():
    ran, p = {}, {"id": "P35"}
    sc = {"id": "P35.c", "once": True}
    assert rc.once_gate(ran, p, sc, "1200-pointer") is None
    assert rc.once_gate(ran, p, sc, "820-pointer") == "1200-pointer"
    assert rc.once_gate(ran, p, {"id": "P35.b"}, "820-pointer") is None          # not `once`: every run
    assert rc.once_gate(ran, {**p, "_at": 1}, sc, "1200-pointer") is None         # a new instant: runs again


# the personas' wave 11 scripts

def steps_of(do: str):
    return [(p["id"], st) for p in SPEC["personas"] for sc in p["scripts"] for st in sc["steps"] if st["do"] == do]


def test_no_wave11_stub_is_left():
    stubs = {"library_preview", "library_use", "adopt_use", "share_preview_template", "api_concurrent"}
    assert not stubs & set(rc.ACTIONS)
    for pid in ("P02", "P20", "P34", "P35", "P36", "P37", "P38", "P39", "P40", "P41"):
        p = next(x for x in SPEC["personas"] if x["id"] == pid)
        assert all(st["do"] != "noop" for sc in p["scripts"] for st in sc["steps"]), pid


@pytest.mark.parametrize("do", ["w11_in_flight", "w11_if_match_missing", "w11_unkeyed", "w11_too_large",
                                "w11_title_too_long", "w11_key_reused", "w11_listing_moved", "w11_busy",
                                "w11_engine_too_long", "w11_restore", "w11_routine", "w11_adopt", "w11_use",
                                "w11_publish", "w11_share_preview", "w11_preview", "w11_browse", "w11_helpful",
                                "w11_helpful_prompt", "w11_helpful_answer", "w11_bell"])
def test_every_forced_edge_and_wave11_step_is_some_personas_step(do):
    assert steps_of(do), do


def test_every_wave11_sentence_verifies_against_its_source():
    keys = ["key_in_flight", "key_reused", "listing_moved", "helpful_days", "title_too_long", "need_if_match",
            "body_too_large", "busy_srv", "too_long_srv", "pick_setup"]
    got = rc.verify_sentences({"sentences": {k: SPEC["sentences"][k] for k in keys}}, REPO)
    assert all(got[k]["ok"] for k in keys), {k: got[k]["why"] for k in keys if not got[k]["ok"]}


def test_the_api_only_and_one_time_personas_run_once():
    by = {p["id"]: p for p in SPEC["personas"]}
    for pid in ("P20", "P37", "P38", "P39", "P41"):
        assert by[pid]["viewports"] == ["1200"] and by[pid]["modes"] == ["pointer"], pid
    for pid, sid in (("P34", "P34.b"), ("P35", "P35.c"), ("P50", "P50.b")):
        assert next(s for s in by[pid]["scripts"] if s["id"] == sid).get("once") is True


def test_a_wave11_step_never_names_a_sentence_list_key_with_another_meaning():
    """`expect` / `expect_absent` are sentence keys read by `expectations()` for EVERY step: a w11 step that used
    them for its own outcome would be read as sentences."""
    keys = set(SPEC["sentences"])
    for pid, st in [(p, s) for d in rc.W11_ACTIONS for p, s in steps_of(d)]:
        for k in ("expect", "expect_absent"):
            assert all(x in keys for x in st.get(k) or []), (pid, st)


# ── fix round 1 (review of a6e1be0e17): runner-level rails, each fed the backend's REAL answer shapes ──────────
#
# MUTANT LEDGER (re-run: scratchpad mutate_r1.py; each must turn this file red, then the file is restored byte for
# byte). Reviewer's eight: R1 cookie_of -> always the seeded session; R2 judge_in_flight without the one-made check;
# R3 a_w11_bell -> one always-true check; R4 a_w11_routine -> one always-true check; R5 a_w11_helpful_prompt ->
# always-true; R6 a_w11_too_large accepting 200/400/413; R7 a_w11_use without "the replay made nothing";
# R8 a_w11_adopt ignoring new_key_makes_another. Fix-round ones: F1 the 413 judged on the old shape; F2 the Use sent
# with no answers; F3 answers taken from sampleValue; F4 a bell read that is not 200 counted as empty; F5 the
# loopback guard without the backslash/userinfo refusal; F6 redirects followed; F7 --out unguarded; F8 a w11 step
# with no check reading PASS; F9 key_reused accepting `conflict`; F10 an in-flight transport loss graded FAIL.
# Result at fix round 1: all 18 red. R4 and F5 first SURVIVED (a second check caught the same defect), so each got a
# rail of its own: test_i2_a_tick_answer_that_says_false... and test_m1_a_backslash_or_userinfo_is_refused...

SETUP_STUDY_PREVIEW = {   # template_preview.preview_mine's shape for an official template with one declared choice
    "slots": [{"id": "p1", "type": "setup", "label": "Setup", "any": False,
               "suggested": {"value": "Breakout", "label": "Breakout"}, "value": "Breakout", "sampleValue": "Pullback"}],
    "cards": [{"slot": "built_a", "title": "Win rate", "payload": {"rows": []}, "sample": False}],
    "tools": [], "questions": [], "credit": "Based on UCT's Setup study"}


def lib_two(stub, answer, extra=()):
    titles = [("g-pmp", "Pre-market prep"), ("g-ss", "Setup study"), *extra]

    def a(method, path, headers, body):
        if path.startswith("/api/j2/template-gallery/library"):
            return 200, {"templates": [{"id": i, "title": t, "firm": True, "group": "playbook", "contains": []}
                                       for i, t in titles], "groups": [{"key": "playbook", "label": "Playbook"}]}
        return answer(method, path, headers, body)
    stub.answer = a


def posts(stub, tail):
    return [s for s in stub.seen if s["method"] == "POST" and s["path"].endswith(tail)]


def test_c2_the_use_answers_every_declared_choice_from_the_preview_never_sample_value(stub, tmp_path):
    def ans(method, path, headers, body):
        if path.endswith("/preview-mine"):
            return 200, SETUP_STUDY_PREVIEW
        sent = json.loads(body or b"{}")
        if sent.get("answers") != {"p1": "Breakout"}:
            return 400, ref("unresolved", "Answer every choice.")       # _resolved_answers' refusal
        out = {"note": {"id": "n1"}, "style": {"id": "c1", "name": "Setup study"},
               "created": {"widgets": [], "routines": [], "trackers": []}, "reused": {"routines": [], "trackers": []}}
        if len(posts(stub, "/use-template")) > 1:
            out["replayed"] = True
        return 200, out
    lib_two(stub, ans)
    g, R = fake_run(tmp_path, stub.base)
    assert step(g, R, {"do": "w11_preview", "template": "Setup study"})["verdict"] == "PASS"
    row = step(g, R, {"do": "w11_use", "template": "Setup study", "answers": "preview"}, "x.02")
    assert row["verdict"] == "PASS", [c for c in row["checks"] if not c["ok"]]
    for s_ in posts(stub, "/use-template"):
        assert json.loads(s_["body"])["answers"] == {"p1": "Breakout"}            # the value, never "Pullback"


def test_c2_a_use_that_needs_answers_without_a_preview_or_a_value_sends_nothing(stub, tmp_path):
    lib_two(stub, lambda *a: pytest.fail("a Use was sent"))
    g, R = fake_run(tmp_path, stub.base)
    assert step(g, R, {"do": "w11_use", "template": "Setup study", "answers": "preview"})["verdict"] == "INCONCLUSIVE"
    R.remembered["preview:Setup study"] = {"slots": [{"id": "p1", "type": "setup", "value": None,
                                                      "sampleValue": "Pullback"}]}
    row = step(g, R, {"do": "w11_use", "template": "Setup study"}, "x.02")
    assert row["verdict"] == "INCONCLUSIVE" and "p1" in row["error"]


def test_answers_from_preview_takes_values_and_names_the_unanswered():
    pv = {"slots": [{"id": "a", "value": "Breakout", "sampleValue": "X"}, {"id": "b", "value": {"any": True}},
                    {"id": "c", "value": None, "sampleValue": "Y"}]}
    assert w11.answers_from_preview(pv) == ({"a": "Breakout", "b": {"any": True}}, ["c"])


def test_m4_a_replay_with_no_created_does_not_pass_made_nothing(stub, tmp_path):
    n = {"k": 0}

    def ans(*a):
        n["k"] += 1
        return 200, {"note": {"id": "n1"}, **({"replayed": True} if n["k"] > 1 else {})}
    library_then(stub, ans)
    g, R = fake_run(tmp_path, stub.base)
    row = step(g, R, {"do": "w11_use", "template": "Pre-market prep"})
    assert row["verdict"] == "FAIL"
    assert any("made nothing" in c["what"] and not c["ok"] for c in row["checks"])


def test_i2_the_tick_reads_the_ticked_map_before_and_after(stub, tmp_path):
    state = {"ticked": False, "write": True}

    def ans(method, path, headers, body):
        if method == "GET":
            return 200, {"id": "r1", "name": "Pre-market routine", "items": [{"id": "i1", "text": "Futures"}]}
        if path.endswith("/routines/days"):
            d = json.loads(body)["days"][0]
            return 200, {"routines": {"r1": {"days": {d: {"state": "done" if state["ticked"] else "not_done",
                                                         "ticked": {"i1": state["ticked"]}}}}}}
        if state["write"]:
            state["ticked"] = True
        return 200, {"state": "done", "ticked": {"i1": state["ticked"]}, "items": [{"id": "i1"}]}
    stub.answer = ans
    g, R = fake_run(tmp_path, stub.base)
    R.alias["use_routine"] = {"id": "r1"}
    row = step(g, R, {"do": "w11_routine"})
    assert row["verdict"] == "PASS", [c for c in row["checks"] if not c["ok"]]
    assert sum(1 for r in row["read"] if r["what"].startswith("state ")) == 2
    state.update(ticked=False, write=False)              # a server that answers 200 and writes nothing
    assert step(g, R, {"do": "w11_routine"}, "x.02")["verdict"] == "FAIL"


def test_i2_a_tick_answer_that_says_false_fails_even_if_a_later_read_says_true(stub, tmp_path):
    reads = {"n": 0}

    def ans(method, path, headers, body):
        if method == "GET":
            return 200, {"id": "r1", "name": "R", "items": [{"id": "i1", "text": "Futures"}]}
        if path.endswith("/routines/days"):
            reads["n"] += 1
            t = reads["n"] > 1
            d = json.loads(body)["days"][0]
            return 200, {"routines": {"r1": {"days": {d: {"state": "done" if t else "not_done", "ticked": {"i1": t}}}}}}
        return 200, {"state": "not_done", "ticked": {"i1": False}}      # the answer itself says not ticked
    stub.answer = ans
    g, R = fake_run(tmp_path, stub.base)
    R.alias["use_routine"] = {"id": "r1"}
    row = step(g, R, {"do": "w11_routine"})
    assert row["verdict"] == "FAIL"
    assert [c["what"] for c in row["checks"] if not c["ok"]] == ["the answer says the item is ticked (ticked map: true)"]


def test_i3_a_bell_that_does_not_answer_200_is_inconclusive_not_empty(stub, tmp_path):
    stub.answer = lambda *a: (401, {"detail": "Not signed in"})
    g, R = fake_run(tmp_path, stub.base)
    g.manifest = {"members": {}}
    R.member = {"session": "s20", "routines": [{"name": "Close reminder", "id": "r20"}]}
    row = step(g, R, {"do": "w11_bell", "routine": "Close reminder", "count": 0})
    assert row["verdict"] == "INCONCLUSIVE" and "401" in row["error"]
    stub.answer = lambda *a: (200, [])
    assert step(g, R, {"do": "w11_bell", "routine": "Close reminder", "count": 0}, "x.02")["verdict"] == "PASS"
    one = [{"type": "routine_reminder", "data": {"routineId": "r20", "day": rc.today_et().isoformat()}}]
    stub.answer = lambda *a: (200, one)
    assert step(g, R, {"do": "w11_bell", "routine": "Close reminder", "count": 0}, "x.03")["verdict"] == "FAIL"
    assert step(g, R, {"do": "w11_bell", "routine": "Close reminder", "count": 1}, "x.04")["verdict"] == "PASS"
    assert g.facts[("P39", "bell_seen:r20")] is True
    stub.answer = lambda *a: (200, [])
    g.facts.clear()
    row = step(g, R, {"do": "w11_bell", "routine": "Close reminder", "count": 1, "needs_seen": True}, "x.05")
    assert row["verdict"] == "INCONCLUSIVE" and stub.seen[-1]["path"] != "never"


def test_i7_under_a_clock_group_a_step_sends_only_a_vouched_session(stub, tmp_path):
    library_then(stub, lambda *a: (200, {}))
    g, R = fake_run(tmp_path, stub.base)
    g.clock_server = object()                            # a clock group is being served
    row = step(g, R, {"do": "w11_browse"})
    assert row["verdict"] == "INCONCLUSIVE" and "vouched" in row["error"]
    assert stub.seen == []                               # the seeded cookie was never sent
    g.session_override = {"P39": "minted-39"}
    step(g, R, {"do": "w11_browse"}, "x.02")
    assert stub.seen and all(s["headers"]["Cookie"] == "uct_session=minted-39" for s in stub.seen)
    g.clock_server, g.session_override = None, {}
    stub.seen.clear()
    step(g, R, {"do": "w11_browse"}, "x.03")
    assert stub.seen[-1]["headers"]["Cookie"] == "uct_session=s39"   # a real-clock server: the seeded session


def test_m7_a_w11_step_with_no_check_is_inconclusive(tmp_path, monkeypatch):
    monkeypatch.setitem(rc.ACTIONS, "w11_silent", lambda R, s, row: None)
    monkeypatch.setattr(rc, "W11_ACTIONS", rc.W11_ACTIONS | {"w11_silent"})
    g, R = fake_run(tmp_path, "http://127.0.0.1:1")
    row = step(g, R, {"do": "w11_silent"})
    assert row["verdict"] == "INCONCLUSIVE" and "read nothing" in row["error"]


def test_c1_the_413_step_grades_the_wave11_readers_answer(stub, tmp_path):
    big = SPEC["sentences"]["body_too_large"]["text"]
    assert big == "That is too much to send at once."
    g, R = fake_run(tmp_path, stub.base)
    for answer, want in (((413, ref("invalid", big)), "PASS"), ((413, {"detail": "Request too large"}), "FAIL"),
                         ((200, {"travels": None}), "FAIL"), ((400, ref("invalid", big)), "FAIL")):
        stub.answer = lambda *a, answer=answer: answer
        assert step(g, R, {"do": "w11_too_large"})["verdict"] == want, answer
    assert len(posts(stub, "/share/preview")[-1]["body"]) > w11.W11_MAX_BODY_BYTES


def test_title_too_long_sends_301_characters_unkeyed_and_wants_400_invalid(stub, tmp_path):
    msg = SPEC["sentences"]["title_too_long"]["text"]
    library_then(stub, lambda *a: (400, ref("invalid", msg)))
    g, R = fake_run(tmp_path, stub.base)
    assert step(g, R, {"do": "w11_title_too_long", "template": "Pre-market prep"})["verdict"] == "PASS"
    sent = posts(stub, "/use-template")[-1]
    assert len(json.loads(sent["body"])["title"]) == w11.MAX_TITLE_CHARS + 1 and "Idempotency-Key" not in sent["headers"]
    library_then(stub, lambda *a: (200, {"note": {"id": "n"}}))
    assert step(g, R, {"do": "w11_title_too_long", "template": "Pre-market prep"}, "x.02")["verdict"] == "FAIL"


def test_the_preview_step_reads_sample_questions_and_bindings(stub, tmp_path):
    pv = {"slots": [], "cards": [{"slot": "b", "payload": {}, "sample": True}],
          "tools": [{"slot": "routine_a", "bind": "next-trading-day", "forDayLabel": "For Mon Nov 23"}],
          "questions": [{"slot": "routine_a", "use": {"id": "r1", "name": "Morning routine"}}]}
    lib_two(stub, lambda *a: (200, pv))
    g, R = fake_run(tmp_path, stub.base)
    good = {"do": "w11_preview", "template": "Pre-market prep", "expect_sample": True,
            "expect_question_use": "Morning routine",
            "expect_tools": [{"slot": "routine_a", "bind": "next-trading-day", "forDayLabel": "For Mon Nov 23"}]}
    assert step(g, R, good)["verdict"] == "PASS"
    for bad in ({"expect_own_data": True}, {"expect_question_use": "Other"},
                {"expect_tools": [{"slot": "routine_a", "bind": "week", "forDayLabel": "For Mon Nov 23"}]}):
        assert step(g, R, {"do": "w11_preview", "template": "Pre-market prep", **bad}, "x.02")["verdict"] == "FAIL", bad


def test_the_share_preview_and_publish_steps(stub, tmp_path):
    state = {"travels": {"title": "T", "blocks": []}}

    def ans(method, path, headers, body):
        if "?view=live" in path:
            return 200, {"styles": [{"id": "s34", "name": "zzq-canary-7f3a template"}]}
        if path.endswith("/share/preview"):
            assert json.loads(body) == {"kind": "template", "id": "s34"}
            return 200, {"travels": state["travels"], "notShared": [], "prefill": {}}
        assert path.endswith("/styles") and json.loads(body)["styleId"] == "s34"
        return 200, {"template": {"id": "L1", "title": "Campaign"}}
    stub.answer = ans
    g, R = fake_run(tmp_path, stub.base)
    sp = {"do": "w11_share_preview", "kind": "template", "name": "zzq-canary-7f3a template",
          "forbid_text": ["zzq-canary-7f3a"]}
    assert step(g, R, sp)["verdict"] == "PASS"
    assert step(g, R, {"do": "w11_publish", "title": "Campaign", "forbid_text": ["zzq-canary-7f3a"]},
                "x.02")["verdict"] == "PASS" and R.alias["listing"]["id"] == "L1"
    state["travels"] = {"title": "zzq-canary-7f3a template"}
    assert step(g, R, sp, "x.03")["verdict"] == "FAIL"
    state["travels"] = None
    assert step(g, R, sp, "x.04")["verdict"] == "INCONCLUSIVE"


def test_the_adopt_step_replays_and_a_new_key_makes_another(stub, tmp_path):
    state = {"distinct": True}
    seen_keys = {}

    def ans(method, path, headers, body):
        k = headers.get("Idempotency-Key")
        if k in seen_keys:
            return 200, {"style": {"id": seen_keys[k], "name": "C"}, "replayed": True}
        seen_keys[k] = f"c{len(seen_keys)}" if state["distinct"] else "c0"
        return 200, {"style": {"id": seen_keys[k], "name": "C"}}
    library_then(stub, ans)
    g, R = fake_run(tmp_path, stub.base)
    st = {"do": "w11_adopt", "template": "Pre-market prep", "new_key_makes_another": True}
    assert step(g, R, st)["verdict"] == "PASS"
    state["distinct"] = False                               # a new key that answers the SAME copy
    seen_keys.clear()
    assert step(g, R, st, "x.02")["verdict"] == "FAIL"


def test_the_unkeyed_step_sends_no_key_and_wants_two_results(stub, tmp_path):
    n = {"k": 0}

    def ans(*a):
        n["k"] += 1
        return 200, {"note": {"id": f"n{n['k']}"}}
    library_then(stub, ans)
    g, R = fake_run(tmp_path, stub.base)
    assert step(g, R, {"do": "w11_unkeyed", "template": "Pre-market prep"})["verdict"] == "PASS"
    assert all("Idempotency-Key" not in s_["headers"] for s_ in posts(stub, "/use-template"))
    library_then(stub, lambda *a: (428, ref("conflict", "Reload")))
    assert step(g, R, {"do": "w11_unkeyed", "template": "Pre-market prep"}, "x.02")["verdict"] == "FAIL"


def test_the_busy_and_engine_steps(stub, tmp_path):
    busy = SPEC["sentences"]["busy_srv"]["text"]
    tl = SPEC["sentences"]["too_long_srv"]["text"]
    n = {"k": 0}

    def ans(*a):
        with stub.lock:
            n["k"] += 1
            k = n["k"]
        return (503, ref("busy", busy)) if k == 2 else (200, {"cards": []})
    lib_two(stub, ans)
    g, R = fake_run(tmp_path, stub.base)
    assert step(g, R, {"do": "w11_busy", "templates": ["Pre-market prep", "Setup study"]})["verdict"] == "PASS"
    assert len(posts(stub, "/preview-mine")) == 2
    lib_two(stub, lambda *a: (200, {"cards": []}))
    assert step(g, R, {"do": "w11_busy", "templates": ["Pre-market prep", "Setup study"]}, "x.02")["verdict"] == \
        "INCONCLUSIVE"
    lib_two(stub, lambda *a: (503, ref("too_long", tl)))
    assert step(g, R, {"do": "w11_engine_too_long", "template": "Setup study"}, "x.03")["verdict"] == "PASS"
    lib_two(stub, lambda *a: (503, ref("busy", busy)))
    assert step(g, R, {"do": "w11_engine_too_long", "template": "Setup study"}, "x.04")["verdict"] == "INCONCLUSIVE"


def test_the_helpful_steps(stub, tmp_path):
    days = SPEC["sentences"]["helpful_days"]["text"]
    state = {"mode": "refuse"}

    def ans(method, path, headers, body):
        if path.endswith("/helpful-prompt") and method == "GET":
            return 200, {"show": True, "itemId": "g-ss", "title": "Setup study", "line": "Was Setup study helpful?"}
        if path.endswith("/helpful-prompt"):
            return 200, {"answer": json.loads(body)["answer"], "helpful": True, "count": 1}
        if method == "DELETE":
            return 200, {"helpful": False, "count": 0}
        if state["mode"] == "refuse":
            return 409, ref("helpful_days", days)
        return 200, {"helpful": state["mode"] == "mark", "count": 1}
    lib_two(stub, ans)
    g, R = fake_run(tmp_path, stub.base)
    R.alias["used"] = "n1"
    assert step(g, R, {"do": "w11_helpful", "template": "Setup study", "outcome": "refused"})["verdict"] == "PASS"
    state["mode"] = "mark"
    assert step(g, R, {"do": "w11_helpful", "template": "Setup study", "outcome": "refused"}, "x.02")["verdict"] == "FAIL"
    assert step(g, R, {"do": "w11_helpful", "template": "Setup study", "outcome": "allowed"}, "x.03")["verdict"] == "PASS"
    state["mode"] = "silent"                               # 200 that marks nothing
    assert step(g, R, {"do": "w11_helpful", "template": "Setup study", "outcome": "allowed"}, "x.04")["verdict"] == "FAIL"
    assert step(g, R, {"do": "w11_helpful", "template": "Setup study", "outcome": "unmarked"}, "x.05")["verdict"] == "PASS"
    assert step(g, R, {"do": "w11_helpful_prompt", "template": "Setup study", "show": True}, "x.06")["verdict"] == "PASS"
    assert step(g, R, {"do": "w11_helpful_prompt", "template": "Setup study", "show": False}, "x.07")["verdict"] == "FAIL"
    assert posts(stub, "/x") == [] and [s_ for s_ in stub.seen if s_["path"].endswith("/notes/n1/helpful-prompt")]
    assert step(g, R, {"do": "w11_helpful_answer", "template": "Setup study", "answer": "yes"}, "x.08")["verdict"] == "PASS"
    R.alias.pop("used")
    assert step(g, R, {"do": "w11_helpful_prompt", "template": "Setup study", "show": True}, "x.09")["verdict"] == \
        "INCONCLUSIVE"


def test_m3_an_evidence_folder_under_the_shared_root_is_refused(tmp_path, capsys, monkeypatch):
    data = tmp_path / "sandbox"
    data.mkdir()
    (data / sm.MANIFEST_NAME).write_text(json.dumps({"members": {}}), encoding="utf-8")
    monkeypatch.setattr(rc, "load_walk_libs", lambda root: pytest.fail("the walk libs were loaded"))
    code = rc.main(["--run-id", "x", "--base", "http://127.0.0.1:1", "--data-dir", str(data), "--out", r"C:\data\x"])
    assert code == 3 and "--out" in capsys.readouterr().out



# ── fix round 2 (scoped re-review of f36a9a28dd): m-a .. m-d ──────────────────────────────────────────────
# Mutants re-run for this round (scratchpad mutate_r2.py), each must turn this file red: N3 the per-request path
# check removed; N4 the netloc == host[:port] comparison removed; N5 the tick's "before: not ticked" check made
# always true; N6 the browser context falling back to the seeded session under a clock group; N7 a step running
# despite a session refusal.

@pytest.mark.parametrize("path", ["@evil.example/x", "evil.example/x", ".evil.example/x", ""])
def test_m_a_a_path_that_does_not_start_with_a_slash_never_leaves_the_base(path, monkeypatch):
    no_socket(monkeypatch)
    with pytest.raises(PermissionError):
        w11.http_call("http://127.0.0.1:8131", {"method": "GET", "path": path, "headers": {}}, "s")


def test_m_b_the_netloc_must_be_exactly_host_and_port():
    for base in ("http://127.0.0.1:08131", "http://127.0.0.1:", "http://localhost:0008131"):
        assert w11.refuse_non_local(base) and "exactly host[:port]" in w11.refuse_non_local(base), base
    assert w11.refuse_non_local("http://127.0.0.1:8131") is None


def test_m_c_an_item_already_ticked_before_the_press_fails_the_before_check(stub, tmp_path):
    def ans(method, path, headers, body):
        if method == "GET":
            return 200, {"id": "r1", "name": "R", "items": [{"id": "i1", "text": "Futures"}]}
        if path.endswith("/routines/days"):
            d = json.loads(body)["days"][0]
            return 200, {"routines": {"r1": {"days": {d: {"state": "done", "ticked": {"i1": True}}}}}}
        return 200, {"state": "done", "ticked": {"i1": True}}
    stub.answer = ans
    g, R = fake_run(tmp_path, stub.base)
    R.alias["use_routine"] = {"id": "r1"}
    row = step(g, R, {"do": "w11_routine"})
    assert row["verdict"] == "FAIL"
    assert [c["what"] for c in row["checks"] if not c["ok"]] == ["before: the item is not ticked today"]


class FakeCtx:
    def __init__(self):
        self.cookies, self.installed = [], None
        self.clock = types_ns(install=lambda time=None: setattr(self, "installed", time))

    def add_cookies(self, c):
        self.cookies.extend(c)


def types_ns(**kw):
    import types
    return types.SimpleNamespace(**kw)


def browser_run(tmp_path, *, clock: bool, vouched: str | None):
    g, R = fake_run(tmp_path, "http://127.0.0.1:8131")
    made = []
    g.browser = types_ns(new_context=lambda **kw: made.append(FakeCtx()) or made[-1])
    g.clock_server = object() if clock else None
    g.session_override = {"P13": vouched} if vouched else {}
    R.p, R.member = {"id": "P13"}, {"session": "seeded-p13"}
    return g, R, made


def test_m_d_under_a_clock_group_the_browser_gets_no_seeded_cookie_and_every_step_is_inconclusive(tmp_path,
                                                                                                 monkeypatch):
    g, R, made = browser_run(tmp_path, clock=True, vouched=None)
    R.new_context("main")
    assert made[0].cookies == [] and R.session_refusal and "vouched" in R.session_refusal
    monkeypatch.setitem(rc.ACTIONS, "open", lambda *a: pytest.fail("a browser step ran without a vouched session"))
    row = g.step(R, {"id": "P13.a", "title": "t"}, {"do": "open", "path": "/journal"}, "P13.a.01", None)
    assert row["verdict"] == "INCONCLUSIVE" and "vouched" in row["error"]


def test_m_d_control_a_vouched_session_or_a_real_clock_server_sets_the_cookie(tmp_path):
    g, R, made = browser_run(tmp_path, clock=True, vouched="minted-p13")
    R.new_context("main")
    assert [c["value"] for c in made[0].cookies] == ["minted-p13"] and R.session_refusal is None
    g, R, made = browser_run(tmp_path, clock=False, vouched=None)
    R.new_context("main")
    assert [c["value"] for c in made[0].cookies] == ["seeded-p13"] and R.session_refusal is None


# ── persona validation pass: every selector a step drives is still in the frontend it drives ──────────────────────
#
# MUTANT LEDGER (each turned this block red, then the file was restored byte for byte from a scratch copy):
# S1 P06.a.05 `by` back to "Hour"; S2 P23.a.04 `source` back to "Closed trades"; S3 a card id that is not on the shelf;
# S4 HANDLER_ANCHORS "builder-live" fragment renamed; S5 a handler's get_by_role name changed to "Save now";
# S6 a measure target without its fragment; S7 script_runs_at always true; S7b the run loop no longer asking it;
# S8 the min-height compare dropped; S9 `hidden` passing on an absent control; S10 the P25 phone-bar retest removed;
# S11 a drifted step driven anyway. Control unmutated: 19 passed. Result: all 12 red (scratchpad mutate_sel.py).

def frontend_read():
    read = rc.git_reader(REPO, rc.FRONTEND_REF)
    assert read("app/src/App.jsx") is not None, (
        f"{rc.FRONTEND_REF} does not resolve in {REPO}: fetch it; this rail never passes by reading nothing")
    return read


def test_every_persona_selector_is_in_the_frontend_at_the_campaign_ref():
    problems = rc.selector_problems(SPEC, frontend_read())
    assert not problems, json.dumps(problems, indent=1)


def test_the_selector_rail_names_a_drifted_selector_and_passes_its_control():
    """Control: a stand-in frontend. With every fragment present the step is clean; a split field the source does not
    have, or a handler fragment gone from its file, is named."""
    src = ('CLOSED_FIELDS: dict[str, Field] = {f.key: f for f in [\n    _f("hour_et", "ET hour", "number", split=True),\n'
           ']}\nCLOSED = Source("closed_trades", "Closed trades", "Every trade (all).", "trades",\n    CLOSED_FIELDS, scan)\n')
    files: dict = {}
    for path, frag in rc.HANDLER_ANCHORS.values():
        files[path] = files.get(path, "") + "\n" + (frag if not frag.startswith("re:") else "> Discard them </button>")
    files[rc.SOURCES_PY] = src

    def spec_with(by):
        steps = [{"do": "builder_blank", "source": "Closed trades"}, {"do": "builder_split", "by": by}]
        return {"personas": [{"id": "P99", "data": {}, "scripts": [{"id": "P99.a", "steps": steps}]}]}

    def read(path):
        return files.get(path)

    assert rc.selector_problems(spec_with("ET hour"), read) == []
    bad = rc.selector_problems(spec_with("Hour"), read)
    assert [(x["step"], "'Hour'" in x["why"]) for x in bad] == [("P99.a.02", True)]
    live = rc.HANDLER_ANCHORS["builder-live"][0]
    files[live] = files[live].replace("builder-live", "renamed-live")
    assert any("builder-live" in x["why"] for x in rc.selector_problems(spec_with("ET hour"), read))


def _handler_source() -> str:
    text = (REPO / "tools" / "notebook_campaign" / "run_campaign.py").read_text(encoding="utf-8")
    return text[text.index("def top_dialog"):text.index("# ── wave 11 steps")]


def _handler_literals(body: str):
    """(names and texts a handler passes to a role/label/text/test-id query, attribute tokens of its CSS locators)."""
    names = set()
    for m in re.finditer(r"get_by_(role|label|text|test_id)\(([^\n]*)", body):
        kind, args = m[1], m[2]
        if kind == "role":
            names.update(re.findall(r'name=(?:re\.compile\()?r?"([^"]+)"', args))
        else:
            names.update(re.findall(r'^(?:re\.compile\()?r?"([^"]+)"', args))
    names.update(re.findall(r'filter\(has_text=(?:re\.compile\()?r?"([^"]+)"', body))
    attrs = set()
    for m in re.finditer(r"""locator\(\s*f?(["'])(.+?)\1\)""", body):
        sel = m[2]
        attrs.update((a, v.strip('"')) for a, v in re.findall(r'\[([\w-]+)(?:=("?[\w-]+))?', sel))
        attrs.update(("class", c) for c in re.findall(r"(?:^|\s)\.([A-Za-z][\w-]*)", sel))
    return names, attrs


def _loose_literals(names, attrs) -> list:
    frags = [f.lower() for _, f in rc.HANDLER_ANCHORS.values()]
    loose = []
    for n in names:
        if n in rc.HANDLER_LITERALS:
            if rc.HANDLER_LITERALS[n] not in rc.HANDLER_ANCHORS:
                loose.append(n)
            continue
        loose += [part for part in n.split("|") if not any(part.lower() in f for f in frags)]
    for a, v in attrs:
        if a == "class":
            ok = f".{v}" in rc.HANDLER_LITERALS
        elif a == "role":
            ok = any(f'role="{v}"' in f for f in frags)
        elif a == "data-testid":
            ok = any(v in f for f in frags)
        else:
            ok = any(a in f for f in frags)
        if not ok:
            loose.append(f"[{a}={v}]")
    return loose


def test_every_literal_selector_a_handler_drives_is_anchored_in_the_frontend():
    """A handler's own selectors (the ones no persona names): each literal is in some HANDLER_ANCHORS fragment, so the
    rail above reads it from the frontend. A new literal with no anchor turns this red."""
    names, attrs = _handler_literals(_handler_source())
    assert {"Insert block", "Start blank", "My tools", "Share link address", "Build a widget|Edit widget|Edit a copy"} \
        <= names                                                    # the scan sees them (control on the extractor)
    assert ("data-routine-block", "") in attrs and ("role", "checkbox") in attrs
    assert _loose_literals(names, attrs) == []
    assert _loose_literals({"Save now"}, set()) == ["Save now"]      # control: an unanchored name is caught
    assert _loose_literals(set(), {("data-gone", "")}) == ["[data-gone=]"]


def test_every_action_anchor_exists_and_names_a_real_action():
    used = {k for v in rc.ACTION_ANCHORS.values() for k in v}
    assert used <= set(rc.HANDLER_ANCHORS), used - set(rc.HANDLER_ANCHORS)
    assert set(rc.HANDLER_ANCHORS) - used == set(), set(rc.HANDLER_ANCHORS) - used
    assert set(rc.ACTION_ANCHORS) <= set(rc.ACTIONS)


def test_a_drifted_step_reads_inconclusive_before_it_drives_anything(tmp_path):
    g = rc.Campaign.__new__(rc.Campaign)
    g.caps, g.selector_drift = {}, {("P06", "P06.a.05"): ["split field 'Hour' is not in sources.py"]}
    R = type("R", (), {"p": {"id": "P06"}, "vp": "1200", "mode": "pointer", "pages": {}, "session_refusal": None,
                       "dir": tmp_path})()
    called = []
    orig = rc.ACTIONS["builder_split"]
    rc.ACTIONS["builder_split"] = lambda *a: called.append(a)
    try:
        row = g.step(R, {"title": "t"}, {"do": "builder_split", "by": "Hour"}, "P06.a.05", None)
    finally:
        rc.ACTIONS["builder_split"] = orig
    assert row["verdict"] == "INCONCLUSIVE" and "Hour" in row["error"] and not called


def test_personas_off_the_default_viewports_say_why_and_pointer_follows_the_viewport():
    default = SPEC["defaults"]["viewports"]
    assert default == ["1200", "820", "390"]
    for p in SPEC["personas"]:
        if p["viewports"] != default:
            assert p.get("viewports_why"), p["id"]
        assert set(p["viewports"]) <= set(default), p["id"]
    sizes = SPEC["viewport_sizes"]
    assert [sizes[v][0] <= rc.TOUCH_MAX for v in default] == [False, True, True]   # 1200 fine, 820/390 coarse


def test_a_not_reachable_step_is_inconclusive_with_its_reason_never_a_pass():
    with pytest.raises(rc.Inconclusive, match="aggregate.py:38"):
        rc.a_not_reachable(None, {"reason": "said only for a filter (aggregate.py:38)"}, {})
    reasons = [st for p in SPEC["personas"] for sc in p["scripts"] for st in sc["steps"] if st["do"] == "not_reachable"]
    assert reasons and all(re.search(r"\.\w+:\d", st["reason"]) for st in reasons)


FDEF_RETESTS = [   # (step, defect, viewports the step must measure at), from f-def-1-report.md
    ("P01.a.02", "D-W11-001", {"1200"}), ("P14.a.09", "D-W11-001", {"1200"}), ("P46.a.18", "D-W11-001", {"1200"}),
    ("P01.a.02", "D-W11-002", {"820", "390"}), ("P04.a.02", "D-W11-002", {"820", "390"}),
    ("P01.a.02", "D-W11-003", {"820", "390"}), ("P04.a.02", "D-W11-003", {"820", "390"}),
    ("P01.a.02", "D-W11-004", {"820", "390"}), ("P04.a.02", "D-W11-004", {"820", "390"}),
    ("P25.a.05", "D-W11-007", {"1200", "820", "390"}),
]


def _step(sid):
    p = next(x for x in SPEC["personas"] if x["id"] == sid[:3])
    sc = next(s for s in p["scripts"] if sid.startswith(s["id"] + "."))
    return sc["steps"][int(sid.rsplit(".", 1)[1]) - 1]


@pytest.mark.parametrize("sid,defect,vps", FDEF_RETESTS)
def test_the_f_def_1_retests_are_scripted_at_their_viewports(sid, defect, vps):
    covered = {v for t in _step(sid).get("measure") or [] if t["defect"] == defect for v in t["viewports"]}
    assert vps <= covered, (sid, defect, covered)


def test_the_f_def_1_retests_assert_the_fixed_values():
    def tgt(sid, defect, vp):
        return next(t for t in _step(sid)["measure"] if t["defect"] == defect and vp in t["viewports"])
    toggle = tgt("P01.a.02", "D-W11-001", "1200")
    assert (toggle["role"], toggle["name"], toggle["min_height"]) == ("button", "Add details", 24)
    assert tgt("P04.a.02", "D-W11-002", "820")["min_height"] == 44
    assert tgt("P04.a.02", "D-W11-002", "390")["hidden"] is True
    assert tgt("P04.a.02", "D-W11-003", "390")["min_height"] == 44
    fab = tgt("P04.a.02", "D-W11-004", "820")
    assert fab["min_height"] == 44 == fab["min_width"]
    m5 = _step("P25.a.05")["measure"]
    assert any(t.get("opacity") == 0.9 and {"1200", "820"} <= set(t["viewports"]) for t in m5)
    assert any(t.get("text") == "last_result" and {"1200", "820"} <= set(t["viewports"]) for t in m5)
    assert any(t.get("text_starts") == "last_result" and t.get("first_span_opacity") == 0.9
               and t["viewports"] == ["390"] for t in m5)
    assert SPEC["sentences"]["last_result"]["text"] == "Showing the last result."
    m6 = _step("P25.a.06")["measure"]
    assert any(t.get("absent") for t in m6) and any(t.get("text_not_starts") == "last_result" for t in m6)
    light = next(s for s in next(p for p in SPEC["personas"] if p["id"] == "P01")["scripts"] if s["id"] == "P01.c")
    assert light["viewports"] == ["1200"]
    assert [s["do"] for s in light["steps"]] == ["theme", "seed_note", "open_note", "theme"]
    assert light["steps"][0]["value"] == "light" and light["steps"][-1].get("restore") is True
    t = light["steps"][2]["measure"][0]
    assert (t["opacity"], t["theme"], t["min_height"]) == (0.9, "light", 24)


def test_the_new_sentences_verify_at_the_frontend_ref():
    got = rc.verify_sentences({"sentences": {k: SPEC["sentences"][k] for k in ("last_result", "split_none_hour")}}, REPO)
    assert all(v["ok"] and v["line_ok"] for v in got.values()), got


def test_a_script_with_viewports_runs_only_there():
    assert rc.script_runs_at({"viewports": ["1200"]}, "1200") is True
    assert rc.script_runs_at({"viewports": ["1200"]}, "390") is False
    assert rc.script_runs_at({}, "390") is True                           # control: no list, every viewport
    src = (REPO / "tools" / "notebook_campaign" / "run_campaign.py").read_text(encoding="utf-8")
    loop = src[src.index("for sc in scripts_at(persona):"):src.index("ran_in = once_gate(")]
    assert re.search(r"if not script_runs_at\(sc, vp\):\s*\n\s*vp_skipped\.append\(.*\)\s*\n\s*continue\n", loop), loop


class _Loc:
    def __init__(self, items):
        self.items = items

    def count(self):
        return len(self.items)

    def nth(self, i):
        return _Loc([self.items[i]])

    @property
    def first(self):
        return _Loc(self.items[:1])

    def is_visible(self):
        return self.items[0]["display"] != "none"

    def evaluate(self, js):
        return self.items[0]


def _measure_run(found, vp="820"):
    class Pg:
        def get_by_role(self, *a, **k):
            return _Loc(found)

        def get_by_test_id(self, *a):
            return _Loc(found)

    class G:
        def sentence(self, k):
            return "Showing the last result."

    class R:
        def page(self):
            return Pg()
    r = R()
    r.vp, r.g = vp, G()
    return r, {"checks": [], "read": []}


def _box(h=44, w=44, display="block", opacity="1", text="", span=None, theme="dark"):
    return {"h": h, "w": w, "display": display, "visibility": "visible", "opacity": opacity, "text": text,
            "spanOpacity": span, "theme": theme}


def test_run_measures_fails_a_short_control_and_passes_a_floored_one():
    t = {"defect": "D-W11-003", "what": "title", "role": "textbox", "name": "Note title", "viewports": ["820"],
         "min_height": 44}
    for found, vp, want in (([_box(h=34)], "820", [False]), ([_box(h=44)], "820", [True]), ([_box(h=34)], "1200", [])):
        R, row = _measure_run(found, vp)
        rc.run_measures(R, {"measure": [t]}, row)
        assert [c["ok"] for c in row["checks"]] == want, (found, vp)


def test_run_measures_hidden_needs_the_control_in_the_page_and_opacity_and_text_are_read():
    hid = {"defect": "D-W11-002", "what": "folder", "role": "combobox", "name": "Folder", "viewports": ["820"],
           "hidden": True}
    for found, want in (([], [False]), ([_box(display="none")], [True]), ([_box()], [False])):
        R, row = _measure_run(found)
        rc.run_measures(R, {"measure": [hid]}, row)
        assert [c["ok"] for c in row["checks"]] == want, found            # absent is not "hidden"
    dim = {"defect": "D-W11-007", "what": "dim", "testid": "x", "viewports": ["820"], "opacity": 0.9}
    for op, ok in (("0.9", True), ("0.75", False)):
        R, row = _measure_run([_box(opacity=op)])
        rc.run_measures(R, {"measure": [dim]}, row)
        assert [c["ok"] for c in row["checks"]] == [ok]
    bar = {"defect": "D-W11-007", "what": "bar", "testid": "x", "viewports": ["820"], "text_starts": "last_result",
           "first_span_opacity": 0.9}
    R, row = _measure_run([_box(text="Showing the last result. Win rate", span="0.9")])
    rc.run_measures(R, {"measure": [bar]}, row)
    assert [c["ok"] for c in row["checks"]] == [True, True]
    R, row = _measure_run([_box(text="Win rate", span="1")])
    rc.run_measures(R, {"measure": [bar]}, row)
    assert [c["ok"] for c in row["checks"]] == [False, False]
    fab = {"defect": "D-W11-004", "what": "fab", "role": "button", "name": "?", "viewports": ["820"],
           "min_height": 44, "absent_is": "inconclusive"}
    R, row = _measure_run([])
    rc.run_measures(R, {"measure": [fab]}, row)
    assert row["checks"] == [] and row["inconclusive"]
