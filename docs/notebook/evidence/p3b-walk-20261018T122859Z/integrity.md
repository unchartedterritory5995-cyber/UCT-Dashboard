tip under test: 8e4dedc998

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 07:29:06`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p3bwalk6; identity = c58d99e45d2cb7c086e1399208354f87
- `2026-10-18 07:29:46`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 07:31:37`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 07:32:04`  **shutdown** — C:\data, 62 db files — CLEAN
