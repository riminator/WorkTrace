#!/usr/bin/env python3
"""
Teams Meeting Recorder
======================
Watches for Microsoft Teams to start a call, records system audio via a
BlackHole virtual audio device, transcribes with Whisper, and ingests the
transcript into your pgvector KnowledgeBase.

Usage
-----
    python recorder/teams_recorder.py [--device "BlackHole 2ch"] [--model base]

Prerequisites
-------------
1. BlackHole virtual audio driver  →  brew install blackhole-2ch
2. Set BlackHole as a Multi-Output Device in macOS Audio MIDI Setup
   (so you still hear audio while recording — see README)
3. ffmpeg                          →  brew install ffmpeg
4. openai-whisper + psutil         →  pip install openai-whisper psutil
5. KnowledgeBase backend running   →  used for ingest

Environment
-----------
Set in recorder/.env or export before running:
    KB_INGEST_URL   URL of the KnowledgeBase upload endpoint
                    (default: http://localhost:8000/upload)
    WHISPER_MODEL   Whisper model size: tiny/base/small/medium/large
                    (default: base — good balance of speed/accuracy on M-series)
    AUDIO_DEVICE    ffmpeg audio device name (default: BlackHole 2ch)
    RECORDINGS_DIR  Where to save .wav + .txt files (default: ~/recordings)
"""
from __future__ import annotations

import argparse
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Optional

import psutil

# ── optional: load .env from recorder/ ───────────────────────────────────────
_ENV_FILE = pathlib.Path(__file__).parent / ".env"
if _ENV_FILE.exists():
    from dotenv import load_dotenv
    load_dotenv(_ENV_FILE)

# ── config ────────────────────────────────────────────────────────────────────
KB_INGEST_URL: str  = os.getenv("KB_INGEST_URL",  "http://localhost:8000/upload")
WHISPER_MODEL: str  = os.getenv("WHISPER_MODEL",  "base")
AUDIO_DEVICE: str   = os.getenv("AUDIO_DEVICE",   "BlackHole 2ch")
RECORDINGS_DIR      = pathlib.Path(os.getenv("RECORDINGS_DIR", pathlib.Path.home() / "recordings")).expanduser()
POLL_INTERVAL: int  = int(os.getenv("POLL_INTERVAL", "5"))   # seconds between Teams checks

# Teams process names on macOS
TEAMS_PROCESS_NAMES = {"MSTeams", "Microsoft Teams", "Microsoft Teams (work or school)"}

RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# Process detection
# ─────────────────────────────────────────────────────────────────────────────

def _teams_pids() -> list[int]:
    """Return PIDs of any running Teams process."""
    pids = []
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            if any(name in proc.info["name"] for name in TEAMS_PROCESS_NAMES):
                pids.append(proc.info["pid"])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return pids


def _is_teams_in_call() -> bool:
    """
    Detect an active Teams call using two methods in order:

    1. UDP connections — Teams opens UDP sockets for media. Requires elevated
       permissions on macOS; falls through to method 2 if AccessDenied.
    2. Audio device via lsof — Teams opens the CoreAudio HAL during a call.
       Works without elevated permissions on macOS.
    """
    pids = _teams_pids()
    if not pids:
        return False

    # Method 1: UDP connections
    try:
        conns = psutil.net_connections(kind="udp")
        teams_pids = set(pids)
        if any(c.pid in teams_pids for c in conns):
            return True
    except (psutil.AccessDenied, AttributeError):
        pass  # fall through to method 2

    # Method 2: check if any Teams process has an active pipe to coreaudiod,
    # which only appears when audio is actually streaming (i.e. in a call).
    # We look for lines where the file type is a pipe/socket (not a loaded .dylib)
    # and the name contains coreaudiod.
    try:
        pid_args = []
        for pid in pids:
            pid_args += ["-p", str(pid)]
        result = subprocess.run(
            ["lsof", "-F", "ptn"] + pid_args,
            capture_output=True, text=True, timeout=5,
        )
        # -F ptn outputs fields: p=pid, t=type, n=name, one per line.
        # Active audio shows up as a unix socket to coreaudiod, NOT a txt/dylib entry.
        current_type = ""
        for line in result.stdout.splitlines():
            if line.startswith("t"):
                current_type = line[1:].lower()  # file type: REG, CHR, unix, PIPE, etc.
            elif line.startswith("n") and current_type not in ("reg", ""):
                # Only match non-regular-file entries (sockets, pipes, char devices)
                name = line[1:].lower()
                if "coreaudiod" in name or "/dev/dsp" in name:
                    return True
        return False
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Audio recording via ffmpeg + BlackHole
# ─────────────────────────────────────────────────────────────────────────────

class Recorder:
    def __init__(self, device: str = AUDIO_DEVICE) -> None:
        self.device = device
        self._proc: Optional[subprocess.Popen] = None
        self._output_path: Optional[pathlib.Path] = None

    def start(self) -> pathlib.Path:
        if self._proc and self._proc.poll() is None:
            raise RuntimeError("Already recording")

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        self._output_path = RECORDINGS_DIR / f"teams_{ts}.wav"

        # avfoundation input: :<device_index_or_name>
        # -ac 2 = stereo, -ar 44100 = sample rate
        cmd = [
            "ffmpeg", "-y",
            "-f", "avfoundation",
            "-i", f":{self.device}",
            "-ac", "2",
            "-ar", "44100",
            str(self._output_path),
        ]
        print(f"[recorder] Starting capture → {self._output_path}")
        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return self._output_path

    def stop(self) -> Optional[pathlib.Path]:
        if not self._proc:
            return None
        # Send 'q' to ffmpeg stdin for a clean shutdown (writes file headers)
        try:
            self._proc.stdin.write(b"q")
            self._proc.stdin.flush()
            self._proc.wait(timeout=10)
        except Exception:
            self._proc.terminate()
            self._proc.wait()

        path = self._output_path
        self._proc = None
        self._output_path = None
        print(f"[recorder] Recording saved → {path}")
        return path

    @property
    def is_recording(self) -> bool:
        return self._proc is not None and self._proc.poll() is None


# ─────────────────────────────────────────────────────────────────────────────
# Transcription via Whisper
# ─────────────────────────────────────────────────────────────────────────────

def transcribe(audio_path: pathlib.Path, model_name: str = WHISPER_MODEL) -> pathlib.Path:
    """
    Transcribe *audio_path* with Whisper.
    Returns the path to the saved .txt transcript.
    """
    import whisper  # lazy import — only needed at transcription time

    print(f"[transcriber] Loading Whisper model '{model_name}' …")
    model = whisper.load_model(model_name)

    print(f"[transcriber] Transcribing {audio_path.name} …")
    result = model.transcribe(str(audio_path), fp16=False, verbose=False)

    transcript_path = audio_path.with_suffix(".txt")
    segments = result.get("segments", [])

    with open(transcript_path, "w", encoding="utf-8") as f:
        f.write(f"Meeting recording: {audio_path.stem}\n")
        f.write(f"Transcribed: {datetime.now(tz=timezone.utc).isoformat()}\n")
        f.write(f"Duration: {_format_duration(result.get('segments', []))}\n")
        f.write("=" * 60 + "\n\n")

        if segments:
            for seg in segments:
                start = _fmt_ts(seg["start"])
                text  = seg["text"].strip()
                f.write(f"[{start}] {text}\n")
        else:
            # Fallback: plain text with no timestamps
            f.write(result.get("text", "").strip())

    print(f"[transcriber] Transcript saved → {transcript_path}")
    return transcript_path


def _fmt_ts(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _format_duration(segments: list) -> str:
    if not segments:
        return "unknown"
    total = segments[-1].get("end", 0)
    return _fmt_ts(total)


# ─────────────────────────────────────────────────────────────────────────────
# Ingest into KnowledgeBase
# ─────────────────────────────────────────────────────────────────────────────

def ingest_transcript(transcript_path: pathlib.Path) -> bool:
    """
    POST the transcript file to the KnowledgeBase /upload endpoint.
    Returns True on success.
    """
    import httpx

    print(f"[ingest] Uploading {transcript_path.name} → {KB_INGEST_URL}")
    try:
        with open(transcript_path, "rb") as f:
            resp = httpx.post(
                KB_INGEST_URL,
                files={"file": (transcript_path.name, f, "text/plain")},
                data={"force": "false"},
                timeout=60.0,
            )
        resp.raise_for_status()
        print(f"[ingest] ✓ Ingested — {resp.json()}")
        return True
    except Exception as exc:
        print(f"[ingest] ✗ Failed to ingest: {exc}")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Main watcher loop
# ─────────────────────────────────────────────────────────────────────────────

def _check_ffmpeg() -> None:
    if subprocess.run(["which", "ffmpeg"], capture_output=True).returncode != 0:
        sys.exit("[error] ffmpeg not found. Run: brew install ffmpeg")


def _check_blackhole(device: str) -> None:
    """Warn if the requested audio device isn't visible to ffmpeg."""
    result = subprocess.run(
        ["ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
        capture_output=True, text=True
    )
    combined = result.stdout + result.stderr
    if device not in combined:
        print(f"[warn] Audio device '{device}' not found in avfoundation device list.")
        print("[warn] Available audio devices:")
        for line in combined.splitlines():
            if "AVFoundation audio" in line or "] [" in line:
                print(" ", line)
        print(f"\n[warn] Install BlackHole: brew install blackhole-2ch")
        print("[warn] Then set up a Multi-Output Device in Audio MIDI Setup.")
        print("[warn] Continuing anyway — recording may fail.\n")


def watch(device: str = AUDIO_DEVICE, model: str = WHISPER_MODEL) -> None:
    """
    Main loop. Polls for Teams calls and records/transcribes automatically.
    """
    _check_ffmpeg()
    _check_blackhole(device)

    recorder = Recorder(device=device)
    in_call   = False

    print(f"[watcher] Monitoring for Teams calls … (Ctrl+C to stop)")
    print(f"[watcher] Audio device : {device}")
    print(f"[watcher] Whisper model: {model}")
    print(f"[watcher] Recordings   : {RECORDINGS_DIR}\n")

    def _handle_stop(sig, frame):
        print("\n[watcher] Interrupted — stopping.")
        if recorder.is_recording:
            audio = recorder.stop()
            if audio and audio.exists():
                _post_process(audio, model)
        sys.exit(0)

    signal.signal(signal.SIGINT,  _handle_stop)
    signal.signal(signal.SIGTERM, _handle_stop)

    while True:
        currently_in_call = _is_teams_in_call()

        if currently_in_call and not in_call:
            # Call just started
            print(f"\n[watcher] Teams call detected — recording started")
            recorder.start()
            in_call = True

        elif not currently_in_call and in_call:
            # Call just ended
            print(f"[watcher] Teams call ended")
            audio = recorder.stop()
            in_call = False
            if audio and audio.exists():
                _post_process(audio, model)

        time.sleep(POLL_INTERVAL)


def _post_process(audio_path: pathlib.Path, model: str) -> None:
    """Transcribe and ingest a finished recording."""
    print(f"[watcher] Post-processing {audio_path.name} …")
    try:
        transcript = transcribe(audio_path, model_name=model)
        ingest_transcript(transcript)
        print(f"[watcher] ✓ Done — transcript searchable in your KnowledgeBase\n")
    except Exception as exc:
        print(f"[watcher] ✗ Post-processing failed: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def _record_now(device: str, model: str) -> None:
    """Start recording immediately, stop and transcribe on Ctrl+C."""
    recorder = Recorder(device=device)
    audio_path = recorder.start()
    print(f"[recorder] Recording started. Press Ctrl+C to stop.")

    def _stop(sig, frame):
        print("\n[recorder] Stopping…")
        audio = recorder.stop()
        if audio and audio.exists():
            _post_process(audio, model)
        sys.exit(0)

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    # Block until signal
    while True:
        time.sleep(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Auto-record Teams calls → transcribe → ingest into KnowledgeBase"
    )
    parser.add_argument(
        "--device", default=AUDIO_DEVICE,
        help="avfoundation audio device name (default: BlackHole 2ch)"
    )
    parser.add_argument(
        "--model", default=WHISPER_MODEL,
        choices=["tiny", "base", "small", "medium", "large"],
        help="Whisper model size (default: base)"
    )
    parser.add_argument(
        "--record",
        action="store_true",
        help="Start recording immediately without waiting to detect a Teams call"
    )
    parser.add_argument(
        "--transcribe-only",
        metavar="AUDIO_FILE",
        help="Skip watching — just transcribe an existing .wav file and ingest it"
    )
    args = parser.parse_args()

    if args.transcribe_only:
        path = pathlib.Path(args.transcribe_only)
        if not path.exists():
            sys.exit(f"File not found: {path}")
        transcript = transcribe(path, model_name=args.model)
        ingest_transcript(transcript)
        return

    if args.record:
        _record_now(device=args.device, model=args.model)
        return

    watch(device=args.device, model=args.model)


if __name__ == "__main__":
    main()
