# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 12:18:22`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10d2; identity = 874b82cf51012a6c44cf349a75d9a757
- `2026-09-28 12:19:20`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 12:21:16`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 12:22:14`  **shutdown** — C:\data, 62 db files — CLEAN
