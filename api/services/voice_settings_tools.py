"""
Voice-driven settings writes — let the user change their assistant voice,
playback speed, etc. by speaking.

All writes go through the existing voice_settings_service so the same
validation runs as the Settings UI.
"""

import logging

from api.services.voice_settings_service import (
    ALLOWED_VOICES, MIN_SPEED, MAX_SPEED, update_voice_settings,
    get_voice_settings,
)

_log = logging.getLogger(__name__)


# Voice transcription is messy — these aliases catch what users actually say.
_VOICE_ALIASES = {
    "natural": "verse",
    "professional": "alloy",
    "warm": "shimmer",
    "default": "verse",
    "male": "verse",
    "female": "shimmer",
}


def change_voice_setting(*, field: str, value, user_id: str) -> dict:
    """
    Change one voice setting. `field` ∈ {voice, speed, enabled}. `value` is
    a string for voice/enabled and a number for speed (also tolerates
    'normal'/'faster'/'slower' for speed).
    """
    f = (field or "").strip().lower()
    if f not in ("voice", "speed", "enabled"):
        return {
            "ok": False,
            "narration": (
                f"I can change 'voice', 'speed', or 'enabled' — not {field!r}."
            ),
        }

    if f == "voice":
        v = str(value or "").strip().lower()
        v = _VOICE_ALIASES.get(v, v)
        if v not in ALLOWED_VOICES:
            return {
                "ok": False,
                "narration": (
                    f"I don't know voice {value!r}. Choose one of "
                    f"{', '.join(sorted(ALLOWED_VOICES))}."
                ),
            }
        try:
            updated = update_voice_settings(user_id, voice=v)
        except ValueError as e:
            return {"ok": False, "narration": str(e)}
        return {"ok": True, "narration": f"Switched voice to {v}.",
                "settings": updated}

    if f == "speed":
        # Numeric speed
        speed = None
        if isinstance(value, (int, float)):
            speed = float(value)
        elif isinstance(value, str):
            s = value.strip().lower()
            named = {
                "normal": 1.0, "default": 1.0,
                "slow": 0.8, "slower": 0.8,
                "fast": 1.25, "faster": 1.25,
                "very fast": 1.5, "very slow": 0.6,
            }
            if s in named:
                speed = named[s]
            else:
                try:
                    speed = float(s)
                except ValueError:
                    pass
        if speed is None:
            return {"ok": False,
                    "narration": "Tell me a speed like 'normal', 'faster', or a number between 0.5 and 2."}
        if not (MIN_SPEED <= speed <= MAX_SPEED):
            return {"ok": False,
                    "narration": f"Speed must be between {MIN_SPEED} and {MAX_SPEED}."}
        try:
            updated = update_voice_settings(user_id, speed=speed)
        except ValueError as e:
            return {"ok": False, "narration": str(e)}
        return {"ok": True, "narration": f"Set speed to {speed}.",
                "settings": updated}

    # enabled
    if f == "enabled":
        v = value
        if isinstance(v, str):
            v = v.strip().lower() in ("yes", "true", "on", "enable", "enabled")
        v = bool(v)
        try:
            updated = update_voice_settings(user_id, enabled=v)
        except ValueError as e:
            return {"ok": False, "narration": str(e)}
        return {"ok": True,
                "narration": f"Voice {'enabled' if v else 'disabled'}.",
                "settings": updated}

    return {"ok": False, "narration": "Unrecognized setting."}


def list_voice_settings(*, user_id: str) -> dict:
    """Read back the user's current voice settings."""
    s = get_voice_settings(user_id) or {}
    parts = [
        f"voice {s.get('voice')}",
        f"speed {s.get('speed')}",
        f"{'enabled' if s.get('enabled') else 'disabled'}",
    ]
    return {
        "ok": True,
        "narration": "Voice settings — " + ", ".join(parts) + ".",
        "settings": s,
    }
