tip under test: 4649e2d03e (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 19:32:18`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-forkdiag-base\c2; identity = 9815187e06c3af7c1e1c451f601825dd
- `2026-10-15 19:33:32`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 19:35:29`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 19:44:46`  **shutdown** — C:\data, 62 db files — CLEAN
