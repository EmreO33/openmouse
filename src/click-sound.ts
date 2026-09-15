let context: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let preparePromise: Promise<void> | null = null;
let audioRequest: Promise<ArrayBuffer> | null = null;

function audioCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);
}

function fetchAudio(): Promise<ArrayBuffer> {
  if (!audioRequest) {
    audioRequest = fetch(new URL("/sounds/click.wav", window.location.href).toString())
      .then((response) => {
        if (!response.ok) throw new Error(`click sound fetch failed: ${response.status}`);
        return response.arrayBuffer();
      });
  }
  return audioRequest;
}

function prepare(): Promise<void> {
  if (!preparePromise) {
    preparePromise = (async () => {
      const Ctor = audioCtor();
      if (!Ctor) return;
      context = new Ctor();
      buffer = await context.decodeAudioData(await fetchAudio());
    })().catch((error) => {
      console.warn("OpenMouse click sound unavailable:", error);
      preparePromise = null;
    });
  }
  return preparePromise;
}

async function play(): Promise<void> {
  const ctx = context;
  const audio = buffer;
  if (!ctx || !audio) return;
  if (ctx.state === "suspended") await ctx.resume();

  const now = ctx.currentTime;
  const length = audio.duration;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(1.35, now + 0.003);
  gain.gain.setValueAtTime(1.35, now + Math.max(0.04, length - 0.06));
  gain.gain.setTargetAtTime(0.0001, now + length - 0.06, 0.028);
  gain.connect(ctx.destination);

  const source = ctx.createBufferSource();
  source.buffer = audio;
  source.connect(gain);
  source.start(now, 0, length);
}

export function initClickSound(): void {
  void fetchAudio();
  void prepare();
  window.addEventListener("pointerdown", () => {
    void prepare().then(play);
  }, {
    passive: true,
  });
}