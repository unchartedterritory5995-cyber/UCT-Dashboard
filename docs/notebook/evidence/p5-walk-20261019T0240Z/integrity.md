tip under test: 73e772f363

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 21:40:55`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p5final; identity = f4b5724adcd9de2c6f7aa00db357b77e
- `2026-10-18 21:41:28`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 21:43:20`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 21:48:47`  **shutdown** — C:\data, 62 db files — CLEAN
