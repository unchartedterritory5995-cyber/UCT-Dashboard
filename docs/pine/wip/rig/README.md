# Rig tooling, preserved across the 2026-09-13 operator reboot

⛔ **NOT product code and not on any import path.** These three files lived in a
session scratchpad, which is session-scoped. They are the difference between a
one-command rig restart and re-deriving the sandbox pins from prose.

## Start it

```bash
# from anywhere — the sandbox defaults OUTSIDE every worktree
python docs/pine/wip/rig/boot_rig.py                    # 127.0.0.1:8129
python docs/pine/wip/rig/fixture_server.py              # 127.0.0.1:8124/v2.pine

# …or point the sandbox somewhere specific
UCT_RIG_DATA=/c/Users/Patrick/AppData/Local/Temp/uct-rig-8129/rig-data \
  python docs/pine/wip/rig/boot_rig.py

curl -s http://127.0.0.1:8129/api/health                # {"status":"ok",...}
curl -sI http://127.0.0.1:8124/v2.pine | grep -i x-sha256
#   518a6b22f7cc238d898869d496af7a96151520598bdba6de7b92f69d6c27b28a
```

The account, if the sandbox is new:

```bash
curl -s -X POST http://127.0.0.1:8129/api/auth/signup -H "Content-Type: application/json" \
  -d '{"email":"panetest@local.dev","password":"LocalTest2026!","display_name":"Pane Rig"}'
```

⛔ The frontend must carry the flag or the attach door does not exist:
`cd app && VITE_PINE_MEMBER_PANE_ENABLED=1 npm run build`.

## The files

| file | what it is |
|---|---|
| `boot_rig.py` | the app on **:8129** with `DATA_DIR`/`AUTH_DB_PATH` pinned into a sandbox and every scheduler flag `0`. ⛔ **Not port 8077** — that has held a stale backend on the owner's LIVE `C:\data`, and `C:\data` exists on this box. |
| `fixture_server.py` | serves exactly one path, `/v2.pine` on **:8124**, with CORS, so the member's real Import door can be driven with the byte-identical fixture. A directory server on the repo root would put every file on this box behind an unauthenticated port for the length of a screenshot. |
| `focus_tab.ps1` | finds the Chrome window holding a given page and activates its tab. ⚠️ `Ctrl+2` is not enough: the MCP window holds tabs outside its group, so the reliable move is to enumerate every Chrome window, focus each, send `^1`…`^9`, and stop when the window TITLE matches. |

## ⚰️ The sandbox path is a refusal, not a convention

`boot_rig.py` resolved its sandbox as `__file__.parent / "rig-data"`. Correct in a
scratchpad; **a trap the moment it was committed here** — running it in place
would write `auth.db`, a bars cache and a dozen marker files into
`docs/pine/wip/rig/rig-data/`, inside the repo, dirtying a tree whose cleanliness
is the resume contract. Caught before it ran, on the first resume after the reboot
that committed it.

So the path is `UCT_RIG_DATA` with an outside-the-repo default, and a sandbox that
resolves inside **any** git worktree is **REFUSED** with the worktree named — the
same blast-radius rule the pytest runner follows for `C:\data`. Rail:
`tests/test_rig_sandbox_never_inside_a_worktree.py`, including the non-vacuity
case. `rig-data/` is in `.gitignore` as a second layer, so an older copy of the
script cannot dirty the tree either.

## ⭐ The sandbox can survive a reboot

Windows does not clear `%TEMP%` on restart, and a resumed session can carry the
same session id — so the scratchpad, the sandbox DB, the rig account and any
installed definitions may all still be there. **Check before recreating**: a
resume that reinstalls unconditionally throws away the state it was about to
verify. Measured 2026-09-13 — both v2 definitions and their chart instances
survived the reboot intact.
