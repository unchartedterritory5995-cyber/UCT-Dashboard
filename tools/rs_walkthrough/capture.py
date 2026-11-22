"""Record the captioned UCT Relative Strength walkthrough on the LOCAL SANDBOX.

Unit 4-10 of the UCT RS Phase 4 engineering map (decision D18: captioned, no voice-over).
An operator tool, not product code: it drives the hub sandbox (`scripts/hub-sandbox.ps1`,
account `hubtest@local.dev`) with Python Playwright, records one video at 1920x1080 and one at
390x844 through the steps in `script.json`, and writes captions beside each video (burned in
with ffmpeg when ffmpeg is on the PATH, otherwise an `.srt` file next to the `.webm`).

PRECONDITION, stated because a script that does not say what it points at is not a test:
    the target is the hub sandbox on THIS machine, `http://localhost:<port>` (default 8077),
    started by `scripts/hub-sandbox.ps1`. Nothing else is accepted.

Usage (operator steps are in README.txt beside this file):
    python tools/rs_walkthrough/capture.py --dry-run
    set RS_WALKTHROUGH_PASSWORD=...        (never on the command line, never in a file)
    python tools/rs_walkthrough/capture.py --base http://localhost:8077 --out C:\\temp\\rs-video

SAFETY, in the order it runs. Every check refuses BEFORE a browser opens, except the last two,
which refuse before the first recorded page loads:
  1. the base URL is `http://localhost:<port>` or `http://127.0.0.1:<port>` and nothing else
     (no https, no other host, no path, no user info, a port required);
  2. the account named on the command line is not a `uctintelligence.internal` address;
  3. `--out` is not inside any git checkout (the repo, or any of its worktrees);
  4. the password comes from the environment (`RS_WALKTHROUGH_PASSWORD`) and is never printed;
  5. the server answers the hub sandbox's identity marker (`scripts/sandbox_identity.py`), and,
     with `--integrity-log`, proves it is the sandbox that writes that log. A plain uvicorn on
     the same port (which resolves every path to the shared C:\\data root) is refused;
  6. after login, `/api/auth/me` must name exactly the account given, and never an
     `uctintelligence.internal` address;
  7. every browser request to a host other than localhost / 127.0.0.1 is aborted and counted
     (web fonts excepted), so the recording cannot reach production even through a link.

Exit codes: 0 recorded, 1 a required step failed, 3 refused by a safety check.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
DEFAULT_SCRIPT = HERE / "script.json"
DEFAULT_BASE = "http://localhost:8077"
DEFAULT_ACCOUNT = "hubtest@local.dev"
PASSWORD_ENV = "RS_WALKTHROUGH_PASSWORD"
ACCOUNT_ENV = "RS_WALKTHROUGH_EMAIL"

ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1"})
FORBIDDEN_DOMAIN = "uctintelligence.internal"
# Static assets a page may pull from elsewhere without any account or data on the wire.
STATIC_HOSTS = frozenset({"fonts.googleapis.com", "fonts.gstatic.com"})

EXIT_OK, EXIT_STEP_FAILED, EXIT_REFUSED = 0, 1, 3

DEFAULT_ACTION_TIMEOUT_MS = 10000
ACTION_PACE_MS = 450        # a beat after each action, so a viewer can follow the pointer
TOUR_STEP_MS = 1800         # how long each tour card stays up before Next
# A long press holds the pointer down this long: past `useLongPress`'s 450 ms (the phone's
# way to open a chip's readout), with room for a slow frame.
LONG_PRESS_MS = 600
LONG_PRESS_MIN_MS = 450
MIN_CUE_MS = 1500
CAPTION_MAX_CHARS = 130
CAPTION_WRAP = 44           # characters per caption line in the .srt

ACTION_KINDS = ("goto", "click", "long_press", "fill", "select", "press", "wait", "hover", "tour")
TARGET_KINDS = ("role", "css", "text", "label", "placeholder", "testid")
TARGETED_ACTIONS = frozenset({"click", "long_press", "fill", "select", "wait", "hover", "tour"})

# Caption copy rules (D18 and the RS curriculum): plain English, no emoji, no trade instruction,
# and RS is the tool, so RSI is never offered as an alternative.
_TRADE_WORDS = re.compile(r"\b(buy|buys|buying|bought|sell|sells|selling|sold)\b", re.IGNORECASE)
_RSI_WORD = re.compile(r"\bRSI\b", re.IGNORECASE)
_PRINTABLE_ASCII = re.compile(r"^[\x20-\x7e]+$")


class Refused(Exception):
    """A safety check said no. The message says which one and why."""


class StepFailed(Exception):
    """A step's action could not be completed."""


# ─── the script's JSON schema ────────────────────────────────────────────────────

_TARGET_SCHEMA = {
    "type": "object",
    "required": ["by"],
    "additionalProperties": False,
    "properties": {
        "by": {"type": "string", "enum": list(TARGET_KINDS)},
        "role": {"type": "string", "minLength": 1},
        "name": {"type": "string", "minLength": 1},
        "name_regex": {"type": "string", "minLength": 1},
        "exact": {"type": "boolean"},
        "value": {"type": "string", "minLength": 1},
        "nth": {"type": "integer", "minimum": 0},
        "do": {"type": "string", "enum": ["click", "fill", "select", "hover"]},
    },
}
_TARGET_LIST = {"type": "array", "minItems": 1, "items": _TARGET_SCHEMA}

_ACTION_SCHEMA = {
    "type": "object",
    "required": ["do"],
    "additionalProperties": False,
    "properties": {
        "do": {"type": "string", "enum": list(ACTION_KINDS)},
        "path": {"type": "string", "pattern": r"^/(?!/)[^\s\\]*$"},
        "targets": _TARGET_LIST,
        "unless": _TARGET_LIST,
        "next": _TARGET_LIST,
        "done": _TARGET_LIST,
        "value": {"type": "string", "minLength": 1},
        "key": {"type": "string", "minLength": 1},
        "submit": {"type": "boolean"},
        "timeout_ms": {"type": "integer", "minimum": 500, "maximum": 120000},
        "settle_ms": {"type": "integer", "minimum": 0, "maximum": 20000},
        "max_clicks": {"type": "integer", "minimum": 1, "maximum": 30},
        "press_ms": {"type": "integer", "minimum": LONG_PRESS_MIN_MS, "maximum": 5000},
    },
}

_VIEWPORT_SCHEMA = {
    "type": "object",
    "required": ["width", "height", "is_mobile"],
    "additionalProperties": False,
    "properties": {
        "width": {"type": "integer", "minimum": 320, "maximum": 3840},
        "height": {"type": "integer", "minimum": 320, "maximum": 2160},
        "is_mobile": {"type": "boolean"},
        "device_scale_factor": {"type": "integer", "minimum": 1, "maximum": 4},
        "caption_font_size": {"type": "integer", "minimum": 4, "maximum": 48},
    },
}

SCRIPT_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "UCT RS walkthrough script",
    "type": "object",
    "required": ["schema_version", "title", "symbol", "timeframe", "viewports", "steps"],
    "additionalProperties": False,
    "properties": {
        "schema_version": {"type": "integer", "enum": [1]},
        "title": {"type": "string", "minLength": 1},
        "symbol": {"type": "string", "pattern": r"^[A-Z][A-Z0-9.\-]{0,9}$"},
        "timeframe": {"type": "string", "enum": ["D", "W"]},
        "target_seconds": {"type": "integer", "minimum": 10, "maximum": 600},
        "viewports": {"type": "object", "minProperties": 1, "additionalProperties": _VIEWPORT_SCHEMA},
        "steps": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": ["id", "viewports", "optional", "caption", "hold_ms", "actions"],
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string", "pattern": r"^[a-z][a-z0-9_]*$"},
                    "viewports": {"type": "array", "minItems": 1, "items": {"type": "string"}},
                    "optional": {"type": "boolean"},
                    "caption": {"type": "string", "minLength": 1, "maxLength": CAPTION_MAX_CHARS},
                    "hold_ms": {"type": "integer", "minimum": 0, "maximum": 30000},
                    "actions": {"type": "array", "items": _ACTION_SCHEMA},
                },
            },
        },
    },
}

_JSON_TYPES = {
    "object": dict, "array": list, "string": str, "boolean": bool,
    "integer": int, "number": (int, float),
}


def _mini_validate(schema, inst, path="$"):
    """The keywords SCRIPT_SCHEMA uses, for an interpreter without `jsonschema`."""
    errs = []
    want = schema.get("type")
    if want:
        ok = isinstance(inst, _JSON_TYPES[want])
        if want in ("integer", "number") and isinstance(inst, bool):
            ok = False
        if not ok:
            return [f"{path}: expected {want}"]
    if "enum" in schema and inst not in schema["enum"]:
        errs.append(f"{path}: {inst!r} is not one of {schema['enum']}")
    if isinstance(inst, str):
        if len(inst) < schema.get("minLength", 0):
            errs.append(f"{path}: shorter than {schema['minLength']}")
        if "maxLength" in schema and len(inst) > schema["maxLength"]:
            errs.append(f"{path}: longer than {schema['maxLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], inst):
            errs.append(f"{path}: {inst!r} does not match {schema['pattern']}")
    if isinstance(inst, int) and not isinstance(inst, bool):
        if "minimum" in schema and inst < schema["minimum"]:
            errs.append(f"{path}: below {schema['minimum']}")
        if "maximum" in schema and inst > schema["maximum"]:
            errs.append(f"{path}: above {schema['maximum']}")
    if isinstance(inst, list):
        if len(inst) < schema.get("minItems", 0):
            errs.append(f"{path}: fewer than {schema['minItems']} items")
        if "items" in schema:
            for i, item in enumerate(inst):
                errs.extend(_mini_validate(schema["items"], item, f"{path}[{i}]"))
    if isinstance(inst, dict):
        if len(inst) < schema.get("minProperties", 0):
            errs.append(f"{path}: fewer than {schema['minProperties']} properties")
        for key in schema.get("required", []):
            if key not in inst:
                errs.append(f"{path}: missing required {key!r}")
        props = schema.get("properties", {})
        extra = schema.get("additionalProperties", True)
        for key, val in inst.items():
            if key in props:
                errs.extend(_mini_validate(props[key], val, f"{path}.{key}"))
            elif extra is False:
                errs.append(f"{path}: unexpected property {key!r}")
            elif isinstance(extra, dict):
                errs.extend(_mini_validate(extra, val, f"{path}.{key}"))
    return errs


def schema_errors(data, force_builtin=False):
    """`(validator_name, [error, ...])` for `data` against SCRIPT_SCHEMA."""
    if not force_builtin:
        try:
            import jsonschema  # optional: present in the app's environment, not required here
        except ImportError:
            jsonschema = None
        if jsonschema is not None:
            v = jsonschema.Draft202012Validator(SCRIPT_SCHEMA)
            errs = []
            for e in sorted(v.iter_errors(data), key=lambda e: list(e.absolute_path)):
                where = "$" + "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in e.absolute_path)
                errs.append(f"{where}: {e.message}")
            return "jsonschema", errs
    return "built-in", _mini_validate(SCRIPT_SCHEMA, data)


def caption_problems(text):
    """What is wrong with one caption line under the copy rules, or []."""
    out = []
    if not _PRINTABLE_ASCII.match(text or ""):
        out.append("caption must be plain printable ASCII (no emoji or symbols)")
    if _TRADE_WORDS.search(text or ""):
        out.append("caption must not say buy or sell")
    if _RSI_WORD.search(text or ""):
        out.append("caption must not mention RSI (UCT RS is the tool, not an alternative to RSI)")
    if text and text != text.strip():
        out.append("caption has leading or trailing spaces")
    return out


def _target_problems(t, where):
    out = []
    by = t.get("by")
    if by == "role":
        if not t.get("role"):
            out.append(f"{where}: a role target needs 'role'")
        if "name" in t and "name_regex" in t:
            out.append(f"{where}: give 'name' or 'name_regex', not both")
        if "value" in t:
            out.append(f"{where}: a role target uses 'name', not 'value'")
    elif by in TARGET_KINDS:
        if not t.get("value"):
            out.append(f"{where}: a {by} target needs 'value'")
        if "role" in t or "name" in t or "name_regex" in t:
            out.append(f"{where}: 'role'/'name' belong to role targets only")
    if "name_regex" in t:
        try:
            re.compile(t["name_regex"])
        except re.error as e:
            out.append(f"{where}: name_regex does not compile ({e})")
    return out


def semantic_errors(data):
    """Rules a JSON schema cannot say: per-action requirements, ids, viewports, caption copy."""
    errs = []
    viewports = set((data.get("viewports") or {}).keys())
    seen = set()
    per_viewport = {v: [] for v in viewports}
    for i, step in enumerate(data.get("steps") or []):
        if not isinstance(step, dict):
            continue
        where = f"steps[{i}] ({step.get('id')})"
        for vp in step.get("viewports") or []:
            if vp not in viewports:
                errs.append(f"{where}: viewport {vp!r} is not declared")
                continue
            key = (step.get("id"), vp)
            if key in seen:
                errs.append(f"{where}: step id {step.get('id')!r} appears twice for {vp}")
            seen.add(key)
            per_viewport[vp].append(step)
        for p in caption_problems(step.get("caption", "")):
            errs.append(f"{where}: {p}")
        for j, act in enumerate(step.get("actions") or []):
            if not isinstance(act, dict):
                continue
            aw = f"{where}.actions[{j}] ({act.get('do')})"
            kind = act.get("do")
            if kind == "goto" and not act.get("path"):
                errs.append(f"{aw}: goto needs 'path'")
            if kind == "press" and not act.get("key"):
                errs.append(f"{aw}: press needs 'key'")
            if kind in TARGETED_ACTIONS and not act.get("targets"):
                errs.append(f"{aw}: {kind} needs at least one target")
            if kind in ("fill", "select") and not act.get("value"):
                errs.append(f"{aw}: {kind} needs 'value'")
            if kind == "tour" and not (act.get("next") and act.get("done")):
                errs.append(f"{aw}: tour needs 'next' and 'done' targets")
            if kind != "tour" and ("next" in act or "done" in act or "max_clicks" in act):
                errs.append(f"{aw}: 'next'/'done'/'max_clicks' belong to tour only")
            if kind != "long_press" and "press_ms" in act:
                errs.append(f"{aw}: 'press_ms' belongs to long_press only")
            for field in ("targets", "unless", "next", "done"):
                for k, t in enumerate(act.get(field) or []):
                    if isinstance(t, dict):
                        errs.extend(_target_problems(t, f"{aw}.{field}[{k}]"))
    for vp, steps in per_viewport.items():
        if not steps:
            errs.append(f"viewport {vp!r} has no steps")
            continue
        first = (steps[0].get("actions") or [{}])[0]
        if first.get("do") != "goto" or steps[0].get("optional"):
            errs.append(f"viewport {vp!r}: the first step must be required and open a page (goto)")
    return errs


def load_script(path):
    """`(data, validator_name, errors)`. Errors include JSON syntax, schema and semantic ones."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return None, "none", [f"cannot read {path}: {e}"]
    name, errs = schema_errors(data)
    if not errs:
        errs = semantic_errors(data)
    return data, name, errs


def steps_for(data, viewport):
    return [s for s in data["steps"] if viewport in s["viewports"]]


# ─── safety checks (pure, no network) ───────────────────────────────────────────

def check_base_url(url):
    """The normalised `http://<host>:<port>` for an allowed sandbox URL, else Refused."""
    raw = (url or "").strip()
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError as e:
        raise Refused(f"base URL {raw!r} is not a URL ({e})") from None
    if parts.scheme != "http":
        raise Refused(f"base URL {raw!r}: only http://localhost:<port> or http://127.0.0.1:<port> "
                      "is accepted (the local sandbox); https means a deployed site")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise Refused(f"base URL {raw!r} carries user info; refused")
    host = (parts.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise Refused(f"base URL {raw!r}: host {host or '(none)'!r} is not localhost or 127.0.0.1; "
                      "this tool records the local sandbox only")
    if port is None or not 1 <= port <= 65535:
        raise Refused(f"base URL {raw!r} names no port; give the sandbox port, e.g. http://localhost:8077")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise Refused(f"base URL {raw!r} must be the server root, with no path, query or fragment")
    return f"http://{host}:{port}"


def _domain(email):
    return email.rsplit("@", 1)[1].strip().lower() if isinstance(email, str) and "@" in email else ""


def check_account_arg(email):
    """The account the operator named. Never the production smoke family."""
    e = (email or "").strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", e):
        raise Refused(f"account {email!r} is not an email address")
    if _domain(e) == FORBIDDEN_DOMAIN or _domain(e).endswith("." + FORBIDDEN_DOMAIN):
        raise Refused(f"account {email!r} is a {FORBIDDEN_DOMAIN} address: those are production's "
                      "synthetic accounts, and this tool never signs in as one")
    return e


def check_me(me, expected):
    """`/api/auth/me` must name exactly the expected sandbox account."""
    user = me.get("user") if isinstance(me, dict) else None
    email = user.get("email") if isinstance(user, dict) else None
    if not isinstance(email, str) or "@" not in email:
        raise Refused("/api/auth/me named no signed-in email; refusing to record an unknown session")
    got = email.strip().lower()
    dom = _domain(got)
    if dom == FORBIDDEN_DOMAIN or dom.endswith("." + FORBIDDEN_DOMAIN):
        raise Refused(f"/api/auth/me answered a {FORBIDDEN_DOMAIN} account: that is a production "
                      "smoke account, so this is not the sandbox. Stopping.")
    if got != (expected or "").strip().lower():
        raise Refused(f"/api/auth/me answered {got!r}, not the sandbox account {expected!r}. Stopping.")
    return got


def check_out_dir(path):
    """`--out` resolved; refused when it sits inside any git checkout (this repo or a worktree)."""
    p = Path(path).expanduser().resolve()
    for d in (p, *p.parents):
        if (d / ".git").exists():
            raise Refused(f"--out {str(p)!r} is inside the git checkout {str(d)!r}; videos never go "
                          "into a repository. Pick a folder outside it (the default is the temp dir).")
    return p


def default_out_dir():
    return Path(tempfile.gettempdir()) / time.strftime("rs_walkthrough_%Y%m%d_%H%M%S")


def check_sandbox_identity(base, integrity_log=None):
    """The server at `base` must be the hub sandbox launcher. Returns the sentence it proved."""
    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    try:
        import sandbox_identity as sid
    finally:
        sys.path.pop(0)
    if integrity_log:
        verdict = sid.verify(base, integrity_log)
        if not verdict.ok:
            raise Refused(verdict.sentence)
        return verdict.sentence
    data, why = sid.fetch_identity(base)
    if data is None:
        raise Refused(f"{base} is not proven to be the hub sandbox: {why}. Start it with "
                      "scripts/hub-sandbox.ps1 (a plain uvicorn resolves every path to the shared "
                      "C:\\data root, so it is refused).")
    return f"{base} answers the hub sandbox marker (data dir {data.get('data_dir')})"


# ─── captions ───────────────────────────────────────────────────────────────────

def srt_timestamp(ms):
    ms = max(0, int(round(ms)))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(cues):
    """`cues` = [(start_ms, end_ms, text)] in order. Overlaps are trimmed; short cues lengthened."""
    blocks = []
    for i, (start, end, text) in enumerate(cues):
        end = max(end, start + MIN_CUE_MS)
        if i + 1 < len(cues):
            end = min(end, cues[i + 1][0] - 1)
        lines = textwrap.wrap(text, CAPTION_WRAP) or [text]
        blocks.append(f"{i + 1}\n{srt_timestamp(start)} --> {srt_timestamp(end)}\n" + "\n".join(lines))
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def burn_captions(video, srt, font_size, log):
    """Burn `srt` into an .mp4 beside `video` when ffmpeg is on the PATH. Returns the path or None."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        log(f"  ffmpeg is not on the PATH: captions are in {srt.name} beside the video")
        return None
    out = video.with_name(video.stem + "-captioned.mp4")
    style = (f"FontName=Arial,FontSize={font_size},PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,"
             "BorderStyle=1,Outline=2,Shadow=0,MarginV=24")
    # Relative names with cwd = the output folder: the subtitles filter's own escaping of a
    # Windows drive letter (C\:) is the classic way this command breaks.
    cmd = [ffmpeg, "-y", "-loglevel", "error", "-i", video.name,
           "-vf", f"subtitles={srt.name}:force_style='{style}'",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-an", out.name]
    try:
        subprocess.run(cmd, cwd=str(video.parent), check=True, timeout=600)
    except (subprocess.SubprocessError, OSError) as e:
        log(f"  ffmpeg could not burn the captions ({e}); the .srt beside the video still has them")
        return None
    log(f"  burned captions: {out.name}")
    return out


# ─── the recording ──────────────────────────────────────────────────────────────

_CURSOR_JS = r"""
(() => {
  if (window.__rsWalkthroughCursor) return;
  window.__rsWalkthroughCursor = true;
  let dot = null;
  const make = () => {
    const d = document.createElement('div');
    d.setAttribute('aria-hidden', 'true');
    Object.assign(d.style, {
      position: 'fixed', left: '-40px', top: '-40px', width: '22px', height: '22px',
      margin: '-11px 0 0 -11px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.95)',
      background: 'rgba(201,168,76,0.45)', boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
      pointerEvents: 'none', zIndex: '2147483647', transition: 'transform 120ms ease',
    });
    (document.body || document.documentElement).appendChild(d);
    return d;
  };
  const at = (x, y) => {
    if (!dot || !dot.isConnected) dot = make();
    dot.style.left = x + 'px'; dot.style.top = y + 'px';
  };
  addEventListener('pointermove', (e) => at(e.clientX, e.clientY), true);
  addEventListener('pointerdown', (e) => { at(e.clientX, e.clientY); dot.style.transform = 'scale(0.7)'; }, true);
  addEventListener('pointerup', () => { if (dot) dot.style.transform = 'scale(1)'; }, true);
})();
"""


def _locator(page, t):
    by = t["by"]
    if by == "css":
        loc = page.locator(t["value"])
    elif by == "role":
        kw = {}
        if "name" in t:
            kw = {"name": t["name"], "exact": bool(t.get("exact", False))}
        elif "name_regex" in t:
            kw = {"name": re.compile(t["name_regex"])}
        loc = page.get_by_role(t["role"], **kw)
    elif by == "text":
        loc = page.get_by_text(t["value"], exact=bool(t.get("exact", False)))
    elif by == "label":
        loc = page.get_by_label(t["value"], exact=bool(t.get("exact", False)))
    elif by == "placeholder":
        loc = page.get_by_placeholder(t["value"], exact=bool(t.get("exact", False)))
    else:  # testid
        loc = page.get_by_test_id(t["value"])
    return loc.nth(int(t.get("nth", 0)))


def describe_target(t):
    if t["by"] == "role":
        name = t.get("name") or (f"/{t['name_regex']}/" if "name_regex" in t else "")
        return f"role={t['role']}" + (f" name={name!r}" if name else "")
    return f"{t['by']}={t['value']!r}"


def _visible(loc):
    try:
        return loc.is_visible()
    except Exception:  # noqa: BLE001 -- a detached or malformed match is "not there"
        return False


def find_first(page, targets, timeout_ms):
    """The first VISIBLE match, trying the strategies in order until the deadline."""
    deadline = time.monotonic() + timeout_ms / 1000.0
    while True:
        for t in targets:
            loc = _locator(page, t)
            if _visible(loc):
                return loc, t
        if time.monotonic() >= deadline:
            return None, None
        page.wait_for_timeout(200)


def any_visible(page, targets):
    return any(_visible(_locator(page, t)) for t in targets or [])


def _point_at(loc):
    try:
        loc.scroll_into_view_if_needed(timeout=3000)
        loc.hover(timeout=3000)
        loc.page.wait_for_timeout(350)
    except Exception:  # noqa: BLE001 -- hover is cosmetic (and absent on touch)
        pass


def _long_press(loc, press_ms=LONG_PRESS_MS):
    """Touch down on the target's centre, hold, lift: the phone's long press.

    A TOUCH pointer, dispatched on the element: `useLongPress` ignores `pointerType: 'mouse'`
    (a mouse opens the menu by right-click), and Playwright's `mouse.down()` is a mouse
    pointer even in a touch context. The hold outlasts the hook's 450 ms timer."""
    _point_at(loc)
    box = loc.bounding_box(timeout=3000)
    if not box:
        raise StepFailed("long_press: the target has no box on screen")
    x = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2
    init = {"pointerType": "touch", "pointerId": 1, "isPrimary": True, "button": 0,
            "buttons": 1, "clientX": x, "clientY": y}
    loc.dispatch_event("pointerdown", init)
    loc.page.wait_for_timeout(max(int(press_ms), LONG_PRESS_MIN_MS + 1))
    loc.dispatch_event("pointerup", {**init, "buttons": 0})


def _apply(loc, kind, value, submit, press_ms=LONG_PRESS_MS):
    if kind == "long_press":
        _long_press(loc, press_ms)
    elif kind == "click":
        _point_at(loc)
        loc.click(timeout=8000)
    elif kind == "hover":
        _point_at(loc)
    elif kind == "fill":
        _point_at(loc)
        loc.click(timeout=8000)
        loc.fill("")
        loc.press_sequentially(value, delay=70)
        if submit:
            loc.press("Enter")
    elif kind == "select":
        _point_at(loc)
        loc.select_option(value=value, timeout=8000)


def _run_tour(page, act, timeout):
    card, _ = find_first(page, act["targets"], timeout)
    if card is None:
        raise StepFailed("no tour card appeared")
    for _ in range(int(act.get("max_clicks", 12))):
        page.wait_for_timeout(TOUR_STEP_MS)
        done, _ = find_first(page, act["done"], 300)
        if done is not None:
            _apply(done, "click", None, False)
            return
        nxt, _ = find_first(page, act["next"], 1500)
        if nxt is None:
            return  # the card closed itself
        _apply(nxt, "click", None, False)
    raise StepFailed("the tour did not reach Done within max_clicks")


def run_action(page, act, ctx):
    kind = act["do"]
    timeout = int(act.get("timeout_ms", DEFAULT_ACTION_TIMEOUT_MS))
    if act.get("unless") and any_visible(page, act["unless"]):
        return f"{kind}: skipped, already in place"
    if kind == "goto":
        path = act["path"].format(symbol=ctx["symbol"], timeframe=ctx["timeframe"])
        page.goto(ctx["base"] + path, wait_until="domcontentloaded", timeout=60000)
        try:
            ctx["dismiss_intro"](page)
        except Exception as e:  # noqa: BLE001
            raise StepFailed(f"the intro overlay did not close ({e})") from None
        note = f"goto {path}"
    elif kind == "press":
        page.keyboard.press(act["key"])
        note = f"press {act['key']}"
    elif kind == "tour":
        _run_tour(page, act, timeout)
        note = "tour walked"
    else:
        loc, target = find_first(page, act["targets"], timeout)
        if loc is None:
            tried = "; ".join(describe_target(t) for t in act["targets"])
            raise StepFailed(f"{kind}: nothing visible after {timeout} ms (tried {tried})")
        how = target.get("do", kind)
        if kind != "wait":
            _apply(loc, how, act.get("value"), bool(act.get("submit")),
                   int(act.get("press_ms", LONG_PRESS_MS)))
        note = f"{kind} via {describe_target(target)}"
    page.wait_for_timeout(ACTION_PACE_MS + int(act.get("settle_ms", 0)))
    return note


def _install_network_guard(context, blocked):
    def guard(route):
        host = (urlsplit(route.request.url).hostname or "").lower()
        if host in ALLOWED_HOSTS or host in STATIC_HOSTS:
            route.continue_()
        else:
            blocked[host] = blocked.get(host, 0) + 1
            route.abort()
    context.route("**/*", guard)


def _login(browser, base, account, password, signup, log):
    """A throwaway context signs in and proves the account; its cookies seed the recordings."""
    blocked = {}
    ctx = browser.new_context()
    _install_network_guard(ctx, blocked)
    try:
        body = {"email": account, "password": password}
        resp = ctx.request.post(f"{base}/api/auth/login", data=body,
                                headers={"Content-Type": "application/json"})
        if resp.status == 401 and signup:
            log("  login refused; --signup: creating the sandbox account once")
            resp = ctx.request.post(f"{base}/api/auth/signup",
                                    data={**body, "display_name": "hubtest"},
                                    headers={"Content-Type": "application/json"})
        if not resp.ok:
            raise Refused(f"sign-in as {account} answered HTTP {resp.status}. Check {PASSWORD_ENV}, or "
                          "pass --signup once on a fresh sandbox.")
        me = ctx.request.get(f"{base}/api/auth/me")
        if not me.ok:
            raise Refused(f"/api/auth/me answered HTTP {me.status} after sign-in")
        payload = me.json()
        check_me(payload, account)
        log(f"  signed in as {account} (plan={payload.get('plan')})")
        return ctx.storage_state()
    finally:
        ctx.close()


def record_viewport(browser, name, vp, data, state, args, ctx_info, out_dir, log):
    """One recording. Returns (ok, cues, video_path)."""
    blocked = {}
    w, h = vp["width"], vp["height"]
    tmp_video_dir = out_dir / f".raw-{name}"
    context = browser.new_context(
        viewport={"width": w, "height": h},
        device_scale_factor=vp.get("device_scale_factor", 1),
        is_mobile=vp["is_mobile"], has_touch=vp["is_mobile"],
        reduced_motion="reduce",
        storage_state=state,
        record_video_dir=str(tmp_video_dir),
        record_video_size={"width": w, "height": h},
    )
    _install_network_guard(context, blocked)
    context.add_init_script(_CURSOR_JS)
    ok, cues, video = True, [], None
    try:
        me = context.request.get(f"{ctx_info['base']}/api/auth/me")
        check_me(me.json() if me.ok else {}, args.account)
        page = context.new_page()
        video = page.video
        t0 = time.monotonic()
        for step in steps_for(data, name):
            start = (time.monotonic() - t0) * 1000
            tag = "optional" if step["optional"] else "required"
            try:
                notes = [run_action(page, a, ctx_info) for a in step["actions"]]
            except Exception as e:  # noqa: BLE001 -- Playwright errors arrive under many names
                if step["optional"]:
                    log(f"  [skip] {name}/{step['id']} ({tag}): not present yet -- {e}")
                    continue
                log(f"  [FAIL] {name}/{step['id']} ({tag}): {e}")
                ok = False
                break
            page.wait_for_timeout(int(step["hold_ms"]))
            end = (time.monotonic() - t0) * 1000
            cues.append((start, end, step["caption"]))
            log(f"  [ok]   {name}/{step['id']}: " + "; ".join(notes) if notes else
                f"  [ok]   {name}/{step['id']}")
    finally:
        context.close()
        if blocked:
            log(f"  network guard blocked {sum(blocked.values())} request(s) to: "
                + ", ".join(sorted(blocked)))
    final = None
    if video is not None:
        final = out_dir / f"rs-walkthrough-{name}.webm"
        video.save_as(str(final))
        video.delete()
    shutil.rmtree(tmp_video_dir, ignore_errors=True)
    return ok, cues, final


def run_capture(args, data, base, out_dir, password, log):
    from playwright.sync_api import sync_playwright

    sys.path.insert(0, str(REPO_ROOT))
    from tools.mobile_audit import _dismiss_intro  # the audited intro dismissal, reused

    out_dir.mkdir(parents=True, exist_ok=True)
    ctx_info = {"base": base, "symbol": data["symbol"], "timeframe": data["timeframe"],
                "dismiss_intro": _dismiss_intro}
    names = [args.viewport] if args.viewport else list(data["viewports"])
    all_ok = True
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME") or None)
        try:
            state = _login(browser, base, args.account, password, args.signup, log)
            for name in names:
                vp = data["viewports"][name]
                log(f"recording {name} {vp['width']}x{vp['height']}")
                ok, cues, video = record_viewport(browser, name, vp, data, state, args, ctx_info,
                                                  out_dir, log)
                all_ok = all_ok and ok
                if video is None:
                    continue
                srt = video.with_suffix(".srt")
                srt.write_text(build_srt(cues), encoding="utf-8")
                log(f"  video: {video}")
                log(f"  captions: {srt}")
                burn_captions(video, srt, vp.get("caption_font_size", 16), log)
        finally:
            browser.close()
    return EXIT_OK if all_ok else EXIT_STEP_FAILED


# ─── dry run and entry point ────────────────────────────────────────────────────

def print_plan(data, path, validator, log):
    log(f"{data['title']}  (script: {path})")
    log(f"schema: ok (validator: {validator}); symbol {data['symbol']}, timeframe {data['timeframe']}")
    for name, vp in data["viewports"].items():
        steps = steps_for(data, name)
        hold = sum(s["hold_ms"] for s in steps) / 1000.0
        log("")
        log(f"{name} {vp['width']}x{vp['height']}: {len(steps)} steps, {hold:.0f} s of caption hold "
            f"(target {data.get('target_seconds', '-')} s, plus the time the actions take)")
        for i, s in enumerate(steps, 1):
            log(f"  {i:2d}. {s['id']:<17} {'optional' if s['optional'] else 'required'}  {s['caption']}")
            for a in s["actions"]:
                if a["do"] == "goto":
                    detail = a["path"].format(symbol=data["symbol"], timeframe=data["timeframe"])
                elif a["do"] == "press":
                    detail = a["key"]
                else:
                    detail = " | ".join(describe_target(t) for t in a.get("targets", []))
                    if a.get("value"):
                        detail = f"{a['value']!r} into " + detail
                    if a.get("unless"):
                        detail += "   (skipped when already in place)"
                log(f"        - {a['do']:<6} {detail}")


def build_parser():
    ap = argparse.ArgumentParser(description="Record the captioned UCT RS walkthrough on the local sandbox.")
    ap.add_argument("--base", default=DEFAULT_BASE,
                    help="the hub sandbox, http://localhost:<port> or http://127.0.0.1:<port>")
    ap.add_argument("--account", default=os.environ.get(ACCOUNT_ENV) or DEFAULT_ACCOUNT,
                    help=f"the sandbox account (default {DEFAULT_ACCOUNT}); the password is read from "
                         f"{PASSWORD_ENV}")
    ap.add_argument("--out", default=None, help="output folder (default: a new folder in the temp dir)")
    ap.add_argument("--script", default=str(DEFAULT_SCRIPT), help="the step script (script.json)")
    ap.add_argument("--viewport", default=None, help="record one viewport only (desktop or phone)")
    ap.add_argument("--integrity-log", default=None,
                    help="the sandbox launcher's integrity log, for the full identity proof")
    ap.add_argument("--signup", action="store_true",
                    help="create the sandbox account if sign-in is refused (fresh sandbox only)")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the steps and check the script; no browser, no network")
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    log = print
    data, validator, errs = load_script(args.script)
    if errs:
        log(f"script {args.script} is not valid ({validator}):")
        for e in errs:
            log(f"  - {e}")
        return EXIT_STEP_FAILED
    if args.viewport and args.viewport not in data["viewports"]:
        log(f"--viewport {args.viewport!r} is not in the script ({', '.join(data['viewports'])})")
        return EXIT_STEP_FAILED

    try:
        base = check_base_url(args.base)
        args.account = check_account_arg(args.account)
        out_dir = check_out_dir(args.out or default_out_dir())
    except Refused as e:
        log(f"REFUSED: {e}")
        return EXIT_REFUSED

    if args.dry_run:
        print_plan(data, args.script, validator, log)
        log("")
        log(f"safety: base {base} accepted (local sandbox only); account {args.account} accepted; "
            f"output would go to {out_dir}")
        log("dry run: no browser was started and nothing was sent")
        return EXIT_OK

    password = os.environ.get(PASSWORD_ENV)
    if not password:
        log(f"REFUSED: set {PASSWORD_ENV} in the environment (the password is never taken on the "
            "command line or from a file)")
        return EXIT_REFUSED
    try:
        log(check_sandbox_identity(base, args.integrity_log))
        return run_capture(args, data, base, out_dir, password, log)
    except Refused as e:
        log(f"REFUSED: {e}")
        return EXIT_REFUSED


if __name__ == "__main__":
    sys.exit(main())
