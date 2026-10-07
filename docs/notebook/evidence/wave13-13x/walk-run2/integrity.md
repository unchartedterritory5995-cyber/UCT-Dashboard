# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 10:11:47`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\w13x-walk-data2; identity = 0ae2bef53e488002644dadc809f642ca
- `2026-10-03 10:13:11`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 10:15:08`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 10:17:49`  **shutdown** — C:\data, 62 db files — CLEAN
