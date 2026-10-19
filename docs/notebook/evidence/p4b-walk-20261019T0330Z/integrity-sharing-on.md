tip under test: d2ee472060

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 22:02:18`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p4bwalk2; identity = 8c6def741659bfb08bac03b0decfa810
- `2026-10-18 22:02:50`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 22:04:41`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 22:10:19`  **shutdown** — C:\data, 62 db files — CLEAN
