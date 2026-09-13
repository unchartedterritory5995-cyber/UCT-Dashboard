# Rig tooling, preserved across the 2026-09-13 operator reboot

⛔ **NOT product code and not on any import path.** These three files lived in a
session scratchpad, which is session-scoped and does not survive a reboot. They
are the difference between a one-command rig restart and re-deriving the sandbox
pins from scratch, so they are kept here rather than described in prose.

| file | what it is |
|---|---|
| `boot_rig.py` | the app on **127.0.0.1:8129** with `DATA_DIR` and `AUTH_DB_PATH` pinned into a sandbox and every scheduler flag `0`. ⛔ **Not port 8077** — that has held a stale backend on the owner's LIVE `C:\data`, and `C:\data` exists on this box. |
| `fixture_server.py` | serves exactly one path, `/v2.pine` on **:8124**, with CORS, so the member's real Import door can be driven with the byte-identical fixture (sha256 `518a6b22…b28a`, verified IN THE PAGE). A directory server on the repo root would put every file on this box behind an unauthenticated port for the length of a screenshot. |
| `focus_tab.ps1` | finds the Chrome window holding a given page and activates its tab. ⚠️ `Ctrl+2` is not enough: the MCP window holds tabs outside its group, so the reliable move is to enumerate every Chrome window, focus each, send `^1`…`^9`, and stop when the window TITLE matches. |

`boot_rig.py` writes its sandbox under the SCRATCHPAD path baked into it — after a
reboot that directory is new, so the rig account and both saved definitions have
to be recreated. The RESUME section of `docs/pine/SESSION-STATE.md` has the
commands and the two definition ids.
