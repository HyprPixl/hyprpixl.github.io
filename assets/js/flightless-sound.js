// Flightless — sound module.
//
// A tiny synth built on the Web Audio API: short blips for pickups/buys,
// a looping filtered-noise bed for the rocket thrust, and the handful of
// named cues (ding/tick/thump/boom/launch) the sim and UI call by name.
// Takes the save state so it can respect the mute flag without the rest
// of the game reaching into its internals.
//
// NEW in this revision:
//   setEngine(speed)  — engine-hum oscillator layer, pitch/gain tracks speed
//   thump(intensity)  — optional 0-1 intensity arg (defaults 1); legacy call
//                       thump() unchanged
//   thumpSoft()       — light landing thud
//   thumpHard()       — heavy impact thud
//   flap()            — quick wing-flap tick
//   cheer()           — milestone/record bark (results agent)
//   oof()             — crash bark (results agent)
//   startMusic()      — begin looping synth-arpeggio bed
//   stopMusic()       — fade out and stop music
//   setMusicVolume(v) — 0-1 master music gain
//
// Music is gated on state.musicMuted (read defensively) INDEPENDENTLY of
// state.muted (SFX). SFX muting never touches the music gain node and vice
// versa. Neither audio path starts until ensure() runs (user-gesture path).
export function createSound(state){
  const SFX = {
    ctx: null,
    thrustGain: null,
    thrustFilt: null,

    // Engine-hum oscillator layer (setEngine)
    engineOsc: null,
    engineGain: null,

    // Background music
    musicGain: null,
    musicOscNodes: [],   // running arp oscillators
    musicNextTime: 0,    // scheduler lookahead cursor
    musicTimerId: null,  // setInterval id for arp scheduler
    musicRunning: false,

    // ---- CORE INIT -------------------------------------------------------

    ensure(){
      if(state.muted) return null;
      if(!this.ctx){
        try{ this.ctx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; }
        this._initNoise();
        this._initEngine();
      }
      if(this.ctx.state==='suspended') this.ctx.resume();
      return this.ctx;
    },

    // ensure() path that does NOT gate on state.muted — used by music so it
    // can play even when SFX is muted (they are independent flags).
    _ensureCtx(){
      if(!this.ctx){
        try{ this.ctx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; }
        this._initNoise();
        this._initEngine();
      }
      if(this.ctx.state==='suspended') this.ctx.resume();
      return this.ctx;
    },

    // Looping filtered-noise buffer for rocket thrust bed.
    _initNoise(){
      const c = this.ctx;
      const len = c.sampleRate * 0.5;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for(let i=0;i<len;i++) d[i] = Math.random()*2-1;
      const src = c.createBufferSource();
      src.buffer = buf; src.loop = true;
      this.thrustFilt = c.createBiquadFilter();
      this.thrustFilt.type = 'lowpass'; this.thrustFilt.frequency.value = 500;
      this.thrustGain = c.createGain();
      this.thrustGain.gain.value = 0;
      src.connect(this.thrustFilt);
      this.thrustFilt.connect(this.thrustGain);
      this.thrustGain.connect(c.destination);
      src.start();
    },

    // Engine-hum oscillator layer (sawtooth, pitches with speed).
    _initEngine(){
      const c = this.ctx;
      this.engineOsc = c.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 80;
      // gentle low-pass so it blends with noise bed
      const filt = c.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 400;
      this.engineGain = c.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(filt);
      filt.connect(this.engineGain);
      this.engineGain.connect(c.destination);
      this.engineOsc.start();
    },

    // ---- EXISTING SFX (UNCHANGED API) ------------------------------------

    blip(freq, dur, type, vol){
      const c = this.ensure(); if(!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type||'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol||0.08, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + (dur||0.1));
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + (dur||0.1) + 0.02);
    },

    launch(){
      const c = this.ensure(); if(!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(120, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(700, c.currentTime+0.5);
      g.gain.setValueAtTime(0.1, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+0.6);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+0.7);
    },

    ding(){ this.blip(880,0.15,'sine',0.1); setTimeout(()=>this.blip(1320,0.25,'sine',0.1), 110); },
    tick(){ this.blip(1400,0.03,'square',0.03); },
    buy(){ this.blip(660,0.08,'square',0.06); setTimeout(()=>this.blip(990,0.1,'square',0.06), 70); },

    // thump — now accepts optional intensity 0-1 (defaults to 1 for backwards
    // compat). All existing call sites that pass no arg continue to work.
    thump(intensity){
      const v = (intensity == null ? 1 : Math.max(0, Math.min(1, intensity)));
      const c = this.ensure(); if(!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      // pitch drops with lighter impacts so softer hits sound lighter
      const baseFreq = 60 + 30 * v;
      o.frequency.setValueAtTime(baseFreq, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(30, c.currentTime+0.18);
      g.gain.setValueAtTime(0.08 + 0.14*v, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+0.18);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+0.22);
    },

    boom(){ this.blip(55,0.5,'sawtooth',0.22); this.blip(220,0.25,'square',0.1); },

    setThrust(on){
      if(state.muted || !this.thrustGain){ if(this.thrustGain) this.thrustGain.gain.value=0; return; }
      this.thrustGain.gain.setTargetAtTime(on?0.12:0, this.ctx.currentTime, 0.05);
    },

    // ---- NEW SFX ---------------------------------------------------------

    // setEngine(speed): drive engine-hum layer. speed is 0-1 normalized or raw
    // m/s — treat anything ≥1 as a raw speed (cap at ~200 m/s).
    // Pitch range 80–320 Hz, gain 0–0.07.
    setEngine(speed){
      if(!this.engineGain || !this.engineOsc) return;
      if(state.muted){ this.engineGain.gain.value = 0; return; }
      // normalise: values > 1 treated as m/s (max ~200)
      const t = speed > 1 ? Math.min(speed / 200, 1) : Math.max(0, Math.min(speed, 1));
      const freq = 80 + 240 * t;        // 80 Hz idle → 320 Hz full throttle
      const gain = 0.07 * t;
      const now = this.ctx ? this.ctx.currentTime : 0;
      this.engineOsc.frequency.setTargetAtTime(freq, now, 0.1);
      this.engineGain.gain.setTargetAtTime(gain, now, 0.1);
    },

    // thumpSoft / thumpHard — named wrappers around thump(intensity)
    thumpSoft(){ this.thump(0.3); },
    thumpHard(){ this.thump(1.0); },

    // flap — quick wing-beat; higher-pitched short noise burst
    flap(){
      const c = this.ensure(); if(!c) return;
      // short noise burst filtered to mid-range for a feathery whoosh
      const len = Math.floor(c.sampleRate * 0.06);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for(let i=0;i<len;i++) d[i] = (Math.random()*2-1) * (1 - i/len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const filt = c.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = 1800; filt.Q.value = 1.2;
      const g = c.createGain();
      g.gain.setValueAtTime(0.07, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+0.07);
      src.connect(filt); filt.connect(g); g.connect(c.destination);
      src.start(); src.stop(c.currentTime+0.08);
    },

    // cheer — ascending trill for milestone / record
    cheer(){
      const c = this.ensure(); if(!c) return;
      const notes = [523, 659, 784, 1047];
      notes.forEach((f,i)=>{
        setTimeout(()=>this.blip(f, 0.12, 'sine', 0.09), i*70);
      });
    },

    // oof — descending grunt for crash
    oof(){
      const c = this.ensure(); if(!c) return;
      const notes = [330, 220, 165];
      notes.forEach((f,i)=>{
        setTimeout(()=>this.blip(f, 0.14, 'sawtooth', 0.07), i*60);
      });
    },

    // ---- BACKGROUND MUSIC -----------------------------------------------
    //
    // A small procedural four-piece band, scheduled in a lookahead loop
    // (Web Audio best-practice): a lead arpeggio, a bar-length pad, a
    // plucked bass, and a light kick/hat/snap drum kit, all voiced from a
    // four-chord minor progression (i–VI–III–VII) instead of one static
    // scale looped forever — the harmony actually moves. Every voice feeds
    // musicGain, its OWN gain node, so state.musicMuted gates the whole band
    // independently of state.muted (SFX). musicGain in turn feeds a warm
    // low-pass and a short feedback-delay send for a bit of space, instead
    // of firing oscillators straight at destination.
    //
    // Key: C minor. semi() maps a semitone offset (0 = C3) to Hz.
    _MUSIC_ROOT_HZ: 130.81,  // C3
    _noteHz(semi){ return this._MUSIC_ROOT_HZ * Math.pow(2, semi/12); },

    // i (Cm) → VI (Ab) → III (Eb) → VII (Bb): each chord holds for one
    // 8-step bar. `root` is the chord's bass semitone offset; `arp` is the
    // lead's up-down arpeggio through the triad across the bar's 8 steps.
    _PROGRESSION: [
      { root: 0,  arp: [0,  3,  7,  12, 7,  3,  0,  3 ] },  // i   Cm
      { root: 8,  arp: [8,  12, 15, 20, 15, 12, 8,  12] },  // VI  Ab
      { root: 3,  arp: [3,  7,  10, 15, 10, 7,  3,  7 ] },  // III Eb
      { root: 10, arp: [10, 14, 17, 22, 17, 14, 10, 14] },  // VII Bb
    ],
    _ARP_STEP_SEC: 0.22,
    _ARP_STEP_IDX: 0,

    // bar-length pad: two detuned low sines under the current chord's root
    // and fifth, faded up/down so bars cross-fade instead of clicking
    _musicPad(time, root, dur){
      [root - 12, root - 5].forEach((semi, i) => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sine'; o.frequency.value = this._noteHz(semi);
        o.detune.value = i===0 ? -4 : 4;
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(0.035, time + 0.3);
        g.gain.setValueAtTime(0.035, time + dur - 0.35);
        g.gain.linearRampToValueAtTime(0, time + dur);
        o.connect(g); g.connect(this.musicGain);
        o.start(time); o.stop(time + dur + 0.05);
      });
    },
    // plucked bass note, one octave+ below the chord tone
    _musicBass(time, semi, dur){
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = this._noteHz(semi - 12);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.09, time + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g); g.connect(this.musicGain);
      o.start(time); o.stop(time + dur + 0.02);
    },
    _musicKick(time){
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, time);
      o.frequency.exponentialRampToValueAtTime(46, time + 0.12);
      g.gain.setValueAtTime(0.2, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
      o.connect(g); g.connect(this.musicGain);
      o.start(time); o.stop(time + 0.18);
    },
    // short filtered-noise burst shared by hat/snap, tuned by freq+dur+vol
    _musicNoiseHit(time, freq, q, dur, vol){
      const c = this.ctx;
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for(let i=0;i<len;i++) d[i] = (Math.random()*2-1) * (1 - i/len);
      const src = c.createBufferSource(); src.buffer = buf;
      const filt = c.createBiquadFilter();
      filt.type = freq > 3000 ? 'highpass' : 'bandpass';
      filt.frequency.value = freq; filt.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(vol, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      src.connect(filt); filt.connect(g); g.connect(this.musicGain);
      src.start(time); src.stop(time + dur + 0.01);
    },

    _scheduleMusicNote(time){
      if(!this.musicGain || !this.ctx) return;
      const prog = this._PROGRESSION;
      const barStep = this._ARP_STEP_IDX % 8;
      const bar = Math.floor(this._ARP_STEP_IDX / 8);
      const chord = prog[bar % prog.length];
      this._ARP_STEP_IDX++;
      const barDur = this._ARP_STEP_SEC * 8;

      // rhythm section: kick + bass on beats 1 and 3, snap on the backbeat,
      // a soft hat every step, pad renewed once per bar
      if(barStep === 0){
        this._musicPad(time, chord.root, barDur);
        this._musicBass(time, chord.root, this._ARP_STEP_SEC * 1.8);
        this._musicKick(time);
      } else if(barStep === 4){
        this._musicBass(time, chord.root + 7, this._ARP_STEP_SEC * 1.8);
        this._musicKick(time);
      }
      if(barStep === 2 || barStep === 6) this._musicNoiseHit(time, 1600, 0.9, 0.09, 0.05);
      this._musicNoiseHit(time, 7000, 1, 0.035, barStep % 2 === 0 ? 0.045 : 0.026);

      // lead arpeggio, triangle, riding the current chord
      const freq = this._noteHz(chord.arp[barStep]);
      const arp = this.ctx.createOscillator();
      arp.type = 'triangle'; arp.frequency.value = freq;
      const arpG = this.ctx.createGain();
      arpG.gain.setValueAtTime(barStep === 0 ? 0.085 : 0.06, time);
      arpG.gain.exponentialRampToValueAtTime(0.0001, time + this._ARP_STEP_SEC * 0.85);
      arp.connect(arpG); arpG.connect(this.musicGain);
      arp.start(time); arp.stop(time + this._ARP_STEP_SEC);
    },

    _musicTick(){
      if(!this.ctx || !this.musicRunning) return;
      const LOOKAHEAD = 0.3; // seconds ahead to schedule
      while(this.musicNextTime < this.ctx.currentTime + LOOKAHEAD){
        this._scheduleMusicNote(this.musicNextTime);
        this.musicNextTime += this._ARP_STEP_SEC;
      }
    },

    _MUSIC_BASE_GAIN: 0.42,

    startMusic(){
      // Gate: don't start if music is muted
      if(state.musicMuted ?? false) return;
      if(this.musicRunning) return;
      // Bring up AudioContext even if SFX is muted (music is independent)
      const c = this._ensureCtx(); if(!c) return;
      if(!this.musicGain){
        this.musicGain = c.createGain();
        this.musicGain.gain.value = this._MUSIC_BASE_GAIN;

        // warm low-pass on the dry signal so the synth band doesn't sound harsh
        this.musicFilter = c.createBiquadFilter();
        this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 2400;
        this.musicGain.connect(this.musicFilter);
        this.musicFilter.connect(c.destination);

        // short feedback delay send for a touch of space, synced to 2 steps
        this.musicDelay = c.createDelay(1.0);
        this.musicDelay.delayTime.value = this._ARP_STEP_SEC * 2;
        this.musicFeedback = c.createGain(); this.musicFeedback.gain.value = 0.27;
        this.musicWet = c.createGain(); this.musicWet.gain.value = 0.32;
        this.musicGain.connect(this.musicDelay);
        this.musicDelay.connect(this.musicFeedback);
        this.musicFeedback.connect(this.musicDelay);
        this.musicDelay.connect(this.musicWet);
        this.musicWet.connect(this.musicFilter);
      }
      this.musicRunning = true;
      this.musicNextTime = c.currentTime + 0.05;
      this._ARP_STEP_IDX = 0;
      this.musicTimerId = setInterval(()=>this._musicTick(), 100);
      this._musicTick();
    },

    stopMusic(){
      if(!this.musicRunning) return;
      this.musicRunning = false;
      if(this.musicTimerId != null){ clearInterval(this.musicTimerId); this.musicTimerId = null; }
      // Fade out quickly to avoid click
      if(this.musicGain && this.ctx){
        const now = this.ctx.currentTime;
        this.musicGain.gain.setTargetAtTime(0, now, 0.3);
      }
    },

    // v: 0-1
    setMusicVolume(v){
      const vol = Math.max(0, Math.min(1, v));
      if(this.musicGain && this.ctx){
        this.musicGain.gain.setTargetAtTime(vol * this._MUSIC_BASE_GAIN, this.ctx.currentTime, 0.05);
      }
    },
  };
  return SFX;
}
