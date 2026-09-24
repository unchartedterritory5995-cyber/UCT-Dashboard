"""Day 7 terminal-grade walkthrough — the roadmap's §5 integrator checklist, run as
USER ACTIONS against the local backend on :8077 (never production).

Five properties, one concrete action each (roadmap §5 table):
  1. One context   — load a symbol on Surface A (TickerPopup on /dashboard); open
                     Surface B (/charts) in the same session via the nav; B shows it.
  2. Provenance    — on /research/AAPL Ownership + Analyst Ratings, open the S8
                     <Provenance> detail and read a NAMED source + as-of, not a badge.
  3. Addressable   — save a layout, mint a share link, CLOSE the browser context,
                     open the link in a fresh one; same arrangement, not a default.
  4. Keyboard-fast — on /screener: `/` -> arrows -> Enter -> change a filter, no mouse.
  5. Resilient     — open a 2-chart board with one panel's /api/bars call forced to
                     500; the other panel renders, the failed one shows its own error.

Every step records what it SAW (text, counts, boxes) so a reader can re-derive the
verdict; screenshots land beside results.json.
"""
import json
import os
import re
import sys
import time
import pathlib
import traceback

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = os.environ.get("D7_BASE", "http://localhost:8077")
EMAIL = os.environ.get("D7_EMAIL", "mobtest@local.dev")
PASSWORD = os.environ.get("D7_PASSWORD", "LocalTest2026!")
OUT = pathlib.Path(__file__).parent / "day7_walkthrough"
OUT.mkdir(exist_ok=True)

INTRO_SEL = '[role="dialog"][aria-label="Welcome"]'
RESULTS = {"base": BASE, "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "checks": {}, "page_errors": []}

if "localhost" not in BASE and "127.0.0.1" not in BASE:
    print("refusing: this walkthrough is local-only by design", file=sys.stderr)
    sys.exit(2)


def record(name, status, **evidence):
    RESULTS["checks"][name] = {"status": status, **evidence}
    print(f"[{status}] {name}: " + json.dumps(evidence, default=str)[:900])


SESSION_COOKIES = []   # one login for the whole run — /api/auth/login is rate-limited 5/min


def login(context):
    """Log in ONCE; every later context re-uses the session cookie (a fresh
    browser context with a persisted login is exactly what 'close the tab, open
    the link again' looks like to the app)."""
    if SESSION_COOKIES:
        context.add_cookies(SESSION_COOKIES)
        return None
    r = context.request.post(f"{BASE}/api/auth/login", data={"email": EMAIL, "password": PASSWORD})
    assert r.ok, f"login failed: {r.status} {r.text()[:200]}"
    SESSION_COOKIES.extend(context.cookies())
    return r.json()


def dismiss_intro(page):
    """Same three doors as tools/mobile_audit.py::_dismiss_intro, then VERIFY."""
    for attempt in (
        lambda: page.click('[aria-label="Skip intro"]', timeout=1500),
        lambda: page.click(INTRO_SEL, timeout=1500),
        lambda: page.keyboard.press("Escape"),
    ):
        try:
            attempt()
        except Exception:
            pass
        if page.query_selector(INTRO_SEL) is None:
            return
    page.wait_for_selector(INTRO_SEL, state="detached", timeout=12000)


def goto(page, path):
    page.goto(f"{BASE}{path}", wait_until="load")
    try:
        page.wait_for_selector(INTRO_SEL, timeout=4000)
    except PWTimeout:
        pass
    dismiss_intro(page)


SYM_BTN = '[aria-label$="click to search a different ticker"]'


def chart_syms(page, scope=None):
    """Tickers of every chart on screen, read from the SymbolSearch button's
    aria-label ("NVDA — click to search a different ticker")."""
    root = scope if scope is not None else page
    out = []
    for lab in root.locator(SYM_BTN).evaluate_all("els => els.map(e => e.getAttribute('aria-label'))"):
        m = re.match(r"^([A-Z0-9.\-]+)\s", lab or "")
        if m:
            out.append(m.group(1))
    return out


def get_prefs(context):
    r = context.request.get(f"{BASE}/api/auth/preferences")
    assert r.ok, f"prefs read failed: {r.status}"
    return r.json()


def set_pref(context, key, value):
    r = context.request.post(f"{BASE}/api/auth/preferences", data={"key": key, "value": value})
    assert r.ok, f"pref write failed for {key}: {r.status} {r.text()[:200]}"


def attach_error_capture(page, label):
    page.on("pageerror", lambda e: RESULTS["page_errors"].append({"page": label, "error": str(e)[:300]}))


def new_logged_in_page(pw_browser, label):
    context = pw_browser.new_context(viewport={"width": 1440, "height": 900})
    login(context)
    page = context.new_page()
    attach_error_capture(page, label)
    return context, page


# ---------------------------------------------------------------------------
# 1. One context
# ---------------------------------------------------------------------------
def check_one_context(browser):
    context, page = new_logged_in_page(browser, "one-context")
    try:
        before = json.loads(get_prefs(context).get("charts_workspace_groups") or "{}")
        # Surface A = the FuturesStrip index cells on /dashboard (each is a TickerPopup
        # trigger and renders with the market shut, unlike movers/catalysts/leaders).
        # Control: the target must differ from the current Group A so the transition
        # is a real change, not a no-op that would read as a pass.
        target = "QQQ" if before.get("A") != "QQQ" else "SPY"

        goto(page, "/dashboard")
        chip = page.wait_for_selector(f'[data-testid="ticker-{target}"]', timeout=45000)
        chip.click()
        page.wait_for_selector('[data-testid="chart-modal"]', timeout=20000)
        page.screenshot(path=str(OUT / "1a_dashboard_popup.png"))
        page.keyboard.press("Escape")

        # The focus symbol is a preference write; give it up to 10s to land.
        landed = None
        for _ in range(20):
            groups = json.loads(get_prefs(context).get("charts_workspace_groups") or "{}")
            if groups.get("A") == target:
                landed = groups
                break
            time.sleep(0.5)

        # Surface B, reached IN-APP (click, never goto — a full load rebuilds the world).
        link = page.locator('a[href="/charts"]:visible').first
        link.click()
        page.wait_for_url(re.compile(r"/charts$"), timeout=20000)
        page.wait_for_selector(SYM_BTN, timeout=30000)
        # The chart's symbol button carries the ticker in its aria-label (its visible
        # text is the company NAME, e.g. "NVIDIA Corporation"); poll for hydration.
        labels = []
        for _ in range(20):
            labels = chart_syms(page)
            if target in labels:
                break
            time.sleep(0.5)
        page.screenshot(path=str(OUT / "1b_charts_after_popup.png"))
        ok = landed is not None and target in labels
        record("one_context", "PASS" if ok else "FAIL",
               surface_a="/dashboard TickerPopup click", surface_b="/charts via nav link click",
               symbol=target, groups_before=before, groups_after=landed, chart_sym_labels=labels)
    except Exception as e:
        page.screenshot(path=str(OUT / "1_error.png"))
        record("one_context", "FAIL", error=f"{type(e).__name__}: {e}"[:400])
    finally:
        context.close()


# ---------------------------------------------------------------------------
# 2. Provenance
# ---------------------------------------------------------------------------
def _provenance_on(page, path, shot):
    goto(page, path)
    state_sel = '[data-testid="provenance-present"], [data-testid="provenance-degraded"], [data-testid="provenance-unavailable"]'
    el = page.wait_for_selector(state_sel, timeout=60000)
    state = el.get_attribute("data-testid")
    detail_text = None
    if state == "provenance-present":
        page.locator('[data-testid="provenance-detail-toggle"]').first.click()
        panel = page.wait_for_selector('[data-testid="provenance-detail-panel"]', timeout=10000)
        detail_text = " ".join(panel.inner_text().split())
    badge_text = " ".join(el.inner_text().split())
    # The as-of / session context lives in the sibling S8 <FreshnessBadge>, not in
    # <Provenance>'s own panel — read both, judge the pair.
    fresh = page.locator('[data-testid="freshness-badge"]').first
    freshness_text = " ".join(fresh.inner_text().split()) if fresh.count() else None
    page.screenshot(path=str(OUT / shot))
    return {"state": state, "badge_text": badge_text, "detail_text": detail_text, "freshness_text": freshness_text}


def check_provenance(browser):
    context, page = new_logged_in_page(browser, "provenance")
    try:
        own = _provenance_on(page, "/research/AAPL?section=ownership", "2a_ownership_provenance.png")
        ana = _provenance_on(page, "/research/AAPL?section=analyst-ratings", "2b_analyst_provenance.png")

        def is_specific(r):
            # "A real, specific source, not a generic 'grounded' badge": a named
            # vendor AND the specific call behind the number (module.method), plus
            # a freshness tier / session context from the paired badge.
            txt = f"{r['badge_text']} {r['detail_text'] or ''}"
            named_source = bool(re.search(r"\b(FMP|Massive|Finnhub|yfinance|SEC|EDGAR)\b", txt))
            specific_call = bool(re.search(r"Source:\s*\w+\.\w+", txt))
            freshness = bool(r.get("freshness_text"))
            return r["state"] == "provenance-present" and named_source and specific_call and freshness

        ok = is_specific(own) and is_specific(ana)
        # Honest-degraded is not a failure of the PROPERTY (S8 forbids inventing a
        # citation); it is recorded as its own state so the reader can tell.
        status = "PASS" if ok else ("DEGRADED" if own["state"] != "provenance-present" or ana["state"] != "provenance-present" else "FAIL")
        record("provenance", status, ownership=own, analyst_ratings=ana)
    except Exception as e:
        page.screenshot(path=str(OUT / "2_error.png"))
        record("provenance", "FAIL", error=f"{type(e).__name__}: {e}"[:400])
    finally:
        context.close()


# ---------------------------------------------------------------------------
# 3. Addressable  (+ 5. Resilient panels reuse the same saved layout)
# ---------------------------------------------------------------------------
D7_LAYOUT = {
    "cols": 24,
    "widgets": [
        {"id": "d7-addr-a", "type": "chart", "color": "A", "x": 0, "y": 0, "w": 12, "h": 20, "opts": {"tf": "D"}},
        {"id": "d7-addr-b", "type": "chart", "color": "B", "x": 12, "y": 0, "w": 12, "h": 20, "opts": {"tf": "D"}},
    ],
}


def widget_boxes(page):
    out = {}
    for el in page.locator("[data-widget-id]").element_handles():
        wid = el.get_attribute("data-widget-id")
        box = el.bounding_box() or {}
        out[wid] = {k: round(v) for k, v in box.items()}
    return out


def wait_board(page, expected_ids, timeout_s=40):
    deadline = time.time() + timeout_s
    seen = {}
    while time.time() < deadline:
        seen = widget_boxes(page)
        if set(seen) == set(expected_ids) and "openShared" not in page.url and "openLayout" not in page.url:
            return seen
        time.sleep(0.5)
    return seen


def check_addressable(browser, layout_id, share_token, expected_ids):
    # "Close the tab": the context that saved it is gone; this is a fresh one.
    context, page = new_logged_in_page(browser, "addressable")
    try:
        goto(page, f"/charts?openShared={share_token}")
        boxes = wait_board(page, expected_ids)
        url_after = page.url
        page.screenshot(path=str(OUT / "3a_open_shared_link.png"))
        by_share_ok = set(boxes) == set(expected_ids) and "openShared" not in url_after
        side_by_side = (boxes.get("d7-addr-a", {}).get("x", 0) < boxes.get("d7-addr-b", {}).get("x", -1))

        # Second door, same layout: by id (the layout's own name/address, not a share).
        context2, page2 = new_logged_in_page(browser, "addressable-by-id")
        try:
            goto(page2, f"/charts?openLayout={layout_id}")
            boxes2 = wait_board(page2, expected_ids)
            url2 = page2.url
            page2.screenshot(path=str(OUT / "3b_open_by_id.png"))
            by_id_ok = set(boxes2) == set(expected_ids) and "openLayout" not in url2
        finally:
            context2.close()

        ok = by_share_ok and by_id_ok and side_by_side
        record("addressable", "PASS" if ok else "FAIL",
               layout_id=layout_id, expected_widget_ids=expected_ids,
               open_shared={"url_after": url_after, "boxes": boxes, "ok": by_share_ok, "side_by_side": side_by_side},
               open_by_id={"url_after": url2, "boxes": boxes2, "ok": by_id_ok})
    except Exception as e:
        page.screenshot(path=str(OUT / "3_error.png"))
        record("addressable", "FAIL", error=f"{type(e).__name__}: {e}"[:400])
    finally:
        context.close()


# ---------------------------------------------------------------------------
# 4. Keyboard-fast
# ---------------------------------------------------------------------------
def active_desc(page):
    return page.evaluate("""() => {
        const a = document.activeElement; if (!a) return null;
        const row = a.closest('[data-filter-key]');
        return { tag: a.tagName, ariaLabel: a.getAttribute('aria-label'), placeholder: a.getAttribute('placeholder'),
                 type: a.getAttribute('type'), value: ('value' in a) ? String(a.value) : null,
                 inRow: row ? row.getAttribute('data-filter-key') : null };
    }""")


def check_keyboard(browser):
    context, page = new_logged_in_page(browser, "keyboard")
    try:
        goto(page, "/screener")
        page.wait_for_selector('[data-testid="filter-rail"]', timeout=45000)
        # Hands on the keyboard only from here. Nothing is clicked.
        page.keyboard.press("/")
        after_slash = active_desc(page)
        # Arrow down the rail until the highlighted row's control can actually take a
        # value (an input, or a select with more than one option — on this box the
        # first rows are selects whose only option is "Any", so a value change there
        # is impossible and would read as a keyboard defect that is not one).
        active_row, steps = None, 0
        row_probe = """() => {
            const r = [...document.querySelectorAll('[data-filter-key]')].find(e => /railFilterActive/.test(e.className));
            if (!r) return null;
            const c = r.querySelector('select, input, button:not([data-coldesc])');
            return { key: r.getAttribute('data-filter-key'), tag: c ? c.tagName : null,
                     options: c && c.tagName === 'SELECT' ? c.options.length : null } }"""
        for steps in range(1, 41):
            page.keyboard.press("ArrowDown")
            probe = page.evaluate(row_probe)
            if probe and (probe["tag"] == "INPUT" or (probe["tag"] == "SELECT" and (probe["options"] or 0) > 1)):
                active_row = probe["key"]
                break
        page.keyboard.press("Enter")
        after_enter = active_desc(page)
        # Complete the surface's primary action — set a filter value — from the keyboard.
        if after_enter and after_enter["tag"] == "SELECT":
            page.keyboard.press("ArrowDown")
        elif after_enter and after_enter["tag"] == "INPUT":
            page.keyboard.type("5")
            page.keyboard.press("Tab")
        elif after_enter and after_enter["tag"] == "BUTTON":
            page.keyboard.press("Enter")
        time.sleep(0.8)
        after_action = active_desc(page)
        page.screenshot(path=str(OUT / "4_screener_keyboard.png"))
        slash_ok = bool(after_slash) and after_slash.get("ariaLabel") == "Find a filter"
        enter_ok = bool(after_enter) and after_enter.get("inRow") == active_row and after_enter["tag"] in ("SELECT", "INPUT", "BUTTON")
        changed = bool(after_enter) and bool(after_action) and (after_action.get("value") != after_enter.get("value") or after_enter["tag"] == "BUTTON")
        record("keyboard_fast", "PASS" if (slash_ok and enter_ok and changed) else "FAIL",
               after_slash=after_slash, arrow_steps=steps, highlighted_row=active_row, after_enter=after_enter,
               after_action=after_action, value_changed=changed)
    except Exception as e:
        page.screenshot(path=str(OUT / "4_error.png"))
        record("keyboard_fast", "FAIL", error=f"{type(e).__name__}: {e}"[:400])
    finally:
        context.close()


# ---------------------------------------------------------------------------
# 5. Resilient panels
# ---------------------------------------------------------------------------
def check_resilient(browser, layout_id, expected_ids):
    context, page = new_logged_in_page(browser, "resilient")
    try:
        set_pref(context, "charts_workspace_groups", json.dumps({"A": "NVDA", "B": "AAPL", "C": None, "D": None}))
        forced = {"count": 0}

        def fail_aapl(route):
            forced["count"] += 1
            route.fulfill(status=500, content_type="application/json", body='{"detail":"day7 forced failure"}')

        page.route(re.compile(r".*/api/bars/AAPL(\?.*)?$"), fail_aapl)
        goto(page, f"/charts?openLayout={layout_id}")
        boxes = wait_board(page, expected_ids)
        a = page.locator('[data-widget-id="d7-addr-a"]')
        b = page.locator('[data-widget-id="d7-addr-b"]')
        a.locator("canvas").first.wait_for(timeout=45000)
        # The failed panel's OWN visible error (StockChart's overlay), bounded wait.
        b_err = None
        for _ in range(60):
            t = " ".join(b.inner_text().split())
            m = re.search(r"(Failed to load chart for AAPL|No chart data available for AAPL\.?)", t)
            if m:
                b_err = m.group(1)
                break
            time.sleep(0.5)
        a_text = " ".join(a.inner_text().split())
        a_err = bool(re.search(r"Failed to load chart|No chart data available|hit an error", a_text))
        a_canvases = a.locator("canvas").count()
        b_canvases = b.locator("canvas").count()
        a_syms = chart_syms(page, a)
        a_label = a_syms[0] if a_syms else None
        retry_in_b = b.get_by_role("button", name="Retry").count()
        board_widgets = list(widget_boxes(page))
        page.screenshot(path=str(OUT / "5_resilient_panels.png"))
        ok = (set(board_widgets) == set(expected_ids) and a_canvases > 0 and not a_err and a_label == "NVDA"
              and b_err is not None and forced["count"] > 0)
        record("resilient_panels", "PASS" if ok else "FAIL",
               forced_failures=forced["count"], board_widgets=board_widgets,
               panel_a={"sym": a_label, "canvases": a_canvases, "shows_error": a_err},
               panel_b={"visible_error": b_err, "canvases": b_canvases, "retry_button": retry_in_b})
    except Exception as e:
        page.screenshot(path=str(OUT / "5_error.png"))
        record("resilient_panels", "FAIL", error=f"{type(e).__name__}: {e}"[:400])
    finally:
        context.close()


# ---------------------------------------------------------------------------
def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        setup_ctx = browser.new_context()
        me = login(setup_ctx) or {}
        RESULTS["flags_on_login"] = {k: v for k, v in me.items() if "enabled" in k}
        # Snapshot the account's board prefs ONCE across re-runs, so an aborted run
        # cannot make the next run "restore" to its own leftovers.
        snap = OUT / "prefs_original.json"
        if snap.exists():
            original = json.loads(snap.read_text(encoding="utf-8"))
        else:
            original = get_prefs(setup_ctx)
            snap.write_text(json.dumps(original), encoding="utf-8")
        orig_layout = original.get("charts_workspace_layout")
        orig_groups = original.get("charts_workspace_groups")

        # Save the view (the "Save a view" half of Addressable), mint its link.
        r = setup_ctx.request.post(f"{BASE}/api/charts/layouts",
                                   data={"name": "Day7 walkthrough 2-chart", "layout": D7_LAYOUT, "scope": "user"})
        assert r.ok, f"save layout: {r.status} {r.text()[:200]}"
        layout_id = r.json()["id"]
        r = setup_ctx.request.post(f"{BASE}/api/charts/layouts/{layout_id}/share")
        assert r.ok, f"share: {r.status} {r.text()[:200]}"
        share_token = r.json().get("token") or r.json().get("share_token")
        RESULTS["saved_layout"] = {"id": layout_id, "share_token_len": len(share_token or "")}
        expected_ids = [w["id"] for w in D7_LAYOUT["widgets"]]
        setup_ctx.close()

        try:
            check_one_context(browser)
            check_provenance(browser)
            check_addressable(browser, layout_id, share_token, expected_ids)
            check_keyboard(browser)
            check_resilient(browser, layout_id, expected_ids)
        finally:
            # Leave the test account as we found it.
            clean = browser.new_context()
            login(clean)
            clean.request.delete(f"{BASE}/api/charts/layouts/{layout_id}/share")
            clean.request.delete(f"{BASE}/api/charts/layouts/{layout_id}")
            if orig_layout is not None:
                set_pref(clean, "charts_workspace_layout", orig_layout)
            if orig_groups is not None:
                set_pref(clean, "charts_workspace_groups", orig_groups)
            after = get_prefs(clean)
            RESULTS["restored"] = {
                "layout_restored": after.get("charts_workspace_layout") == orig_layout,
                "groups_restored": after.get("charts_workspace_groups") == orig_groups,
            }
            clean.close()
            browser.close()

    RESULTS["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    (OUT / "results.json").write_text(json.dumps(RESULTS, indent=2, default=str), encoding="utf-8")
    statuses = {k: v["status"] for k, v in RESULTS["checks"].items()}
    print("\nSUMMARY:", json.dumps(statuses))
    print("page_errors:", len(RESULTS["page_errors"]), "restored:", RESULTS.get("restored"))
    failed = [k for k, s in statuses.items() if s == "FAIL"]
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
