# Real-Time Voice Reservation Agent

A voice-driven hotel front-desk agent built on **Amazon Nova Sonic**. You speak to it like a receptionist: it verifies your identity, looks up your reservation in DynamoDB, and modifies it — and you can interrupt it mid-sentence.

Runs from one agent core through two transports: a **terminal client** using a local microphone, and a **Next.js web client** over WebSockets with a live transcript and a sanitized tool-call trace.

**Median response latency: ~0.6s.** You can talk over it.

---

## Why speech-to-speech matters here

Most voice agents are a three-model pipeline:

```
speech → [Whisper] → text → [LLM] → text → [TTS] → speech
```

Three models, three network hops, latency compounding at each stage — typically 2–3 seconds before the user hears anything.

This project uses **Nova Sonic**, a speech-to-speech model. Audio goes in, audio comes out, over a single persistent bidirectional stream. There is no transcription step in the middle.

That architectural difference is why response latency here is measured in **hundreds** of milliseconds rather than seconds.

## Architecture

```mermaid
flowchart LR
    Mic["🎤 Local mic"] --> AS["AudioStreamer<br/>PyAudio"]
    Browser["🌐 Browser<br/>AudioWorklet"] <-->|"WebSocket"| WS["server.py<br/>FastAPI"]
    AS -->|"add_audio_chunk"| BSM["BedrockStreamManager"]
    WS -->|"add_audio_chunk"| BSM
    BSM <-->|"bidirectional stream"| NS["Amazon Nova Sonic"]
    BSM -->|"toolUse"| TP["ToolProcessor"]
    TP <--> DDB[("DynamoDB<br/>Guests · Reservations")]
    TP -->|"toolResult"| BSM
    BSM -->|"audio_output_queue"| AS
    BSM -->|"audio_output_queue"| WS
```

| Component | Responsibility |
|---|---|
| `BedrockStreamManager` | Nova Sonic event protocol — session lifecycle, audio framing, tool handshake, barge-in |
| `ToolProcessor` | Three DynamoDB-backed tools, plus identity verification. Blocking AWS calls run in an executor so the audio loop never stalls |
| `AudioStreamer` | Terminal transport — local microphone and speaker via PyAudio |
| `server.py` | Browser transport — audio plus a structured event stream over one WebSocket |
| `front-end/` | Next.js client — conversation, voice dock, and engineering trace |

The agent core never imports PyAudio. It exposes exactly two seams — `add_audio_chunk()` in, `audio_output_queue` out — which is why a second transport could be added without touching agent logic. A telephony transport (Twilio, Amazon Connect) would attach the same way.

## Audio pipeline

| Direction | Rate | Format | Chunk |
|---|---|---|---|
| Input (mic → model) | 16,000 Hz | mono PCM16 (LPCM), base64 | 1024 frames ≈ **64 ms** |
| Output (model → speaker) | 24,000 Hz | mono PCM16 (LPCM), base64 | 1024 frames |

Both directions are queue-buffered, so audio capture never blocks on the network.

Two details the browser transport required:

**Explicit resampling.** Browsers may ignore a requested 16 kHz `AudioContext` and return their native 48 kHz. Sending those samples labelled as 16 kHz makes Nova Sonic hear speech stretched threefold, and transcription collapses. The worklet reads the real rate at runtime and resamples itself.

**Real-time pacing.** `output_stream.write()` blocks in the terminal version, throttling playback to real time. A WebSocket does not. Nova Sonic generates far faster than speech plays, so forwarding on arrival parks tens of seconds of audio in the browser — and an interruption then has nothing server-side left to discard. The server sends no faster than the audio plays.

### Barge-in

When the guest speaks over the assistant, queued audio is discarded and playback stops mid-word. The browser client can optionally detect speech locally for instant cutoff, rather than waiting for the round trip to AWS — off by default, since on speakers the microphone also hears the agent and it would silence itself.

## Identity verification

The agent will not disclose any reservation or billing detail until `checkGuestProfileTool` confirms the spoken date of birth matches the stored one.

**This is enforced in Python, not in the system prompt** — and that distinction came from testing. The original design returned the stored DOB and asked the model in its prompt to compare and refuse. Under test the model confirmed identity for a wrong date of birth, and then for a guest who did not exist in the database at all. Asked directly whether it had checked, it said yes.

Enforcement now lives in the tool:

- The comparison happens in code; the model receives only a `verified` boolean
- On mismatch, no profile data is returned, and the stored DOB is never echoed back — otherwise a caller could probe for it by guessing
- The other two tools refuse to run until a per-session verification flag is set
- Updates additionally confirm the reservation belongs to the verified guest

A prompt-level rule that holds most of the time is worse than none, because it looks like it works.

## Confirm before write

Reservation changes are two-phase. `updateReservationTool` is called first with `mode="propose"`: it validates the change, returns a `from → to` diff and a `proposalId`, and **writes nothing**. Only after the guest agrees is it called with `mode="commit"` and that id.

The read-back cannot be skipped, because there is no id to commit with until a proposal exists — and the commit replays the stored expression rather than re-reading the arguments, so what is saved is exactly what was read back. Proposals are single-use and scoped to one reservation and one session.

This exists because the earlier design asked for confirmation in the system prompt, which is the same shape as the identity bug below: a request the model may simply not follow.

## Tools

| Tool | Input | Purpose |
|---|---|---|
| `checkGuestProfileTool` | `guestName`, `dateOfBirth` | Verifies identity by comparing the spoken DOB against records |
| `checkReservationStatusTool` | `guestName`, `includePastStays?` | Upcoming stay, room details, balance due |
| `updateReservationTool` | `reservationId`, `mode`, `proposalId?`, `newRoomType?`, `newCheckOutDate?`, `newSpecialRequest?` | Propose or commit a change to room type, check-out date, or requests |

Room types are validated against a known list, and check-out dates must fall after check-in. Tool calls run in a thread pool executor so a slow DynamoDB round-trip cannot stall the audio stream.

## Measured performance

From instrumented session logs across 6 live conversations:

| Metric | Value |
|---|---|
| Speech-to-response latency, median | **0.626 s** |
| Fastest turn | 0.447 s |
| Slowest turn | 2.027 s |
| Turns measured | 11 |
| Tool execution (DynamoDB round-trip) | **77–182 ms** |

Latency is measured from the final user-speech transcript event to the model's next content-start. Mid-utterance pauses that Nova Sonic segments into separate user turns are excluded — counting them would inflate the figure.

## What testing revealed

Adding the browser transport pushed conversations into code paths the terminal sessions had never reached. Every defect below was found that way:

| Defect | Consequence |
|---|---|
| `checkoutDate` vs `checkOutDate` typo | Every reservation classified as a past stay, so `updateReservationTool` was unreachable and had never once run |
| Verification only requested in the prompt | Model confirmed identity for a wrong DOB, and for a nonexistent guest |
| No date parameter on the update tool | Asked to change a check-out date, the model appended a special request and reported the date change as done |
| No input validation | A single `.` was accepted and written into a live booking as a room type |
| Unpaced WebSocket output | Tens of seconds of audio buffered in the browser; interruption had nothing left to discard |

The first one masked the rest: with no reservation ever found, conversations dead-ended before reaching any modification path.

## Project structure

```
backend/
  hotel_agent.py        # Agent core: ToolProcessor, BedrockStreamManager, AudioStreamer
  server.py             # FastAPI bridge: audio + structured UI events
  static/               # Minimal test client (used to develop the transport)
  db_setup.py           # Creates and seeds the two DynamoDB tables
  app.py                # Streamlit dashboard — parses session logs
  requirements.txt

front-end/               # Next.js 16 · TypeScript · Tailwind v4 · Lucide
  src/lib/
    types.ts             # The event contract shared with the backend
    audio.ts             # Mic capture and scheduled speech playback
    useVoiceSession.ts   # One state machine driving both panes
    stateMeta.ts         # Icon + label + tone for every interface state
  src/components/        # Header, SessionStrip, Transcript, VoiceDock,
                         # Waveform, TracePanel, HowItWorks
  public/mic-processor.js
```

### Event contract

The browser receives binary frames (24 kHz PCM) and JSON text frames on the same socket:

```
transcript    role, text, final
tool_call     id, name, args          (sanitized)
tool_result   id, ok, latencyMs, result
proposal      proposalId, reservationId, changes[]
state         listening | processing | speaking | executing_tool
error         message
```

Tool arguments and results are redacted **server-side** — date of birth, email, and phone never reach the browser, so the trace panel cannot leak them even in a screen recording.

## Setup

**Prerequisites:** Python 3.10+, an AWS account with Bedrock access to `amazon.nova-sonic-v1:0` in `us-east-1`, and a microphone.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
```

Configure AWS credentials — read from your environment or `~/.aws/credentials`. **No credentials belong in source.**

```bash
aws configure
```

Create and seed the tables (this **deletes and recreates** them):

```bash
cd backend
python db_setup.py
```

### Run in the terminal

```bash
python hotel_agent.py            # add --debug for timing traces
```

### Run in the browser

Two processes. Backend:

```bash
cd backend
DEBUG=1 uvicorn server:app --port 8010 --reload
```

Frontend:

```bash
cd front-end
npm install
npm run dev
```

Open <http://127.0.0.1:3000>. The client connects to `ws://127.0.0.1:8010/ws`; override with `NEXT_PUBLIC_WS_URL`.

The minimal test page at <http://127.0.0.1:8010> still works and is useful for isolating transport problems from UI ones.

Microphone access requires a secure origin: `localhost` and `127.0.0.1` qualify, any other host needs HTTPS.

## Try it

Seeded guests:

| Guest | DOB | Reservation |
|---|---|---|
| Anna Smith | 1991-06-05 | Upcoming, fully paid |
| Mark Johnson | 1985-01-21 | Upcoming with balance due, plus a past stay |

A conversation exercising all three tools:

> "My name is Anna Smith."
> "My date of birth is June fifth, nineteen ninety-one."
> "Can you check my upcoming reservation?"
> "Change my check-out date to September first."

Then try interrupting mid-response, or giving a wrong date of birth to see the gate refuse.

## Current limitations

- **In-memory session state.** Conversation and verification state live on the `BedrockStreamManager` instance and are lost on exit. Nothing is persisted between runs.
- **No automated tests.** The tool layer has been verified against stubbed tables; there is no scripted end-to-end scenario suite.
- **Single prompt lifecycle.** Each run opens one session and one prompt; Nova Sonic closes the stream after a long idle gap and the client must reconnect.
- **Not deployed.** Runs locally only. A hosted deployment would need HTTPS for microphone access and an IAM instance role in place of local credentials.

## Accessibility

- All colour tokens meet WCAG AA in light and dark mode; ratios are recorded beside each token in `globals.css`
- Every state carries an icon and a label, never colour alone
- The transcript is a polite live region receiving final lines only, so screen readers are not flooded by partial speech
- The microphone is a real button with `aria-pressed`, operable by keyboard, with `M` as a shortcut
- Touch targets are at least 44×44
- `prefers-reduced-motion` replaces the waveform with a static level meter and disables the listening pulse — no state depends on movement

## Built with

Amazon Nova Sonic · AWS Bedrock Runtime (bidirectional streaming) · Python `asyncio` · FastAPI · Next.js · TypeScript · Tailwind CSS · Lucide · Web Audio API · DynamoDB
