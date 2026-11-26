// Level 1 - logic tests. Run with: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Plan = require("../js/tabata-plan.js");
const Runner = require("../js/tabata-runner.js");
const Stopwatch = require("../js/stopwatch.js");
const Progress = require("../js/progress-bar.js");
const Sound = require("../js/sound.js").Sound;

const DEF = { prep: true, prepDur: "10", work: "20", rest: "10", rounds: "8", loops: "1", between: "60", cool: false, coolDur: "120", type: "interval", every: "60", amrapDur: "600" };
const cfg = (over) => Object.assign({}, DEF, over);
const phasesOf = (over) => {
  const v = Plan.validate(cfg(over));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return Plan.buildPhases(v.values);
};
const formula = (P, L, R, W, S, B, C) => P + L * R * (W + S) + (L - 1) * B + C;

// ---------------------------------------------------------------- plan
test("defaults: 17 phases, 4:10", () => {
  const ph = phasesOf({});
  assert.equal(ph.length, 17);
  assert.equal(ph[0].type, "prep");
  assert.deepEqual(ph.slice(1, 3).map((p) => p.type), ["work", "rest"]);
  assert.equal(ph[16].type, "rest", "rest after the last round too");
  assert.equal(Plan.totalSeconds(ph), 250);
  assert.equal(Plan.formatClock(250), "4:10");
});

test("3 loops + loop rest + cool down follow the formula (16:10)", () => {
  const ph = phasesOf({ loops: "3", cool: true });
  assert.equal(Plan.totalSeconds(ph), formula(10, 3, 8, 20, 10, 60, 120));
  assert.equal(Plan.formatClock(Plan.totalSeconds(ph)), "16:10");
  const types = ph.map((p) => p.type);
  assert.equal(types.filter((t) => t === "between").length, 2);
  assert.equal(types[types.length - 1], "cool");
  // after loop rest, work starts straight away
  const b = types.indexOf("between");
  assert.equal(types[b + 1], "work");
  assert.equal(ph[b + 1].loop, 2);
});

test("random setups always match the formula", () => {
  for (let i = 0; i < 300; i++) {
    const r = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const o = { prep: Math.random() < 0.5, prepDur: String(r(1, 60)), work: String(r(1, 600)), rest: String(r(0, 600)),
      rounds: String(r(1, 50)), loops: String(r(1, 20)), between: String(r(0, 600)), cool: Math.random() < 0.5, coolDur: String(r(1, 1800)) };
    const ph = phasesOf(o);
    const L = +o.loops;
    const exp = formula(o.prep ? +o.prepDur : 0, L, +o.rounds, +o.work, +o.rest, L > 1 ? +o.between : 0, o.cool ? +o.coolDur : 0);
    assert.equal(Plan.totalSeconds(ph), exp);
    assert.ok(ph.every((p) => p.dur > 0), "no 0 s phase");
  }
});

test("rest 0 and loop rest 0 are left out; prep and cool off", () => {
  const ph = phasesOf({ prep: false, rest: "0", loops: "2", between: "0" });
  assert.ok(ph.every((p) => p.type === "work"));
  assert.equal(ph.length, 16);
});

test("validation: only used fields are checked", () => {
  assert.equal(Plan.validate(cfg({ prep: false, prepDur: "abc" })).ok, true);
  assert.equal(Plan.validate(cfg({ cool: false, coolDur: "" })).ok, true);
  assert.equal(Plan.validate(cfg({ loops: "1", between: "9999" })).ok, true);
  for (const bad of ["", "abc", "0", "601", "-5", "1.5"]) {
    const v = Plan.validate(cfg({ work: bad }));
    assert.equal(v.ok, false, "work=" + bad);
    assert.equal(v.errors.work, true);
  }
  assert.equal(Plan.validate(cfg({ rest: "0" })).ok, true);
  assert.equal(Plan.validate(cfg({ rounds: "51" })).ok, false);
  assert.equal(Plan.validate(cfg({ loops: "2", between: "601" })).ok, false);
});

test("every second value is allowed (step 1)", () => {
  for (let s = 1; s <= 600; s++) assert.equal(Plan.parseField("work", String(s)), s);
  assert.ok(Object.values(Plan.FIELDS).every((f) => f.step === 1));
});

// ---------------------------------------------------------------- runner
const shortPlan = () => phasesOf({ prep: true, prepDur: "5", work: "4", rest: "3", rounds: "2", loops: "2", between: "6", cool: true, coolDur: "7" });

test("runner moves through phases at the exact millisecond", () => {
  const ph = shortPlan();
  const r = new Runner(ph);
  r.start(1000);
  assert.equal(r.idx, 0);
  r.update(1000 + 4999); assert.equal(r.idx, 0);
  assert.equal(r.remainingInPhaseMs(1000 + 4999), 1);
  r.update(1000 + 5000); assert.equal(r.idx, 1);
  assert.equal(r.current().type, "work");
  assert.equal(r.remainingTotalMs(1000 + 5000), Plan.totalSeconds(ph) * 1000 - 5000);
});

test("app asleep for a long time: catches up, ends with done", () => {
  const ph = shortPlan();
  const total = Plan.totalSeconds(ph) * 1000;
  const r = new Runner(ph);
  r.start(0);
  const ev = r.update(5000 + 4000 + 1500); // inside first rest
  assert.equal(r.current().type, "rest");
  assert.equal(ev.length, 2);
  assert.equal(r.remainingInPhaseMs(10500), 1500);
  const end = r.update(total + 10);
  assert.equal(r.done, true);
  assert.equal(end[end.length - 1].type, "done");
});

test("pause freezes time, resume continues from the same point", () => {
  const r = new Runner(shortPlan());
  r.start(0);
  r.pause(2000);
  assert.equal(r.remainingInPhaseMs(60000), 3000);
  r.update(60000); assert.equal(r.idx, 0);
  r.resume(60000);
  assert.equal(r.remainingInPhaseMs(60000), 3000);
  r.update(63000); assert.equal(r.idx, 1);
});

test("back: start of phase after 2 s, previous phase before 2 s, never before the first", () => {
  const r = new Runner(shortPlan());
  r.start(0);
  assert.equal(r.canGoBack(1999), false);
  assert.equal(r.canGoBack(2000), true);
  r.back(3000); assert.equal(r.idx, 0); assert.equal(r.remainingInPhaseMs(3000), 5000);
  r.update(8000 + 2500); // phase 1 (work), 2.5 s in
  assert.equal(r.idx, 1);
  r.back(10500); assert.equal(r.idx, 1, "after 2 s: restart this phase");
  r.back(11000); assert.equal(r.idx, 0, "within 2 s: previous phase");
  r.back(11500); assert.equal(r.idx, 0);
});

test("skip and back also work while paused, and stay paused", () => {
  const r = new Runner(shortPlan());
  r.start(0);
  r.pause(1000);
  r.skip(5000);
  assert.equal(r.idx, 1); assert.equal(r.paused, true);
  assert.equal(r.remainingInPhaseMs(9000), 4000);
  r.back(9000); assert.equal(r.idx, 0, "paused at 0 s of the phase: goes back");
  assert.equal(r.paused, true);
});

test("skip on the last phase ends the workout", () => {
  const ph = shortPlan();
  const r = new Runner(ph);
  r.start(0);
  for (let i = 0; i < ph.length - 1; i++) assert.equal(r.skip(0), true);
  assert.equal(r.current().type, "cool");
  assert.equal(r.skip(0), false);
  assert.equal(r.done, true);
});

test("pause across a phase change keeps the right phase", () => {
  const r = new Runner(shortPlan());
  r.start(0);
  r.pause(6000); // 1 s into work
  assert.equal(r.idx, 1);
  assert.equal(r.remainingInPhaseMs(99999), 3000);
});

// ---------------------------------------------------------------- stopwatch
test("stopwatch: start/stop many times, exact to the tenth", () => {
  const s = new Stopwatch();
  s.start(0); s.stop(1234); s.start(5000); s.stop(5100);
  assert.equal(s.elapsed(99999), 1334);
  assert.equal(Stopwatch.format(1334), "00:01,3");
  assert.equal(Stopwatch.format(3600 * 1000 + 61500), "1:01:01,5");
  s.reset(); assert.equal(s.elapsed(10), 0);
});

test("stopwatch laps: newest first, best and worst", () => {
  const s = new Stopwatch();
  s.start(0);
  s.lap(700); s.lap(1100); s.lap(2000);
  const rows = s.lapRows(2500);
  assert.deepEqual(rows.map((r) => r.n), [4, 3, 2, 1]);
  assert.equal(rows[0].kind, "current"); assert.equal(rows[0].lap, 500);
  assert.equal(rows.find((r) => r.n === 2).kind, "best");
  assert.equal(rows.find((r) => r.n === 3).kind, "worst");
  s.stop(3000); s.lap(4000);
  assert.equal(s.laps.length, 3, "no LAP while stopped");
});

// ---------------------------------------------------------------- bar and counters
test("bar: equal segments, cursor, loop notch", () => {
  const ph = phasesOf({ loops: "2" });
  const m = Progress.barModel(ph, 3, 0.5, 2);
  assert.equal(m.compact, false);
  assert.equal(m.segments.length, ph.length);
  assert.ok(Math.abs(m.cursor - 3.5 / ph.length) < 1e-9);
  assert.equal(m.segments.filter((s) => s.notch).length, 1);
  assert.equal(m.segments.filter((s) => s.past).length, 3);
});

test("bar over 40 segments: current loop only, plus dots", () => {
  const ph = phasesOf({ loops: "4", cool: true });
  assert.ok(ph.length > 40);
  const i = ph.findIndex((p) => p.loop === 2 && p.type === "work");
  const m = Progress.barModel(ph, i, 0, 4);
  assert.equal(m.compact, true);
  assert.equal(m.segments.length, 17); // 8 work + 8 rest + loop rest
  assert.deepEqual(m.dots, ["done", "current", "todo", "todo"]);
  const prep = Progress.barModel(ph, 0, 0, 4);
  assert.equal(prep.segments.length, 1);
});

test("counters: LOOP, WORK in loop, WORK total", () => {
  const ph = phasesOf({ loops: "3", cool: true });
  const c = (i) => { const x = Progress.counters(ph, i, 8, 3); assert.deepEqual(x.labels, { loop: "Loop", workLoop: "Work \u00b7 loop" }); delete x.labels; return x; };
  assert.deepEqual(c(0), { loop: "1/3", workLoop: "–/8", workTotal: "–/24" });
  assert.deepEqual(c(1), { loop: "1/3", workLoop: "1/8", workTotal: "1/24" });
  assert.deepEqual(c(2), { loop: "1/3", workLoop: "1/8", workTotal: "1/24" });
  const b = ph.findIndex((p) => p.type === "between");
  assert.deepEqual(c(b), { loop: "1/3", workLoop: "8/8", workTotal: "8/24" });
  assert.deepEqual(c(b + 1), { loop: "2/3", workLoop: "1/8", workTotal: "9/24" });
  assert.deepEqual(c(ph.length - 1), { loop: "3/3", workLoop: "8/8", workTotal: "24/24" });
});

// ---------------------------------------------------------------- sounds
test("sound cues: Let's GO at 0 s, beeps at -3/-2/-1 s, Rest at start", () => {
  assert.deepEqual(Sound.cuesOf({ type: "work", dur: 20 }),
    [{ cue: "go", at: 0 }, { cue: "beep3", at: 17000 }, { cue: "beep2", at: 18000 }, { cue: "beep1", at: 19000 }]);
  assert.deepEqual(Sound.cuesOf({ type: "work", dur: 3 }), [{ cue: "go", at: 0 }, { cue: "beep2", at: 1000 }, { cue: "beep1", at: 2000 }]);
  assert.deepEqual(Sound.cuesOf({ type: "work", dur: 1 }), [{ cue: "go", at: 0 }]);
  assert.deepEqual(Sound.cuesOf({ type: "rest", dur: 10 }), [{ cue: "rest", at: 0 }]);
  for (const t of ["prep", "between", "cool"]) assert.deepEqual(Sound.cuesOf({ type: t, dur: 30 }), []);
});

// ---------------------------------------------------------------- saved workouts
const WorkoutStore = require("../js/workouts.js");
function memStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m };
}
function tickClock() { let t = 1000; return () => ++t; }

test("save up to 10 workouts, the 11th is refused", () => {
  const s = new WorkoutStore(memStorage(), tickClock());
  for (let i = 1; i <= 10; i++) assert.equal(s.save("W" + i, DEF).ok, true);
  const r = s.save("W11", DEF);
  assert.deepEqual([r.ok, r.error], [false, "full"]);
  assert.equal(s.count(), 10);
  // replacing an existing one is still allowed when full
  assert.equal(s.save("w3", cfg({ work: "45" }), { replace: true }).ok, true);
  assert.equal(s.findByName("W3").cfg.work, "45");
});

test("names: trimmed, max 30 chars, empty refused, same name asks to replace", () => {
  const s = new WorkoutStore(memStorage(), tickClock());
  assert.equal(s.save("   ", DEF).error, "empty");
  const long = "x".repeat(40);
  assert.equal(s.save(long, DEF).workout.name.length, 30);
  assert.equal(s.save("  Leg   day ", DEF).workout.name, "Leg day");
  const r = s.save("LEG DAY", DEF);
  assert.equal(r.error, "exists");
  assert.equal(r.existing.name, "Leg day");
  assert.equal(s.count(), 2);
});

test("saved copy does not change when the setup changes later", () => {
  const s = new WorkoutStore(memStorage(), tickClock());
  const c = cfg({});
  s.save("A", c);
  c.work = "99";
  assert.equal(s.findByName("A").cfg.work, "20");
});

test("search: contains, ignores case and accents; list ordered by last use", () => {
  const s = new WorkoutStore(memStorage(), tickClock());
  const a = s.save("Gambe veloci", DEF).workout;
  s.save("Braccia", DEF);
  s.save("Café Tabata", DEF);
  assert.deepEqual(s.search("GAMB").map((w) => w.name), ["Gambe veloci"]);
  assert.deepEqual(s.search("cafe").map((w) => w.name), ["Café Tabata"]);
  assert.deepEqual(s.search("zzz"), []);
  assert.equal(s.search("").length, 3);
  assert.deepEqual(s.list().map((w) => w.name), ["Café Tabata", "Braccia", "Gambe veloci"]);
  s.markUsed(a.id);
  assert.equal(s.list()[0].name, "Gambe veloci");
});

test("rename and delete", () => {
  const s = new WorkoutStore(memStorage(), tickClock());
  const a = s.save("A", DEF).workout;
  s.save("B", DEF);
  assert.equal(s.rename(a.id, "b").error, "exists");
  assert.equal(s.rename(a.id, "").error, "empty");
  assert.equal(s.rename(a.id, "a").ok, true, "same workout, new case");
  assert.equal(s.rename(a.id, "Alpha").ok, true);
  assert.equal(s.get(a.id).name, "Alpha");
  assert.equal(s.remove(a.id), true);
  assert.equal(s.count(), 1);
  assert.equal(s.remove("nope"), false);
});

test("kept after closing the app; damaged data is ignored", () => {
  const st = memStorage();
  new WorkoutStore(st, tickClock()).save("Kept", DEF);
  assert.equal(new WorkoutStore(st).findByName("kept").name, "Kept");
  st.setItem("tabatale.workouts.v1", "{broken");
  assert.equal(new WorkoutStore(st).count(), 0);
  assert.equal(new WorkoutStore(null).count(), 0, "no storage available");
});

// ---------------------------------------------------------------- ready-made workouts
const Presets = require("../js/presets.js");

test("ready-made workouts: 5, all valid, names unique, search ignores case and accents", () => {
  const all = Presets.list();
  assert.equal(all.length, 8);
  assert.equal(new Set(all.map((p) => p.name)).size, 8);
  all.forEach((p) => assert.equal(Plan.validate(p.cfg).ok, true, p.name));
  assert.equal(Presets.get(all[0].id).name, "Classic Tabata");
  assert.equal(Presets.get("nope"), null);
  assert.deepEqual(Presets.search(WorkoutStore.fold, "TABATA").map((p) => p.name), ["Classic Tabata"]);
  assert.equal(Presets.search(WorkoutStore.fold, "").length, 8);
  const classic = Plan.totalSeconds(Plan.buildPhases(Plan.validate(all[0].cfg).values));
  assert.equal(classic, 250, "Classic Tabata is the 4:10 default");
});

// ---------------------------------------------------------------- history
const HistoryStore = require("../js/history.js");
// local noon of a given day, so the tests do not depend on the time zone
const at = (y, m, d, h) => new Date(y, m - 1, d, h === undefined ? 12 : h, 0, 0).getTime();
function histAt(storage, t) { return new HistoryStore(storage, () => t); }
const W = { name: "Arms", total: 250, rounds: 8, loops: 1 };

test("history: days in a row, a missed day breaks it, today may still be empty", () => {
  const st = memStorage();
  [[2026, 11, 20], [2026, 11, 21], [2026, 11, 22], [2026, 11, 24], [2026, 11, 25]].forEach(([y, m, d]) => histAt(st, at(y, m, d)).add(W));
  assert.equal(histAt(st, at(2026, 11, 25, 20)).streak(), 2, "24 and 25 (the 23rd was missed)");
  assert.equal(histAt(st, at(2026, 11, 26, 8)).streak(), 2, "not trained yet today: yesterday's streak is alive");
  assert.equal(histAt(st, at(2026, 11, 27, 8)).streak(), 0, "a whole day missed");
  const h = histAt(st, at(2026, 11, 26, 9)); h.add(W);
  assert.equal(h.streak(), 3);
  h.add(W);
  assert.equal(h.streak(), 3, "two workouts in one day count once");
  assert.equal(new HistoryStore(memStorage(), () => at(2026, 11, 26)).streak(), 0);
});

test("history: streak across a month and a year end, last 7 days", () => {
  const st = memStorage();
  [[2026, 12, 30], [2026, 12, 31], [2027, 1, 1]].forEach(([y, m, d]) => histAt(st, at(y, m, d)).add(W));
  const h = histAt(st, at(2027, 1, 1, 22));
  assert.equal(h.streak(), 3);
  const week = h.week();
  assert.equal(week.length, 7);
  assert.equal(week[6].today, true);
  assert.deepEqual(week.map((d) => d.done), [false, false, false, false, true, true, true]);
});

test("history: keeps the last 50 workouts, newest first; survives reopening; damaged data ignored", () => {
  const st = memStorage();
  for (let i = 0; i < 60; i++) histAt(st, at(2026, 1, 1) + i * 1000).add({ name: "W" + i, total: 100, rounds: 1, loops: 1 });
  const h = histAt(st, at(2026, 2, 1));
  assert.equal(h.count(), 50);
  assert.equal(h.list()[0].name, "W59");
  assert.equal(h.list()[49].name, "W10");
  st.setItem("tabatale.history.v1", "{broken");
  assert.equal(histAt(st, at(2026, 2, 1)).count(), 0);
  assert.equal(new HistoryStore(null).streak(), 0, "no storage available");
});

// ---------------------------------------------------------------- blocks and exercise names
const BLK = (over) => Object.assign({ name: "", work: "30", rest: "15", rounds: "4", gap: "30" }, over);

test("blocks: a plain workout is unchanged (one block, no names, no extra phases)", () => {
  const ph = phasesOf({});
  assert.equal(ph.length, 17);
  assert.ok(ph.every((p) => p.block === 1 && !("name" in p) && !("next" in p)));
  assert.equal(Plan.validate(cfg({})).values.extra.length, 0);
  assert.equal(Plan.validate(cfg({ blocks: [] })).ok, true);
});

test("blocks: order, rest before a block, total time, names, cool down at the very end", () => {
  const c = cfg({ prep: true, cool: true, coolDur: "60", name1: " Burpees ", blocks: [BLK({ name: "Squats" }), BLK({ work: "40", rest: "0", rounds: "2", gap: "0" })] });
  const v = Plan.validate(c);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const ph = Plan.buildPhases(v.values);
  // 10 prep + 8*(20+10) + [30 + 4*(30+15)] + [2*40] + 60 cool
  assert.equal(Plan.totalSeconds(ph), 10 + 240 + 30 + 180 + 80 + 60);
  assert.equal(ph[0].next, "Burpees", "Get ready announces the first exercise");
  assert.equal(ph[1].name, "Burpees");
  const gap = ph.find((p) => p.type === "between");
  assert.equal(gap.label, "Block rest"); assert.equal(gap.dur, 30); assert.equal(gap.next, "Squats"); assert.equal(gap.block, 2);
  const blocks = ph.filter((p) => p.type === "work").map((p) => p.block);
  assert.deepEqual([...new Set(blocks)], [1, 2, 3]);
  assert.equal(ph.filter((p) => p.type === "work" && p.block === 3).length, 2);
  assert.equal(ph.filter((p) => p.block === 3 && p.type === "rest").length, 0, "rest 0 leaves no phase");
  assert.equal(ph.filter((p) => p.block === 3 && p.type === "between").length, 0, "rest before = 0 leaves no phase");
  assert.equal(ph[ph.length - 1].type, "cool");
  const loops = ph.map((p) => p.loop);
  assert.equal(Math.max(...loops), 3, "loop keeps counting: block 1, 2, 3");
  assert.equal(ph.find((p) => p.type === "work" && p.block === 2).rounds, 4);
});

test("blocks: loops of the first block still work with extra blocks", () => {
  const ph = phasesOf({ prep: false, loops: "2", between: "20", rounds: "2", blocks: [BLK({ rounds: "1", gap: "5" })] });
  assert.deepEqual(ph.map((p) => p.type + p.block), ["work1", "rest1", "work1", "rest1", "between1", "work1", "rest1", "work1", "rest1", "between2", "work2", "rest2"]);
});

test("blocks: counters follow the block", () => {
  const ph = phasesOf({ prep: false, rounds: "2", blocks: [BLK({ rounds: "3" })] });
  const first = Progress.counters(ph, 0, 2, 2);
  assert.deepEqual(first, { loop: "1/2", workLoop: "1/2", workTotal: "1/5", labels: { loop: "Block", workLoop: "Work \u00b7 block" } });
  const idx = ph.findIndex((p) => p.type === "work" && p.block === 2);
  assert.deepEqual(Progress.counters(ph, idx + 2, 2, 2), { loop: "2/2", workLoop: "2/3", workTotal: "4/5", labels: { loop: "Block", workLoop: "Work \u00b7 block" } });
  const gap = ph.findIndex((p) => p.type === "between");
  assert.equal(Progress.counters(ph, gap, 2, 2).workLoop, "0/3");
});

test("blocks: validation of the extra blocks, names are optional and trimmed", () => {
  const bad = Plan.validate(cfg({ blocks: [BLK({ work: "0" }), BLK({ rounds: "" }), BLK({ gap: "601" })] }));
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["b0.work", "b1.rounds", "b2.gap"]);
  const many = Plan.validate(cfg({ blocks: new Array(10).fill(0).map(() => BLK()) }));
  assert.equal(many.ok, false, "at most 10 blocks in all");
  assert.equal(Plan.validate(cfg({ blocks: new Array(9).fill(0).map(() => BLK()) })).ok, true);
  const v = Plan.validate(cfg({ name1: "   ", blocks: [BLK({ name: "  A   very  long name that goes well beyond thirty characters  " })] }));
  assert.equal(v.values.name, "");
  assert.equal(v.values.extra[0].name.length <= 30, true);
  assert.equal(v.values.extra[0].name.includes("  "), false);
});

test("blocks: sounds and the runner work on a multi-block workout", () => {
  const ph = phasesOf({ blocks: [BLK()] });
  const r = new Runner(ph);
  r.start(0);
  let t = 0;
  const total = Plan.totalSeconds(ph);
  for (let i = 0; i < ph.length && !r.done; i++) { t += ph[i].dur * 1000; r.update(t + 1); }
  assert.equal(r.done, true);
  assert.equal(total, 10 + 240 + 30 + 4 * 45);
});

// ---------------------------------------------------------------- EMOM and AMRAP
test("EMOM: one Work phase per round, every X seconds, no rest phases", () => {
  const v = Plan.validate(cfg({ type: "emom", every: "60", rounds: "10", name1: "Kettlebell swings" }));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.values.loops, 1);
  const ph = Plan.buildPhases(v.values);
  assert.equal(ph.length, 11, "Get ready + 10 minutes");
  assert.equal(Plan.totalSeconds(ph), 10 + 600);
  const m = ph.slice(1);
  assert.ok(m.every((p) => p.type === "work" && p.dur === 60 && p.kind === "emom" && p.unit === "Minute" && p.rounds === 10 && p.name === "Kettlebell swings"));
  assert.deepEqual(m.map((p) => p.round), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const odd = Plan.buildPhases(Plan.validate(cfg({ type: "emom", every: "90", rounds: "3", prep: false })).values);
  assert.equal(odd[0].unit, "Round");
  assert.equal(Plan.totalSeconds(odd), 270);
});

test("AMRAP: a single countdown phase", () => {
  const v = Plan.validate(cfg({ type: "amrap", amrapDur: "720", prep: false, cool: true, coolDur: "60" }));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const ph = Plan.buildPhases(v.values);
  assert.deepEqual(ph.map((p) => p.type), ["work", "cool"]);
  assert.equal(ph[0].dur, 720); assert.equal(ph[0].kind, "amrap"); assert.equal(ph[0].label, "AMRAP");
  assert.equal(Plan.totalSeconds(ph), 780);
});

test("types: only the fields of the chosen type are checked; unknown type is Interval; old setups are Interval", () => {
  assert.equal(Plan.validate(cfg({ type: "emom", work: "", rest: "x", loops: "0" })).ok, true, "interval fields are ignored");
  assert.equal(Plan.validate(cfg({ type: "emom", every: "5" })).ok, false);
  assert.equal(Plan.validate(cfg({ type: "amrap", amrapDur: "3601" })).ok, false);
  assert.equal(Plan.validate(cfg({ type: "amrap", rounds: "" , amrapDur: "600" })).ok, true);
  assert.equal(Plan.validate(cfg({ type: "bogus" })).values.type, "interval");
  assert.equal(Plan.normalizeCfg({ work: 30 }).type, "interval");
  assert.equal(Plan.normalizeCfg({ type: "amrap", amrapDur: 300 }).type, "amrap");
});

test("blocks of different types in sequence: Interval, then EMOM, then AMRAP", () => {
  const c = cfg({ prep: false, rounds: "1", blocks: [
    { type: "emom", name: "Rows", every: "30", rounds: "2", gap: "10" },
    { type: "amrap", name: "Burpees", dur: "120", gap: "0" }
  ] });
  const v = Plan.validate(c);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const ph = Plan.buildPhases(v.values);
  assert.deepEqual(ph.map((p) => p.type + p.block + (p.kind || "")), ["work1", "rest1", "between2", "work2emom", "work2emom", "work3amrap"]);
  assert.equal(Plan.totalSeconds(ph), 20 + 10 + 10 + 60 + 120);
  assert.equal(Math.max(...ph.map((p) => p.loop)), 3);
  const bad = Plan.validate(cfg({ blocks: [{ type: "amrap", dur: "5", gap: "0" }, { type: "emom", every: "60", rounds: "0", gap: "0" }] }));
  assert.deepEqual(Object.keys(bad.errors).sort(), ["b0.dur", "b1.rounds"]);
  assert.equal(Plan.cleanBlocks([{ type: "weird", work: "5" }])[0].type, "interval");
});

// ---------------------------------------------------------------- share by link
const Share = require("../js/share.js");

test("share: a workout survives the trip through the link, with accents and blocks", () => {
  const c = cfg({ type: "emom", every: "45", rounds: "6", name1: "Swingà è", blocks: [{ type: "amrap", name: "Burpees", dur: "300", gap: "20" }, { type: "interval", name: "", work: "30", rest: "10", rounds: "4", gap: "0" }] });
  const url = Share.makeUrl("https://aleboc87.github.io/tabata/?x=1#old", Share.encode(Plan, "  Il mio  allenamento è forte ", c));
  assert.ok(url.startsWith("https://aleboc87.github.io/tabata/?x=1#w="));
  assert.ok(url.length < 700, "short enough to share: " + url.length);
  const got = Share.decode(Plan, url.slice(url.indexOf("#")));
  assert.equal(got.name, "Il mio allenamento è forte");
  assert.deepEqual(got.cfg, Plan.normalizeCfg(c));
  assert.equal(Plan.validate(got.cfg).ok, true);
  assert.equal(Share.hasShared("#w=abc"), true);
  assert.equal(Share.hasShared("#other"), false);
});

test("share: damaged, foreign or unsafe links are refused, never half-loaded", () => {
  const good = Share.encode(Plan, "A", cfg({}));
  const bad = [
    "", "#", "#w=", "#w=%%%", "#w=!!!!", "#x=" + good, "#w=" + "A".repeat(3001),
    "#w=" + Buffer.from("not json").toString("base64"),
    "#w=" + Buffer.from(JSON.stringify({ v: 2, n: "x", c: cfg({}) })).toString("base64"),
    "#w=" + Buffer.from(JSON.stringify({ v: 1, n: "x", c: "text" })).toString("base64"),
    "#w=" + Buffer.from(JSON.stringify({ v: 1, n: "x", c: cfg({ work: "0" }) })).toString("base64"),
    "#w=" + Buffer.from(JSON.stringify({ v: 1, n: "x", c: cfg({ rounds: "99999" }) })).toString("base64")
  ];
  bad.forEach((h) => assert.equal(Share.decode(Plan, h), null, h.slice(0, 30)));
  // unknown or hostile fields are dropped, long names cut
  const evil = Buffer.from(JSON.stringify({ v: 1, n: "<img src=x onerror=alert(1)>" + "z".repeat(100), c: Object.assign(cfg({}), { type: "bogus", blocks: [{ type: "x", name: "<b>", work: "<script>", rest: "5", rounds: "2", gap: "1" }], extra: "x" }) })).toString("base64url");
  const got = Share.decode(Plan, "#w=" + evil);
  assert.equal(got.name.length <= 30, true);
  assert.equal(got.cfg.type, "interval");
  assert.equal("extra" in got.cfg, false);
  assert.equal(got.cfg.blocks[0].work, "20", "non-numeric value replaced by the default");
  assert.equal(Plan.validate(got.cfg).ok, true);
});

// ---------------------------------------------------------------- voice: exercise names
test("voice: names are spoken once per exercise, 'Next' during Get ready / rest, never for every round", () => {
  const ph = phasesOf({ prep: true, rounds: "2", name1: "Burpees", blocks: [BLK({ name: "Squats", rounds: "2", gap: "10" }), BLK({ name: "Rows", rounds: "1", rest: "0", gap: "0" })] });
  const say = ph.map((p, i) => Plan.announcement(ph, i)).map((a, i) => a ? ph[i].type + ph[i].block + ":" + (a.next ? "Next " : "") + a.text : null).filter(Boolean);
  assert.deepEqual(say, ["prep1:Next Burpees", "between2:Next Squats", "rest2:Next Rows"]);
});

test("voice: nothing without names; a name is said at the start when no rest comes before it", () => {
  const plain = phasesOf({});
  assert.ok(plain.every((p, i) => Plan.announcement(plain, i) === null));
  const emom = phasesOf({ prep: false, type: "emom", every: "30", rounds: "3", name1: "Swings", blocks: [BLK({ type: "amrap", name: "Burpees", dur: "60", gap: "0" })] });
  const a = emom.map((p, i) => Plan.announcement(emom, i));
  assert.deepEqual(a[0], { text: "Swings", next: false });
  assert.equal(a[1], null); assert.equal(a[2], null);
  assert.deepEqual(a[3], { text: "Burpees", next: false }, "block change with no rest between");
  assert.equal(Plan.announcement(emom, 99), null);
});
