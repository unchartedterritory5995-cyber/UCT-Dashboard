tip under test: 00b9041847

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 20:45:35`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p5walk5; identity = b8489aeadc049d2271ba0828f58b5f9c
- `2026-10-18 20:46:24`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 20:48:18`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 20:52:15`  **shutdown** — C:\data, 62 db files — CLEAN
