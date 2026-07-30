"""
transcriber.py — speech-to-text for uploaded audio/video files.

Uses the Groq Whisper API (whisper-large-v3-turbo) which accepts:
  mp3, mp4, mpeg, mpga, m4a, wav, webm  (max 25 MB per request)

Falls back to OpenAI's transcription endpoint if OPENAI_BASE_URL is not
pointing at Groq (i.e. any OpenAI-compatible endpoint works).

Required env vars (already present in the WorkTrace secrets):
    OPENAI_API_KEY    — Groq or OpenAI API key
    OPENAI_BASE_URL   — defaults to https://api.groq.com/openai/v1

The transcription is returned as a plain string of prose text, which the
normal chunking pipeline in extractors.py then splits into KB chunks.
"""
from __future__ import annotations

import pathlib
import logging

import httpx

log = logging.getLogger(__name__)

# Whisper model to use.  groq supports:
#   whisper-large-v3          (most accurate, slower)
#   whisper-large-v3-turbo    (fast, nearly as accurate — preferred)
_WHISPER_MODEL = "whisper-large-v3-turbo"

# Groq transcription endpoint path (relative to OPENAI_BASE_URL)
_TRANSCRIPTION_PATH = "/audio/transcriptions"

# MIME types for each supported extension
_AUDIO_MIME: dict[str, str] = {
    ".mp3":  "audio/mpeg",
    ".mp4":  "video/mp4",
    ".mpeg": "video/mpeg",
    ".mpga": "audio/mpeg",
    ".m4a":  "audio/mp4",
    ".wav":  "audio/wav",
    ".webm": "audio/webm",
}


def transcribe(path: pathlib.Path) -> str:
    """
    Send *path* to the Groq Whisper API and return the full transcript as
    a plain string.

    Raises RuntimeError if OPENAI_API_KEY is not set or the API call fails.
    """
    # Import here to avoid a circular import with config at module load time
    from kb.config import OPENAI_API_KEY, OPENAI_BASE_URL  # noqa: PLC0415

    if not OPENAI_API_KEY:
        raise RuntimeError(
            "OPENAI_API_KEY is not set — needed for Groq Whisper transcription."
        )

    suffix = path.suffix.lower()
    mime   = _AUDIO_MIME.get(suffix, "application/octet-stream")
    base   = OPENAI_BASE_URL.rstrip("/")
    url    = f"{base}{_TRANSCRIPTION_PATH}"

    log.info("Transcribing %s (%s) via %s", path.name, mime, url)

    with path.open("rb") as fh:
        resp = httpx.post(
            url,
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            files={"file": (path.name, fh, mime)},
            data={
                "model":           _WHISPER_MODEL,
                "response_format": "text",   # returns plain text, not JSON
            },
            timeout=300,   # large files can take a while
        )

    if resp.status_code != 200:
        raise RuntimeError(
            f"Whisper API error {resp.status_code}: {resp.text[:400]}"
        )

    transcript = resp.text.strip()
    log.info("Transcription complete: %d characters", len(transcript))
    return transcript
