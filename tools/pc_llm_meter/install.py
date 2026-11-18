"""Install / uninstall / check the PC Claude-call meter (uct_llm_meter.py).

    python tools/pc_llm_meter/install.py              # install for this Python's user site
    python tools/pc_llm_meter/install.py --check      # is it installed and loading?
    python tools/pc_llm_meter/install.py --uninstall  # remove both files

It copies uct_llm_meter.py into the USER site-packages of the Python that runs this
script and writes a one-line uct_llm_meter.pth beside it, so every process of that
Python loads the meter at startup. Nothing outside the user site is touched; delete
the two files (or --uninstall) to remove it completely. Run it with each Python the
scheduled jobs use (on this box: C:\\Python314\\python.exe).
"""
from __future__ import annotations

import os
import shutil
import site
import subprocess
import sys

NAME = "uct_llm_meter"
PTH_LINE = ('import sys; exec("try:\\n import uct_llm_meter as _m; _m._arm()\\n'
            'except Exception:\\n pass")\n')
HERE = os.path.dirname(os.path.abspath(__file__))


def _target() -> str:
    d = site.getusersitepackages()
    os.makedirs(d, exist_ok=True)
    return d


def install() -> int:
    if not site.ENABLE_USER_SITE:
        print("user site-packages is disabled for this Python; not installing")
        return 2
    d = _target()
    shutil.copyfile(os.path.join(HERE, NAME + ".py"), os.path.join(d, NAME + ".py"))
    tmp = os.path.join(d, NAME + ".pth.tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(PTH_LINE)
    os.replace(tmp, os.path.join(d, NAME + ".pth"))
    print(f"installed into {d}")
    return check()


def uninstall() -> int:
    d = site.getusersitepackages()
    for fn in (NAME + ".pth", NAME + ".py"):
        p = os.path.join(d, fn)
        if os.path.exists(p):
            os.remove(p)
            print(f"removed {p}")
    return 0


def check() -> int:
    """Start a fresh interpreter (as a scheduled job would) and report what it sees."""
    code = ("import sys; m = sys.modules.get('uct_llm_meter'); "
            "w = any(type(f).__name__ == '_AnthropicWatcher' for f in sys.meta_path); "
            "import anthropic, requests; "
            "print('loaded' if m else 'NOT loaded', '| watcher armed' if w else '| no watcher', "
            "'| SDK hooked' if (m and m._installed) else '| SDK NOT hooked', "
            "'| requests hooked' if (m and m._requests_installed) else '| requests NOT hooked')")
    env = {k: v for k, v in os.environ.items() if k not in ("PYTEST_CURRENT_TEST", "UCT_LLM_METER")}
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=60)
    print((r.stdout or r.stderr).strip())
    return 0 if r.stdout.startswith("loaded") and "NOT" not in r.stdout else 1


if __name__ == "__main__":
    arg = (sys.argv[1:] or [""])[0]
    sys.exit(uninstall() if arg == "--uninstall" else check() if arg == "--check" else install())
