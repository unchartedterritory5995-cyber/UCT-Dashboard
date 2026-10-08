# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 05:24:27`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\w13f-final-off-6c95593ca8de6597acf3b2066015854d1076ff6a; identity = c031b83856e34dd9847a64129230eb49
- `2026-10-03 05:25:12`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 05:27:04`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 05:27:13`  **shutdown** — C:\data, 62 db files — CLEAN
