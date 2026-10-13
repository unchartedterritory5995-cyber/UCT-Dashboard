"""docs/notebook/screen-reader-pass.md, the NVDA half, driven -- and heard through NVDA's own
input/output log rather than a person's ears.

    python tools/notebook_nvda_pass.py --out docs/notebook/evidence/screen-reader/nvda-<stamp>.json
    python tools/notebook_nvda_pass.py --self-check

WHAT IT IS, HONESTLY. The pass script was written for a human listening to a real screen reader.
This drives the same rows -- 1 to 27 (the 2026-10-09 pass) and 28 to 38 (Journal styles, P1, and the
trader blocks, P2; added 2026-10-13, driven only while the server under test has the journal styles
switch on) -- with REAL OS key events (`SendInput`, so NVDA's keyboard hook sees
them; Playwright's CDP keys do not reach it) into a headed Chromium signed in as the synthetic
smoke account, and reads what NVDA SPOKE from its log at log level 12 (input/output), where every
utterance is a `Speaking [...]` line. A row PASSES when every quoted phrase in the script's
Expected column was spoken inside that row's window; otherwise it FAILS with the words NVDA did
say. It is a measurement of NVDA's speech output, not of a listener's comprehension; the
VoiceOver half needs a Mac and is recorded as not available, never as skipped silently.

⛔⛔ THE FOREGROUND GUARD IS THE WHOLE SAFETY OF THIS TOOL. `SendInput` types into whatever window
the OS has in front. On 2026-10-09 02:24 CT the first run sent 7 minutes of Tab, Enter, Space,
Ctrl+F, Ctrl+H and typed text into the OWNER'S Chrome, which was in front on a Cloudflare DNS
page: `page.bring_to_front()` raises a TAB inside its own browser and never touches the OS
foreground. So now: before EVERY key, the page's title is stamped with a per-run nonce, the OS
window carrying that nonce is found, its process image is checked to be Playwright's bundled
browser (never an installed Chrome), it is brought to the foreground, and `GetForegroundWindow()`
must equal it -- or no key is sent, the row is INCONCLUSIVE and the run stops (exit 2). An
unverifiable foreground is never a key.

⛔ WHO: the smoke account only (SMOKE_EMAIL / SMOKE_PASSWORD from the operator's environment; the
signed-in email is checked by domain before any write). ⛔ WHAT IT LEAVES: nothing. The two notes,
the folder and its subfolder, and the saved view it makes are removed in `finally`, and the record
carries the counts left behind. Row 26 (Share) is NOT RUN on purpose: it would mint a public link.
Rows 28-38 make their own fixtures, lazily, the first time a row that needs one runs (so `--only 28,...`
works alone): one note per trader block (`SR block ...`), the style `SR style`, the rule `SR rule wait
for the first hour` (switched to Before entry) in the account the browser selects, and -- only when the
account has no closed trade for the review picker -- a manual `ZZZT` trade. `finally` trashes the notes,
soft-deletes the style, dismisses the rule and hard-deletes the trade, and records what is left. With
the switch off or absent on `/api/auth/me`, rows 28-38 are NOT RUN and none of these is made.

⛔ NVDA must already be running with `-m --log-level=12 --log-file=<path>`; pass that path as
--nvda-log. The box's foreground is taken by the test browser for the run's length (~8 min).
⛔ QUIT NVDA IN TEARDOWN, FROM POWERSHELL: `& 'C:/Program Files/NVDA/nvda.exe' -q`. A Git Bash call
on that path answers "Permission denied" and `Stop-Process` from a bash-spawned PowerShell was
"Access is denied" (2026-10-09 r15), so NVDA kept narrating the owner's desktop until another
session killed it. Prefer starting it with `--config-path` at a config whose synth is `silence`:
the level-12 log still records every `Speaking [...]` line and nothing is read aloud.

R-RAW: the per-row record (every spoken line per row) is written to --out before the summary is
printed, and the NVDA speech lines of the run window are saved beside it (lines carrying an `@`
are dropped: a window title can carry an account's email). Exit: 0 every run row PASS, 1 a FAIL,
2 INCONCLUSIVE (not signed in, NVDA not logging, fixtures could not be made, foreground lost).
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wt
import datetime as dt
import json
import os
import pathlib
import re
import secrets
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

PROD = "https://uctintelligence.com"
SYNTHETIC_DOMAIN = "@uctintelligence.internal"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/128.0 Safari/537.36 uct-nvda-pass")
SETTLE_S = 2.5
PLAYWRIGHT_IMAGE_MARK = "ms-playwright"      # the bundled browser lives under this directory

# ── Win32 ────────────────────────────────────────────────────────────────────────────────────
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
PUL = ctypes.POINTER(ctypes.c_ulong)
WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
user32.GetForegroundWindow.restype = wt.HWND
user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
user32.SetForegroundWindow.argtypes = [wt.HWND]
user32.BringWindowToTop.argtypes = [wt.HWND]
user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
user32.IsWindowVisible.argtypes = [wt.HWND]
user32.GetWindowTextLengthW.argtypes = [wt.HWND]
user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.AttachThreadInput.argtypes = [wt.DWORD, wt.DWORD, wt.BOOL]
kernel32.OpenProcess.restype = wt.HANDLE
kernel32.QueryFullProcessImageNameW.argtypes = [wt.HANDLE, wt.DWORD, wt.LPWSTR, ctypes.POINTER(wt.DWORD)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort), ("dwFlags", ctypes.c_ulong),
                ("time", ctypes.c_ulong), ("dwExtraInfo", PUL)]


class INPUT(ctypes.Structure):
    class _I(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT), ("pad", ctypes.c_ubyte * 32)]
    _anonymous_ = ("i",)
    _fields_ = [("type", ctypes.c_ulong), ("i", _I)]


VK = {"tab": 0x09, "enter": 0x0D, "shift": 0x10, "ctrl": 0x11, "alt": 0x12, "escape": 0x1B,
      "space": 0x20, "end": 0x23, "home": 0x24, "left": 0x25, "up": 0x26, "right": 0x27,
      "down": 0x28, "insert": 0x2D, "f10": 0x79, "slash": 0xBF, "lbracket": 0xDB}

PROBE: dict = {}      # an action may leave a DOM reading here; the row records it beside the speech


def window_title(hwnd) -> str:
    if not hwnd:
        return ""
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def window_pid(hwnd) -> int:
    pid = wt.DWORD(0)
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def window_tid(hwnd) -> int:
    pid = wt.DWORD(0)
    return user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))


def process_image(pid: int) -> str:
    h = kernel32.OpenProcess(0x1000, False, pid)          # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    try:
        size = wt.DWORD(1024)
        buf = ctypes.create_unicode_buffer(size.value)
        return buf.value if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)) else ""
    finally:
        kernel32.CloseHandle(h)


def find_window(marker: str):
    found = []

    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd) and marker in window_title(hwnd):
            found.append(hwnd)
        return True
    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return found[0] if found else None


class ForegroundLost(RuntimeError):
    """Raised INSTEAD of sending a key. The message names the window that was in front."""


class Foreground:
    """The guard. `ensure()` before a sequence, `check()` before every key inside it."""

    def __init__(self, page, nonce: str):
        self.page, self.nonce, self.hwnd = page, nonce, None

    def _stamp(self):
        try:
            self.page.evaluate("m => { document.title = m }", f"UCT-NVDA-{self.nonce}")
        except Exception as e:  # noqa: BLE001
            raise ForegroundLost(f"could not stamp the page title: {e}")

    def ensure(self):
        self._stamp()
        hwnd = None
        for _ in range(20):
            hwnd = find_window(self.nonce)
            if hwnd:
                break
            time.sleep(0.1)
        if not hwnd:
            raise ForegroundLost("no visible window carries the run nonce")
        image = process_image(window_pid(hwnd))
        if PLAYWRIGHT_IMAGE_MARK not in image.lower():
            raise ForegroundLost(f"the nonce window is not Playwright's browser: {image!r}")
        self.hwnd = hwnd
        for attempt in range(4):
            if user32.GetForegroundWindow() == hwnd:
                return hwnd
            fg = user32.GetForegroundWindow()
            fg_tid, my_tid = (window_tid(fg) if fg else 0), kernel32.GetCurrentThreadId()
            attached = bool(fg_tid and fg_tid != my_tid and user32.AttachThreadInput(my_tid, fg_tid, True))
            if not fg:
                # No foreground window at all (idle desktop, display asleep): there is no thread to
                # attach to, and Windows only lets the LAST INPUT's process take the foreground. One
                # Alt tap makes that process ours; with no foreground window the tap reaches nothing.
                _key(VK["alt"]); time.sleep(0.03); _key(VK["alt"], up=True); time.sleep(0.1)
            try:
                user32.ShowWindow(hwnd, 9)                # SW_RESTORE
                user32.SetForegroundWindow(hwnd)
                user32.BringWindowToTop(hwnd)
            finally:
                if attached:
                    user32.AttachThreadInput(my_tid, fg_tid, False)
            time.sleep(0.4 + 0.3 * attempt)
        fg = user32.GetForegroundWindow()
        raise ForegroundLost(f"foreground is {window_title(fg)!r} (pid {window_pid(fg)}), not the test browser")

    def check(self):
        fg = user32.GetForegroundWindow()
        if self.hwnd is None or fg != self.hwnd:
            raise ForegroundLost(f"foreground moved to {window_title(fg)!r} mid-sequence; key withheld")


GUARD: Foreground | None = None


# ⛔ Arrows, Insert, Home and End are EXTENDED keys. Sent without KEYEVENTF_EXTENDEDKEY they arrive as
# the NUMPAD keys (r4's NVDA log: `kb(desktop):numpad2` for Down, `numpad6` for Right), which NVDA's
# desktop layout binds to its review cursor and swallows -- the page never saw an arrow, and rows 5, 9
# and 12 read NVDA spelling the row under its review cursor ("A", "notes") instead of the tree moving.
EXTENDED_VKS = {0x2D, 0x2E, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x21, 0x22}


def _key(vk: int, up: bool = False) -> None:
    # The scan code travels too: a browser derives KeyboardEvent.code from it, and the Journal's "?"
    # shortcut (react-hotkeys-hook) matches on code "Slash" -- a zero scan code reaches it as nothing.
    inp = INPUT(type=1)
    flags = (2 if up else 0) | (1 if vk in EXTENDED_VKS else 0)
    inp.ki = KEYBDINPUT(vk, user32.MapVirtualKeyW(vk, 0), flags, 0, None)
    user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))


def press(*keys: str, times: int = 1) -> None:
    """press('shift', 'tab'): modifiers held, the last key tapped, released in reverse.
    Every tap is preceded by the foreground check; a lost foreground withholds the key."""
    vks = [VK[k] if k in VK else ord(k.upper()) for k in keys]
    for _ in range(times):
        GUARD.check()
        for v in vks:
            _key(v); time.sleep(0.03)
        for v in reversed(vks):
            _key(v, up=True); time.sleep(0.03)
        time.sleep(0.15)


def type_text(s: str) -> None:
    for ch in s:
        GUARD.check()
        inp = INPUT(type=1)
        inp.ki = KEYBDINPUT(0, ord(ch), 4, 0, None)          # KEYEVENTF_UNICODE
        user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))
        inp.ki.dwFlags = 4 | 2
        user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))
        time.sleep(0.05)


# ── NVDA's log as the ear ────────────────────────────────────────────────────────────────────
def parse_speech(text: str) -> list[str]:
    """NVDA logs a speech sequence as a Python list repr. A string is written with single quotes --
    UNLESS it contains an apostrophe, when Python writes it with double quotes:
        Speaking [LangChangeCommand ('en_US'), 'row 1', "I couldn't find that in this note."]
    ⚰️ The first version of this parser read single-quoted strings only, so every utterance with an
    apostrophe was invisible to the grader: "I couldn't find that in this note." was graded as never
    spoken across seven runs (2026-10-09, row 19 of the pass) and a product defect was written up,
    fixed and deployed before the blind spot was found. Both quote styles are read now."""
    out = []
    for line in text.splitlines():
        if "Speaking" in line:
            parts = []
            for m in re.finditer(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"", line.split("Speaking", 1)[1]):
                p = m.group(1) if m.group(1) is not None else m.group(2)
                if p and p != "en_US":
                    parts.append(p)
            if parts:
                out.append(" ".join(parts))
    return out


class Ear:
    def __init__(self, log: pathlib.Path):
        self.log = log
        self.pos = log.stat().st_size if log.exists() else 0
        self.run_start = self.pos

    def version(self) -> str | None:
        m = re.search(r"Starting NVDA version (\S+)", self.log.read_text("utf-8", "replace"))
        return m.group(1) if m else None

    def mark(self) -> None:
        self.pos = self.log.stat().st_size

    def heard(self) -> list[str]:
        return parse_speech(self.log.read_bytes()[self.pos:].decode("utf-8", "replace"))

    def run_speech(self) -> list[str]:
        data = self.log.read_bytes()[self.run_start:].decode("utf-8", "replace")
        return [ln for ln in data.splitlines() if "Speaking" in ln and "@" not in ln]


def grade(expected: list[str], heard: list[str]) -> tuple[str, str]:
    blob = " | ".join(heard).lower()
    missing = [e for e in expected if e.lower() not in blob]
    if not heard:
        return "FAIL", "NVDA spoke nothing in the window"
    if missing:
        return "FAIL", f"missing {missing!r}; heard: {' / '.join(heard)[:300]}"
    return "PASS", " / ".join(heard)[:300]


# ── Rows 28-38: Journal styles (P1) and the trader blocks (P2) ───────────────────────────────
# Every name below is read from the component source; docs/notebook/screen-reader-pass.md quotes the
# file:line for each row. ⛔ These surfaces exist only while NOTEBOOK_JOURNAL_STYLES_ENABLED is on for
# the server under test. The client learns it from the auth payload (api/routers/auth.py
# NOTEBOOK_FLAGS + _notebook_flags, the key below, on /api/auth/me) and latches only a BOOLEAN
# (lib/offline/notebookFlags.js flagValue), so this reads the same key the same way.
STYLES_FLAG_KEY = "notebook_journal_styles_enabled"
SR_STYLE_NAME = "SR style"
SR_RULE_LABEL = "SR rule wait for the first hour"      # no apostrophe: the name below quotes it in ''
SR_SETUP = "SR setup"
SR_TRADE_SYMBOL = "ZZZT"
CHART_LABEL = "Chart of the note’s ticker"          # lib/journalBlocks.js:10 -- a TYPOGRAPHIC apostrophe
CHECKLIST_LABEL = "Pre-entry checklist"                  # lib/journalBlocks.js:17
TIMEFRAME_NAME = f"Timeframe for {CHART_LABEL}"          # StyleEditor.jsx:276 `${s.label} for ${label}`
MOVE_UP_NAME = f"Move {CHECKLIST_LABEL} up"              # StyleEditor.jsx:282 `Move ${label} up`
CHANGE_SETUP_NAME = "Change setup"                       # blocks/PreEntryChecklistBlock.jsx:111-115
STAMP_NAME = "Stamp prices as I write"                   # blocks/PriceStampsBlock.jsx:24
RULE_EDIT_NAME = f"Edit '{SR_RULE_LABEL}'"               # blocks/MyRulesBlock.jsx:110, :149
ACTIVE_NAME = ("() => { const a = document.activeElement; if (!a) return 'none';"
               " const role = a.getAttribute('role') || (a.tagName === 'INPUT' ? 'input[' + a.type + ']' : a.tagName.toLowerCase());"
               " const name = a.getAttribute('aria-label') || (a.labels && a.labels[0] ? a.labels[0].textContent.trim() : '')"
               " || a.textContent.trim().slice(0, 60);"
               " return 'activeElement ' + role + ' named ' + JSON.stringify(name) }")

#: n, keys, expected (every phrase must be spoken in the row's window), and `logged`: the strings NVDA
#: is expected to log for that focus, used ONLY by the self-check to walk the ear over each row's own
#: words written the way NVDA writes them (Python's repr). `logged` is never graded against.
P1P2_ROWS = (
    {"n": 28, "keys": "Notebook list (?view=all): focus Styles, Enter",
     "expected": ["Journal styles", "dialog"], "logged": ["Journal styles", "dialog"]},
    {"n": 29, "keys": f"in the manager, Enter on 'Edit {SR_STYLE_NAME}'; focus the second block row's move-up control",
     "expected": [MOVE_UP_NAME, "button"], "logged": [MOVE_UP_NAME, "button"],
     "note": "(the brief's 'Move up' is the control's title tooltip; its accessible name is 'Move <block> up')"},
    {"n": 30, "keys": f"in the manager, Enter on 'Edit {SR_STYLE_NAME}'; focus the chart row's timeframe",
     "expected": [TIMEFRAME_NAME, "combo box"], "logged": [TIMEFRAME_NAME, "combo box", "Daily"],
     "note": "(a typographic apostrophe, U+2019, in the name)"},
    {"n": 31, "keys": f"open the note 'SR block checklist'; focus '{CHANGE_SETUP_NAME}' (inside the block's groups)",
     "expected": [CHECKLIST_LABEL, "grouping"],
     "logged": [CHECKLIST_LABEL, "grouping", f"{CHECKLIST_LABEL} for {SR_SETUP}", "grouping", CHANGE_SETUP_NAME, "button"],
     "note": "(focus enters the block's group, BlockNodeView.jsx:76; the button's own name does not carry the phrase)"},
    {"n": 32, "keys": "same note: focus the before-entry rule's check box",
     "expected": [SR_RULE_LABEL, "check box", "not checked"],
     "logged": [f"{CHECKLIST_LABEL} for {SR_SETUP}", "grouping", SR_RULE_LABEL, "check box", "not checked"]},
    {"n": 33, "keys": "open the note 'SR block stamps'; focus the switch",
     "expected": [STAMP_NAME, "switch"], "logged": [STAMP_NAME, "switch", "off"]},
    {"n": 34, "keys": "open the note 'SR block sizing'; focus Entry",
     "expected": ["Entry", "spin button"], "logged": ["Entry", "spin button"],
     "note": "(the brief said 'edit'; Entry is an <input type=number>, a spin button; it is the Position sizing block's)"},
    {"n": 35, "keys": "same note: focus Setup grade",
     "expected": ["Setup grade", "combo box"], "logged": ["Setup grade", "combo box", "A"]},
    {"n": 36, "keys": "open the note 'SR block prep'; focus Capture now (never pressed)",
     "expected": ["Capture now", "button"], "logged": ["Capture now", "button"]},
    {"n": 37, "keys": "open the note 'SR block rules'; focus the rule's Edit",
     "expected": ["Edit", SR_RULE_LABEL, "button"], "logged": [RULE_EDIT_NAME, "button"],
     "note": "(its name is Edit '<the rule's words>', the label in ASCII quotes)"},
    {"n": 38, "keys": "open the note 'SR block review'; focus the trade picker",
     "expected": ["Trade to review", "combo box"], "logged": ["Trade to review", "combo box", "Pick a trade"]},
)


class FixtureUnavailable(RuntimeError):
    """A fixture a new row needs could not be made through the API. The row is INCONCLUSIVE, no key sent."""


def journal_styles_off(me, base: str) -> str | None:
    """None when /api/auth/me says the journal styles switch is on; else the NOT RUN reason.
    Only a boolean True is ON (the client latches booleans only): absent, False, a string, a
    malformed payload all answer off, and absent says it is absent."""
    if not isinstance(me, dict) or STYLES_FLAG_KEY not in me:
        return f"journal styles switch is off on {base} (/api/auth/me carries no {STYLES_FLAG_KEY})"
    if me.get(STYLES_FLAG_KEY) is True:
        return None
    return f"journal styles switch is off on {base}"


def block_kinds(path: pathlib.Path | None = None) -> dict:
    """journal_styles.BLOCK_KINDS, read by AST from the server file (never imported: importing it binds
    auth_db), as {block id: {"search": str|None, "defaults": {key: default}}}. The ONE source of a
    trader block node's `searchText` and settings defaults here; nothing is retyped."""
    import ast
    path = path or pathlib.Path(__file__).resolve().parents[1] / "api" / "services" / "journal_two" / "journal_styles.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        target = node.target if isinstance(node, ast.AnnAssign) else (node.targets[0] if isinstance(node, ast.Assign) else None)
        if isinstance(target, ast.Name) and target.id == "BLOCK_KINDS" and node.value is not None:
            kinds = ast.literal_eval(node.value)
            return {k["id"]: {"search": k.get("search"), "defaults": {s["key"]: s["default"] for s in k.get("settings", ())}}
                    for k in kinds}
    raise LookupError(f"BLOCK_KINDS not found in {path}")


def block_node(widget_id: str, params: dict, kinds: dict) -> dict:
    """A trader block node exactly as trader_blocks._node builds it (api/services/journal_two/
    trader_blocks.py:32-39): a widgetEmbed whose widgetId is the block id, searchText from the catalog."""
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": widget_id, "embedId": secrets.token_hex(16), "mode": "snapshot", "params": params,
        "capturedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "annotations": [], "caption": None, "layout": {"width": "full", "height": None}, "fallback": None,
        "searchText": kinds[widget_id]["search"]}}


def block_params(widget_id: str, kinds: dict) -> dict:
    """The params a new note's block carries, as trader_blocks.BUILDERS shape them (trader_blocks.py),
    with the defaults read from the catalog. Two departures, both so the row has its control: the
    checklist gets a setup (an empty one lists nothing), and the prep block is the uncaptured shape
    ("update" mode, :740-741) so it offers Capture now instead of holding a snapshot."""
    d = kinds[widget_id]["defaults"]
    return {
        "preEntryChecklist": lambda: {"setup": SR_SETUP, "includeRules": d.get("includeRules", "yes"),
                                      "requireAll": d.get("requireAll", "no"), "checked": []},   # :46-49
        "priceStamps": lambda: {"on": d.get("on", "no")},                                        # :52-53
        "positionSizing": lambda: {"grade": d.get("grade", "A")},                                # :72, unstamped
        "myRules": lambda: {},                                                                   # :100-101
        "prepWire": lambda: {},                                                                  # :740-741
        "tradeReview": lambda: {"tradeId": ""},                                                  # :102
    }[widget_id]()


def self_check() -> int:
    """Controls: the grader can fail and can pass; the ear parses NVDA's line shape; the guard
    REFUSES when no window carries the nonce (no key could ever go anywhere)."""
    fails = []
    if grade(["Skip to notes list", "link"], ["Skip to notes list link"])[0] != "PASS":
        fails.append("grade: a heard phrase did not PASS")
    if grade(["Skip to notes list"], ["column 3 Sort by Name button"])[0] != "FAIL":
        fails.append("grade: a foreign utterance did not FAIL")
    if grade(["x"], [])[0] != "FAIL":
        fails.append("grade: silence did not FAIL")
    line = ("IO - speech.speech.speak (02:24:50.302) - MainThread (8976):\n"
            "Speaking [LangChangeCommand ('en_US'), 'row 1', 'column 1', 'Select All', 'check box', 'not checked']")
    if parse_speech(line) != ["row 1 column 1 Select All check box not checked"]:
        fails.append(f"parse_speech: {parse_speech(line)!r}")

    # Rows 28-38. (a) The switch reader: NOT RUN unless /api/auth/me carries a boolean True.
    base = "https://example.invalid"
    off = f"journal styles switch is off on {base}"
    for me, want_off in (({}, True), (None, True), ({STYLES_FLAG_KEY: False}, True), ({STYLES_FLAG_KEY: "true"}, True),
                         ({STYLES_FLAG_KEY: 1}, True), ({STYLES_FLAG_KEY: True}, False)):
        why = journal_styles_off(me, base)
        if want_off and not (isinstance(why, str) and why.startswith(off)):
            fails.append(f"journal_styles_off({me!r}) did not answer NOT RUN: {why!r}")
        if not want_off and why is not None:
            fails.append(f"journal_styles_off({me!r}) refused an ON switch: {why!r}")
    if "carries no" not in (journal_styles_off({}, base) or ""):
        fails.append("journal_styles_off: an ABSENT key did not say it was absent")
    # (b) The rows are 28..38, once each, every one with something to hear.
    nums = [r["n"] for r in P1P2_ROWS]
    if nums != list(range(28, 39)):
        fails.append(f"P1P2_ROWS numbers: {nums!r}")
    for r in P1P2_ROWS:
        if not r["expected"] or not all(isinstance(e, str) and e for e in r["expected"]):
            fails.append(f"row {r['n']}: empty expected")
        # (c) The ear walked over each row's own words, written as NVDA writes them (Python's repr:
        # single quotes, DOUBLE quotes when the string holds an apostrophe -- row 37's name does).
        logged = "Speaking [LangChangeCommand ('en_US'), " + ", ".join(repr(s) for s in r["logged"]) + "]"
        verdict, why = grade(r["expected"], parse_speech(logged))
        if verdict != "PASS":
            fails.append(f"row {r['n']}: the ear cannot hear its own expected words: {why}")
    if "’" not in TIMEFRAME_NAME or "'" in TIMEFRAME_NAME:
        fails.append(f"row 30's name lost its typographic apostrophe: {TIMEFRAME_NAME!r}")
    # (d) The block catalog is READ from the server file, and holds the six blocks the rows build.
    try:
        kinds = block_kinds()
        for wid in ("preEntryChecklist", "priceStamps", "positionSizing", "myRules", "prepWire", "tradeReview"):
            node = block_node(wid, block_params(wid, kinds), kinds)
            if not (isinstance(node["attrs"]["searchText"], str) and node["attrs"]["searchText"].startswith("[")):
                fails.append(f"block_kinds: no catalog search line for {wid}: {node['attrs']['searchText']!r}")
        if kinds["preEntryChecklist"]["defaults"] != {"includeRules": "yes", "requireAll": "no"}:
            fails.append(f"block_kinds: preEntryChecklist defaults {kinds['preEntryChecklist']['defaults']!r}")
    except Exception as e:  # noqa: BLE001
        fails.append(f"block_kinds: {type(e).__name__}: {e}")

    class _NoPage:
        def evaluate(self, *_a, **_k):
            return None
    g = Foreground(_NoPage(), secrets.token_hex(8))
    try:
        g.ensure()
        fails.append("guard: ensure() did not refuse with no nonce window")
    except ForegroundLost:
        pass
    try:
        g.check()
        fails.append("guard: check() did not refuse before ensure()")
    except ForegroundLost:
        pass
    # the image check: the window in front right now is NOT Playwright's browser, so a guard
    # pointed at it must refuse on the image even if it carries the nonce
    fg = user32.GetForegroundWindow()
    if fg and PLAYWRIGHT_IMAGE_MARK in process_image(window_pid(fg)).lower():
        print("self-check: skipped the image control (a Playwright browser is in front)")
    for f in fails:
        print("SELF-CHECK FAIL:", f)
    print("self-check:", "OK" if not fails else f"{len(fails)} failures")
    return 1 if fails else 0


# ── The fixtures the script's preconditions ask for ──────────────────────────────────────────
def _para(text: str) -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def _cell(kind: str, text: str) -> dict:
    return {"type": kind, "content": [_para(text)]}


SR_BODY = {"type": "doc", "content": [
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Setup"}]},
    _para("A pullback to the 10-day with the stop under the last swing low."),
    {"type": "table", "content": [
        {"type": "tableRow", "content": [_cell("tableHeader", "Sym"), _cell("tableHeader", "R"), _cell("tableHeader", "Note")]},
        {"type": "tableRow", "content": [_cell("tableCell", "ZZZT"), _cell("tableCell", "2.1"), _cell("tableCell", "clean base")]},
        {"type": "tableRow", "content": [_cell("tableCell", "QQXZ"), _cell("tableCell", "1.4"), _cell("tableCell", "late")]},
    ]},
]}


class RunAborted(Exception):
    pass


def main(argv=None) -> int:
    global GUARD
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--nvda-log", default=str(pathlib.Path(os.environ.get("TEMP", ".")) / "nvda-probe.log"))
    ap.add_argument("--base", default=PROD)
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--only", default="", help="comma list of row numbers to drive; the rest are recorded SKIPPED")
    a = ap.parse_args(argv)
    only = {s.strip() for s in a.only.split(",") if s.strip()}
    if a.self_check:
        return self_check()
    if not a.out:
        ap.error("--out is required")
    out = pathlib.Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    ear = Ear(pathlib.Path(a.nvda_log))
    if not ear.log.exists():
        print("INCONCLUSIVE: NVDA log not found (start nvda -m --log-level=12 --log-file=...)"); return 2
    nvda_version = ear.version()

    email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
    if not (email and pw and email.endswith(SYNTHETIC_DOMAIN)):
        print("INCONCLUSIVE: no synthetic credentials"); return 2

    from playwright.sync_api import sync_playwright
    rows: list[dict] = []
    made = {"notes": [], "folders": [], "views": [], "styles": [], "rules": [], "trades": []}
    nonce = secrets.token_hex(6)
    rec = {"started": dt.datetime.now().isoformat(timespec="seconds"), "nvda_version": nvda_version,
           "base": a.base, "nonce": nonce, "rows": rows, "made": made, "aborted": None}

    def write():
        out.write_text(json.dumps(rec, indent=1), encoding="utf-8")

    def row(num, keys, expected, action, note=None):
        """Run one script row: guard, mark the ear, act, settle, grade, record."""
        if only and str(num) not in only:
            rows.append({"n": num, "keys": keys, "expected": expected, "result": "SKIPPED", "notes": "--only", "heard": []})
            write(); return
        try:
            GUARD.ensure()
        except ForegroundLost as e:
            rows.append({"n": num, "keys": keys, "expected": expected, "result": "INCONCLUSIVE",
                         "notes": f"no key sent: {e}", "heard": []})
            rec["aborted"] = f"row {num}: {e}"; write()
            raise RunAborted(str(e))
        ear.mark()
        try:
            action()
        except ForegroundLost as e:
            rows.append({"n": num, "keys": keys, "expected": expected, "result": "INCONCLUSIVE",
                         "notes": f"keys withheld mid-row: {e}", "heard": ear.heard()})
            rec["aborted"] = f"row {num}: {e}"; write()
            raise RunAborted(str(e))
        except Exception as e:  # noqa: BLE001
            rows.append({"n": num, "keys": keys, "expected": expected, "result": "FAIL",
                         "notes": f"driver error: {type(e).__name__}: {e}"[:300], "heard": ear.heard()})
            write(); print(f"  FAIL {num!s:>3}  driver error: {type(e).__name__}"); return
        time.sleep(SETTLE_S)
        heard = ear.heard()
        result, notes = grade(expected, heard)
        probe = PROBE.pop("txt", None)
        rows.append({"n": num, "keys": keys, "expected": expected, "result": result,
                     "notes": (note + " " if note else "") + notes, "heard": heard, "dom": probe})
        write()
        print(f"  {result:4} {num!s:>3}  {notes[:110]}")

    def not_run(num, keys, expected, why):
        rows.append({"n": num, "keys": keys, "expected": expected, "result": "NOT RUN", "notes": why, "heard": []})
        write(); print(f"  N/R  {num!s:>3}  {why[:110]}")

    with sync_playwright() as p:
        b = p.chromium.launch(headless=False, args=["--force-renderer-accessibility", "--window-size=1400,900"])
        ctx = b.new_context(user_agent=UA, viewport={"width": 1400, "height": 850})
        req = ctx.request
        r = req.post(f"{a.base}/api/auth/login", data={"email": email, "password": pw}, timeout=120_000)
        if r.status != 200:
            print("INCONCLUSIVE: login", r.status); b.close(); return 2
        me = req.get(f"{a.base}/api/auth/me").json()
        who = (me.get("user") or {}).get("email", "")
        if not who.endswith(SYNTHETIC_DOMAIN):
            print("REFUSED: not the synthetic account"); b.close(); return 2
        # Rows 28-38 run only while the server under test has the journal styles switch on.
        styles_off = journal_styles_off(me, a.base)
        rec["journal_styles"] = "on" if styles_off is None else styles_off
        page = ctx.new_page()
        GUARD = Foreground(page, nonce)
        code = 0
        try:
            def post(path, body):
                rr = req.post(f"{a.base}{path}", data=json.dumps(body), headers={"Content-Type": "application/json"})
                return rr.status, (rr.json() if rr.status < 300 else rr.text())
            st, j = post("/api/j2/notes", {"title": "SR pass", "bodyJson": SR_BODY, "tags": ["srpass"]})
            if st != 200:
                st, j = post("/api/j2/notes", {"title": "SR pass", "bodyJson": SR_BODY})
            if st != 200:
                print("INCONCLUSIVE: could not create the SR pass note:", st, str(j)[:200]); return 2
            sr_id = (j.get("note") or j)["id"]; made["notes"].append(sr_id)
            st, j = post("/api/j2/notes", {"title": "SR target note", "bodyJson": {"type": "doc", "content": [_para("The note a [[link]] can point at.")]}})
            if st == 200:
                made["notes"].append((j.get("note") or j)["id"])
            st, j = post("/api/j2/note-folders", {"name": "SR folder"})
            folder_id = (j.get("folder") or j).get("id") if st == 200 else None
            if folder_id:
                made["folders"].append(folder_id)
                st, j = post("/api/j2/note-folders", {"name": "SR subfolder", "parentId": folder_id})
                if st == 200:
                    made["folders"].insert(0, (j.get("folder") or j).get("id"))
            st, j = post("/api/j2/saved-views", {"name": "SR view", "viewType": "list", "spec": {}})
            if st == 200:
                made["views"].append((j.get("savedView") or j).get("id"))
            write()

            page.goto(f"{a.base}/journal/notebook", wait_until="domcontentloaded")
            for _ in range(40):
                page.keyboard.press("Escape")
                if page.locator("[data-ask-toggle], h2:has-text('Welcome to your Notebook')").count():
                    break
                time.sleep(1)
            page.goto(f"{a.base}/journal/notebook?view=all", wait_until="domcontentloaded")
            time.sleep(4)
            lv = page.get_by_role("button", name="List view", exact=True)
            if lv.count() and lv.first.get_attribute("aria-pressed") != "true":
                lv.first.click(); time.sleep(1.5)
            try:
                GUARD.ensure(); time.sleep(2.5)             # NVDA announces the window once, before row 1
            except ForegroundLost as e:
                # No window could be made the foreground at all (a locked session reads as foreground
                # '' pid 0). Nothing was sent; the run is INCONCLUSIVE, not a traceback.
                rec["aborted"] = f"setup: {e}"; write()
                raise RunAborted(str(e))

            def focus_role(role, name, exact=True, nth=0):
                page.get_by_role(role, name=name, exact=exact).nth(nth).focus()

            def blur():
                page.evaluate("() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0,0) }")

            def focus_mode():
                """NVDA Insert+Space toggles browse/focus mode; read what it said and land on FOCUS mode.
                Arrow-driven widgets (the folder tree, the list tool bar) only get arrow keys in focus mode."""
                pos = ear.log.stat().st_size
                press("insert", "space"); time.sleep(1.2)
                said = " ".join(parse_speech(ear.log.read_bytes()[pos:].decode("utf-8", "replace"))).lower()
                if "browse mode" in said:
                    press("insert", "space"); time.sleep(1.2)

            def _dom(sel):
                try:
                    return page.locator(sel).count()
                except Exception:  # noqa: BLE001
                    return -1

            row(1, "Tab", ["Skip to notes list", "link"], lambda: (blur(), time.sleep(0.5), press("tab")))
            row(2, "Enter", ["All notes", "heading"], lambda: press("enter"))
            row(3, "focus Hide folders panel, Tab", ["Hide folders panel", "button", "Panel view", "tab"],
                lambda: (focus_role("button", "Hide folders panel"), time.sleep(1.2), press("tab")))
            # F3 (fixed 2026-10-09, lib/useTreeRoving.js): focus that lands on a BUTTON inside a tree
            # row is moved onto the treeitem itself, so the focused element is the treeitem and NVDA
            # switches to focus mode on its own. Row 4 focuses the button the way the first pass did
            # (programmatically, as an AT or a pointer press can) and records where focus ended up.
            ACTIVE_ROLE = "() => { const a = document.activeElement; return a ? (a.getAttribute('role') || a.tagName.toLowerCase()) : 'none' }"
            def _all_notes():
                focus_role("button", re.compile(r"^All notes"), exact=False); time.sleep(1)
                PROBE["txt"] = f"DOM: after focusing the All notes button, activeElement role is {page.evaluate(ACTIVE_ROLE)!r}"
            row(4, "focus the All notes row", ["All notes"], _all_notes,
                note="(F3: the button hands focus to its treeitem; NVDA names the row, not a button)")
            # The folder sidebar is a roving TREE (lib/useTreeRoving.js): a folder is a treeitem, the
            # buttons inside it are tabIndex -1, arrows move, Right expands, Shift+F10 opens its menu.
            # The script's "Tab to its disclosure" / "Tab along its row" predates that tree.
            def _to_folder():
                focus_role("button", re.compile(r"^All notes"), exact=False); time.sleep(1)
                # F3: NO Insert+Space here. With focus on the treeitem NVDA is already in focus mode;
                # toggling would put it BACK into browse mode and send the arrows to the review cursor.
                role_before = page.evaluate(ACTIVE_ROLE)
                for _ in range(6):                        # Down until the SR folder row is the one announced
                    pos = ear.log.stat().st_size
                    press("down"); time.sleep(1.2)
                    if "sr folder" in " ".join(parse_speech(ear.log.read_bytes()[pos:].decode("utf-8", "replace"))).lower():
                        break
                press("right"); time.sleep(0.8)
                PROBE["txt"] = f"DOM: focus role before arrows {role_before!r}; after Down/Right {page.evaluate(ACTIVE_ROLE)!r}"
            row(5, "on All notes: Down until SR folder, Right (expand) -- no Insert+Space", ["SR folder", "collapsed", "expanded"], _to_folder,
                note="(F3 re-check: the arrows must work with no mode toggle; a focused treeitem puts NVDA in focus mode by itself)")
            row(6, "Enter on the SR folder row, then Shift+F10 (its menu), Escape", ["SR folder", "Rename", "Add subfolder", "Delete"],
                lambda: (press("enter"), time.sleep(1.2), press("shift", "f10"), time.sleep(1.5), press("down"), time.sleep(0.8), press("down"), time.sleep(0.8), press("escape")),
                note="(script says Tab along the row to Rename/Add subfolder/Delete; those are tabIndex -1 and reached by Shift+F10)")
            row(7, "focus the tag row", ["srpass", "button"],
                lambda: focus_role("button", re.compile(r"srpass"), exact=False))
            row(8, "focus the Saved Views disclosure; focus SR view", ["Saved Views", "button", "SR view"],
                lambda: (focus_role("button", re.compile(r"^(Expand|Collapse) Saved Views$"), exact=False), time.sleep(1.2),
                         focus_role("button", re.compile(r"^SR view"), exact=False)),
                note="(the section opens expanded, so its disclosure reads Collapse, not Expand)")
            # "Notes list tools" is a tool bar with one Tab stop: arrows move between its controls.
            row(9, "Enter on All notes (clears the view); focus Sort notes; Right (List view); Right (Table view); Space",
                ["Sort notes", "combo box", "List view", "pressed", "Table view"],
                lambda: (focus_role("button", re.compile(r"^All notes"), exact=False), time.sleep(1), press("enter"), time.sleep(1.2),
                         focus_role("combobox", "Sort notes"), time.sleep(1.5), press("right"), time.sleep(1), press("right"), time.sleep(1), press("space")),
                note="(script says Tab to the view switcher; the tool bar is arrow-driven; NVDA enters focus mode by itself on the combo box)")

            def _open_sr():
                # Under --only the rows before this one may not have run, so the list can still be
                # filtered to a folder (row 6 opens the SR folder). Clear it first: All notes, Enter.
                focus_role("button", re.compile(r"^All notes"), exact=False); time.sleep(1); press("enter"); time.sleep(1.5)
                focus_role("button", "List view"); press("space"); time.sleep(1.5)
                card = page.get_by_role("button", name=re.compile(r"^SR pass"), exact=False)
                if not card.count():
                    card = page.get_by_text("SR pass", exact=True)
                card.first.focus(); time.sleep(1); press("enter")
            row(10, "Back to List; focus the SR pass card; Enter", ["SR pass", "heading"], _open_sr)
            def _tabs():
                # F2 (fixed 2026-10-09): the Table tool bar is ONE Tab stop, so the count from the
                # heading to the body is measured, not assumed (it was 29 with twelve table stops).
                in_body = "() => !!(document.activeElement && document.activeElement.closest('.ProseMirror'))"
                tabs = 0
                while tabs < 40 and not page.evaluate(in_body):
                    press("tab"); tabs += 1; time.sleep(0.45)
                where = page.evaluate("() => { const a = document.activeElement; return a ? (a.getAttribute('aria-label') || a.textContent.trim().slice(0, 40) || a.tagName) : 'none' }")
                PROBE["txt"] = f"DOM: {tabs} Tabs from the heading to the body (was 29 before F2); focus ended on {where!r}"
            row(11, "Tab until the body (count measured)", ["Subtitle", "Editor toolbar", "Table", "Note body"], _tabs,
                note="(F2 re-check: the Table tool bar must be heard ONCE and cost one Tab; the count is in the DOM note)")
            row(12, "Insert+Space (browse mode), H, T, Down, Right", ["Setup", "heading", "table", "Sym"],
                lambda: (press("insert", "space"), time.sleep(1), press("h"), time.sleep(1), press("t"), time.sleep(1), press("down"), press("right")))
            row("12b", "Insert+Space (focus mode); Tab, Tab, Alt+F10, Escape", ["Table", "tool bar"],
                lambda: (press("insert", "space"), time.sleep(1), press("tab"), press("tab"), time.sleep(0.5), press("alt", "f10"), time.sleep(1.2), press("escape")))

            def _slash():
                page.locator(".ProseMirror").first.focus(); time.sleep(0.8)
                press("ctrl", "end"); time.sleep(0.5); press("enter"); time.sleep(0.5)
                type_text("/"); time.sleep(1); press("down")
            row(13, "end of body, Enter, /, Down", ["Insert block"], _slash)
            row(14, "Escape", ["Note body"], lambda: press("escape"), note="(expects the body's name back, nothing else)")
            def _link():
                press("enter"); time.sleep(0.5)           # a fresh line: the [[ trigger needs a space or line start before it (r5: "/[[SR" never opened)
                press("lbracket"); press("lbracket"); time.sleep(1.2)
                type_text("SR"); time.sleep(3)          # no space: the suggestion closes on one (r3)
                PROBE["txt"] = (f"DOM after typing: listbox 'Link to a note' x{_dom('[role=listbox][aria-label=\"Link to a note\"]')}, "
                                f"options x{_dom('[role=listbox][aria-label=\"Link to a note\"] [role=option]')}, "
                                f"body aria-expanded={page.locator('.ProseMirror').first.get_attribute('aria-expanded')!r}")
                press("down"); time.sleep(0.5); press("enter")
            row(15, "[ [ (real keys), type SR, Down, Enter", ["Link to a note", "SR target"], _link)
            row(16, "Ctrl+F, type stop", ["Find in note"], lambda: (press("ctrl", "f"), time.sleep(1), type_text("stop")))

            def _replace():
                press("ctrl", "h"); time.sleep(1.5)
                PROBE["txt"] = (f"DOM after Ctrl+H: 'Hide replace' x{_dom('[aria-label=\"Hide replace\"]')}, "
                                f"'Replace with' x{_dom('[aria-label=\"Replace with\"]')}, "
                                f"'Show replace' x{_dom('[aria-label=\"Show replace\"]')}")
                press("tab", times=7); time.sleep(1); press("escape")
            row(17, "Ctrl+H, Tab x7 (to the replace field), Escape", ["Replace with", "Note body"], _replace,
                note="(script says one Tab; from the find box the order is Match case, Whole word, Previous, Next, then the replace row)")
            row(18, "focus Ask, Enter", ["Ask this note", "Your question"],
                lambda: (focus_role("button", "Ask this note"), time.sleep(1), press("enter")))

            def _ask():
                type_text("What is the dividend?"); press("enter")
                page.wait_for_function("() => { const a = document.querySelector('[data-testid=\"ask-answer\"]'); return a && a.getAttribute('aria-busy') !== 'true' && a.textContent.trim().length > 0 }", timeout=90_000)
                time.sleep(3)
                ans = page.locator('[data-testid="ask-answer"]').first
                PROBE["txt"] = (f"DOM: answer present, aria-live={ans.get_attribute('aria-live')!r}, aria-busy={ans.get_attribute('aria-busy')!r}, "
                                f"text={ans.text_content().strip()[:140]!r}")
            row(19, "type a question the note cannot answer, Enter, wait", ["find", "note"], _ask,
                note="(the sentence is read from a live region; its exact words are the service's)")
            row(20, "focus Close Ask, Enter", ["Ask this note", "button"],
                lambda: (focus_role("button", "Close Ask"), time.sleep(1), press("enter")))

            def _graph():
                page.goto(f"{a.base}/journal/notebook?view=all", wait_until="domcontentloaded"); time.sleep(4)
                GUARD.ensure(); time.sleep(1)
                focus_role("button", "Graph view"); time.sleep(1); press("space"); time.sleep(2.5)
                focus_role("button", "Show as list"); time.sleep(1); press("space")
            row(21, "list; Graph view; Show as list, Space", ["Graph view", "Show as list", "pressed"], _graph)

            def _canvas():
                press("space"); time.sleep(2)
                page.get_by_role("application").first.focus(); time.sleep(1.2); press("home"); time.sleep(1); press("right")
            row(22, "Space; focus the canvas; Home; Right", ["Note graph", "notes", "link"], _canvas)

            def _save_view():
                focus_role("button", "List view"); press("space"); time.sleep(1.5)
                focus_role("button", "Save view"); time.sleep(1); press("enter"); time.sleep(1.5); press("escape")
            row(23, "List; Save view, Enter, Escape", ["Save view", "dialog", "Name"], _save_view)

            def _delete():
                page.goto(f"{a.base}/journal/notebook?note={sr_id}", wait_until="domcontentloaded"); time.sleep(5)
                GUARD.ensure(); time.sleep(1)
                # Delete lives inside the "More note actions" disclosure (NoteMoreMenu.jsx), not on the
                # Tab path the script describes. r2 matched the SIDEBAR's "Delete SR view" by prefix.
                focus_role("button", "More note actions"); time.sleep(1); press("enter"); time.sleep(1.5)
                page.get_by_role("button", name="Delete", exact=True).first.focus(); time.sleep(1); press("enter"); time.sleep(1.5)
                page.get_by_role("dialog").get_by_role("button", name="Delete", exact=True).first.focus(); time.sleep(0.8); press("enter")
            row(24, "open the note; More note actions, Enter; Delete, Enter; confirm Delete", ["Delete this note", "dialog"], _delete,
                note="(script says Tab to Delete; it sits in the More note actions disclosure)")

            def _home_empty():
                for nid in list(made["notes"]):
                    req.delete(f"{a.base}/api/j2/notes/{nid}")
                page.goto(f"{a.base}/journal/notebook", wait_until="domcontentloaded"); time.sleep(5)
                GUARD.ensure(); time.sleep(1)
                h = page.get_by_role("heading", name=re.compile(r"Welcome to your Notebook"))
                if h.count():
                    h.first.focus()
            row(25, "no notes: open the Notebook home; focus its heading", ["Welcome to your Notebook", "heading"], _home_empty)
            not_run(26, "Share, Enter, Tab, Escape", ["Share this note", "Share link address"],
                    "left to the owner: the step mints a public share link for a note on the smoke account")
            def _help():
                for _ in range(3):                       # r3: the onboarding tour's dialog was still open and ate the key
                    if _dom("[role=dialog]") <= 0:
                        break
                    press("escape"); time.sleep(1)
                blur(); time.sleep(0.5)                  # r5: a click landed in the home page's editor and "?" became a note
                page.evaluate("() => { window.__keys = []; document.addEventListener('keydown', e => window.__keys.push(e.key + '/' + e.code + (e.shiftKey ? '+shift' : ''))) }")
                press("shift", "slash"); time.sleep(1.5)
                first = f"keydowns seen by the page {page.evaluate('() => window.__keys')!r}, dialogs x{_dom('[role=dialog]')}"
                if _dom("[role=dialog]") <= 0:            # browse mode may have kept the key: say so, then try in focus mode
                    press("insert", "space"); time.sleep(1); press("shift", "slash"); time.sleep(1.5)
                    first += f"; after Insert+Space and ? again: keydowns {page.evaluate('() => window.__keys')!r}, dialogs x{_dom('[role=dialog]')}"
                PROBE["txt"] = f"DOM: {first}, 'Keyboard Shortcuts' text x{_dom('text=Keyboard Shortcuts')}"
            row(27, "? (Shift+/ as a real key) anywhere in the Journal", ["Keyboard Shortcuts", "dialog"], _help)

            # ── Rows 28-38 (2026-10-13): Journal styles (P1) and the trader blocks (P2) ─────────
            # ⛔ Every row opens its own page and makes its own fixtures (lazily, through p2_row's
            # `needs`), so `--only 28,...` works without any earlier row. The fixtures are made AFTER
            # row 25 has emptied the account of the run's notes, so they cannot break its "no notes".
            # Each row's ear window is narrowed to the final focus: the page and dialog are set up,
            # NVDA settles, the ear is marked, THEN the control is focused.
            fx: dict = {}

            def put(path, body):
                rr = req.put(f"{a.base}{path}", data=json.dumps(body), headers={"Content-Type": "application/json"})
                return rr.status, (rr.json() if rr.status < 300 else rr.text())

            def p2_account():
                """The account the browser selects: the first of /api/j2/accounts (useJ2SelectedAccount picks
                accounts[0] with nothing stored, and this Playwright context stores nothing)."""
                if "account" not in fx:
                    r = req.get(f"{a.base}/api/j2/accounts")
                    accts = (r.json() or {}).get("accounts") if r.status == 200 else None
                    if not accts:
                        raise FixtureUnavailable(f"no Journal account (GET /api/j2/accounts {r.status})")
                    fx["account"] = accts[0]["id"]
                return fx["account"]

            def p2_kinds():
                if "kinds" not in fx:
                    try:
                        fx["kinds"] = block_kinds()
                    except Exception as e:  # noqa: BLE001
                        raise FixtureUnavailable(f"the block catalog could not be read: {e}")
                return fx["kinds"]

            def p2_rule():
                """The run's own rule, switched to Before entry (so the checklist lists it too)."""
                if "rule" not in fx:
                    acct = p2_account()
                    st, j = post(f"/api/j2/accounts/{acct}/rules", {"label": SR_RULE_LABEL})
                    if st != 200 or not isinstance(j, dict) or not j.get("id"):
                        raise FixtureUnavailable(f"rule not made: {st} {str(j)[:120]}")
                    made["rules"].append(j["id"]); write()
                    st, k = put(f"/api/j2/trader-blocks/rules/{j['id']}", {"beforeEntry": True})
                    if st != 200:
                        raise FixtureUnavailable(f"rule not switched to Before entry: {st} {str(k)[:120]}")
                    fx["rule"] = j["id"]
                return fx["rule"]

            def p2_trade():
                """The review picker lists the account's closed trades; only when there is none is a manual
                ZZZT trade made (and hard-deleted in finally)."""
                if "trade" not in fx:
                    r = req.get(f"{a.base}/api/j2/trader-blocks/review/trades")
                    if r.status != 200:
                        raise FixtureUnavailable(f"GET /api/j2/trader-blocks/review/trades {r.status}")
                    if (r.json() or {}).get("trades"):
                        fx["trade"] = "the account's own"
                    else:
                        st, j = post("/api/j2/trades", {"symbol": SR_TRADE_SYMBOL, "side": "Long", "shares": 1,
                                                        "entryPrice": 10, "exitPrice": 11, "entryDate": "2026-01-05",
                                                        "exitDate": "2026-01-06", "accountId": p2_account()})
                        if st != 200 or not isinstance(j, dict) or not j.get("id"):
                            raise FixtureUnavailable(f"trade not made: {st} {str(j)[:120]}")
                        made["trades"].append(j["id"]); write()
                        fx["trade"] = j["id"]
                return fx["trade"]

            P2_NOTE_TITLES = {"preEntryChecklist": "SR block checklist", "priceStamps": "SR block stamps",
                              "positionSizing": "SR block sizing", "prepWire": "SR block prep",
                              "myRules": "SR block rules", "tradeReview": "SR block review"}

            def p2_note(widget_id):
                """One note per block, the block node already in bodyJson (never the slash menu)."""
                key = f"note:{widget_id}"
                if key not in fx:
                    kinds = p2_kinds()
                    body = {"type": "doc", "content": [_para("SR block row."), block_node(widget_id, block_params(widget_id, kinds), kinds)]}
                    st, j = post("/api/j2/notes", {"title": P2_NOTE_TITLES[widget_id], "bodyJson": body})
                    if st != 200:
                        raise FixtureUnavailable(f"note for {widget_id} not made: {st} {str(j)[:160]}")
                    made["notes"].append((j.get("note") or j)["id"]); write()
                    fx[key] = (j.get("note") or j)["id"]
                return fx[key]

            def p2_style():
                """`SR style`: the chart, then the pre-entry checklist (so the checklist row's Move up is live)."""
                if "style" not in fx:
                    r = req.get(f"{a.base}/api/j2/journal-styles")
                    kinds = (r.json() or {}).get("kinds") if r.status == 200 else None
                    if not kinds:
                        raise FixtureUnavailable(f"no kinds of note (GET /api/j2/journal-styles {r.status})")
                    ids = [k.get("id") for k in kinds]
                    kind_id = "trade_plan" if "trade_plan" in ids else ids[0]
                    st, j = post("/api/j2/journal-styles", {"name": SR_STYLE_NAME, "kindId": kind_id, "blocks": [
                        {"block": "chart", "enabled": True, "settings": {"tf": "D"}},
                        {"block": "preEntryChecklist", "enabled": True, "settings": {}}]})
                    sid = ((j.get("style") or {}).get("id") if isinstance(j, dict) else None)
                    if st != 200 or not sid:
                        raise FixtureUnavailable(f"style not made: {st} {str(j)[:160]}")
                    made["styles"].append(sid); write()
                    fx["style"] = sid
                return fx["style"]

            def p2_row(num, needs, action):
                """row() for 28-38: SKIPPED under --only, NOT RUN with the switch off, INCONCLUSIVE (no key
                sent) when a fixture cannot be made; otherwise the row, with its fixtures handed in."""
                spec = next(r for r in P1P2_ROWS if r["n"] == num)
                keys, expected, note = spec["keys"], spec["expected"], spec.get("note")
                if only and str(num) not in only:
                    return row(num, keys, expected, lambda: None)
                if styles_off:
                    return not_run(num, keys, expected, styles_off)
                try:
                    got = [n() for n in needs]
                except Exception as e:  # noqa: BLE001 -- FixtureUnavailable, or an answer of a shape not expected
                    why = str(e) if isinstance(e, FixtureUnavailable) else f"a fixture could not be made: {type(e).__name__}: {e}"
                    rows.append({"n": num, "keys": keys, "expected": expected, "result": "INCONCLUSIVE",
                                 "notes": f"no key sent: {why}"[:300], "heard": []})
                    write(); print(f"  INC  {num!s:>3}  {why[:110]}")
                    return None
                return row(num, keys, expected, lambda: action(*got), note=note)

            def wait_visible(locator, what, widget=None):
                try:
                    locator.first.wait_for(state="visible", timeout=45_000)
                except Exception as e:  # noqa: BLE001
                    shown = ""
                    if widget:
                        try:
                            shown = page.locator(f'[data-widget-embed-view="{widget}"]').first.inner_text(timeout=2_000)
                        except Exception:  # noqa: BLE001
                            shown = "(the block is not on the page)"
                    raise RuntimeError(f"{what} never appeared{'; the block shows: ' + repr(shown[:200]) if widget else ''}") from e

            def focus_heard(locator):
                """Let NVDA finish the page, narrow the ear to what follows, focus, and note where focus is."""
                time.sleep(1.5); ear.mark()
                locator.first.focus(); time.sleep(0.8)
                PROBE["txt"] = f"DOM: {page.evaluate(ACTIVE_NAME)}"

            def open_note(nid, locator, what, widget):
                page.goto(f"{a.base}/journal/notebook?note={nid}", wait_until="domcontentloaded")
                wait_visible(locator, what, widget)
                time.sleep(1.5); GUARD.ensure()

            def styles_button():
                return page.get_by_role("button", name="Styles", exact=True)

            def open_styles(mark_first=False):
                """The Notebook list's Styles door (NotebookTab.jsx:2467), focus and Enter."""
                page.goto(f"{a.base}/journal/notebook?view=all", wait_until="domcontentloaded")
                wait_visible(styles_button(), "the Styles button")
                time.sleep(1.5); GUARD.ensure()
                if mark_first:
                    time.sleep(1.5); ear.mark()
                styles_button().first.focus(); time.sleep(0.8); press("enter")
                wait_visible(page.get_by_role("dialog", name="Journal styles"), "the Journal styles dialog")

            def open_style_editor():
                open_styles()
                edit = page.get_by_role("button", name=f"Edit {SR_STYLE_NAME}", exact=True)
                wait_visible(edit, f"'Edit {SR_STYLE_NAME}'")
                edit.first.focus(); time.sleep(0.8); press("enter")
                wait_visible(page.get_by_role("button", name=MOVE_UP_NAME, exact=True), "the style editor's block rows")

            def _p28():
                open_styles(mark_first=True)
                time.sleep(1.0)
                PROBE["txt"] = (f"DOM: dialog 'Journal styles' x{page.get_by_role('dialog', name='Journal styles').count()}; "
                                f"{page.evaluate(ACTIVE_NAME)}")
            p2_row(28, [], _p28)

            def _p29(_style):
                open_style_editor()
                focus_heard(page.get_by_role("button", name=MOVE_UP_NAME, exact=True))
            p2_row(29, [p2_style], _p29)

            def _p30(_style):
                open_style_editor()
                focus_heard(page.get_by_role("combobox", name=TIMEFRAME_NAME, exact=True))
            p2_row(30, [p2_style], _p30)

            def _p31(nid, _rule):
                target = page.get_by_role("button", name=CHANGE_SETUP_NAME, exact=True)
                open_note(nid, target, f"'{CHANGE_SETUP_NAME}'", "preEntryChecklist")
                focus_heard(target)
            p2_row(31, [lambda: p2_note("preEntryChecklist"), p2_rule], _p31)

            def _p32(nid, _rule):
                target = page.get_by_role("checkbox", name=SR_RULE_LABEL, exact=True)
                open_note(nid, target, "the before-entry rule's check box", "preEntryChecklist")
                focus_heard(target)
            p2_row(32, [lambda: p2_note("preEntryChecklist"), p2_rule], _p32)

            def _p33(nid):
                target = page.get_by_role("switch", name=STAMP_NAME, exact=True)
                open_note(nid, target, "the stamp switch", "priceStamps")
                focus_heard(target)
            p2_row(33, [lambda: p2_note("priceStamps")], _p33)

            def _p34(nid):
                target = page.get_by_role("spinbutton", name="Entry", exact=True)
                open_note(nid, target, "the Entry field", "positionSizing")
                focus_heard(target)
            p2_row(34, [lambda: p2_note("positionSizing")], _p34)

            def _p35(nid):
                target = page.get_by_role("combobox", name="Setup grade", exact=True)
                open_note(nid, target, "Setup grade", "positionSizing")
                focus_heard(target)
            p2_row(35, [lambda: p2_note("positionSizing")], _p35)

            def _p36(nid):
                target = page.get_by_role("button", name="Capture now", exact=True)
                open_note(nid, target, "Capture now", "prepWire")
                focus_heard(target)
            p2_row(36, [lambda: p2_note("prepWire")], _p36)

            def _p37(nid, _rule):
                target = page.get_by_role("button", name=RULE_EDIT_NAME, exact=True)
                open_note(nid, target, f"{RULE_EDIT_NAME!r}", "myRules")
                focus_heard(target)
            p2_row(37, [lambda: p2_note("myRules"), p2_rule], _p37)

            def _p38(nid, _trade):
                target = page.get_by_role("combobox", name="Trade to review", exact=True)
                open_note(nid, target, "the trade picker", "tradeReview")
                focus_heard(target)
            p2_row(38, [lambda: p2_note("tradeReview"), p2_trade], _p38)
        except RunAborted as e:
            print("INCONCLUSIVE:", e); code = 2
        finally:
            for nid in made["notes"]:
                try: req.delete(f"{a.base}/api/j2/notes/{nid}")
                except Exception: pass
            for vid in made["views"]:
                try: req.delete(f"{a.base}/api/j2/saved-views/{vid}")
                except Exception: pass
            for fid in made["folders"]:
                try: req.delete(f"{a.base}/api/j2/note-folders/{fid}")
                except Exception: pass
            # Rows 28-38's own: the style is soft-deleted (the manager's own Delete), the rule dismissed
            # (the rules API has no delete; dismissal is the product's removal), the trade hard-deleted.
            for sid in made["styles"]:
                try: req.delete(f"{a.base}/api/j2/journal-styles/{sid}")
                except Exception: pass
            for rid in made["rules"]:
                try: req.post(f"{a.base}/api/j2/rules/{rid}/dismiss")
                except Exception: pass
            for tid in made["trades"]:
                try: req.delete(f"{a.base}/api/j2/trades/{tid}")
                except Exception: pass
            try:
                # The smoke account holds nothing by rule, so anything still active after the fixtures are
                # gone was made by a key that landed in an editor (r5: "?" typed into the home page made a
                # note). Trash it, and record what it was.
                left = req.get(f"{a.base}/api/j2/notes").json()
                stray = left.get("notes") if isinstance(left, dict) else left or []
                rec["stray_notes_trashed"] = [str(n.get("title", ""))[:40] for n in stray]
                for n in stray:
                    try: req.delete(f"{a.base}/api/j2/notes/{n['id']}")
                    except Exception: pass
                left = req.get(f"{a.base}/api/j2/notes").json()
                rec["left_active_notes"] = len(left.get("notes") if isinstance(left, dict) else left or [])
                folders = req.get(f"{a.base}/api/j2/note-folders").json()
                fl = folders.get("folders") if isinstance(folders, dict) else folders
                rec["left_sr_folders"] = sum(1 for f in (fl or []) if str(f.get("name", "")).startswith("SR "))
                views = req.get(f"{a.base}/api/j2/saved-views").json()
                vl = views.get("savedViews") if isinstance(views, dict) else views
                rec["left_sr_views"] = sum(1 for v in (vl or []) if str(v.get("name", "")).startswith("SR "))
            except Exception as e:  # noqa: BLE001
                rec["left_check_error"] = str(e)[:200]
            if made["styles"] or made["rules"] or made["trades"]:
                try:
                    st = req.get(f"{a.base}/api/j2/journal-styles").json()
                    rec["left_sr_styles"] = sum(1 for s in (st.get("styles") or [])
                                                if str(s.get("name", "")).startswith("SR ") and not s.get("deletedAt"))
                    accts = req.get(f"{a.base}/api/j2/accounts").json().get("accounts") or []
                    rec["left_sr_rules"] = sum(
                        1 for ac in accts
                        for r in (req.get(f"{a.base}/api/j2/accounts/{ac['id']}/rules?status=active").json() or [])
                        if str(r.get("label", "")).startswith("SR "))
                    tr = req.get(f"{a.base}/api/j2/trader-blocks/review/trades").json()
                    rec["left_sr_trades"] = sum(1 for t in (tr.get("trades") or []) if t.get("symbol") == SR_TRADE_SYMBOL)
                except Exception as e:  # noqa: BLE001
                    rec["left_p2_check_error"] = str(e)[:200]
            rec["finished"] = dt.datetime.now().isoformat(timespec="seconds")
            write()
            out.with_suffix(".speech.log").write_text("\n".join(ear.run_speech()), encoding="utf-8")
            b.close()

    counts = {k: sum(1 for r in rows if r["result"] == k) for k in ("PASS", "FAIL", "NOT RUN", "INCONCLUSIVE", "SKIPPED")}
    print(f"NVDA {nvda_version}: {counts}")
    if code:
        return code
    if counts["INCONCLUSIVE"]:      # a row 28-38 whose fixture could not be made: nothing measured there
        return 2
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
