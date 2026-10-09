tip under test: 27d6289b75+fix(blockHandle.js sha256 137ed967) (configuration verifygrip)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-09 17:53:34`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-verify-grip\verifygrip; identity = 7b206b19f0be0bcb9ab36a6fc790d829
- `2026-10-09 17:54:04`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-09 17:55:55`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-09 17:58:36`  **shutdown** — C:\data, 62 db files — CLEAN
