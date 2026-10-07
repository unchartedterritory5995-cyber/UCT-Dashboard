# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 07:10:20`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-a11y; identity = 781cb41b6492d430d2a59fd550e569ff
- `2026-10-07 07:11:11`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:13:13`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
