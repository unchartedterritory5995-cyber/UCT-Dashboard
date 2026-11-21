"""Send the value cases' requests through the Create Indicator window on production, as a member sends them.

  python tools/value_record.py <run_dir> [--only id,id] [--lanes formula,script,wall] [--max-usd 5]
                                         [--max-minutes 18] [--account BENCH]

For each case of `tests/fixtures/authoring/value_cases.json`: Charts, the Indicators list, "Describe an
indicator", the member's words, send. Every answer of the door for that request is recorded: the first one, and
each repair the WINDOW asks for after its own engine refused a script (at most two). The LAST answer is the one a
member is left with; it is written as `<id>-0.body.json` (and `<id>-0.pine` for a script), the shape
`tools/value_eval.py --answers <run_dir>` grades. `raw.jsonl` keeps a row per request and `run.json` the run's
stamps (the build served, the model, what was spent, why it stopped).

⛔ PRODUCTION, PAID, AND A REAL BROWSER:
  * it signs in ONLY as a synthetic account (`<ACCOUNT>_EMAIL` / `<ACCOUNT>_PASSWORD` in the environment; an address
    outside the synthetic domain is refused before anything is sent) and signs out at the end. The default is BENCH,
    the MEMBER-role test account: an admin skips checks a member hits, and this measures what a member gets. Every
    row says which account answered it;
  * it runs in CHUNKS: it stops sending after `--max-minutes` (18 by default) and is resumable, so a crowded machine
    lock is never held for an hour;
  * NOTHING IS SAVED: every write to definitions, preferences, the workspace and charts is stopped and named in the
    row, except the turns of the request being sent and the admission question the window asks about a script;
  * it stops at the spend cap and at the door's hourly limit (429), and is resumable (a recorded request is skipped);
  * on this PC a headless browser runs through the machine lock:
      python <uct-clips>/tools/heavy_lock.py --timeout 21600 run -- python tools/value_record.py ...

This file sends; it grades nothing. Nothing here is imported by the product.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json"
BASE = "https://uctintelligence.com"
#: the only accounts an automated production tool signs in as end in this (CLAUDE.md, "the ONE synthetic account")
SYNTHETIC_DOMAIN = "@uctintelligence.internal"
#: the first answer and the window's repairs of it (the window's own limit is two repair rounds)
MAX_ANSWERS = 3
CONVERSE = "/api/user-definitions/converse"
ADMISSION = "/api/user-definitions/runtime-admission"
#: a write to any of these would change the account: stopped, and named in the row
WRITE_GUARDED = ("/api/user-definitions", "/api/auth/preferences", "/api/workspace/", "/api/charts/")


def is_synthetic(email: Optional[str]) -> bool:
    return isinstance(email, str) and email.strip().lower().endswith(SYNTHETIC_DOMAIN)


def route_action(method: str, url: str, turns_allowed: int) -> str:
    """What to do with one request of the page: 'continue', 'turn' (continue and spend one allowed turn),
    'admission' (continue: it stores nothing), 'unsent' (a turn nobody sent: stop it) or 'write' (stop it)."""
    path = url.split("?")[0]
    if method == "POST" and CONVERSE in path:
        return "turn" if turns_allowed > 0 else "unsent"
    if method == "POST" and path.endswith(ADMISSION):
        return "admission"
    if method != "GET" and any(k in path for k in WRITE_GUARDED):
        return "write"
    return "continue"


def todo(cases: List[Dict[str, Any]], done: set, only: set, lanes: set) -> List[Dict[str, Any]]:
    return [c for c in cases if c["id"] not in done and (not only or c["id"] in only) and (not lanes or c["lane"] in lanes)]


def last_answer(answers: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The answer a member is left with: the last one the door gave with status 200."""
    good = [a for a in answers if a.get("status") == 200 and isinstance(a.get("body"), dict)]
    return good[-1]["body"] if good else None


def out_of_time(began: float, now: float, max_minutes: float) -> bool:
    """A chunk sends no new request once it has run for `max_minutes` (one in flight is finished, never cut)."""
    return (now - began) / 60.0 >= max_minutes


def answered_by(raw_lines: List[str]) -> Dict[str, List[str]]:
    """{account: the ids it answered}, from the run's rows: a run finished on a second account says so."""
    out: Dict[str, List[str]] = {}
    for line in raw_lines:
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("done"):
            out.setdefault(row.get("account") or "unknown", []).append(row["id"])
    return out


def _opt(args: List[str], name: str, default: str) -> str:
    return args[args.index(name) + 1] if name in args else default


def main(argv: List[str]) -> int:
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    out = Path(argv[0])
    only = set(filter(None, _opt(argv, "--only", "").split(",")))
    lanes = set(filter(None, _opt(argv, "--lanes", "").split(",")))
    max_usd = float(_opt(argv, "--max-usd", "5"))
    max_minutes = float(_opt(argv, "--max-minutes", "18"))
    account = _opt(argv, "--account", "BENCH").upper()
    email, password = os.environ.get(account + "_EMAIL"), os.environ.get(account + "_PASSWORD")
    if not is_synthetic(email) or not password:
        print(f"REFUSED: {account}_EMAIL is not a synthetic account ({SYNTHETIC_DOMAIN}) or {account}_PASSWORD is not set")
        return 2
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
    out.mkdir(parents=True, exist_ok=True)
    raw_path = out / "raw.jsonl"
    done, spent = set(), 0.0
    if raw_path.exists():
        for line in raw_path.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            spent += float(row.get("usd") or 0)
            if row.get("done"):
                done.add(row["id"])
    queue = todo(cases, done, only, lanes)
    print(f"{len(queue)} requests to send; {len(done)} done; spent ${spent:.3f} of ${max_usd}")
    if not queue:
        return 0
    from playwright.sync_api import sync_playwright          # only a run needs the browser

    stamps: Dict[str, Any] = {"account": account, "started": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime())}
    stopped = None
    began = time.time()
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_context(viewport={"width": 1280, "height": 900}).new_page()
        page.goto(BASE + "/login", wait_until="domcontentloaded")
        page.request.post(BASE + "/api/auth/login", data={"email": email, "password": password})
        me = (page.request.get(BASE + "/api/auth/me").json().get("user") or {})
        if not is_synthetic(me.get("email")):
            browser.close()
            print("REFUSED: the session is not a synthetic account's (sign-in did not answer, or answered as someone else)")
            return 2
        stamps["front"] = (page.request.get(BASE + "/build.json").json().get("commit") or "")[:10]
        stamps["backend"] = (page.request.get(BASE + "/api/health").json().get("commit") or "")[:10]
        held_before = page.request.get(BASE + "/api/user-definitions").text()
        state: Dict[str, Any] = {"allow": 0, "answers": [], "stopped": [], "unsent": 0}

        def guard(route):
            action = route_action(route.request.method, route.request.url, state["allow"])
            if action == "turn":
                state["allow"] -= 1
            if action in ("unsent", "write"):
                if action == "unsent":
                    state["unsent"] += 1
                else:
                    state["stopped"].append(route.request.method + " " + route.request.url.split("?")[0].replace(BASE, ""))
                route.abort()
            else:
                route.continue_()
        page.route("**/api/**", guard)

        def on_response(resp):
            if resp.request.method != "POST" or CONVERSE not in resp.url:
                return
            try:
                body = resp.json() if resp.status == 200 else {"_text": resp.text()[:300]}
            except Exception as exc:  # noqa: BLE001
                body = {"_text": str(exc)[:200]}
            state["answers"].append({"status": resp.status, "body": body, "at": time.time()})
        page.on("response", on_response)

        for n, case in enumerate(queue):
            if spent >= max_usd:
                stopped = "the spend cap"
                break
            if out_of_time(began, time.time(), max_minutes):
                stopped = f"the chunk's time ({max_minutes:g} min): run it again to go on"
                break
            row: Dict[str, Any] = {"id": case["id"], "lane": case["lane"], "words": case["words"], "account": account}
            try:
                page.goto(BASE + "/charts", wait_until="domcontentloaded")
                # every request starts from an EMPTY bench: the window restores its draft from this tab's storage,
                # and a request sent over a draft is answered as a CHANGE to it
                page.evaluate("() => { try { sessionStorage.clear() } catch (e) {} }")
                page.goto(BASE + "/charts", wait_until="domcontentloaded")
                time.sleep(2)
                page.keyboard.press("Escape")
                time.sleep(8)
                if page.locator("[aria-label='Chart settings'], [title='Chart settings']").count() == 0:
                    page.get_by_role("button", name="Add widget").first.click(timeout=6000)
                    time.sleep(1.0)
                    page.get_by_text("Chart", exact=True).first.click(timeout=6000)
                    time.sleep(9)
                box = page.locator("canvas").first.bounding_box()
                page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
                time.sleep(0.6)
                page.keyboard.press("Alt+Shift+A")
                time.sleep(1.5)
                page.get_by_test_id("library-describe").first.click(timeout=8000)
                time.sleep(1.5)
                page.get_by_test_id("create-indicator-input").first.fill(case["words"])
                state.update(answers=[], allow=MAX_ANSWERS, stopped=[], unsent=0)
                t0 = time.time()
                page.get_by_test_id("create-indicator-send").first.click(timeout=6000)
                # the first answer: up to 150 s. Then each repair: quiet for 25 s after a script answer is the end
                deadline = t0 + 150
                while time.time() < deadline and len(state["answers"]) < MAX_ANSWERS:
                    page.wait_for_timeout(500)
                    if state["answers"]:
                        last = state["answers"][-1]
                        if last["status"] != 200 or last["body"].get("turn") != "script" or time.time() - last["at"] > 25:
                            break
                        deadline = max(deadline, last["at"] + 150)
                state["allow"] = 0
                page.wait_for_timeout(2500)
                answers = list(state["answers"])
                usd = sum(float(((a["body"] or {}).get("usage") or {}).get("usd") or 0) for a in answers)
                spent += usd
                body = last_answer(answers)
                if body is not None:
                    (out / f"{case['id']}-0.body.json").write_text(json.dumps(body, indent=1), encoding="utf-8")
                    pine = (body.get("script") or {}).get("pine") if isinstance(body.get("script"), dict) else None
                    if isinstance(pine, str):
                        (out / f"{case['id']}-0.pine").write_text(pine, encoding="utf-8", newline="\n")
                    stamps.setdefault("model", body.get("model") or (body.get("usage") or {}).get("model"))
                row.update(seconds=round(time.time() - t0, 1), usd=round(usd, 6), answers=len(answers),
                           statuses=[a["status"] for a in answers], turn=(body or {}).get("turn"), disposition=(body or {}).get("disposition"),
                           writes_stopped=sorted(set(state["stopped"])), turns_nobody_sent=state["unsent"],
                           done=bool(answers) and all(a["status"] == 200 for a in answers))
                if any(a["status"] == 429 for a in answers):
                    stopped = "the door's hourly limit (429)"
            except Exception as exc:  # noqa: BLE001 -- one request failing to send is a row, not the end of the run
                row["error"] = str(exc)[:300]
            with raw_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "\n")
            print(f"  {n + 1:>3}/{len(queue)} {case['id']:<10} {row.get('turn') or row.get('disposition') or row.get('error', '')[:40]}  ${row.get('usd', 0):.4f}  {row.get('seconds')}s")
            if stopped:
                break
        held_after = page.request.get(BASE + "/api/user-definitions").text()
        page.request.post(BASE + "/api/auth/logout")
        browser.close()
    stamps.update(spent_usd=round(spent, 4), stopped=stopped, left_the_account_as_it_was=held_after == held_before,
                  ended=time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()))
    stamps["answered_by"] = answered_by(raw_path.read_text(encoding="utf-8").splitlines())
    previous = out / "run.json"
    if previous.exists():                                      # an earlier chunk of the same run: keep when it BEGAN
        stamps["started"] = json.loads(previous.read_text(encoding="utf-8")).get("started") or stamps["started"]
    (out / "run.json").write_text(json.dumps(stamps, indent=1), encoding="utf-8")
    print(json.dumps(stamps))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
