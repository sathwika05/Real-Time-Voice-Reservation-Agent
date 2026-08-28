/**
 * AudioWorklet that captures microphone audio and converts it to the format
 * Nova Sonic requires: 16000 Hz, mono, 16-bit PCM.
 *
 * This runs on the browser's dedicated AUDIO THREAD, so capture is never
 * interrupted by page rendering or main-thread JavaScript.
 *
 * WHY WE RESAMPLE BY HAND
 * -----------------------
 * The page asks for an AudioContext at 16000 Hz, but browsers are permitted to
 * ignore that and hand back their native rate (usually 48000 Hz). If that
 * happens and we send the samples unchanged, Nova Sonic is told the audio is
 * 16 kHz while it is really 48 kHz - so it hears speech stretched to three
 * times its true length and transcribes garbage.
 *
 * Rather than trusting the request, we read the ACTUAL rate at runtime and
 * resample to 16000 ourselves. When the browser did honour the request the
 * ratio is 1.0 and this costs nothing.
 */

const TARGET_RATE = 16000;   // What Nova Sonic requires.
const CHUNK_SAMPLES = 1024;  // 1024 samples @ 16 kHz = 64 ms, matching hotel_agent.py.

// ---- Local voice-activity detection ---------------------------------------
// Waiting for Nova Sonic to report an interruption is too slow: the signal has
// to travel to the service, be recognised, and travel back, all while the agent
// keeps talking. Detecting speech here lets the page silence playback the
// moment the guest opens their mouth.
//
// SPEECH_RMS is the loudness above which a chunk counts as speech. Raise it if
// playback cuts out on its own; lower it if you have to speak up to interrupt.
const SPEECH_RMS = 0.02;     // Typical speech sits well above this; room tone below.
const SPEECH_CHUNKS = 2;     // Consecutive chunks required (2 x 64 ms = 128 ms).
const SILENCE_CHUNKS = 8;    // Quiet chunks before we consider the guest finished.

class MicProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // `sampleRate` is a global inside AudioWorkletGlobalScope holding the
        // context's REAL rate - the authoritative value, whatever was requested.
        this.inputRate = sampleRate;

        // How many input samples correspond to one output sample.
        // At 48000 Hz this is 3.0; if the browser honoured 16000 it is 1.0.
        this.ratio = this.inputRate / TARGET_RATE;

        this.buffer = new Float32Array(CHUNK_SAMPLES);  // Accumulates resampled output.
        this.offset = 0;                                // How many samples are in this.buffer.
        this.position = 0;                              // Fractional read position in the input.

        this.loudChunks = 0;      // Consecutive chunks above the speech threshold.
        this.quietChunks = 0;     // Consecutive chunks below it.
        this.speaking = false;    // Whether we currently believe the guest is talking.

        // Report the real rate to the main thread once, so the page can display
        // it and any mismatch is visible rather than silent.
        this.port.postMessage({ type: "rate", inputRate: this.inputRate, ratio: this.ratio });
    }

    /**
     * Called by the audio thread roughly every 128 samples.
     * Returning true keeps the processor alive.
     */
    process(inputs) {
        const input = inputs[0];                  // First (and only) input node.
        if (!input || input.length === 0) return true;   // Nothing this cycle; stay alive.

        const channel = input[0];                 // Mono: first channel only.
        if (!channel) return true;                // Channel not ready yet.

        // Walk through the input at `ratio` steps, producing one output sample
        // per step. `position` carries a fraction between calls so that steps
        // do not drift or click at block boundaries.
        while (this.position < channel.length) {
            const index = Math.floor(this.position);       // Nearest sample at or before us.
            const frac = this.position - index;            // How far between index and index+1.

            const current = channel[index];                // Sample at the integer position.
            const next = index + 1 < channel.length        // Next sample, if this block still has one.
                ? channel[index + 1]
                : current;                                 // At the block edge, reuse the last value.

            // Linear interpolation between the two neighbouring samples. This is
            // cheap and good enough for speech; it avoids the aliasing artefacts
            // that plain sample-dropping produces.
            this.buffer[this.offset++] = current + (next - current) * frac;

            if (this.offset === CHUNK_SAMPLES) {           // A full 64 ms chunk is ready.
                this.flush();                              // Convert and send it.
                this.offset = 0;                           // Begin filling again.
            }

            this.position += this.ratio;                   // Advance by one output sample.
        }

        // Carry the leftover fraction into the next block instead of resetting
        // to zero, which would drop or duplicate samples at every boundary.
        this.position -= channel.length;

        return true;                              // Keep processing.
    }

    /** Convert the accumulated float samples to 16-bit PCM and hand them over. */
    flush() {
        const pcm16 = new Int16Array(CHUNK_SAMPLES);

        // Root-mean-square loudness of this chunk: the average energy, which
        // tracks perceived volume far better than any single sample would.
        let sumSquares = 0;
        for (let i = 0; i < CHUNK_SAMPLES; i++) {
            sumSquares += this.buffer[i] * this.buffer[i];
        }
        const rms = Math.sqrt(sumSquares / CHUNK_SAMPLES);

        if (rms > SPEECH_RMS) {                 // This chunk sounds like speech.
            this.loudChunks++;                  // Count towards an onset.
            this.quietChunks = 0;               // Any noise resets the silence run.

            // Announce the onset once, not on every chunk while they talk.
            if (!this.speaking && this.loudChunks >= SPEECH_CHUNKS) {
                this.speaking = true;
                this.port.postMessage({ type: "speech_start" });
            }
        } else {                                // Quiet chunk.
            this.quietChunks++;                 // Count towards the end of the utterance.
            this.loudChunks = 0;                // A gap resets the onset run.

            // Only clear the speaking flag after sustained quiet, so natural
            // pauses mid-sentence do not re-trigger onset on every word.
            if (this.speaking && this.quietChunks >= SILENCE_CHUNKS) {
                this.speaking = false;
            }
        }

        for (let i = 0; i < CHUNK_SAMPLES; i++) {
            // Clamp first: values outside -1..1 would wrap into loud noise when scaled.
            const sample = Math.max(-1, Math.min(1, this.buffer[i]));

            // Scale to signed 16-bit. The negative and positive limits differ
            // because two's complement is asymmetric (-32768..32767).
            pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }

        // Transfer ownership of the buffer rather than copying it, avoiding an
        // allocation every 64 ms.
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
}

registerProcessor("mic-processor", MicProcessor);
