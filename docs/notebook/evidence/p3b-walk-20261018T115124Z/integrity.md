tip under test: fbe16db253

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 06:51:31`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p3bwalk; identity = 64b6f62462a353661177343beb2bd76f
- `2026-10-18 06:52:03`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 06:53:54`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 06:57:20`  **shutdown** — C:\data, 62 db files — CLEAN
