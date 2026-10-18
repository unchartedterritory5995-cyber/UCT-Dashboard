"""Notebook P2 Tier 3, Task 10 -- one real-browser walk of Tier 3's three features, the way a member meets
them, read off the RENDERED pages (the shape of P3a's tools/notebook_style_library_walk.py).

PRECONDITIONS (the run refuses or records NOT RUN without each; it never assumes one):
  * a sandbox booted from the tip under test, through scripts/hub_sandbox_boot.py (this tool boots its own
    via notebook_perf_harness.Sandbox, on an EMPTY data dir outside C:\\data, on a free port; it refuses a
    busy port and never kills another process);
  * `app/dist` rebuilt from that tip (`cd app && npm run build`) -- the sandbox serves the built bundle;
  * JOURNAL_TIER3_ENABLED=1 and NOTEBOOK_JOURNAL_STYLES_ENABLED=1 in the sandbox env, on top of the flags
    the ledger records as armed on web (notebook_fin_walk.flag_sets()["c1"]). Both names are read from
    api/routers/auth.py NOTEBOOK_FLAGS at run time and the run refuses if either is not a gate there
    (⚰️ the plan wrote "JOURNAL_STYLES_ENABLED"; no flag has that name). This tool sets them in its own
    environment, which the sandbox inherits;
  * ONE paid walk account per viewport on that data dir, created here (signed up through the app, then
    comped and email-verified by the admin through the app's own admin routes; /api/auth/me must say
    paid-equivalent), each seeded through POST /api/j2/trades with 30 closed trades that all carry
    emotion tags (22 winners tagged "patient", 8 losers tagged "fomo"; 14 closed in last year, 16 this
    year, 2 of them today ET), and its account given the setups VCP and Breakout;
  * an ADMIN account through ADMIN_EMAILS: the launcher's default (notebook_perf_harness.ADMIN_EMAIL).
  The accounts and their password are this tool's SANDBOX SEED; they exist only in the throwaway data dir.

THE STEPS, once per viewport (1280, 820, 390), each on that viewport's own member:
  1. Insert the check-in from the slash menu, pick Good and Focused, navigate away within 1.5 s, reopen:
     both are kept (the reopened block and the server's copy) and no conflicted copy appeared (the spec's
     P0.0 repro shape).
  2. Insights -> Psychology -> By check-in shows the day (one check-in day; Good and Focused each one day).
  3. Insights -> Checklist from my winners shows at least one suggestion; accept it; the pre-entry
     checklist block in a NEW trade plan (Research Home -> From a style -> Trade plan) lists it. If that
     block is not reachable in a new trade plan the step is INCONCLUSIVE with the reason, never a PASS.
  4. Report -> Your <year> in trading (the door's Earlier years picker; the current year opens December 1)
     shows its four sections.

Every step records PASS, FAIL or INCONCLUSIVE with the rendered text it read. PASS needs every check to have
read the product's answer and found it right; FAIL is a product answer that was wrong; INCONCLUSIVE is a step
the driver could not read to its end. INCONCLUSIVE is never a pass. R-RAW: walk.json is rewritten after every
step, before any verdict.

Usage (PowerShell, data dir single-quoted):
    python tools/journal_tier3_walk.py --data-dir 'C:\\data-t3walk' --port 8081 `
        --tip <sha> --out docs/notebook/evidence/t3-walk-<run-id>

This driver never imports api.* in its own process. Never run on import.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
for _p in (REPO / "tools", REPO / "scripts"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import notebook_perf_harness as h  # noqa: E402
import notebook_fin_walk as fw  # noqa: E402  -- flag_sets, settle_first_run, BENIGN, VIEWPORTS, notes_list

VIEWPORTS = fw.VIEWPORTS
TIER3_FLAGS = ["NOTEBOOK_JOURNAL_STYLES_ENABLED", "JOURNAL_TIER3_ENABLED"]
PW = "LocalTest2026!"          # sandbox seed (throwaway data dir only; the walk tools' shared sandbox password)
T = 30000
SELECTED_ACCOUNT_KEY = "uct.j2.selectedAccountId"          # hooks/useJ2SelectedAccount.js
TODAY_ET = datetime.now(ZoneInfo("America/New_York")).date()
LAST_YEAR = TODAY_ET.year - 1

REC: dict = {"tool": "tools/journal_tier3_walk.py", "steps": [], "setup": []}
OUT: Path | None = None


# ── words read from the source, never typed ───────────────────────────────────────────────

def _const(rel: str, name: str) -> str:
    src = (REPO / rel).read_text(encoding="utf-8")
    m = re.search(r"(?:export const|^)\s*" + re.escape(name) + r"\s*=\s*(['\"])(.*?)\1", src, re.M)
    if not m:
        raise SystemExit(f"REFUSED: could not read {name} from {rel}")
    return m.group(2)


J2 = "app/src/pages/journal-2-0"
ADDED = _const(f"{J2}/components/insights/ChecklistFromWinners.jsx", "ADDED_TEXT")
CHECKIN_LABEL = re.search(r"id: 'moodCheckIn',\s*label: '([^']+)'",
                          (REPO / f"{J2}/lib/journalBlocks.js").read_text(encoding="utf-8")).group(1)
WRAPPED_SECTIONS = ("Best setups", "Most-written tickers", "Discipline trend", "Lessons you wrote into your rules")


# ── recorder ──────────────────────────────────────────────────────────────────────────────

def flush() -> None:
    if OUT is not None:
        tmp = OUT / "walk.json.tmp"
        tmp.write_text(json.dumps(REC, indent=1, ensure_ascii=False, default=str), encoding="utf-8", newline="\n")
        os.replace(tmp, OUT / "walk.json")


class Watch:
    """Console errors, page errors and every response >= 400 one page saw, per step."""

    def __init__(self, pg):
        self.events: list[dict] = []
        pg.on("console", lambda m: m.type == "error" and self.events.append({"console": m.text[:300]}))
        pg.on("pageerror", lambda e: self.events.append({"pageerror": str(e)[:300]}))
        pg.on("response", lambda r: r.status >= 400 and not any(b in r.url for b in fw.BENIGN)
              and self.events.append({"http": r.status, "url": r.url[:200]}))

    def take(self) -> list[dict]:
        out, self.events = self.events, []
        return out


class Inconclusive(Exception):
    """The driver could not reach what the step asks about; the reason is the message."""


class Step:
    def __init__(self, vp: str, n: int, title: str):
        self.row = {"viewport": vp, "step": n, "title": title, "checks": [], "rendered": [], "verdict": None}

    def read(self, what: str, text: str) -> str:
        self.row["rendered"].append({"what": what, "text": (text or "").strip()[:1500]})
        return text or ""

    def check(self, what: str, ok: bool, read: str) -> bool:
        self.row["checks"].append({"what": what, "ok": bool(ok), "read": (read or "")[:600]})
        return ok


def run_step(vp: str, n: int, title: str, fn, pg, watch) -> dict:
    st = Step(vp, n, title)
    try:
        fn(st)
        checks = st.row["checks"]
        st.row["verdict"] = "PASS" if checks and all(c["ok"] for c in checks) else "FAIL"
    except Inconclusive as e:
        failed = [c for c in st.row["checks"] if not c["ok"]]
        st.row["verdict"] = "FAIL" if failed else "INCONCLUSIVE"
        st.row["inconclusive_reason"] = str(e)[:600]
    except Exception as e:  # noqa: BLE001 -- a read the driver could not finish
        failed = [c for c in st.row["checks"] if not c["ok"]]
        st.row["verdict"] = "FAIL" if failed else "INCONCLUSIVE"
        st.row["error"] = f"{type(e).__name__}: {str(e)[:500]}"
        st.row["traceback"] = traceback.format_exc()[-1500:]
    st.row["events"] = watch.take()
    try:
        shot = OUT / vp / f"step{n}.jpg"
        shot.parent.mkdir(parents=True, exist_ok=True)
        pg.screenshot(path=str(shot), type="jpeg", quality=55)
    except Exception:  # noqa: BLE001
        pass
    if st.row["verdict"] != "PASS":
        try:
            st.row["page_text"] = pg.locator("body").inner_text(timeout=3000)[:2500]
        except Exception:  # noqa: BLE001
            pass
    REC["steps"].append(st.row)
    flush()
    print(f"[{vp}] step {n} {st.row['verdict']}: {title}", flush=True)
    return st.row


# ── accounts, seed, pages ─────────────────────────────────────────────────────────────────

def new_ctx(browser, vp: str):
    wd, ht = VIEWPORTS[vp]
    touch = wd <= fw.TOUCH_MAX
    return browser.new_context(viewport={"width": wd, "height": ht}, has_touch=touch, is_mobile=touch,
                               reduced_motion="reduce")


def trade_rows() -> list[dict]:
    """30 closed trades, every one carrying an emotion tag. 22 winners (R 1.0 to 3.0, tagged "patient"),
    8 losers (R -1, tagged "fomo"). 14 close in LAST_YEAR (months spread), 16 this year, 2 of them today ET
    (the check-in day). Long, entry 100, stop 95, so R = (exit - 100) / 5."""
    rows = []
    for i in range(30):
        win = i % 15 < 11                                  # 22 winners, 8 losers
        if i < 14:
            d = date(LAST_YEAR, 1 + (i % 12), 10 + (i % 3))
        elif i < 28:
            d = TODAY_ET - timedelta(days=3 + 4 * (i - 14))
        else:
            d = TODAY_ET
        exit_px = 100 + (5 + (i % 11)) if win else 95
        rows.append({"symbol": ("NVDA", "AMD", "TSLA", "AAPL", "MSFT")[i % 5], "side": "Long", "shares": 10,
                     "entryPrice": 100, "entryDate": d.isoformat(), "exitPrice": exit_px,
                     "exitDate": d.isoformat(), "originalStop": 95, "setup": "VCP" if i % 3 else "Breakout",
                     "emotionTags": ["patient"] if win else ["fomo"]})
    return rows


def provision(browser, base: str, vp: str) -> dict:
    """The admin (promoted from ADMIN_EMAILS) and this viewport's member: comped, verified, seeded."""
    admin = browser.new_context()
    email = f"t3walk-{vp}@local.dev"
    out = {"email": email}
    try:
        h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        c = browser.new_context()
        try:
            h._signup_or_login(c.request, base, email, PW, f"T3 walk {vp}")
            comp = admin.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
            ver = admin.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
            me = c.request.get(base + "/api/auth/me").json()
            row = {"viewport": vp, "account": email, "comp": comp.status, "verify": ver.status,
                   "paid_equiv": bool(me.get("paid_equiv")), "journal_tier3_enabled": me.get("journal_tier3_enabled"),
                   "notebook_journal_styles_enabled": me.get("notebook_journal_styles_enabled"), "verdict": "INFO"}
            REC["setup"].append(row)
            if not me.get("paid_equiv"):
                raise h.SetupFailed(f"{email} is not paid-equivalent (comp {comp.status}, verify {ver.status})")
            if me.get("journal_tier3_enabled") is not True or me.get("notebook_journal_styles_enabled") is not True:
                raise h.SetupFailed(f"the sandbox does not serve both switches on: {row}")
            statuses = []
            for t in trade_rows():
                r = c.request.post(base + "/api/j2/trades", data=t)
                statuses.append(r.status)
            listing = c.request.get(base + "/api/j2/accounts").json()
            accts = listing.get("accounts") if isinstance(listing, dict) else listing
            acct = accts[0]["id"]
            st = c.request.get(base + f"/api/j2/accounts/{acct}/settings").json()
            st.update({"setups": ["VCP", "Breakout"], "setupRules": {"VCP": [{"id": "s1", "label": "Volume dry-up"}]}})
            put = c.request.put(base + f"/api/j2/accounts/{acct}/settings", data=st)
            trades = c.request.get(base + "/api/j2/trades").json()
            n_closed = len(trades if isinstance(trades, list) else trades.get("trades") or [])
            REC["setup"].append({"viewport": vp, "what": "30 closed trades with emotion tags, setups VCP and Breakout",
                                 "trade_posts": sorted(set(statuses)), "trades_listed": n_closed, "account": acct,
                                 "settings_put": put.status, "verdict": "INFO"})
            if any(s not in (200, 201) for s in statuses) or n_closed < 25:
                raise h.SetupFailed(f"the trade seed did not land: posts {sorted(set(statuses))}, listed {n_closed}")
            out["account"] = acct
        finally:
            c.close()
    finally:
        admin.close()
    flush()
    return out


def goto(pg, base: str, path: str, wait: str | None = None) -> None:
    pg.goto(base + path, wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(pg)
    fw.settle_first_run(pg)
    if wait:
        pg.locator(wait).first.wait_for(state="visible", timeout=60000)


def doc(*paras: str) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paras]}


def conflicted(ctx, base: str) -> list[str]:
    return [x.get("title") for x in fw.notes_list(ctx, base) if "(conflicted copy)" in (x.get("title") or "")]


# ── the steps ─────────────────────────────────────────────────────────────────────────────

def walk_viewport(browser, base: str, vp: str) -> None:
    who = provision(browser, base, vp)
    ctx = new_ctx(browser, vp)
    h._signup_or_login(ctx.request, base, who["email"], PW, f"T3 walk {vp}")
    pg = ctx.new_page()
    watch = Watch(pg)
    goto(pg, base, "/journal/notebook", wait="main")
    pg.evaluate("([k, id]) => localStorage.setItem(k, id)", [SELECTED_ACCOUNT_KEY, who["account"]])
    S: dict = {}
    REC.setdefault("viewports", {})[vp] = S

    def s1(st):
        r = ctx.request.post(base + "/api/j2/notes", data={"title": f"T3 walk check-in {vp}",
                                                           "bodyJson": doc(f"Check-in note for {vp}.")})
        st.check("the note was created (HTTP 200)", r.status in (200, 201), f"HTTP {r.status}")
        nid = r.json()["note"]["id"]
        S["checkin_note"] = nid
        goto(pg, base, f"/journal/notebook?note={nid}", wait=".ProseMirror")
        pg.locator(".ProseMirror > p").first.click()
        pg.keyboard.press("End")
        pg.keyboard.press("Enter")
        pg.keyboard.type(f"/{CHECKIN_LABEL}", delay=40)
        option = pg.get_by_role("option", name=re.compile("^" + re.escape(CHECKIN_LABEL)))
        option.first.wait_for(timeout=T)
        st.read("slash option", option.first.inner_text())
        pg.keyboard.press("Enter")
        good = pg.get_by_role("button", name="Mood: Good", exact=True)
        focused = pg.get_by_role("button", name="Focus: Focused", exact=True)
        good.wait_for(timeout=T)
        st.read("the inserted block", pg.get_by_role("group", name="Mood").first.inner_text())
        path = re.compile(rf"/api/j2/notes/{re.escape(nid)}(\?|$)")
        timing: dict = {}

        def landing(resp):
            body = resp.request.post_data or ""
            return (resp.request.method == "PUT" and bool(path.search(resp.url)) and resp.ok
                    and '"mood":"4"' in body and '"focus":"4"' in body)
        with pg.expect_response(landing, timeout=20000) as got:
            good.click(timeout=T)
            focused.click(timeout=T)
            t_pick = time.monotonic()
            # An in-app navigation (the router hears popstate): the member leaving the note at once.
            pg.evaluate("() => { history.pushState({}, '', '/journal/notebook?view=all');"
                        " window.dispatchEvent(new PopStateEvent('popstate')) }")
            timing["left_after_ms"] = round((time.monotonic() - t_pick) * 1000, 1)
        st.check("left the note within 1.5 s of the second pick", timing["left_after_ms"] < 1500,
                 f"{timing['left_after_ms']} ms")
        st.check("the save carrying both picks landed (HTTP 2xx)", got.value.ok, f"HTTP {got.value.status}")
        goto(pg, base, f"/journal/notebook?note={nid}", wait=".ProseMirror")
        good = pg.get_by_role("button", name="Mood: Good", exact=True)
        focused = pg.get_by_role("button", name="Focus: Focused", exact=True)
        good.wait_for(timeout=T)
        rows = pg.locator('[role="group"]').filter(has=good).first.locator("xpath=..")
        st.read("the reopened block", rows.inner_text())
        st.check("reopened: Good is picked", good.get_attribute("aria-pressed") == "true",
                 f"Mood: Good aria-pressed={good.get_attribute('aria-pressed')}")
        st.check("reopened: Focused is picked", focused.get_attribute("aria-pressed") == "true",
                 f"Focus: Focused aria-pressed={focused.get_attribute('aria-pressed')}")
        note = ctx.request.get(base + f"/api/j2/notes/{nid}").json()["note"]
        blocks = [x for x in (note.get("bodyJson") or {}).get("content", [])
                  if x.get("type") == "widgetEmbed" and (x.get("attrs") or {}).get("widgetId") == "moodCheckIn"]
        params = (blocks[0].get("attrs") or {}).get("params") if blocks else None
        st.check("the server's copy holds one check-in, mood 4 and focus 4, for today ET",
                 len(blocks) == 1 and params == {"mood": "4", "focus": "4", "day": TODAY_ET.isoformat()},
                 json.dumps({"blocks": len(blocks), "params": params, "today_et": TODAY_ET.isoformat()}))
        bad = conflicted(ctx, base)
        st.check("no conflicted copy appeared", not bad, json.dumps(bad))

    def s2(st):
        goto(pg, base, "/journal/insights?ins=psychology")
        sec = pg.locator("section").filter(has=pg.get_by_role("heading", name="By check-in", exact=True)).first
        sec.wait_for(timeout=60000)
        text = st.read("By check-in", sec.inner_text())
        st.check("it counts the one check-in day", "1 check-in day," in text, text[:300])

        def row(word):
            tr = sec.locator("tbody tr").filter(has=pg.locator("th", has_text=re.compile("^" + re.escape(word)))).first
            tr.wait_for(timeout=T)
            return [c.inner_text().strip() for c in tr.locator("td").all()]
        good = row("Good")
        st.read("Mood row Good [days, trades, win rate, avg P&L]", json.dumps(good))
        st.check("Mood: Good shows the day", bool(good) and good[0] == "1", json.dumps(good))
        sec.get_by_role("tab", name="Focus", exact=True).click(timeout=T)
        focused = row("Focused")
        st.read("Focus row Focused [days, trades, win rate, avg P&L]", json.dumps(focused))
        st.check("Focus: Focused shows the day", bool(focused) and focused[0] == "1", json.dumps(focused))
        st.check("the day's closed trades are on it", bool(focused) and focused[1] not in ("", "0"), json.dumps(focused))

    def s3(st):
        goto(pg, base, "/journal/insights?ins=winners")
        tag = pg.locator("li").filter(has=pg.locator("span", has_text=re.compile(r"^patient$"))).first
        tag.wait_for(timeout=60000)
        panel = st.read("Checklist from my winners", pg.locator("section").filter(
            has=pg.get_by_role("heading", name="Checklist from my winners")).first.inner_text())
        st.check("at least one suggestion is shown (patient)", "patient" in panel, panel[:400])
        tag.get_by_role("button", name=re.compile("add to my checklist", re.I)).click(timeout=T)
        dlg = pg.get_by_role("dialog", name='Add "patient" to your checklist')
        dlg.wait_for(timeout=T)
        label = dlg.get_by_label("Your rule").input_value()
        st.read("the confirm", dlg.inner_text() + f"\n[Your rule] {label}")
        dlg.get_by_role("button", name="Save rule").click(timeout=T)
        status = pg.get_by_text(ADDED, exact=True)
        status.wait_for(timeout=T)
        st.check("the panel says it was added", True, st.read("status", status.inner_text()))
        rules = ctx.request.get(base + f"/api/j2/accounts/{who['account']}/rules").json()
        rules = rules.get("rules", rules) if isinstance(rules, dict) else rules
        mine = [r for r in rules if isinstance(r, dict) and r.get("label") == label]
        st.check("the account holds the rule, marked before entry (the rules read)",
                 len(mine) == 1 and bool(mine[0].get("beforeEntry", mine[0].get("before_entry"))),
                 json.dumps(mine)[:400])
        S["rule_label"] = label
        # A NEW trade plan: Research Home's New note caret -> From a style -> Trade plan.
        goto(pg, base, "/journal/notebook", wait="main")
        home_new = pg.locator('[data-tour="new-note-home"]')
        caret = home_new.get_by_role("button", name="More ways to start a note", exact=True)
        try:
            caret.first.wait_for(timeout=T)
            caret.first.click(timeout=T)
            pg.get_by_role("menuitem", name="From a style").first.click(timeout=T)
            pg.get_by_role("group", name="Start from a kind of note").get_by_role(
                "button", name="New Trade plan").click(timeout=T)
            pg.locator(".ProseMirror").first.wait_for(timeout=T)
        except Exception as e:  # noqa: BLE001
            raise Inconclusive(f"a new trade plan could not be made from Research Home: {type(e).__name__}: {str(e)[:200]}")
        st.read("the new trade plan", pg.locator(".ProseMirror").first.inner_text()[:600])
        pick = pg.get_by_label("Setup for this trade")
        try:
            pick.first.wait_for(timeout=T)
        except Exception:  # noqa: BLE001
            raise Inconclusive("the new trade plan carries no pre-entry checklist block with a setup picker; "
                               "body: " + pg.locator(".ProseMirror").first.inner_text()[:300])
        pick.first.select_option("VCP")
        group = pg.get_by_role("group", name="Pre-entry checklist for VCP", exact=True)
        group.wait_for(timeout=T)
        text = st.read("the pre-entry checklist", group.inner_text())
        item = group.get_by_role("checkbox", name=label, exact=True)
        st.check("the pre-entry checklist lists the accepted rule", item.count() == 1, text)

    def s4(st):
        goto(pg, base, "/journal-2-0/report")
        door = pg.get_by_role("navigation", name="Your trading year")
        door.wait_for(timeout=60000)
        st.read("the door", door.inner_text())
        picker = door.get_by_role("combobox", name="Earlier years")
        opts = [o.inner_text() for o in picker.locator("option").all()]
        st.check(f"Earlier years offers {LAST_YEAR}", str(LAST_YEAR) in opts, json.dumps(opts))
        picker.select_option(str(LAST_YEAR))
        door.get_by_role("link", name=f"Your {LAST_YEAR} in trading").click(timeout=T)
        pg.get_by_role("heading", level=1, name=f"Your {LAST_YEAR} in trading").wait_for(timeout=T)
        st.read("the header", pg.get_by_test_id("wrapped-scope").inner_text())
        seen = []
        for name in WRAPPED_SECTIONS:
            reg = pg.get_by_role("region", name=name, exact=True)
            reg.first.wait_for(timeout=T)
            seen.append(name)
            st.read(f"section: {name}", reg.first.inner_text())
        st.check("the page shows its four sections", seen == list(WRAPPED_SECTIONS), json.dumps(seen))

    try:
        for n, title, fn in ((1, "insert the check-in from the slash menu, Good and Focused, leave within 1.5 s, reopen", s1),
                             (2, "Insights > Psychology > By check-in shows the day", s2),
                             (3, "Checklist from my winners: a suggestion, accept it, a new trade plan's checklist lists it", s3),
                             (4, "Report > Your year in trading shows four sections", s4)):
            run_step(vp, n, title, fn, pg, watch)
    finally:
        ctx.close()
        flush()


# ── boot ──────────────────────────────────────────────────────────────────────────────────

def set_env(fs: dict) -> list[str]:
    missing = [n for n in TIER3_FLAGS if n not in fs["gates"]]
    if missing:
        raise SystemExit(f"REFUSED: not a NOTEBOOK_FLAGS gate in api/routers/auth.py: {missing}")
    on = sorted(set(fs["c1"]) | set(TIER3_FLAGS))
    for name in fs["all_names"]:
        os.environ.pop(name, None)
    for k in [k for k in os.environ if k.startswith("RAILWAY_")]:
        os.environ.pop(k, None)
    os.environ.update({name: "1" for name in on})
    os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    return on


def main(argv=None) -> int:
    global OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--tip", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--viewports", default="1280,820,390")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener (never killed)")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    OUT = Path(args.out)
    OUT.mkdir(parents=True, exist_ok=True)
    tree = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    fs = fw.flag_sets()
    on = set_env(fs)
    base = f"http://127.0.0.1:{args.port}"
    REC.update({"tip": args.tip, "tool_tree": tree, "base": base, "data_dir": str(data_dir), "flags_on": on,
                "today_et": TODAY_ET.isoformat(), "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "status": "INCOMPLETE (run did not finish)"})
    flush()
    sb = h.Sandbox(str(data_dir), args.port, OUT / "sandbox.log")
    sb.start()
    not_run, failure = None, None
    try:
        if not sb.wait_healthy(base, 400):
            not_run = "the sandbox never answered /api/health"
        else:
            sb.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
            import sandbox_identity
            v = sandbox_identity.verify(base, sb.integrity_path())
            REC["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
            if not v.ok:
                not_run = v.sentence
        if not not_run:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch()
                try:
                    for vp in [x.strip() for x in args.viewports.split(",") if x.strip()]:
                        walk_viewport(browser, base, vp)
                except h.SetupFailed as e:
                    not_run = str(e)[:400]
                except Exception as e:  # noqa: BLE001
                    failure = f"{type(e).__name__}: {str(e)[:400]}"
                    REC["traceback"] = traceback.format_exc()[-3000:]
                finally:
                    browser.close()
        sb.wait_checkpoint(h.PREWARM, h.PREWARM_WAIT_S)
    finally:
        REC["stop"] = sb.stop()
    integ = h.read_integrity(sb.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.PREWARM, h.SHUTDOWN])
    ipath = sb.integrity_path()
    if ipath and Path(ipath).is_file():
        kept = OUT / "integrity.md"
        kept.write_text(f"tip under test: {args.tip}\n\n" + Path(ipath).read_text(encoding="utf-8", errors="replace"),
                        encoding="utf-8", newline="\n")
        integ["path"] = str(kept)
    REC["integrity"] = integ
    REC["first_line"] = h.integrity_line(integ, f"stop: {sb.stop_how}", not_run=not_run)
    print(REC["first_line"])
    REC["driver_imported_api"] = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    counts = {v: sum(1 for s in REC["steps"] if s["verdict"] == v) for v in ("PASS", "FAIL", "INCONCLUSIVE")}
    REC.update({"not_run": not_run, "failure": failure, "counts": counts, "port_free_after": not h.port_busy(args.port),
                "finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "status": "COMPLETE" if not (not_run or failure) else "NOT COMPLETE"})
    flush()
    print(f"VERDICT: {counts} not_run={not_run} failure={failure}; raw log: {OUT / 'walk.json'}")
    if not_run:
        return 3
    return 1 if failure or counts["FAIL"] or counts["INCONCLUSIVE"] else 0


if __name__ == "__main__":
    sys.exit(main())
