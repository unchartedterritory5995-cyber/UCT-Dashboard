"""THE refusal authority for "is this path the shared data root?" (ruling W11-R51, F-CLOCK-1 C1).

⛔ WHY ONE MODULE. Three copies of this check lived in the hub sandbox launcher
(`scripts/hub_sandbox_boot.py`), the pytest tripwire (`conftest.py`) and the campaign seeder
(`tools/notebook_campaign/seed_members.py`), plus the perf harness. Every copy compared
`normcase(abspath(path))` against the drive spelling of the root, and every copy let the SAME
spellings through (measured against a fake root, F-CLOCK-1 safety review):

    \\\\?\\C:\\data\\x            \\\\localhost\\C$\\data\\x         \\\\?\\UNC\\localhost\\C$\\data\\x
    \\\\127.0.0.1\\c$\\data\\x

Each names the live directory and each passed all three layers, so a sandbox pointed at one of
them pinned `AUTH_DB_PATH` into the live drive while the tripwire stayed silent. Four copies of
one rule is four places to fix it; this is the one.

Two entry points over one canonicalisation:

* `refuse(path, roots=None)` -- for a LAUNCHER choosing a data dir. Strict: any path that begins
  with two separators (`\\\\?\\`, `\\\\.\\`, `\\\\host\\share`) is refused BEFORE anything is resolved (a
  sandbox has no reason to be a device or UNC path); then the drive spelling is compared without
  touching the disk; only when that passes is the path resolved (realpath: junctions, symlinks,
  case) and compared again, and a path that RESOLVES to a device or UNC form is refused too.
* `hit(path, roots)` -- for the TRIPWIRE, on every `open()` in a test run. Cheap and never
  touches the disk: it maps the device forms back to their drive (`\\\\?\\C:\\x` -> `C:\\x`,
  `\\\\?\\UNC\\h\\C$\\x` and `\\\\h\\C$\\x` -> `C:\\x`, for ANY host: refusing a write to another box's
  admin share costs a test nothing) and compares.

Stdlib only, imports nothing from `api`, opens nothing. Roots default to C:\\data and /data;
callers that derive their own (conftest's census) pass them.
"""
from __future__ import annotations

import os
import re

DEFAULT_ROOTS = ("C:\\data", "/data")

_SEPS = ("\\", "/")
_ADMIN_SHARE = re.compile(r"^[\\/]{2}[^\\/]+[\\/]([A-Za-z])\$(?=[\\/]|$)(.*)$", re.DOTALL)


def _text(path) -> str | None:
    try:
        raw = os.fspath(path)
    except TypeError:
        return None
    if isinstance(raw, bytes):
        try:
            raw = raw.decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            return None
    return raw if isinstance(raw, str) else None


def starts_with_two_separators(path) -> bool:
    raw = _text(path)
    return bool(raw) and len(raw) >= 2 and raw[0] in _SEPS and raw[1] in _SEPS


def device_to_drive(raw: str) -> str:
    """`\\\\?\\C:\\x` / `\\\\.\\C:\\x` -> `C:\\x`; `\\\\?\\UNC\\h\\s\\x` -> `\\\\h\\s\\x`; an admin share
    `\\\\h\\C$\\x` (any host) -> `C:\\x`. Anything else is returned unchanged. Pure string work."""
    s = raw
    for _ in range(3):                      # \\?\UNC\h\C$\x needs two steps
        if len(s) >= 4 and s[0] in _SEPS and s[1] in _SEPS and s[2] in "?." and s[3] in _SEPS:
            rest = s[4:]
            if rest[:3].upper() == "UNC" and (len(rest) == 3 or rest[3] in _SEPS):
                s = "\\\\" + rest[4:]
                continue
            s = rest
            continue
        m = _ADMIN_SHARE.match(s)
        if m:
            s = f"{m.group(1)}:" + (m.group(2) or "\\")
            continue
        break
    return s


def _strip_win_component_tails(p: str) -> str:
    """Win32 drops trailing dots and spaces from a path component (`C:\\data .\\x` opens `C:\\data\\x`),
    so for the compare they are dropped from EVERY component (conservative: only ever more hits)."""
    drive, rest = os.path.splitdrive(p)
    parts = re.split(r"([\\/]+)", rest)
    return drive + "".join(x if (not x or x[0] in _SEPS or x in (".", "..")) else (x.rstrip(" .") or x) for x in parts)


def _canon(p: str) -> str:
    out = os.path.normcase(os.path.abspath(p))
    if os.name == "nt":
        out = _strip_win_component_tails(out)
    return out.rstrip("\\/") if len(out.rstrip("\\/")) > 2 else out


def canonical_roots(roots=None) -> list[str]:
    return [_canon(r) for r in (roots if roots is not None else DEFAULT_ROOTS)]


def _inside(full: str, croots: list[str]) -> str | None:
    full = full.rstrip("\\/") if len(full.rstrip("\\/")) > 2 else full
    for r in croots:
        if full == r or full.startswith(r + os.sep):
            return r
    return None


def hit(path, roots) -> str | None:
    """The canonical path when `path` is inside one of `roots`, else None. `roots` must already be
    canonical (`canonical_roots`); conftest's are. No disk access: this is the tripwire's hot path,
    so a path that does not even mention a root's own directory name is rejected before any
    `abspath` (which costs a `getcwd`). Every device / admin-share spelling of a root still names it."""
    if not roots:
        return None
    raw = _text(path)
    if not raw or "\x00" in raw:
        return None
    lowered = raw.lower()
    if not any(os.path.basename(r).lower() in lowered for r in roots):
        return None
    try:
        full = _canon(device_to_drive(raw))
    except (ValueError, OSError):
        return None
    return full if _inside(full, list(roots)) else None


def refuse(path, roots=None) -> str | None:
    """Why `path` may not be a sandbox data dir, or None. See the module docstring for the order."""
    raw = _text(path)
    if not raw:
        return "no data dir given"
    if "\x00" in raw:
        return f"{raw!r} contains a NUL byte"
    if starts_with_two_separators(raw):
        return (f"{raw!r} begins with two separators (a \\\\?\\ / \\\\.\\ device path or a UNC share); "
                "a sandbox data dir is a plain local path")
    croots = canonical_roots(roots)
    try:
        spelled = _canon(raw)
    except (ValueError, OSError) as e:
        return f"{raw!r} cannot be resolved ({e})"
    r = _inside(spelled, croots)
    if r:
        return f"{raw!r} resolves to {spelled!r}, inside the shared data root {r!r}"
    try:
        real = os.path.realpath(raw)
    except (ValueError, OSError) as e:
        return f"{raw!r} cannot be resolved ({e})"
    mapped = device_to_drive(real)
    if starts_with_two_separators(mapped):
        return f"{raw!r} resolves to {real!r}, a device or UNC path"
    full = _canon(mapped)
    r = _inside(full, croots)
    if r:
        return f"{raw!r} resolves to {full!r} (through a junction, link or case), inside the shared data root {r!r}"
    return None
