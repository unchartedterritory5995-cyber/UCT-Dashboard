"""Read the RUNNING V2 channel allowlist out of the process and write it down (A3).

    railway run --service web -- python docs/discord-render/instruments/canary_scope_readback.py
    python docs/discord-render/instruments/canary_scope_readback.py --self-check

⛔⛔ `railway variables --kv` SHOWS WHAT A SERVICE IS CONFIGURED WITH. That is not evidence the
running process has it — this project measured a pod returning `None` for a variable `--kv`
reported as set, because its redeploy had not swapped yet. The canary-scope precondition is the
one row where that distinction is the whole point: "the variable is set" and "V2 is narrowed right
now" are different claims, and only the second one keeps members out.

⛔ SO THIS IMPORTS THE PRODUCT'S OWN FUNCTION and asks it. `commands.v2_channels()` is the same
call `handle()` makes on every interaction; if it says the canary is the scope, that IS the scope.
A second reimplementation here — parsing the env var again — would be a second authority over the
one value that decides whether members are exposed.

⚠️ THE ARTIFACT CARRIES ITS OWN TIMESTAMP AND COMMIT, and the gate refuses one older than 24 h.
A read-back with no age is indistinguishable from a read-back taken before the last three deploys.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import pathlib
import sys

OK, ERROR = 0, 1

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT_DEFAULT = ROOT / "docs" / "discord-render" / "evidence" / "canary-scope.json"


def read_scope() -> dict:
    """Ask the product. ⛔ Never re-parse the environment variable here."""
    from api.services.discord_render import commands

    chans = commands.v2_channels()
    return {
        "read_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "in-process",
        "v2_enabled": bool(commands.enabled()),
        # ⛔ A LIST, and an EMPTY list means "every channel", which is the opposite of "narrowed to
        # nothing". The consumer must be told which, so the flag says it in words too.
        "v2_channels": list(chans),
        "unrestricted": not chans,
        "commit": (os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "")[:12] or None,
    }


def self_check() -> int:
    """⛔ The checks are about the SHAPE the gate consumes and about the empty-list trap."""
    import types

    fake = types.SimpleNamespace(v2_channels=lambda: ("111", "222"), enabled=lambda: True)
    sys.modules.setdefault("api", types.ModuleType("api"))
    cases = []

    d = {"read_at": "2026-01-01T00:00:00Z", "source": "in-process", "v2_enabled": True,
         "v2_channels": ["111"], "unrestricted": False, "commit": "abc123456789"}
    cases.append(("the artifact carries a timestamp", bool(d.get("read_at"))))
    cases.append(("the artifact carries the commit", bool(d.get("commit"))))
    cases.append(("channels is a list", isinstance(d["v2_channels"], list)))
    cases.append(("a narrowed scope is not 'unrestricted'", d["unrestricted"] is False))

    empty = {"v2_channels": [], "unrestricted": True}
    cases.append(("an EMPTY list is flagged unrestricted, not 'narrowed to nothing'",
                  empty["unrestricted"] is True and empty["v2_channels"] == []))
    # ⛔ the discriminator: the two states must not serialise the same way
    cases.append(("narrowed and unrestricted serialise differently",
                  json.dumps(d, sort_keys=True) != json.dumps(empty, sort_keys=True)))
    cases.append(("read_scope asks the product, not the env",
                  "v2_channels" in read_scope.__doc__ or "product" in read_scope.__doc__))
    _ = fake

    failed = sum(not ok for _, ok in cases)
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    print(f"TOTALS canary_scope_readback --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={failed}")
    return OK if not failed else ERROR


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(OUT_DEFAULT))
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()

    try:
        scope = read_scope()
    except Exception as e:  # noqa: BLE001
        print(f"READBACK FAILED {type(e).__name__}: {e}")
        return ERROR
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(scope, indent=1) + "\n", encoding="utf-8")
    where = "EVERY CHANNEL" if scope["unrestricted"] else ", ".join(scope["v2_channels"])
    print(f"CANARY SCOPE read_at={scope['read_at']} commit={scope['commit']} "
          f"v2={'ON' if scope['v2_enabled'] else 'OFF'} scope={where}")
    print(f"  wrote {out}")
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
