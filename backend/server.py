"""
WebSocket bridge for the Nova Sonic hotel agent.

WHY THIS FILE EXISTS
--------------------
hotel_agent.py talks to a physical microphone and speaker through PyAudio.
That works on a laptop, but a browser cannot reach those devices, and a
headless server does not have them at all.

This file replaces ONLY the audio transport. It imports the agent core from
hotel_agent.py without modifying it, so the terminal version keeps working
exactly as before.

The agent core exposes exactly two seams, and this bridge uses both:
    stream_manager.add_audio_chunk(bytes)   -> push microphone audio IN
    stream_manager.audio_output_queue       -> pull generated speech OUT

Run with:
    uvicorn server:app --reload --port 8000
Then open http://localhost:8000
"""

import asyncio                                  # Event loop + concurrent tasks.
import json                                     # Encoding control messages sent to the browser.
import os                                       # Setting credential environment variables.
from pathlib import Path                        # Locating the static/ folder next to this file.

import boto3                                    # Used only to RESOLVE credentials, not to call Bedrock.

from fastapi import FastAPI, WebSocket, WebSocketDisconnect   # Web server + WebSocket endpoint.
from fastapi.responses import FileResponse                    # Serving the test HTML page.
from fastapi.staticfiles import StaticFiles                   # Serving the AudioWorklet JS file.

# Import the agent core from the ORIGINAL file. This is safe because
# hotel_agent.py guards its credentials and asyncio.run() behind
# `if __name__ == "__main__":` - importing it opens no microphone and
# makes no AWS call.
import hotel_agent                            # Imported as a module so DEBUG can be toggled below.
from hotel_agent import BedrockStreamManager, OUTPUT_SAMPLE_RATE

# hotel_agent.debug_print() only prints when hotel_agent.DEBUG is True. The
# terminal version turns this on with its --debug flag; here it is controlled by
# an environment variable so the same detailed trace (timestamps, event types,
# "Tool use detected" lines) is available without editing code:
#
#     DEBUG=1 uvicorn server:app --port 8010
#
hotel_agent.DEBUG = os.environ.get("DEBUG", "").lower() in ("1", "true", "yes")

# Directory holding index.html and the AudioWorklet module.
STATIC_DIR = Path(__file__).parent / "static"


def load_aws_credentials_into_env():
    """
    Make AWS credentials visible to the Bedrock streaming client.

    WHY THIS IS NEEDED
    ------------------
    hotel_agent.py builds its Bedrock client with EnvironmentCredentialsResolver(),
    which reads credentials ONLY from environment variables. It does not consult
    ~/.aws/credentials, AWS profiles, SSO, or an EC2 instance role.

    boto3, by contrast, searches all of those. So we let boto3 do the lookup and
    then publish the result into the environment where the resolver will find it.

    This keeps credentials out of source code: nothing is hardcoded here, and the
    same call works with a credentials file, an SSO session, or an instance role.
    """
    session = boto3.Session()                   # Builds boto3's full credential chain.
    credentials = session.get_credentials()     # Resolve using that chain.

    if credentials is None:                     # Nothing found anywhere.
        raise RuntimeError(
            "No AWS credentials found. Configure ~/.aws/credentials, "
            "run `aws configure`, or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY."
        )

    # Freeze them: for temporary credentials this pins the current values rather
    # than a live object that may refresh underneath us.
    frozen = credentials.get_frozen_credentials()

    os.environ["AWS_ACCESS_KEY_ID"] = frozen.access_key        # Where the resolver looks.
    os.environ["AWS_SECRET_ACCESS_KEY"] = frozen.secret_key    # Where the resolver looks.

    if frozen.token:                            # Present for SSO / assumed-role credentials.
        os.environ["AWS_SESSION_TOKEN"] = frozen.token         # Required alongside temporary keys.

    return frozen.access_key[:8] + "..."        # Truncated, for a safe startup log line.


# Resolve credentials once at import time, before any Bedrock client is built.
print(f"AWS credentials loaded: {load_aws_credentials_into_env()}")

app = FastAPI()                                             # The web application object.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")  # Serve JS/CSS from /static.


@app.get("/")
async def index():
    """Serve the test page so the browser has something to load."""
    return FileResponse(STATIC_DIR / "index.html")


async def pump_browser_to_bedrock(websocket: WebSocket, stream_manager: BedrockStreamManager):
    """
    Read microphone audio from the browser and feed it to Nova Sonic.

    The browser sends raw 16 kHz mono PCM16 as BINARY WebSocket frames.
    That is already the exact format Nova Sonic expects, so no conversion
    happens here - we hand the bytes straight to the agent core.
    """
    while True:                                             # Loop for the life of the connection.
        message = await websocket.receive()                 # Wait for the next frame from the browser.

        if message.get("type") == "websocket.disconnect":   # Browser closed the tab or socket.
            break                                           # Leave the loop so cleanup can run.

        audio_bytes = message.get("bytes")                  # Binary frames arrive under "bytes".
        if audio_bytes:                                     # Ignore text frames and empty payloads.
            # Hand the chunk to the agent core. This is the SAME method the
            # PyAudio microphone callback calls in the terminal version.
            stream_manager.add_audio_chunk(audio_bytes)


async def pump_bedrock_to_browser(websocket: WebSocket, stream_manager: BedrockStreamManager):
    """
    Take generated speech from Nova Sonic and send it to the browser.

    This mirrors AudioStreamer.play_output_audio(), except that instead of
    writing bytes to a speaker we write them to a WebSocket.

    PACING - why this is not a plain forwarding loop
    ------------------------------------------------
    In the terminal version, output_stream.write() BLOCKS until the speaker has
    finished playing each chunk. That throttles playback to real time, so any
    backlog waits in audio_output_queue where barge-in can discard it.

    A WebSocket does not block: sending is near-instant. Nova Sonic generates
    speech much faster than real time, so forwarding every chunk on arrival
    parks tens of seconds of audio inside the browser. The guest then hears
    speech generated long ago, the server has nothing left to flush when they
    interrupt, and Nova Sonic - which considers its turn finished - does not
    register the interruption at all.

    So we deliberately send no faster than the audio plays, keeping only a small
    lead buffer in the browser. Everything else stays queued server-side where
    an interruption can still throw it away.
    """
    # 24000 Hz, 16-bit, mono -> 48000 bytes represent one second of audio.
    BYTES_PER_SECOND = OUTPUT_SAMPLE_RATE * 2

    # How far ahead of real time we allow the browser to buffer. Enough to ride
    # out network jitter without gaps; small enough that an interruption feels
    # immediate rather than arriving after seconds of stale speech.
    LEAD_SECONDS = 0.2

    # The moment the audio sent so far would finish playing.
    play_head = asyncio.get_event_loop().time()

    while True:                                             # Loop for the life of the connection.

        # ---- Detect a dead Bedrock stream --------------------------------
        # Nova Sonic closes the stream if it goes too long without input, and
        # _process_responses() then exits. Without this check the WebSocket
        # would stay open and the page would look alive while nothing was
        # listening - the guest talks and never gets a reply.
        if not stream_manager.is_active:                    # Bedrock session has ended.
            await websocket.send_text(json.dumps({"type": "session_ended"}))
            break                                           # Stop pumping; let cleanup run.

        # ---- Barge-in handling -------------------------------------------
        # _process_responses() sets this flag when the guest starts talking
        # over the assistant. Audio already queued is now stale.
        if stream_manager.barge_in:                         # Guest interrupted the assistant.
            while not stream_manager.audio_output_queue.empty():   # Drain everything queued server-side.
                try:
                    stream_manager.audio_output_queue.get_nowait()  # Discard one stale chunk.
                except asyncio.QueueEmpty:                  # Another task drained it first.
                    break                                   # Nothing left to discard.

            # Server-side draining is not enough: the browser has already
            # buffered audio and will keep playing it. Tell it to flush too.
            await websocket.send_text(json.dumps({"type": "barge_in"}))

            stream_manager.barge_in = False                 # Reset so we only flush once per interruption.

            # Discarded audio will never play, so the play head must snap back
            # to now. Otherwise pacing would keep waiting out speech that no
            # longer exists and the next reply would arrive late.
            play_head = asyncio.get_event_loop().time()

            await asyncio.sleep(0.05)                       # Brief pause, matching the terminal version.
            continue                                        # Re-check the flag before playing anything.

        # ---- Normal playback ---------------------------------------------
        try:
            # Wait briefly for the next chunk of generated speech. The timeout
            # keeps this loop responsive to the barge_in flag above rather than
            # blocking forever on an empty queue.
            audio_bytes = await asyncio.wait_for(
                stream_manager.audio_output_queue.get(), timeout=0.1
            )
        except asyncio.TimeoutError:                        # No audio right now - normal while listening.
            continue                                        # Loop again and re-check barge_in.

        if audio_bytes:                                     # Guard against empty payloads.
            now = asyncio.get_event_loop().time()

            # If the browser is already buffered past our lead, wait before
            # sending more. This is the throttle that PyAudio gave us for free.
            if play_head - now > LEAD_SECONDS:
                await asyncio.sleep(play_head - now - LEAD_SECONDS)

            # If playback fell behind (a stall, or the queue ran dry), restart
            # the clock from now rather than trying to catch up on lost time.
            play_head = max(play_head, asyncio.get_event_loop().time())

            # Advance the play head by this chunk's real duration.
            play_head += len(audio_bytes) / BYTES_PER_SECOND

            # Send as a BINARY frame. This is 24 kHz mono PCM16, which the
            # browser schedules into its playback AudioContext.
            await websocket.send_bytes(audio_bytes)


async def pump_events_to_browser(websocket: WebSocket, stream_manager: BedrockStreamManager):
    """
    Forward structured UI events (transcripts, tool activity, agent state) to
    the browser as JSON text frames.

    These travel on the same socket as the audio but as TEXT rather than binary,
    so the client can tell them apart without any framing of our own. They are
    deliberately kept on a separate task from the audio pump: a slow UI must
    never delay speech.
    """
    while True:
        event = await stream_manager.ui_events.get()    # Wait for the next event.
        await websocket.send_text(json.dumps(event))    # Text frame = control/UI data.


@app.websocket("/ws")
async def voice_session(websocket: WebSocket):
    """
    One WebSocket connection == one voice conversation.

    Sets up a Nova Sonic session, runs both audio pumps concurrently, and
    tears the session down cleanly when the browser disconnects.
    """
    await websocket.accept()                                # Complete the WebSocket handshake.

    # Each connection gets its own agent instance so two browser tabs never
    # share conversation state.
    stream_manager = BedrockStreamManager(
        model_id="amazon.nova-sonic-v1:0",
        region="us-east-1",
    )

    # Attach a bounded event queue. Bounded on purpose: if the browser stops
    # reading, events are dropped rather than accumulating until the process
    # runs out of memory. The terminal client leaves this as None.
    stream_manager.ui_events = asyncio.Queue(maxsize=256)

    try:
        # Open the bidirectional stream to Bedrock and send the initialization
        # events (session start, prompt start, system prompt, tool schemas).
        # This also starts the background response-reader and audio-sender tasks.
        await stream_manager.initialize_stream()

        # Announce that an audio content block is beginning. Until this is
        # sent, Nova Sonic will reject incoming audioInput events.
        await stream_manager.send_audio_content_start_event()

        # Tell the browser it may start capturing. Sending this only after
        # setup completes avoids dropping the guest's first words.
        await websocket.send_text(json.dumps({"type": "ready"}))

        # Run both directions at once. Audio must flow in and out
        # simultaneously - that is what makes interruption possible.
        tasks = [
            asyncio.create_task(pump_browser_to_bedrock(websocket, stream_manager)),
            asyncio.create_task(pump_bedrock_to_browser(websocket, stream_manager)),
            asyncio.create_task(pump_events_to_browser(websocket, stream_manager)),
        ]

        # Wait for whichever finishes first. Normally that is the receive pump,
        # ending when the browser disconnects. asyncio.gather() is deliberately
        # avoided here: it would cancel the surviving task and let the resulting
        # CancelledError escape. CancelledError inherits from BaseException, not
        # Exception, so the handler below would not catch it and uvicorn would
        # print a traceback on every normal disconnect.
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

        for task in pending:                                # Shut down the other direction.
            task.cancel()                                   # Ask it to stop.

        # Wait for the cancellations to settle. return_exceptions=True keeps the
        # expected CancelledError from propagating out of a clean shutdown.
        await asyncio.gather(*pending, return_exceptions=True)

        # Re-raise anything the finished task failed with, so genuine errors are
        # still reported rather than being swallowed by the shutdown path.
        for task in done:
            task.result()

    except asyncio.CancelledError:                          # Normal shutdown - not an error.
        print("Session cancelled")

    except WebSocketDisconnect:                             # Browser closed - expected, not an error.
        print("Browser disconnected")

    except Exception as e:                                  # Anything else is worth seeing during a spike.
        print(f"Session error: {e}")
        import traceback
        traceback.print_exc()

    finally:
        # Close the Bedrock session politely so the service is not left
        # holding an open stream.
        try:
            await stream_manager.send_audio_content_end_event()   # End the audio content block.
            await stream_manager.send_prompt_end_event()          # End the conversation turn.
            await stream_manager.send_session_end_event()         # End the session.
            await stream_manager.close()                          # Cancel background tasks.
        except Exception:                                   # Already half-closed - nothing useful to do.
            pass
        print("Session closed")
