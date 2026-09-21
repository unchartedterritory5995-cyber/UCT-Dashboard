"""Run a script inside this container under PID 1's EXACT environment.

⚰️⚰️ WHY THIS EXISTS. A `railway ssh` shell does NOT inherit the environment the
container actually runs with. Its `python` is the system interpreter, not `/opt/venv`,
so `import numpy` fails with `ModuleNotFoundError` — and every diagnostic you wanted to
run against the live service dies on its first import. Worse, a partial environment can
let a script start and then behave differently from the real process, which is how an
"identical" check quietly measures something else.

    $ railway ssh --service breadth-v2-runner "python -c 'import numpy'"
    ModuleNotFoundError: No module named 'numpy'

⭐ PID 1 is the process the platform actually launched, so its `/proc/1/environ` is the
authoritative environment — venv PATH, provider credentials, DATA_DIR, everything. Read
it, `execve` into the venv interpreter with it, and the script runs exactly as the
service does.

    railway ssh --service breadth-v2-runner \\
        "python /app/tools/breadth_v2_exec.py /app/tools/breadth_v2_golden_smoke.py"

⚠️ Deliberately uses the SYSTEM python to bootstrap — it only reads a file and execs, so
it needs no third-party imports, which is the whole point.
"""
import os
import sys

VENV_PYTHON = "/opt/venv/bin/python"


def pid1_environ() -> dict:
    env = {}
    with open("/proc/1/environ", "rb") as f:
        for kv in f.read().split(b"\0"):
            if kv and b"=" in kv:
                k, v = kv.split(b"=", 1)
                env[k.decode()] = v.decode("utf-8", "replace")
    return env


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: breadth_v2_exec.py <script.py> [args...]\n")
        return 2
    env = pid1_environ()
    if not env:
        sys.stderr.write("refusing to run: /proc/1/environ was empty, so this would "
                         "NOT be the service's environment\n")
        return 3
    os.chdir("/app")
    args = [VENV_PYTHON] + sys.argv[1:]
    sys.stderr.write("[breadth_v2_exec] %s  (%d vars from PID 1)\n" % (args, len(env)))
    sys.stderr.flush()
    os.execve(VENV_PYTHON, args, env)


if __name__ == "__main__":
    sys.exit(main())
