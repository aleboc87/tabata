/*
 * TabatAle - Tabata plan
 * Turns the setup values into an ordered list of phases.
 * Total time: T = P + L*R*(W+S) + (L-1)*B + C   (one block)
 * More blocks can follow the first one: each has its own Work, Rest and Rounds, an optional
 * exercise name, and a rest before it. Total = the first block + for every extra block (G + R*(W+S)).
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

  var MAX_BLOCKS = 10;   // including the first one
  var NAME_MAX = 30;
  /** What a new extra block starts with. */
  var BLOCK_DEFAULTS = { name: "", work: "20", rest: "10", rounds: "8", gap: "30" };
  // Limits of the fields of an extra block (work, rest, rounds share the main limits)
  var BLOCK_FIELDS = {
    gap: { label: "Rest before this block", seconds: true, min: 0, max: 600, step: 1 },
    work: FIELDS.work, rest: FIELDS.rest,
    rounds: { label: "Rounds", seconds: false, min: FIELDS.rounds.min, max: FIELDS.rounds.max, step: 1 }
  };

  function cleanName(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, NAME_MAX); }

  /** Extra blocks from stored data: only plain strings of digits and a short name survive. */
  function cleanBlocks(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (b) { return b && typeof b === "object"; }).slice(0, MAX_BLOCKS - 1).map(function (b) {
      var out = { name: cleanName(b.name) };
      ["work", "rest", "rounds", "gap"].forEach(function (k) {
        out[k] = /^\d{1,4}$/.test(String(b[k])) ? String(b[k]) : BLOCK_DEFAULTS[k];
      });
      return out;
    });
  }

  /** A full setup (what the form edits) from any stored or ready-made setup. Old setups without blocks stay valid. */
  function normalizeCfg(src) {
    var cfg = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var d = DEFAULTS[k], v = src && k in src ? src[k] : d;
      cfg[k] = typeof d === "boolean" ? !!v : String(v);
    });
    cfg.name1 = cleanName(src && src.name1);
    cfg.blocks = cleanBlocks(src && src.blocks);
    return cfg;
  }

  var PHASE_LABELS = {
    prep: "Get ready",
    work: "Work",
    rest: "Rest",
    between: "Loop rest",
    cool: "Cool down"
  };

  /** Parses one field. Returns a number, or null when empty / not a whole number / out of range. */
  function parseField(key, raw, table) {
    var f = (table || FIELDS)[key];
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
    // exercise name of the first block and the extra blocks (all optional)
    values.name = cleanName(cfg.name1);
    values.extra = [];
    var blocks = Array.isArray(cfg.blocks) ? cfg.blocks : [];
    if (blocks.length > MAX_BLOCKS - 1) errors.blocks = true;
    blocks.slice(0, MAX_BLOCKS - 1).forEach(function (b, i) {
      var out = { name: cleanName(b && b.name), work: 0, rest: 0, rounds: 0, gap: 0 };
      ["work", "rest", "rounds", "gap"].forEach(function (k) {
        var v = parseField(k, b && b[k], BLOCK_FIELDS);
        if (v === null) errors["b" + i + "." + k] = true;
        out[k] = v === null ? 0 : v;
      });
      values.extra.push(out);
    });
    return { ok: Object.keys(errors).length === 0, values: values, errors: errors };
  }

  /**
   * Builds the ordered phase list. A phase of 0 seconds is left out.
   * Each phase: { type, dur (seconds), round, loop, block, rounds, name?, next?, label? }.
   * loop counts the loops of the first block and then one more for every extra block;
   * block is the block number (1 for a plain workout); rounds is the rounds of its block;
   * name is the exercise (Work and Rest); next is the exercise coming after Get ready or a block rest.
   */
  function buildPhases(v) {
    var out = [];
    var extra = v.extra || [];
    function tag(p, block, rounds, name) {
      p.block = block; p.rounds = rounds;
      if (name) p.name = name;
      return p;
    }
    if (v.prep > 0) {
      var pp = tag({ type: "prep", dur: v.prep, round: 0, loop: 1 }, 1, v.rounds);
      if (v.name) pp.next = v.name;
      out.push(pp);
    }
    for (var l = 1; l <= v.loops; l++) {
      for (var r = 1; r <= v.rounds; r++) {
        out.push(tag({ type: "work", dur: v.work, round: r, loop: l }, 1, v.rounds, v.name));
        if (v.rest > 0) out.push(tag({ type: "rest", dur: v.rest, round: r, loop: l }, 1, v.rounds, v.name));
      }
      if (l < v.loops && v.between > 0) out.push(tag({ type: "between", dur: v.between, round: v.rounds, loop: l }, 1, v.rounds, v.name));
    }
    var lastRounds = v.rounds, lastLoop = v.loops;
    extra.forEach(function (b, i) {
      var loop = v.loops + i + 1, block = i + 2;
      if (b.gap > 0) {
        var g = tag({ type: "between", dur: b.gap, round: lastRounds, loop: lastLoop, label: "Block rest" }, block, b.rounds);
        if (b.name) g.next = b.name;
        out.push(g);
      }
      for (var r = 1; r <= b.rounds; r++) {
        out.push(tag({ type: "work", dur: b.work, round: r, loop: loop }, block, b.rounds, b.name));
        if (b.rest > 0) out.push(tag({ type: "rest", dur: b.rest, round: r, loop: loop }, block, b.rounds, b.name));
      }
      lastRounds = b.rounds; lastLoop = loop;
    });
    if (v.cool > 0) out.push(tag({ type: "cool", dur: v.cool, round: lastRounds, loop: lastLoop }, extra.length + 1, lastRounds));
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
    BLOCK_FIELDS: BLOCK_FIELDS,
    BLOCK_DEFAULTS: BLOCK_DEFAULTS,
    MAX_BLOCKS: MAX_BLOCKS,
    NAME_MAX: NAME_MAX,
    cleanName: cleanName,
    cleanBlocks: cleanBlocks,
    normalizeCfg: normalizeCfg,
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
