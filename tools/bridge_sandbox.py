"""What every `tools/*_bridge.py` does with the census's sandboxes when it exits (wave 7 lane J,
fix round 1, review M-8).

Importing the repo-root `conftest` (which every bridge must do before any `api.*` import --
`tests/test_notebook_bridges_pin_the_root.py`) mints two per-process sandbox directories under
the system temp directory: the auth store's (`uct_tests_authdb_*`) and the data root's
(`uct_tests_datadir_*`). Under pytest the session owns them; a bridge is a short-lived child a
JS rail spawns, and nothing reclaimed its pair until the NEXT import's 24-hour prune -- two
empty directories per spawn.

`run_bridge(main)` runs the bridge and then releases the two directories THIS process minted,
and only while they are EMPTY (`os.rmdir` refuses anything else), so a bridge that did write
into its sandbox leaves the evidence where it is. It names what it released on stderr (stdout
carries the bridge's one JSON answer and nothing else), which is what the rail reads. Call it
only from a bridge's `__main__` block: in-process under pytest, the conftest's sandboxes are
the SESSION's, not the bridge's.

This module imports nothing from `api.*`.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Callable


def release_census_sandboxes() -> list[str]:
    ct = sys.modules.get("conftest")
    if ct is None:
        return []
    released = []
    for d in (os.path.dirname(ct.ISOLATED_AUTH_DB), ct.SANDBOX_DATA_ROOT):
        try:
            os.rmdir(d)                      # an EMPTY directory only, by construction
            released.append(d)
        except OSError:
            pass
    if released:
        sys.stderr.write("bridge: released census sandboxes " + json.dumps(released) + "\n")
    return released


def run_bridge(main: Callable[[], int]) -> int:
    try:
        return main()
    finally:
        release_census_sandboxes()
