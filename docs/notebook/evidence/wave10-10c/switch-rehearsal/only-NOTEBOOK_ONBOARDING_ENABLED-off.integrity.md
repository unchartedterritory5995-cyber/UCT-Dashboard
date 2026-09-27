# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 19:32:10`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10c; identity = 20e833ad4b07f316c43e39af6f4d1ed5
- `2026-09-26 19:32:48`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:34:40`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 19:34:46`  **shutdown** — C:\data, 62 db files — CLEAN
