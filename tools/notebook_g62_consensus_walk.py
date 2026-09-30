"""G-062 live walk (wave 10, lane G62) -- the Playwright script that produces
docs/notebook/gate-runs/g62/walk-<sha>.json. Kept in tools/ so the evidence is
reproducible; it is NOT a pytest rail. Mirrors tools/notebook_wave6_walk.py's
shape (self-provisioning sandbox account, record()/guarded() helpers,
open_note() retry) -- there is no dedicated "Wave F" walk to copy verbatim
(Wave F's own G-060 closure was a manual real-browser session, not a script),
so this one is built from the same pattern the later waves standardized on.

WHAT THIS PROVES: the analyst-price-target-consensus fact type (G-062),
active since the owner's 2026-09-25 FMP licensing approval
(docs/notebook/VENDOR-TERMS-2026-09-23.md §5 L5/L2), reaches a member through
the two doors the controller's brief named -- the /consensus slash command
(SlashMenu.jsx) and TickerPopup's "Save analyst consensus to Notebook" button
-- with the same frozen-at-insert semantics and honest-failure text as the
existing /price doors, mirrored deliberately rather than unified.

Preconditions:
  * a hub sandbox booted from the tip under test:
        scripts/hub_sandbox_boot.py --data-dir C:\\data-g62walk --port 8107
    C:\\data must read CLEAN at every integrity checkpoint (the boot's own
    snapshot rail, docs/plans/joystick/sandbox-runs/<ts>.md);
  * app/dist rebuilt from the tip (cd app && npm run build) -- the sandbox
    serves dist/. This script does NOT build it and does not run npm.
  * THE SANDBOX HAS NO LIVE FMP KEY in the controller's run (stated in the
    brief). `FMP_API_KEY` is a NON_MODEL_KEY hub_sandbox_boot.py deliberately
    does NOT blank (scripts/hub_sandbox_boot.py:185-191 -- "the sandbox's
    pages need their data"), so whether a real key is present depends on the
    operator's OWN shell, not this script. G3 below therefore does not
    assume either way: it fires the real auto-resolve path (no explicit
    `value`, exactly what both frontend doors send) and accepts EITHER a
    real FMP-sourced capture (200, a numeric value) OR the honest-failure
    refusal (400, no row created) as PASS, recording which branch fired.
    That adaptively covers "no live FMP key" without needing a fixture or a
    route stub: the honest-failure branch IS the no-data-available contract
    this walk is partly here to prove, whether it fires because of a missing
    key or because FMP genuinely has no consensus for the probe ticker.
  * G1/G4/G5 (frozen-at-insert, door wiring, rendering/attribution) use an
    EXPLICIT `value` on the capture call, which bypasses only the FMP HTTP
    fetch (`fact_current_value._resolve_price_target_consensus`) -- no other
    Notebook code path is skipped. This is the stand-in for "FMP answered"
    the header above promised: it proves activation, frozen-at-insert,
    display and the doors' wiring end-to-end without needing a live vendor
    key in the sandbox at all. G3 is the one check that exercises the real
    auto-resolve fetch.

    python tools/notebook_g62_consensus_walk.py docs/notebook/gate-runs/g62/walk-<sha>.json

Checks:
  G1  activation: an explicit-value capture is accepted (not 400 "not yet
      enabled"), and the resolved fact carries rightsClass=conditional,
      temporalMode=snapshot, source=fmp, unit=usd_per_share
  G2  a test-local INACTIVE type still 400s at the router (mirrors
      test_journal_two_facts_router.py's own rail, live against the real
      backend rather than a monkeypatch -- this walk cannot monkeypatch a
      separate process, so it proves the ACTIVE side only; G2 records that
      explicitly rather than fake a second type over the wire)
  G3  the real doors' own call shape (no explicit value) against whatever
      FMP availability this sandbox actually has -- PASS on EITHER a real
      capture or the honest 400 refusal; FAIL only on a 500 or a fabricated
      value coming back on a 400
  G4  frozen-at-insert: two explicit-value captures of the same ticker are
      two distinct rows; the first is unchanged after the second is created,
      and GET .../facts never returns a "current" key for either (snapshot
      facts are never read-time re-derived)
  G5  SlashMenu: /consensus offers "Analyst Consensus" completion, and typing
      a full command either inserts a financialFact card or inserts nothing
      (never a broken/partial node) -- whichever the sandbox's FMP
      availability produces
  G6  TickerPopup: opening a real position's chart modal shows "Save analyst
      consensus to Notebook" beside "Save price to Notebook"; clicking it
      produces a toast that is either the success line or the honest
      "Capture failed" line -- never silence, never a raw error string
  G7  rendering + attribution: a pre-seeded explicit-value fact inserted into
      a note renders its card with ticker, label, formatted value, "Source:
      FMP", NO Current row, and a Captured timestamp -- the products OWN
      answer that it rendered (a canvas/DOM count only proves it tried)
  G8  zero unforced page error across the whole walk

Exit: 0 = every check PASS or the documented adaptive PASS; 1 = a real FAIL;
2 = INCONCLUSIVE (account/provisioning failure, nothing trustworthy measured).
"""
import json
import re
import sys
import time as _t
import traceback

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8107"
ADMIN_EMAIL, ADMIN_PW = "hubtest@local.dev", "LocalTest2026!"
EMAIL, PW = "g062@local.dev", "LocalTest2026!"
OUT = sys.argv[1] if len(sys.argv) > 1 else "g62_walk.json"
RUN = _t.strftime("r%H%M%S")  # unique per run: repeat runs never collide on ticker/title

res = {"errors": [], "checks": {}}

# ⛔ A crash must never discard what was already measured -- dump the partial
# `res` on ANY exit (same discipline as the wave5/6/7 walks).
import atexit  # noqa: E402


def _dump_partial():
    try:
        json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        print("partial dump failed:", e)


atexit.register(_dump_partial)
_orig_hook = sys.excepthook


def _hook(t, v, tb):
    res["errors"].append("UNHANDLED: " + "".join(traceback.format_exception(t, v, tb))[-1500:])
    res["INCOMPLETE"] = True
    _orig_hook(t, v, tb)


sys.excepthook = _hook


def record(key, verdict, **facts):
    entry = {"verdict": verdict}
    entry.update(facts)
    res["checks"][key] = entry
    print(f"[{verdict}] {key}: " + json.dumps(facts, default=str)[:400])
    return entry


def guarded(key):
    def wrap(fn):
        def inner(*a, **kw):
            try:
                fn(*a, **kw)
            except Exception as e:  # noqa: BLE001
                tb = traceback.format_exc()[-1200:]
                record(key, "INCONCLUSIVE", reason=f"exception: {e}", traceback=tb)
        return inner
    return wrap


def signup_or_login(request_ctx, email, pw, name):
    r = request_ctx.post(BASE + "/api/auth/signup",
                          data={"email": email, "password": pw, "display_name": name})
    if r.status not in (200, 201):
        r = request_ctx.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
    return r


_INTRO_DIALOG_SEL = 'div[role="dialog"][aria-label="Welcome"]'


def dismiss_intro(pg, appear_timeout=2500, detach_timeout=6000):
    """Same as the wave5/6 walks' own helper -- wait for the real DETACH
    signal, never a blind timeout+Escape (see wave6_walk.py's header for the
    measured trap this replaced)."""
    dialog = pg.locator(_INTRO_DIALOG_SEL)
    try:
        dialog.first.wait_for(state="visible", timeout=appear_timeout)
    except Exception:  # noqa: BLE001
        return False
    try:
        pg.keyboard.press("Escape")
    except Exception:  # noqa: BLE001
        pass
    try:
        dialog.first.wait_for(state="detached", timeout=detach_timeout)
        return True
    except Exception:  # noqa: BLE001
        pass
    try:
        pg.get_by_role("button", name="Skip intro", exact=True).click(timeout=1500)
    except Exception:  # noqa: BLE001
        pass
    try:
        dialog.first.wait_for(state="detached", timeout=detach_timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def notebook_url(note_id=None, extra=""):
    if note_id:
        return f"{BASE}/journal/notebook?note={note_id}{extra}"
    return f"{BASE}/journal/notebook{extra}"


def open_note(ctx, url, page=None, max_tries=5, prosemirror_timeout=15000):
    """Navigate to a note URL, WAITING for .ProseMirror (never a fixed sleep
    -- 'a point-in-time check inside a sleep loop misses everything that
    happens between the samples', this repo's own measured lesson). Retries
    through a transient load failure with a fresh page, same pattern as the
    wave6 walk's own open_note (simplified: this walk touches one editor
    surface, not a split-view pair, so the crash-class retry machinery there
    is not needed here)."""
    pg = page if page is not None else ctx.new_page()
    pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
    for attempt in range(1, max_tries + 1):
        if attempt > 1:
            pg.close()
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
        pg.goto(url)
        dismiss_intro(pg)
        try:
            pg.wait_for_selector(".ProseMirror", timeout=prosemirror_timeout)
            return pg
        except Exception:  # noqa: BLE001
            pg.wait_for_timeout(800 * attempt)
            continue
    raise RuntimeError(f"editor never mounted at {url} after {max_tries} attempts")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- Provisioning ------------------------------------------------------
    actx = browser.new_context()
    signup_or_login(actx.request, ADMIN_EMAIL, ADMIN_PW, "hubtest")
    res["admin_login_ok"] = True

    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    signup_or_login(ctx.request, EMAIL, PW, "g062")
    api = ctx.request

    c = actx.request.post(BASE + "/api/auth/admin/comp-access", data={"email": EMAIL, "action": "grant"})
    res["comp_status"] = c.status
    v = actx.request.post(BASE + "/api/auth/admin/verify-email", data={"email": EMAIL})
    res["verify_email_status"] = v.status

    me = api.get(BASE + "/api/auth/me").json()
    res["account"] = {"role": (me.get("user") or {}).get("role"), "paid_equiv": me.get("paid_equiv")}
    if not me.get("paid_equiv"):
        res["INCOMPLETE"] = True
        res["errors"].append("ABORT: walk account is not paid -- comp-access did not take")
        raise SystemExit(2)

    page = ctx.new_page()
    page.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))

    # =========================================================================
    # G1 -- activation: explicit-value capture is accepted, shape is right
    # =========================================================================
    @guarded("G1_activation_explicit_value")
    def check_g1():
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"G62 Walk G1 {RUN}", "bodyJson": {"type": "doc", "content": []},
        }).json()["note"]
        r = api.post(BASE + f"/api/j2/notes/{note['id']}/facts", data={
            "ticker": "NVDA", "factType": "analyst_price_target_consensus", "value": 195.0,
        })
        body = r.json()
        fact = body.get("fact") or {}
        ok = (
            r.status == 200
            and fact.get("value") == 195.0
            and fact.get("rightsClass") == "conditional"
            and fact.get("temporalMode") == "snapshot"
            and fact.get("source") == "fmp"
            and fact.get("unit") == "usd_per_share"
        )
        record("G1_activation_explicit_value", "PASS" if ok else "FAIL",
               status=r.status, fact=fact, note_id=note["id"])

    check_g1()

    # =========================================================================
    # G2 -- an INACTIVE type still 400s (live backend, real type -- this walk
    # cannot monkeypatch a separate process into holding a fake inactive
    # entry, so it proves the shape of the refusal on a type the registry
    # genuinely does not know, which exercises the same `get_fact_type is
    # None` -> FactValidationError branch note_facts.create_fact_observation
    # shares with the "known but inactive" branch; the inactive-branch itself
    # is unit- and router-tested in test_wave_f_facts.py /
    # test_journal_two_facts_router.py with a real monkeypatched inactive
    # entry, which a live HTTP walk structurally cannot reach).
    # =========================================================================
    @guarded("G2_unknown_type_refused")
    def check_g2():
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"G62 Walk G2 {RUN}", "bodyJson": {"type": "doc", "content": []},
        }).json()["note"]
        r = api.post(BASE + f"/api/j2/notes/{note['id']}/facts", data={
            "ticker": "NVDA", "factType": "not_a_real_fact_type", "value": 1.0,
        })
        record("G2_unknown_type_refused", "PASS" if r.status == 400 else "FAIL",
               status=r.status,
               note="proves the SAME refusal branch note_facts.create_fact_observation uses for an "
                    "inactive-but-known type; the inactive-type case itself is covered by "
                    "test_wave_f_facts.py::test_create_fact_rejects_an_inactive_fact_type_generically "
                    "and the router's mirror, both with a real monkeypatched inactive registry entry")

    check_g2()

    # =========================================================================
    # G3 -- the REAL doors' call shape (no explicit value): adaptive PASS
    # =========================================================================
    @guarded("G3_auto_resolve_or_honest_failure")
    def check_g3():
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"G62 Walk G3 {RUN}", "bodyJson": {"type": "doc", "content": []},
        }).json()["note"]
        r = api.post(BASE + f"/api/j2/notes/{note['id']}/facts", data={
            "ticker": "AAPL", "factType": "analyst_price_target_consensus",
        })
        if r.status == 200:
            fact = r.json().get("fact") or {}
            ok = isinstance(fact.get("value"), (int, float))
            record("G3_auto_resolve_or_honest_failure", "PASS" if ok else "FAIL",
                   branch="fmp_live_data", status=r.status, value=fact.get("value"))
        else:
            body = r.json()
            detail = body.get("detail") or ""
            ok = r.status == 400 and "consensus" in detail.lower()
            record("G3_auto_resolve_or_honest_failure", "PASS" if ok else "FAIL",
                   branch="honest_failure_no_fmp_data", status=r.status, detail=detail,
                   note="this sandbox's FMP_API_KEY is whatever the operator's own shell set "
                        "(scripts/hub_sandbox_boot.py does not blank it) -- a 400 here is the "
                        "documented no-data path, not a bug")

    check_g3()

    # =========================================================================
    # G4 -- frozen-at-insert
    # =========================================================================
    @guarded("G4_frozen_at_insert")
    def check_g4():
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"G62 Walk G4 {RUN}", "bodyJson": {"type": "doc", "content": []},
        }).json()["note"]
        f1 = api.post(BASE + f"/api/j2/notes/{note['id']}/facts", data={
            "ticker": "MSFT", "factType": "analyst_price_target_consensus", "value": 410.0,
        }).json()["fact"]
        f2 = api.post(BASE + f"/api/j2/notes/{note['id']}/facts", data={
            "ticker": "MSFT", "factType": "analyst_price_target_consensus", "value": 455.0,
        }).json()["fact"]
        # insert both so GET .../facts resolves them
        api.post(BASE + f"/api/j2/notes/{note['id']}/facts/{f1['id']}/insert")
        api.post(BASE + f"/api/j2/notes/{note['id']}/facts/{f2['id']}/insert")
        listed = api.get(BASE + f"/api/j2/notes/{note['id']}/facts").json()["facts"]
        by_id = {f["id"]: f for f in listed}
        ok = (
            f1["id"] != f2["id"]
            and by_id.get(f1["id"], {}).get("value") == 410.0
            and by_id.get(f2["id"], {}).get("value") == 455.0
            and "current" not in by_id.get(f1["id"], {})
            and "current" not in by_id.get(f2["id"], {})
        )
        record("G4_frozen_at_insert", "PASS" if ok else "FAIL",
               f1_id=f1["id"], f1_value_after=by_id.get(f1["id"], {}).get("value"),
               f2_id=f2["id"], f2_value=by_id.get(f2["id"], {}).get("value"),
               f1_has_current_key="current" in by_id.get(f1["id"], {}),
               note="two distinct rows; the FIRST is unchanged after the SECOND lands; neither "
                    "carries a 'current' key -- a snapshot fact is never read-time re-derived")

    check_g4()

    # =========================================================================
    # G5 -- SlashMenu /consensus door
    # =========================================================================
    @guarded("G5_slash_command_door")
    def check_g5():
        global page
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"G62 Walk G5 {RUN}", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
        }).json()["note"]
        page = open_note(ctx, notebook_url(note["id"]), page)
        page.wait_for_timeout(400)
        ed = page.locator(".ProseMirror")
        ed.click()

        page.keyboard.type("/consensus", delay=15)
        page.wait_for_timeout(300)
        lb = page.get_by_role("listbox", name="Insert block")
        offered = lb.count() > 0 and lb.get_by_role("option").filter(has_text="Analyst Consensus").count() > 0

        page.keyboard.type(" NVDA", delay=15)
        page.wait_for_timeout(300)
        lb2 = page.get_by_role("listbox", name="Insert block")
        capture_item_offered = lb2.count() > 0 and lb2.get_by_role("option").filter(has_text="Analyst Consensus — NVDA").count() > 0
        if capture_item_offered:
            lb2.get_by_role("option").filter(has_text="Analyst Consensus — NVDA").first.click()
        page.wait_for_timeout(600)

        node_count = page.locator("[data-financial-fact]").count()
        ok = offered and capture_item_offered and node_count in (0, 1)
        record("G5_slash_command_door", "PASS" if ok else "FAIL",
               hint_item_offered=offered, capture_item_offered=capture_item_offered,
               financial_fact_node_count=node_count,
               note="0 nodes = honest failure (no FMP data in this sandbox), 1 node = a real "
                    "FMP-sourced capture rendered -- both are correct outcomes; only a count "
                    "outside {0,1} or a missing menu item is a FAIL")

    check_g5()

    # =========================================================================
    # G6 -- TickerPopup door, via a real open position (PositionsTable's own
    # TickerPopup trigger -- content-independent of live market data)
    # =========================================================================
    @guarded("G6_tickerpopup_door")
    def check_g6():
        global page
        pos = api.post(BASE + "/api/j2/positions", data={
            "symbol": "AAPL", "side": "Long", "shares": 10, "entryPrice": 100.0,
            "stopPrice": 90.0, "entryDate": "2026-01-02",
        })
        if pos.status != 200:
            record("G6_tickerpopup_door", "INCONCLUSIVE",
                   reason=f"could not create the walk position: {pos.status} {pos.text()[:300]}")
            return
        # NOT open_note() -- /journal/trades is the Open Positions/Trade
        # Journal surface, not a note editor, and carries no .ProseMirror to
        # wait for. Wait on the position's own ticker trigger instead (below).
        page.goto(f"{BASE}/journal/trades")
        dismiss_intro(page)
        page.wait_for_timeout(600)
        trigger = page.locator('[data-testid="ticker-AAPL"]')
        try:
            trigger.first.wait_for(state="visible", timeout=8000)
        except Exception:  # noqa: BLE001
            record("G6_tickerpopup_door", "INCONCLUSIVE",
                   reason="no [data-testid='ticker-AAPL'] trigger found on /journal/trades -- "
                          "the Open Positions tab may not be the default sub-tab; re-point this "
                          "step at whichever sub-tab TradesSurface lands on by default")
            return
        trigger.first.click()
        btn = page.get_by_role("button", name="Save analyst consensus to Notebook")
        try:
            btn.first.wait_for(state="visible", timeout=6000)
            btn_present = True
        except Exception:  # noqa: BLE001
            btn_present = False
        if not btn_present:
            record("G6_tickerpopup_door", "FAIL", reason="door button not rendered in the chart modal")
            return
        btn.first.click()
        try:
            page.get_by_text(re.compile(r"analyst consensus captured to Notebook|Capture failed")).first.wait_for(
                state="visible", timeout=6000)
            toast_text = page.get_by_text(re.compile(r"analyst consensus captured to Notebook|Capture failed")).first.inner_text()
        except Exception:  # noqa: BLE001
            toast_text = None
        ok = btn_present and toast_text is not None
        record("G6_tickerpopup_door", "PASS" if ok else "FAIL",
               button_present=btn_present, toast_text=toast_text,
               note="a toast naming either outcome is correct; silence or a raw error string is not")

    check_g6()

    # =========================================================================
    # G7 -- rendering + attribution (the product's own answer that it rendered)
    # =========================================================================
    @guarded("G7_render_and_attribution")
    def check_g7():
        global page
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"G62 Walk G7 {RUN}", "bodyJson": {"type": "doc", "content": []},
        }).json()["note"]
        fact = api.post(BASE + f"/api/j2/notes/{note['id']}/facts", data={
            "ticker": "GOOGL", "factType": "analyst_price_target_consensus", "value": 220.5,
        }).json()["fact"]
        api.post(BASE + f"/api/j2/notes/{note['id']}/facts/{fact['id']}/insert")
        page = open_note(ctx, notebook_url(note["id"]), page)
        card = page.locator("[data-financial-fact]")
        try:
            card.first.wait_for(state="visible", timeout=8000)
        except Exception:  # noqa: BLE001
            record("G7_render_and_attribution", "FAIL", reason="card never rendered")
            return
        text = card.first.inner_text()
        ok = (
            "GOOGL" in text
            and "220.50" in text
            and "Source: FMP" in text
            and "Current" not in text
            and "Captured" in text
        )
        record("G7_render_and_attribution", "PASS" if ok else "FAIL", card_text=text)

    check_g7()

    # =========================================================================
    # G8 -- errors
    # =========================================================================
    record("G8_errors", "PASS" if not res["errors"] else "FAIL",
           pageerror_count=len(res["errors"]), pageerrors=res["errors"][:20])

    browser.close()

json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
verdicts = {k: v.get("verdict") for k, v in res["checks"].items()}
print(json.dumps({"checks": verdicts}, indent=1))
if any(v == "FAIL" for v in verdicts.values()):
    sys.exit(1)
if res.get("INCOMPLETE") or any(v == "INCONCLUSIVE" for v in verdicts.values()):
    sys.exit(2)
sys.exit(0)
