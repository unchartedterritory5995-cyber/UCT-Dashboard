# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 10:00:16`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\w13q4-run1; identity = 39c1444aae461830426143a15bad5680
- `2026-10-03 10:01:43`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 10:03:42`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 10:16:17`  **shutdown** — C:\data, 62 db files — CLEAN
