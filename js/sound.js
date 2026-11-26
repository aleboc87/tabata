/*
 * TabatAle - Sounds and voice
 * Beep: generated on the fly (sine 880 Hz, 120 ms) on the last 3 seconds of every phase.
 * Voice: short recorded clips, "Let's GO" at the start of Work, "Rest" at the start of Rest
 * and "Rinfrescàti" when the workout is complete.
 * Every sound is scheduled ahead on the audio clock, so it plays on time even if the screen is busy.
 */
(function (root) {
  "use strict";

  var BEEP = { freq: 880, dur: 0.12, gain: 0.35 };
  var VOICE_FILES = { go: "audio/go.mp3", rest: "audio/rest.mp3", done: "audio/done.mp3" };
  var HORIZON_MS = 12000; // schedule sounds up to 12 s ahead
  var LATE_MS = 150;      // a sound that is late by less than this still plays

  var ctx = null;
  var buffers = {};       // decoded voice clips
  var loading = null;
  var muted = false;
  var scheduled = {};     // key -> [audio nodes]

  function getContext() {
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    return ctx;
  }

  function loadVoices() {
    if (loading || !ctx || typeof fetch !== "function") return loading;
    loading = Promise.all(Object.keys(VOICE_FILES).map(function (name) {
      return fetch(VOICE_FILES[name])
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (data) {
          return new Promise(function (resolve, reject) {
            // the callback form also works on older Safari
            ctx.decodeAudioData(data, resolve, reject);
          });
        })
        .then(function (buf) { buffers[name] = buf; })
        .catch(function () { /* the voice is missing: the workout goes on without it */ });
    }));
    return loading;
  }

  /** Must be called from a tap (START, Keep going, Resume...): browsers allow sound only after one. */
  function unlock() {
    try {
      // iPhone: play even with the silent switch on (Safari 17+)
      if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = "playback";
    } catch (e) { /* not supported */ }
    var ac = getContext();
    if (!ac) return;
    try {
      if (ac.state !== "running") ac.resume();
      // a silent instant sound fully unlocks audio on iOS
      var b = ac.createBuffer(1, 1, 22050);
      var s = ac.createBufferSource();
      s.buffer = b; s.connect(ac.destination); s.start(0);
    } catch (e) { /* ignore */ }
    loadVoices();
  }

  /** Tries to wake the audio up again, e.g. after a phone call or when coming back to the app. */
  function wake() {
    if (ctx && ctx.state !== "running") {
      try { ctx.resume(); } catch (e) { /* ignore */ }
    }
  }

  function track(key, node) {
    (scheduled[key] = scheduled[key] || []).push(node);
    node.onended = function () {
      var list = scheduled[key];
      if (!list) return;
      var i = list.indexOf(node);
      if (i >= 0) list.splice(i, 1);
      // keep the key (with an empty list) so the same cue is not scheduled twice
    };
  }

  function playBeepAt(when, key) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = BEEP.freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(BEEP.gain, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + BEEP.dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(when); o.stop(when + BEEP.dur + 0.02);
    track(key, o);
  }

  function playVoiceAt(name, when, key) {
    var buf = buffers[name];
    if (!buf) return false;
    var s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(ctx.destination);
    s.start(when);
    track(key, s);
    return true;
  }

  /** Stops every scheduled sound (pause, skip, back, mute, stop). */
  function cancelAll() {
    Object.keys(scheduled).forEach(function (key) {
      scheduled[key].forEach(function (node) {
        try { node.onended = null; node.stop(0); } catch (e) { /* already stopped */ }
      });
    });
    scheduled = {};
    if (root.Speech) root.Speech.cancel(); // a spoken name stops with everything else
  }

  /** The sounds of one phase, as offsets in ms from its start. */
  function cuesOf(phase) {
    var out = [];
    if (phase.type === "work") out.push({ cue: "go", at: 0 });
    else if (phase.type === "rest") out.push({ cue: "rest", at: 0 });
    // the same countdown ends every phase: preparation, work, rest, rest between loops/blocks, cool-down
    for (var s = 3; s >= 1; s--) {
      var at = (phase.dur - s) * 1000;
      if (at > 0) out.push({ cue: "beep" + s, at: at });
    }
    return out;
  }

  /**
   * Schedules the sounds of the coming seconds for a running workout.
   * Safe to call many times: a sound already scheduled is not added again.
   */
  function sync(runner, now) {
    if (muted || !ctx || ctx.state !== "running" || runner.paused || runner.done) return;
    for (var i = runner.idx; i < runner.phases.length; i++) {
      var start = runner.phaseStartTime(i, now);
      if (start - now > HORIZON_MS) break;
      var list = cuesOf(runner.phases[i]);
      for (var c = 0; c < list.length; c++) {
        var t = start + list[c].at;
        var key = i + ":" + list[c].cue + ":" + runner.jumps;
        if (scheduled[key]) continue;
        if (t < now - LATE_MS || t - now > HORIZON_MS) continue;
        var when = ctx.currentTime + Math.max(0, (t - now) / 1000);
        var cue = list[c].cue;
        if (cue === "go" || cue === "rest") {
          if (!playVoiceAt(cue, when, key)) continue;
        } else {
          playBeepAt(when, key);
        }
      }
    }
  }

  /** Plays a voice clip right away (e.g. "done" at the end of the workout). */
  function playNow(name) {
    if (muted || !ctx) return;
    wake();
    try { playVoiceAt(name, ctx.currentTime, "now:" + name + ":" + Date.now()); } catch (e) { /* ignore */ }
  }

  function setMuted(m) {
    muted = !!m;
    if (muted) cancelAll();
  }

  /** Prepares the audio and decodes the voice clips early, so the first "Let's GO" is ready in time. */
  function preload() {
    if (getContext()) loadVoices();
  }

  root.Sound = {
    preload: preload,
    unlock: unlock,
    wake: wake,
    sync: sync,
    cancelAll: cancelAll,
    playNow: playNow,
    setMuted: setMuted,
    isMuted: function () { return muted; },
    cuesOf: cuesOf
  };
})(this);
