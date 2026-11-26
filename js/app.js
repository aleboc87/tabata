/*
 * TabatAle - App
 * Connects the screens to the stopwatch, the Tabata timer, the sounds and the settings.
 */
(function () {
  "use strict";

  var Plan = window.TabataPlan;
  var Progress = window.TabataProgress;
  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };

  // ---------------------------------------------------------------- state
  var cfg = Settings.loadSetup(Plan.DEFAULTS);
  var muted = Settings.loadMuted();
  var sw = new Stopwatch();
  var runner = null;          // the workout in progress
  var runInfo = null;         // { rounds, loops, total }
  var lastJumps = -1;
  var confirmKind = null;     // null | "stopwatch" | "run"
  var pausedBeforeConfirm = false;
  var bar = new Progress.ProgressBar($("run-segs"), $("run-cursor"), $("run-dots"));
  var storage = null;
  try { storage = window.localStorage; } catch (e) { /* storage blocked */ }
  var store = new WorkoutStore(storage);
  var loadedId = null;        // saved workout opened in the setup, if any
  var deleteId = null;        // saved workout waiting for delete confirmation

  Sound.setMuted(muted);

  // ---------------------------------------------------------------- helpers
  var textCache = new WeakMap();
  function setText(el, text) {
    if (textCache.get(el) === text) return;
    textCache.set(el, text);
    el.textContent = text;
  }
  function setHidden(el, hidden) {
    if (el.hidden !== hidden) el.hidden = hidden;
  }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  // ---------------------------------------------------------------- keep the screen on
  var wakeLock = null;
  var wakePending = false;   // a request is on its way: do not ask twice
  var wantWake = false;
  function shouldStayAwake() {
    if (confirmKind) return false;
    var screen = Nav.current();
    if (screen === "run") return !!runner && !runner.paused && !runner.done;
    if (screen === "stopwatch") return sw.isRunning();
    return false;
  }
  function updateWake() {
    wantWake = shouldStayAwake();
    if (!("wakeLock" in navigator)) return;
    if (wantWake && !wakeLock && !wakePending && document.visibilityState === "visible") {
      wakePending = true;
      navigator.wakeLock.request("screen").then(function (lock) {
        wakePending = false;
        if (!wantWake) { lock.release(); return; }
        wakeLock = lock;
        lock.addEventListener("release", function () { if (wakeLock === lock) wakeLock = null; });
      }).catch(function () { wakePending = false; /* not allowed now (e.g. battery saver) */ });
    } else if (!wantWake && wakeLock) {
      var l = wakeLock; wakeLock = null;
      l.release().catch(function () {});
    }
  }

  // ---------------------------------------------------------------- setup screen
  var SECTIONS = [
    { title: "Start", toggle: { key: "prep", label: "Get ready", on: "Countdown before the first round", off: "Off: work starts right away" }, fields: ["prepDur"] },
    { title: "Rounds", fields: ["work", "rest", "rounds"] },
    { title: "Loops", fields: ["loops", "between"] },
    { title: "Finish", toggle: { key: "cool", label: "Cool down", on: "Easy final phase", off: "Off" }, fields: ["coolDur"] }
  ];
  var rows = {};     // field key -> { row, input, dec, inc, hint }
  var toggles = {};  // key -> { btn, hint, def }

  function buildSetup() {
    var form = $("setup-form");
    SECTIONS.forEach(function (sec) {
      var section = document.createElement("section");
      section.className = "setup-section";
      var h = document.createElement("h2");
      h.textContent = sec.title;
      section.appendChild(h);
      if (sec.toggle) {
        var t = sec.toggle;
        var trow = document.createElement("div");
        trow.className = "row";
        trow.innerHTML =
          '<span class="row-text"><span class="row-label" id="lbl-' + t.key + '"></span><span class="row-hint"></span></span>' +
          '<button type="button" class="switch" role="switch" aria-labelledby="lbl-' + t.key + '"><span></span></button>';
        trow.querySelector(".row-label").textContent = t.label;
        var btn = trow.querySelector(".switch");
        btn.addEventListener("click", function () {
          cfg[t.key] = !cfg[t.key];
          saveAndRefresh();
        });
        toggles[t.key] = { btn: btn, hint: trow.querySelector(".row-hint"), def: t };
        section.appendChild(trow);
      }
      sec.fields.forEach(function (key) {
        var f = Plan.FIELDS[key];
        var row = document.createElement("div");
        row.className = "row";
        row.innerHTML =
          '<span class="row-text"><label class="row-label" for="f-' + key + '"></label><span class="row-hint" id="hint-' + key + '"></span></span>' +
          '<span class="stepper">' +
          '<button type="button" class="step-btn" data-step="-1">−</button>' +
          (f.seconds
            ? '<button type="button" class="time-btn" id="f-' + key + '" aria-describedby="hint-' + key + '"></button>'
            : '<input class="num-in" id="f-' + key + '" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" aria-describedby="hint-' + key + '">') +
          '<button type="button" class="step-btn" data-step="1">+</button>' +
          "</span>";
        row.querySelector("label").textContent = f.label;
        var input = row.querySelector("#f-" + key);
        var dec = row.querySelector('[data-step="-1"]');
        var inc = row.querySelector('[data-step="1"]');
        dec.setAttribute("aria-label", "Decrease " + f.label);
        inc.setAttribute("aria-label", "Increase " + f.label);
        if (f.seconds) {
          // tap the time to scroll minutes and seconds on two wheels
          input.addEventListener("click", function () {
            var cur = Plan.parseField(key, cfg[key]);
            TimePicker.open({
              label: f.label, min: f.min, max: f.max,
              value: cur === null ? Plan.DEFAULTS[key] : cur,
              returnFocus: input,
              onSet: function (v) { cfg[key] = String(v); saveAndRefresh(); }
            });
          });
        } else {
        input.value = cfg[key];
        input.addEventListener("input", function () {
          var clean = input.value.replace(/[^\d]/g, "").slice(0, 4);
          if (clean !== input.value) input.value = clean;
          cfg[key] = clean;
          saveAndRefresh();
        });
        input.addEventListener("blur", function () {
          // tidy "007" into "7" when valid
          var v = Plan.parseField(key, cfg[key]);
          if (v !== null && String(v) !== cfg[key]) { cfg[key] = String(v); input.value = cfg[key]; saveAndRefresh(); }
        });
        }
        function step(dir) {
          var cur = parseInt(cfg[key], 10);
          if (isNaN(cur)) cur = Plan.DEFAULTS[key];
          var next = dir > 0
            ? Math.floor(cur / f.step) * f.step + f.step
            : Math.ceil(cur / f.step) * f.step - f.step;
          next = Math.min(f.max, Math.max(f.min, next));
          cfg[key] = String(next);
          if (!f.seconds) input.value = cfg[key];
          saveAndRefresh();
        }
        dec.addEventListener("click", function () { step(-1); });
        inc.addEventListener("click", function () { step(1); });
        rows[key] = { row: row, input: input, dec: dec, inc: inc, hint: row.querySelector(".row-hint") };
        section.appendChild(row);
      });
      form.appendChild(section);
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); });
  }

  function saveAndRefresh() {
    Settings.saveSetup(cfg);
    refreshSetup();
  }

  function refreshSetup() {
    var check = Plan.validate(cfg);
    Object.keys(toggles).forEach(function (k) {
      var t = toggles[k], on = !!cfg[k];
      t.btn.setAttribute("aria-checked", on ? "true" : "false");
      setText(t.hint, on ? t.def.on : t.def.off);
    });
    setHidden(rows.prepDur.row, !cfg.prep);
    setHidden(rows.coolDur.row, !cfg.cool);
    var loops = Plan.parseField("loops", cfg.loops);
    Object.keys(rows).forEach(function (key) {
      var r = rows[key], f = Plan.FIELDS[key];
      var off = key === "between" && !(loops > 1);
      var bad = !off && !!check.errors[key];
      if (f.seconds) {
        var secs = Plan.parseField(key, cfg[key]);
        setText(r.input, secs === null ? "?" : Plan.formatClock(secs));
        r.input.setAttribute("aria-label", f.label + ", " + (secs === null ? "not set" : secs + " seconds") + ". Tap to change");
      } else if (document.activeElement !== r.input && r.input.value !== cfg[key]) r.input.value = cfg[key];
      r.row.classList.toggle("is-off", off);
      r.row.classList.toggle("is-bad", bad);
      r.input.disabled = off;
      r.input.setAttribute("aria-invalid", bad ? "true" : "false");
      var cur = parseInt(cfg[key], 10);
      r.dec.disabled = off || (!isNaN(cur) && cur <= f.min);
      r.inc.disabled = off || (!isNaN(cur) && cur >= f.max);
      var hint;
      if (off) hint = "Only used with more than 1 loop";
      else if (bad) hint = f.seconds ? "Choose a time from " + Plan.formatClock(f.min) + " to " + Plan.formatClock(f.max) : "Enter a value from " + f.min + " to " + f.max;
      else hint = f.seconds ? "min:sec · " + Plan.formatClock(f.min) + " to " + Plan.formatClock(f.max) : f.min + " to " + f.max;
      setText(r.hint, hint);
    });
    if (check.ok) {
      var total = Plan.totalSeconds(Plan.buildPhases(check.values));
      setText($("setup-total"), Plan.formatClock(total));
      setText($("setup-summary"), plural(check.values.rounds, "round") + " × " + plural(check.values.loops, "loop"));
    } else {
      setText($("setup-total"), "—");
      setText($("setup-summary"), "Fix the values in red");
    }
    $("setup-start").disabled = !check.ok;
    $("setup-save").disabled = !check.ok;
  }

  // ---------------------------------------------------------------- stopwatch
  var lapCount = -1;
  function renderStopwatch() {
    var t = now();
    var el = sw.elapsed(t);
    var parts = Stopwatch.formatParts(el);
    setText($("sw-main"), parts.main);
    setText($("sw-tenths"), parts.tenths);
    var running = sw.isRunning();
    var status = $("sw-status");
    setText(status, running ? "Running" : (el > 0 ? "Stopped" : "Ready"));
    status.classList.toggle("is-running", running);
    setHidden($("sw-lap"), !running);
    setHidden($("sw-stop"), !running);
    setHidden($("sw-reset"), running);
    setHidden($("sw-start"), running);
    $("sw-reset").disabled = el === 0;

    var list = $("sw-laps");
    var rowsData = sw.lapRows(t);
    setHidden($("sw-nolaps"), rowsData.length > 0);
    if (sw.laps.length !== lapCount) {
      lapCount = sw.laps.length;
      list.textContent = "";
      rowsData.forEach(function (r) {
        var li = document.createElement("li");
        li.className = r.kind;
        var name = "Lap " + r.n + (r.kind === "best" ? " · best" : (r.kind === "worst" ? " · worst" : ""));
        li.innerHTML = '<span class="lap-name"></span><span class="lap-time"></span><span class="lap-total"></span>';
        li.children[0].textContent = name;
        list.appendChild(li);
      });
    }
    // refresh times (the top row, the lap in progress, changes every frame)
    for (var i = 0; i < rowsData.length && i < list.children.length; i++) {
      setText(list.children[i].children[1], Stopwatch.format(rowsData[i].lap));
      setText(list.children[i].children[2], Stopwatch.format(rowsData[i].total));
    }
  }

  // ---------------------------------------------------------------- workout
  function startRun() {
    if (loadedId) store.markUsed(loadedId);
    var check = Plan.validate(cfg);
    if (!check.ok) { Nav.show("setup"); refreshSetup(); return; }
    Sound.unlock();
    var phases = Plan.buildPhases(check.values);
    runner = new TabataRunner(phases);
    runInfo = { rounds: check.values.rounds, loops: check.values.loops, total: Plan.totalSeconds(phases) };
    lastJumps = -1;
    bar.reset();
    runner.start(now());
    Nav.show("run");
    tick();
  }

  function finishRun() {
    Sound.cancelAll();
    setText($("done-total"), Plan.formatClock(runInfo.total));
    setText($("done-summary"), plural(runInfo.rounds, "round") + " × " + plural(runInfo.loops, "loop"));
    runner = null;
    Nav.show("done");
  }

  function stopRun() {
    Sound.cancelAll();
    runner = null;
  }

  function stepRun(t) {
    var events = runner.update(t);
    if (runner.jumps !== lastJumps) {
      Sound.cancelAll();
      lastJumps = runner.jumps;
    }
    if (runner.done || events.some(function (e) { return e.type === "done"; })) {
      finishRun();
      return false;
    }
    Sound.sync(runner, t);
    return true;
  }

  function renderRun(t) {
    var ph = runner.current();
    var next = runner.next();
    var remaining = runner.remainingInPhaseMs(t);
    var elapsed = runner.elapsedInPhaseMs(t);
    var secs = Math.max(0, Math.ceil(remaining / 1000));

    var body = document.body;
    var phaseClass = "phase-" + ph.type;
    if (!body.classList.contains(phaseClass)) {
      body.classList.remove("phase-prep", "phase-work", "phase-rest", "phase-between", "phase-cool");
      body.classList.add(phaseClass);
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", getComputedStyle(body).getPropertyValue("--" + ph.type).trim() || "#0B1620");
    }

    setText($("run-phase"), Plan.PHASE_LABELS[ph.type]);
    var secsEl = $("run-secs");
    setText(secsEl, String(secs));
    secsEl.classList.toggle("is-long", secs >= 100);
    setText($("run-round"), ph.type === "prep" ? "Round – / " + runInfo.rounds : "Round " + ph.round + " / " + runInfo.rounds);
    setText($("run-loop"), "Loop " + ph.loop + "/" + runInfo.loops);
    setText($("run-next"), next ? Plan.PHASE_LABELS[next.type] + " · " + next.dur + " s" : "Finish");
    setText($("run-left"), Plan.formatClock(Math.ceil(runner.remainingTotalMs(t) / 1000)));

    var c = Progress.counters(runner.phases, runner.idx, runInfo.rounds, runInfo.loops);
    setText($("cnt-loop"), c.loop);
    setText($("cnt-work-loop"), c.workLoop);
    setText($("cnt-work-total"), c.workTotal);
    bar.render(Progress.barModel(runner.phases, runner.idx, elapsed / (ph.dur * 1000), runInfo.loops));
    $("run-bar").setAttribute("aria-label", "Workout progress: phase " + (runner.idx + 1) + " of " + runner.phases.length);

    var paused = runner.paused;
    setHidden($("badge-paused"), !paused);
    var beep = ph.type === "work" && !paused && secs <= 3 && secs > 0;
    setHidden($("badge-beep"), !beep);
    if (beep) setText($("badge-beep-text"), "BIP " + secs);
    var voice = !paused && (ph.type === "work" || ph.type === "rest") && elapsed < 1600 && !beep;
    setHidden($("badge-voice"), !voice);
    if (voice) setText($("badge-voice-text"), ph.type === "work" ? "“Let's GO”" : "“Rest”");

    var pauseBtn = $("run-pause");
    pauseBtn.classList.toggle("is-paused", paused);
    pauseBtn.setAttribute("aria-label", paused ? "Resume" : "Pause");
    $("run-prev").disabled = !runner.canGoBack(t);
  }

  function renderMute() {
    var b = $("run-mute");
    b.classList.toggle("is-muted", muted);
    b.setAttribute("aria-label", muted ? "Unmute" : "Mute");
  }

  // ---------------------------------------------------------------- saved workouts
  function summaryOf(c) {
    var check = Plan.validate(c);
    if (!check.ok) return "";
    return Plan.formatClock(Plan.totalSeconds(Plan.buildPhases(check.values))) + " · " +
      plural(check.values.rounds, "round") + " × " + plural(check.values.loops, "loop");
  }

  function renderSavedCount() {
    var t = store.count() + "/" + WorkoutStore.MAX;
    setText($("home-saved-count"), t);
    setText($("saved-count"), t);
  }

  var ICON_RENAME = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
  var ICON_DELETE = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';

  function renderSaved() {
    renderSavedCount();
    var q = $("saved-search").value;
    var items = store.search(q);
    var list = $("saved-list");
    list.textContent = "";
    items.forEach(function (w) {
      var li = document.createElement("li");
      li.innerHTML =
        '<button type="button" class="saved-open"><span class="saved-name"></span><span class="saved-sum"></span></button>' +
        '<button type="button" class="icon-btn" data-role="rename">' + ICON_RENAME + '</button>' +
        '<button type="button" class="icon-btn" data-role="delete">' + ICON_DELETE + '</button>';
      var open = li.querySelector(".saved-open");
      var ren = li.querySelector('[data-role="rename"]');
      var del = li.querySelector('[data-role="delete"]');
      li.querySelector(".saved-name").textContent = w.name;
      li.querySelector(".saved-sum").textContent = summaryOf(w.cfg);
      open.setAttribute("aria-label", "Open " + w.name);
      ren.setAttribute("aria-label", "Rename " + w.name);
      del.setAttribute("aria-label", "Delete " + w.name);
      open.addEventListener("click", function () { openSaved(w.id); });
      ren.addEventListener("click", function () { openNameDialog("rename", w.name, w.id); });
      del.addEventListener("click", function () { deleteId = w.id; openConfirm("delete"); });
      list.appendChild(li);
    });
    var empty = $("saved-empty");
    if (store.count() === 0) {
      empty.textContent = "No saved workouts yet. Set up a Tabata and press Save.";
      empty.hidden = false;
    } else if (!items.length) {
      empty.textContent = "No workouts match “" + q.trim() + "”.";
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }
  }

  /** Opens a saved workout in the setup, ready for START. */
  function openSaved(id) {
    var w = store.get(id);
    if (!w) return;
    Object.keys(Plan.DEFAULTS).forEach(function (k) {
      var d = Plan.DEFAULTS[k];
      var v = k in w.cfg ? w.cfg[k] : d;
      cfg[k] = typeof d === "boolean" ? !!v : String(v);
    });
    loadedId = id;
    store.markUsed(id);
    Settings.saveSetup(cfg);
    refreshSetup();
    Nav.show("setup");
  }

  // name dialog: mode "save" or "rename"
  var nameMode = null, nameTargetId = null;
  function nameDialogOpen() { return !$("name-dialog").hidden; }
  function nameMsg(text, bad) {
    var m = $("name-msg");
    setText(m, text);
    m.classList.toggle("is-bad", !!bad);
  }
  function openNameDialog(mode, name, id) {
    nameMode = mode;
    nameTargetId = id || null;
    setText($("name-title"), mode === "save" ? "Save workout" : "Rename workout");
    setText($("name-ok"), mode === "save" ? "Save" : "Rename");
    $("name-edit").hidden = false;
    $("name-replace").hidden = true;
    $("name-input").value = name || "";
    if (mode === "save" && store.isFull() && !(name && store.findByName(name))) {
      nameMsg("You can save up to 10 workouts. Delete one first.", true);
    } else if (mode === "save") {
      nameMsg(store.count() + " of " + WorkoutStore.MAX + " saved", false);
    } else {
      nameMsg("", false);
    }
    $("name-dialog").hidden = false;
    var input = $("name-input");
    input.focus();
    try { input.select(); } catch (e) { /* ignore */ }
  }
  function closeNameDialog() {
    $("name-dialog").hidden = true;
    nameMode = null;
  }
  function afterSave(w) {
    loadedId = w.id;
    closeNameDialog();
    renderSaved();
  }
  function submitName() {
    var name = $("name-input").value;
    if (nameMode === "rename") {
      var r = store.rename(nameTargetId, name);
      if (r.ok) { closeNameDialog(); renderSaved(); return; }
      if (r.error === "empty") nameMsg("Type a name.", true);
      else if (r.error === "exists") nameMsg("Another workout already has this name.", true);
      return;
    }
    var res = store.save(name, cfg);
    if (res.ok) { afterSave(res.workout); return; }
    if (res.error === "empty") nameMsg("Type a name.", true);
    else if (res.error === "full") nameMsg("You can save up to 10 workouts. Delete one first.", true);
    else if (res.error === "exists") {
      setText($("name-replace-text"), "A workout called “" + res.existing.name + "” already exists. Replace it?");
      $("name-edit").hidden = true;
      $("name-replace").hidden = false;
      $("name-replace-yes").focus();
    }
  }
  $("name-form").addEventListener("submit", function (e) { e.preventDefault(); submitName(); });
  $("name-cancel").addEventListener("click", closeNameDialog);
  $("name-replace-no").addEventListener("click", function () {
    $("name-replace").hidden = true;
    $("name-edit").hidden = false;
    $("name-input").focus();
  });
  $("name-replace-yes").addEventListener("click", function () {
    var res = store.save($("name-input").value, cfg, { replace: true });
    if (res.ok) afterSave(res.workout);
  });
  $("name-dialog").addEventListener("click", function (e) { if (e.target === $("name-dialog")) closeNameDialog(); });
  $("saved-search").addEventListener("input", renderSaved);

  // ---------------------------------------------------------------- confirm
  function openConfirm(kind) {
    confirmKind = kind;
    if (kind === "stopwatch") {
      setText($("confirm-title"), "Stop the stopwatch?");
      setText($("confirm-text"), "The time will be lost and you will go back to home.");
      setText($("confirm-yes"), "Stop");
    } else if (kind === "delete") {
      var w = store.get(deleteId);
      setText($("confirm-title"), "Delete \u201c" + (w ? w.name : "") + "\u201d?");
      setText($("confirm-text"), "The workout will be removed from this device.");
      setText($("confirm-yes"), "Delete");
    } else {
      setText($("confirm-title"), "Stop the workout?");
      setText($("confirm-text"), "Your progress will be lost and you will go back to the Tabata setup.");
      setText($("confirm-yes"), "Stop workout");
    }
    setText($("confirm-no"), kind === "delete" ? "Cancel" : "Keep going");
    $("confirm").hidden = false;
    $("confirm-no").focus();
    updateWake();
  }

  function closeConfirm() {
    confirmKind = null;
    $("confirm").hidden = true;
  }

  function confirmYes() {
    var kind = confirmKind;
    closeConfirm();
    if (kind === "stopwatch") {
      sw.reset();
      Nav.show("home");
    } else if (kind === "run") {
      stopRun();
      Nav.show("setup");
    } else if (kind === "delete") {
      if (deleteId === loadedId) loadedId = null;
      store.remove(deleteId);
      deleteId = null;
      renderSaved();
    }
    updateWake();
  }

  function confirmNo() {
    var kind = confirmKind;
    closeConfirm();
    var t = now();
    if (kind === "stopwatch") {
      sw.start(t);
    } else if (kind === "run" && runner && !pausedBeforeConfirm) {
      Sound.unlock();
      runner.resume(t);
    }
    updateWake();
    tick();
  }

  // ---------------------------------------------------------------- back (arrow, X or system back)
  function handleBack(screen) {
    if (TimePicker.isOpen()) { TimePicker.close(); return; }
    if (nameDialogOpen()) { closeNameDialog(); return; }
    if (confirmKind) { confirmNo(); return; }
    var t = now();
    switch (screen) {
      case "stopwatch":
        if (sw.isRunning()) { sw.stop(t); openConfirm("stopwatch"); }
        else { sw.reset(); Nav.show("home"); }
        break;
      case "setup":
      case "saved":
      case "done":
        Nav.show("home");
        break;
      case "run":
        if (!runner) { Nav.show("setup"); break; }
        pausedBeforeConfirm = runner.paused;
        runner.pause(t);
        if (runner.done) { finishRun(); break; }
        openConfirm("run");
        break;
      default:
        break;
    }
    tick();
  }

  // ---------------------------------------------------------------- actions
  var actions = {
    "go-stopwatch": function () { Nav.show("stopwatch"); },
    "go-setup": function () { refreshSetup(); Nav.show("setup"); },
    "go-home": function () { Nav.show("home"); },
    "go-saved": function () { $("saved-search").value = ""; renderSaved(); Nav.show("saved"); },
    "save-workout": function () {
      if (!Plan.validate(cfg).ok) return;
      var w = loadedId ? store.get(loadedId) : null;
      openNameDialog("save", w ? w.name : "");
    },
    "back": function () { handleBack(Nav.current()); },
    "sw-start": function () { sw.start(now()); },
    "sw-stop": function () { sw.stop(now()); },
    "sw-reset": function () { sw.reset(); },
    "sw-lap": function () { sw.lap(now()); },
    "start-run": startRun,
    "toggle-mute": function () {
      muted = !muted;
      Settings.saveMuted(muted);
      Sound.setMuted(muted);
      if (!muted) Sound.unlock();
      renderMute();
    },
    "toggle-pause": function () {
      if (!runner) return;
      var t = now();
      if (runner.paused) { Sound.unlock(); runner.resume(t); }
      else runner.pause(t);
    },
    "prev": function () { if (runner) { Sound.unlock(); runner.back(now()); } },
    "skip": function () {
      if (!runner) return;
      Sound.unlock();
      if (!runner.skip(now())) finishRun();
    },
    "confirm-yes": confirmYes,
    "confirm-no": confirmNo
  };

  document.addEventListener("click", function (e) {
    var target = e.target.closest ? e.target.closest("[data-action]") : null;
    if (!target || target.disabled) return;
    var fn = actions[target.getAttribute("data-action")];
    if (!fn) return;
    fn();
    updateWake();
    tick();
  });

  // Space bar: start/stop on computers
  document.addEventListener("keydown", function (e) {
    if (e.key !== " " && e.key !== "Spacebar") return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "BUTTON" || confirmKind) return;
    var screen = Nav.current();
    if (screen === "run") { e.preventDefault(); actions["toggle-pause"](); }
    else if (screen === "stopwatch") { e.preventDefault(); actions[sw.isRunning() ? "sw-stop" : "sw-start"](); }
    else return;
    updateWake();
    tick();
  });

  // ---------------------------------------------------------------- loop
  var rafId = 0;
  function tick() {
    var screen = Nav.current();
    var t = now();
    if (screen === "run" && runner) {
      if (stepRun(t)) renderRun(t);
    } else if (screen === "stopwatch") {
      renderStopwatch();
    }
    var animating = (screen === "run" && runner) || (screen === "stopwatch" && sw.isRunning());
    if (animating && !rafId) {
      rafId = requestAnimationFrame(function () { rafId = 0; tick(); });
    }
  }
  // when the screen does not redraw (app in background) the timer and the sounds still move on
  setInterval(function () {
    if (Nav.current() === "run" && runner) stepRun(now());
  }, 250);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      Sound.wake();
      updateWake();
      tick();
    }
  });
  // iPhone may suspend audio after a call: any tap wakes it again
  document.addEventListener("touchend", function () { Sound.wake(); }, { passive: true });

  Nav.onChange(function (screen) {
    var inRun = screen === "run";
    document.body.classList.toggle("in-run", inRun);
    if (!inRun) {
      document.body.classList.remove("phase-prep", "phase-work", "phase-rest", "phase-between", "phase-cool");
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", "#0B1620");
    }
    if (screen !== "stopwatch") lapCount = -1;
    updateWake();
  });

  // ---------------------------------------------------------------- start
  TimePicker.init();
  buildSetup();
  refreshSetup();
  renderMute();
  renderSavedCount();
  Nav.init(handleBack);
  Nav.show("home");
  Sound.preload();

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function () { /* offline mode not available */ });
    });
  }
})();
