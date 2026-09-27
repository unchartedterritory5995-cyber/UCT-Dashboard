# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 21:04:48`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10b; identity = 3b1f523db5f267480fa71b742c33b686
- `2026-09-26 21:05:25`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 21:06:35`  **shutdown** — C:\data, 62 db files — CLEAN
