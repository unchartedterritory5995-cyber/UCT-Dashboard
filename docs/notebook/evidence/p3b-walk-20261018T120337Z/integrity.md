tip under test: 66300c7c68

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 07:03:44`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p3bwalk3; identity = d978458129711617e8971ac9cd751c34
- `2026-10-18 07:04:16`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 07:06:07`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 07:06:15`  **shutdown** — C:\data, 62 db files — CLEAN
