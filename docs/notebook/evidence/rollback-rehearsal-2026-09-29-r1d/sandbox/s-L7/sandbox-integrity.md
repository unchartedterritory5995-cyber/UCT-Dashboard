# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 18:36:08`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10r1d; identity = df45c1693b2bbb26632ea6799af2108c
- `2026-09-29 18:38:02`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 18:39:56`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 18:40:05`  **shutdown** — C:\data, 62 db files — CLEAN
