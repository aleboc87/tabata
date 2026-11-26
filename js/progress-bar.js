/*
 * TabatAle - Progress bar and counters
 * Every phase is a segment of the SAME width, in its phase colour; a cursor moves
 * through the current segment; a white notch marks the start of each new loop.
 * With more than 40 segments the bar shows only the current loop, plus one dot per loop.
 */
(function (root) {
  "use strict";

  var MAX_SEGMENTS = 40;

  /**
   * Pure model of the bar. fraction = how much of the current phase has passed (0..1).
   * Returns { segments: [{ idx, type, past, notch }], cursor (0..1), dots: [state], compact }.
   */
  function barModel(phases, idx, fraction, loops) {
    var cur = phases[idx];
    var list = phases.map(function (p, k) { return { p: p, k: k }; });
    var compact = phases.length > MAX_SEGMENTS;
    if (compact) {
      if (cur.type === "prep" || cur.type === "cool") {
        list = [{ p: cur, k: idx }];
      } else {
        list = list.filter(function (o) {
          return o.p.loop === cur.loop && o.p.type !== "prep" && o.p.type !== "cool";
        });
      }
    }
    var before = 0;
    var segments = list.map(function (o, j) {
      if (o.k < idx) before++;
      var prev = j > 0 ? list[j - 1].p : null;
      return {
        idx: o.k,
        type: o.p.type,
        past: o.k < idx,
        notch: !!(prev && prev.loop !== o.p.loop && o.p.type === "work")
      };
    });
    var f = Math.min(1, Math.max(0, fraction));
    var cursor = Math.min(1, (before + f) / list.length);
    var dots = [];
    if (compact) {
      for (var d = 1; d <= loops; d++) {
        var finished = d < cur.loop || (d === cur.loop && (cur.type === "between" || cur.type === "cool"));
        dots.push(finished ? "done" : (d === cur.loop ? "current" : "todo"));
      }
    }
    return { segments: segments, cursor: cursor, dots: dots, compact: compact };
  }

  /**
   * Counters shown under the bar, as "current / total":
   * loop (current loop / loops), workLoop (Work phases reached in this loop / Work phases in this loop),
   * workTotal (Work phases reached / Work phases in the whole workout).
   * Before the first Work (Get ready) the work counters show "–".
   */
  function counters(phases, idx, rounds, loops) {
    var p = phases[idx];
    var blocks = 1;
    phases.forEach(function (x) { if ((x.block || 1) > blocks) blocks = x.block; });
    var multi = blocks > 1;
    // with several blocks the middle counter follows the block; otherwise it follows the loop
    var group = function (x) { return multi ? (x.block || 1) : x.loop; };
    var inLoop = 0, inLoopDone = 0, total = 0, totalDone = 0;
    // the rest between two blocks belongs to the block that starts after it, but its Work is counted in that block
    for (var i = 0; i < phases.length; i++) {
      if (phases[i].type !== "work") continue;
      total++;
      if (i <= idx) totalDone++;
      if (group(phases[i]) === group(p)) {
        inLoop++;
        if (i <= idx) inLoopDone++;
      }
    }
    var before = p.type === "prep";
    return {
      loop: multi ? (p.block || 1) + "/" + blocks : p.loop + "/" + loops,
      workLoop: (before ? "\u2013" : inLoopDone) + "/" + inLoop,
      workTotal: (before ? "\u2013" : totalDone) + "/" + total,
      labels: multi ? { loop: "Block", workLoop: "Work \u00b7 block" } : { loop: "Loop", workLoop: "Work \u00b7 loop" }
    };
  }

  /** Draws the bar into a container; rebuilds the segments only when they change. */
  function ProgressBar(container, cursorEl, dotsEl) {
    this.container = container;
    this.cursorEl = cursorEl;
    this.dotsEl = dotsEl;
    this.key = null;
    this.dotsKey = null;
  }

  ProgressBar.prototype.render = function (model) {
    var key = model.segments.map(function (s) { return s.idx + (s.past ? "p" : "") + (s.notch ? "n" : ""); }).join(",");
    if (key !== this.key) {
      this.key = key;
      var frag = document.createDocumentFragment();
      var w = (100 / model.segments.length).toFixed(4) + "%";
      model.segments.forEach(function (s) {
        var el = document.createElement("div");
        el.className = "seg seg-" + s.type + (s.past ? " is-past" : "") + (s.notch ? " has-notch" : "");
        el.style.width = w;
        frag.appendChild(el);
      });
      this.container.textContent = "";
      this.container.appendChild(frag);
    }
    this.cursorEl.style.left = (model.cursor * 100).toFixed(2) + "%";
    var dotsKey = model.dots.join(",");
    if (dotsKey !== this.dotsKey) {
      this.dotsKey = dotsKey;
      this.dotsEl.hidden = model.dots.length === 0;
      this.dotsEl.textContent = "";
      var self = this;
      model.dots.forEach(function (d) {
        var dot = document.createElement("span");
        dot.className = "dot dot-" + d;
        self.dotsEl.appendChild(dot);
      });
    }
  };

  ProgressBar.prototype.reset = function () {
    this.key = null;
    this.dotsKey = null;
  };

  var api = { barModel: barModel, counters: counters, ProgressBar: ProgressBar, MAX_SEGMENTS: MAX_SEGMENTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TabataProgress = api;
})(this);
