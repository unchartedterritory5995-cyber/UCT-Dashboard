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


#: The preview a P39-style step reads before its Use (T-13: the client reads one, and builds its choices from it).
ONE_QUESTION_PREVIEW = {"slots": [], "cards": [], "tools": [], "questions": [{"slot": "routine_a", "use": None}]}


def library_then(stub, answer):
    def a(method, path, headers, body):
        if path.startswith("/api/j2/template-gallery/library"):
            return 200, {"templates": [{"id": "g-pmp", "title": "Pre-market prep"}], "groups": []}
        if path.endswith("/preview-mine"):
            return 200, ONE_QUESTION_PREVIEW
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
    # T-13: what the member's client sends (AdoptSheet.jsx firstChoices): a question with no suggestion is `create`
    assert rc.choices_from_preview({"questions": [{"slot": "routine_a", "use": None}]}, "T", strict=False) ==         {"routine_a": {"create": True}}
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
    used = {k for v in rc.ACTION_ANCHORS.values() for k in v} | set(rc.MEASURE_ANCHORS)
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


def _measure_run(found, vp="820", explained=None):
    class Pg:
        def get_by_role(self, *a, **k):
            return _Loc(found)

        def get_by_test_id(self, *a):
            return _Loc(found)

        def evaluate(self, js, *a):
            return explained                    # absent_explained's answer: the hub shown, a sheet open, or None

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
    R, row = _measure_run([], explained="the hub is shown")
    rc.run_measures(R, {"measure": [fab]}, row)
    assert row["checks"] == [] and row["inconclusive"]
    R, row = _measure_run([])                   # review m3: absent with nothing to explain it is a FAIL
    rc.run_measures(R, {"measure": [fab]}, row)
    assert [c["ok"] for c in row["checks"]] == [False] and not row.get("inconclusive")


def test_m7_measure_reads_every_match_or_asks_for_exactly_one():
    t = {"defect": "D-W11-003", "what": "title", "role": "textbox", "name": "Note title", "viewports": ["820"],
         "min_height": 44}
    R, row = _measure_run([_box(h=44), _box(h=30)])
    rc.run_measures(R, {"measure": [t]}, row)
    assert [c["ok"] for c in row["checks"]] == [False] and "exactly one" in row["checks"][0]["what"]
    R, row = _measure_run([_box(h=44), _box(h=30)])
    rc.run_measures(R, {"measure": [{**t, "all": True}]}, row)
    assert [c["ok"] for c in row["checks"]] == [True, False]          # every match measured


def test_m7_restore_theme_puts_an_absent_preference_back_as_absent_and_checks_the_answer():
    posted = []

    class Req:
        def __init__(self, status):
            self.status = status

        def post(self, url, data):
            posted.append(data)
            return type("A", (), {"status": self.status})()

    for status, raises in ((200, False), (500, True)):
        posted.clear()
        R = rc.Run.__new__(rc.Run)
        R.theme_was, R.pages, R.g = {"value": None}, {"main": None}, type("G", (), {"base": "http://127.0.0.1:1"})()
        R.page = lambda name="main", st=status: type("P", (), {"request": Req(st)})()
        if raises:
            with pytest.raises(rc.Inconclusive):
                R.restore_theme()
        else:
            R.restore_theme()
            assert R.theme_restored == {"value": "", "was_absent": True, "http": 200}
        assert posted == [{"key": "theme", "value": ""}]


# ── sandbox-recipe G2: the campaign's launcher never opens, reads, writes or hashes the shared data root ────────────
#
# The spy is the launcher's own process (a subprocess, so its env pins and tripwire never leak into this one): every
# os / open / glob entry point that can stat, list, hash or open a path is wrapped, plus an audit hook, and each path is
# tested with shared_root_guard.hit() against C:\data and a FAKE root. Every boot points the launcher's snapshot at the
# fake root, and the CONTROL boots it WITHOUT the flag: the spy must see the fake root read, so a spy that cannot fire
# cannot pass, and no test (nor any mutant) ever reads the live root.
#
# ⚠️ WHAT THIS PROVES, AND WHAT IT DOES NOT (review I3, ruling W11-R70 ACCEPTED): the spy stubs `api.main` and
# uvicorn, so it covers the launcher's code up to serving. The SERVED app, once imported, runs `os.path.isdir("/data")`
# (which is C:\data with the cwd on C:) in three pre-existing modules: api/services/cot_service.py (module level, before
# its COT_DB_PATH read), api/services/research/ratings_db.py (module level, before RESEARCH_RATINGS_DB_PATH) and
# api/services/single_stock_etfs.py (each resolve, before SSETF_DB_PATH). That is a directory stat only: no file under
# it is opened, read, written or hashed. The claim is therefore "never opens, reads, writes or hashes; three
# pre-existing app modules stat the directory", recorded in sandbox-recipe.md; app code is not edited here.

_SPY = r'''
import builtins, glob, io, json, os, sys, types
repo, fake, out_json = sys.argv[1], sys.argv[2], sys.argv[3]
argv = sys.argv[4:]
sys.path[:0] = [os.path.join(repo, "scripts"), repo]
import shared_root_guard as srg
ROOTS = srg.canonical_roots(["C:\\data", "/data", fake])
hits = []

def note(fn, p):
    try:
        if isinstance(p, int):
            return
        h = srg.hit(p, ROOTS)
    except Exception:
        return
    if h:
        hits.append([fn, str(p)])

def wrap(mod, name):
    orig = getattr(mod, name)
    def spy(*a, **k):
        if a:
            note(f"{mod.__name__}.{name}", a[0])
        return orig(*a, **k)
    setattr(mod, name, spy)

for n in ("stat", "lstat", "open", "scandir", "listdir", "walk", "makedirs", "mkdir", "remove", "replace", "rename",
          "access", "chmod", "utime"):
    if hasattr(os, n):
        wrap(os, n)
for n in ("exists", "isfile", "isdir", "getsize", "getmtime", "realpath", "lexists", "islink"):
    wrap(os.path, n)
wrap(builtins, "open"); wrap(io, "open"); wrap(glob, "glob"); wrap(glob, "iglob")
sys.addaudithook(lambda ev, args: note("audit:" + ev, args[0]) if ev in ("open", "os.listdir", "os.scandir",
                 "glob.glob", "os.mkdir", "os.remove", "os.rename") and args else None)

api, api_main = types.ModuleType("api"), types.ModuleType("api.main")
async def app(scope, receive, send):
    return None
api_main.app = app
api.main = api_main
sys.modules["api"], sys.modules["api.main"] = api, api_main
uv = types.ModuleType("uvicorn")
uv.run = lambda *a, **k: None
sys.modules["uvicorn"] = uv

# Whatever the mode, a snapshot the launcher takes reads the FAKE root, never the live one: so a mutant that drops
# the flag is caught by the spy without this test ever opening the live root itself.
import data_root_snapshot as drs
drs.DEFAULT_ROOT = fake
drs.snapshot.__defaults__ = (fake,)
import hub_sandbox_boot as boot
sys.argv = ["hub_sandbox_boot.py"] + argv
code = 0
try:
    boot.main()
except SystemExit as e:
    code = e.code
json.dump({"hits": hits, "code": code, "repo_root": boot.REPO_ROOT}, open(out_json, "w"))
'''


def _free_port() -> int:
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _boot_with_spy(tmp_path, *, flag: bool, app_root: bool = False) -> dict:
    import os
    import subprocess
    fake = tmp_path / "fake-shared-root"
    (fake / "sub").mkdir(parents=True)
    (fake / "sub" / "live.db").write_bytes(b"SQLite format 3\x00 fake")
    spy = tmp_path / "spy.py"
    spy.write_text(_SPY, encoding="utf-8")
    out = tmp_path / "out"
    argv = ["--data-dir", str(tmp_path / "sbx"), "--port", str(_free_port()), "--host", "127.0.0.1",
            "--log-dir", str(out)] + (["--no-shared-root-snapshot"] if flag else []) + \
        (["--app-root", str(REPO)] if app_root else [])
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    r = subprocess.run([sys.executable, str(spy), str(REPO), str(fake), str(tmp_path / "spy.json"), *argv],
                       cwd=str(REPO), env=env, capture_output=True, text=True, timeout=300)
    assert (tmp_path / "spy.json").is_file(), r.stdout[-2000:] + r.stderr[-2000:]
    got = json.loads((tmp_path / "spy.json").read_text())
    got["stdout"], got["out"] = r.stdout, out
    return got


def test_g2_the_launcher_with_the_campaign_flag_never_opens_the_shared_root(tmp_path):
    got = _boot_with_spy(tmp_path, flag=True, app_root=True)
    assert got["code"] in (0, None), got["stdout"][-1500:]
    assert "HUB SANDBOX" in got["stdout"]                                  # the whole pre-serve path ran
    assert got["hits"] == [], got["hits"][:10]
    logs = list(got["out"].glob("sandbox-integrity-*.md"))                 # the log is in --out, not the repo
    assert len(logs) == 1, list(got["out"].iterdir())
    text = logs[0].read_text(encoding="utf-8")
    assert "NOT HASHED" in text and "CLEAN" not in text.split("\n- ")[1]   # never claims a compare it did not make
    assert "integrity log: " + str(logs[0]) in got["stdout"]


def test_g2_control_the_spy_sees_a_launcher_that_reads_a_root(tmp_path):
    got = _boot_with_spy(tmp_path, flag=False)
    assert any("fake-shared-root" in p for _, p in got["hits"]), got["stdout"][-1500:]
    assert not any("fake-shared-root" not in p for _, p in got["hits"]), got["hits"][:10]   # and never the real one


def test_g2_the_launcher_refuses_a_log_dir_inside_the_census_roots(tmp_path, monkeypatch, capsys):
    """Against FAKE roots handed in as the census would (review m9: the log dir is refused against the same roots as
    the data dir), so neither this test nor a mutant that drops the refusal ever creates anything under the live one;
    `os.makedirs` is a tripwire here as well."""
    sys.path.insert(0, str(REPO / "scripts"))
    import hub_sandbox_boot as boot
    fake = tmp_path / "fake-root"
    made = []
    monkeypatch.setattr(boot.os, "makedirs", lambda *a, **k: made.append(a))
    with pytest.raises(SystemExit):
        boot._log_file(str(fake / "sandbox-runs"), None, roots=[str(fake)])
    assert "REFUSING" in capsys.readouterr().out and made == []
    boot._log_file(str(tmp_path / "out"), None, roots=[str(fake)])     # control: a sandbox folder is accepted
    assert made == [(str(tmp_path / "out"),)]
    src = (REPO / "scripts" / "hub_sandbox_boot.py").read_text(encoding="utf-8")
    assert "roots=roots if roots is not None else _census_roots()" in src   # the default is the census, not a copy


def test_g2_the_tool_launcher_accepts_the_campaigns_options():
    import subprocess
    r = subprocess.run([sys.executable, str(rc.TOOL_LAUNCHER), "--help"], capture_output=True, text=True,
                       cwd=str(REPO), timeout=120, env={**__import__("os").environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8"},
                       encoding="utf-8")
    assert r.returncode == 0, r.stderr[-800:]
    for opt in ("--app-root", "--no-shared-root-snapshot", "--log-dir"):
        assert re.search(r"(?<![\w-])" + re.escape(opt) + r"(?![\w-])", r.stdout), opt    # the option itself


def test_g2_the_harness_passes_the_campaigns_launcher_flags_through(tmp_path, monkeypatch):
    th = rc.load_tool_harness()
    seen = {}
    monkeypatch.setattr(th.subprocess, "Popen", lambda cmd, **k: seen.update(cmd=cmd, **k))
    box = th.Sandbox("x", 1, tmp_path / "y.log", extra_args=["--no-shared-root-snapshot", "--log-dir", "z"],
                     cwd=tmp_path, boot_script=tmp_path / "boot.py", env={"PATH": "p"})
    box.start()
    assert seen["cmd"][4] == str(tmp_path / "boot.py") and seen["cmd"][-3:] == ["--no-shared-root-snapshot", "--log-dir", "z"]
    assert seen["cwd"] == str(tmp_path) and seen["env"] == {"PATH": "p"}


# ── review C1: --own-sandbox works with an app root that predates the campaign's launcher options ──────────────────

OLD_TOOLING = "0ac5b99cda"      # the merge-base: its harness has no extra_args, its launcher no G2 options


def _old_app_root(tmp_path) -> Path:
    """An app root whose tools/ and scripts/ are the merge-base's (no extra_args, no --no-shared-root-snapshot),
    with the served tree's own ledger and auth.py, so the flags derive exactly as a run's do."""
    import subprocess
    app = tmp_path / "app"
    for rel in ("tools/notebook_perf_harness.py", "scripts/hub_sandbox_boot.py", "docs/notebook/perf-budgets.json"):
        f = app / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(subprocess.run(["git", "show", f"{OLD_TOOLING}:{rel}"], cwd=str(REPO), capture_output=True,
                                    text=True, encoding="utf-8", check=True).stdout, encoding="utf-8")
    for rel in ("docs/feature_flags.json", "api/routers/auth.py"):
        f = app / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(frontend_read()(rel), encoding="utf-8")
    return app


def _load_as(path: Path, name: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_c1_own_sandbox_builds_and_starts_with_an_app_root_that_lacks_the_new_options(tmp_path, monkeypatch):
    app = _old_app_root(tmp_path)
    old_h = _load_as(app / "tools" / "notebook_perf_harness.py", "old_app_harness_for_c1")
    with pytest.raises(TypeError):                     # control: the app root's own harness cannot take the options
        old_h.Sandbox("x", 1, tmp_path / "l.log", extra_args=["--no-shared-root-snapshot"])
    assert "--no-shared-root-snapshot" not in (app / "scripts" / "hub_sandbox_boot.py").read_text(encoding="utf-8")

    class FW:
        REPO = app
        NOT_MEMBER_GATES = {"NOTEBOOK_DOOR_GUARD", "J2_ATTACHMENT_BACKUP_ENABLED", "J2_ATTACHMENT_GC_ENABLED",
                            "J2_OCR_ENABLED"}

        @staticmethod
        def flag_sets():
            return {"all_names": ["NOTEBOOK_DOOR_GUARD"], "c1": []}
    th = rc.load_tool_harness()
    seen = {}

    class Proc:
        pid = 4242

        def poll(self):
            return None
    monkeypatch.setattr(th.subprocess, "Popen", lambda cmd, **k: (seen.update(cmd=cmd, **k), Proc())[1])
    monkeypatch.setattr(th.Sandbox, "wait_healthy", lambda self, *a: True)
    monkeypatch.setattr(th.Sandbox, "wait_checkpoint", lambda self, *a: True)
    monkeypatch.setattr(th, "port_busy", lambda port: False)
    monkeypatch.setenv("NOTEBOOK_POISON_FROM_SHELL", "1")
    (tmp_path / "out").mkdir()                         # a run's --out exists before its sandbox boots
    libs = (old_h, FW, None, None)                     # what load_walk_libs(<an old app root>) hands run_campaign
    sb = rc.owned_sandbox(libs, app, tmp_path / "sbx", 8999, tmp_path / "out")
    sb.start()                                         # must not raise
    cmd = seen["cmd"]
    assert cmd[4] == str(rc.TOOL_LAUNCHER)                                 # the TOOL tree's launcher
    assert cmd[cmd.index("--app-root") + 1] == str(app) and "--no-shared-root-snapshot" in cmd
    assert cmd[cmd.index("--log-dir") + 1] == str(tmp_path / "out")
    assert seen["cwd"] == str(app)                                          # serving the app root's api/
    assert "NOTEBOOK_POISON_FROM_SHELL" not in seen["env"]                  # hermetic (I6)
    assert seen["env"]["NOTEBOOK_DOOR_GUARD"] == "unknown-only"             # production's mode (I4)
    assert sb.boots[0]["launcher"] == str(rc.TOOL_LAUNCHER)


def test_c1_main_builds_the_owned_sandbox_through_the_one_factory():
    src = (REPO / "tools" / "notebook_campaign" / "run_campaign.py").read_text(encoding="utf-8")
    main = src[src.index("def main("):]
    assert "owned_sandbox(libs, app_root, data_dir, args.port, out)" in main and "OwnedSandbox(" not in main


# ── review I1: NOT HASHED is its own status, never NOT CLEAN ─────────────────────────────────────────────────────────

def _launcher_constant(name: str) -> str:
    import ast
    tree = ast.parse(rc.TOOL_LAUNCHER.read_text(encoding="utf-8"))
    return next(n.value.value for n in tree.body if isinstance(n, ast.Assign)
                and any(getattr(t, "id", None) == name for t in n.targets))


def _unhashed_log(tmp_path, labels) -> Path:
    sys.path.insert(0, str(REPO / "scripts"))
    import hub_sandbox_boot as boot
    log = tmp_path / "integ.md"
    for lab in labels:
        boot._append_unhashed(str(log), lab)
    return log


def test_i1_an_unhashed_boot_reads_not_hashed_never_not_clean(tmp_path):
    th = rc.load_tool_harness()
    assert th.NOT_HASHED == _launcher_constant("NOT_HASHED")              # the launcher's words, one authority
    log = _unhashed_log(tmp_path, [th.PRE_BOOT, th.POST_BOOT, th.SHUTDOWN])
    integ = th.read_integrity(log, [th.PRE_BOOT, th.POST_BOOT, th.SHUTDOWN])
    assert (integ["status"], integ["clean"]) == ("NOT HASHED", False)
    line = th.integrity_line(integ)
    assert line.startswith("SANDBOX INTEGRITY: NOT HASHED") and "NOT CLEAN" not in line and "db files hashed" not in line


def test_i1_controls_a_missing_checkpoint_and_a_dirty_line_still_read_as_before(tmp_path):
    th = rc.load_tool_harness()
    log = _unhashed_log(tmp_path, [th.PRE_BOOT, th.POST_BOOT])
    assert th.read_integrity(log, [th.PRE_BOOT, th.POST_BOOT, th.SHUTDOWN])["status"] == "INCOMPLETE"
    with open(log, "a", encoding="utf-8") as f:
        f.write("- `2026-10-26 00:00:00`  **shutdown** \u2014 C:\\x, 3 db files \u2014 **1 FILE(S) CHANGED**\n")
    assert th.read_integrity(log, [th.PRE_BOOT, th.POST_BOOT, th.SHUTDOWN])["status"] == "NOT CLEAN"


def test_i1_the_campaign_records_the_status_in_run_json(tmp_path):
    th = rc.load_tool_harness()
    log = _unhashed_log(tmp_path, [th.PRE_BOOT, th.POST_BOOT, th.SHUTDOWN])
    sb = rc.OwnedSandbox.__new__(rc.OwnedSandbox)
    sb.th, sb.out, sb.boots = th, tmp_path, [{"boot": 1}]
    sb.sb = type("SB", (), {"stop": lambda self: "graceful", "integrity_path": lambda self: str(log)})()
    sb.stop()
    assert sb.boots[0]["integrity"] == "NOT HASHED" and "NOT CLEAN" not in sb.boots[0]["first_line"]


# ── review I2: the seeder's schema boot never hashes or logs into the shared root or the app root by default ───────

def test_i2_the_default_schema_boot_is_the_clock_launcher_and_hashing_is_an_opt_in():
    args = sm.argparse.Namespace(schema_via_hub_launcher_hashing_shared_root=False, schema_via_clock_launcher=False)
    assert sm.schema_booter(args) is sm.boot_schema_clock
    args.schema_via_hub_launcher_hashing_shared_root = True
    assert sm.schema_booter(args) is sm.boot_schema                        # control: the explicit opt-in
    import inspect
    body = inspect.getsource(sm.boot_schema_clock)
    assert "sandbox_clock.py" in body and "hub_sandbox_boot" not in body and ".Sandbox(" not in body
    assert "DEFAULT_ROOT" not in body and "data_root_snapshot" not in body
    src = (REPO / "tools" / "notebook_campaign" / "seed_members.py").read_text(encoding="utf-8")
    assert "schema_booter(args)(app_root, data_dir, args.schema_port, data_dir)" in src


# ── G3 / review I4 / I6: production's served flags, at production's values, on a hermetic env ──────────────────────
#
# Mutants (scratchpad mutate_g3.py and mutate_r1.py): campaign_env ignoring `armed_web`; armed_on_web ignoring `where`
# or `status`; non-member gates kept; one sandbox back on flag_sets; the mode value served as "1"; the base env
# copying the whole shell; MEMBER_VISIBLE dropped. Each turned this block red.

def _g3_fw(tmp_path, flags: dict, all_names: list, c1: list, not_member=(), auth_py: str | None = None):
    (tmp_path / "docs").mkdir(exist_ok=True)
    (tmp_path / "docs" / "feature_flags.json").write_text(json.dumps({"flags": flags}), encoding="utf-8")
    if auth_py is not None:
        (tmp_path / "api" / "routers").mkdir(parents=True, exist_ok=True)
        (tmp_path / "api" / "routers" / "auth.py").write_text(auth_py, encoding="utf-8")

    class FW:
        REPO = tmp_path
        NOT_MEMBER_GATES = set(not_member)

        @staticmethod
        def flag_sets():
            return {"all_names": list(all_names), "c1": list(c1)}
    return FW


def _served(fs, base=None) -> dict:
    return rc.campaign_env(fs, base=base if base is not None else {"PATH": "x"})[0]


def test_g3_an_armed_web_flag_that_is_not_a_notebook_gate_is_served_on(tmp_path):
    flags = {"NOTEBOOK_EXAMPLE_NOTES_ENABLED": {"status": "armed", "where": ["web"]},
             "NOTEBOOK_WORKER_ONLY": {"status": "armed", "where": ["worker"]},
             "NOTEBOOK_DARK_ONE": {"status": "dark", "where": ["web"]},
             "J2_ATTACHMENT_GC_ENABLED": {"status": "armed", "where": ["web"]},
             "J2_OCR_ENABLED": {"status": "armed", "where": ["web"]},
             "NOTEBOOK_GATE_A": {"status": "armed", "where": ["web"]}}
    fw = _g3_fw(tmp_path, flags, all_names=sorted(flags), c1=["NOTEBOOK_GATE_A"],
                not_member={"J2_ATTACHMENT_GC_ENABLED", "J2_OCR_ENABLED"})
    fs = rc.campaign_flag_sets(fw)
    on = _served(fs)
    assert {"NOTEBOOK_EXAMPLE_NOTES_ENABLED", "NOTEBOOK_GATE_A", rc.W8, rc.W11, "J2_OCR_ENABLED"} <= set(on)
    assert on["J2_OCR_ENABLED"] == "1"                                      # member-visible: follows production (I6)
    # controls: a worker-only, a dark and a non-member gate stay off
    assert not set(on) & {"NOTEBOOK_WORKER_ONLY", "NOTEBOOK_DARK_ONE", "J2_ATTACHMENT_GC_ENABLED"}


def test_i4_a_mode_flag_is_served_at_productions_recorded_value(tmp_path):
    """The served tree's own ledger and auth.py (at FRONTEND_REF): NOTEBOOK_DOOR_GUARD is armed on web in mode
    `unknown-only`, so the campaign serves exactly that, never "1" and never the code default `full`."""
    read = frontend_read()
    led = json.loads(read("docs/feature_flags.json"))["flags"]
    fw = _g3_fw(tmp_path, led, all_names=["NOTEBOOK_DOOR_GUARD"], c1=[], auth_py=read("api/routers/auth.py"),
                not_member={"NOTEBOOK_DOOR_GUARD", "J2_OCR_ENABLED"})
    fs = rc.campaign_flag_sets(fw)
    assert fs["mode_problems"] == [] and fs["modes"] == {"NOTEBOOK_DOOR_GUARD": "unknown-only"}
    assert _served(fs)["NOTEBOOK_DOOR_GUARD"] == "unknown-only"
    # parity for every valued flag: each NOTEBOOK_MODE_FLAGS name armed on web is served at a value auth.py allows
    for name, allowed in rc.mode_flags(tmp_path / "api" / "routers" / "auth.py").items():
        if led.get(name, {}).get("status") == "armed":
            assert _served(fs)[name] in allowed and _served(fs)[name] != "1", name


def test_i4_an_unverified_mode_value_refuses_the_boot(tmp_path, monkeypatch):
    auth = ('A = "full"\nB = "unknown-only"\nNOTEBOOK_MODE_FLAGS = {\n    "NOTEBOOK_DOOR_GUARD": (A, (A, B)),\n'
            '    "NOTEBOOK_OTHER_MODE": (A, (A, B)),\n}\n')
    led = {"NOTEBOOK_DOOR_GUARD": {"status": "armed", "where": ["web"], "note": "nothing quoted here"},
           "NOTEBOOK_OTHER_MODE": {"status": "armed", "where": ["web"], "note": ""}}
    fs = rc.campaign_flag_sets(_g3_fw(tmp_path, led, all_names=sorted(led), c1=[], auth_py=auth))
    assert len(fs["mode_problems"]) == 2                                   # the quote missing; no recorded value
    with pytest.raises(SystemExit, match="mode flag"):
        rc.campaign_env(fs)


def test_i6_the_served_env_is_hermetic(tmp_path):
    fw = _g3_fw(tmp_path, {"NOTEBOOK_GATE_A": {"status": "armed", "where": ["web"]}}, all_names=["NOTEBOOK_GATE_A"],
                c1=["NOTEBOOK_GATE_A"])
    fs = rc.campaign_flag_sets(fw)
    shell = {"PATH": "C:\\py", "SystemRoot": "C:\\Windows", "TEMP": "C:\\t", "APPDATA": "C:\\a",
             "NOTEBOOK_POISON_ENABLED": "1", "NOTEBOOK_DOOR_GUARD": "full", "ANTHROPIC_API_KEY": "sk-x",
             "RAILWAY_ENVIRONMENT": "production", "DATA_DIR": "C:\\data", "COMPASS_AUTOMATION_ENABLED": "1"}
    env, applied = rc.campaign_env(fs, base=shell)
    for leak in ("NOTEBOOK_POISON_ENABLED", "ANTHROPIC_API_KEY", "RAILWAY_ENVIRONMENT", "DATA_DIR",
                 "COMPASS_AUTOMATION_ENABLED", "NOTEBOOK_DOOR_GUARD"):
        assert leak not in env, leak
    assert env["PATH"] == "C:\\py" and env["SystemRoot"] == "C:\\Windows" and env["NOTEBOOK_GATE_A"] == "1"
    assert "NOTEBOOK_GATE_A=1" in applied
    import os
    before = dict(os.environ)
    rc.campaign_env(fs)
    assert dict(os.environ) == before                                      # never writes this process's env


def test_g3_the_served_trees_ledger_arms_example_notes_so_the_campaign_serves_them():
    """The real ledger (this tree's docs/feature_flags.json, the file flag_sets reads): example notes are armed on web
    in production, so P48's example pages are checked against production's shape."""
    led = json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"]
    led = led if isinstance(led, dict) else {f.get("name"): f for f in led}
    assert "NOTEBOOK_EXAMPLE_NOTES_ENABLED" in rc.armed_on_web(led, ())


def test_g3_both_campaign_sandboxes_read_the_derived_flag_sets_and_the_hermetic_env():
    src = (REPO / "tools" / "notebook_campaign" / "run_campaign.py").read_text(encoding="utf-8")
    assert src.count("self.fs = campaign_flag_sets(fw)") == 2 and "self.fs = fw.flag_sets()" not in src
    assert src.count("env, flags = campaign_env(self.fs") == 1 and "env=env" in src
    assert "os.environ.update(" not in src[src.index("def campaign_env"):src.index("def owned_sandbox")]


# ── sandbox-recipe G4: every sentence is read from the merged tree the campaign serves ───────────────────────────────
#
# Mutants (scratchpad mutate_g4.py): one sentence back on origin/feat/notebook-widgets-p2-be; a ref that does not
# exist; a cited line moved off its fragment; ref_resolves answering True for anything. Each turned this block red.

def test_g4_every_sentence_source_ref_is_the_campaign_ref_and_resolves():
    refs = rc.sentence_refs(SPEC)
    assert refs, "no sentence is read at a ref: the rail would pass on nothing"
    assert set(refs) == {rc.FRONTEND_REF}, {r: v for r, v in refs.items() if r != rc.FRONTEND_REF}
    assert all(rc.ref_resolves(REPO, r) for r in refs)
    assert rc.ref_resolves(REPO, "origin/no-such-branch-for-this-rail") is False          # control


def test_g4_every_sentence_is_in_the_merged_tree_on_its_cited_line():
    """At FRONTEND_REF (what the PR branch serves), whether the source names the ref or is read from the app root at
    run time: the fragment is in the file and on the line the persona file cites."""
    read = frontend_read()
    bad = {}
    for k, s in SPEC["sentences"].items():
        m = rc._SOURCE_RE.match(s["source"])
        text = read(m["path"])
        frag = s.get("fragment") or s["text"]
        if text is None or frag not in text:
            bad[k] = f"{frag!r} not in {m['path']}"
            continue
        lines = text.splitlines()
        n = int(m["line"]) if m["line"] else 0
        if not rc.fragment_on_line(lines, n, frag):                     # the WHOLE fragment (review m6)
            bad[k] = f"line {n} of {m['path']} does not hold {frag[:24]!r}"
    assert not bad, bad


def test_g4_a_sentence_on_another_ref_is_named():
    spec = {"sentences": {"a": {"text": "x", "source": "origin/feat/notebook-widgets-p2-be:api/x.py:1"},
                          "b": {"text": "y", "source": "api/y.py:2"}}}
    assert rc.sentence_refs(spec) == {"origin/feat/notebook-widgets-p2-be": ["a"]}


# ── fix round 1 (review-campaign-g2g4.md, ruling W11-R70): the remaining rails ─────────────────────────────────────

def test_m6_the_whole_fragment_must_be_on_its_line():
    lines = ["const SAMPLE_LABEL = 'Sample data' // the label", "next"]
    assert rc.fragment_on_line(lines, 1, "SAMPLE_LABEL = 'Sample data'")
    assert not rc.fragment_on_line(lines, 1, "SAMPLE_LABEL = 'Sample data (drifted)'")    # same 24-char prefix
    assert not rc.fragment_on_line(lines, 2, "SAMPLE_LABEL")
    assert rc.fragment_on_line(lines, 1, "the label\nnext")                               # a two-line fragment


def test_m6_a_run_reads_every_sentence_from_the_tree_it_serves(tmp_path):
    (tmp_path / "x.js").write_text("const A = 'served words'\n", encoding="utf-8")
    spec = {"sentences": {"a": {"text": "served words", "source": "origin/feat/no-such-ref-at-all:x.js:1",
                                "fragment": "A = 'served words'"}}}
    assert rc.verify_sentences(spec, tmp_path, served_tree=True)["a"]["ok"] is True
    assert rc.verify_sentences(spec, tmp_path)["a"]["ok"] is False          # control: the ref read is unreadable
    src = (REPO / "tools" / "notebook_campaign" / "run_campaign.py").read_text(encoding="utf-8")
    assert "g.sentences = verify_sentences(spec, app_root, served_tree=True)" in src


def test_i5_the_live_region_is_summary_only_at_p25_a05_and_the_loading_and_retry_retests_are_scripted():
    m5 = _step("P25.a.05")["measure"]
    live = [t for t in m5 if t.get("testid") == "builder-live"]
    assert live and live[0]["text_not_contains"] == "last_result" and set(live[0]["viewports"]) == {"1200", "820", "390"}
    b = next(s for s in next(p for p in SPEC["personas"] if p["id"] == "P25")["scripts"] if s["id"] == "P25.b")
    dos = [s["do"] for s in b["steps"]]
    assert "axe_while_loading" in dos and dos.index("builder_blank") < dos.index("axe_while_loading")
    retry = next(s for s in b["steps"] if s["do"] == "retry_kept_preview")       # scripted since round 2 (n6)
    assert retry["samples"] >= 3 and "PreviewPane.jsx:" in retry["why"]


def test_i5_axe_while_loading_never_passes_without_seeing_the_loading_state():
    src = (REPO / "tools" / "notebook_campaign" / "run_campaign.py").read_text(encoding="utf-8")
    body = src[src.index("def a_axe_while_loading"):src.index("def open_phone_preview")]
    assert "raise Inconclusive(\"the kept preview was never seen loading" in body
    assert "runOnly: { type: 'rule', values: ['color-contrast'] }" in src
    assert "axe_contrast_verdict(got)" in body                        # checked nothing / incomplete: not a pass


def test_m2_p04_checks_the_split_it_made_and_copy_is_quoted():
    assert _step("P04.a.05")["live_re"] == "(?i)split by account"
    for sid in ("P04.a.05", "P06.a.05", "P23.a.05", "P30.a.05", "P01.b.04", "P05.a.04", "P10.a.05", "P48.a.01"):
        assert _step(sid).get("copy_sources"), sid


def test_m4_every_step_has_a_validation_record_and_the_counts_add_up():
    v = SPEC["validation"]
    assert v["ref"].startswith(rc.FRONTEND_REF)
    every = {f"{sc['id']}.{i + 1:02d}" for p in SPEC["personas"] for sc in p["scripts"] for i in range(len(sc["steps"]))}
    assert set(v["steps"]) == every
    kinds = {k: sum(1 for x in v["steps"].values() if x.split(":")[0].split(" +")[0] == k)
             for k in ("ok", "fixed", "not_reachable", "http", "added")}
    assert sum(kinds.values()) == len(every)
    nr = {sid for sid, x in v["steps"].items() if x == "not_reachable"}
    assert nr == {f"{sc['id']}.{i + 1:02d}" for p in SPEC["personas"] for sc in p["scripts"]
                  for i, st in enumerate(sc["steps"]) if st["do"] in ("not_reachable", "noop")}


def test_m3_a_run_lists_every_inconclusive_reason():
    src = (REPO / "tools" / "notebook_campaign" / "run_campaign.py").read_text(encoding="utf-8")
    assert 'res["inconclusive"] = [{"step": x["step"], "why": x.get("error") or ""} for x in R.steps' in src
    assert 'print(f"    INCONCLUSIVE {x[\'step\']}' in src


# MUTANT LEDGER, ALL ROUNDS (review m8; re-run from the ledger folder's mutate_*.py; each turned the named rail red and
# the file was restored byte for byte from a copy, never by git checkout):
#   persona/selector (mutate_sel.py): S1 P06 by "Hour"; S2 P23 source "Closed trades"; S3 a card not on the shelf;
#     S4 the builder-live anchor renamed; S5 a handler role name not anchored; S6 a measure target without its
#     fragment; S7 script_runs_at always true; S7b the loop not asking it; S8 the min-height compare dropped; S9
#     `hidden` passing on an absent control; S10 the P25 phone-bar retest removed; S11 a drifted step driven anyway.
#   G2 (mutate_g2.py): M1 the flag not skipping the snapshot; M2 the campaign dropping the flag; M3 the log in the
#     repo again; M4 the harness dropping extra args; M5 a log dir in the shared root accepted (fake roots only).
#   G3 (mutate_g3.py): M1 campaign_env ignoring armed_web; M2 `where` ignored; M3 `status` ignored; M4 non-member
#     gates kept; M5 one sandbox back on flag_sets.
#   G4 (mutate_g4.py): M1 back on the -be ref; M2 a ref that does not exist; M3 a cited line moved; M4 ref_resolves
#     always true.
#   fix round 1 (mutate_r1.py): C1a the app root's harness used for the boot; C1b --app-root dropped; I1a NOT HASHED
#     read as dirty; I1b the status not recorded; I2 the hashing schema boot as default; I4a the mode value not
#     applied; I4b the ledger quote not checked; I6a the whole shell copied; I6b MEMBER_VISIBLE dropped; m3 an absent
#     FAB always excused; m7a exactly-one dropped; m7b absent restored as "dark"; m9 the guard's default roots again;
#     L --app-root gone from the launcher; C1c the kill-list parity check disabled; m6 the 24-char line check back; I5 the live-region target removed; m2 P04's
#     regex back; m4 a step without a validation record.


def test_c1_a_tool_launcher_with_a_shorter_kill_list_than_the_app_roots_refuses(tmp_path, capsys):
    sys.path.insert(0, str(REPO / "scripts"))
    import hub_sandbox_boot as boot
    app = tmp_path / "app"
    (app / "scripts").mkdir(parents=True)
    mine = sorted(boot.KILL_LIST)
    (app / "scripts" / "hub_sandbox_boot.py").write_text(
        "KILL_LIST = {" + ", ".join(f"{k!r}: '0'" for k in mine + ["NEW_OUTBOUND_JOB_ENABLED"]) + "}\n",
        encoding="utf-8")
    saved_path, saved_root = list(sys.path), boot.REPO_ROOT
    try:
        with pytest.raises(SystemExit):
            boot._use_app_root(str(app))
        assert "NEW_OUTBOUND_JOB_ENABLED" in capsys.readouterr().out
        (app / "scripts" / "hub_sandbox_boot.py").write_text(
            "KILL_LIST = {" + ", ".join(f"{k!r}: '0'" for k in mine) + "}\n", encoding="utf-8")
        assert boot._use_app_root(str(app)) == str(app)                  # control: the same kill list is served
        assert sys.path[0] == str(app) and boot.REPO_ROOT == str(app)
    finally:
        sys.path[:] = saved_path
        boot.REPO_ROOT = saved_root


# ── fix round 2 (scoped re-review of b004a0fb5b): N1, n2, n5, n6, n7 ─────────────────────────────────────────────
#
# Mutants (ledger campaign-mutants/mutate_r2.py): N1 PYTHONDONTWRITEBYTECODE not set; n2 the schema boot back on the
# shell's env; n5a axe `incomplete` ignored; n5b Network.enable dropped; n6a the "nothing new announced" check
# dropped; n6b the cue check dropped; n7a samples ignored; n7b an empty live region passing. Each turned this red.

def test_n1_the_served_env_never_writes_bytecode_into_the_app_root(tmp_path):
    fw = _g3_fw(tmp_path, {}, all_names=[], c1=[])
    fs = rc.campaign_flag_sets(fw)
    for base in ({"PATH": "x"}, {"PATH": "x", "PYTHONDONTWRITEBYTECODE": "0"}):
        assert rc.campaign_env(fs, base=base)[0]["PYTHONDONTWRITEBYTECODE"] == "1"


def test_n2_the_schema_boot_uses_the_hermetic_campaign_env(tmp_path, monkeypatch):
    fw = _g3_fw(tmp_path, {"NOTEBOOK_GATE_A": {"status": "armed", "where": ["web"]}}, all_names=["NOTEBOOK_GATE_A"],
                c1=["NOTEBOOK_GATE_A"])
    monkeypatch.setattr(rc, "load_walk_libs", lambda app_root: (None, fw, None, None))
    monkeypatch.setenv("NOTEBOOK_POISON_FROM_SHELL", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-poison")
    env = sm.schema_env(tmp_path)
    assert "NOTEBOOK_POISON_FROM_SHELL" not in env and "ANTHROPIC_API_KEY" not in env
    assert env["NOTEBOOK_GATE_A"] == "1" and env["PYTHONDONTWRITEBYTECODE"] == "1"
    import inspect
    assert "env=schema_env(app_root)" in inspect.getsource(sm.boot_schema_clock)


def test_n5_axe_incomplete_is_inconclusive_and_the_network_domain_is_enabled_first():
    assert "'incomplete'" in rc.AXE_CONTRAST_JS and "incomplete:" in rc.AXE_CONTRAST_JS
    src = (REPO / "tools" / "notebook_campaign" / "run_campaign.py").read_text(encoding="utf-8")
    body = src[src.index("def a_axe_while_loading"):src.index("#: The server's busy refusal")]
    assert rc.axe_contrast_verdict({"violations": [], "passes": 3, "incomplete": 1})[1]          # never a pass
    assert rc.axe_contrast_verdict({"violations": [], "passes": 0, "incomplete": 0})[1]
    assert rc.axe_contrast_verdict({"violations": [], "passes": 3, "incomplete": 0}) == (True, None)   # control
    assert rc.axe_contrast_verdict({"violations": [{"id": "color-contrast"}], "passes": 3})[0] is False
    assert "ok, unsure = axe_contrast_verdict(got)" in body and "raise Inconclusive(unsure)" in body
    assert body.index('cdp.send("Network.enable")') < body.index('"Network.emulateNetworkConditions"')


class _RetryWorld:
    """A stand-in page for a_retry_kept_preview: the CDP Fetch handler is invoked when the source tile or Try again is
    pressed (each is one preview request the browser answers busy), and each evaluate() returns the next sample."""

    def __init__(self, samples, before, try_again=True):
        self.samples, self.before, self.try_again = list(samples), before, try_again
        self.handler, self.sent, self.started = None, [], False

    # the CDP session
    def on(self, ev, fn):
        self.handler = fn

    def send(self, method, params=None):
        self.sent.append(method)

    def detach(self):
        pass

    # the page
    def evaluate(self, js, *a):
        if js == rc.BUSY_JS:
            return False                        # no preview is redrawing (T-7's settle reads it)
        if not self.started:
            return self.before                  # before the failure: the settled baseline, as often as it is read
        return self.samples.pop(0) if self.samples else self.before

    def wait_for_timeout(self, ms):
        pass

    def get_by_role(self, role, name=None, exact=False):
        world = self

        class Loc:
            def filter(self, **k):
                return self

            @property
            def last(self):
                return self

            @property
            def first(self):
                return self

            def wait_for(self, *a, **k):
                if name == "Try again" and not world.try_again:
                    raise TimeoutError("no Try again")

            def click(self, *a, **k):
                world.started = True
                world.handler({"requestId": f"r{len(world.sent)}"})

            def get_by_role(self, *a, **k):
                return world.get_by_role(*a, **k)
        return Loc()


def _retry_run(world, vp=(1200, 800)):
    R = type("R", (), {})()
    R.size, R.keyboard, R.touch = vp, False, False
    R.page = lambda name="main": world
    R.contexts = {"main": type("C", (), {"new_cdp_session": lambda self, pg: world})()}
    R.g = type("G", (), {"sentence": lambda self, k: "Showing the last result."})()
    return R


LAST = "Showing the last result."
SUMMARY = "Net P&L for closed trades in the last 90 days, all accounts. 40 trades."


def test_n6_the_retry_keeps_the_line_and_announces_nothing_new():
    good = {"live": SUMMARY, "line": LAST, "bar": None}
    w = _RetryWorld([good] * 7, before={"live": SUMMARY, "line": None, "bar": None})
    row = {"checks": [], "read": []}
    rc.a_retry_kept_preview(_retry_run(w), {"source": "Closed trades", "samples": 6, "interval_ms": 1,
                                            "settle_ms": 1}, row)
    assert row["checks"] and all(c["ok"] for c in row["checks"]), [c for c in row["checks"] if not c["ok"]]
    assert "Fetch.enable" in w.sent and "Fetch.fulfillRequest" in w.sent and "Fetch.disable" in w.sent


@pytest.mark.parametrize("bad,why", [
    ({"live": "Showing the last result. " + SUMMARY, "line": LAST, "bar": None}, "announced"),
    ({"live": "", "line": LAST, "bar": None}, "emptied"),
    ({"live": SUMMARY, "line": None, "bar": None}, "the line went"),
])
def test_n6_controls_a_changed_live_region_or_a_lost_line_fails(bad, why):
    good = {"live": SUMMARY, "line": LAST, "bar": None}
    w = _RetryWorld([good, good, bad, good, good, good, good], before={"live": SUMMARY, "line": None, "bar": None})
    row = {"checks": [], "read": []}
    rc.a_retry_kept_preview(_retry_run(w), {"source": "Closed trades", "samples": 6, "interval_ms": 1,
                                            "settle_ms": 1}, row)
    assert not all(c["ok"] for c in row["checks"]), why


def test_n6_a_retry_that_cannot_be_drawn_is_inconclusive():
    w = _RetryWorld([], before={"live": SUMMARY, "line": None, "bar": None}, try_again=False)
    with pytest.raises(rc.Inconclusive, match="Try again never drew"):
        rc.a_retry_kept_preview(_retry_run(w), {"source": "Closed trades", "settle_ms": 1}, {"checks": [], "read": []})
    w = _RetryWorld([], before={"live": "", "line": None, "bar": None})
    with pytest.raises(rc.Inconclusive, match="never settled"):          # T-7: an empty region is no baseline
        rc.a_retry_kept_preview(_retry_run(w), {"source": "Closed trades", "settle_ms": 1, "settle_timeout_ms": 300},
                                {"checks": [], "read": []})


def test_n6_the_retry_is_scripted_in_p25_b():
    b = next(s for s in next(p for p in SPEC["personas"] if p["id"] == "P25")["scripts"] if s["id"] == "P25.b")
    dos = [s["do"] for s in b["steps"]]
    assert "retry_kept_preview" in dos and "not_reachable" not in dos
    assert dos.index("axe_while_loading") < dos.index("retry_kept_preview")


class _Seq(_Loc):
    """A locator whose evaluate() answers the next value each call (one per sample)."""

    def __init__(self, values):
        super().__init__([values[0]])
        self.values = list(values)

    def nth(self, i):
        return self

    def evaluate(self, js):
        return self.values.pop(0) if len(self.values) > 1 else self.values[0]


def test_n7_the_live_region_is_sampled_and_an_empty_one_fails():
    t = {"defect": "D-W11-007", "what": "live", "testid": "builder-live", "viewports": ["820"], "samples": 3,
         "interval_ms": 1, "text_nonempty": True, "text_not_contains": "last_result"}
    for values, want in (([_box(text=SUMMARY)] * 3, [True, True] * 3),
                         ([_box(text=SUMMARY), _box(text=""), _box(text=SUMMARY)], [True, True, False, True, True, True]),
                         ([_box(text=SUMMARY), _box(text=LAST), _box(text=SUMMARY)], [True, True, True, False, True, True])):
        R, row = _measure_run([])
        pg = R.page()
        seq = _Seq(values)
        type(pg).get_by_test_id = lambda self, *a: seq
        type(pg).wait_for_timeout = lambda self, ms: None
        R.page = lambda name="main", pg=pg: pg
        rc.run_measures(R, {"measure": [t]}, row)
        assert [c["ok"] for c in row["checks"]] == want, [c["what"] for c in row["checks"]]
    p25 = next(x for x in _step("P25.a.05")["measure"] if x.get("testid") == "builder-live")
    assert p25["samples"] >= 3 and p25["text_nonempty"] is True


# ── W11-R81 tooling defects (the full campaign run, scratchpad campaign-run/triage.md) ───────────────────────────────
#
# T-1: a list `clock` crashed the seeder (seed_members.py persona_clock). Mutants (campaign-mutants/mutate_r81.py):
# T1a persona_clock back to fromisoformat(raw); T1b the latest instant instead of the earliest; T1c an instant with no
# offset accepted.

def test_t1_every_persona_clock_seeds_and_a_list_seeds_at_its_earliest_instant():
    defaults = SPEC["defaults"]
    for p in SPEC["personas"]:
        got = sm.persona_clock(p, defaults)                              # never raises (P20, P37, P38, P41 are lists)
        assert got.tzinfo is not None, p["id"]
        if isinstance(p.get("clock"), list):
            assert got == min(sm.datetime.fromisoformat(x) for x in p["clock"]), p["id"]
            assert all(got <= sm.datetime.fromisoformat(x) for x in p["clock"])
    p = {"id": "PX", "clock": ["2026-11-24T21:00:00-05:00", "2026-11-22T21:00:00-05:00"]}
    assert sm.persona_clock(p, defaults).isoformat() == "2026-11-22T21:00:00-05:00"      # order-free: the earliest
    assert sm.persona_clock({"id": "PY"}, defaults) == sm.datetime.fromisoformat(defaults["clock"])   # control
    for bad in (["2026-11-22T21:00:00"], [1], "2026-11-22T21:00:00"):
        with pytest.raises(SystemExit):
            sm.persona_clock({"id": "PZ", "clock": bad}, defaults)
    import inspect
    assert '"clock_instants": [x.isoformat() for x in persona_instants(p, defaults)]' in inspect.getsource(sm.seed_member)


# T-2..T-20 (W11-R81). Mutants for every rail below: campaign-mutants/mutate_r81.py (each turned its rail red).

class _TourPage:
    """A stand-in page for dismiss_tour: the tour card is there (or not), its Skip tour button records the press."""

    def __init__(self, present=True, closes=True):
        self.present, self.closes, self.pressed, self.waited = present, closes, 0, 0

    def locator(self, sel):
        page = self

        class Card:
            def filter(self, **k):
                return self

            @property
            def first(self):
                return self

            def wait_for(self, state="visible", timeout=None):
                page.waited += 1
                if state == "visible" and not page.present:
                    raise TimeoutError("no tour")
                if state == "hidden" and not (page.closes and page.pressed):
                    raise TimeoutError("still open")

            def get_by_role(self, role, name=None, exact=False):
                class Skip:
                    def wait_for(self, *a, **k):
                        pass

                    def click(self, *a, **k):
                        page.pressed += 1
                return Skip()
        return Card()

    def get_by_role(self, *a, **k):
        return None


def _tour_run(notes=None):
    R = type("R", (), {})()
    R.tour_checked, R.notes_seeded, R.keyboard, R.touch = False, 0, False, False
    R.p = {"id": "P22", "data": {"notes": notes} if notes else {}}
    return R


def test_t2_the_first_run_tour_is_dismissed_through_skip_tour_once_per_run():
    pg, R, row = _TourPage(), _tour_run(), {"read": []}
    assert rc.dismiss_tour(R, pg, row) is True and pg.pressed == 1
    assert row["read"] == [{"what": "first-run tour", "text": "dismissed through 'Skip tour'"}]
    assert rc.dismiss_tour(R, pg, row) is False and pg.pressed == 1          # once per run
    pg = _TourPage(present=False)
    assert rc.dismiss_tour(_tour_run(), pg, {"read": []}) is False and pg.pressed == 0   # control: no tour
    pg = _TourPage()
    assert rc.dismiss_tour(_tour_run(notes={"n": 3}), pg, {"read": []}) is False and pg.waited == 0   # has notes
    with pytest.raises(rc.Inconclusive, match="did not close"):
        rc.dismiss_tour(_tour_run(), _TourPage(closes=False), {"read": []})
    src = (REPO / "tools" / "notebook_campaign" / "run_campaign.py").read_text(encoding="utf-8")
    assert "    dismiss_tour(R, pg, row)\n    return ms" in src.replace("\r\n", "\n")       # every goto looks for it
    assert rc.TOUR_SKIP == "Skip tour"


def test_t3_a_measure_target_finds_the_toggle_under_both_real_names():
    seen = {}

    class Pg:
        def get_by_role(self, role, name=None, exact=False, include_hidden=False):
            seen.update(role=role, name=name, exact=exact)
            return "loc"
    rc.measure_locator(None, Pg(), {"role": "button", "name": ["Add details", "Details"]})
    assert seen["name"].match("Details") and seen["name"].match("Add details") and not seen["name"].match("Detailsx")
    rc.measure_locator(None, Pg(), {"role": "button", "name": "Add details"})
    assert (seen["name"], seen["exact"]) == ("Add details", True)                  # control: one name stays exact
    for sid in ("P14.a.09", "P46.a.02", "P46.a.18"):
        t = next(x for x in _step(sid)["measure"] if x["defect"] == "D-W11-001")
        assert t["name"] == ["Add details", "Details"], sid


def test_t4_the_specd_count_sentences_are_not_zeros_but_other_zeros_still_are():
    assert rc.zeros_in("Win rate. Not enough trades yet (0)") == []
    assert rc.zeros_in("Net P&L for closed trades in the last 90 days, all accounts. 0 trades.") == []
    assert rc.zeros_in("You made 0 trades today") == ["0 trades"]                 # control: a bare zero count
    assert rc.zeros_in("Win rate (0)") == ["(0)"]
    read = frontend_read()
    for rx, path, frag in rc.ZERO_EXEMPT:
        assert frag in (read(path) or ""), (path, frag)                          # each exemption quotes its source


def test_t5_p05_seeds_every_trade_inside_the_equity_curves_90_days():
    spec = next(p for p in SPEC["personas"] if p["id"] == "P05")["data"]["trades"]
    assert spec["n"] > 5000
    # n sessions span at most n * 7/5 calendar days, plus at most 10 exchange holidays in any 90-day window
    assert spec["sessions"] * 7 / 5 + 10 < 90, spec


def test_t6_a_sentence_in_the_preview_pane_is_found_and_the_read_reaches_it():
    long = "x " * 1200 + "None of these trades have a value for ET hour yet."
    assert rc.sentence_in("None of these trades have a value for ET hour yet.", long)
    assert "None of these trades have a value for ET hour yet." in rc.text_window("None of these trades", long)
    assert not rc.sentence_in("None of these trades have a value for Setup yet.", long)      # control
    assert rc.READ_TEXT_MAX >= 6000


class _SettlePage:
    def __init__(self, lives, busy):
        self.lives, self.busy = list(lives), list(busy)

    def evaluate(self, js):
        if js == rc.BUSY_JS:
            return self.busy.pop(0) if len(self.busy) > 1 else self.busy[0]
        live = self.lives.pop(0) if len(self.lives) > 1 else self.lives[0]
        return {"live": live, "line": None, "bar": None}

    def wait_for_timeout(self, ms):
        import time as _t
        _t.sleep(ms / 1000)


def test_t7_the_retry_baseline_waits_for_the_last_previews_announcement():
    pg = _SettlePage(["stale summary", "stale summary", "fresh summary"], [True, True, False])
    got = rc.wait_live_settled(pg, {"settle_ms": 300, "settle_timeout_ms": 5000})
    assert got["live"] == "fresh summary"                                        # never the stale one
    with pytest.raises(rc.Inconclusive, match="never settled"):
        rc.wait_live_settled(_SettlePage(["a"], [True]), {"settle_ms": 100, "settle_timeout_ms": 600})


def test_t8_the_retrys_own_503s_are_expected_not_findings():
    good = {"live": SUMMARY, "line": LAST, "bar": None}
    w = _RetryWorld([good] * 7, before={"live": SUMMARY, "line": None, "bar": None})
    row = {"checks": [], "read": []}
    rc.a_retry_kept_preview(_retry_run(w), {"source": "Closed trades", "samples": 6, "interval_ms": 1,
                                            "settle_ms": 1}, row)
    assert 503 in row["expect_status"]
    R = type("R", (), {"touch": False})()
    row2 = {"expect_status": [503], "events": {"main": [{"http": 503, "method": "POST", "url": "/preview"}]}}
    assert rc.findings_of(R, row2) == []
    row2["expect_status"] = []                                                    # control: unexpected, filed
    assert [f["kind"] for f in rc.findings_of(R, row2)] == ["http5xx"]


def test_t9_an_offline_disabled_tick_is_pressed_anyway():
    pressed = {}

    class Box:
        def get_attribute(self, k):
            return "true" if k == "aria-disabled" else None

        def scroll_into_view_if_needed(self, **k):
            pass

        def click(self, **k):
            pressed.update(k)

    class Boxes:
        def nth(self, i):
            return Box()

    class Pg:
        def locator(self, sel):
            return Boxes()

        def wait_for_timeout(self, ms):
            pass
    R = type("R", (), {"keyboard": False, "touch": False, "page": lambda self: Pg()})()
    row = {"read": []}
    rc.a_tick(R, {"index": 0}, row)
    assert pressed.get("force") is True and row["read"][0]["what"] == "the tick is aria-disabled"


def test_t10_own_data_and_sample_previews_name_templates_that_carry_widgets():
    seed = json.loads(frontend_read()("api/services/journal_two/template_library_seed.json"))
    defs = {t["title"]: len(t.get("definitions") or []) for t in seed["templates"]}
    for pid, st in steps_of("w11_preview"):
        if st.get("expect_own_data") or st.get("expect_sample") or st.get("expect_card_sentence"):
            assert defs.get(st["template"], 0) > 0, (pid, st["template"])
    assert defs["Pre-market prep"] == 0                                           # why P35's own-data moved


def test_t11_t12_t13_the_use_sends_the_clients_choices_and_reads_the_members_own_pick(stub, tmp_path):
    q = {"slot": "routine_a", "use": {"id": "r-morning", "name": "Morning routine"}}
    state = {"uses": False, "keys": set()}

    def ans(method, path, headers, body):
        if path.endswith("/preview-mine"):
            return 200, {"slots": [], "cards": [], "tools": [], "questions": [] if state["uses"] else [q]}
        if path.startswith("/api/j2/journal-styles"):
            return 200, {"styles": [{"id": "c1", "sourceGalleryId": "g-pmp"}] if state["uses"] else []}
        if path.endswith("/use-template"):
            k = headers.get("Idempotency-Key")
            replay = k in state["keys"]
            state["keys"].add(k)
            return 200, {"note": {"id": "n1"}, "style": {"id": "c1", "name": "Pre-market prep"}, "replayed": replay,
                         "created": {"widgets": [], "routines": [], "trackers": []}, "reused": {"routines": []}}
        return 404, {}
    lib_two(stub, ans)
    g, R = fake_run(tmp_path, stub.base)
    R.member = {"session": "s40", "routines": [{"name": "Morning routine", "id": "r-morning"}]}
    pv = step(g, R, {"do": "w11_preview", "template": "Pre-market prep", "expect_question_use": "Morning routine"})
    assert pv["verdict"] == "PASS", pv
    use = step(g, R, {"do": "w11_use", "template": "Pre-market prep", "pick": "suggested",
                      "expect_reused": "Morning routine"})
    assert use["verdict"] == "PASS", use
    sent = [json.loads(s["body"]) for s in posts(stub, "/use-template")]
    assert sent and all(b.get("choices") == {"routine_a": {"use": "r-morning"}} for b in sent)       # T-13
    assert R.alias["use_routine"]["id"] == "r-morning"                                              # T-11
    state["uses"] = True                                                                            # T-12
    R.remembered.clear()
    pv2 = step(g, R, {"do": "w11_preview", "template": "Pre-market prep", "expect_question_use": "Morning routine"})
    assert pv2["verdict"] == "PASS", pv2
    state["uses"] = False
    q["use"] = None                                                                                 # auto: create
    R.remembered.clear()
    stub.seen.clear()
    step(g, R, {"do": "w11_use", "template": "Pre-market prep", "pick": "auto"})
    assert [json.loads(s["body"]).get("choices") for s in posts(stub, "/use-template")][0] == \
        {"routine_a": {"create": True}}


def test_t11_a_use_that_made_a_routine_in_place_of_the_pick_fails(stub, tmp_path):
    q = {"slot": "routine_a", "use": {"id": "r-morning", "name": "Morning routine"}}
    keys = set()

    def ans(method, path, headers, body):
        if path.endswith("/preview-mine"):
            return 200, {"slots": [], "cards": [], "tools": [], "questions": [q]}
        k = headers.get("Idempotency-Key")
        replay = k in keys
        keys.add(k)
        return 200, {"note": {"id": "n1"}, "replayed": replay,
                     "created": {"widgets": [], "routines": [] if replay else [{"id": "r-new"}], "trackers": []}}
    lib_two(stub, ans)
    g, R = fake_run(tmp_path, stub.base)
    R.member = {"session": "s", "routines": [{"name": "Morning routine", "id": "r-morning"}]}
    row = step(g, R, {"do": "w11_use", "template": "Pre-market prep", "pick": "suggested",
                      "expect_reused": "Morning routine"})
    assert row["verdict"] == "FAIL"
    assert [c["what"] for c in row["checks"] if not c["ok"]] ==         ["the Use made no new routine in place of the member's own 'Morning routine'"]      # only that check


def test_t6_expectations_find_a_sentence_the_text_query_missed(monkeypatch):
    want = "None of these trades have a value for ET hour yet."

    class Sur:
        def get_by_text(self, *a, **k):
            class L:
                @property
                def first(self):
                    return self

                def wait_for(self, **k):
                    raise TimeoutError("missed")
            return L()

        def inner_text(self, timeout=None):
            return "x " * 1200 + want
    monkeypatch.setattr(rc, "surface", lambda pg, within: Sur())
    R = type("R", (), {"page": lambda self: None})()
    R.g = type("G", (), {"sentence": lambda self, k: want})()
    row = {"checks": [], "read": []}
    rc.expectations(R, {"expect": ["split_none_hour"]}, row)
    assert [c["ok"] for c in row["checks"]] == [True] and want in row["checks"][0]["read"]
    assert len(row["read"][0]["text"]) > 1500                                     # the read reaches the pane


def test_t13_the_p39_race_and_key_steps_send_the_clients_choices(stub, tmp_path):
    library_then(stub, lambda *a: (200, {"note": {"id": "n1"}, "replayed": False}))
    g, R = fake_run(tmp_path, stub.base)
    step(g, R, {"do": "w11_unkeyed", "template": "Pre-market prep"})
    bodies = [json.loads(s["body"]) for s in posts(stub, "/use-template")]
    assert bodies and all(b.get("choices") == {"routine_a": {"create": True}} for b in bodies)


def test_t14_the_admin_signs_in_once_per_campaign_and_later_runs_reuse_the_session():
    logins, cookies_added = [], []

    class Resp:
        def __init__(self, status, body=None):
            self.status, self.ok, self._b = status, status == 200, body or {}

        def json(self):
            return self._b

    class Req:
        def post(self, url, data):
            logins.append(url)
            return Resp(200)

        def get(self, url):
            return Resp(200, {"role": "admin"})

    class Ctx:
        def cookies(self):
            return [{"name": "uct_session", "value": "admin-sess"}]

        def add_cookies(self, c):
            cookies_added.extend(c)
    facts = {}

    def run():
        R = type("R", (), {})()
        R.p, R.member = {"id": "P45"}, {"email": "a@x", "password": "p"}
        R.g = type("G", (), {"base": "http://127.0.0.1:1", "facts": facts})()
        R.contexts = {"main": Ctx()}
        R.page = lambda name="main": type("P", (), {"request": Req()})()
        row = {"checks": [], "read": []}
        rc.a_admin_login(R, {}, row)
        return row
    run()
    assert len(logins) == 1 and facts[("P45", "admin_session")] == "admin-sess"
    for _ in range(5):
        assert all(c["ok"] for c in run()["checks"])
    assert len(logins) == 1 and len(cookies_added) == 5                          # six runs, ONE sign-in


def test_t15_a_throttled_run_waits_for_its_own_network_and_still_has_a_bound():
    prof = rc.THROTTLE_PROFILES["fast-3g"]
    w = rc.throttle_wait_ms(prof["down_kbps"], prof["latency_ms"])
    assert rc.T < w < 10 * 60 * 1000                                             # longer than 30 s, still bounded
    assert rc.throttle_wait_ms(400, 300) > rc.throttle_wait_ms(1440, 300)
    R = rc.Run.__new__(rc.Run)
    R.slow_ms = 0
    assert R.t() == rc.T and R.t(60000) == 60000                                 # control: no throttle
    R.slow_ms = w
    assert R.t() == w
    src = (REPO / "tools" / "notebook_campaign" / "run_campaign.py").read_text(encoding="utf-8")
    body = src[src.index("def a_open_note"):src.index("def render_all")]
    assert body.count("timeout=R.t(") >= 1 and 'wait_for(state="attached", timeout=R.t())' in body
    assert _step("P50.a.01") == {"do": "throttle", "profile": "fast-3g"}


def test_t16_p06_discards_on_close():
    assert _step("P06.a.06").get("discard") is True


def test_t17_an_obscured_unfocused_target_is_not_a_finding():
    v = {"id": "target-size", "impact": "serious", "help": "h", "nodes": 1, "targets": ["#a"],
         "node_info": [{"summary": "Target is partially obscured", "focused": False}]}
    assert rc.obscured_unfocused(v)
    assert not rc.obscured_unfocused({**v, "node_info": [{"summary": "Target is partially obscured", "focused": True}]})
    assert not rc.obscured_unfocused({**v, "node_info": [{"summary": "Target has insufficient size", "focused": False}]})
    R = type("R", (), {"touch": False})()
    row = {"expect_status": [], "events": {}, "metrics": {"axe": {"violations": [v]}}}
    assert rc.findings_of(R, row) == []
    row["metrics"]["axe"]["violations"][0]["node_info"][0]["focused"] = True     # control: focused, filed
    assert [f["kind"] for f in rc.findings_of(R, row)] == ["axe:serious"]


def test_t18_a_stranger_reads_the_shared_and_published_pages():
    import inspect
    src = inspect.getsource(sm.seed_member)
    assert "svc.shares.create_share(uid, nid)" in src and "svc.publish.publish_note(uid, nid)" in src
    assert "SHARED_NOTE_PATH = '" + sm.SHARED_NOTE_PATH + "'" in frontend_read()("app/src/pages/journal-2-0/lib/noteShareLink.js")
    p48 = next(p for p in SPEC["personas"] if p["id"] == "P48")
    assert p48["data"]["public"]["share"] and p48["data"]["public"]["publish"] and p48["data"]["session"] is False
    pages = [st["page"] for sc in p48["scripts"] for st in sc["steps"] if st["do"] == "open_public_page"]
    assert pages == ["share", "publish"]
    R = type("R", (), {"member": {}, "p": {"id": "P48"}})()
    with pytest.raises(rc.Inconclusive, match="no share page"):
        rc.a_open_public_page(R, {"page": "share"}, {"checks": [], "read": []})


def test_t19_the_served_env_reaches_no_network_but_loopback(tmp_path):
    fw = _g3_fw(tmp_path, {}, all_names=[], c1=[])
    env = rc.campaign_env(rc.campaign_flag_sets(fw), base={"PATH": "x"})[0]
    block = rc.outbound_block()
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "https_proxy", "NO_PROXY"):
        assert env[k] == block[k], k
    assert block["HTTPS_PROXY"].startswith("http://127.0.0.1:") and "127.0.0.1" in block["NO_PROXY"]
    sb = rc.OwnedSandbox.__new__(rc.OwnedSandbox)
    sb.app_root, sb.out = tmp_path, tmp_path
    assert "--block-outbound" in sb.launcher_args()
    src = rc.TOOL_LAUNCHER.read_text(encoding="utf-8").replace("\r\n", "\n")
    assert "    if args.block_outbound:\n        os.environ.update(OUTBOUND_BLOCK)" in src


def test_t20_a_clock_boot_exits_on_ctrl_break():
    import ast
    tree = ast.parse((REPO / "tools" / "notebook_campaign" / "sandbox_clock.py").read_text(encoding="utf-8"))
    runs = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "run"
            and getattr(n.func.value, "id", "") == "uvicorn"]
    assert runs and all(any(k.arg == "timeout_graceful_shutdown" for k in r.keywords) for r in runs)
    src = (REPO / "tools" / "notebook_campaign" / "sandbox_clock.py").read_text(encoding="utf-8")
    assert "os._exit(code)" in src[src.index('if __name__ == "__main__":'):]


def test_coverage_every_persona_has_more_than_one_step_or_says_why():
    for p in SPEC["personas"]:
        n = sum(len(sc["steps"]) for sc in p["scripts"])
        assert n > 1 or p.get("single_step_why"), p["id"]


def test_coverage_every_persona_carries_its_served_run_validation_record():
    for p in SPEC["personas"]:
        v = p.get("validated")
        assert isinstance(v, dict) and v["served_run"] and v["runs"] and "triage" in v, p["id"]
