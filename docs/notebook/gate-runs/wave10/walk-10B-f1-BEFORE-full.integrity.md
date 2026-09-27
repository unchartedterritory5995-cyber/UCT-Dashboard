# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 20:58:29`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10b; identity = 5df462ac2fd00290d43fe1c9d0a622a7
- `2026-09-26 20:59:14`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 21:01:07`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 21:01:48`  **shutdown** — C:\data, 62 db files — CLEAN
