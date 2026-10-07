# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 05:21:07`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\w13f-final-on-6c95593ca8de6597acf3b2066015854d1076ff6a; identity = 55af80fc6c1e9a781d3632b8cc444bc4
- `2026-10-03 05:21:44`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 05:23:36`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 05:23:43`  **shutdown** — C:\data, 62 db files — CLEAN
