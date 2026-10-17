tip under test: 0616828caa (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-17 11:04:58`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p4a-walk2\c2; identity = 610e9767d9f4b9625545054e9edee335
- `2026-10-17 11:05:34`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 11:07:26`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 11:08:06`  **shutdown** — C:\data, 62 db files — CLEAN
