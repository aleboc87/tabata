/*
 * TabatAle - Tabata plan
 * Turns the setup values into an ordered list of phases.
 * Total time: T = P + L*R*(W+S) + (L-1)*B + C
 */
(function (root) {
  "use strict";

  var DEFAULTS = {
    prep: true, prepDur: 10,
    work: 20, rest: 10, rounds: 8,
    loops: 1, between: 60,
    cool: false, coolDur: 120
  };

  // Limits and +/- step for every number field
  var FIELDS = {
    prepDur: { label: "Get ready time", seconds: true, min: 1, max: 60, step: 1 },
    work: { label: "Work", seconds: true, min: 1, max: 600, step: 1 },
    rest: { label: "Rest", seconds: true, min: 0, max: 600, step: 1 },
    rounds: { label: "Rounds per loop", seconds: false, min: 1, max: 50, step: 1 },
    loops: { label: "Loops", seconds: false, min: 1, max: 20, step: 1 },
    between: { label: "Loop rest", seconds: true, min: 0, max: 600, step: 1 },
    coolDur: { label: "Cool down time", seconds: true, min: 1, max: 1800, step: 1 }
  };

  var PHASE_LABELS = {
    prep: "Get ready",
    work: "Work",
    rest: "Rest",
    between: "Loop rest",
    cool: "Cool down"
  };

  /** Parses one field. Returns a number, or null when empty / not a whole number / out of range. */
  function parseField(key, raw) {
    var f = FIELDS[key];
    var s = String(raw == null ? "" : raw).trim();
    if (!/^\d+$/.test(s)) return null;
    var v = Number(s);
    return v < f.min || v > f.max ? null : v;
  }

  /**
   * Validates a setup. Fields that are not used (prep off, cool off, loop rest with 1 loop)
   * are not checked. Returns { ok, values, errors } where errors maps field -> true.
   */
  function validate(cfg) {
    var errors = {};
    var values = { prep: 0, work: 0, rest: 0, rounds: 0, loops: 0, between: 0, cool: 0 };
    function take(key, into) {
      var v = parseField(key, cfg[key]);
      if (v === null) errors[key] = true;
      values[into] = v === null ? 0 : v;
    }
    take("work", "work");
    take("rest", "rest");
    take("rounds", "rounds");
    take("loops", "loops");
    if (cfg.prep) take("prepDur", "prep");
    if (values.loops > 1) take("between", "between");
    if (cfg.cool) take("coolDur", "cool");
    return { ok: Object.keys(errors).length === 0, values: values, errors: errors };
  }

  /**
   * Builds the ordered phase list. A phase of 0 seconds is left out.
   * Each phase: { type, dur (seconds), round, loop }.
   */
  function buildPhases(v) {
    var out = [];
    if (v.prep > 0) out.push({ type: "prep", dur: v.prep, round: 0, loop: 1 });
    for (var l = 1; l <= v.loops; l++) {
      for (var r = 1; r <= v.rounds; r++) {
        out.push({ type: "work", dur: v.work, round: r, loop: l });
        if (v.rest > 0) out.push({ type: "rest", dur: v.rest, round: r, loop: l });
      }
      if (l < v.loops && v.between > 0) out.push({ type: "between", dur: v.between, round: v.rounds, loop: l });
    }
    if (v.cool > 0) out.push({ type: "cool", dur: v.cool, round: v.rounds, loop: v.loops });
    return out;
  }

  function totalSeconds(phases) {
    return phases.reduce(function (a, p) { return a + p.dur; }, 0);
  }

  /** 75 -> "1:15", 3725 -> "1:02:05" */
  function formatClock(s) {
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    var p = function (n) { return String(n).padStart(2, "0"); };
    return h > 0 ? h + ":" + p(m) + ":" + p(x) : m + ":" + p(x);
  }

  var api = {
    DEFAULTS: DEFAULTS,
    FIELDS: FIELDS,
    PHASE_LABELS: PHASE_LABELS,
    parseField: parseField,
    validate: validate,
    buildPhases: buildPhases,
    totalSeconds: totalSeconds,
    formatClock: formatClock
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TabataPlan = api;
})(this);
