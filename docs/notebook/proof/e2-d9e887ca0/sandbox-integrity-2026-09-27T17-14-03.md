# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 17:14:08`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10e2; identity = 294f458d684141c477d1295b77c6ecec
- `2026-09-27 17:14:45`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 17:16:36`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 19:38:57`  **shutdown** — C:\data, 62 db files — CLEAN
