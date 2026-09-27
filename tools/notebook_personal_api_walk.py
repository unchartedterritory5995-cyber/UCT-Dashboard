"""The Notebook personal API walked in PRODUCTION as the synthetic member bench@
(wave 10, lane 10D — clauses 11c/10a production verification after the §2 flip).

    mint a token -> create a note -> append to it -> append to today's daily note
    -> revoke the token (and prove it is refused) -> trash everything the walk made

⛔ WHO: ONLY the synthetic MEMBER account in BENCH_EMAIL / BENCH_PASSWORD (the
operator's user environment). The script reads `/api/auth/me` before its first
write and STOPS unless the signed-in email is exactly BENCH_EMAIL — the owner's
Chrome, the smoke admin and any person are refused by construction. It runs in its
OWN Playwright request context (its own cookie jar, never the owner's Chrome). The password and the
token are never printed and never written to the evidence file.

⛔ WHAT IT LEAVES: nothing live. Every token it mints is revoked (in `finally`, even
on a failure); every note it makes is moved to Trash (a soft delete — a permanent
delete is the owner's, S-2). It NEVER creates a folder: a note is created at the
top level, and the daily append — whose door makes a root `Daily` folder when the
member has none (note_daily._daily_folder_id) — runs ONLY when bench@ already has
that folder AND has no daily note for today yet (so the walk makes, and then
trashes, today's note rather than writing into one it did not make). Otherwise the
step is NOT RUN, with the reason, and the walk says so.

⛔ "NO DAILY NOTE FOR TODAY" IS DECIDED THE WAY THE SERVER DECIDES IT (review M-2):
by `dailyDate` on the full note (the unique index `idx_j2_notes_daily`), read for
EVERY live and archived note bench@ has — never by a title inside a capped list. A
title is only how the door names a note it creates; the member can rename or move
it, and an archived daily note is still today's. When the walk cannot read every
note (a non-200, or more than DAILY_SCAN_CAP), it cannot prove today's note is
absent, and the step is NOT RUN. The folder name and title come from
`note_daily` itself (`DAILY_FOLDER_NAME`, `daily_title`), never restated here.

R-RAW: the raw per-step record is written to --out BEFORE the summary is printed.
Exit: 0 every step PASS · 1 a FAIL · 2 INCONCLUSIVE (not signed in / no credentials).

    python tools/notebook_personal_api_walk.py --out docs/notebook/evidence/wave10-10d/<run>.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
from zoneinfo import ZoneInfo

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

_REPO = pathlib.Path(__file__).resolve().parent.parent
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))
# ⛔ The census and the tripwire BEFORE any api.* import (tests/test_notebook_bridges_pin_the_root.py):
# run as a script this tool is outside pytest, and an api module that captures a path at import
# would otherwise resolve it against the live C:\data.
import conftest  # noqa: E402,F401
# One authority: the folder the daily door makes and the title it gives today's
# note are note_daily's. (Importing it opens no database: auth_db connects lazily.)
from api.services.journal_two.note_daily import DAILY_FOLDER_NAME, daily_title  # noqa: E402

ET = ZoneInfo("America/New_York")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/140.0.0.0 Safari/537.36")

#: The daily gate reads every live and archived note in full (the list door carries
#: no `dailyDate`). Past this many it cannot prove today's note is absent, so the
#: step does not run.
DAILY_SCAN_CAP = 300
_PAGE = 100


def _list_note_ids(req, params: dict) -> tuple[list, bool]:
    """Every note id the list door answers for `params`, paging to its `total`.
    (ids, complete): complete is False on a non-200 or past DAILY_SCAN_CAP."""
    ids: list = []
    offset = 0
    while True:
        r = req.get("/api/j2/notes", params={**params, "limit": _PAGE, "offset": offset})
        if r.status != 200:
            return ids, False
        body = r.json() or {}
        rows = body.get("notes") or []
        ids += [n.get("id") for n in rows if n.get("id")]
        if len(ids) > DAILY_SCAN_CAP:
            return ids, False
        offset += _PAGE
        if not rows or offset >= int(body.get("total") or 0):
            return ids, True


def find_todays_daily_note(req, day_iso: str) -> tuple:
    """(note_id, None) when a live note carries `dailyDate == day_iso`; (None, None)
    when every live and archived note was read and none does; (None, why) when that
    could not be proven. Trashed notes are not asked about: the daily door releases a
    trashed holder's day before it looks (notes.release_trashed_daily_date)."""
    ids: list = []
    for params, label in (({}, "live"), ({"folder_id": "__archived__"}, "archived")):
        got, complete = _list_note_ids(req, params)
        if not complete:
            return None, (f"could not list every {label} note (more than {DAILY_SCAN_CAP}, or a "
                          "non-200), so the walk cannot prove today's daily note is absent")
        ids += got
    for nid in dict.fromkeys(ids):
        g = req.get(f"/api/j2/notes/{nid}")
        if g.status != 200:
            return None, (f"could not read note {nid} in full (HTTP {g.status}), so the walk "
                          "cannot prove today's daily note is absent")
        if ((g.json() or {}).get("note") or {}).get("dailyDate") == day_iso:
            return nid, None
    return None, None


def daily_step(req, bare, bearer: dict, today, step, rec) -> int:
    """The daily append, only where it can create no folder and touch no note of
    bench's. Returns the exit-code contribution (0, or 1 on a FAIL)."""
    folders = (req.get("/api/j2/note-folders").json() or {}).get("folders") or []
    # The door's own match: a ROOT folder whose name equals DAILY_FOLDER_NAME under
    # NOCASE (note_daily._daily_folder_id) — no trimming, or " Daily" would read as
    # present here while the door, finding none, CREATED one.
    daily = [f for f in folders if str(f.get("name") or "").lower() == DAILY_FOLDER_NAME.lower()
             and not f.get("parentId")]
    day_iso = today.isoformat()
    if not daily:
        step("append to today's daily note", "NOT RUN", None,
             why=f"bench@ has no root {DAILY_FOLDER_NAME} folder, and the daily door would CREATE one — "
                 "the walk never creates a folder in production")
        return 0
    existing, why = find_todays_daily_note(req, day_iso)
    if why:
        step("append to today's daily note", "NOT RUN", None, why=why)
        return 0
    if existing:
        step("append to today's daily note", "NOT RUN", None, note_id=existing,
             why="bench@ already has a note whose dailyDate is today; the walk does not write into "
                 "a note it did not make")
        return 0
    daily_text = "10D walk: a daily entry through the personal API."
    r = bare.post("/api/j2/personal/daily/append", headers=bearer,
                  data=json.dumps({"markdown": daily_text}))
    dj = r.json() if r.status == 200 else {}
    did = (dj.get("note") or {}).get("id")
    # ⛔ Only a note THIS request made is the walk's to trash. `created: false`
    # means today's note existed after all (a race with the scan above) — it is
    # bench@'s, it is left alone, and the step fails so the report says so.
    if did and dj.get("created") is True:
        rec["made"]["note_ids"].append(did)
    ok = r.status == 200 and did and dj.get("created") is True and dj.get("day") == day_iso
    step("append to today's daily note (made today's note)", "PASS" if ok else "FAIL", r.status,
         note_id=did, created=dj.get("created"), day=dj.get("day"), expected_title=daily_title(today))
    return 0 if ok else 1


def _mask(email: str) -> str:
    local, _, domain = (email or "").partition("@")
    return (local[:1] + "***@" + domain) if domain else "***"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default="https://uctintelligence.com")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    email = os.environ.get("BENCH_EMAIL") or ""
    password = os.environ.get("BENCH_PASSWORD") or ""
    started = dt.datetime.now(dt.timezone.utc)
    rec: dict = {"tool": "notebook_personal_api_walk", "base": args.base,
                 "started_utc": started.isoformat(timespec="seconds"),
                 "account": _mask(email), "steps": [], "made": {"token_ids": [], "note_ids": []},
                 "cleanup": []}

    def step(name, ok, http=None, **detail):
        rec["steps"].append({"step": name, "result": ok, "http": http, **detail})
        print(f"  [{ok}] {name}" + (f" (HTTP {http})" if http is not None else ""))

    def finish(code: int) -> int:
        rec["finished_utc"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        rec["exit"] = code
        out_path.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")   # R-RAW first
        fails = [s["step"] for s in rec["steps"] if s["result"] == "FAIL"]
        print(f"WALK: exit {code} — {len(rec['steps'])} step(s), FAIL {fails or 'none'}; "
              f"evidence {out_path}")
        return code

    if not email or not password:
        step("credentials in the operator environment", "INCONCLUSIVE-OWNER",
             why="BENCH_EMAIL / BENCH_PASSWORD not set")
        return finish(2)

    from playwright.sync_api import sync_playwright

    token = None
    token_id = None
    code = 0
    with sync_playwright() as pw:
        # Playwright's own HTTP context: its own cookie jar, no browser process, and
        # never the owner's Chrome. A browser User-Agent, because the edge refuses a
        # script's default one.
        req = pw.request.new_context(base_url=args.base, user_agent=UA)
        # ⛔⛔ THE BEARER CALLS GO THROUGH A SECOND, COOKIE-LESS CONTEXT. The personal routes
        # resolve SESSION-FIRST (api/middleware/capture_scope.py: a live session is strictly
        # more authorized than any token), so a bearer sent beside the member's cookie is
        # never looked at. ⚰️ The first run (evidence personal-api-walk-20260927T043104Z.json)
        # sent both: create/append "passed" on the SESSION and a revoked token "was accepted"
        # — a finding the instrument manufactured. This context carries ONLY the bearer, which
        # is exactly what an iOS Shortcut sends; the control below proves it has no session.
        bare = pw.request.new_context(base_url=args.base, user_agent=UA)
        try:
            r = req.post("/api/auth/login", data=json.dumps({"email": email, "password": password}),
                         headers={"Content-Type": "application/json"})
            if not r.ok:
                step("sign in as bench@", "INCONCLUSIVE-OWNER", r.status)
                return finish(2)
            me = req.get("/api/auth/me").json()
            u = me.get("user") or me
            who = str(u.get("email") or "")
            if who.lower() != email.lower():
                step("the session is bench@ and nobody else", "FAIL", 200, signed_in_as=_mask(who))
                return finish(1)
            step("sign in as bench@ (member, own context)", "PASS", r.status,
                 role=u.get("role"), paid_equiv=me.get("paid_equiv", u.get("paid_equiv")),
                 personal_api_flag=me.get("notebook_personal_api_enabled",
                                          u.get("notebook_personal_api_enabled")))

            r = req.get("/api/j2/personal/tokens")
            step("GET /personal/tokens answers (the gate is armed)", "PASS" if r.status == 200 else "FAIL",
                 r.status)
            if r.status != 200:
                return finish(1)

            label = "10D walk " + started.strftime("%Y-%m-%dT%H:%MZ") + " (auto-revoked)"
            r = req.post("/api/j2/personal/tokens", data=json.dumps({"label": label}),
                         headers={"Content-Type": "application/json"})
            if r.status != 200:
                step("mint a personal token", "FAIL", r.status, detail=(r.text() or "")[:200])
                return finish(1)
            body = r.json()
            token, token_id = body.get("token"), body.get("tokenId")
            rec["made"]["token_ids"].append(token_id)
            step("mint a personal token", "PASS", r.status, token_id=token_id,
                 scopes=body.get("scopes"), expires_at=body.get("expiresAt"))
            bearer = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

            r = bare.post("/api/j2/personal/notes", headers={
                "Authorization": "Bearer uctpat_not-a-real-token", "Content-Type": "application/json"},
                data=json.dumps({"title": "10D walk control — MUST NOT EXIST"}))
            if r.status == 200:
                leaked = (r.json().get("note") or {}).get("id")
                if leaked:
                    rec["made"]["note_ids"].append(leaked)
            step("CONTROL: the bearer-only context has no session (a bogus token is refused)",
                 "PASS" if r.status == 401 else "FAIL", r.status)
            if r.status != 401:
                return finish(1)

            create_text = "Wave 10 lane 10D production walk: created through the personal API."
            r = bare.post("/api/j2/personal/notes", headers=bearer, data=json.dumps(
                {"title": "10D walk — safe to delete", "markdown": create_text}))
            note_id = (r.json().get("note") or {}).get("id") if r.status == 200 else None
            if note_id:
                rec["made"]["note_ids"].append(note_id)
            step("create a note (top level, no folder)", "PASS" if note_id else "FAIL", r.status,
                 note_id=note_id)
            if not note_id:
                code = 1
            else:
                append_text = "Appended by the same token, a moment later."
                r = bare.post(f"/api/j2/personal/notes/{note_id}/append", headers=bearer,
                             data=json.dumps({"markdown": append_text}))
                step("append to that note", "PASS" if r.status == 200 else "FAIL", r.status)
                g = req.get(f"/api/j2/notes/{note_id}")
                plain = ((g.json().get("note") or {}).get("bodyPlain") or "") if g.status == 200 else ""
                both = create_text in plain and append_text in plain
                step("read it back as the member: both texts, in order", "PASS" if both
                     and plain.index(create_text) < plain.index(append_text) else "FAIL", g.status,
                     folder_id=(g.json().get("note") or {}).get("folderId") if g.status == 200 else None)
                if r.status != 200 or not both:
                    code = 1

            # ── the daily append, only where it can create no folder and touch no note of bench's ──
            if daily_step(req, bare, bearer, dt.datetime.now(ET).date(), step, rec):
                code = 1

            r = req.delete(f"/api/j2/personal/tokens/{token_id}")
            step("revoke the token (session)", "PASS" if r.status == 200 else "FAIL", r.status)
            revoked_ok = r.status == 200
            r = bare.post("/api/j2/personal/notes", headers=bearer, data=json.dumps(
                {"title": "10D walk — MUST NOT EXIST", "markdown": "a revoked token wrote this"}))
            refused = r.status in (401, 403)
            if r.status == 200:
                leaked = (r.json().get("note") or {}).get("id")
                if leaked:
                    rec["made"]["note_ids"].append(leaked)
            step("the revoked token is refused on its next request", "PASS" if refused else "FAIL", r.status)
            if not (revoked_ok and refused):
                code = 1
            if revoked_ok:
                token_id_done = token_id
                rec["made"]["token_ids_revoked"] = [token_id_done]
            return finish(code)
        finally:
            # ── cleanup, whatever happened above ──
            try:
                if token_id and token_id not in (rec["made"].get("token_ids_revoked") or []):
                    r = req.delete(f"/api/j2/personal/tokens/{token_id}")
                    rec["cleanup"].append({"revoke": token_id, "http": r.status})
                for nid in rec["made"]["note_ids"]:
                    r = req.delete(f"/api/j2/notes/{nid}")
                    after = req.get(f"/api/j2/notes/{nid}")
                    rec["cleanup"].append({"trash": nid, "http": r.status,
                                           "reads_after": after.status})
                left = [t for t in (req.get("/api/j2/personal/tokens").json().get("tokens") or [])
                        if t.get("id") in rec["made"]["token_ids"] and not t.get("revokedAt")]
                rec["cleanup"].append({"tokens_still_live_from_this_walk": [t.get("id") for t in left]})
                req.post("/api/auth/logout")
            finally:
                out_path.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
                req.dispose()
                bare.dispose()


if __name__ == "__main__":
    sys.exit(main())
