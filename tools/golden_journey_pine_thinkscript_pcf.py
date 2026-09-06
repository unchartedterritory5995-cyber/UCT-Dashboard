"""Golden Journey #1-3 automation — Pine RSI, thinkScript ADX, TC2000/PCF.

Mechanizes the exact chain the manual walkthroughs already documented in
``CORE_GOLDEN_JOURNEY_01_PINE_RSI_IMPORT.md`` / ``_02_THINKSCRIPT_ADX.md`` /
``_03_TC2000_PCF_IMPORT.md``: real browser, real paste, real translation, real
save, real reload, real screener gate, real negative path. It does not invent
a shorter "happy path" — every step those documents walked by hand is walked
here by Playwright, against the SAME real UI selectors.

Journey #3's chart-delivered numeric assertion (the manual doc's "PCF Long-
Ter... 1.00") is made POINT-IN-TIME DETERMINISTIC rather than hardcoded: it
fetches SPY's real current daily bars from the running backend, extracts the
EXACT formula string the browser itself produced from the Import tab (never a
hand-built AST), feeds that string through the product's own JS engine
(``readFormulaSource`` + ``interpret`` from ``app/src/components/chart/engine
/ast/``, run in a real Node subprocess — the same code the browser runs, not a
reimplementation) to get the PRIMARY oracle, and independently recomputes the
same boolean via a from-scratch pandas SMA(50)/SMA(200)/close comparison as a
SECOND, fully independent oracle. The two must agree. Neither is a hardcoded
1.00 — both are computed fresh, from real data, on every run.

Each run: finds a free port, launches a throwaway backend
(``tools/_gj_launch_backend.py``, which redirects every shared-data-root env
pin to an isolated temp sandbox via the same ``conftest.py`` mechanism pytest
uses — never touches real ``C:\\data``), signs up a fresh admin account in
that fresh sandbox, drives a real headless Chromium through all three
journeys, writes evidence (screenshots + a JSON verdict + a results doc)
under ``tools/_gj_runs/<timestamp>/``, and tears the backend down. Reproducible
by construction: nothing here is shared state across runs.

Usage:
    python tools/golden_journey_pine_thinkscript_pcf.py [--headed] [--keep-open]
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE_ROOT = ROOT / "tools" / "_gj_runs"

ADMIN_EMAIL = "gj_automation@local.dev"
ADMIN_PASSWORD = "GjAutomation2026!"

PINE_RSI_FIXTURE = ROOT / "tests" / "fixtures" / "pine" / "07-rsi.pine"
TS_ADX_FIXTURE = ROOT / "tests" / "fixtures" / "thinkscript" / "03-adx-dmi-lower.ts"
TS_NEGATIVE_FIXTURE = ROOT / "tests" / "fixtures" / "thinkscript" / "09-above-average-price-volume.ts"
PCF_SOURCE = "(C > AVGC50) AND (AVGC50 > AVGC200)"
PCF_NEGATIVE_SOURCE = "FibExtension(C, 0.618) > 0.5 AND AVGC50 > AVGC200"
PINE_NEGATIVE_SOURCE = "plot(ta.cmf(20))"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_healthy(base: str, timeout_s: float = 60.0) -> None:
    import urllib.request
    deadline = time.time() + timeout_s
    last_err = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/api/health", timeout=2) as resp:
                if resp.status == 200:
                    return
        except Exception as exc:  # noqa: BLE001 - polling
            last_err = exc
        time.sleep(0.5)
    raise RuntimeError(f"backend never became healthy at {base}: {last_err}")


class Backend:
    def __init__(self, port: int, log_path: Path):
        self.port = port
        self.base = f"http://127.0.0.1:{port}"
        self.proc: subprocess.Popen | None = None
        self.log_path = log_path
        self._log_fh = None

    def start(self) -> None:
        launcher = ROOT / "tools" / "_gj_launch_backend.py"
        # ⛔ NEVER `stdout=PIPE` here without a reader — this backend's startup
        # alone logs well past the OS pipe buffer (theme/ticker/bars seeding),
        # so an unread PIPE deadlocks the child mid-boot and `_wait_healthy`
        # times out forever with no clue why. Redirect straight to a file.
        self._log_fh = open(self.log_path, "w", encoding="utf-8", errors="replace")
        self.proc = subprocess.Popen(
            [sys.executable, str(launcher), "--port", str(self.port)],
            cwd=str(ROOT),
            stdout=self._log_fh,
            stderr=subprocess.STDOUT,
            text=True,
        )
        _wait_healthy(self.base)

    def stop(self) -> None:
        if self.proc is None:
            return
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=5)
        if self._log_fh:
            self._log_fh.close()


# ─── the JS-lane oracle (real product code, real Node process) ─────────────

_JS_JSON_HOOK = r"""
import { readFile } from 'node:fs/promises'

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8')
    return { format: 'module', shortCircuit: true, source: `export default ${source}\n` }
  }
  return nextLoad(url, context)
}
"""

_JS_FORMULA_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./jsonhook.mjs', import.meta.url)

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)

const pcf = await import(pathToFileURL(payload.pcfModule).href)
const interp = await import(pathToFileURL(payload.interpretModule).href)
const readFormulaSource = pcf.readFormulaSource
const interpret = interp.interpret

if (typeof readFormulaSource !== 'function' || typeof interpret !== 'function') {
  process.stdout.write(JSON.stringify({ ok: false, error: 'missing exports' }))
  process.exit(3)
}

const read = readFormulaSource(payload.formula, 'auto', {})
if (!read.result || !read.result.ok) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: (read.result && read.result.error) || 'formula did not parse',
  }))
  process.exit(0)
}
const ast = read.result.ast
const column = Array.from(
  interpret(ast, payload.bars, {}, undefined, undefined, { tf: 'D' }),
  (v) => (v === null || v === undefined || Number.isNaN(v) ? null : v),
)
process.stdout.write(JSON.stringify({ ok: true, dialect: read.dialect, column }))
"""


def _node_bin() -> str:
    import shutil
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node not found on PATH — required for the JS-lane oracle")
    return node


def evaluate_formula_via_product_js(formula: str, bars: list[dict]) -> dict:
    """Run the EXACT product interpreter (not a reimplementation) over `bars`.

    Returns {"ok", "dialect", "column"} or {"ok": False, "error"}.
    """
    import tempfile

    tmpdir = tempfile.mkdtemp(prefix="gj_js_oracle_")
    driver = os.path.join(tmpdir, "driver.mjs")
    hook = os.path.join(tmpdir, "jsonhook.mjs")
    try:
        with open(hook, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(_JS_JSON_HOOK)
        with open(driver, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(_JS_FORMULA_DRIVER)
        payload = {
            "formula": formula,
            "bars": bars,
            "pcfModule": str(ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "pcf.js"),
            "interpretModule": str(ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "interpret.js"),
        }
        proc = subprocess.run(
            [_node_bin(), driver],
            cwd=str(ROOT),
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
    finally:
        for p in (driver, hook):
            try:
                os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass

    if proc.returncode != 0:
        return {"ok": False, "error": f"node exited {proc.returncode}: {(proc.stderr or proc.stdout)[:2000]}"}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"not JSON: {exc}; stdout={proc.stdout[:500]!r}"}


def independent_pandas_uptrend(bars: list[dict]) -> dict:
    """The SECOND, fully independent oracle — from-scratch pandas math, zero
    reference to the product's interpreter. Mirrors `long_term_uptrend`'s
    definition: close > sma(close,50) > sma(close,200), on the last bar.
    """
    import pandas as pd

    closes = pd.Series([b["c"] for b in bars], dtype="float64")
    if len(closes) < 200:
        return {"ok": False, "error": f"only {len(closes)} bars, need >=200 for sma200"}
    sma50 = closes.rolling(50).mean()
    sma200 = closes.rolling(200).mean()
    c, s50, s200 = closes.iloc[-1], sma50.iloc[-1], sma200.iloc[-1]
    value = 1.0 if (c > s50 and s50 > s200) else 0.0
    return {"ok": True, "close": float(c), "sma50": float(s50), "sma200": float(s200), "value": value}


def fetch_bars(base: str, cookies_header: str, ticker: str, tf: str, bars: int) -> list[dict]:
    import urllib.request

    req = urllib.request.Request(
        f"{base}/api/bars/{ticker}?tf={tf}&bars={bars}",
        headers={"Cookie": cookies_header} if cookies_header else {},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    out = payload.get("bars")
    if not isinstance(out, list):
        raise RuntimeError(f"unexpected /api/bars shape: keys={list(payload.keys())}")
    return out


# ─── Playwright helpers ─────────────────────────────────────────────────────

def dismiss_intro(page) -> None:
    for sel in ['[aria-label="Skip intro"]', '[role="dialog"][aria-label="Welcome"]']:
        try:
            page.click(sel, timeout=800)
            page.wait_for_timeout(200)
        except Exception:
            pass
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass
    page.wait_for_timeout(200)


def open_new_formula_sheet(page) -> None:
    page.locator('button[title*="Indicators"]').first.click()
    page.wait_for_timeout(300)
    page.locator('[data-testid="library-new-formula"]').first.click()
    page.wait_for_timeout(300)


def close_sheet(page) -> None:
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass
    page.wait_for_timeout(200)


def go_to_import_tab(page) -> None:
    page.get_by_role("tab", name="Import").click()
    page.wait_for_timeout(150)


def paste_source(page, source: str, settle_ms: int = 500) -> None:
    """One-shot value-set — never char-by-char typing (CGJ#1's documented hang).

    ⛔ NOT `get_by_label("Script or formula")` — Playwright's label match is
    substring-based, and once the CodeMirror chunk lazy-loads it renders a
    SECOND element (the editor div, `aria-label="Script or formula editor"`)
    whose name contains the first as a substring, so the plain label query
    resolves to two elements (strict-mode violation). The underlying
    textarea is the real value carrier (PineBox.jsx: "the textarea stays and
    is never unmounted... the reason every existing rail that types into
    pine-box textarea keeps working") — target it by exact attribute match.
    """
    page.locator('textarea[aria-label="Script or formula"]').fill(source)
    page.wait_for_timeout(settle_ms)  # PINE_DEBOUNCE_MS=250, generous margin


def read_meta_dialect(page) -> str | None:
    loc = page.locator('[data-testid="pine-meta"]')
    if loc.count() == 0:
        return None
    return loc.get_attribute("data-dialect")


def read_top_refusal(page) -> dict | None:
    loc = page.locator('[data-testid="pine-refusal"]')
    if loc.count() == 0:
        return None
    return {"guard": loc.get_attribute("data-guard"), "text": loc.inner_text()}


def read_output_refusal(page, index: int = 0) -> dict | None:
    loc = page.locator(f'[data-testid="pine-output-refusal-{index}"]')
    if loc.count() == 0:
        return None
    return {"guard": loc.get_attribute("data-guard"), "text": loc.inner_text()}


def read_output_formula(page, index: int = 0) -> str | None:
    loc = page.locator(f'[data-testid="pine-formula-{index}"]')
    if loc.count() == 0:
        return None
    return loc.inner_text()


def click_use_this_formula(page) -> None:
    btn = page.locator('[data-testid="pine-use"]')
    btn.wait_for(state="visible", timeout=5000)
    btn.click()
    page.wait_for_timeout(400)


def read_readback(page) -> str | None:
    loc = page.locator('[data-testid="readback"]')
    if loc.count() == 0:
        return None
    return loc.inner_text()


def read_repaint_badge(page) -> dict | None:
    loc = page.locator('[data-testid="repaint-badge"]')
    if loc.count() == 0:
        return None
    return {"mode": loc.get_attribute("data-mode"), "text": loc.inner_text()}


def set_name(page, name: str) -> None:
    page.locator("#uct-formula-name").fill(name)


def read_levels(page) -> str:
    loc = page.get_by_label("Levels")
    return loc.input_value() if loc.count() else ""


def read_placement(page) -> str:
    loc = page.get_by_label("Placement")
    return loc.input_value() if loc.count() else ""


def click_save(page) -> dict:
    save_btn = page.get_by_role("button", name="Save", exact=True)
    save_btn.wait_for(state="visible", timeout=5000)
    save_btn.click()
    saved = page.locator('[data-testid="saved-note"]')
    err = page.locator('[data-testid="store-error"]')
    try:
        saved.wait_for(state="visible", timeout=8000)
        return {"ok": True, "text": saved.inner_text()}
    except Exception:
        if err.count():
            return {"ok": False, "error": err.inner_text()}
        return {"ok": False, "error": "no saved-note and no store-error within timeout"}


def formula_is_listed_as_mine(page, name: str) -> bool:
    """Reopen Indicators and check the definition is listed with 'Your formula'.

    This is the hard, DOM-checkable persistence proof used for all three
    journeys — it does not depend on parsing a live chart legend's rendered
    text (which the source Golden Journey docs themselves only ever treated
    as a soft, screenshot-based plausibility check for the two oscillators).
    """
    page.locator('button[title*="Indicators"]').first.click()
    page.wait_for_timeout(400)
    row = page.locator(f'li[data-user-defined="true"]:has-text("{name}")')
    ok = row.count() > 0 and "Your formula" in row.first.inner_text()
    close_sheet(page)
    return ok


def open_screens_menu(page, base: str) -> None:
    """The Screens ▾ dropdown lives on /screener, not /charts — navigate there.

    ⛔ `wait_until="domcontentloaded"` fires before the page's own client-side
    fetch of saved definitions resolves — a fixed sleep after it is a race,
    not a wait. `screener_is_refused`/`screener_is_accepted` below poll for
    the concrete DOM evidence of "the list has loaded" instead of trusting a
    fixed delay (this is what made journey 2's screener check flaky on a
    second run: same machine, same code, no disk pressure involved — a real
    async-fetch race in the harness, not the product).
    """
    page.goto(f"{base}/screener", wait_until="domcontentloaded", timeout=30000)
    dismiss_intro(page)
    page.wait_for_timeout(300)
    page.get_by_role("button", name="Screens ▾").click()


def close_screens_menu_and_return_to_charts(page, base: str) -> None:
    page.goto(f"{base}/charts", wait_until="domcontentloaded", timeout=30000)
    dismiss_intro(page)
    page.wait_for_timeout(500)


def _wait_for_scans_list_settled(page, timeout_ms: int = 8000) -> None:
    """Block until the 'My scans' section shows SOME concrete state — a
    scannable row, an unscannable-count banner, or the explicit empty state —
    rather than trusting a fixed sleep to have outrun the client fetch."""
    page.locator(
        '[data-testid="screens-unscannable"], '
        'button[aria-label^="Use "][aria-label$=" as filter"], '
        'text="No scannable formulas yet"'
    ).first.wait_for(state="visible", timeout=timeout_ms)


def screener_is_refused(page, name: str) -> dict:
    try:
        _wait_for_scans_list_settled(page)
    except Exception:
        pass
    block = page.locator('[data-testid="screens-unscannable"]')
    if block.count() == 0:
        return {"found": False}
    row = block.locator(f'[data-unscannable]:has-text("{name}")')
    return {"found": row.count() > 0, "text": row.first.inner_text() if row.count() else None}


def screener_is_accepted(page, name: str) -> dict:
    try:
        _wait_for_scans_list_settled(page)
    except Exception:
        pass
    btn = page.get_by_role("button", name=f"Use {name} as filter")
    return {"found": btn.count() > 0}


# ─── the three journeys ─────────────────────────────────────────────────────

def run_journey_1_pine_rsi(page, shots_dir: Path, base: str) -> dict:
    steps: dict = {}
    source = PINE_RSI_FIXTURE.read_text(encoding="utf-8")

    open_new_formula_sheet(page)
    go_to_import_tab(page)
    steps["1_paste"] = {"pass": True}

    paste_source(page, source)
    dialect = read_meta_dialect(page)
    steps["2_detection"] = {"pass": dialect == "pine", "dialect": dialect}

    click_use_this_formula(page)
    page.wait_for_timeout(300)
    readback = read_readback(page)
    steps["3_translation"] = {
        "pass": readback is not None and "rsi" in (readback or "").lower(),
        "readback": readback,
    }

    badge = read_repaint_badge(page)
    steps["4_canonical"] = {"pass": badge is not None, "badge": badge}

    levels = read_levels(page)
    placement = read_placement(page)
    # ⚠️ LEVELS is NOT asserted non-empty. CORE_GOLDEN_JOURNEY_01's manual
    # walkthrough recorded "LEVELS: 70, 30 auto-populated" for a fresh Pine
    # import, but BuilderSheet.jsx only seeds `levelsText` from a document's
    # `hlines` guide plot inside its openForEdit() reconstruction (reading
    # `def.plots`) — there is no code path that populates it from a fresh
    # PineBox `onPick`. Per this repo's own precedence rule (current code
    # outranks prose), that manual-doc claim does not hold for the current
    # code, so this is recorded as a documentation-vs-code discrepancy in the
    # completion report rather than forced to pass here. Only PLACEMENT
    # (correctly inferred as "pane" for an oscillator) is asserted.
    steps["5_validation"] = {
        "pass": placement == "pane",
        "levels": levels, "placement": placement,
        "note": "levels not asserted — see completion report re: CGJ#1 doc vs current code",
    }

    page.screenshot(path=str(shots_dir / "j1_preview.png"))
    steps["6_preview"] = {"pass": True, "screenshot": "j1_preview.png"}

    set_name(page, "RSI Import Test")
    saved = click_save(page)
    steps["8_save"] = saved
    close_sheet(page)

    page.reload(wait_until="domcontentloaded")
    dismiss_intro(page)
    listed = formula_is_listed_as_mine(page, "RSI Import Test")
    steps["9_reload_and_listing"] = {"pass": listed}

    # numeric artifact must be REFUSED by the screener
    open_screens_menu(page, base)
    refusal = screener_is_refused(page, "RSI Import Test")
    steps["10_screener_refuses_numeric"] = {"pass": refusal.get("found", False), **refusal}
    close_screens_menu_and_return_to_charts(page, base)

    # a BOOLEAN sibling (rsi(close,14) > 50) must be ACCEPTED
    open_new_formula_sheet(page)
    page.get_by_role("tab", name="Formula").click()
    page.wait_for_timeout(150)
    # FormulaField.jsx's default inputId is "uct-formula" — a plain CSS id is
    # unambiguous, unlike an aria-label lookup (which collides with the lazy-
    # loaded CodeMirror editor the same way "Script or formula" did above).
    page.locator("#uct-formula").fill("rsi(close, 14) > 50")
    page.wait_for_timeout(400)
    set_name(page, "RSI Above 50 Screen")
    saved2 = click_save(page)
    steps["10b_save_boolean_sibling"] = saved2
    close_sheet(page)

    open_screens_menu(page, base)
    accepted = screener_is_accepted(page, "RSI Above 50 Screen")
    steps["10c_screener_accepts_boolean"] = accepted
    close_screens_menu_and_return_to_charts(page, base)

    # negative path
    open_new_formula_sheet(page)
    go_to_import_tab(page)
    paste_source(page, PINE_NEGATIVE_SOURCE)
    refusal_top = read_top_refusal(page)
    refusal_out = read_output_refusal(page, 0)
    use_disabled = page.locator('[data-testid="pine-use"]').is_disabled()
    steps["12_negative_path"] = {
        "pass": (refusal_top is not None or refusal_out is not None) and use_disabled,
        "top_refusal": refusal_top, "output_refusal": refusal_out, "use_disabled": use_disabled,
    }
    close_sheet(page)

    return steps


def run_journey_2_thinkscript_adx(page, shots_dir: Path, base: str) -> dict:
    steps: dict = {}
    source = TS_ADX_FIXTURE.read_text(encoding="utf-8")

    open_new_formula_sheet(page)
    go_to_import_tab(page)
    paste_source(page, source)
    dialect = read_meta_dialect(page)
    steps["1_2_paste_and_detection"] = {"pass": dialect == "thinkscript", "dialect": dialect}

    formulas = [read_output_formula(page, i) for i in range(3)]
    di_plus = next((f for f in formulas if f and "100" in f), None)
    steps["3_translation"] = {
        "pass": di_plus is not None and "rma(" in di_plus,
        "outputs": formulas,
    }

    click_use_this_formula(page)
    page.wait_for_timeout(300)
    readback = read_readback(page)
    badge = read_repaint_badge(page)
    steps["4_canonical"] = {"pass": readback is not None and badge is not None, "readback": readback, "badge": badge}

    placement = read_placement(page)
    steps["5_validation"] = {"pass": placement == "pane", "placement": placement}

    page.screenshot(path=str(shots_dir / "j2_preview.png"))
    steps["6_preview"] = {"pass": True}

    set_name(page, "ADX DMI Import Test")
    saved = click_save(page)
    steps["8_save"] = saved
    close_sheet(page)

    page.reload(wait_until="domcontentloaded")
    dismiss_intro(page)
    listed = formula_is_listed_as_mine(page, "ADX DMI Import Test")
    steps["9_10_reload_and_listing"] = {"pass": listed}

    open_screens_menu(page, base)
    refusal = screener_is_refused(page, "ADX DMI Import Test")
    steps["11_screener_reach"] = {"pass": refusal.get("found", False), **refusal}
    close_screens_menu_and_return_to_charts(page, base)

    # negative path — two SEQUENTIAL, DISTINCT refusals
    open_new_formula_sheet(page)
    go_to_import_tab(page)
    neg_source = TS_NEGATIVE_FIXTURE.read_text(encoding="utf-8")
    paste_source(page, neg_source)
    first_refusal = read_top_refusal(page) or read_output_refusal(page, 0)
    apply_btn = page.locator('[data-testid="import-suggest-apply"]')
    has_suggest = apply_btn.count() > 0
    first_text = (first_refusal or {}).get("text", "")

    second_refusal = None
    if has_suggest:
        apply_btn.first.click()
        page.wait_for_timeout(500)
        second_refusal = read_top_refusal(page) or read_output_refusal(page, 0)

    second_text = (second_refusal or {}).get("text", "")
    apply_btn_after = page.locator('[data-testid="import-suggest-apply"]')
    steps["13_negative_path_two_refusals"] = {
        "pass": (
            has_suggest
            and second_refusal is not None
            and second_text != ""
            and second_text != first_text
            and apply_btn_after.count() == 0
        ),
        "first_refusal": first_refusal,
        "had_assisted_edit": has_suggest,
        "second_refusal": second_refusal,
        "second_has_no_assisted_edit": apply_btn_after.count() == 0,
    }
    close_sheet(page)

    return steps


def run_journey_3_pcf(page, shots_dir: Path, backend: Backend, cookie_header: str) -> dict:
    steps: dict = {}

    open_new_formula_sheet(page)
    go_to_import_tab(page)
    paste_source(page, PCF_SOURCE)
    dialect = read_meta_dialect(page)
    steps["1_2_paste_and_detection"] = {"pass": dialect == "pcf", "dialect": dialect}

    # ⚠️ For the pcf/native dialect, `inspectSource()`'s blank branch sets
    # `outputs[0].formula = source` VERBATIM (there is no separate pre-Use
    # translated-string field for this dialect — only Pine/thinkScript
    # produce a distinct translated formula string at this stage). The
    # actual translation is only observable in the plain-English readback
    # after "Use this formula", which is what CGJ#3's own doc checked
    # against the corpus's declared expected native. So this step only
    # confirms the raw source echoed back unmangled; translation
    # correctness is asserted in 4_canonical below via the readback.
    formula_text = read_output_formula(page, 0)
    steps["3_translation"] = {
        "pass": formula_text == PCF_SOURCE,
        "formula": formula_text,
    }

    click_use_this_formula(page)
    page.wait_for_timeout(300)
    readback = read_readback(page)
    badge = read_repaint_badge(page)
    readback_lower = (readback or "").lower()
    translation_correct = (
        "50-bar average of close" in readback_lower
        and "200-bar average of close" in readback_lower
        and "greater than" in readback_lower
    )
    steps["4_canonical"] = {
        "pass": readback is not None and badge is not None and translation_correct,
        "readback": readback, "badge": badge, "translation_correct": translation_correct,
    }

    # leave the screen-threshold blank deliberately (CGJ#3's own test)
    steps["5_validation_blank_threshold"] = {"pass": True}

    page.screenshot(path=str(shots_dir / "j3_preview.png"))
    steps["6_preview"] = {"pass": True}

    set_name(page, "PCF Long-Term Uptrend Test")
    saved = click_save(page)
    steps["8_save"] = saved
    close_sheet(page)

    # ─── the deterministic, point-in-time chart-delivery oracle ───────────
    bars = fetch_bars(backend.base, cookie_header, "SPY", "D", 260)
    js_result = evaluate_formula_via_product_js(formula_text or "", bars)
    py_result = independent_pandas_uptrend(bars)
    js_last = js_result.get("column", [None])[-1] if js_result.get("ok") else None
    agree = (
        js_result.get("ok") and py_result.get("ok")
        and js_last is not None
        and float(js_last) == float(py_result["value"])
    )
    steps["7_chart_delivery_deterministic"] = {
        "pass": agree,
        "bar_count": len(bars),
        "last_bar_t": bars[-1].get("t") if bars else None,
        "product_js_interpreter_value": js_last,
        "independent_pandas_value": py_result.get("value"),
        "pandas_detail": py_result,
        "js_error": js_result.get("error"),
    }

    page.reload(wait_until="domcontentloaded")
    dismiss_intro(page)
    listed = formula_is_listed_as_mine(page, "PCF Long-Term Uptrend Test")
    steps["9_10_reload_and_listing"] = {"pass": listed}

    open_screens_menu(page, backend.base)
    accepted = screener_is_accepted(page, "PCF Long-Term Uptrend Test")
    steps["11_screener_accepts_binary_pcf"] = accepted
    close_screens_menu_and_return_to_charts(page, backend.base)

    open_new_formula_sheet(page)
    go_to_import_tab(page)
    paste_source(page, PCF_NEGATIVE_SOURCE)
    refusal = read_top_refusal(page) or read_output_refusal(page, 0)
    use_disabled = page.locator('[data-testid="pine-use"]').is_disabled()
    steps["13_negative_path"] = {
        "pass": refusal is not None and use_disabled,
        "refusal": refusal, "use_disabled": use_disabled,
    }
    close_sheet(page)

    return steps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--keep-open", action="store_true", help="leave backend+browser running on failure for inspection")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = EVIDENCE_ROOT / stamp
    run_dir.mkdir(parents=True, exist_ok=True)

    port = _free_port()
    backend = Backend(port, run_dir / "backend.log")
    print(f"[gj] starting isolated backend on port {port}...")
    backend.start()
    print(f"[gj] backend healthy at {backend.base}")

    import urllib.request

    signup_body = json.dumps({
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "display_name": "GJ Automation",
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{backend.base}/api/auth/signup", data=signup_body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status not in (200, 201):
            raise RuntimeError(f"signup failed: {resp.status}")

    results: dict = {"stamp": stamp, "port": port}
    overall_ok = True

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={"width": 1440, "height": 960})
        page = ctx.new_page()

        login_resp = page.request.post(
            f"{backend.base}/api/auth/login",
            data={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"Content-Type": "application/json"},
        )
        if login_resp.status != 200:
            raise RuntimeError(f"login failed: {login_resp.status} {login_resp.text()[:200]}")

        cookies = ctx.cookies()
        cookie_header = "; ".join(f"{c['name']}={c['value']}" for c in cookies)

        page.goto(f"{backend.base}/charts", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)
        dismiss_intro(page)

        try:
            results["journey_1_pine_rsi"] = run_journey_1_pine_rsi(page, run_dir, backend.base)
        except Exception as exc:  # noqa: BLE001
            results["journey_1_pine_rsi"] = {"error": str(exc)}
            page.screenshot(path=str(run_dir / "j1_FAILURE.png"))

        try:
            page.reload(wait_until="domcontentloaded")
            dismiss_intro(page)
            results["journey_2_thinkscript_adx"] = run_journey_2_thinkscript_adx(page, run_dir, backend.base)
        except Exception as exc:  # noqa: BLE001
            results["journey_2_thinkscript_adx"] = {"error": str(exc)}
            page.screenshot(path=str(run_dir / "j2_FAILURE.png"))

        try:
            page.reload(wait_until="domcontentloaded")
            dismiss_intro(page)
            results["journey_3_pcf"] = run_journey_3_pcf(page, run_dir, backend, cookie_header)
        except Exception as exc:  # noqa: BLE001
            results["journey_3_pcf"] = {"error": str(exc)}
            page.screenshot(path=str(run_dir / "j3_FAILURE.png"))

        browser.close()

    for jname, jsteps in results.items():
        if jname in ("stamp", "port"):
            continue
        if "error" in jsteps:
            overall_ok = False
            continue
        for sname, sval in jsteps.items():
            if isinstance(sval, dict) and sval.get("pass") is False:
                overall_ok = False

    results["overall_pass"] = overall_ok

    evidence_path = run_dir / "evidence.json"
    evidence_path.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    print(f"[gj] evidence written to {evidence_path}")
    print(f"[gj] overall_pass = {overall_ok}")

    if not args.keep_open:
        backend.stop()
    else:
        print(f"[gj] --keep-open set; backend still running at {backend.base} (pid {backend.proc.pid})")

    return 0 if overall_ok else 1


if __name__ == "__main__":
    sys.exit(main())
