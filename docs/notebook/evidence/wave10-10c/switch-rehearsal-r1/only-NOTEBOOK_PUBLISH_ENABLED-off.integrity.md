# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 20:59:08`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 50039965b7bf139d2fe7b2de65c33962
- `2026-09-26 20:59:55`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 21:01:46`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 21:01:53`  **shutdown** — C:\data, 62 db files — CLEAN
