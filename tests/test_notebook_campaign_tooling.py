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


PREFIXES = {w11.GALLERY_ROUTER: ('prefix="/api/j2/template-gallery"', w11.GALLERY),
            w11.STYLES_ROUTER: ('prefix="/api/j2"', "/api/j2"),
            w11.ROUTINES_ROUTER: ('prefix="/api/j2/routines"', w11.ROUTINES),
            w11.NOTES_ROUTER: ('prefix="/api/j2"', "/api/j2"),
            w11.ALERTS_ROUTER: ("router = APIRouter()", "")}
NEEDLE = {w11.GALLERY_ROUTER: "use-template", w11.STYLES_ROUTER: "/unarchive"}


@pytest.mark.parametrize("name", sorted(w11.ROUTES))
def test_every_wave11_route_the_steps_call_is_declared_by_its_router(name):
    method, rel, path = w11.ROUTES[name]
    text = merged_text(rel, NEEDLE.get(rel, "@"))
    assert re.search(rf'\.{method.lower()}\(\s*"{re.escape(path)}"', text), (name, rel, path)
    assert PREFIXES[rel][0] in text, rel


def test_control_the_route_rail_reds_on_a_route_that_does_not_exist():
    text = merged_text(w11.GALLERY_ROUTER, "use-template")
    assert re.search(r'\.post\(\s*"/\{gallery_id\}/use-template"', text)
    assert not re.search(r'\.post\(\s*"/\{gallery_id\}/use-templates"', text)


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
    plain = w11.judge_refusal(R_(413, {"detail": "Request too large"}), 413, None, "Request too large")
    assert plain["verdict"] == w11.PASS


def test_key_reused_is_expected_pending_while_the_branch_answers_conflict():
    s = "That was already sent for something else. Press it again to send this one."
    assert w11.judge_key_reused(R_(409, ref("key_reused", s)), s)["verdict"] == w11.PASS
    pend = w11.judge_key_reused(R_(409, ref("conflict", s)), s)
    assert pend["verdict"] == w11.PENDING and "A9" in pend["why"]
    assert w11.judge_key_reused(R_(409, ref("conflict", "other")), s)["verdict"] == w11.FAIL     # wrong sentence
    assert w11.judge_key_reused(R_(200, {"replayed": True}), s)["verdict"] == w11.FAIL
    assert w11.judge_key_reused(R_(409, ref("in_flight", s)), s)["verdict"] == w11.FAIL


def test_listing_moved_is_expected_pending_while_the_branch_answers_conflict():
    s = "This template changed while it was being added. Nothing was made. Try again."
    assert w11.judge_listing_moved(R_(409, ref("listing_moved", s)), s)["verdict"] == w11.PASS
    assert w11.judge_listing_moved(R_(409, ref("conflict", s)), s)["verdict"] == w11.PENDING
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
    assert w11.judge_in_flight([R_(0, text="URLError")] * 3, "note.id", IN_FLIGHT)["verdict"] == w11.FAIL


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


@pytest.mark.parametrize("base", ["https://uctintelligence.com", "http://10.0.0.5:8131"])
def test_the_loopback_door_refuses_every_other_host_on_every_call(base, monkeypatch):
    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: pytest.fail("a socket was opened"))
    with pytest.raises(PermissionError):
        w11.http_call(base, w11.b_library(), "s")
    with pytest.raises(PermissionError):
        w11.race(base, [w11.b_library()], "s")


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
    g.benign, g.walk = (), None
    R = object.__new__(rc.Run)
    R.g, R.p, R.vp, R.mode = g, {"id": "P39"}, "1200", "pointer"
    R.member, R.alias, R.remembered, R.pages, R.contexts = {"session": "s39"}, {}, {}, {}, {}
    R.dir, R.tag, R.keyboard, R.size, R.touch = tmp_path / "P39", "t", False, (1200, 800), False
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


@pytest.mark.parametrize("code,want", [("conflict", w11.PENDING), ("key_reused", "PASS")])
def test_a_key_reused_step_is_expected_pending_on_the_interim_code_and_pass_on_the_new_one(stub, tmp_path, code, want):
    def ans(method, path, headers, body):
        if path.endswith("/use-template"):
            return 200, {"note": {"id": "n1"}}
        return 409, ref(code, SENT["key_reused"])
    library_then(stub, ans)
    g, R = fake_run(tmp_path, stub.base)
    row = step(g, R, {"do": "w11_key_reused", "template": "Pre-market prep"})
    assert row["verdict"] == want, row
    assert rc.run_verdict([row]) == ("INCONCLUSIVE" if want == w11.PENDING else "PASS")
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
    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: pytest.fail("a socket was opened"))
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
