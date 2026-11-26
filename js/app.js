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
  var histStore = new HistoryStore(storage);
  var loadedId = null;        // saved workout opened in the setup, if any
  var presetName = "";        // ready-made workout opened in the setup, if any
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
  /** "8 rounds × 1 loop", or "3 blocks · 20 rounds" when the workout has several blocks. */
  function shapeText(s) {
    if (s.blocks <= 1 && s.kind === "emom") return "EMOM \u00b7 " + plural(s.rounds, "round");
    if (s.blocks <= 1 && s.kind === "amrap") return "AMRAP";
    if (s.blocks > 1) return plural(s.blocks, "block") + " \u00b7 " + plural(s.totalRounds, "round");
    return plural(s.rounds, "round") + " \u00d7 " + plural(s.loops, "loop");
  }
  function shapeOfValues(v) {
    var extra = v.extra || [];
    var roundsOf = function (b, loops) { return b.type === "amrap" ? 0 : b.rounds * loops; };
    return {
      rounds: v.rounds, loops: v.loops, blocks: extra.length + 1,
      kind: !extra.length && v.type !== "interval" ? v.type : "",
      totalRounds: extra.reduce(function (a, b) { return a + roundsOf(b, 1); }, roundsOf({ type: v.type, rounds: v.rounds }, v.loops))
    };
  }

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
    { title: "Timing", fields: ["every", "amrapDur"] },
    { title: "Rounds", fields: ["work", "rest", "rounds"] },
    { title: "Loops", fields: ["loops", "between"] },
    { title: "Finish", toggle: { key: "cool", label: "Cool down", on: "Easy final phase", off: "Off" }, fields: ["coolDur"] }
  ];
  var rows = {};     // field key -> { row, input, dec, inc, hint, label }
  var secEls = [];   // { el, fields } so a section with no visible field can be hidden
  // which kind of block each main field belongs to ("rounds" is shared by Interval and EMOM)
  var FIELD_TYPES = { work: ["interval"], rest: ["interval"], rounds: ["interval", "emom"], loops: ["interval"], between: ["interval"], every: ["emom"], amrapDur: ["amrap"] };
  var TYPE_NAMES = { interval: "Interval", emom: "EMOM", amrap: "AMRAP" };
  var toggles = {};  // key -> { btn, hint, def }

  function buildSetup() {
    var form = $("setup-form");
    SECTIONS.forEach(function (sec) {
      var section = document.createElement("section");
      section.className = "setup-section";
      secEls.push({ el: section, fields: sec.fields, toggle: !!sec.toggle });
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
        rows[key] = { row: row, input: input, dec: dec, inc: inc, hint: row.querySelector(".row-hint"), label: row.querySelector("label") };
        section.appendChild(row);
      });
      form.appendChild(section);
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    buildBlocksUI(form);
  }

  // ---------------------------------------------------------------- extra blocks and exercise names
  var ICON_X = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  var blocksBox = null, name1Row = null, name1Input = null, addBtn = null, typeSeg = null;

  /** Interval / EMOM / AMRAP picker (one row of buttons). */
  function makeTypeSeg(label, onPick) {
    var wrap = document.createElement("div");
    wrap.className = "type-seg";
    wrap.setAttribute("role", "radiogroup");
    wrap.setAttribute("aria-label", label);
    Plan.TYPES.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.type = t;
      b.textContent = TYPE_NAMES[t];
      b.addEventListener("click", function () { onPick(t); });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function refreshTypeSeg(el, type) {
    if (!el) return;
    Array.prototype.forEach.call(el.querySelectorAll("button"), function (b) {
      var on = b.dataset.type === type;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.classList.toggle("is-on", on);
    });
  }
  var blockRefs = [];     // per extra block: { name, rows: { key: {row,input,dec,inc,hint} } }
  var blocksBuilt = -1;   // how many extra blocks the screen shows now

  function nameInputHTML(id) {
    return '<input id="' + id + '" class="text-in" type="text" maxlength="' + Plan.NAME_MAX + '" placeholder="Optional, e.g. Squats" autocomplete="off" enterkeyhint="done">';
  }

  function buildBlocksUI(form) {
    // the first block gets a name field only once there is more than one block
    name1Row = document.createElement("div");
    name1Row.className = "row name-row";
    name1Row.hidden = true;
    name1Row.innerHTML = '<span class="row-text"><label class="row-label" for="f-name1">Exercise</label></span>' + nameInputHTML("f-name1");
    name1Input = name1Row.querySelector("input");
    name1Input.addEventListener("input", function () { cfg.name1 = name1Input.value; saveAndRefresh(); });
    typeSeg = makeTypeSeg("Workout type", function (t) { cfg.type = t; saveAndRefresh(); });
    typeSeg.id = "type-seg";
    form.insertBefore(name1Row, form.firstChild);
    form.insertBefore(typeSeg, form.firstChild);

    blocksBox = document.createElement("div");
    blocksBox.id = "blocks";
    blocksBox.className = "blocks";
    form.appendChild(blocksBox);

    addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-block";
    addBtn.id = "add-block";
    addBtn.innerHTML = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span>Add block</span>';
    addBtn.addEventListener("click", function () {
      if (cfg.blocks.length >= Plan.MAX_BLOCKS - 1) return;
      var b = JSON.parse(JSON.stringify(Plan.BLOCK_DEFAULTS));
      // a new block starts like the first one: easy to change a few numbers
      b.work = cfg.work; b.rest = cfg.rest; b.rounds = cfg.rounds;
      cfg.blocks.push(b);
      saveAndRefresh();
      var last = blockRefs[blockRefs.length - 1];
      if (last) { try { last.name.focus(); last.name.scrollIntoView({ block: "center" }); } catch (e) { /* ignore */ } }
    });
    form.appendChild(addBtn);
  }

  function blockRow(i, key) {
    var f = Plan.BLOCK_FIELDS[key];
    var row = document.createElement("div");
    row.className = "row";
    var id = "b" + i + "-" + key;
    row.innerHTML =
      '<span class="row-text"><label class="row-label" for="' + id + '"></label><span class="row-hint"></span></span>' +
      '<span class="stepper">' +
      '<button type="button" class="step-btn" data-step="-1">−</button>' +
      (f.seconds
        ? '<button type="button" class="time-btn" id="' + id + '"></button>'
        : '<input class="num-in" id="' + id + '" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off">') +
      '<button type="button" class="step-btn" data-step="1">+</button></span>';
    row.querySelector("label").textContent = f.label;
    var input = row.querySelector("#" + id);
    var dec = row.querySelector('[data-step="-1"]'), inc = row.querySelector('[data-step="1"]');
    dec.setAttribute("aria-label", "Decrease " + f.label + ", block " + (i + 2));
    inc.setAttribute("aria-label", "Increase " + f.label + ", block " + (i + 2));
    function get() { return cfg.blocks[i]; }
    if (f.seconds) {
      input.addEventListener("click", function () {
        var cur = Plan.parseField(key, get()[key], Plan.BLOCK_FIELDS);
        TimePicker.open({
          label: f.label, min: f.min, max: f.max, value: cur === null ? Number(Plan.BLOCK_DEFAULTS[key]) : cur,
          returnFocus: input, onSet: function (v) { get()[key] = String(v); saveAndRefresh(); }
        });
      });
    } else {
      input.addEventListener("input", function () {
        var clean = input.value.replace(/[^\d]/g, "").slice(0, 4);
        if (clean !== input.value) input.value = clean;
        get()[key] = clean;
        saveAndRefresh();
      });
      input.addEventListener("blur", function () {
        var v = Plan.parseField(key, get()[key], Plan.BLOCK_FIELDS);
        if (v !== null && String(v) !== get()[key]) { get()[key] = String(v); input.value = get()[key]; saveAndRefresh(); }
      });
    }
    function step(dir) {
      var cur = parseInt(get()[key], 10);
      if (isNaN(cur)) cur = Number(Plan.BLOCK_DEFAULTS[key]);
      get()[key] = String(Math.min(f.max, Math.max(f.min, cur + dir * f.step)));
      saveAndRefresh();
    }
    dec.addEventListener("click", function () { step(-1); });
    inc.addEventListener("click", function () { step(1); });
    return { row: row, input: input, dec: dec, inc: inc, hint: row.querySelector(".row-hint") };
  }

  /** Rebuilds the cards of the extra blocks (only when blocks are added, removed or replaced). */
  function renderBlocks() {
    blocksBox.textContent = "";
    blockRefs = [];
    cfg.blocks.forEach(function (b, i) {
      var card = document.createElement("section");
      card.className = "setup-section block-card";
      card.innerHTML =
        '<div class="block-head"><h2></h2><button type="button" class="icon-btn" data-role="remove-block"></button></div>' +
        '<div class="row name-row"><span class="row-text"><label class="row-label"></label></span>' + nameInputHTML("b" + i + "-name") + '</div>';
      card.querySelector("h2").textContent = "Block " + (i + 2);
      var rm = card.querySelector("[data-role=remove-block]");
      rm.innerHTML = ICON_X;
      rm.setAttribute("aria-label", "Remove block " + (i + 2));
      rm.addEventListener("click", function () { cfg.blocks.splice(i, 1); saveAndRefresh(); });
      var nameInput = card.querySelector("input");
      card.querySelector("label").textContent = "Exercise";
      card.querySelector("label").setAttribute("for", "b" + i + "-name");
      nameInput.addEventListener("input", function () { cfg.blocks[i].name = nameInput.value; saveAndRefresh(); });
      var seg = makeTypeSeg("Type of block " + (i + 2), function (t) { cfg.blocks[i].type = t; saveAndRefresh(); });
      card.insertBefore(seg, card.children[1]);
      var refs = { name: nameInput, seg: seg, rows: {} };
      ["gap", "work", "rest", "every", "dur", "rounds"].forEach(function (key) {
        refs.rows[key] = blockRow(i, key);
        card.appendChild(refs.rows[key].row);
      });
      blockRefs.push(refs);
      blocksBox.appendChild(card);
    });
    if (cfg.blocks.length) {
      var note = document.createElement("p");
      note.className = "block-note";
      note.textContent = "Get ready runs once at the start and cool down once at the end of the whole workout.";
      blocksBox.appendChild(note);
    }
    blocksBuilt = cfg.blocks.length;
  }

  /** Shows the current values in the block fields and marks the wrong ones. */
  function refreshBlocks(check) {
    if (blocksBuilt !== cfg.blocks.length) renderBlocks();
    setHidden(name1Row, cfg.blocks.length === 0 && Plan.cleanType(cfg.type) === "interval");
    setText(name1Row.querySelector("label"), cfg.blocks.length ? "Block 1 \u00b7 exercise" : "Exercise");
    if (document.activeElement !== name1Input && name1Input.value !== (cfg.name1 || "")) name1Input.value = cfg.name1 || "";
    setHidden(addBtn, cfg.blocks.length >= Plan.MAX_BLOCKS - 1);
    cfg.blocks.forEach(function (b, i) {
      var refs = blockRefs[i];
      if (document.activeElement !== refs.name && refs.name.value !== (b.name || "")) refs.name.value = b.name || "";
      var btype = Plan.cleanType(b.type);
      refreshTypeSeg(refs.seg, btype);
      Object.keys(refs.rows).forEach(function (key) {
        var r = refs.rows[key], f = Plan.BLOCK_FIELDS[key];
        setHidden(r.row, key !== "gap" && Plan.BLOCK_KEYS[btype].indexOf(key) < 0);
        setText(r.row.querySelector("label"), key === "rounds" ? (btype === "emom" ? "Rounds" : f.label) : f.label);
        var bad = !!check.errors["b" + i + "." + key];
        if (f.seconds) {
          var secs = Plan.parseField(key, b[key], Plan.BLOCK_FIELDS);
          setText(r.input, secs === null ? "?" : Plan.formatClock(secs));
          r.input.setAttribute("aria-label", f.label + ", block " + (i + 2) + ", " + (secs === null ? "not set" : secs + " seconds") + ". Tap to change");
        } else if (document.activeElement !== r.input && r.input.value !== b[key]) r.input.value = b[key];
        r.row.classList.toggle("is-bad", bad);
        r.input.setAttribute("aria-invalid", bad ? "true" : "false");
        var cur = parseInt(b[key], 10);
        r.dec.disabled = !isNaN(cur) && cur <= f.min;
        r.inc.disabled = !isNaN(cur) && cur >= f.max;
        var hint;
        if (bad) hint = f.seconds ? "Choose a time from " + Plan.formatClock(f.min) + " to " + Plan.formatClock(f.max) : "Enter a value from " + f.min + " to " + f.max;
        else hint = key === "gap" ? "Before this block starts" : (f.seconds ? "min:sec" : f.min + " to " + f.max);
        setText(r.hint, hint);
      });
    });
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
    var type = Plan.cleanType(cfg.type);
    Object.keys(rows).forEach(function (key) {
      if (FIELD_TYPES[key]) setHidden(rows[key].row, FIELD_TYPES[key].indexOf(type) < 0);
    });
    setText(rows.rounds.label, type === "emom" ? "Rounds" : Plan.FIELDS.rounds.label);
    secEls.forEach(function (sec) {
      if (sec.toggle) return;
      setHidden(sec.el, sec.fields.every(function (k) { return rows[k].row.hidden; }));
    });
    refreshTypeSeg(typeSeg, type);
    Object.keys(rows).forEach(function (key) {
      var r = rows[key], f = Plan.FIELDS[key];
      var off = key === "between" && !(loops > 1);
      var bad = !off && !!check.errors[key] && !(FIELD_TYPES[key] && FIELD_TYPES[key].indexOf(type) < 0);
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
    refreshBlocks(check);
    if (check.ok) {
      var total = Plan.totalSeconds(Plan.buildPhases(check.values));
      setText($("setup-total"), Plan.formatClock(total));
      setText($("setup-summary"), shapeText(shapeOfValues(check.values)));
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
    Speech.unlock();
    lastSpoken = -1;
    var phases = Plan.buildPhases(check.values);
    runner = new TabataRunner(phases);
    var w = loadedId ? store.get(loadedId) : null;
    var shape = shapeOfValues(check.values);
    runInfo = {
      rounds: check.values.rounds, loops: check.values.loops, total: Plan.totalSeconds(phases),
      blocks: shape.blocks, totalRounds: shape.totalRounds, kind: shape.kind,
      amrap: {}, amrapNames: {},
      sections: check.values.loops + (check.values.extra || []).length, // loops of block 1 + one per extra block
      name: w ? w.name : presetName
    };
    phases.forEach(function (p) {
      if (p.kind === "amrap") { runInfo.amrap[p.block] = 0; runInfo.amrapNames[p.block] = p.name || ""; }
    });
    lastJumps = -1;
    bar.reset();
    runner.start(now());
    Nav.show("run");
    tick();
  }

  function finishRun() {
    Sound.cancelAll();
    Sound.playNow("done");
    setText($("done-total"), Plan.formatClock(runInfo.total));
    setText($("done-summary"), shapeText(runInfo));
    var results = amrapResults();
    runInfo.results = results;
    setText($("done-results"), results.join("  \u00b7  "));
    setHidden($("done-results"), !results.length);
    histStore.add(runInfo);
    renderStreakCounts();
    var streak = histStore.streak();
    setText($("done-streak"), streak > 1 ? streak + " days in a row" : "");
    runner = null;
    Nav.show("done");
  }

  /** "Burpees: 7 rounds" for every AMRAP block of the workout that just ended. */
  function amrapResults() {
    return Object.keys(runInfo.amrap).map(function (b) {
      return (runInfo.amrapNames[b] || "AMRAP") + ": " + plural(runInfo.amrap[b], "round");
    });
  }

  function amrapPhase() {
    var ph = runner && runner.phases[runner.idx];
    return ph && ph.kind === "amrap" ? ph : null;
  }

  function stopRun() {
    Sound.cancelAll();
    runner = null;
  }

  var lastSpoken = -1;   // phase whose exercise name was already handled
  /** Says the exercise name (or "Next, ...") when a new phase begins. */
  function speakPhase() {
    if (muted || runner.paused) return;
    var a = Plan.announcement(runner.phases, runner.idx);
    if (a) Speech.say(a.text, a.next, 900);
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
    if (runner.idx !== lastSpoken && !runner.paused) { lastSpoken = runner.idx; speakPhase(); }
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

    setText($("run-phase"), ph.label || Plan.PHASE_LABELS[ph.type]);
    var exName = ph.name ? ph.name : (ph.next ? "Next: " + ph.next : "");
    setText($("run-ex"), exName);
    setHidden($("run-ex"), !exName);
    var secsEl = $("run-secs");
    setText(secsEl, String(secs));
    secsEl.classList.toggle("is-long", secs >= 100);
    var rr = ph.rounds || runInfo.rounds;
    var isAmrap = ph.kind === "amrap";
    setHidden($("amrap-box"), !isAmrap);
    if (isAmrap) setText($("run-round"), "Rounds: " + (runInfo.amrap[ph.block] || 0));
    else if (ph.kind === "emom") setText($("run-round"), ph.unit + " " + ph.round + " / " + rr);
    else setText($("run-round"), ph.type === "prep" ? "Round – / " + rr : "Round " + ph.round + " / " + rr);
    setText($("run-loop"), runInfo.blocks > 1 ? "Block " + (ph.block || 1) + "/" + runInfo.blocks : (runInfo.kind ? TYPE_NAMES[runInfo.kind] : "Loop " + ph.loop + "/" + runInfo.loops));
    setText($("run-next"), next ? (next.label || Plan.PHASE_LABELS[next.type]) + (next.name ? " · " + next.name : "") + " · " + next.dur + " s" : "Finish");
    setText($("run-left"), Plan.formatClock(Math.ceil(runner.remainingTotalMs(t) / 1000)));

    var c = Progress.counters(runner.phases, runner.idx, runInfo.rounds, runInfo.loops);
    setText($("lbl-cnt-loop"), c.labels.loop);
    setText($("lbl-cnt-work-loop"), c.labels.workLoop);
    setText($("cnt-loop"), c.loop);
    setText($("cnt-work-loop"), c.workLoop);
    setText($("cnt-work-total"), c.workTotal);
    bar.render(Progress.barModel(runner.phases, runner.idx, elapsed / (ph.dur * 1000), runInfo.sections));
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
    return Plan.formatClock(Plan.totalSeconds(Plan.buildPhases(check.values))) + " · " + shapeText(shapeOfValues(check.values));
  }

  function renderSavedCount() {
    var t = store.count() + "/" + WorkoutStore.MAX;
    setText($("home-saved-count"), t);
    setText($("saved-count"), t);
  }

  var ICON_RENAME = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
  var ICON_SHARE = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4M5 12v7h14v-7"/></svg>';
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
        '<button type="button" class="icon-btn" data-role="share">' + ICON_SHARE + '</button>' +
        '<button type="button" class="icon-btn" data-role="rename">' + ICON_RENAME + '</button>' +
        '<button type="button" class="icon-btn" data-role="delete">' + ICON_DELETE + '</button>';
      var open = li.querySelector(".saved-open");
      var shr = li.querySelector('[data-role="share"]');
      var ren = li.querySelector('[data-role="rename"]');
      var del = li.querySelector('[data-role="delete"]');
      li.querySelector(".saved-name").textContent = w.name;
      li.querySelector(".saved-sum").textContent = summaryOf(w.cfg);
      open.setAttribute("aria-label", "Open " + w.name);
      shr.setAttribute("aria-label", "Share " + w.name);
      ren.setAttribute("aria-label", "Rename " + w.name);
      del.setAttribute("aria-label", "Delete " + w.name);
      open.addEventListener("click", function () { openSaved(w.id); });
      shr.addEventListener("click", function () { shareWorkout(w.name, w.cfg); });
      ren.addEventListener("click", function () { openNameDialog("rename", w.name, w.id); });
      del.addEventListener("click", function () { deleteId = w.id; openConfirm("delete"); });
      list.appendChild(li);
    });
    renderPresets(q);
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

  function renderPresets(q) {
    var list = $("preset-list");
    list.textContent = "";
    var items = Presets.search(WorkoutStore.fold, q);
    items.forEach(function (pr) {
      var li = document.createElement("li");
      li.innerHTML = '<button type="button" class="saved-open"><span class="saved-name"></span><span class="saved-sum"></span></button>';
      var open = li.querySelector(".saved-open");
      li.querySelector(".saved-name").textContent = pr.name;
      li.querySelector(".saved-sum").textContent = summaryOf(pr.cfg);
      open.setAttribute("aria-label", "Open " + pr.name);
      open.addEventListener("click", function () { openPreset(pr.id); });
      list.appendChild(li);
    });
    setHidden($("preset-title"), !items.length);
    setHidden(list, !items.length);
  }

  /** Opens a ready-made workout in the setup. It is a copy: changing it never changes the preset. */
  function openPreset(id) {
    var pr = Presets.get(id);
    if (!pr) return;
    Object.assign(cfg, Plan.normalizeCfg(pr.cfg));
    loadedId = null;
    presetName = pr.name;
    Settings.saveSetup(cfg);
    refreshSetup();
    Nav.show("setup");
  }

  // ---------------------------------------------------------------- share by link
  var toastTimer = 0;
  function toast(msg, ms) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3500);
  }
  function closeShareDialog() { $("share-dialog").hidden = true; }
  function showShareDialog(url) {
    var input = $("share-url");
    input.value = url;
    $("share-dialog").hidden = false;
    input.focus(); input.select();
  }
  function copyOrShow(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast("Link copied"); }, function () { showShareDialog(url); });
    } else showShareDialog(url);
  }
  /** Opens the phone's share sheet when there is one, otherwise copies the link. */
  function shareWorkout(name, c) {
    var url = Share.makeUrl(location.href, Share.encode(Plan, name, c));
    var title = name ? "TabatAle: " + name : "TabatAle workout";
    if (navigator.share) {
      navigator.share({ title: title, text: title, url: url }).catch(function (e) {
        if (e && e.name === "AbortError") return; // the person closed the share sheet
        copyOrShow(url);
      });
      return;
    }
    copyOrShow(url);
  }
  /** A link with a shared workout was opened: fill in the setup (nothing starts by itself). */
  function handleSharedHash() {
    if (!Share.hasShared(location.hash)) return;
    var shared = Share.decode(Plan, location.hash);
    try { history.replaceState(history.state, "", location.pathname + location.search); } catch (e) { /* ignore */ }
    if (Nav.current() === "run" || !$("picker").hidden) return;
    if (!shared) { toast("This link does not contain a valid workout.", 5000); return; }
    Object.assign(cfg, shared.cfg);
    loadedId = null;
    presetName = shared.name;
    Settings.saveSetup(cfg);
    refreshSetup();
    Nav.show("setup");
    toast("Shared workout loaded" + (shared.name ? ": " + shared.name : "") + ". Press Save to keep it.", 6000);
  }

  // ---------------------------------------------------------------- history
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function whenText(t) {
    var d = new Date(t);
    var today = HistoryStore.dayKey(new Date(now()));
    var yest = HistoryStore.dayKey(new Date(now() - 86400000));
    var key = HistoryStore.dayKey(d);
    var hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    if (key === today) return "Today, " + hm;
    if (key === yest) return "Yesterday, " + hm;
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + ", " + hm;
  }
  function streakText(n) { return n + (n === 1 ? " day" : " days"); }
  function renderStreakCounts() {
    setText($("home-streak"), streakText(histStore.streak()));
  }
  function renderHistory() {
    var n = histStore.streak();
    setText($("history-streak"), String(n));
    setText($("history-streak-label"), n === 1 ? "day in a row" : "days in a row");
    var week = $("history-week");
    week.textContent = "";
    histStore.week().forEach(function (d) {
      var li = document.createElement("li");
      li.className = (d.done ? "done " : "") + (d.today ? "today" : "");
      li.innerHTML = '<span class="dot"></span><span></span>';
      li.children[1].textContent = d.label;
      li.setAttribute("aria-label", (d.today ? "Today" : d.key) + (d.done ? ": trained" : ": no workout"));
      week.appendChild(li);
    });
    var list = $("history-list");
    list.textContent = "";
    var items = histStore.list();
    items.forEach(function (e) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="history-main"><span class="saved-name"></span><span class="history-when"></span></span><span class="saved-sum"></span>';
      li.querySelector(".saved-name").textContent = e.name || "Custom workout";
      li.querySelector(".history-when").textContent = whenText(e.t);
      li.querySelector(".saved-sum").textContent = Plan.formatClock(e.total) + " · " + shapeText({ rounds: e.rounds, loops: e.loops, blocks: e.blocks || 1, totalRounds: e.totalRounds, kind: e.kind });
      if (e.results && e.results.length) {
        var res = document.createElement("span");
        res.className = "history-res";
        res.textContent = e.results.join(" \u00b7 ");
        li.querySelector(".history-main").appendChild(res);
      }
      list.appendChild(li);
    });
    setHidden($("history-empty"), items.length > 0);
    setHidden(list, !items.length);
  }

  /** Opens a saved workout in the setup, ready for START. */
  function openSaved(id) {
    var w = store.get(id);
    if (!w) return;
    Object.assign(cfg, Plan.normalizeCfg(w.cfg));
    loadedId = id;
    presetName = "";
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
    if (!$("share-dialog").hidden) { closeShareDialog(); return; }
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
      case "history":
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
    "share-setup": function () {
      if (!Plan.validate(cfg).ok) { toast("Fix the values in red first."); return; }
      var w = loadedId ? store.get(loadedId) : null;
      shareWorkout(w ? w.name : presetName, cfg);
    },
    "share-copy": function () {
      var input = $("share-url");
      input.focus(); input.select();
      var done = function () { toast("Link copied"); closeShareDialog(); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(done, function () { /* select it by hand */ });
      else { try { if (document.execCommand("copy")) done(); } catch (e) { /* select it by hand */ } }
    },
    "share-close": function () { closeShareDialog(); },
    "amrap-plus": function () {
      var ph = amrapPhase();
      if (!ph || runner.paused) return;
      runInfo.amrap[ph.block] = (runInfo.amrap[ph.block] || 0) + 1;
      try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) { /* not supported */ }
      tick();
    },
    "amrap-minus": function () {
      var ph = amrapPhase();
      if (!ph || runner.paused) return;
      runInfo.amrap[ph.block] = Math.max(0, (runInfo.amrap[ph.block] || 0) - 1);
      tick();
    },
    "go-history": function () { renderHistory(); Nav.show("history"); },
    "go-saved": function () { $("saved-search").value = ""; renderSaved(); Nav.show("saved"); },
    "save-workout": function () {
      if (!Plan.validate(cfg).ok) return;
      var w = loadedId ? store.get(loadedId) : null;
      openNameDialog("save", w ? w.name : presetName);
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
      renderStreakCounts();
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
  renderStreakCounts();
  Nav.init(handleBack);
  Nav.show("home");
  handleSharedHash();
  window.addEventListener("hashchange", handleSharedHash);
  Sound.preload();

  var swReg = null, updateReady = false;
  function reloadIfIdle() {
    // only on the home screen, so nothing in progress (workout, stopwatch, a name being typed) is lost
    if (!updateReady || Nav.current() !== "home" || document.querySelector(".overlay:not([hidden])")) return;
    updateReady = false;
    location.reload();
  }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").then(function (reg) {
        swReg = reg;
      }).catch(function () { /* offline mode not available */ });
    });
    // a new version took over: reload to use it as soon as the home screen is showing
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController) { hadController = true; return; } // first install, nothing to reload
      updateReady = true;
      reloadIfIdle();
    });
    Nav.onChange(function () { reloadIfIdle(); });
    // phones keep a home-screen app alive for days: look for a new version each time it comes back
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && swReg) { try { swReg.update(); } catch (e) { /* ignore */ } }
    });
  }
})();
