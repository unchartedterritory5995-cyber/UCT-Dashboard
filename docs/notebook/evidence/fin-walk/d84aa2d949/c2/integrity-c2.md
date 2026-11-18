tip under test: d84aa2d949 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-11-13 01:30:13`  **pre-boot (baseline)** — C:\data, 63 db files — CLEAN
    - sandbox = <temp>\t4-full-d84aa2d949\data\c2; identity = dd455f956380e1aed0886e9c526a2eb1
- `2026-11-13 01:30:48`  **post-boot (+15s)** — C:\data, 63 db files — CLEAN
- `2026-11-13 01:32:39`  **post-prewarm (+120s)** — C:\data, 63 db files — CLEAN
