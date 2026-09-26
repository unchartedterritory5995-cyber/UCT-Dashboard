# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-25 21:19:00`  **pre-boot (baseline)** — C:\data, 61 db files — CLEAN
    - sandbox = C:\data-186walk
- `2026-09-25 21:19:46`  **post-boot (+15s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 21:21:39`  **post-prewarm (+120s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 21:2x`  **shutdown** — the launcher's own checkpoint was NOT written: the Ctrl+C sent to its console also reached the parent PowerShell, which ended the process before `finally` ran. Replacement check, weaker and labelled as such: `Get-ChildItem C:\data -Recurse -Filter *.db` → 61 main `.db` files, **0 with LastWriteTime after the 21:19:00 baseline**; launcher PID 19404 gone; port 8093 no listener. (mtime of a MAIN `.db` file is used, never a `-wal`/`-shm` sidecar.)
