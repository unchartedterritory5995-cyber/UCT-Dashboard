tip under test: 13f1b01f5e (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-11-12 17:32:44`  **pre-boot (baseline)** — C:\data, 63 db files — CLEAN
    - sandbox = <temp>\nb-golive2\final3-data\c2; identity = a7965309659bed408547521de11d7d30
- `2026-11-12 17:33:26`  **post-boot (+15s)** — C:\data, 63 db files — CLEAN
- `2026-11-12 17:35:24`  **post-prewarm (+120s)** — C:\data, 63 db files — CLEAN
