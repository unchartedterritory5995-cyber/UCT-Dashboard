tip under test: e7af2f560f (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 19:50:02`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-forkdiag-branch2\c2; identity = f5ee65259f4453bfc28210da1d92a7e7
- `2026-10-15 19:51:08`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 19:53:01`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 19:53:54`  **shutdown** — C:\data, 62 db files — CLEAN
