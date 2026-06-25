# Teams Meeting Recorder

Auto-records Microsoft Teams calls on your Mac, transcribes them with Whisper,
and ingests the transcript into your local KnowledgeBase so you can search your
meeting history.

## How it works

```
Teams call starts
      ↓
macOS system audio → BlackHole virtual device → ffmpeg records .wav
      ↓  (call ends)
Whisper transcribes locally  →  timestamped .txt transcript
      ↓
KnowledgeBase /upload  →  chunked + embedded into pgvector
      ↓
Search "what did we decide about X" in the KB UI
```

## Setup (one-time)

### 1. Install BlackHole (virtual audio driver)

```bash
brew install blackhole-2ch
```

After install, open **Audio MIDI Setup** (Spotlight → "Audio MIDI Setup"):

1. Click **+** at the bottom left → **Create Multi-Output Device**
2. Tick both **BlackHole 2ch** and your normal output (speakers/headphones)
3. Right-click the new Multi-Output Device → **Use This Device For Sound Output**

> This lets you hear the call AND capture it at the same time.

### 2. Install ffmpeg (if not already)

```bash
brew install ffmpeg
```

### 3. Install Python dependencies

```bash
cd /path/to/KnowledgeBase
.venv/bin/pip install openai-whisper psutil
```

### 4. Configure

```bash
cp recorder/.env.example recorder/.env
# Edit recorder/.env if needed (defaults work out of the box)
```

### 5. Grant microphone + screen recording permissions

macOS will prompt the first time. If it doesn't:  
**System Settings → Privacy & Security → Microphone** → enable Terminal (or your IDE).

---

## Running

### Auto-watch mode (recommended)
Starts watching for Teams calls. Records automatically when a call is detected.

```bash
cd /path/to/KnowledgeBase
.venv/bin/python recorder/teams_recorder.py
```

Options:
```
--device "BlackHole 2ch"   audio device name (default: BlackHole 2ch)
--model  base              whisper model: tiny/base/small/medium/large
```

### Transcribe an existing recording
If you already have a .wav file:

```bash
.venv/bin/python recorder/teams_recorder.py --transcribe-only ~/recordings/meeting.wav
```

---

## Finding your audio device name

```bash
ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -A30 "AVFoundation audio"
```

Look for `BlackHole 2ch` in the output. If it shows as a different name, update
`AUDIO_DEVICE` in `recorder/.env`.

---

## After a meeting

Transcripts are saved to `~/recordings/` as `.txt` files alongside the `.wav`.
They're automatically ingested into your KnowledgeBase — just open the UI and
search:

> *"what did we decide about the launch date?"*  
> *"summarise action items from the standup"*  
> *"who is responsible for the migration?"*

---

## Whisper model guide

| Model  | Speed (M2) | Accuracy | RAM  |
|--------|-----------|----------|------|
| tiny   | ~10x RT   | OK       | 1 GB |
| base   | ~7x RT    | Good     | 1 GB |
| small  | ~4x RT    | Great    | 2 GB |
| medium | ~2x RT    | Excellent| 5 GB |
| large  | ~1x RT    | Best     | 10 GB|

RT = real-time. "7x RT" means a 60-min meeting transcribes in ~9 min.

---

## Legal reminder

Always inform meeting participants that the call is being recorded.
Check your local laws — many jurisdictions require all-party consent.
