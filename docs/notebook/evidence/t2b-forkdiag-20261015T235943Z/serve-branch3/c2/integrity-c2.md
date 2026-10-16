tip under test: e7af2f560f (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 20:08:04`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-forkdiag-branch3\c2; identity = 7820625c0a10dc86541f7c3abf45d830
- `2026-10-15 20:08:46`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 20:10:39`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 20:14:58`  **shutdown** — C:\data, 62 db files — CLEAN
