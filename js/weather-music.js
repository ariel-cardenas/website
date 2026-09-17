/**
 * One shared score keeps every weather arrangement compatible: C is the tonal
 * center, the tempo is always 96 BPM in 4/4, and one loop is eight bars. The
 * bass roots are C–G–A–F–C–G–D–G and every lead derives from C–E–G–A.
 * Keep that clock, bass motion, and motif aligned when editing a mood so its
 * four-bar crossfade continues to sound like the same piece of music.
 */
(function installWeatherMusic(root) {
  "use strict";

  const BPM = 96;
  const BEAT_SECONDS = 60 / BPM;
  const STEP_SECONDS = BEAT_SECONDS / 4;
  const STEPS_PER_BAR = 16;
  const LOOP_BARS = 8;
  const LOOP_STEPS = STEPS_PER_BAR * LOOP_BARS;
  const SCHEDULE_AHEAD_SECONDS = 0.1;
  const SCHEDULER_INTERVAL_MS = 25;
  const MOODS = ["sunny", "rainy", "snowy"];
  const MOTIF = [72, 76, 79, 81]; // C5–E5–G5–A5
  const BASS_ROOTS = [36, 43, 45, 41, 36, 43, 38, 43];
  const MUTE_STORAGE_KEY = "mountain-music-muted";
  const DEFAULT_VOLUME = 0.46;

  const SUNNY_CHORDS = [
    [72, 76, 79, 83], // Cmaj7
    [71, 74, 79, 81], // G6
    [69, 72, 76, 79], // Am7
    [69, 72, 76, 77], // Fmaj7
    [72, 76, 79, 81], // C6
    [71, 74, 79, 81], // G6
    [74, 77, 81, 84], // Dm7
    [71, 74, 77, 79], // G7
  ];

  const RAINY_COLORS = [
    [74, 79], // A soft D–G suspension over C
    [71, 76],
    [72, 76],
    [69, 76],
    [74, 79],
    [71, 76],
    [72, 77],
    [71, 74],
  ];

  const SNOWY_FIFTHS = [
    [72, 79],
    [67, 74],
    [69, 76],
    [65, 72],
    [72, 79],
    [67, 74],
    [74, 81],
    [67, 74],
  ];

  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const midiToFrequency = (note) => 440 * (2 ** ((note - 69) / 12));
  const normalizeMood = (mood) => (MOODS.includes(mood) ? mood : "sunny");

  function readMutedPreference() {
    try {
      return root.localStorage?.getItem(MUTE_STORAGE_KEY) === "true";
    } catch (_) {
      return false;
    }
  }

  function writeMutedPreference(muted) {
    try {
      root.localStorage?.setItem(MUTE_STORAGE_KEY, String(muted));
    } catch (_) {
      // Audio still works in strict privacy and local-file contexts.
    }
  }

  function createWeatherAudio({ getMood = () => "sunny", onState = () => {} } = {}) {
    const AudioContextClass = root.AudioContext || root.webkitAudioContext;
    const supported = Boolean(AudioContextClass);

    let context = null;
    let masterGain = null;
    let compressor = null;
    let sharedBassGain = null;
    let noiseBuffer = null;
    let drizzleSource = null;
    let schedulerTimer = null;
    let nextStepTime = null;
    let stepIndex = 0;
    let started = false;
    let muted = readMutedPreference();
    let volume = DEFAULT_VOLUME;
    let mood = normalizeMood(safeGetMood());
    let buses = null;
    const pulseWaves = new Map();
    const gainFades = new Map();

    function safeGetMood() {
      try {
        return getMood();
      } catch (_) {
        return "sunny";
      }
    }

    function state() {
      return {
        supported,
        started,
        muted,
        mood,
        volume,
        contextState: context?.state || "uninitialized",
      };
    }

    function emitState() {
      onState(state());
    }

    function createNoiseBuffer() {
      const length = context.sampleRate * 2;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const channel = buffer.getChannelData(0);

      for (let index = 0; index < length; index += 1) {
        channel[index] = Math.random() * 2 - 1;
      }

      return buffer;
    }

    function createBus(initialGain) {
      const input = context.createGain();
      const gain = context.createGain();
      gain.gain.value = initialGain;
      input.connect(gain);
      gain.connect(masterGain);
      return { input, gain };
    }

    function ensureAudioGraph() {
      if (context || !supported) return;

      context = new AudioContextClass({ latencyHint: "interactive" });
      masterGain = context.createGain();
      compressor = context.createDynamicsCompressor();
      sharedBassGain = context.createGain();

      masterGain.gain.value = muted ? 0 : volume;
      sharedBassGain.gain.value = 0.23;
      compressor.threshold.value = -14;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.18;

      masterGain.connect(compressor);
      compressor.connect(context.destination);
      sharedBassGain.connect(masterGain);

      buses = Object.fromEntries(
        MOODS.map((name) => [name, createBus(name === mood ? 1 : 0)]),
      );
      noiseBuffer = createNoiseBuffer();
      startDrizzleBed();
      context.addEventListener?.("statechange", emitState);
    }

    function startDrizzleBed() {
      drizzleSource = context.createBufferSource();
      const bandpass = context.createBiquadFilter();
      const drizzleGain = context.createGain();

      drizzleSource.buffer = noiseBuffer;
      drizzleSource.loop = true;
      bandpass.type = "bandpass";
      bandpass.frequency.value = 3600;
      bandpass.Q.value = 0.65;
      drizzleGain.gain.value = 0.014;

      drizzleSource.connect(bandpass);
      bandpass.connect(drizzleGain);
      drizzleGain.connect(buses.rainy.input);
      drizzleSource.start(context.currentTime + 0.01);
    }

    function getPulseWave(dutyCycle) {
      if (pulseWaves.has(dutyCycle)) return pulseWaves.get(dutyCycle);

      const harmonics = 32;
      const real = new Float32Array(harmonics + 1);
      const imaginary = new Float32Array(harmonics + 1);

      for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
        real[harmonic] = (2 * Math.sin(2 * Math.PI * harmonic * dutyCycle)) / (Math.PI * harmonic);
        imaginary[harmonic] = (2 * (1 - Math.cos(2 * Math.PI * harmonic * dutyCycle))) / (Math.PI * harmonic);
      }

      const wave = context.createPeriodicWave(real, imaginary, { disableNormalization: false });
      pulseWaves.set(dutyCycle, wave);
      return wave;
    }

    function scheduleTone({
      destination,
      note,
      time,
      duration,
      gain,
      waveform = "triangle",
      dutyCycle = null,
      attack = 0.008,
      cutoff = 9000,
      pan = 0,
      vibrato = 0,
    }) {
      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();
      let output = envelope;

      if (dutyCycle) {
        oscillator.setPeriodicWave(getPulseWave(dutyCycle));
      } else {
        oscillator.type = waveform;
      }

      oscillator.frequency.setValueAtTime(midiToFrequency(note), time);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(cutoff, time);
      filter.Q.value = 0.4;

      const safeAttack = Math.min(attack, duration * 0.35);
      const releaseStart = Math.max(time + safeAttack, time + duration * 0.64);
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.linearRampToValueAtTime(gain, time + safeAttack);
      envelope.gain.setValueAtTime(gain, releaseStart);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      if (vibrato > 0) {
        const sampleCount = Math.max(8, Math.ceil(duration * 5 * 8));
        const curve = new Float32Array(sampleCount);
        for (let index = 0; index < sampleCount; index += 1) {
          const elapsed = (index / (sampleCount - 1)) * duration;
          curve[index] = Math.sin(elapsed * Math.PI * 10) * vibrato;
        }
        oscillator.detune.setValueCurveAtTime(curve, time, duration);
      }

      oscillator.connect(filter);
      filter.connect(envelope);

      if (pan !== 0 && context.createStereoPanner) {
        const panner = context.createStereoPanner();
        panner.pan.value = clamp(pan, -1, 1);
        envelope.connect(panner);
        output = panner;
      }

      output.connect(destination);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.02);
    }

    function scheduleNoise({ destination, time, duration, gain, frequency, type = "highpass", q = 0.7 }) {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();

      source.buffer = noiseBuffer;
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.linearRampToValueAtTime(gain, time + Math.min(0.008, duration * 0.25));
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(destination);
      source.start(time);
      source.stop(time + duration + 0.01);
    }

    function scheduleKick(destination, time, gain = 0.08) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(105, time);
      oscillator.frequency.exponentialRampToValueAtTime(47, time + 0.11);
      envelope.gain.setValueAtTime(gain, time);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
      oscillator.connect(envelope);
      envelope.connect(destination);
      oscillator.start(time);
      oscillator.stop(time + 0.15);
    }

    function scheduleBass(bar, withinBar, time) {
      if (![0, 4, 8].includes(withinBar)) return;

      const root = BASS_ROOTS[bar];
      const notes = [root, root + 12, root + 7];
      const durations = [3.55, 3.55, 7.55];
      const index = withinBar === 0 ? 0 : withinBar === 4 ? 1 : 2;

      scheduleTone({
        destination: sharedBassGain,
        note: notes[index],
        time,
        duration: durations[index] * STEP_SECONDS,
        gain: index === 2 ? 0.1 : 0.12,
        waveform: "triangle",
        attack: 0.012,
        cutoff: 1250,
      });
    }

    function scheduleSunny(bar, withinBar, time) {
      const destination = buses.sunny.input;

      if (withinBar % 2 === 0) {
        const chord = SUNNY_CHORDS[bar];
        const swungTime = withinBar % 4 === 2 ? time + STEP_SECONDS * 0.28 : time;
        scheduleTone({
          destination,
          note: chord[(withinBar / 2) % chord.length] - 12,
          time: swungTime,
          duration: STEP_SECONDS * 2.35,
          gain: 0.034,
          dutyCycle: 0.25,
          attack: 0.018,
          cutoff: 3400,
        });
      }

      if ([0, 4, 8, 12].includes(withinBar)) {
        scheduleTone({
          destination,
          note: MOTIF[withinBar / 4] - 12,
          time,
          duration: STEP_SECONDS * 3.55,
          gain: 0.047,
          dutyCycle: 0.25,
          attack: 0.025,
          cutoff: 4100,
          vibrato: 3,
        });
      }

      if (withinBar % 2 === 0) {
        scheduleNoise({
          destination,
          time,
          duration: 0.032,
          gain: withinBar % 4 === 2 ? 0.009 : 0.006,
          frequency: 5200,
        });
      }

      if (withinBar === 0 || withinBar === 8) scheduleKick(destination, time, 0.052);
    }

    function scheduleRainy(loopStep, bar, withinBar, time) {
      const destination = buses.rainy.input;
      const motifPosition = loopStep % 32;
      const motifSteps = [2, 14, 22, 30];
      const motifIndex = motifSteps.indexOf(motifPosition);

      if (motifIndex >= 0) {
        scheduleTone({
          destination,
          note: MOTIF[motifIndex],
          time,
          duration: STEP_SECONDS * 5.5,
          gain: 0.047,
          dutyCycle: 0.25,
          attack: 0.045,
          cutoff: 3200,
        });
      }

      if (withinBar === 6 || withinBar === 13) {
        const colorIndex = withinBar === 6 ? 0 : 1;
        scheduleTone({
          destination,
          note: RAINY_COLORS[bar][colorIndex],
          time,
          duration: STEP_SECONDS * 6.2,
          gain: 0.033,
          waveform: "triangle",
          attack: 0.075,
          cutoff: 2900,
          pan: colorIndex === 0 ? -0.16 : 0.16,
        });
      }

      if ([1, 5, 11, 14].includes(withinBar) && (bar + withinBar) % 3 !== 0) {
        scheduleNoise({
          destination,
          time,
          duration: 0.045 + (withinBar % 2) * 0.025,
          gain: 0.015,
          frequency: 3900,
          type: "bandpass",
          q: 1.2,
        });
      }

      if (withinBar === 0 && bar % 2 === 0) scheduleKick(destination, time, 0.028);
    }

    function scheduleSnowy(loopStep, bar, withinBar, time) {
      const destination = buses.snowy.input;

      if (withinBar === 0) {
        SNOWY_FIFTHS[bar].forEach((note, index) => {
          scheduleTone({
            destination,
            note,
            time,
            duration: BEAT_SECONDS * 2.8,
            gain: 0.025,
            waveform: index === 0 ? "triangle" : "sine",
            attack: 0.12,
            cutoff: 6200,
            pan: index === 0 ? -0.28 : 0.28,
          });
        });

        scheduleTone({
          destination,
          note: MOTIF[bar % MOTIF.length] + 12,
          time,
          duration: BEAT_SECONDS * 2.2,
          gain: 0.034,
          waveform: "sine",
          attack: 0.075,
          cutoff: 7000,
          pan: bar % 2 === 0 ? -0.42 : 0.42,
        });

        // A quiet, warm pulse under the bell blends sunny lo-fi with rainy coziness.
        scheduleTone({
          destination,
          note: MOTIF[bar % MOTIF.length],
          time,
          duration: BEAT_SECONDS * 1.8,
          gain: 0.018,
          dutyCycle: 0.25,
          attack: 0.11,
          cutoff: 2800,
          pan: bar % 2 === 0 ? 0.16 : -0.16,
        });
      }

      if (withinBar === 10 && bar % 2 === 1) {
        const pentatonicPassingNotes = [74, 79, 81, 76]; // D–G–A–E
        scheduleTone({
          destination,
          note: pentatonicPassingNotes[(bar - 1) / 2] + 12,
          time,
          duration: BEAT_SECONDS * 1.4,
          gain: 0.025,
          waveform: "triangle",
          attack: 0.09,
          cutoff: 6800,
          pan: bar % 4 === 1 ? 0.35 : -0.35,
        });
      }

      if (loopStep === 60 || loopStep === 124) {
        scheduleNoise({
          destination,
          time,
          duration: 0.085,
          gain: 0.017,
          frequency: 1700,
          type: "bandpass",
          q: 0.9,
        });
      }
    }

    function scheduleStep(loopStep, time) {
      const bar = Math.floor(loopStep / STEPS_PER_BAR);
      const withinBar = loopStep % STEPS_PER_BAR;

      scheduleBass(bar, withinBar, time);
      scheduleSunny(bar, withinBar, time);
      scheduleRainy(loopStep, bar, withinBar, time);
      scheduleSnowy(loopStep, bar, withinBar, time);
    }

    function scheduler() {
      if (!started || !context) return;

      const now = context.currentTime;
      if (nextStepTime < now - STEP_SECONDS) {
        const missedSteps = Math.floor((now - nextStepTime) / STEP_SECONDS) + 1;
        stepIndex = (stepIndex + missedSteps) % LOOP_STEPS;
        nextStepTime += missedSteps * STEP_SECONDS;
      }

      while (nextStepTime < now + SCHEDULE_AHEAD_SECONDS) {
        scheduleStep(stepIndex, nextStepTime);
        stepIndex = (stepIndex + 1) % LOOP_STEPS;
        nextStepTime += STEP_SECONDS;
      }

      schedulerTimer = root.setTimeout(scheduler, SCHEDULER_INTERVAL_MS);
    }

    function gainAt(name, time) {
      const fade = gainFades.get(name);
      if (!fade || time >= fade.end) return fade?.to ?? buses[name].gain.gain.value;
      if (time <= fade.start) return fade.from;

      const progress = (time - fade.start) / (fade.end - fade.start);
      const startAngle = fade.to > fade.from
        ? Math.asin(clamp(fade.from, 0, 1))
        : Math.acos(clamp(fade.from, 0, 1));
      const endAngle = Math.PI / 2;
      const angle = startAngle + (endAngle - startAngle) * progress;
      return fade.to > fade.from ? Math.sin(angle) : Math.cos(angle);
    }

    function makeEqualPowerCurve(from, to, samples = 96) {
      const curve = new Float32Array(samples);
      const startAngle = to > from
        ? Math.asin(clamp(from, 0, 1))
        : Math.acos(clamp(from, 0, 1));

      for (let index = 0; index < samples; index += 1) {
        const progress = index / (samples - 1);
        const angle = startAngle + (Math.PI / 2 - startAngle) * progress;
        curve[index] = to > from ? Math.sin(angle) : Math.cos(angle);
      }

      return curve;
    }

    function fadeBus(name, target, startTime, duration) {
      const parameter = buses[name].gain.gain;
      const current = clamp(gainAt(name, startTime), 0, 1);
      const curveStart = startTime + 0.002;

      parameter.cancelScheduledValues(startTime);
      parameter.setValueAtTime(current, startTime);

      if (duration <= 0.02 || Math.abs(current - target) < 0.0001) {
        parameter.linearRampToValueAtTime(target, startTime + Math.max(0.015, duration));
        gainFades.set(name, { from: current, to: target, start: startTime, end: startTime + Math.max(0.015, duration) });
        return;
      }

      parameter.setValueCurveAtTime(
        makeEqualPowerCurve(current, target),
        curveStart,
        duration - 0.002,
      );
      gainFades.set(name, { from: current, to: target, start: curveStart, end: startTime + duration });
    }

    async function start() {
      if (!supported) {
        emitState();
        return false;
      }

      ensureAudioGraph();
      if (context.state !== "running") await context.resume();
      if (started) {
        emitState();
        return true;
      }

      started = true;
      if (nextStepTime === null || nextStepTime < context.currentTime) {
        nextStepTime = context.currentTime + 0.055;
      }
      masterGain.gain.cancelScheduledValues(context.currentTime);
      masterGain.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, 0.018);
      scheduler();
      emitState();
      return true;
    }

    async function stop() {
      if (!context || !started) return;
      started = false;
      root.clearTimeout(schedulerTimer);
      schedulerTimer = null;
      masterGain.gain.cancelScheduledValues(context.currentTime);
      masterGain.gain.setTargetAtTime(0, context.currentTime, 0.012);
      await new Promise((resolve) => root.setTimeout(resolve, 35));
      await context.suspend();
      emitState();
    }

    function setMood(next, { bars = 4 } = {}) {
      const normalized = normalizeMood(next);
      if (normalized === mood) return;

      mood = normalized;
      if (!context || !buses) {
        emitState();
        return;
      }

      const startTime = context.currentTime + 0.01;
      const duration = Math.max(0, Number(bars) || 0) * 4 * BEAT_SECONDS;
      MOODS.forEach((name) => fadeBus(name, name === mood ? 1 : 0, startTime, duration));
      emitState();
    }

    function setMuted(nextMuted) {
      muted = Boolean(nextMuted);
      writeMutedPreference(muted);

      if (context && masterGain) {
        const now = context.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setTargetAtTime(muted ? 0 : volume, now, 0.018);
      }

      emitState();
    }

    function setVolume(nextVolume) {
      volume = clamp(Number(nextVolume) || 0, 0, 1);
      if (context && masterGain && !muted) {
        const now = context.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setTargetAtTime(volume, now, 0.025);
      }
      emitState();
    }

    emitState();
    return { start, stop, setMood, setMuted, setVolume, getState: state };
  }

  root.createWeatherAudio = createWeatherAudio;
})(typeof window !== "undefined" ? window : globalThis);
