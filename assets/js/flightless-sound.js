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
    // A lightweight procedural synth bed: a short arpeggio pattern scheduled
    // in a lookahead loop (Web Audio best-practice). Uses its OWN gain node
    // so state.musicMuted gates it entirely independently of state.muted.
    //
    // C minor pentatonic: C3 Eb3 F3 G3 Bb3 C4
    _ARP_NOTES: [130.81, 155.56, 174.61, 196.00, 233.08, 261.63],
    _ARP_PATTERN: [0, 2, 4, 3, 1, 4, 2, 5],  // indices into _ARP_NOTES
    _ARP_STEP_SEC: 0.22,
    _ARP_STEP_IDX: 0,

    _scheduleMusicNote(time){
      if(!this.musicGain || !this.ctx) return;
      const notes = this._ARP_NOTES;
      const pat   = this._ARP_PATTERN;
      const freq  = notes[pat[this._ARP_STEP_IDX % pat.length]];
      this._ARP_STEP_IDX++;

      // pad layer — sine at root freq for warmth
      const pad = this.ctx.createOscillator();
      pad.type = 'sine'; pad.frequency.value = freq * 0.5;
      const padG = this.ctx.createGain();
      padG.gain.setValueAtTime(0, time);
      padG.gain.linearRampToValueAtTime(0.04, time + 0.04);
      padG.gain.setValueAtTime(0.04, time + this._ARP_STEP_SEC * 2.5);
      padG.gain.linearRampToValueAtTime(0, time + this._ARP_STEP_SEC * 3.5);
      pad.connect(padG); padG.connect(this.musicGain);
      pad.start(time); pad.stop(time + this._ARP_STEP_SEC * 4);

      // arp note — triangle, one step duration
      const arp = this.ctx.createOscillator();
      arp.type = 'triangle'; arp.frequency.value = freq;
      const arpG = this.ctx.createGain();
      arpG.gain.setValueAtTime(0.06, time);
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

    startMusic(){
      // Gate: don't start if music is muted
      if(state.musicMuted ?? false) return;
      if(this.musicRunning) return;
      // Bring up AudioContext even if SFX is muted (music is independent)
      const c = this._ensureCtx(); if(!c) return;
      if(!this.musicGain){
        this.musicGain = c.createGain();
        this.musicGain.gain.value = 0.5;
        this.musicGain.connect(c.destination);
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
        this.musicGain.gain.setTargetAtTime(vol * 0.5, this.ctx.currentTime, 0.05);
      }
    },
  };
  return SFX;
}
