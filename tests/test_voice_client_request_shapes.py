"""The requests the client builds for `/api/voice/*`, held against what each route accepts.

THE DEFECT THIS FILE WAS WRITTEN FROM. `useRealtimeSession.js` asked for the
morning and closing briefing by POSTing `{"transcript": "..."}` as JSON to
`POST /api/voice/oneshot` and reading `narration` off a JSON reply. That route
has only ever taken a multipart `audio` recording and answered with an MP3
stream (`3e8ca24c5c`, two days before the caller was written in `64f66fa29e`),
so the request was a 422 from the day it shipped and "read me the morning
briefing" played nothing.

Neither side is restated here. The client's requests are read from its parse
tree by `tests/support/client_fetch_census.cjs`; the server's accepted shapes
are read from the route objects (the pydantic body model, or the
`request_body_cap.capped_multipart` dependency's own field names). So a change
to either side that the other does not follow fails by file and line.

The briefing path is additionally driven end to end: the real client module
builds its request in Node, the real route answers it through the test client,
and the real client code reads the answer.
"""
from __future__ import annotations

import inspect
import json
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest
from fastapi import params as fastapi_params
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import BaseModel

REPO = Path(__file__).resolve().parents[1]
APP_DIR = REPO / "app"
EXTRACTOR = REPO / "tests" / "support" / "client_fetch_census.cjs"
PREFIX = "/api/voice/"

# A body the reader cannot follow is reported, never guessed. Each entry is a
# call site whose body is built somewhere the reader does not look, with the
# reason. A new one fails by name until it is added here on purpose.
DECLARED_UNRESOLVED = {
    # `patch` is the caller's argument: Settings saves whichever one setting changed.
    ("src/pages/Settings.jsx", "PUT", "/api/voice/settings"),
}

# URL literals that are not the first argument of a call: a constant sent from
# another line, or a link. Each still has to name a real route.
DECLARED_UNATTRIBUTED = {
    ("src/components/mobile/MoreSheet.jsx", "/api/voice/insights/pending"),       # SWR key
    ("src/components/NavBar.jsx", "/api/voice/insights/pending"),                 # SWR key
    ("src/components/voice/VoiceSessionsPanel.jsx", "/api/voice/sessions/{}/trace"),  # SWR key
    ("src/components/voice/VoiceTelemetryPanel.jsx", "/api/voice/transcripts/export"),  # download link
    ("src/hooks/useReadAloud.js", "/api/voice/tts/stream"),                       # <audio> source
    ("src/hub/voiceNote.js", "/api/voice/transcribe"),                            # a constant, see below
}


# ── the client side, parsed ─────────────────────────────────────────────────

def _node() -> str:
    node = shutil.which("node")
    assert node, "node is not on PATH -- this rail reads the client's parse tree"
    return node


def _census(*extra: str) -> dict:
    r = subprocess.run([_node(), str(EXTRACTOR), str(APP_DIR), PREFIX, *extra],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
    assert r.returncode == 0, f"the client census could not run: {r.stderr[:2000]}"
    out = json.loads(r.stdout)
    assert out["parsed"] > 0, "the census parsed no file -- an empty census proves nothing"
    return out


@pytest.fixture(scope="module")
def census() -> dict:
    return _census()


def _where(call: dict) -> str:
    return f"{call['file']}:{call['line']} {call['method']} {call['path']}"


# ── the server side, read from the route objects ────────────────────────────

def _voice_routes() -> list[APIRoute]:
    from api.routers import voice
    return [r for r in voice.router.routes if isinstance(r, APIRoute)]


def _route_for(method: str, path: str) -> APIRoute | None:
    """The route a client path lands on. `{}` in the client path is one
    interpolated segment; `{name}` in the route path is one parameter."""
    want = path.rstrip("/").split("/")
    for route in _voice_routes():
        if method not in route.methods:
            continue
        have = route.path.rstrip("/").split("/")
        if len(have) != len(want):
            continue
        if all(h == w or (h.startswith("{") and h.endswith("}")) or "{}" in w for h, w in zip(have, want)):
            return route
    return None


def _capped_multipart_of(dependant) -> dict | None:
    """The field names of a `request_body_cap.capped_multipart` dependency
    anywhere under this route, read from the dependency's own closure."""
    for dep in dependant.dependencies:
        call = dep.call
        if getattr(call, "__qualname__", "") == "capped_multipart.<locals>.dependency":
            cells = dict(zip(call.__code__.co_freevars, (c.cell_contents for c in call.__closure__)))
            return {"file": cells["field"], "fields": tuple(cells["fields"])}
        found = _capped_multipart_of(dep)
        if found:
            return found
    return None


def accepted_shape(route: APIRoute) -> dict:
    """What a route takes as its body: {"kind": "json"|"multipart"|"none", ...}."""
    sig = inspect.signature(route.endpoint)
    models = [p.annotation for p in sig.parameters.values()
              if inspect.isclass(p.annotation) and issubclass(p.annotation, BaseModel)]
    multipart = _capped_multipart_of(route.dependant)
    file_params = [n for n, p in sig.parameters.items() if isinstance(p.default, fastapi_params.File)]
    form_params = [n for n, p in sig.parameters.items()
                   if isinstance(p.default, fastapi_params.Form) and not isinstance(p.default, fastapi_params.File)]
    if multipart is None and file_params:
        multipart = {"file": file_params[0], "fields": tuple(form_params)}
    assert not (models and multipart), f"{route.path} declares both a JSON model and a multipart body"
    assert len(models) <= 1, f"{route.path} declares {len(models)} body models"
    if models:
        fields = models[0].model_fields
        return {"kind": "json", "model": models[0], "fields": set(fields),
                "required": {n for n, f in fields.items() if f.is_required()}}
    if multipart:
        return {"kind": "multipart", **multipart}
    return {"kind": "none"}


def mismatch(call: dict, shape: dict) -> str | None:
    """Why the route would not take this client request as written, or None."""
    body = call["body"]
    if body["kind"] == "json":
        if shape["kind"] != "json":
            return f"client sends JSON {body['always']}; the route takes {shape['kind']}" + (
                f" (file field {shape['file']!r})" if shape["kind"] == "multipart" else "")
        sent = set(body["always"]) | set(body["maybe"])
        unknown = sent - shape["fields"]
        if unknown:
            return f"client sends {sorted(unknown)}, which {shape['model'].__name__} does not declare"
        missing = shape["required"] - set(body["always"])
        if missing:
            return f"{shape['model'].__name__} requires {sorted(missing)}, which the client does not always send"
        return None
    if body["kind"] == "formdata":
        if shape["kind"] != "multipart":
            return f"client sends a form {body['fields']}; the route takes {shape['kind']}"
        if shape["file"] not in body["fields"]:
            return f"the route reads the file from {shape['file']!r}; the client appends {body['fields']}"
        unknown = set(body["fields"]) - {shape["file"], *shape["fields"]}
        if unknown:
            return f"client appends {sorted(unknown)}, which the route never reads"
        return None
    if body["kind"] == "none":
        if shape["kind"] == "json" and shape["required"]:
            return f"client sends no body; {shape['model'].__name__} requires {sorted(shape['required'])}"
        if shape["kind"] == "multipart":
            return f"client sends no body; the route requires a file in {shape['file']!r}"
        return None
    return "unresolved"


# ── the rails ───────────────────────────────────────────────────────────────

def test_the_census_sees_the_voice_callers(census):
    """Non-vacuity: the reader finds calls it must find, of each body kind."""
    calls = census["calls"]
    seen = {(c["file"], c["path"], c["body"]["kind"]) for c in calls}
    assert ("src/hooks/useReadAloud.js", "/api/voice/tts/prepare", "json") in seen
    assert ("src/pages/journal-2-0/components/VoiceInputButton.jsx", "/api/voice/transcribe", "formdata") in seen
    assert ("src/hooks/useVoiceMemory.js", "/api/voice/memory/facts/{}", "none") in seen
    # the sendBeacon form (a Blob around JSON.stringify), at module scope
    beacon = [c for c in calls if c["callee"] == "sendBeacon"]
    assert beacon and beacon[0]["body"]["always"] == ["duration_seconds", "session_id"]
    # a key the client only sometimes sends is reported as such, not as always sent
    prepare = next(c for c in calls if c["path"] == "/api/voice/tts/prepare")
    assert prepare["body"]["always"] == ["text"] and set(prepare["body"]["maybe"]) == {"voice", "speed"}


def test_the_server_shape_reader_sees_each_kind_of_route():
    """Non-vacuity for the other side: a JSON model, a capped multipart door and
    a body-less door are each read as what they are."""
    exec_shape = accepted_shape(_route_for("POST", "/api/voice/exec"))
    assert exec_shape["kind"] == "json" and exec_shape["required"] == {"session_id", "tool"}
    assert "args" in exec_shape["fields"]
    transcribe = accepted_shape(_route_for("POST", "/api/voice/transcribe"))
    assert transcribe == {"kind": "multipart", "file": "audio", "fields": ("cleanup",)}
    assert accepted_shape(_route_for("POST", "/api/voice/insights/scan"))["kind"] == "none"


def test_the_comparison_can_fail():
    """Control: the judge refuses the exact defect, and three neighbours of it."""
    oneshot = accepted_shape(_route_for("POST", "/api/voice/oneshot"))
    json_call = {"body": {"kind": "json", "always": ["transcript"], "maybe": [], "fields": []}}
    assert "the route takes multipart" in mismatch(json_call, oneshot)
    exec_shape = accepted_shape(_route_for("POST", "/api/voice/exec"))
    assert "requires ['session_id']" in mismatch(
        {"body": {"kind": "json", "always": ["tool"], "maybe": [], "fields": []}}, exec_shape)
    assert "does not declare" in mismatch(
        {"body": {"kind": "json", "always": ["session_id", "tool", "nope"], "maybe": [], "fields": []}}, exec_shape)
    assert "the client appends ['file']" in mismatch(
        {"body": {"kind": "formdata", "always": [], "maybe": [], "fields": ["file"]}}, oneshot)
    assert mismatch({"body": {"kind": "json", "always": ["session_id", "tool"], "maybe": ["args"], "fields": []}},
                    exec_shape) is None


def test_every_voice_url_the_client_names_is_a_real_route(census):
    lost = [_where(c) for c in census["calls"] if _route_for(c["method"], c["path"]) is None]
    for u in census["unattributed"]:
        path = u["url"].split("?")[0]
        if not any(_route_for(m, path) for m in ("GET", "POST", "PUT", "DELETE", "PATCH")):
            lost.append(f"{u['file']}:{u['line']} {path}")
    assert not lost, "the client calls a voice door that does not exist:\n  " + "\n  ".join(lost)


def test_every_request_the_client_builds_is_one_its_route_accepts(census):
    """THE PIN. Fails by file and line when a client request and its route's
    declared body stop agreeing -- in either direction."""
    wrong = []
    for call in census["calls"]:
        route = _route_for(call["method"], call["path"])
        if route is None:
            continue    # reported by the test above
        why = mismatch(call, accepted_shape(route))
        if why == "unresolved":
            if (call["file"], call["method"], call["path"]) not in DECLARED_UNRESOLVED:
                wrong.append(f"{_where(call)}: body not readable ({'; '.join(call['body']['problems'])})")
        elif why:
            wrong.append(f"{_where(call)}: {why}")
    assert not wrong, "client request and server route disagree:\n  " + "\n  ".join(wrong)


def test_the_declared_exceptions_are_exactly_the_ones_that_exist(census):
    """A declared exception that no longer exists is a stale excuse; an
    undeclared one is a new blind spot. Both fail by name."""
    unresolved = {(c["file"], c["method"], c["path"]) for c in census["calls"] if c["body"]["kind"] == "unresolved"}
    assert unresolved == DECLARED_UNRESOLVED
    unattributed = {(u["file"], u["url"].split("?")[0]) for u in census["unattributed"]}
    assert unattributed == DECLARED_UNATTRIBUTED


def test_the_one_constant_url_is_sent_as_the_form_its_route_takes():
    """`hub/voiceNote.js` keeps its URL in a constant, so the census cannot tie
    it to a call. Read that file's own FormData instead: the names it appends
    are the names `/api/voice/transcribe` reads."""
    src = (APP_DIR / "src" / "hub" / "voiceNote.js").read_text(encoding="utf-8")
    import re
    code = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    code = "\n".join(line.split("//")[0] if "://" not in line else line for line in code.splitlines())
    appended = set(re.findall(r"\.append\(\s*['\"]([A-Za-z_]+)['\"]", code))
    shape = accepted_shape(_route_for("POST", "/api/voice/transcribe"))
    assert appended, "voiceNote.js no longer appends form fields -- re-read how it sends its audio"
    assert shape["file"] in appended and appended <= {shape["file"], *shape["fields"]}, (appended, shape)


# ── the briefing path, driven for real ──────────────────────────────────────

SENTINEL = {"morning": "Morning sentinel narration, nine one seven.",
            "closing": "Closing sentinel narration, four four two."}


@pytest.fixture
def paid_session(monkeypatch):
    """A signed-in paid member with one live voice session, and the two
    briefing services answering a sentence only this test knows."""
    from api.main import app
    from api.services.auth_db import get_connection, init_db
    from api.services.auth_service import create_session, create_user
    from api.services import voice_briefings, voice_session_service

    init_db()
    user = create_user(f"vshape_{uuid.uuid4()}@example.com", "password123")
    conn = get_connection()
    try:
        conn.execute("INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, 'pro', 'active')",
                     (uuid.uuid4().hex, user["id"]))
        conn.commit()
    finally:
        conn.close()
    client = TestClient(app)
    client.cookies.set("uct_session", create_session(user["id"]))
    sid = voice_session_service.create_session(user_id=user["id"], mode="c")
    monkeypatch.setattr(voice_briefings, "morning_briefing",
                        lambda *, user_id: {"narration": SENTINEL["morning"], "sections": []})
    monkeypatch.setattr(voice_briefings, "closing_briefing",
                        lambda *, user_id: {"narration": SENTINEL["closing"], "sections": []})
    return client, sid


def _briefing_calls() -> list[dict]:
    """The requests `buildReadAloudPlan` builds, wherever that function lives."""
    calls = [c for c in _census()["calls"] if "buildReadAloudPlan" in c["fns"]]
    assert len(calls) >= 2, "buildReadAloudPlan no longer builds a voice request per briefing"
    return calls


def _body_as_sent(call: dict, session_id: int) -> dict:
    """The client's JSON body: every literal as written, and the live session
    id for the one value the client computes."""
    body = dict(call["body"]["literals"])
    for key in call["body"]["always"]:
        if key in body:
            continue
        assert key == "session_id", f"{_where(call)}: do not know what the client puts in {key!r}"
        body[key] = session_id
    return body


def test_the_briefing_request_the_client_builds_is_answered_not_refused(paid_session):
    """REPRODUCTION. Sends exactly what the client sends -- method, path,
    Content-Type and body, all read from the client's source."""
    client, sid = paid_session
    for call in _briefing_calls():
        assert call["body"]["kind"] == "json" and call["contentType"] == "application/json", _where(call)
        r = client.request(call["method"], call["path"], content=json.dumps(_body_as_sent(call, sid)),
                           headers={"Content-Type": call["contentType"]})
        assert r.status_code == 200, f"{_where(call)} -> {r.status_code} {r.text[:300]}"
        assert r.headers["content-type"].startswith("application/json"), _where(call)


_ROUND_TRIP_DRIVER = r"""
// Runs the client's own read-aloud plan against answers the real server gave.
// argv: <module path> <content key> <session id> <phase: record|answer> [<answers file>]
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
const [modPath, contentKey, sessionId, phase, answersFile] = process.argv.slice(2)
const answers = phase === 'answer' ? JSON.parse(fs.readFileSync(answersFile, 'utf8')) : []
const sent = []
globalThis.fetch = async (url, init = {}) => {
  sent.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ?? null })
  const a = answers[sent.length - 1]
  if (!a) return { ok: false, status: 599, json: async () => ({}) }
  return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => JSON.parse(a.text) }
}
const mod = await import(pathToFileURL(modPath).href)
const plan = mod.buildReadAloudPlan(contentKey, { sessionId: Number(sessionId) })
const text = plan ? await plan.textProvider() : null
process.stdout.write(JSON.stringify({ hasPlan: !!plan, label: plan && plan.label, sent, text }))
"""


def _drive(tmp_path: Path, content_key: str, sid: int, phase: str, answers: list | None = None) -> dict:
    module = APP_DIR / "src" / "hooks" / "readAloudPlans.js"
    assert module.exists(), f"{module} is missing: the read-aloud plans must be importable without React"
    driver = tmp_path / "driver.mjs"
    driver.write_text(_ROUND_TRIP_DRIVER, encoding="utf-8")
    args = [_node(), str(driver), str(module), content_key, str(sid), phase]
    if answers is not None:
        answers_file = tmp_path / "answers.json"
        answers_file.write_text(json.dumps(answers), encoding="utf-8")
        args.append(str(answers_file))
    r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    assert r.returncode == 0, f"node could not run the read-aloud plan: {r.stderr[:2000]}"
    return json.loads(r.stdout)


@pytest.mark.parametrize("content_key, which", [("morning briefing", "morning"), ("brief me", "morning"),
                                               ("closing briefing", "closing"), ("eod recap", "closing")])
def test_a_briefing_read_aloud_speaks_the_servers_own_words(paid_session, tmp_path, content_key, which):
    """END TO END, neither side restated: the client module builds the request,
    the route answers it, and the client module reads the sentence out of the
    answer. The content keys are the ones the server's `read_aloud` tool emits."""
    from api.services.voice_client_action_tools import READ_ALOUD_TARGETS
    assert content_key in READ_ALOUD_TARGETS
    client, sid = paid_session
    recorded = _drive(tmp_path, content_key, sid, "record")
    assert recorded["hasPlan"], f"no read-aloud plan for {content_key!r}"
    assert len(recorded["sent"]) == 1, recorded["sent"]
    req = recorded["sent"][0]
    r = client.request(req["method"], req["url"], content=req["body"], headers=req["headers"])
    assert r.status_code == 200, f"{req['method']} {req['url']} {req['body']} -> {r.status_code} {r.text[:300]}"
    spoken = _drive(tmp_path, content_key, sid, "answer", [{"status": r.status_code, "text": r.text}])
    assert spoken["text"] == SENTINEL[which]


def test_a_refused_briefing_reads_nothing_rather_than_an_error_body(paid_session, tmp_path):
    client, sid = paid_session
    spoken = _drive(tmp_path, "morning briefing", sid, "answer", [{"status": 422, "text": '{"detail": []}'}])
    assert spoken["text"] == ""


def test_every_briefing_key_the_server_can_emit_has_a_client_plan(tmp_path):
    """The server's `read_aloud` tool says "Reading <key>." for these keys; a key
    with no client plan would be announced and then never played."""
    from api.services.voice_client_action_tools import READ_ALOUD_TARGETS
    briefing_keys = sorted(k for k in READ_ALOUD_TARGETS if "brief" in k or k in ("closing recap", "eod recap"))
    assert len(briefing_keys) >= 5, briefing_keys
    for key in briefing_keys:
        assert _drive(tmp_path, key, 1, "record")["hasPlan"], f"no client plan for server key {key!r}"
