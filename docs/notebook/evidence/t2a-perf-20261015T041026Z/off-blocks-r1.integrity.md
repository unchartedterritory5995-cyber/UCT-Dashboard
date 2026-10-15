# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 23:41:17`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-off-blocks-r1; identity = 56a184479b584e3aeeddedf1b06fabf6
- `2026-10-14 23:42:09`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 23:42:34`  **shutdown** — C:\data, 62 db files — CLEAN
