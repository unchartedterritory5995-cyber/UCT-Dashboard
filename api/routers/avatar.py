"""
Avatar router — upload, serve, and delete user profile avatars.
Stores as /data/avatars/{user_id}.webp (200x200 max, Pillow conversion).
"""

import os
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, UploadFile
from fastapi.responses import FileResponse, Response

from api.middleware.auth_middleware import get_current_user
from api.services import request_body_cap as body_cap

router = APIRouter(prefix="/api/auth", tags=["avatar"])

# `AVATARS_DIR` is the override; its DEFAULT is the literal that has always
# been here, so production with nothing set resolves byte-identically.
AVATAR_DIR = Path(os.environ.get("AVATARS_DIR", "/data/avatars"))
MAX_SIZE = 2 * 1024 * 1024  # 2 MB
TOO_BIG_SENTENCE = "Image must be under 2 MB"
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}

# 1x1 transparent PNG pixel
_TRANSPARENT_PIXEL = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


# ⛔ WAVE 14 (cap 2): the upload is taken through `request_body_cap`, never
# `File(...)`. FastAPI parses a `File(...)` parameter IN FULL before any
# dependency runs -- before the session check -- so a chunked or lying upload was
# spooled whole before its size was measured. The dependency caps the body WHILE
# it is read and is declared AFTER the auth dependency, so an anonymous caller
# reads nothing.
_AVATAR_UPLOAD = body_cap.capped_upload("file", lambda: MAX_SIZE, lambda: TOO_BIG_SENTENCE)


@router.post("/avatar")
async def upload_avatar(
    user: dict = Depends(get_current_user),
    file: UploadFile = Depends(_AVATAR_UPLOAD),
):
    """Upload or replace the authenticated user's avatar."""
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Only JPEG, PNG, and WebP images are allowed")

    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(400, TOO_BIG_SENTENCE)

    # Convert + resize with Pillow
    from PIL import Image
    import io

    img = Image.open(io.BytesIO(data))
    img = img.convert("RGBA")

    # Resize to fit within 200x200, preserving aspect ratio
    img.thumbnail((200, 200), Image.LANCZOS)

    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    out_path = AVATAR_DIR / f"{user['id']}.webp"

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=85)
    out_path.write_bytes(buf.getvalue())

    return {"ok": True, "url": f"/api/auth/avatar/{user['id']}"}


@router.get("/avatar/{user_id}")
async def get_avatar(user_id: str):
    """Serve a user's avatar (public, no auth). Returns transparent pixel if missing."""
    path = AVATAR_DIR / f"{user_id}.webp"
    if path.exists():
        return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=300"})
    return Response(content=_TRANSPARENT_PIXEL, media_type="image/png")


@router.delete("/avatar")
async def delete_avatar(user: dict = Depends(get_current_user)):
    """Remove the authenticated user's avatar."""
    path = AVATAR_DIR / f"{user['id']}.webp"
    if path.exists():
        os.remove(path)
    return {"ok": True}
