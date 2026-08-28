/**
 * Browser audio transport.
 *
 * Capture and playback are separated into two classes because they have
 * genuinely different jobs: capture must produce exactly 16 kHz PCM16 for Nova
 * Sonic, while playback must schedule 24 kHz chunks so they sound continuous
 * despite arriving at irregular network intervals.
 */

export const INPUT_RATE = 16000;   // What Nova Sonic accepts.
export const OUTPUT_RATE = 24000;  // What Nova Sonic returns.

/** Microphone capture through an AudioWorklet running on the audio thread. */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  /**
   * @param onChunk   Receives one 64 ms block of 16 kHz PCM16 per call.
   * @param onSpeech  Fires when local voice detection sees speech begin.
   * @param onLevel   Receives a 0..1 amplitude for the waveform.
   */
  constructor(
    private onChunk: (pcm: ArrayBuffer) => void,
    private onSpeech: () => void,
    private onLevel: (rms: number) => void,
  ) {}

  async start(): Promise<void> {
    // Echo cancellation is not optional here. Without it the microphone picks
    // up the agent through the speakers, which both confuses interruption
    // detection and makes the agent talk over itself.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    // Requesting 16 kHz lets the browser resample for us when it obliges. The
    // worklet resamples anyway, because browsers are permitted to ignore this
    // and hand back 48 kHz - which, sent unlabelled, garbles transcription.
    this.ctx = new AudioContext({ sampleRate: INPUT_RATE });
    await this.ctx.audioWorklet.addModule("/mic-processor.js");

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "mic-processor");

    this.node.port.onmessage = (event: MessageEvent) => {
      const data = event.data;

      if (data instanceof ArrayBuffer) {
        this.onChunk(data);                       // A block of audio to send.
        return;
      }
      if (data?.type === "speech_start") this.onSpeech();
      if (data?.type === "level") this.onLevel(data.rms as number);
    };

    source.connect(this.node);
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());   // Release the mic indicator.
    await this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.node = null;
  }
}

/**
 * Playback of generated speech.
 *
 * Chunks are scheduled end-to-end rather than played on arrival. Playing each
 * chunk as it lands produces audible clicks between them; scheduling against a
 * running play head keeps the stream seamless.
 */
export class SpeechPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  private sources: AudioBufferSourceNode[] = [];
  private analyserLevel = 0;

  /** Peak amplitude of what is currently playing, for the agent-side waveform. */
  get level(): number {
    return this.analyserLevel;
  }

  ensure(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: OUTPUT_RATE });
    return this.ctx;
  }

  play(buffer: ArrayBuffer): void {
    const ctx = this.ensure();
    const pcm = new Int16Array(buffer);
    const floats = new Float32Array(pcm.length);

    let peak = 0;
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i] / 0x8000;                  // Back to Web Audio's -1..1 range.
      floats[i] = v;
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
    }
    this.analyserLevel = peak;

    const audioBuffer = ctx.createBuffer(1, floats.length, OUTPUT_RATE);
    audioBuffer.copyToChannel(floats, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    // Never schedule in the past: if the network stalled and the play head has
    // already elapsed, restart from now or the chunk is silently dropped.
    const startAt = Math.max(this.nextTime, ctx.currentTime);
    source.start(startAt);
    this.nextTime = startAt + audioBuffer.duration;

    this.sources.push(source);
    source.onended = () => {
      this.sources = this.sources.filter((s) => s !== source);
      if (this.sources.length === 0) this.analyserLevel = 0;
    };
  }

  /** Stop everything queued. Used on barge-in - the guest is talking now. */
  flush(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // Already finished; stop() on a completed source throws. Harmless.
      }
    }
    this.sources = [];
    this.nextTime = 0;
    this.analyserLevel = 0;
  }

  get isPlaying(): boolean {
    return this.sources.length > 0;
  }

  async close(): Promise<void> {
    this.flush();
    await this.ctx?.close();
    this.ctx = null;
  }
}
