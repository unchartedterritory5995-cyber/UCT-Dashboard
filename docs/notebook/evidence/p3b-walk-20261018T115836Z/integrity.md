tip under test: fc2453c8b0

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 06:58:43`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p3bwalk2; identity = 162df9ea8e7831aeda89f50fd8b3da6d
- `2026-10-18 06:59:16`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 07:01:06`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 07:01:14`  **shutdown** — C:\data, 62 db files — CLEAN
