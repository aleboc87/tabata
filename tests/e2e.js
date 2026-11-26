// Level 2 - browser tests (Playwright + Chromium).
// Serve the app folder, then run:  node tests/e2e.js http://localhost:8123/
"use strict";
const { chromium } = require("playwright");
const BASE = process.argv[2] || "http://localhost:8123/";

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, String(e && e.message || e).split("\n")[0]]); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ": " : "") + JSON.stringify(a) + " !== " + JSON.stringify(b)); }

// Records every scheduled sound with its delay on the audio clock
const AUDIO_SPY = () => {
  window.__sounds = [];
  const os = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) {
    window.__sounds.push({ kind: "beep", at: performance.now() + (when - this.context.currentTime) * 1000 });
    return os.apply(this, arguments);
  };
  const bs = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when) {
    if (this.buffer && this.buffer.length > 100) window.__sounds.push({ kind: "voice" + Math.round(this.buffer.duration * 10), at: performance.now() + ((when || 0) - this.context.currentTime) * 1000 });
    return bs.apply(this, arguments);
  };
};

async function setTime(p, key, secs) {
  await p.click("#f-" + key);
  await p.evaluate(([m, s]) => {
    document.getElementById("wheel-min").scrollTop = m * 44;
    document.getElementById("wheel-sec").scrollTop = s * 44;
  }, [Math.floor(secs / 60), secs % 60]);
  await p.waitForTimeout(250);
  await p.click("#picker-set");
}
async function setCount(p, key, n) { await p.fill("#f-" + key, String(n)); }
async function visible(p, sel) { return p.isVisible(sel); }

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  async function newPage(viewport, opts) {
    const ctx = await browser.newContext(Object.assign({ viewport }, opts || {}));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await p.addInitScript(AUDIO_SPY);
    return { ctx, p };
  }

  // ------------------------------------------------------------ phone portrait
  const { ctx, p } = await newPage({ width: 390, height: 844 }, { hasTouch: true });
  await p.goto(BASE);
  await p.evaluate(() => localStorage.clear());
  await p.reload();

  await check("Home shows Stopwatch and Tabata", async () => {
    ok(await visible(p, "#screen-home"));
    eq((await p.textContent(".choice-primary .choice-title")).trim(), "Tabata");
  });

  await check("Stopwatch: start, lap, stop, reset", async () => {
    await p.click("[data-action=go-stopwatch]");
    eq(await p.textContent("#sw-status"), "Ready");
    ok(await p.isDisabled("#sw-reset"), "reset disabled at zero");
    await p.click("#sw-start"); await p.waitForTimeout(600);
    await p.click("#sw-lap"); await p.waitForTimeout(300); await p.click("#sw-lap"); await p.waitForTimeout(500); await p.click("#sw-lap");
    eq(await p.locator("#sw-laps li").count(), 4, "3 laps + lap in progress");
    ok((await p.textContent("#sw-laps li:nth-child(1) .lap-name")).startsWith("Lap 4"));
    ok(/^\d\d:\d\d,\d$/.test((await p.textContent("#sw-laps li:nth-child(2) .lap-time")).trim()), "mm:ss,d format");
    await p.click("#sw-stop");
    const t1 = await p.textContent("#sw-main") + await p.textContent("#sw-tenths");
    await p.waitForTimeout(400);
    eq(await p.textContent("#sw-main") + await p.textContent("#sw-tenths"), t1, "stopped time frozen");
    eq(await p.textContent("#sw-status"), "Stopped");
    await p.click("#sw-reset");
    eq(await p.textContent("#sw-main"), "00:00");
    eq(await p.locator("#sw-laps li").count(), 0);
  });

  await check("Stopwatch running + system back: confirm, Keep going resumes, Stop resets", async () => {
    await p.click("#sw-start"); await p.waitForTimeout(300);
    await p.goBack(); await p.waitForTimeout(150);
    ok(await visible(p, "#confirm"), "confirm shown");
    eq(await p.textContent("#confirm-title"), "Stop the stopwatch?");
    eq(await p.textContent("#confirm-yes"), "Stop");
    const a = await p.textContent("#sw-tenths"); await p.waitForTimeout(300);
    eq(await p.textContent("#sw-tenths"), a, "stopwatch paused while confirm open");
    await p.click("#confirm-no");
    ok(await visible(p, "#sw-stop"), "running again");
    await p.click("[data-action=back] >> visible=true");
    await p.click("#confirm-yes"); await p.waitForTimeout(150);
    ok(await visible(p, "#screen-home"));
    await p.click("[data-action=go-stopwatch]");
    eq(await p.textContent("#sw-main"), "00:00", "time lost");
  });

  await check("Stopwatch stopped + back: home without confirm", async () => {
    await p.click("#sw-start"); await p.waitForTimeout(200); await p.click("#sw-stop");
    await p.goBack(); await p.waitForTimeout(150);
    ok(await visible(p, "#screen-home"));
    ok(!(await visible(p, "#confirm")));
  });

  await check("Setup defaults: 4:10, 8 rounds x 1 loop, times as m:ss", async () => {
    await p.click("[data-action=go-setup]");
    eq(await p.textContent("#setup-total"), "4:10");
    eq(await p.textContent("#setup-summary"), "8 rounds \u00d7 1 loop");
    eq(await p.textContent("#f-work"), "0:20");
    ok(await p.isDisabled("#f-between"), "loop rest off with 1 loop");
    ok(!(await visible(p, "#f-coolDur")), "cool down time hidden when off");
  });

  await check("Wheel picker: 0:45 in one go; +/- step 1 s; limits", async () => {
    await setTime(p, "work", 45);
    eq(await p.textContent("#f-work"), "0:45");
    await p.click("#f-work + button"); eq(await p.textContent("#f-work"), "0:46");
    await p.click("[aria-label='Decrease Work']"); await p.click("[aria-label='Decrease Work']"); eq(await p.textContent("#f-work"), "0:44");
    await p.click("#f-work");
    await p.evaluate(() => { document.getElementById("wheel-min").scrollTop = 10 * 44; document.getElementById("wheel-sec").scrollTop = 30 * 44; });
    await p.waitForTimeout(250);
    ok(await p.isDisabled("#picker-set"), "10:30 > max");
    eq(await p.textContent("#picker-hint"), "Maximum 10:00");
    await p.goBack(); await p.waitForTimeout(150);
    ok(!(await visible(p, "#picker")), "system back closes the picker");
    ok(await visible(p, "#screen-setup"), "still on setup");
    eq(await p.textContent("#f-work"), "0:44", "cancel keeps value");
  });

  await check("Count fields: typing, errors, START disabled", async () => {
    await setCount(p, "rounds", 99);
    ok(await p.isDisabled("#setup-start"));
    eq(await p.textContent("#setup-total"), "\u2014");
    eq(await p.textContent("#hint-rounds"), "Enter a value from 1 to 50");
    await setCount(p, "rounds", 2);
    ok(!(await p.isDisabled("#setup-start")));
  });

  await check("Total time updates with loops, loop rest, cool down", async () => {
    await setTime(p, "work", 4); await setTime(p, "rest", 3);
    await p.click("[role=switch] >> nth=0"); await p.click("[role=switch] >> nth=0"); // off/on
    await setTime(p, "prepDur", 2);
    await setCount(p, "loops", 2); await setTime(p, "between", 2);
    await p.click("[role=switch] >> nth=1"); await setTime(p, "coolDur", 2);
    // 2 + 2*2*(4+3) + 1*2 + 2 = 34
    eq(await p.textContent("#setup-total"), "0:34");
  });

  let runStart = 0;
  await check("Workout: phases, colours, counters, next, time left", async () => {
    runStart = await p.evaluate(() => performance.now());
    await p.click("#setup-start"); await p.waitForTimeout(150);
    ok(await visible(p, "#screen-run"));
    eq(await p.textContent("#run-phase"), "Get ready");
    ok(await p.evaluate(() => document.body.classList.contains("phase-prep")));
    eq(await p.textContent("#run-round"), "Round \u2013 / 2");
    eq(await p.textContent("#cnt-loop"), "1/2");
    eq(await p.textContent("#cnt-work-loop"), "\u2013/2");
    eq(await p.textContent("#cnt-work-total"), "\u2013/4");
    eq(await p.textContent("#run-next"), "Work \u00b7 4 s");
    eq(await p.locator("#run-segs .seg").count(), 11);
    await p.waitForTimeout(2100);
    eq(await p.textContent("#run-phase"), "Work");
    ok(await p.evaluate(() => document.body.classList.contains("phase-work")));
    eq(await p.textContent("#cnt-work-total"), "1/4");
    ok(await visible(p, "#badge-voice"), "voice label shown");
  });

  await check("Pause freezes, resume continues", async () => {
    await p.click("#run-pause");
    ok(await visible(p, "#badge-paused"));
    const s = await p.textContent("#run-secs"); await p.waitForTimeout(1200);
    eq(await p.textContent("#run-secs"), s);
    await p.click("#run-pause");
    ok(!(await visible(p, "#badge-paused")));
  });

  await check("Skip and back", async () => {
    await p.click("#run-next-btn"); eq(await p.textContent("#run-phase"), "Rest");
    await p.click("#run-prev"); eq(await p.textContent("#run-phase"), "Work", "within 2 s goes to previous phase");
    await p.waitForTimeout(2200);
    const ph = await p.textContent("#run-phase");
    await p.click("#run-prev"); eq(await p.textContent("#run-phase"), ph, "after 2 s restarts the same phase");
  });

  await check("X and system back: confirm stops everything, Keep going resumes", async () => {
    await p.click("[aria-label='Stop workout']");
    ok(await visible(p, "#confirm")); eq(await p.textContent("#confirm-title"), "Stop the workout?");
    const s = await p.textContent("#run-secs"); await p.waitForTimeout(1100);
    eq(await p.textContent("#run-secs"), s, "frozen while confirm open");
    await p.click("#confirm-no");
    await p.goBack(); await p.waitForTimeout(150);
    ok(await visible(p, "#confirm"), "system back opens confirm");
    await p.click("#confirm-no");
    ok(!(await visible(p, "#badge-paused")), "running again");
  });

  await check("Workout reaches Workout complete", async () => {
    await p.waitForSelector("#screen-done:not([hidden])", { timeout: 60000 });
    eq(await p.textContent("#done-total"), "0:34");
    eq(await p.textContent("#done-summary"), "2 rounds \u00d7 2 loops");
    ok(!(await p.evaluate(() => document.body.classList.contains("in-run"))), "colours back to normal");
  });

  await check("Done: Edit settings, Repeat, Back to home; stop workout returns to setup", async () => {
    await p.click("[data-action=go-setup] >> visible=true"); ok(await visible(p, "#screen-setup"));
    await p.click("#setup-start"); ok(await visible(p, "#screen-run"));
    await p.click("[aria-label='Stop workout']"); await p.click("#confirm-yes");
    ok(await visible(p, "#screen-setup"), "stop workout -> setup");
    await p.click("[data-action=back] >> visible=true"); ok(await visible(p, "#screen-home"));
  });

  await check("Settings and mute remembered after reload", async () => {
    await p.click("[data-action=go-setup]"); await p.click("#setup-start");
    await p.click("#run-mute");
    await p.click("[aria-label='Stop workout']"); await p.click("#confirm-yes");
    await p.reload(); await p.click("[data-action=go-setup]");
    eq(await p.textContent("#f-work"), "0:04"); eq(await p.inputValue("#f-loops"), "2");
    await p.click("#setup-start");
    ok(await p.evaluate(() => document.getElementById("run-mute").classList.contains("is-muted")));
    await p.click("#run-mute");
    await p.click("[aria-label='Stop workout']"); await p.click("#confirm-yes");
  });

  await check("Sounds scheduled on time (Let's GO 0 s, beeps -3/-2/-1 s, Rest)", async () => {
    await p.evaluate(() => localStorage.clear()); await p.reload();
    await p.click("[data-action=go-setup]");
    await p.click("[role=switch] >> nth=0"); // get ready off
    await setTime(p, "work", 4); await setTime(p, "rest", 3); await setCount(p, "rounds", 2);
    const t0 = await p.evaluate(() => { window.__sounds = []; return performance.now(); });
    await p.click("#setup-start");
    await p.waitForSelector("#screen-done:not([hidden])", { timeout: 30000 });
    const s = await p.evaluate(() => window.__sounds);
    const rel = s.map((x) => ({ k: x.kind, t: Math.round((x.at - t0) / 100) / 10 })).sort((a, b) => a.t - b.t);
    const beeps = rel.filter((x) => x.k === "beep").map((x) => x.t);
    const voices = rel.filter((x) => x.k !== "beep");
    eq(beeps.length, 6, "6 beeps");
    eq(voices.length, 5, "4 voice clips + Rinfrescati at the end");
    const expectBeeps = [1, 2, 3, 8, 9, 10];
    beeps.forEach((b, i) => ok(Math.abs(b - expectBeeps[i]) <= 0.2, "beep " + i + " at " + b + "s, expected " + expectBeeps[i]));
    [0, 4, 7, 11, 14].forEach((t, i) => ok(Math.abs(voices[i].t - t) <= 0.2, "voice " + i + " at " + voices[i].t));
  });

  await check("Muted: no sounds at all", async () => {
    await p.click("[data-action=go-setup] >> visible=true");
    await p.click("#setup-start"); await p.click("#run-mute");
    await p.evaluate(() => { window.__sounds = []; });
    await p.waitForSelector("#screen-done:not([hidden])", { timeout: 30000 });
    eq((await p.evaluate(() => window.__sounds)).length, 0);
  });

  await check("Saved workouts: save, list, search, open, replace, rename, delete", async () => {
    await p.evaluate(() => localStorage.clear()); await p.reload();
    eq(await p.textContent("#home-saved-count"), "0/10");
    await p.click("[data-action=go-saved]");
    ok((await p.textContent("#saved-empty")).startsWith("No saved workouts yet"));
    await p.click("[data-action=back] >> visible=true");
    await p.click("[data-action=go-setup]");
    await setTime(p, "work", 45);
    await p.click("#setup-save");
    ok(await visible(p, "#name-dialog"));
    await p.fill("#name-input", "Leg day"); await p.press("#name-input", "Enter");
    ok(!(await visible(p, "#name-dialog")), "dialog closed after save");
    await setTime(p, "work", 30);
    await p.click("#setup-save");
    eq(await p.inputValue("#name-input"), "Leg day", "proposes the name of the open workout");
    await p.fill("#name-input", "Arms"); await p.click("#name-ok");
    await p.click("[data-action=back] >> visible=true");
    eq(await p.textContent("#home-saved-count"), "2/10");
    await p.click("[data-action=go-saved]");
    eq(await p.locator("#saved-list li").count(), 2);
    eq(await p.textContent("#saved-list li:nth-child(1) .saved-name"), "Arms", "most recent first");
    eq(await p.textContent("#saved-list li:nth-child(2) .saved-sum"), "7:30 \u00b7 8 rounds \u00d7 1 loop");
    await p.fill("#saved-search", "LEG");
    eq(await p.locator("#saved-list li").count(), 1);
    eq(await p.textContent("#saved-list li .saved-name"), "Leg day");
    await p.fill("#saved-search", "zz");
    eq(await p.locator("#saved-list li").count(), 0);
    ok((await p.textContent("#saved-empty")).includes("No workouts match"));
    await p.fill("#saved-search", "");
    // open Leg day -> setup filled in
    await p.click("[aria-label='Open Leg day']");
    ok(await visible(p, "#screen-setup"));
    eq(await p.textContent("#f-work"), "0:45");
    // change and save with the same name -> Replace it?
    await setTime(p, "rest", 15);
    await p.click("#setup-save");
    eq(await p.inputValue("#name-input"), "Leg day");
    await p.click("#name-ok");
    ok(await visible(p, "#name-replace"), "asks to replace");
    ok((await p.textContent("#name-replace-text")).includes("Replace it?"));
    await p.click("#name-replace-yes");
    ok(!(await visible(p, "#name-dialog")));
    await p.click("[data-action=back] >> visible=true");
    await p.click("[data-action=go-saved]");
    eq(await p.locator("#saved-list li").count(), 2, "replaced, not added");
    eq(await p.textContent("#saved-list li:nth-child(1) .saved-name"), "Leg day", "used last -> first");
    eq(await p.textContent("#saved-list li:nth-child(1) .saved-sum"), "8:10 \u00b7 8 rounds \u00d7 1 loop");
    // rename
    await p.click("[aria-label='Rename Arms']");
    await p.fill("#name-input", "leg day"); await p.click("#name-ok");
    eq(await p.textContent("#name-msg"), "Another workout already has this name.");
    await p.fill("#name-input", "Arms 2"); await p.click("#name-ok");
    ok(await p.isVisible("[aria-label='Open Arms 2']"));
    // system back closes the name dialog and stays on the list
    await p.click("[aria-label='Rename Arms 2']");
    await p.goBack(); await p.waitForTimeout(150);
    ok(!(await visible(p, "#name-dialog"))); ok(await visible(p, "#screen-saved"));
    // delete with confirmation
    await p.click("[aria-label='Delete Arms 2']");
    eq(await p.textContent("#confirm-title"), "Delete \u201cArms 2\u201d?");
    eq(await p.textContent("#confirm-no"), "Cancel");
    await p.click("#confirm-no");
    eq(await p.locator("#saved-list li").count(), 2, "cancel keeps it");
    await p.click("[aria-label='Delete Arms 2']"); await p.click("#confirm-yes");
    eq(await p.locator("#saved-list li").count(), 1);
    eq(await p.textContent("#saved-count"), "1/10");
    // saved workouts survive a reload
    await p.reload(); eq(await p.textContent("#home-saved-count"), "1/10");
  });

  await check("Saved workouts: the 11th is refused, replacing still works", async () => {
    await p.evaluate(() => {
      const cfg = { prep: true, prepDur: "10", work: "20", rest: "10", rounds: "8", loops: "1", between: "60", cool: false, coolDur: "120" };
      const list = []; for (let i = 1; i <= 10; i++) list.push({ id: "t" + i, name: "Workout " + i, cfg, createdAt: i, usedAt: i });
      localStorage.setItem("tabatale.workouts.v1", JSON.stringify(list));
    });
    await p.reload();
    eq(await p.textContent("#home-saved-count"), "10/10");
    await p.click("[data-action=go-setup]"); await p.click("#setup-save");
    eq(await p.textContent("#name-msg"), "You can save up to 10 workouts. Delete one first.");
    await p.fill("#name-input", "New one"); await p.click("#name-ok");
    ok(await visible(p, "#name-dialog"), "not saved");
    await p.fill("#name-input", "Workout 4"); await p.click("#name-ok");
    await p.click("#name-replace-yes");
    ok(!(await visible(p, "#name-dialog")));
    await p.click("[data-action=back] >> visible=true");
    eq(await p.textContent("#home-saved-count"), "10/10");
    // confirm-no label is back to normal for the workout confirm
    await p.click("[data-action=go-setup]"); await p.click("#setup-start");
    await p.click("[aria-label='Stop workout']");
    eq(await p.textContent("#confirm-no"), "Keep going");
    await p.click("#confirm-yes");
    await p.evaluate(() => localStorage.clear());
  });

  await check("Ready-made: list, open as a copy, search, not counted in the 10", async () => {
    await p.evaluate(() => localStorage.clear()); await p.reload();
    await p.click("[data-action=go-saved]");
    eq(await p.locator("#preset-list li").count(), 8);
    eq(await p.textContent("#preset-list li:nth-child(1) .saved-name"), "Classic Tabata");
    eq(await p.textContent("#preset-list li:nth-child(5) .saved-sum"), "7:10 \u00b7 6 rounds \u00d7 1 loop");
    eq(await p.textContent("#saved-count"), "0/10", "presets are not counted");
    await p.fill("#saved-search", "hiit");
    eq(await p.locator("#preset-list li").count(), 1);
    await p.click("#preset-list li .saved-open");
    ok(await visible(p, "#screen-setup"), "opens the setup");
    eq(await p.inputValue("#f-rounds"), "10");
    await p.click("[data-action=back] >> visible=true");
    await p.click("[data-action=go-saved]");
    await p.fill("#saved-search", "");
    eq(await p.locator("#preset-list li").count(), 8, "search is cleared on entering");
    eq(await p.textContent("#preset-list li:nth-child(3) .saved-sum"), "10:10 \u00b7 10 rounds \u00d7 1 loop", "preset itself unchanged");
    await p.click("[data-action=back] >> visible=true");
  });

  await check("History: completed workout shows up, with name and streak; stopped one does not", async () => {
    await p.evaluate(() => localStorage.clear()); await p.reload();
    eq(await p.textContent("#home-streak"), "0 days");
    await p.click("[data-action=go-history]");
    ok(await visible(p, "#history-empty"), "empty message");
    await p.click("[data-action=back] >> visible=true");
    await p.click("[data-action=go-saved]");
    await p.click("#preset-list li:nth-child(1) .saved-open");
    await p.click("[role=switch] >> nth=0");
    await setTime(p, "work", 3); await setTime(p, "rest", 0); await setCount(p, "rounds", 1);
    await p.click("#setup-start");
    await p.click("[aria-label='Stop workout']"); await p.click("#confirm-yes");
    await p.click("[data-action=back] >> visible=true");
    eq(await p.textContent("#home-streak"), "0 days", "stopped workout is not recorded");
    await p.click("[data-action=go-setup]");
    await p.click("#setup-start");
    await p.waitForSelector("#screen-done:not([hidden])", { timeout: 30000 });
    await p.click("[data-action=go-home]");
    eq(await p.textContent("#home-streak"), "1 day");
    await p.click("[data-action=go-history]");
    eq(await p.textContent("#history-streak"), "1");
    eq(await p.textContent("#history-streak-label"), "day in a row");
    eq(await p.locator("#history-list li").count(), 1);
    eq(await p.textContent("#history-list li .saved-name"), "Classic Tabata");
    ok((await p.textContent("#history-list li .history-when")).startsWith("Today, "));
    eq(await p.locator("#history-week li.done").count(), 1);
    await p.reload();
    eq(await p.textContent("#home-streak"), "1 day", "remembered after reload");
    // system back from History goes home
    await p.click("[data-action=go-history]");
    await p.goBack();
    ok(await visible(p, "#screen-home"), "back goes home");
  });

  await check("Blocks: hidden until added; names optional; run shows exercise, block counters and block rest", async () => {
    await p.evaluate(() => localStorage.clear()); await p.reload();
    await p.click("[data-action=go-setup]");
    ok(!(await visible(p, "#f-name1")), "no exercise field for a plain workout");
    ok(await visible(p, "#add-block"), "Add block is offered");
    await p.click("[role=switch] >> nth=0"); // get ready off
    await setTime(p, "work", 3); await setTime(p, "rest", 0); await setCount(p, "rounds", 1);
    await p.click("#add-block");
    ok(await visible(p, "#f-name1"), "first block can be named once there are two");
    eq(await p.locator("#blocks .block-card").count(), 1);
    eq(await p.inputValue("#b0-rounds"), "1", "new block starts like the first one");
    await p.fill("#f-name1", "Burpees"); await p.fill("#b0-name", "Squats");
    const setTimeId = async (id, secs) => {
      await p.click("#" + id);
      await p.evaluate(([m, s]) => { document.getElementById("wheel-min").scrollTop = m * 44; document.getElementById("wheel-sec").scrollTop = s * 44; }, [Math.floor(secs / 60), secs % 60]);
      await p.waitForTimeout(250); await p.click("#picker-set");
    };
    await setTimeId("b0-gap", 2); await setTimeId("b0-work", 3); await setTimeId("b0-rest", 0);
    eq((await p.textContent("#setup-total")).trim(), "0:08", "3 + 2 + 3");
    eq((await p.textContent("#setup-summary")).trim(), "2 blocks \u00b7 2 rounds");
    await p.click("#setup-start");
    eq((await p.textContent("#run-ex")).trim(), "Burpees");
    eq((await p.textContent("#run-loop")).trim(), "Block 1/2");
    eq((await p.textContent("#lbl-cnt-loop")).trim(), "Block");
    eq((await p.textContent("#cnt-loop")).trim(), "1/2");
    await p.waitForFunction(() => document.getElementById("run-phase").textContent === "Block rest", null, { timeout: 8000 });
    eq((await p.textContent("#run-ex")).trim(), "Next: Squats");
    eq((await p.textContent("#cnt-work-loop")).trim(), "0/1");
    await p.waitForFunction(() => document.getElementById("run-phase").textContent === "Work" && document.getElementById("run-ex").textContent === "Squats", null, { timeout: 8000 });
    eq((await p.textContent("#run-loop")).trim(), "Block 2/2");
    eq((await p.textContent("#cnt-work-total")).trim(), "2/2");
    await p.waitForSelector("#screen-done:not([hidden])", { timeout: 15000 });
    eq((await p.textContent("#done-summary")).trim(), "2 blocks \u00b7 2 rounds");
    // blocks are remembered; removing them brings back the plain setup
    await p.reload();
    await p.click("[data-action=go-setup]");
    eq(await p.inputValue("#b0-name"), "Squats");
    await p.click("[aria-label='Remove block 2']");
    ok(!(await visible(p, "#f-name1")), "plain workout again");
    eq(await p.locator("#blocks .block-card").count(), 0);
    // history shows the shape
    await p.click("[data-action=back] >> visible=true");
    await p.click("[data-action=go-history]");
    eq((await p.textContent("#history-list li .saved-sum")).replace(/^\S+ \u00b7 /, ""), "2 blocks \u00b7 2 rounds");
  });

  await check("Blocks: settings and saved workouts from before still load and run", async () => {
    await p.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("tabatale.settings.v1", JSON.stringify({ prep: true, prepDur: 10, work: 45, rest: 15, rounds: 6, loops: 2, between: 30, cool: false, coolDur: 120 }));
      localStorage.setItem("tabatale.workouts.v1", JSON.stringify([{ id: "w1", name: "Old one", cfg: { prep: false, prepDur: 10, work: 30, rest: 10, rounds: 4, loops: 1, between: 60, cool: true, coolDur: 60 }, createdAt: 1, usedAt: 1 }]));
    });
    await p.reload();
    await p.click("[data-action=go-setup]");
    eq(await p.inputValue("#f-rounds"), "6");
    eq((await p.textContent("#setup-total")).trim(), "12:40", "10 + 2*6*60 + 30");
    ok(!(await visible(p, "#f-name1")) && !(await visible(p, "#blocks .block-card")));
    await p.click("[data-action=back] >> visible=true");
    await p.click("[data-action=go-saved]");
    eq(await p.textContent("#saved-list li .saved-sum"), "3:40 \u00b7 4 rounds \u00d7 1 loop");
    await p.click("#saved-list li .saved-open");
    eq((await p.textContent("#setup-total")).trim(), "3:40", "4*40 + 60 cool");
    await p.click("[data-action=back] >> visible=true");
    await p.click("[data-action=go-saved]");
    await p.click("#preset-list li:nth-child(8) .saved-open");
    eq(await p.locator("#blocks .block-card").count(), 2, "Circuit preset has 3 blocks");
    eq(await p.inputValue("#f-name1"), "Squats");
    await p.click("[data-action=save-workout]");
    await p.fill("#name-input", "My circuit"); await p.click("#name-ok");
    await p.click("[data-action=back] >> visible=true");
    await p.reload();
    await p.click("[data-action=go-saved]");
    await p.fill("#saved-search", "circuit");
    await p.click("#saved-list li .saved-open");
    eq(await p.locator("#blocks .block-card").count(), 2, "blocks are saved with the workout");
    eq(await p.inputValue("#b1-name"), "Burpees");
  });

  await check("EMOM: type picker shows only its fields; minutes counted; Interval users see no extras", async () => {
    await p.evaluate(() => localStorage.clear()); await p.reload();
    await p.click("[data-action=go-setup]");
    eq(await p.locator("#type-seg button").count(), 3);
    eq(await p.getAttribute("#type-seg button[data-type=interval]", "aria-checked"), "true", "Interval by default");
    ok(!(await visible(p, "#f-every")) && !(await visible(p, "#f-amrapDur")) && !(await visible(p, "#f-name1")), "nothing extra for Interval");
    await p.click("#type-seg button[data-type=emom]");
    ok(await visible(p, "#f-every") && await visible(p, "#f-rounds"), "Every and Rounds");
    ok(!(await visible(p, "#f-work")) && !(await visible(p, "#f-loops")) && !(await visible(p, "#f-amrapDur")), "Interval fields hidden");
    eq((await p.textContent("#setup-summary")).trim(), "EMOM \u00b7 8 rounds");
    await setCount(p, "rounds", 10); await p.fill("#f-name1", "Swings");
    await p.click("[role=switch] >> nth=0"); // get ready off
    eq((await p.textContent("#setup-total")).trim(), "10:00");
    await p.click("#setup-start");
    eq((await p.textContent("#run-round")).trim(), "Minute 1 / 10");
    eq((await p.textContent("#run-ex")).trim(), "Swings");
    eq((await p.textContent("#run-loop")).trim(), "EMOM");
    eq((await p.textContent("#cnt-work-total")).trim(), "1/10");
    ok(!(await visible(p, "#amrap-box")));
    await p.click("[aria-label='Stop workout']"); await p.click("#confirm-yes");
    // type and values are remembered; Interval brings its fields back
    await p.reload(); await p.click("[data-action=go-setup]");
    eq(await p.getAttribute("#type-seg button[data-type=emom]", "aria-checked"), "true");
    await p.click("#type-seg button[data-type=interval]");
    ok(await visible(p, "#f-work") && await visible(p, "#f-loops") && !(await visible(p, "#f-every")));
  });

  await check("AMRAP: countdown, +1 round / undo, ignored while paused, result on the end screen and in History", async () => {
    await p.evaluate(() => localStorage.clear()); await p.reload();
    await p.click("[data-action=go-setup]");
    await p.click("#type-seg button[data-type=amrap]");
    ok(await visible(p, "#f-amrapDur") && !(await visible(p, "#f-every")) && !(await visible(p, "#f-rounds")));
    await p.click("[role=switch] >> nth=0");
    await setTime(p, "amrapDur", 12); await p.fill("#f-name1", "Burpees");
    eq((await p.textContent("#setup-summary")).trim(), "AMRAP");
    await p.click("#setup-start");
    ok(await visible(p, "#amrap-box"));
    eq((await p.textContent("#run-phase")).trim(), "AMRAP");
    eq((await p.textContent("#run-round")).trim(), "Rounds: 0");
    await p.click("#amrap-plus"); await p.click("#amrap-plus"); await p.click("#amrap-plus");
    eq((await p.textContent("#run-round")).trim(), "Rounds: 3");
    await p.click("#amrap-minus");
    eq((await p.textContent("#run-round")).trim(), "Rounds: 2");
    await p.click("#run-pause");
    await p.click("#amrap-plus", { force: true });
    eq((await p.textContent("#run-round")).trim(), "Rounds: 2", "no rounds while paused");
    await p.click("#run-pause");
    await p.click("#amrap-plus");
    await p.waitForSelector("#screen-done:not([hidden])", { timeout: 20000 });
    eq((await p.textContent("#done-results")).trim(), "Burpees: 3 rounds");
    eq((await p.textContent("#done-summary")).trim(), "AMRAP");
    await p.click("[data-action=go-home]"); await p.click("[data-action=go-history]");
    eq((await p.textContent("#history-list li .history-res")).trim(), "Burpees: 3 rounds");
    eq((await p.textContent("#history-list li .saved-name")).trim(), "Custom workout");
  });

  await check("Blocks of different types: card shows the fields of its type; EMOM and AMRAP presets", async () => {
    await p.evaluate(() => localStorage.clear()); await p.reload();
    await p.click("[data-action=go-setup]"); await p.click("#add-block");
    ok(await visible(p, "#b0-work") && !(await visible(p, "#b0-every")) && !(await visible(p, "#b0-dur")));
    await p.click("#blocks .type-seg button[data-type=emom]");
    ok(await visible(p, "#b0-every") && await visible(p, "#b0-rounds") && !(await visible(p, "#b0-work")) && !(await visible(p, "#b0-dur")));
    await p.click("#blocks .type-seg button[data-type=amrap]");
    ok(await visible(p, "#b0-dur") && !(await visible(p, "#b0-rounds")) && await visible(p, "#b0-gap"));
    eq((await p.textContent("#setup-total")).trim(), "14:40", "4:10 + 0:30 + 10:00");
    await p.click("[data-action=back] >> visible=true");
    await p.click("[data-action=go-saved]");
    eq(await p.textContent("#preset-list li:nth-child(6) .saved-name"), "EMOM 10");
    eq(await p.textContent("#preset-list li:nth-child(6) .saved-sum"), "10:10 \u00b7 EMOM \u00b7 10 rounds");
    eq(await p.textContent("#preset-list li:nth-child(7) .saved-sum"), "12:10 \u00b7 AMRAP");
    await p.click("#preset-list li:nth-child(7) .saved-open");
    eq(await p.getAttribute("#type-seg button[data-type=amrap]", "aria-checked"), "true");
  });

  await check("Share by link: copy from the setup and from the saved list; opening a link fills in the setup; bad links are refused", async () => {
    const perms = { permissions: ["clipboard-read", "clipboard-write"] };
    const a = await newPage({ width: 390, height: 844 }, perms);
    await a.p.goto(BASE); await a.p.evaluate(() => localStorage.clear()); await a.p.reload();
    await a.p.click("[data-action=go-setup]");
    await setTime(a.p, "work", 45); await setCount(a.p, "rounds", 5);
    await a.p.click("[data-action=share-setup]");
    await a.p.waitForSelector("#toast:not([hidden])");
    eq((await a.p.textContent("#toast")).trim(), "Link copied");
    const link = await a.p.evaluate(() => navigator.clipboard.readText());
    ok(link.startsWith(BASE + "#w="), "link: " + link.slice(0, 60));
    // somebody else opens it
    const b = await newPage({ width: 390, height: 844 });
    await b.p.goto(link);
    ok(await visible(b.p, "#screen-setup"), "setup opens");
    eq(await b.p.inputValue("#f-rounds"), "5");
    eq((await b.p.textContent("#f-work")).trim(), "0:45");
    ok((await b.p.textContent("#toast")).startsWith("Shared workout loaded"));
    eq(await b.p.evaluate(() => location.hash), "", "the link part is removed from the address");
    await b.p.goBack();
    ok(await visible(b.p, "#screen-home"), "back goes home");
    // a saved workout shared from the list keeps its name, and it is offered when saving
    await a.p.click("[data-action=save-workout]");
    await a.p.fill("#name-input", "Legs"); await a.p.click("#name-ok");
    await a.p.click("[data-action=back] >> visible=true");
    await a.p.click("[data-action=go-saved]");
    await a.p.click("[aria-label='Share Legs']");
    const link2 = await a.p.evaluate(() => navigator.clipboard.readText());
    const c = await newPage({ width: 390, height: 844 });
    await c.p.goto(link2);
    ok((await c.p.textContent("#toast")).startsWith("Shared workout loaded: Legs"));
    await c.p.click("[data-action=save-workout]");
    eq(await c.p.inputValue("#name-input"), "Legs");
    // damaged and foreign links
    for (const bad of ["#w=AAAA", "#w=!!", "#w=" + "A".repeat(4000)]) {
      const d = await newPage({ width: 390, height: 844 });
      await d.p.goto(BASE + bad);
      ok((await d.p.textContent("#toast")).startsWith("This link does not contain a valid workout"), bad.slice(0, 12));
      ok(await visible(d.p, "#screen-home"));
      await d.ctx.close();
    }
    await a.ctx.close(); await b.ctx.close(); await c.ctx.close();
  });

  await check("Share by link: without clipboard access the link is shown to copy by hand", async () => {
    const e = await newPage({ width: 390, height: 844 });
    await e.p.goto(BASE);
    await e.p.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: undefined }); });
    await e.p.reload();
    await e.p.click("[data-action=go-setup]");
    await e.p.click("[data-action=share-setup]");
    ok(await visible(e.p, "#share-dialog"), "dialog");
    ok((await e.p.inputValue("#share-url")).startsWith(BASE + "#w="));
    await e.p.goBack();
    ok(!(await visible(e.p, "#share-dialog")), "system back closes it");
    await e.ctx.close();
  });

  await check("Voice: exercise names are spoken once ('Next' before a new exercise), not when muted", async () => {
    const SPEECH_SPY = () => {
      window.__spoken = [];
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak: (u) => { if (u.text.trim()) window.__spoken.push(u.text + (u.lang ? "@" + u.lang : "")); }, cancel: () => {} } });
    };
    const setup = {
      prep: false, prepDur: 10, work: 3, rest: 2, rounds: 2, loops: 1, between: 60, cool: false, coolDur: 120, type: "interval", every: 60, amrapDur: 600,
      name1: "Burpees", blocks: [{ type: "interval", name: "Squats", work: "3", rest: "0", rounds: "1", every: "60", dur: "600", gap: "2" }]
    };
    const v = await newPage({ width: 390, height: 844 });
    await v.p.addInitScript(SPEECH_SPY);
    await v.p.goto(BASE);
    await v.p.evaluate((c) => { localStorage.clear(); localStorage.setItem("tabatale.settings.v1", JSON.stringify(c)); }, setup);
    await v.p.reload();
    await v.p.click("[data-action=go-setup]");
    await v.p.click("#setup-start");
    await v.p.waitForSelector("#screen-done:not([hidden])", { timeout: 30000 });
    eq(JSON.stringify(await v.p.evaluate(() => window.__spoken)), JSON.stringify(["Burpees", "Next@en-US", "Squats"]));
    // muted: silence
    await v.p.evaluate(() => { localStorage.setItem("tabatale.muted.v1", "1"); window.__spoken.length = 0; });
    await v.p.reload();
    await v.p.click("[data-action=go-setup]");
    await v.p.click("#setup-start");
    await v.p.waitForTimeout(2500);
    eq(await v.p.evaluate(() => window.__spoken.length), 0, "nothing spoken while muted");
    // no voice on the phone: the workout still runs
    const w = await newPage({ width: 390, height: 844 });
    await w.p.addInitScript(() => { Object.defineProperty(window, "speechSynthesis", { value: undefined }); });
    await w.p.goto(BASE);
    await w.p.evaluate((c) => { localStorage.clear(); localStorage.setItem("tabatale.settings.v1", JSON.stringify(c)); }, setup);
    await w.p.reload();
    await w.p.click("[data-action=go-setup]"); await w.p.click("#setup-start");
    ok(await visible(w.p, "#screen-run"), "runs without a voice");
    await v.ctx.close(); await w.ctx.close();
  });

  await check("Import: link opened in a browser offers the code; the installed app imports a pasted link, message or code", async () => {
    const perms = { permissions: ["clipboard-read", "clipboard-write"] };
    const a = await newPage({ width: 390, height: 844 }, perms);
    await a.p.goto(BASE); await a.p.evaluate(() => localStorage.clear()); await a.p.reload();
    await a.p.click("[data-action=go-setup]");
    await setTime(a.p, "work", 33); await setCount(a.p, "rounds", 7);
    await a.p.click("[data-action=share-setup]");
    await a.p.waitForSelector("#toast:not([hidden])");
    const link = await a.p.evaluate(() => navigator.clipboard.readText());
    // somebody opens the link in a browser (not the installed app)
    const b = await newPage({ width: 390, height: 844 }, perms);
    await b.p.goto(link);
    ok(await visible(b.p, "#share-banner"), "banner with the code");
    await b.p.click("[data-action=copy-code]");
    const code = await b.p.evaluate(() => navigator.clipboard.readText());
    ok(link.endsWith("#w=" + code), "the code is the part after #w=");
    await b.p.click("[data-action=close-banner]");
    ok(!(await visible(b.p, "#share-banner")));
    // the installed app: it has its own, separate storage
    const c = await newPage({ width: 390, height: 844 }, perms);
    await c.p.goto(BASE); await c.p.evaluate(() => localStorage.clear()); await c.p.reload();
    await c.p.click("[data-action=go-saved]"); await c.p.click("[data-action=open-import]");
    ok(await visible(c.p, "#import-dialog"));
    await c.p.fill("#import-input", "hello there");
    await c.p.click("#import-ok");
    ok((await c.p.textContent("#import-msg")).startsWith("This is not a valid workout"), "bad text refused");
    ok(await visible(c.p, "#import-dialog"), "dialog stays open");
    await c.p.fill("#import-input", "Check this out!\n" + link + "\nenjoy");
    await c.p.click("#import-ok");
    ok(await visible(c.p, "#screen-setup"), "setup opens");
    eq(await c.p.inputValue("#f-rounds"), "7");
    eq((await c.p.textContent("#f-work")).trim(), "0:33");
    ok(!(await visible(c.p, "#share-banner")), "no banner when importing");
    // code alone, and the Paste button
    await c.p.click("[data-action=back] >> visible=true");
    await c.p.click("[data-action=go-saved]"); await c.p.click("[data-action=open-import]");
    await c.p.evaluate((t) => navigator.clipboard.writeText(t), code);
    await c.p.click("#import-paste");
    await c.p.waitForFunction((t) => document.getElementById("import-input").value === t, code, { timeout: 3000 });
    await c.p.click("#import-ok");
    eq(await c.p.inputValue("#f-rounds"), "7");
    // system back closes the dialog
    await c.p.click("[data-action=back] >> visible=true");
    await c.p.click("[data-action=go-saved]"); await c.p.click("[data-action=open-import]");
    await c.p.goBack();
    ok(!(await visible(c.p, "#import-dialog")) && await visible(c.p, "#screen-saved"), "back closes the dialog only");
    // inside the installed app (standalone) the link needs no banner
    const d = await newPage({ width: 390, height: 844 });
    await d.p.addInitScript(() => { const o = window.matchMedia.bind(window); window.matchMedia = (q) => (String(q).includes("standalone") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : o(q)); });
    await d.p.goto(link);
    ok(await visible(d.p, "#screen-setup") && !(await visible(d.p, "#share-banner")), "no banner inside the installed app");
    for (const x of [a, b, c, d]) await x.ctx.close();
  });

  await check("Offline: app reopens without network (service worker)", async () => {
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.waitForTimeout(500);
    await ctx.setOffline(true);
    await p.reload();
    ok(await visible(p, "#screen-home"), "home loads offline");
    await p.click("[data-action=go-setup]"); await p.click("#setup-start");
    ok(await visible(p, "#screen-run"), "workout runs offline");
    const voicesLoaded = await p.evaluate(() => fetch("audio/go.mp3").then((r) => r.ok));
    ok(voicesLoaded, "voice file available offline");
    await ctx.setOffline(false);
  });

  await check("Installable: manifest and icons", async () => {
    const m = await p.evaluate(() => fetch("manifest.json").then((r) => r.json()));
    eq(m.display, "standalone"); eq(m.start_url, "./");
    for (const icon of m.icons) eq(await p.evaluate((u) => fetch(u).then((r) => r.status), icon.src), 200, icon.src);
    ok(m.icons.some((i) => i.purpose === "maskable"));
    eq(await p.evaluate(() => fetch("icons/apple-touch-icon.png").then((r) => r.status)), 200);
  });

  await check("Readable from 2-3 m: big seconds at least 120 px on a phone", async () => {
    const size = await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById("run-secs")).fontSize));
    ok(size >= 120, "seconds font " + size + "px");
  });
  await ctx.close();

  // ------------------------------------------------------------ layouts
  async function noOverflow(page, label) {
    const bad = await page.evaluate(() => {
      const out = [];
      const W = innerWidth, H = innerHeight;
      document.querySelectorAll("button, .run-secs, .run-phase, .bar-card, .chip").forEach((el) => {
        if (!el.offsetParent) return;
        if (el.closest(".saved-scroll")) return; // lists scroll on purpose
        const r = el.getBoundingClientRect();
        if (r.width === 0) return;
        if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push((el.id || el.className) + " " + Math.round(r.left) + "," + Math.round(r.top) + "," + Math.round(r.right) + "," + Math.round(r.bottom));
      });
      if (document.documentElement.scrollWidth > W + 1) out.push("horizontal scroll");
      return out;
    });
    ok(bad.length === 0, label + ": " + bad.join("; "));
  }

  for (const vp of [
    { name: "small phone 360x640", w: 360, h: 640 },
    { name: "phone landscape 844x390", w: 844, h: 390 },
    { name: "small landscape 640x360", w: 640, h: 360 },
    { name: "tablet 820x1180", w: 820, h: 1180 },
    { name: "computer 1280x800", w: 1280, h: 800 }
  ]) {
    await check("Layout " + vp.name + ": every screen fits, nothing cut", async () => {
      const { ctx: c2, p: q } = await newPage({ width: vp.w, height: vp.h });
      await q.goto(BASE);
      await noOverflow(q, "home");
      await q.click("[data-action=go-stopwatch]"); await q.click("#sw-start"); await q.click("#sw-lap"); await noOverflow(q, "stopwatch");
      await q.click("#sw-stop"); await q.click("[data-action=back] >> visible=true");
      await q.click("[data-action=go-saved]"); await noOverflow(q, "saved");
      await q.click("[data-action=back] >> visible=true");
      await q.click("[data-action=go-setup]");
      const setupOk = await q.evaluate(() => { const r = document.getElementById("setup-start").getBoundingClientRect(); return r.bottom <= innerHeight + 1; });
      ok(setupOk, "START visible");
      await q.click("#setup-start"); await q.waitForTimeout(200); await noOverflow(q, "workout");
      await q.click("[aria-label='Stop workout']"); await noOverflow(q, "confirm");
      await c2.close();
    });
  }

  await check("Computer: space bar pauses and resumes", async () => {
    const { ctx: c3, p: q } = await newPage({ width: 1280, height: 800 });
    await q.goto(BASE);
    await q.click("[data-action=go-setup]"); await q.click("#setup-start");
    await q.focus("body"); await q.evaluate(() => document.activeElement.blur());
    await q.keyboard.press("Space");
    ok(await q.isVisible("#badge-paused"), "paused");
    await q.keyboard.press("Space");
    ok(!(await q.isVisible("#badge-paused")), "resumed");
    await c3.close();
  });

  await check("Screen kept on during workout, released on pause and at the end", async () => {
    const { ctx: c4, p: q } = await newPage({ width: 390, height: 844 });
    await q.addInitScript(() => {
      window.__wake = { held: 0, requests: 0 };
      const fake = {
        request: () => {
          window.__wake.requests++; window.__wake.held++;
          const l = new EventTarget();
          l.release = () => { window.__wake.held--; l.dispatchEvent(new Event("release")); return Promise.resolve(); };
          return Promise.resolve(l);
        }
      };
      Object.defineProperty(Navigator.prototype, "wakeLock", { get: () => fake, configurable: true });
    });
    await q.goto(BASE);
    await q.evaluate(() => localStorage.clear()); await q.reload();
    const w = () => q.evaluate(() => window.__wake);
    eq((await w()).held, 0, "not held on home");
    await q.click("[data-action=go-setup]"); await q.click("#setup-start"); await q.waitForTimeout(100);
    eq((await w()).held, 1, "held while running");
    await q.click("#run-pause"); await q.waitForTimeout(100);
    eq((await w()).held, 0, "released on pause");
    await q.click("#run-pause"); await q.waitForTimeout(100);
    eq((await w()).held, 1, "held again");
    await q.click("[aria-label='Stop workout']"); await q.waitForTimeout(100);
    eq((await w()).held, 0, "released while confirm open");
    await q.click("#confirm-yes"); await q.waitForTimeout(100);
    eq((await w()).held, 0);
    await q.click("[data-action=back] >> visible=true");
    await q.click("[data-action=go-stopwatch]"); await q.click("#sw-start"); await q.waitForTimeout(100);
    eq((await w()).held, 1, "held while stopwatch runs");
    await q.click("#sw-stop"); await q.waitForTimeout(100);
    eq((await w()).held, 0, "released when stopwatch stops");
    await c4.close();
  });

  await check("No errors in the browser console", async () => {
    ok(errors.length === 0, errors.join(" | "));
  });

  await browser.close();
  const fails = results.filter((r) => r[0] === "FAIL");
  results.forEach((r) => console.log(r.join("  ")));
  console.log("\n" + (results.length - fails.length) + " passed, " + fails.length + " failed");
  process.exit(fails.length ? 1 : 0);
})();
