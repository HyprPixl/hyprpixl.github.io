// Flightless — sound module.
//
// A tiny synth built on the Web Audio API: short blips for pickups/buys,
// a looping filtered-noise bed for the rocket thrust, and the handful of
// named cues (ding/tick/thump/boom/launch) the sim and UI call by name.
// Takes the save state so it can respect the mute flag without the rest
// of the game reaching into its internals.
export function createSound(state){
  const SFX = {
    ctx:null, thrustGain:null,
    ensure(){
      if(state.muted) return null;
      if(!this.ctx){
        try{ this.ctx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; }
        // looping noise buffer for the rocket
        const len = this.ctx.sampleRate * 0.5;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for(let i=0;i<len;i++) d[i] = Math.random()*2-1;
        const src = this.ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const filt = this.ctx.createBiquadFilter();
        filt.type='lowpass'; filt.frequency.value = 500;
        this.thrustGain = this.ctx.createGain();
        this.thrustGain.gain.value = 0;
        src.connect(filt); filt.connect(this.thrustGain); this.thrustGain.connect(this.ctx.destination);
        src.start();
      }
      if(this.ctx.state==='suspended') this.ctx.resume();
      return this.ctx;
    },
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
      o.type='sawtooth';
      o.frequency.setValueAtTime(120, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(700, c.currentTime+0.5);
      g.gain.setValueAtTime(0.1, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+0.6);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+0.7);
    },
    ding(){ this.blip(880,0.15,'sine',0.1); setTimeout(()=>this.blip(1320,0.25,'sine',0.1), 110); },
    tick(){ this.blip(1400,0.03,'square',0.03); },
    buy(){ this.blip(660,0.08,'square',0.06); setTimeout(()=>this.blip(990,0.1,'square',0.06), 70); },
    thump(){ this.blip(90,0.15,'sine',0.15); },
    boom(){ this.blip(55,0.5,'sawtooth',0.22); this.blip(220,0.25,'square',0.1); },
    setThrust(on){
      if(state.muted || !this.thrustGain) { if(this.thrustGain) this.thrustGain.gain.value=0; return; }
      this.thrustGain.gain.setTargetAtTime(on?0.12:0, this.ctx.currentTime, 0.05);
    },
  };
  return SFX;
}
