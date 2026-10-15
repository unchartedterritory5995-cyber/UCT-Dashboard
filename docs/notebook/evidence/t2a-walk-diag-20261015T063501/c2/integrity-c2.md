tip under test: c57a084a08 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 06:35:12`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-walk\c2; identity = cb5015a1e5f742b9db100a52682c48fc
- `2026-10-15 06:35:50`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 06:37:43`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 06:37:51`  **shutdown** — C:\data, 62 db files — CLEAN
