"""Wave 11 campaign steps: request builders, the one loopback HTTP door, and the judges (Task 11.21 Step 4).

Everything here is PURE except `http_call` / `race`, which talk to a LOCAL sandbox only (`refuse_non_local`,
checked on every call, not just at start-up). `run_campaign.py` wires these into its `ACTIONS`; the unit rails in
tests/test_notebook_campaign_tooling.py drive the builders and judges with no server, and `http_call` / `race`
against a stub server on 127.0.0.1.

The route shapes are the backend branch's (feat/notebook-widgets-p2-be, merged into feat/notebook-widgets-p2 for the
campaign): `ROUTES` names each one with the router file that declares it, and a rail checks every path against that
file's decorators, so a renamed route is a red rail, never a step that 404s and reads as a product answer.

A judge answers `{"verdict", "checks", "why"}`:
  * PASS / FAIL from the checks;
  * INCONCLUSIVE when the step could not be driven to the state it exists to read (a race that never raced, a
    pool that never filled): that is never a pass, and it always says why;
  * EXPECTED-PENDING when the server answers the documented interim shape of a change that lands in a pending
    backend batch (`judge_refusal(..., interim_code=...)`): not a pass, not a defect. ⛔ No step uses it today:
    `key_reused` (A9) and `listing_moved` (W11-R60) are FINAL on the backend (a196151762), so `conflict` for either
    is a FAIL.
  * A transport failure (status 0: nothing answered) is INCONCLUSIVE in every judge, never a product FAIL.

This module never imports api.* and reads no environment variable.
"""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
import uuid
from typing import Any, Callable
from urllib.parse import quote, urlencode, urlparse

PASS, FAIL, INCONCLUSIVE, PENDING = "PASS", "FAIL", "INCONCLUSIVE", "EXPECTED-PENDING"
VERDICTS = (PASS, FAIL, INCONCLUSIVE, PENDING)

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}

GALLERY = "/api/j2/template-gallery"
STYLES = "/api/j2/journal-styles"
ROUTINES = "/api/j2/routines"
NOTES = "/api/j2/notes"
ALERTS = "/api/alerts"
IDEMPOTENCY_HEADER = "Idempotency-Key"

#: The wave 11 doors' body cap (`notebook_template_gallery.W11_MAX_BODY_BYTES`) and a note title's limit
#: (`notes.MAX_TITLE_CHARS`), railed against the backend source by tests/test_notebook_campaign_tooling.py.
W11_MAX_BODY_BYTES = 16 * 1024
MAX_TITLE_CHARS = 300

BE_REF = "origin/feat/notebook-widgets-p2-be"
GALLERY_ROUTER = "api/routers/notebook_template_gallery.py"
STYLES_ROUTER = "api/routers/notebook_journal_styles.py"
ROUTINES_ROUTER = "api/routers/notebook_routines.py"
NOTES_ROUTER = "api/routers/journal_two.py"
ALERTS_ROUTER = "api/routers/alerts.py"

#: name -> (method, the router file, the path as its decorator spells it). The rail reads each decorator.
ROUTES = {
    "library": ("GET", GALLERY_ROUTER, "/library"),
    "item": ("GET", GALLERY_ROUTER, "/{gallery_id}"),
    "preview_mine": ("POST", GALLERY_ROUTER, "/{gallery_id}/preview-mine"),
    "share_preview": ("POST", GALLERY_ROUTER, "/share/preview"),
    "publish_style": ("POST", GALLERY_ROUTER, "/styles"),
    "publish_tool": ("POST", GALLERY_ROUTER, "/tools"),
    "adopt_style": ("POST", GALLERY_ROUTER, "/{gallery_id}/adopt"),
    "adopt_tool": ("POST", GALLERY_ROUTER, "/{gallery_id}/adopt-tool"),
    "use_template": ("POST", GALLERY_ROUTER, "/{gallery_id}/use-template"),
    "helpful": ("POST", GALLERY_ROUTER, "/{gallery_id}/helpful"),
    "unhelpful": ("DELETE", GALLERY_ROUTER, "/{gallery_id}/helpful"),
    "helpful_prompt": ("GET", GALLERY_ROUTER, "/notes/{note_id}/helpful-prompt"),
    "helpful_answer": ("POST", GALLERY_ROUTER, "/{gallery_id}/helpful-prompt"),
    "templates": ("GET", STYLES_ROUTER, "/journal-styles"),
    "archive": ("POST", STYLES_ROUTER, "/journal-styles/{style_id}/archive"),
    "unarchive": ("POST", STYLES_ROUTER, "/journal-styles/{style_id}/unarchive"),
    "delete_typed": ("POST", STYLES_ROUTER, "/journal-styles/{style_id}/delete"),
    "restore": ("POST", STYLES_ROUTER, "/journal-styles/{style_id}/restore"),
    "routine_get": ("GET", ROUTINES_ROUTER, "/{rid}"),
    "routine_put": ("PUT", ROUTINES_ROUTER, "/{rid}"),
    "routine_tick": ("PUT", ROUTINES_ROUTER, "/{rid}/days/{day}/items/{item_id}"),
    "routine_days": ("POST", ROUTINES_ROUTER, "/days"),
    "note_get": ("GET", NOTES_ROUTER, "/notes/{note_id}"),
    "alerts": ("GET", ALERTS_ROUTER, "/api/alerts"),
}


# ── the loopback guard (THE one; run_campaign imports it) ─────────────────────────────────

_NOT_LOCAL = ("--base {base!r} is not localhost/127.0.0.1. This tool only ever drives a local sandbox; "
              "production stays dark and only smoke@ and bench@ sign in to production, never this tool.")


def refuse_non_local(base: str) -> str | None:
    """Why `base` is not a loopback origin, or None. Refused BEFORE parsing (review m1, a parser differential): a
    backslash (WHATWG/Chromium reads `\\` as `/`, urllib does not, so `http://evil.com\\@127.0.0.1` names a
    different host to each), any `@` (userinfo), whitespace or a control character. Then the parsed netloc must be
    exactly `host[:port]` with a numeric port, so no spelling can mean one host to urllib and another to the browser."""
    if not isinstance(base, str) or not base:
        return f"--base {base!r} is not a URL"
    if "\\" in base or "@" in base or any(ord(c) <= 32 or ord(c) == 127 for c in base):
        return f"--base {base!r} holds a backslash, userinfo or a control character; " + _NOT_LOCAL.format(base=base)
    try:
        u = urlparse(base)
        port = u.port
    except Exception:  # noqa: BLE001 -- an unreadable port is not an origin
        return f"--base {base!r} is not a URL"
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or host not in LOCAL_HOSTS or u.username or u.password:
        return _NOT_LOCAL.format(base=base)
    expected = (f"[{host}]" if ":" in host else host) + (f":{port}" if port is not None else "")
    if u.netloc.lower() != expected:
        return f"--base {base!r} is not exactly host[:port]; " + _NOT_LOCAL.format(base=base)
    return None


# ── request builders (pure) ──────────────────────────────────────────────────────────────

def new_key() -> str:
    """One Idempotency-Key: a uuid4, one per deliberate press (W11-R34, `create_keys`)."""
    return str(uuid.uuid4())


def _enc(x: Any) -> str:
    if not isinstance(x, str) or not x:
        raise ValueError(f"an id must be a non-empty string, not {x!r}")
    return quote(x, safe="")


def req(method: str, path: str, body: Any = None, *, key: str | None = None, headers: dict | None = None,
        raw: bytes | None = None) -> dict:
    h = dict(headers or {})
    if key is not None:
        h[IDEMPOTENCY_HEADER] = key
    out = {"method": method, "path": path, "headers": h}
    if raw is not None:
        out["raw"] = raw
    elif body is not None:
        out["body"] = body
    return out


def _clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}


def b_library(group: str = "") -> dict:
    return req("GET", f"{GALLERY}/library" + (f"?{urlencode({'group': group})}" if group else ""))


def b_item(gid: str) -> dict:
    return req("GET", f"{GALLERY}/{_enc(gid)}")


def b_preview_mine(gid: str, answers: dict | None = None) -> dict:
    return req("POST", f"{GALLERY}/{_enc(gid)}/preview-mine", _clean({"answers": answers}))


def b_share_preview(kind: str, tool_id: str, *, edits: Any = None, keep: Any = None) -> dict:
    return req("POST", f"{GALLERY}/share/preview", _clean({"kind": kind, "id": tool_id, "edits": edits, "keep": keep}))


def b_publish_style(style_id: str, *, title: str, category: str, description: str | None = None,
                    trading_style: str | None = None, edits: Any = None, keep: Any = None) -> dict:
    return req("POST", f"{GALLERY}/styles", _clean({"styleId": style_id, "title": title, "category": category,
                                                     "description": description, "tradingStyle": trading_style,
                                                     "edits": edits, "keep": keep}))


def b_publish_tool(kind: str, tool_id: str, *, title: str, description: str | None = None, edits: Any = None,
                   keep: Any = None) -> dict:
    return req("POST", f"{GALLERY}/tools", _clean({"kind": kind, "id": tool_id, "title": title,
                                                    "description": description, "edits": edits, "keep": keep}))


def b_adopt_style(gid: str, *, key: str | None, notify: bool | None = None, answers: dict | None = None,
                  choices: dict | None = None) -> dict:
    return req("POST", f"{GALLERY}/{_enc(gid)}/adopt",
               _clean({"notify": notify, "answers": answers, "choices": choices}), key=key)


def b_adopt_tool(gid: str, *, key: str | None, notify: bool | None = None, answers: dict | None = None) -> dict:
    return req("POST", f"{GALLERY}/{_enc(gid)}/adopt-tool", _clean({"notify": notify, "answers": answers}), key=key)


def b_use_template(gid: str, *, key: str | None, answers: dict | None = None, choices: dict | None = None,
                   title: Any = None, ticker: Any = None) -> dict:
    return req("POST", f"{GALLERY}/{_enc(gid)}/use-template",
               _clean({"answers": answers, "choices": choices, "title": title, "ticker": ticker}), key=key)


def b_helpful(gid: str, on: bool = True) -> dict:
    return req("POST" if on else "DELETE", f"{GALLERY}/{_enc(gid)}/helpful")


def b_helpful_prompt(note_id: str) -> dict:
    return req("GET", f"{GALLERY}/notes/{_enc(note_id)}/helpful-prompt")


def b_helpful_answer(gid: str, answer: str) -> dict:
    return req("POST", f"{GALLERY}/{_enc(gid)}/helpful-prompt", {"answer": answer})


TEMPLATE_VIEWS = ("live", "archived", "deleted")


def b_templates(view: str) -> dict:
    if view not in TEMPLATE_VIEWS:
        raise ValueError(f"the Templates tab has no view {view!r}")
    return req("GET", f"{STYLES}?view={view}")


def b_style_action(style_id: str, action: str, typed_name: str | None = None) -> dict:
    if action not in ("archive", "unarchive", "delete", "restore"):
        raise ValueError(f"no Templates-tab action {action!r}")
    body = {"typedName": typed_name} if action == "delete" else {}
    return req("POST", f"{STYLES}/{_enc(style_id)}/{action}", body)


def b_routine_get(rid: str) -> dict:
    return req("GET", f"{ROUTINES}/{_enc(rid)}")


def b_routine_put(rid: str, body: dict, *, if_match: Any = None) -> dict:
    return req("PUT", f"{ROUTINES}/{_enc(rid)}", body,
               headers=({"If-Match": str(if_match)} if if_match is not None else None))


def b_routine_tick(rid: str, day: str, item_id: str, ticked: bool = True) -> dict:
    return req("PUT", f"{ROUTINES}/{_enc(rid)}/days/{_enc(day)}/items/{_enc(item_id)}", {"ticked": bool(ticked)})


def b_routine_days(ids: list[str], days: list[str]) -> dict:
    """The batched day read: `{routines: {id: {routine, days: {day: DayEntry}}}}` (DayEntry carries `ticked`)."""
    return req("POST", f"{ROUTINES}/days", {"ids": list(ids), "days": list(days)})


def b_note(note_id: str) -> dict:
    return req("GET", f"{NOTES}/{_enc(note_id)}")


def b_alerts(limit: int = 100) -> dict:
    return req("GET", f"{ALERTS}?limit={int(limit)}")


def b_oversized(path: str, n_bytes: int = W11_MAX_BODY_BYTES + 1) -> dict:
    """A JSON object one byte (or more) over the cap, as raw bytes (counted while it arrives, whatever the length)."""
    pad = "x" * max(0, n_bytes - len('{"pad": ""}'))
    raw = json.dumps({"pad": pad}).encode("utf-8")
    assert len(raw) >= n_bytes
    return req("POST", path, raw=raw, headers={"Content-Type": "application/json"})


# ── the one loopback door ────────────────────────────────────────────────────────────────

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Review m2: a 3xx is the answer, never followed (urllib would copy the Cookie to the next host)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


def _opener():
    return urllib.request.build_opener(_NoRedirect)


class Resp(dict):
    """`{status, body, text, headers}`; `body` is the parsed JSON or None."""

    @property
    def status(self) -> int:
        return self["status"]

    @property
    def body(self) -> Any:
        return self["body"]


def make_resp(status: int, text: str, headers: dict | None = None) -> Resp:
    try:
        body = json.loads(text) if text else None
    except ValueError:
        body = None
    return Resp(status=int(status), body=body, text=text or "", headers=dict(headers or {}))


def http_call(base: str, spec: dict, cookie: str | None, timeout: float = 60.0) -> Resp:
    """One request to the LOCAL sandbox. Refuses any other host on every call."""
    why = refuse_non_local(base)
    if why:
        raise PermissionError(why)
    headers = {"Accept": "application/json", **(spec.get("headers") or {})}
    data = spec.get("raw")
    if data is None and "body" in spec:
        data = json.dumps(spec["body"]).encode("utf-8")
        headers.setdefault("Content-Type", "application/json")
    if cookie:
        headers["Cookie"] = f"uct_session={cookie}"
    url = base.rstrip("/") + spec["path"]
    if not isinstance(spec.get("path"), str) or not spec["path"].startswith("/"):
        # Review m-a: a path that does not start with "/" is appended to the AUTHORITY ("@evil.example/x" makes the
        # base's port userinfo and evil.example the host). The base itself was checked above; this is the only
        # thing a path can add to the origin.
        raise PermissionError(f"the request path {spec.get('path')!r} does not start with '/', so {url!r} would "
                              f"not stay on {base!r}")
    r = urllib.request.Request(url, data=data, method=spec["method"], headers=headers)
    try:
        with _opener().open(r, timeout=timeout) as resp:
            return make_resp(resp.status, resp.read().decode("utf-8", "replace"), dict(resp.headers))
    except urllib.error.HTTPError as e:
        return make_resp(e.code, e.read().decode("utf-8", "replace"), dict(e.headers or {}))


def race(base: str, specs: list[dict], cookie: str | None, timeout: float = 60.0) -> list[Resp]:
    """Every spec at once: one thread each, released together by a barrier. Answers in spec order; a request that
    could not be sent is `{status: 0, text: <why>}` (a transport failure, never a product answer)."""
    why = refuse_non_local(base)
    if why:
        raise PermissionError(why)
    out: list[Resp | None] = [None] * len(specs)
    gate = threading.Barrier(len(specs)) if specs else None

    def one(i: int, spec: dict) -> None:
        try:
            gate.wait(timeout=10)
            out[i] = http_call(base, spec, cookie, timeout)
        except Exception as e:  # noqa: BLE001
            out[i] = make_resp(0, f"{type(e).__name__}: {e}")
    threads = [threading.Thread(target=one, args=(i, s), daemon=True) for i, s in enumerate(specs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout + 15)
    return [o if o is not None else make_resp(0, "no answer before the deadline") for o in out]


# ── reading answers (pure) ───────────────────────────────────────────────────────────────

def detail_of(body: Any) -> tuple[str | None, str | None]:
    """(code, message) of a refusal: `{"detail": {"code", "message"}}`, or a plain-sentence `detail`."""
    d = body.get("detail") if isinstance(body, dict) else None
    if isinstance(d, dict):
        return (d.get("code") if isinstance(d.get("code"), str) else None,
                d.get("message") if isinstance(d.get("message"), str) else None)
    if isinstance(d, str):
        return None, d
    return None, None


def get_path(obj: Any, path: str) -> Any:
    cur = obj
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return None
    return cur


def find_by(items: Any, field: str, value: str) -> dict | None:
    for it in items if isinstance(items, list) else []:
        if isinstance(it, dict) and it.get(field) == value:
            return it
    return None


def answers_from_preview(preview: Any) -> tuple[dict, list[str]]:
    """A Use's `answers` the way the member's client builds them (merge-checklist F3, AdoptSheet): every declared
    choice in the preview's `slots[]`, answered with that slot's `value` (the member's own answer, else their
    suggested value, else Any where the choice allows it). ⛔ NEVER `sampleValue` (W11-R41: what a Sample data card
    ran, never sent on Use). Answers `(answers, unanswered slot ids)`."""
    out, missing = {}, []
    for sl in get_path(preview, "slots") or []:
        if not isinstance(sl, dict) or not isinstance(sl.get("id"), str):
            continue
        v = sl.get("value")
        if v is None:
            missing.append(sl["id"])
        else:
            out[sl["id"]] = v
    return out, missing


def library_template(body: Any, title: str) -> dict | None:
    """The official template card titled `title` in a `GET /library` answer."""
    return find_by(get_path(body, "templates"), "title", title)


def tool_embeds(doc: Any) -> list[dict]:
    """Every routine / tracker block a note body places: `{family, id, day, bind, searchText}` (slot_fill.tool_node:
    a `widgetEmbed` whose `widgetId` is the family and whose params carry the tool id and the bound day)."""
    out: list[dict] = []

    def walk(n: Any) -> None:
        if isinstance(n, dict):
            a = n.get("attrs") if n.get("type") == "widgetEmbed" else None
            if isinstance(a, dict) and a.get("widgetId") in ("routine", "tracker"):
                p = a.get("params") if isinstance(a.get("params"), dict) else {}
                out.append({"family": a["widgetId"], "id": p.get("routineId") or p.get("trackerId"),
                            "day": p.get("day"), "bind": p.get("bind"), "searchText": a.get("searchText")})
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return out


def note_body(note: Any) -> Any:
    if not isinstance(note, dict):
        return None
    for k in ("bodyJson", "body_json", "body"):
        v = note.get(k)
        if isinstance(v, str):
            try:
                return json.loads(v)
            except ValueError:
                return None
        if isinstance(v, (dict, list)):
            return v
    return None


def alerts_list(body: Any) -> list[dict]:
    items = body if isinstance(body, list) else (body.get("alerts") if isinstance(body, dict) else None)
    return [a for a in items or [] if isinstance(a, dict)]


def reminders_for(body: Any, routine_id: str, day: str | None = None) -> list[dict]:
    """The bell's routine reminders for one routine (`routine_reminders.ALERT_TYPE`), on `day` when given."""
    out = []
    for a in alerts_list(body):
        data = a.get("data") if isinstance(a.get("data"), dict) else {}
        if a.get("type") == "routine_reminder" and data.get("routineId") == routine_id and (
                day is None or data.get("day") == day):
            out.append(a)
    return out


# ── judges (pure) ────────────────────────────────────────────────────────────────────────

def _chk(checks: list, what: str, ok: bool, read: Any = "") -> bool:
    checks.append({"what": what, "ok": bool(ok), "read": str(read)[:600]})
    return bool(ok)


def _done(checks: list, *, inconclusive: str | None = None, pending: str | None = None) -> dict:
    """The verdict from the checks: any failing check is FAIL whatever else; else INCONCLUSIVE / PENDING when the
    caller says why; else PASS. ⛔ No checks at all is INCONCLUSIVE: a step that read nothing proved nothing."""
    if any(not c["ok"] for c in checks):
        return {"verdict": FAIL, "checks": checks, "why": "a check failed"}
    if inconclusive:
        return {"verdict": INCONCLUSIVE, "checks": checks, "why": inconclusive}
    if pending:
        return {"verdict": PENDING, "checks": checks, "why": pending}
    if not checks:
        return {"verdict": INCONCLUSIVE, "checks": checks, "why": "nothing was read"}
    return {"verdict": PASS, "checks": checks, "why": ""}


def judge_status(resp: Resp, statuses: tuple | list, what: str) -> dict:
    checks: list = []
    _chk(checks, f"{what} answers {list(statuses)}", resp.status in statuses, f"HTTP {resp.status} {resp['text'][:300]}")
    return _done(checks)


def judge_refusal(resp: Resp, status: int, code: str | None, message: str | None = None, *,
                  interim_code: str | None = None, pending_why: str | None = None) -> dict:
    """Exactly `status` with `code` (and `message`, when named). `interim_code`: the code the branch answers until a
    pending backend batch lands -- seen with the right status and sentence, the step is EXPECTED-PENDING."""
    checks: list = []
    got_code, got_msg = detail_of(resp.body)
    read = f"HTTP {resp.status} code={got_code!r} message={got_msg!r}"
    if not _chk(checks, f"answers {status}", resp.status == status, read):
        return _done(checks)
    if message is not None:
        _chk(checks, f"says {message!r}", got_msg == message, read)
    if code is None:
        return _done(checks)
    if got_code == code:
        _chk(checks, f"code {code!r}", True, read)
        return _done(checks)
    if interim_code is not None and got_code == interim_code:
        return _done(checks, pending=pending_why or f"the branch still answers {interim_code!r}, not {code!r}")
    _chk(checks, f"code {code!r}", False, read)
    return _done(checks)


def _id_at(resp: Resp, path: str) -> Any:
    return get_path(resp.body, path)


def judge_replay(first: Resp, second: Resp, id_path: str) -> dict:
    """The same Idempotency-Key sent twice: the first makes, the second answers the FIRST result (`replayed: true`,
    the same id) and makes nothing (W11-R34)."""
    checks: list = []
    a, b = _id_at(first, id_path), _id_at(second, id_path)
    _chk(checks, "the first press answers 200", first.status == 200, f"HTTP {first.status} {first['text'][:200]}")
    _chk(checks, "the replay answers 200", second.status == 200, f"HTTP {second.status} {second['text'][:200]}")
    _chk(checks, "the first press is not a replay", get_path(first.body, "replayed") in (None, False),
         repr(get_path(first.body, "replayed")))
    _chk(checks, "the replay says replayed: true", get_path(second.body, "replayed") is True,
         repr(get_path(second.body, "replayed")))
    _chk(checks, f"the replay answers the same {id_path}", isinstance(a, str) and bool(a) and a == b, f"{a!r} / {b!r}")
    return _done(checks)


def judge_unkeyed(first: Resp, second: Resp, id_path: str) -> dict:
    """No Idempotency-Key: the key is OPTIONAL on every wave 11 door (W11-R34), so there is no 428 -- two presses
    are two results, neither a replay."""
    checks: list = []
    a, b = _id_at(first, id_path), _id_at(second, id_path)
    for n, r in (("first", first), ("second", second)):
        _chk(checks, f"the {n} unkeyed press answers 200 (never 428)", r.status == 200, f"HTTP {r.status} {r['text'][:200]}")
        _chk(checks, f"the {n} unkeyed press is not a replay", get_path(r.body, "replayed") in (None, False),
             repr(get_path(r.body, "replayed")))
    _chk(checks, f"two unkeyed presses make two {id_path}s", isinstance(a, str) and isinstance(b, str) and a != b,
         f"{a!r} / {b!r}")
    return _done(checks)


def judge_in_flight(resps: list[Resp], id_path: str, in_flight: str, *, listing_moved: str | None = None) -> dict:
    """K presses with ONE key, at once. Every answer is the one result (200; one made, the rest `replayed`) or the
    in-flight refusal (409 `conflict`, `in_flight`). INCONCLUSIVE when no 409 was seen: the twins waited for the
    first (`_wait_for_key`, up to 15 s) and replayed it, so the in-flight answer was not forced."""
    checks: list = []
    lost = [r for r in resps if r.status == 0]
    ok = [r for r in resps if r.status == 200]
    busy = [r for r in resps if r.status == 409]
    other = [r for r in resps if r.status not in (0, 200, 409)]
    _chk(checks, "every answer is 200 or 409", not other, json.dumps([(r.status, r["text"][:120]) for r in other]))
    ids = {_id_at(r, id_path) for r in ok}
    _chk(checks, f"every 200 names ONE {id_path}", len(ids) <= 1 and None not in ids, repr(sorted(map(str, ids))))
    made = [r for r in ok if get_path(r.body, "replayed") is not True]
    if lost and len(made) == 0:
        return _done(checks, inconclusive=f"{len(lost)} of {len(resps)} presses never reached the server (transport)")
    # Review I1: EXACTLY one press made the result (none made is a defect: K presses, no note), and the others
    # answered it (a replay) or were refused in flight.
    _chk(checks, "exactly one press made something", len(made) == 1, f"{len(made)} made of {len(resps)}")
    others = (len(ok) - len(made)) + len(busy)
    _chk(checks, "every other press replayed it or was refused in flight", others >= 1 and others + len(made) + len(
        lost) == len(resps), f"{len(ok) - len(made)} replayed, {len(busy)} refused, {len(lost)} lost")
    moved = []
    for r in busy:
        code, msg = detail_of(r.body)
        if listing_moved is not None and msg == listing_moved:
            moved.append(r)                     # graded by judge_listing_moved, not here
            continue
        _chk(checks, "a 409 is the in-flight refusal (code 'conflict')", code == "conflict", f"{code!r} {msg!r}")
        _chk(checks, f"a 409 says {in_flight!r}", msg == in_flight, repr(msg))
    seen = len(busy) - len(moved)
    if lost:
        return _done(checks, inconclusive=f"{len(lost)} of {len(resps)} presses never reached the server (transport)")
    if seen == 0:
        return _done(checks, inconclusive=(
            f"{len(resps)} presses with one key all answered 200 ({len(made)} made, {len(ok) - len(made)} replayed): "
            "the in-flight 409 was not forced (a twin waits up to 15 s for the first and replays it; the 409 needs the "
            "first request to stall past that, which a client cannot cause)"))
    return _done(checks)


def judge_listing_moved(resp: Resp, sentence: str) -> dict:
    """A listing that moved under the write lock twice (W11-R59/R60): 409 code `listing_moved` with the sentence.
    FINAL on the backend (a196151762): `conflict` is a FAIL."""
    return judge_refusal(resp, 409, "listing_moved", sentence)


def judge_key_reused(resp: Resp, sentence: str) -> dict:
    """The same key on another door or item: 409 `key_reused` (A9). FINAL on the backend: `conflict` is a FAIL."""
    return judge_refusal(resp, 409, "key_reused", sentence)


def judge_busy(resps: list[Resp], busy: str) -> dict:
    """Concurrent previews from one member: each is 200, 503 `busy` (the pool's gates answer at once, nothing
    queues) or a 429 `rate` (recorded). INCONCLUSIVE when no 503 was seen: the runs finished before they overlapped."""
    checks: list = []
    n_busy = 0
    lost = 0
    for r in resps:
        code, msg = detail_of(r.body)
        if r.status == 0:
            lost += 1
            continue
        if r.status == 503:
            _chk(checks, "a 503 is code 'busy'", code == "busy", f"{code!r} {msg!r}")
            _chk(checks, f"a 503 says {busy!r}", msg == busy, repr(msg))
            n_busy += 1
        elif r.status == 429:
            _chk(checks, "a 429 is code 'rate'", code == "rate", f"{code!r} {msg!r}")
        else:
            _chk(checks, "every other answer is 200", r.status == 200, f"HTTP {r.status} {r['text'][:160]}")
    if lost and not any(not c["ok"] for c in checks):
        return _done(checks, inconclusive=f"{lost} of {len(resps)} previews never reached the server (transport)")
    if n_busy == 0:
        return _done(checks, inconclusive=(
            f"{len(resps)} concurrent previews, none refused busy: the member's gates (MEMBER_MAX=2, PREVIEW_MAX=2 "
            "in widget_engine.run) were never full at once on this data"))
    return _done(checks)


def judge_too_long_engine(resp: Resp, too_long: str) -> dict:
    """The engine's deadline (`run.DEADLINE_S` per SQL read): 503 `too_long`. Only gradeable when it happened."""
    if resp.status == 503 and detail_of(resp.body)[0] == "too_long":
        return judge_refusal(resp, 503, "too_long", too_long)
    if resp.status == 0 or (resp.status == 503 and detail_of(resp.body)[0] == "busy"):
        return _done([], inconclusive=("the pool was full (503 busy) or nothing answered, so the engine's deadline "
                                       f"was never reached (HTTP {resp.status})"))
    checks: list = []
    _chk(checks, "the preview answered (200)", resp.status == 200, f"HTTP {resp.status} {resp['text'][:200]}")
    return _done(checks, inconclusive=(
        "the run finished inside the engine deadline (1.5 s per SQL read): `too_long` cannot be forced from a "
        "client on a seeded book"))
