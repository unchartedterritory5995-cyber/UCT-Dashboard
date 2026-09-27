# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 12:28:25`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w8walk-341; identity = a0a8f018a19c687cf34849c0de3c373e
- `2026-09-26 12:29:14`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 12:31:06`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 12:32:17`  **shutdown** — C:\data, 62 db files — CLEAN
