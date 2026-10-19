tip under test: d2ee472060

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 22:10:56`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p4bwalk2; identity = 882dd053dab7c1db1dd6126c11761e5f
- `2026-10-18 22:11:28`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 22:13:19`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 22:13:26`  **shutdown** — C:\data, 62 db files — CLEAN
