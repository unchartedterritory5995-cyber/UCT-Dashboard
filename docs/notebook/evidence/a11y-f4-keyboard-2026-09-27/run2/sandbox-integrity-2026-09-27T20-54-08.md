# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 20:54:14`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10f4; identity = 440c9d35af4b904882983ca4681133d9
- `2026-09-27 20:55:18`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 20:57:10`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 20:59:50`  **shutdown** — C:\data, 62 db files — CLEAN
