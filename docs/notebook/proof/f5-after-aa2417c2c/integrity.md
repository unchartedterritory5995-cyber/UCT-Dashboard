# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 20:49:01`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10f5; identity = 2541fb32954d1d51add303aec22c8eac
- `2026-09-27 20:50:48`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 20:52:40`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 21:14:32`  **shutdown** — C:\data, 62 db files — CLEAN
