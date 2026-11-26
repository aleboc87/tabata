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
    cool: false, coolDur: 120,
    type: "interval", every: 60, amrapDur: 600
  };

  // The kinds of block. interval: Work/Rest rounds (the classic). emom: a new round starts every X seconds.
  // amrap: one countdown, count as many rounds as you can.
  var TYPES = ["interval", "emom", "amrap"];
  function cleanType(t) { return TYPES.indexOf(t) >= 0 ? t : "interval"; }

  // Limits and +/- step for every number field
  var FIELDS = {
    prepDur: { label: "Get ready time", seconds: true, min: 1, max: 60, step: 1 },
    work: { label: "Work", seconds: true, min: 1, max: 600, step: 1 },
    rest: { label: "Rest", seconds: true, min: 0, max: 600, step: 1 },
    rounds: { label: "Rounds per loop", seconds: false, min: 1, max: 50, step: 1 },
    loops: { label: "Loops", seconds: false, min: 1, max: 20, step: 1 },
    between: { label: "Loop rest", seconds: true, min: 0, max: 600, step: 1 },
    coolDur: { label: "Cool down time", seconds: true, min: 1, max: 1800, step: 1 },
    every: { label: "Every", seconds: true, min: 10, max: 600, step: 1 },
    amrapDur: { label: "Duration", seconds: true, min: 10, max: 3600, step: 1 }
  };

  var MAX_BLOCKS = 10;   // including the first one
  var NAME_MAX = 30;
  /** What a new extra block starts with. */
  var BLOCK_DEFAULTS = { type: "interval", name: "", work: "20", rest: "10", rounds: "8", every: "60", dur: "600", gap: "30" };
  // Limits of the fields of an extra block (work, rest, rounds share the main limits)
  var BLOCK_FIELDS = {
    gap: { label: "Rest before this block", seconds: true, min: 0, max: 600, step: 1 },
    every: FIELDS.every,
    dur: FIELDS.amrapDur,
    work: FIELDS.work, rest: FIELDS.rest,
    rounds: { label: "Rounds", seconds: false, min: FIELDS.rounds.min, max: FIELDS.rounds.max, step: 1 }
  };

  /** The fields of an extra block that matter for each type. */
  var BLOCK_KEYS = {
    interval: ["work", "rest", "rounds"],
    emom: ["every", "rounds"],
    amrap: ["dur"]
  };

  function cleanName(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, NAME_MAX); }

  /** Extra blocks from stored data: only plain strings of digits and a short name survive. */
  function cleanBlocks(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (b) { return b && typeof b === "object"; }).slice(0, MAX_BLOCKS - 1).map(function (b) {
      var out = { type: cleanType(b.type), name: cleanName(b.name) };
      ["work", "rest", "rounds", "every", "dur", "gap"].forEach(function (k) {
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
    cfg.type = cleanType(src && src.type);
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
    var values = { prep: 0, work: 0, rest: 0, rounds: 0, loops: 0, between: 0, cool: 0, type: cleanType(cfg.type), every: 0, dur: 0 };
    function take(key, into) {
      var v = parseField(key, cfg[key]);
      if (v === null) errors[key] = true;
      values[into] = v === null ? 0 : v;
    }
    if (values.type === "interval") {
      take("work", "work");
      take("rest", "rest");
      take("rounds", "rounds");
      take("loops", "loops");
      if (values.loops > 1) take("between", "between");
    } else if (values.type === "emom") {
      take("every", "every");
      take("rounds", "rounds");
      values.loops = 1;
    } else {
      take("amrapDur", "dur");
      values.loops = 1;
    }
    if (cfg.prep) take("prepDur", "prep");
    if (cfg.cool) take("coolDur", "cool");
    // exercise name of the first block and the extra blocks (all optional)
    values.name = cleanName(cfg.name1);
    values.extra = [];
    var blocks = Array.isArray(cfg.blocks) ? cfg.blocks : [];
    if (blocks.length > MAX_BLOCKS - 1) errors.blocks = true;
    blocks.slice(0, MAX_BLOCKS - 1).forEach(function (b, i) {
      var type = cleanType(b && b.type);
      var out = { type: type, name: cleanName(b && b.name), work: 0, rest: 0, rounds: 0, every: 0, dur: 0, gap: 0 };
      BLOCK_KEYS[type].concat(["gap"]).forEach(function (k) {
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
   * Each phase: { type, dur (seconds), round, loop, block, rounds, name?, next?, label?, kind?, unit? }.
   * loop counts the loops of the first block and then one more for every extra block;
   * block is the block number (1 for a plain workout); rounds is the rounds of its block;
   * name is the exercise (Work and Rest); next is the exercise coming after Get ready or a block rest;
   * kind is "emom" or "amrap" for those blocks (their phases are of type work).
   */
  function buildPhases(v) {
    var out = [];
    var extra = v.extra || [];
    function tag(p, block, rounds, name) {
      p.block = block; p.rounds = rounds;
      if (name) p.name = name;
      return p;
    }
    /** One block: Work/Rest rounds, an EMOM or an AMRAP. loop is the number of its first loop. */
    function addBlock(b, block, loop, loops, between) {
      if (b.type === "emom") {
        for (var m = 1; m <= b.rounds; m++) {
          var e = tag({ type: "work", dur: b.every, round: m, loop: loop, kind: "emom" }, block, b.rounds, b.name);
          e.unit = b.every === 60 ? "Minute" : "Round";
          out.push(e);
        }
        return;
      }
      if (b.type === "amrap") {
        var a = tag({ type: "work", dur: b.dur, round: 1, loop: loop, kind: "amrap", label: "AMRAP" }, block, 1, b.name);
        out.push(a);
        return;
      }
      for (var l = 1; l <= loops; l++) {
        for (var r = 1; r <= b.rounds; r++) {
          out.push(tag({ type: "work", dur: b.work, round: r, loop: loop + l - 1 }, block, b.rounds, b.name));
          if (b.rest > 0) out.push(tag({ type: "rest", dur: b.rest, round: r, loop: loop + l - 1 }, block, b.rounds, b.name));
        }
        if (l < loops && between > 0) out.push(tag({ type: "between", dur: between, round: b.rounds, loop: loop + l - 1 }, block, b.rounds, b.name));
      }
    }
    var first = { type: v.type || "interval", name: v.name, work: v.work, rest: v.rest, rounds: v.rounds, every: v.every, dur: v.dur };
    if (v.prep > 0) {
      var pp = tag({ type: "prep", dur: v.prep, round: 0, loop: 1 }, 1, first.type === "amrap" ? 1 : v.rounds);
      if (v.name) pp.next = v.name;
      out.push(pp);
    }
    addBlock(first, 1, 1, v.loops, v.between);
    var lastRounds = first.type === "amrap" ? 1 : v.rounds, lastLoop = v.loops;
    extra.forEach(function (b, i) {
      var loop = v.loops + i + 1, block = i + 2;
      if (b.gap > 0) {
        var g = tag({ type: "between", dur: b.gap, round: lastRounds, loop: lastLoop, label: "Block rest" }, block, b.type === "amrap" ? 1 : b.rounds);
        if (b.name) g.next = b.name;
        out.push(g);
      }
      addBlock(b, block, loop, 1, 0);
      lastRounds = b.type === "amrap" ? 1 : b.rounds; lastLoop = loop;
    });
    if (v.cool > 0) out.push(tag({ type: "cool", dur: v.cool, round: lastRounds, loop: lastLoop }, extra.length + 1, lastRounds));
    return out;
  }

  /**
   * What the voice says when phase idx begins, or null. Only exercises with a name are spoken.
   * { text, next }: next = true means "Next, <name>" (said during Get ready or a rest, before the exercise
   * changes); otherwise the name alone (when an exercise starts right after another one).
   * The same exercise is never repeated for every round.
   */
  function announcement(phases, idx) {
    var p = phases[idx];
    if (!p) return null;
    var prevWork = "";
    for (var i = idx - 1; i >= 0; i--) {
      if (phases[i].type === "work") { prevWork = phases[i].name || ""; break; }
    }
    var quiet = { prep: 1, rest: 1, between: 1 };
    if (quiet[p.type]) {
      var nxt = null;
      for (var j = idx + 1; j < phases.length; j++) {
        if (phases[j].type === "work") { nxt = phases[j]; break; }
        if (phases[j].type === "cool") break;
      }
      // a rest followed by the block rest leaves the announcement to the block rest
      if (!nxt || !nxt.name || nxt.name === prevWork) return null;
      var after = phases[idx + 1];
      if (p.type === "rest" && after && after.type === "between") return null;
      return { text: nxt.name, next: true };
    }
    if (p.type === "work" && p.name && p.name !== prevWork) {
      var before = phases[idx - 1];
      if (before && quiet[before.type]) return null; // it was announced during the rest before
      return { text: p.name, next: false };
    }
    return null;
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
    TYPES: TYPES,
    BLOCK_KEYS: BLOCK_KEYS,
    cleanType: cleanType,
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
    announcement: announcement,
    totalSeconds: totalSeconds,
    formatClock: formatClock
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TabataPlan = api;
})(this);
