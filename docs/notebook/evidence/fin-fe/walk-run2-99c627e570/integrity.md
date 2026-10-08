# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-06 23:02:10`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\run2; identity = cc9cb222ebe0172d085f481b8584db38
- `2026-10-06 23:03:07`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 23:05:02`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 23:06:29`  **shutdown** — C:\data, 62 db files — CLEAN
