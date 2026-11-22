tip under test: 141c001088 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-11-13 09:22:08`  **pre-boot (baseline)** — C:\data, 63 db files — CLEAN
    - sandbox = <temp>\ff2-held-141c001088\data\c2; identity = 78179f38704983a22446b7574851d456
- `2026-11-13 09:23:09`  **post-boot (+15s)** — C:\data, 63 db files — CLEAN
- `2026-11-13 09:25:11`  **post-prewarm (+120s)** — C:\data, 63 db files — CLEAN
