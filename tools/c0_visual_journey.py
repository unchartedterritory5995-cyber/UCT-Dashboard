# -*- coding: utf-8 -*-
"""C0 -- the complete visual journey for an imported Pine indicator, measured.

IMPORT -> APPLY -> SAVE -> RELOAD -> DID IT ACTUALLY DRAW

WHY PLAYWRIGHT RATHER THAN THE LIVE-BROWSER TOOLS.
The first attempt drove a shared Chrome instance through the browser extension and
could not produce repeatable evidence. Root-caused, not guessed: the tab reported
`visibilityState: "hidden"` and `hasFocus: false` even as the ONLY tab in its
group, a `setTimeout(1000)` actually took 3438 ms (~3.4x background clamp), and
`canvases` was 0 -- `/charts` sizes its grid from a ResizeObserver and paints
through rAF, both of which Chrome suspends in a hidden tab, so the workspace
mounted nothing. The Chrome instance is shared with other agent sessions that
repeatedly took foreground.

Playwright has no such dependency: its pages are always visible to the renderer,
nothing else can steal their foreground, and the repo already drives real
authenticated routes this way in `tools/mobile_audit.py`. This harness reuses that
file's three hard-won solutions verbatim in spirit:
  - `reduced_motion="reduce"` so the cinematic intro takes its short branch,
  - an intro dismissal that VERIFIES the overlay is gone and RAISES if it is not
    (auditing the intro as if it were the page is worse than not auditing),
  - auth by POSTing /api/auth/login through the context's request API so the
    cookie lands in the jar, instead of driving a form past the overlay.

WHY `canvases` IS NOT THE RENDER SIGNAL, AND WHAT REPLACED IT.
The first version of this file compared `querySelectorAll('canvas').length` before
and after the import and called a non-zero count CHART_RENDERABLE. Measured on the
real page it read `canvases_before: 75` and `canvases_after: 75` -- the workspace's
own chart widgets own every one of those canvases and they exist whether or not a
single Pine script was ever imported. It could not have returned anything but
CHART_RENDERABLE, for any script, including one whose Save never fired. A GATE THAT
CANNOT FAIL IS NOT A GATE (`lesson_gate_that_cannot_fail`), and every number it
would have produced was worthless.

The replacement is the PRODUCT'S OWN answer to the same question, not a new one
invented here. `StockChart` renders one `IndicatorChip` per plot of every instance
on the chart, and `engine/readout.js::legendChips` stamps each chip with:
  - `data-instance-id` / `data-plot-key` -- WHICH plot of WHICH instance,
  - `data-hidden`,
  - `data-computed="false"` -- present EXACTLY when the plot is visible and its
    column held no finite value: the indicator is on the chart and drew NOTHING.
    Absent means it drew. (That attribute exists because the team already measured
    that a visible-but-empty chip and an ordinary off-cursor chip were byte
    identical; see the comment block in `readout.js`.)
So "did my import render" is three independent facts: the set of instance ids on
the page GREW, the new chips carry the plot keys the saved document declares, and
none of them says `data-computed="false"`. Each can come back false on its own,
which is the thing a canvas count could never do.

THE INSTANCE IDS ARE DIFFED, NOT THE LABELS. A chip's text comes from
`chipLabel(def, plot, inputs)` and depends on the plot's legend config, so matching
by name would fail for a script whose plot is titled something other than the
document's name -- and would silently attribute a PREVIOUS script's chip to this
one when two fixtures share a title. The id is minted per instance by
`addInstance`, so a set difference is exact.

AND THE SAVE STEP REPORTS WHICH GATE IS SHUT, NEVER JUST `false`. The previous run
returned `save_clicked: false` for several scripts and that is not a finding --
`BuilderSheet`'s `canSave` is five gates (`formula`, `named`, `idle`, `inputs`,
`plots`), and "the button was disabled" names none of them. This reads the button's
own `disabled`, the `save-hint` the sheet renders for exactly this purpose, and the
refusal/problem chips, so a blocked save comes back as a REASON.

IT REPORTS WHAT IT SAW. Every step is timed and every check is a real DOM read on
the real page. A step that cannot be verified is reported as such, never inferred
from the step before it.

Usage:
  python tools/c0_visual_journey.py --base http://127.0.0.1:18500 \
      --fixtures tests/fixtures/pine_multiplot --out tools/c0_out
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

_INTRO_SEL = '[data-intro-overlay], .introOverlay, [class*="introOverlay"]'


def dismiss_intro(page):
    for attempt in (
        lambda: page.click('[aria-label="Skip intro"]', timeout=1000),
        lambda: page.click(_INTRO_SEL, timeout=1000),
        lambda: page.keyboard.press("Escape"),
    ):
        try:
            attempt()
            page.wait_for_timeout(300)
        except Exception:
            continue
        if page.query_selector(_INTRO_SEL) is None:
            return True
    try:
        page.wait_for_selector(_INTRO_SEL, state="detached", timeout=12000)
        return True
    except Exception:
        return page.query_selector(_INTRO_SEL) is None


def login(page, base, email, pw):
    r = page.request.post(f"{base}/api/auth/login",
                          data=json.dumps({"email": email, "password": pw}),
                          headers={"Content-Type": "application/json"})
    if not r.ok:
        raise RuntimeError(f"login HTTP {r.status}")
    return r.json()


# -- the page vocabulary, in one place ---------------------------------------
# TESTIDS WHERE THEY EXIST. `pine-meta`, `pine-use`, `save-hint`, `formula-error`,
# `store-error`, `repaint-ack`, `plot-problem-N` are the product's own published
# handles; guessing at class names is how a harness silently measures the wrong
# element.
JS_OPEN_BUILDER = """
() => {
  const vis = (e) => e && e.offsetParent !== null;
  const ind = [...document.querySelectorAll('button')]
    .find(b => vis(b) && b.innerText.trim() === 'Indicators');
  if (ind) ind.click();
  return !!ind;
}"""

JS_NEW_FORMULA = """
() => {
  const vis = (e) => e && e.offsetParent !== null;
  const nf = [...document.querySelectorAll('*')]
    .find(e => vis(e) && e.children.length < 4 && /^\\s*New formula/i.test(e.textContent || ''));
  if (nf) (nf.closest('button') || nf).click();
  return !!nf;
}"""

JS_IMPORT_TAB = """
() => {
  const vis = (e) => e && e.offsetParent !== null;
  const t = [...document.querySelectorAll('button')]
    .find(b => vis(b) && b.innerText.trim() === 'Import');
  if (t) t.click();
  return !!t;
}"""

JS_PASTE = """
(src) => {
  const ta = [...document.querySelectorAll('textarea')]
    .find(t => /@version/.test(t.placeholder || ''));
  if (!ta) return false;
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value');
  d.set.call(ta, src);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}"""

JS_META = """
() => {
  const e = document.querySelector('[data-testid=pine-meta]');
  return e ? e.innerText.replace(/\\s+/g, ' ') : '';
}"""

JS_APPLY = """
() => {
  const u = document.querySelector('[data-testid=pine-use]');
  if (!u || u.disabled) return false;
  u.click();
  return true;
}"""

# What the builder is holding after Apply -- the carriage evidence.
JS_BUILDER_STATE = """
() => {
  const vis = (e) => e && e.offsetParent !== null;
  const byPh = (ph) => {
    const e = [...document.querySelectorAll('input')].find(i => i.placeholder === ph);
    return e ? e.value : null;
  };
  const selects = [...document.querySelectorAll('select')].filter(vis).map(s => s.value);
  const colors = [...document.querySelectorAll('input[type=color]')].filter(vis).map(c => c.value);
  const keyInputs = [...document.querySelectorAll('input')].filter(
    i => vis(i) && (i.placeholder === 'value' || i.placeholder === 'Signal'));
  return {
    levels: byPh('70, 30'),
    placement: selects.length ? selects[selects.length - 1] : null,
    styleSelects: selects.slice(0, Math.max(0, selects.length - 1)),
    colors,
    plotRowInputs: keyInputs.length,
  };
}"""

JS_NAME = """
(name) => {
  const n = [...document.querySelectorAll('input')].find(i => i.placeholder === '20-bar average');
  if (!n) return false;
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(n), 'value');
  d.set.call(n, name);
  n.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}"""

# ACKNOWLEDGE THE REPAINT NOTICE, BECAUSE THAT IS THE PRODUCT'S OWN DOOR.
# `canSaveFormula` returns false for `mode === 'preview-repaints'` until the member
# ticks the box the sheet renders next to that verdict -- one per plot row
# (`repaint-ack`, `repaint-ack-2`, ...). A harness that never ticks them measures
# "the member never read the notice", not "the product cannot save this".
# `mode === 'repaints'` has NO checkbox and can never save; that is a product
# answer and this must REPORT it, not route around it.
JS_ACK_REPAINT = """
() => {
  const boxes = [...document.querySelectorAll('input[type=checkbox]')]
    .filter(b => (b.getAttribute('data-testid') || '').indexOf('repaint-ack') === 0);
  let ticked = 0;
  for (const b of boxes) { if (!b.checked) { b.click(); ticked += 1; } }
  return { present: boxes.length, ticked: ticked };
}"""

# WHY THE SAVE BUTTON IS SHUT, NOT MERELY THAT IT IS. `canSave` is five gates;
# `save_clicked: false` names none of them. The sheet already renders the answer in
# `save-hint` (its whole reason for existing), and every other refusal names itself
# on its own row.
JS_SAVE_STATE = """
() => {
  const vis = (e) => e && e.offsetParent !== null;
  const txt = (sel) => {
    const e = document.querySelector(sel);
    return e ? e.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200) : null;
  };
  const n = [...document.querySelectorAll('input')].find(i => i.placeholder === '20-bar average');
  const b = [...document.querySelectorAll('button')]
    .find(x => vis(x) && /^Save( changes)?$/i.test((x.innerText || '').trim()));
  const plotProblems = [...document.querySelectorAll('[data-testid^="plot-problem-"]')]
    .map(e => e.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean);
  const inputProblems = [...document.querySelectorAll('[data-testid^="member-input-problem-"]')]
    .map(e => e.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean);
  return {
    nameFound: !!n,
    nameValue: n ? n.value : null,
    saveFound: !!b,
    saveDisabled: b ? !!b.disabled : null,
    hint: txt('[data-testid=save-hint]'),
    formulaError: txt('[data-testid=formula-error]'),
    repaintBadge: txt('[data-testid=repaint-badge]'),
    levelsProblem: txt('[data-testid=levels-problem]'),
    pickerNote: txt('[data-testid=picker-note]'),
    plotProblems: plotProblems,
    inputProblems: inputProblems,
  };
}"""

JS_CLICK_SAVE = """
() => {
  const vis = (e) => e && e.offsetParent !== null;
  const b = [...document.querySelectorAll('button')]
    .find(x => vis(x) && /^Save( changes)?$/i.test((x.innerText || '').trim()) && !x.disabled);
  if (b) b.click();
  return !!b;
}"""

JS_STORE_ERROR = """
() => {
  const e = document.querySelector('[data-testid=store-error]');
  return e ? e.innerText.replace(/\\s+/g, ' ').trim().slice(0, 240) : null;
}"""

# THE RENDER SIGNAL. One row per plot of every instance actually on the chart,
# carrying the product's own "did this draw anything" stamp. See the module
# docstring for why this replaced the canvas count.
JS_CHIPS = """
() => [...document.querySelectorAll('[data-instance-id][data-plot-key]')].map(e => ({
  instanceId: e.getAttribute('data-instance-id'),
  plotKey: e.getAttribute('data-plot-key'),
  text: (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
  hidden: e.getAttribute('data-hidden') === 'true',
  drewNothing: e.getAttribute('data-computed') === 'false',
}))"""

# Cleanup, so each script is measured against a chart it alone changed.
JS_REMOVE_INSTANCES = """
(ids) => {
  const want = new Set(ids);
  let clicked = 0;
  for (const chip of [...document.querySelectorAll('[data-instance-id][data-plot-key]')]) {
    if (!want.has(chip.getAttribute('data-instance-id'))) continue;
    const btn = [...chip.querySelectorAll('button')]
      .find(b => /^Remove /.test(b.getAttribute('aria-label') || ''));
    if (btn) { btn.click(); clicked += 1; }
  }
  return clicked;
}"""


def _defs(page, base):
    """Every saved definition, by id. The persistence authority."""
    r = page.request.get(f"{base}/api/user-definitions")
    if not r.ok:
        return None
    rows = r.json().get("definitions", [])
    return {row.get("def_id"): row for row in rows if row.get("def_id")}


def _doc_shape(row):
    """What the STORED document declares -- the thing the chips must match.

    A GUIDE IS NOT A MISSING PLOT. `buildDefinition` writes the `hline` levels as
    a plot with `role: 'context'` and DELIBERATELY NO `legend` block, and
    `legendChips` skips any plot without one (`if (!plot || !plot.legend || ...)`)
    -- so a levels guide never earns a chip and never should. Comparing chips
    against `plots[].key` wholesale booked that as "declared 3, drew 2" and
    reported a correct render as CHART_PARTIAL. The expectation is derived from
    the SAME predicate the renderer uses, not from a count of plots.
    """
    d = (row or {}).get("definition") or {}
    plots = [p for p in (d.get("plots") or []) if isinstance(p, dict)]
    compute = d.get("compute") or {}
    trees = compute.get("trees") or {}

    def chips(p):
        lg = p.get("legend")
        return isinstance(lg, dict) and lg.get("hide") is not True

    inputs = [i for i in (d.get("inputs") or []) if isinstance(i, dict)]
    guide = next((p for p in plots if not chips(p)), None)
    return {
        "name": row.get("name") if row else None,
        "plot_keys": [p.get("key") for p in plots],
        "chip_plot_keys": [p.get("key") for p in plots if chips(p)],
        "guide_plot_keys": [p.get("key") for p in plots if not chips(p)],
        "tree_keys": sorted(trees.keys()) if isinstance(trees, dict) else [],
        "scan_plot": compute.get("scanPlot"),
        "placement": (plots[0] or {}).get("target") if plots else None,
        "scannable": row.get("scannable") if row else None,
        # -- C0R §15: what persistence has to preserve, named field by field --
        "input_keys": [i.get("key") for i in inputs],
        "input_defaults": {i.get("key"): i.get("default") for i in inputs},
        "plot_styles": [p.get("style") for p in plots if chips(p)],
        "plot_colors": [p.get("color") for p in plots if chips(p)],
        "targets": sorted({p.get("target") for p in plots if p.get("target")}),
        "levels": (guide or {}).get("levels"),
    }


def _instance_ids(page, base):
    """Every indicator instance the SERVER is holding for this user.

    WHY THE SERVER AND NOT THE DOM. `save()` ends in
    `onChange(addInstance(settings, ...))`, and on `/charts` that write reaches
    the wire through the workspace layout's DEBOUNCED 500 ms persist. This harness
    used to reload the page as soon as the DEFINITION appeared in
    `/api/user-definitions` -- a different request, answering in ~550 ms -- so the
    reload raced the debounce and, on four of five fixtures, threw the instance
    away before it was ever written. It reported SAVED_NOT_RENDERED, which is a
    fact about the harness's own timing wearing the shape of a product defect, and
    the one fixture that "passed" only won the race. Waiting on the ARTIFACT is
    the fix; a longer sleep would only move the race.
    """
    r = page.request.get(f"{base}/api/auth/preferences")
    if not r.ok:
        return None
    prefs = r.json() or {}
    out = set()

    def harvest(settings):
        # `indicatorInstances`, WHICH IS THE NAME `withInstances` WRITES. The
        # first draft of this reader guessed `instances`, found nothing, and
        # reported SAVED_NO_INSTANCE for five fixtures whose instances were on
        # the chart and in the blob the whole time -- a probe that cannot see the
        # thing it is looking for returns the same answer as a broken product
        # (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
        for inst in ((settings or {}).get("indicatorInstances") or []):
            if not isinstance(inst, dict) or not isinstance(inst.get("instanceId"), str):
                continue
            # OFF IS A TOMBSTONE, not a removal (`instanceControls.js`), so a
            # removed instance is still in the array. Counting one would make the
            # cleanup at the end of each script poison the next script's baseline.
            if inst.get("deleted") is True:
                continue
            out.add(inst["instanceId"])

    for key in ("chart_settings", "charts_workspace_layout"):
        raw = prefs.get(key)
        if not raw:
            continue
        try:
            blob = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:  # noqa: BLE001
            continue
        if key == "chart_settings":
            harvest(blob)
        else:
            for w in ((blob or {}).get("widgets") or []):
                harvest(((w or {}).get("opts") or {}).get("settings"))
    return out


# THE LEGEND IS CROSSHAIR-GATED, SO THE READ HAS TO PUT A CURSOR ON THE CHART.
# `StockChart` renders the whole legend behind
# `crosshairData && !hideLegend && legendMode !== 'off' && (legendMode !== 'hold'
# || legendHeld)`, and `crosshairData` is null until the pointer has been over the
# plot. So an unhovered page has NO chips -- for every indicator, drawing or not.
# Measured: a workspace whose chart was visibly drawing three imported Pine
# indicators (three extra panes, screenshotted) reported ZERO chips, which this
# harness would have booked as SAVED_NOT_RENDERED for all three. "The legend is
# not showing" and "the indicator did not draw" are different facts and the DOM
# says the same thing for both until the cursor moves.
JS_PLOT_BOXES = """
() => [...document.querySelectorAll('canvas')].map(c => {
  const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}).filter(b => b.w > 300 && b.h > 60).sort((a, b) => (b.w * b.h) - (a.w * a.h))"""


def _hover_plot(page):
    """Put the pointer on the biggest plot canvas so the legend renders."""
    boxes = page.evaluate(JS_PLOT_BOXES)
    if not boxes:
        return False
    b = boxes[0]
    cx = b["x"] + b["w"] * 0.55
    cy = b["y"] + b["h"] * 0.5
    # Two moves with steps: lightweight-charts subscribes to real pointer motion,
    # and a single teleporting move is not always delivered as one.
    page.mouse.move(cx - 60, cy, steps=4)
    page.mouse.move(cx, cy, steps=8)
    return True


def _settled_chips(page, before_ids, timeout_ms=25000, poll_ms=500):
    """Poll the legend until the new chips have DRAWN, or the budget runs out.

    A SINGLE READ HERE WOULD HAVE LIED IN ONE DIRECTION ONLY. `data-computed`
    is decided by whether `planBindings` gave the plot a series, which needs the
    bars to have landed -- and on a cold sandbox the first daily fetch is seconds,
    not frames. Reading once after a fixed sleep reports "this indicator computed
    nothing" for an indicator that was merely still waiting for its data, and that
    error is INVISIBLE: it looks exactly like the real defect this metric exists
    to catch. So the read settles, and the time it took is reported, so a slow
    render is distinguishable from a dead one rather than silently absorbed.

    Returns (chips, new_chips, waited_ms, settled) -- `settled` false means the
    budget ran out with at least one new chip still drawing nothing, which is
    reported as such rather than smoothed over.
    """
    before = set(before_ids)
    started = time.time()
    chips, new = [], []
    while (time.time() - started) * 1000 < timeout_ms:
        _hover_plot(page)
        chips = page.evaluate(JS_CHIPS)
        new = [c for c in chips if c["instanceId"] not in before]
        if new and not any(c["drewNothing"] for c in new):
            return chips, new, round((time.time() - started) * 1000), True
        page.wait_for_timeout(poll_ms)
    _hover_plot(page)
    chips = page.evaluate(JS_CHIPS)
    new = [c for c in chips if c["instanceId"] not in before]
    return chips, new, round((time.time() - started) * 1000), False


def _open_workspace(page, base, timeout=30000):
    page.goto(f"{base}/charts", wait_until="domcontentloaded", timeout=45000)
    if not dismiss_intro(page):
        return "intro overlay never dismissed"
    try:
        page.wait_for_function(
            "() => [...document.querySelectorAll('button')]"
            ".some(b => b.offsetParent && b.innerText.trim() === 'Indicators')",
            timeout=timeout)
    except Exception:
        return "workspace never mounted (no Indicators control)"
    return None


def run_one(page, base, name, source, out_dir):
    """One complete journey. Every phase timed, every claim a real read."""
    t = {}

    def timed(key, fn):
        s = time.time()
        r = fn()
        t[key] = round((time.time() - s) * 1000)
        return r

    row = {"script": name, "timings_ms": t}

    blocked = timed("goto", lambda: _open_workspace(page, base))
    if blocked:
        row["result"] = "CHART_BLOCKED"
        row["detail"] = blocked
        return row

    # -- the baseline the render check is diffed against ----------------------
    # CHIPS RENDER ON THE PAINT AFTER THE INSTANCE LIST SETTLES, so the baseline is
    # taken AFTER the workspace mounts and is given a beat -- reading it too early
    # would make an already-present indicator look new.
    page.wait_for_timeout(1200)
    _hover_plot(page)
    chips_before = page.evaluate(JS_CHIPS)
    defs_before = _defs(page, base) or {}
    row["definitions_before"] = len(defs_before)

    # THE BASELINE IS THE SERVER'S INSTANCE SET, NOT THE DOM'S. A DOM baseline is
    # crosshair-gated (see `_hover_plot`), so an unhovered read returns zero and
    # every PRE-EXISTING indicator then looks new -- the diff would attribute
    # another script's chips to this one. The server blob answers the same
    # question with no cursor in it.
    instances_before = _instance_ids(page, base) or set()
    ids_before = sorted(instances_before)
    row["instances_before"] = len(ids_before)
    row["chips_before"] = len(chips_before)

    # WAIT FOR THE CONTROL, NEVER FOR A DURATION. Fixed sleeps passed on a warm
    # page and failed the first two runs of a cold one -- reported as
    # HARNESS_BLOCKED "no Import tab", which is a fact about the sleep, not the
    # product. Each step now waits for its own next control to exist.
    def wait_for_text_button(label, timeout=20000):
        page.wait_for_function(
            "(t) => [...document.querySelectorAll('button')]"
            ".some(b => b.offsetParent && b.innerText.trim() === t)",
            arg=label, timeout=timeout)

    if not timed("open_builder", lambda: page.evaluate(JS_OPEN_BUILDER)):
        row["result"] = "HARNESS_BLOCKED"
        row["detail"] = "no Indicators button"
        return row
    try:
        page.wait_for_function(
            "() => [...document.querySelectorAll('*')].some(e => e.offsetParent"
            " && e.children.length < 4 && /^\\s*New formula/i.test(e.textContent || ''))",
            timeout=20000)
    except Exception:
        row["result"] = "HARNESS_BLOCKED"
        row["detail"] = "New formula never appeared"
        return row
    if not timed("new_formula", lambda: page.evaluate(JS_NEW_FORMULA)):
        row["result"] = "HARNESS_BLOCKED"
        row["detail"] = "no New formula"
        return row
    try:
        wait_for_text_button("Import")
    except Exception:
        row["result"] = "HARNESS_BLOCKED"
        row["detail"] = "Import tab never appeared"
        return row
    if not timed("import_tab", lambda: page.evaluate(JS_IMPORT_TAB)):
        row["result"] = "HARNESS_BLOCKED"
        row["detail"] = "no Import tab"
        return row
    try:
        page.wait_for_function(
            "() => [...document.querySelectorAll('textarea')]"
            ".some(t => /@version/.test(t.placeholder || ''))", timeout=20000)
    except Exception:
        row["result"] = "HARNESS_BLOCKED"
        row["detail"] = "paste box never appeared"
        return row

    if not timed("paste", lambda: page.evaluate(JS_PASTE, source)):
        row["result"] = "HARNESS_BLOCKED"
        row["detail"] = "no paste textarea"
        return row

    # WAIT ON IDENTITY, NOT READINESS. Waiting for Apply to be ENABLED clicked it
    # while the PREVIOUS script's report was still live, and one script silently
    # applied another's presentation. The report must name THIS script.
    title_frag = source.split('indicator(')[1].split('"')[1][:18] if 'indicator("' in source else None
    s = time.time()
    try:
        if title_frag:
            page.wait_for_function(
                "(frag) => { const e = document.querySelector('[data-testid=pine-meta]');"
                " return !!e && e.innerText.includes(frag); }",
                arg=title_frag, timeout=25000)
    except Exception:
        row["result"] = "IMPORT_BLOCKED"
        row["detail"] = f"report never named {title_frag!r}: {page.evaluate(JS_META)[:120]}"
        return row
    t["translate"] = round((time.time() - s) * 1000)

    # IDENTITY FIRST, *THEN* READINESS -- in that order, and both are needed.
    # Waiting only for ENABLED clicked Apply while the previous script's report was
    # still live. Waiting only for IDENTITY clicked before `chosen`/`active`
    # settled on the next render, and reported "Apply never became enabled" for
    # eight scripts that were perfectly importable -- a fact about the harness.
    try:
        page.wait_for_function(
            "() => { const u = document.querySelector('[data-testid=pine-use]');"
            " return !!u && !u.disabled; }", timeout=20000)
    except Exception:
        row["result"] = "IMPORT_BLOCKED"
        row["detail"] = "Apply never became enabled"
        row["refusal"] = page.evaluate(
            "() => { const e = document.querySelector('[data-testid=pine-refusal]');"
            " return e ? e.innerText.replace(/\\s+/g,' ').slice(0,160) : null; }")
        return row
    if not timed("apply", lambda: page.evaluate(JS_APPLY)):
        row["result"] = "IMPORT_BLOCKED"
        row["detail"] = "Apply disabled at click time"
        return row
    # WHAT THE DOOR TOLD THE MEMBER, VERBATIM. C0.7 is about presentation the
    # product does not carry, and the only thing separating "carried it" from
    # "dropped it silently" is whether the report SAYS SO. Captured before Apply
    # clears it, so a later reading of this report can check the sentence rather
    # than infer the omission.
    row["import_report"] = page.evaluate(JS_META)[:600]
    page.wait_for_timeout(1200)
    row["builder"] = page.evaluate(JS_BUILDER_STATE)

    # -- save ----------------------------------------------------------------
    row["named"] = page.evaluate(JS_NAME, name[:40])
    page.wait_for_timeout(600)
    row["repaint_ack"] = page.evaluate(JS_ACK_REPAINT)
    page.wait_for_timeout(400)
    row["save_state"] = page.evaluate(JS_SAVE_STATE)
    saved = timed("save_click", lambda: page.evaluate(JS_CLICK_SAVE))
    row["save_clicked"] = saved
    if not saved:
        # A BLOCKED SAVE IS A RESULT, NOT A GAP. It is reported with the gate the
        # product itself names, and the journey stops here rather than measuring a
        # reload that could not possibly show anything.
        st = row["save_state"]
        row["result"] = "SAVE_BLOCKED"
        row["detail"] = (st.get("hint") or st.get("formulaError")
                         or (st.get("plotProblems") or [None])[0]
                         or ("Save button not found" if not st.get("saveFound")
                             else "Save disabled, sheet gave no reason"))
        return row

    # The save is a network write; wait for its OUTCOME, not for a duration.
    s = time.time()
    stored_id, stored = None, None
    for _ in range(30):
        page.wait_for_timeout(500)
        after = _defs(page, base) or {}
        new_ids = set(after) - set(defs_before)
        if new_ids:
            stored_id = sorted(new_ids)[0]
            stored = after[stored_id]
            break
        err = page.evaluate(JS_STORE_ERROR)
        if err:
            row["result"] = "SAVE_FAILED"
            row["detail"] = err
            return row
    t["save_roundtrip"] = round((time.time() - s) * 1000)
    if not stored:
        row["result"] = "SAVE_FAILED"
        row["detail"] = "Save clicked but no new definition appeared in /api/user-definitions"
        return row
    row["def_id"] = stored_id
    row["stored"] = _doc_shape(stored)

    # -- wait for the INSTANCE to reach the server, then reload ---------------
    # See `_instance_ids` for why this is an artifact poll and not a sleep.
    s = time.time()
    new_instances = set()
    for _ in range(24):
        now = _instance_ids(page, base)
        if now is not None:
            new_instances = now - instances_before
            if new_instances:
                break
        page.wait_for_timeout(500)
    t["instance_persist"] = round((time.time() - s) * 1000)
    row["instance_persisted"] = sorted(new_instances)
    if not new_instances:
        # A REAL PRODUCT ANSWER, AND A DIFFERENT ONE FROM "IT DREW NOTHING".
        # `save()` only calls `addInstance` when it is handed `settings` AND
        # `onChange`; a door that saves the definition and never adds it to the
        # chart lands here, and it is worth its own name.
        row["result"] = "SAVED_NO_INSTANCE"
        row["detail"] = ("the definition persisted but no indicator instance was "
                         "written to the chart within 12s of Save")
        return row

    # -- reload and ask the chart what it is actually drawing -----------------
    s = time.time()
    blocked = _open_workspace(page, base)
    if blocked:
        row["result"] = "CHART_BLOCKED"
        row["detail"] = f"after save: {blocked}"
        return row
    t["reopen"] = round((time.time() - s) * 1000)

    chips_after, new_chips, waited, settled = _settled_chips(page, ids_before)
    t["render"] = waited
    row["render_settled"] = settled
    row["chips_after"] = len(chips_after)
    row["new_chips"] = new_chips

    # -- C0R §15: SAVE / REOPEN, compared field by field AND whole ------------
    # ⛔ THE WHOLE DOCUMENT, NOT A SUMMARY OF IT. A field-by-field check only
    # proves the fields somebody thought to name survived; comparing the stored
    # `definition` object to the one read back after the reload catches a field
    # nobody listed. The named shape is still reported, because "they differ" is
    # not a finding a reader can act on.
    after_defs = _defs(page, base) or {}
    row["persisted_defs"] = len(after_defs)
    reopened = after_defs.get(stored_id)
    row["reopened"] = _doc_shape(reopened) if reopened else None
    if reopened:
        before_doc = (stored or {}).get("definition")
        after_doc = reopened.get("definition")
        row["reopen_identical"] = (
            json.dumps(before_doc, sort_keys=True) == json.dumps(after_doc, sort_keys=True))
        if not row["reopen_identical"]:
            row["reopen_diff"] = [
                k for k in set(row["stored"]) | set(row["reopened"])
                if row["stored"].get(k) != row["reopened"].get(k)]
    else:
        row["reopen_identical"] = False
        row["reopen_diff"] = ["the definition is gone after reload"]

    out_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out_dir / f"{name}.png"), full_page=False)
    row["screenshot"] = str(out_dir / f"{name}.png")

    # -- the verdict, from three facts that can each fail on their own --------
    # `chip_plot_keys`, NOT `plot_keys` -- see `_doc_shape`. The levels guide is
    # a plot that is SUPPOSED to have no chip.
    declared = [k for k in (row["stored"]["chip_plot_keys"] or []) if k]
    drawn_keys = [c["plotKey"] for c in new_chips if not c["hidden"]]
    empty = [c["plotKey"] for c in new_chips if c["drewNothing"]]
    row["declared_plots"] = declared
    row["drawn_plots"] = drawn_keys
    row["empty_plots"] = empty
    if not new_chips:
        row["result"] = "SAVED_NOT_RENDERED"
        row["detail"] = ("the definition persisted but the chart drew no legend chip "
                         "for it after reload")
    elif empty:
        row["result"] = "CHART_PARTIAL"
        row["detail"] = f"{len(empty)}/{len(new_chips)} plot(s) computed nothing: {empty}"
    elif declared and sorted(set(drawn_keys)) != sorted(set(declared)):
        row["result"] = "CHART_PARTIAL"
        row["detail"] = f"declared {sorted(set(declared))} but drew {sorted(set(drawn_keys))}"
    elif not row["reopen_identical"]:
        # ⛔ ITS OWN OUTCOME. A document that draws but does not come back the
        # same is not a render failure and must not be counted as one — the
        # member loses their work on the next reload, which is a different and
        # worse thing than a plot that did not draw.
        row["result"] = "REOPEN_BLOCKED"
        row["detail"] = f"the reopened definition differs: {row.get('reopen_diff')}"
    else:
        row["result"] = "FULL_JOURNEY_PASS"

    # Leave the chart as we found it, so the next script's diff is honest.
    try:
        removed = page.evaluate(JS_REMOVE_INSTANCES,
                                sorted({c["instanceId"] for c in new_chips}))
        row["cleanup_removed"] = removed
        page.wait_for_timeout(800)
    except Exception as e:  # noqa: BLE001
        row["cleanup_removed"] = f"failed: {str(e)[:80]}"
    return row


def main():
    # THE PRODUCT'S OWN SENTENCES CONTAIN NON-CP1252 CHARACTERS. A refusal
    # carrying `->` as an arrow glyph killed the whole run at the print statement,
    # AFTER two fixtures had been measured and BEFORE anything was written to
    # disk -- so a real result was lost to a console codec. The measurement must
    # not be hostage to what a message happens to spell.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--fixtures", required=True)
    ap.add_argument("--out", default="tools/c0_out")
    ap.add_argument("--email", default=os.environ.get("C0_EMAIL", "gj_automation@local.dev"))
    ap.add_argument("--password", default=os.environ.get("C0_PASSWORD", "OosTest2026!"))
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    files = sorted(Path(args.fixtures).glob("*.pine"))
    if args.limit:
        files = files[:args.limit]
    if not files:
        sys.exit(f"no .pine fixtures under {args.fixtures}")

    out_dir = Path(args.out)
    report = {"base": args.base, "fixtures": str(args.fixtures), "rows": []}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={"width": 1600, "height": 900},
                                  reduced_motion="reduce")
        page = ctx.new_page()
        me = login(page, args.base, args.email, args.password)
        print(f"[ok] logged in as {me.get('user', {}).get('email')} "
              f"role={me.get('user', {}).get('role')} paid={me.get('paid_equiv')}")

        # DID THE CHART HAVE ANY DATA AT ALL? An empty bars feed makes EVERY
        # indicator draw nothing, and that failure would otherwise be booked
        # against the Pine importer -- a whole run of CHART_PARTIAL that says
        # nothing about the product under test. Recorded once, in the header, so
        # every row in this report can be read against it.
        try:
            br = page.request.get(f"{args.base}/api/bars/SPY?tf=D&bars=300")
            report["bars_probe"] = len((br.json() or {}).get("bars", [])) if br.ok else f"HTTP {br.status}"
        except Exception as e:  # noqa: BLE001
            report["bars_probe"] = f"error: {str(e)[:80]}"
        print(f"[ok] bars probe SPY/D: {report['bars_probe']}")
        for f in files:
            name = f.stem
            print(f"--- {name}")
            try:
                row = run_one(page, args.base, name, f.read_text(encoding="utf-8"), out_dir)
            except Exception as e:
                row = {"script": name, "result": "CHART_ERROR", "detail": str(e)[:300]}
            report["rows"].append(row)
            # WRITTEN AFTER EVERY ROW, NOT AT THE END. A crash on row three used
            # to discard rows one and two -- measurements that had already been
            # taken on the real page and cost a minute each.
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "report.json").write_text(json.dumps(report, indent=2),
                                                 encoding="utf-8")
            print(f"    {row.get('result')}  {row.get('detail','')}")
            print(f"    builder={json.dumps(row.get('builder'))}")
            print(f"    stored={json.dumps(row.get('stored'))}")
            print(f"    new_chips={json.dumps(row.get('new_chips'))}")
            print(f"    timings={json.dumps(row.get('timings_ms'))}")
        browser.close()

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    from collections import Counter
    c = Counter(r.get("result") for r in report["rows"])
    print("\n=== C0 VISUAL JOURNEY ===")
    for k, v in c.most_common():
        print(f"  {k}: {v}")
    print(f"wrote {out_dir / 'report.json'}")


if __name__ == "__main__":
    sys.exit(main())
