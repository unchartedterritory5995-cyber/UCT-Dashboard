"""What is actually on the notebook attachment volume, and how much room is left.

Run BEFORE opening any connector to members. Its output sets the import
media budget -- which is why no budget number is hard-coded anywhere yet.

READ-ONLY: os.walk + shutil.disk_usage only. Never creates, moves, or deletes
anything -- safe to run against a live data root.

Usage: python tools/notebook_volume_report.py
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services.journal_two.attachment_root import (  # noqa: E402
    attachment_root as _attachment_root,
    existing_ancestor as _existing_ancestor,
)


def main() -> None:
    root = _attachment_root()
    total = files = 0
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, fn))
            except OSError:
                continue
            files += 1
    root_existed = os.path.isdir(root)
    usage_path = str(root) if root_existed else str(_existing_ancestor(root))
    usage = shutil.disk_usage(usage_path)
    print(f"attachment root : {root}")
    if not root_existed:
        print(f"                  (does not exist yet -- measured nearest existing ancestor: {usage_path})")
    print(f"files           : {files:,}")
    print(f"attachment bytes: {total:,} ({total / 1e9:.2f} GB)")
    print(f"volume total    : {usage.total / 1e9:.2f} GB")
    print(f"volume free     : {usage.free / 1e9:.2f} GB")
    if files:
        print(f"mean bytes/file : {total // files:,}")


if __name__ == "__main__":
    main()
