/*
 * TabatAle - Stopwatch
 * Uses the real clock: it stores when it was started, so it never drifts.
 * Every method takes "now" in milliseconds (Date.now()).
 */
(function (root) {
  "use strict";

  function Stopwatch() {
    this.reset();
  }

  Stopwatch.prototype.reset = function () {
    this.base = 0;        // time collected before the last start
    this.startedAt = null; // null = not running
    this.laps = [];       // total time at each LAP press
  };

  Stopwatch.prototype.isRunning = function () {
    return this.startedAt !== null;
  };

  Stopwatch.prototype.elapsed = function (now) {
    return this.base + (this.startedAt !== null ? now - this.startedAt : 0);
  };

  Stopwatch.prototype.start = function (now) {
    if (this.startedAt === null) this.startedAt = now;
  };

  Stopwatch.prototype.stop = function (now) {
    if (this.startedAt === null) return;
    this.base += now - this.startedAt;
    this.startedAt = null;
  };

  Stopwatch.prototype.lap = function (now) {
    if (this.startedAt === null) return;
    this.laps.push(this.elapsed(now));
  };

  /**
   * Rows for the lap list, most recent first. While laps exist, the lap in progress is
   * the top row. With 2 or more finished laps, the fastest is "best" and the slowest "worst".
   */
  Stopwatch.prototype.lapRows = function (now) {
    var laps = this.laps;
    if (!laps.length) return [];
    var el = this.elapsed(now);
    var durs = laps.map(function (t, i) { return t - (i ? laps[i - 1] : 0); });
    var best = durs.length > 1 ? Math.min.apply(null, durs) : -1;
    var worst = durs.length > 1 ? Math.max.apply(null, durs) : -1;
    var rows = laps.map(function (t, i) {
      var d = durs[i];
      return { n: i + 1, lap: d, total: t, kind: d === best ? "best" : (d === worst ? "worst" : "") };
    });
    var last = laps[laps.length - 1];
    rows.push({ n: laps.length + 1, lap: Math.max(0, el - last), total: el, kind: "current" });
    return rows.reverse();
  };

  function pad2(n) { return String(n).padStart(2, "0"); }

  /** Splits ms into the big part ("mm:ss" or "h:mm:ss") and the tenths (",d"). */
  Stopwatch.formatParts = function (ms) {
    ms = Math.max(0, ms);
    var t = Math.floor(ms / 1000);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var main = h > 0 ? h + ":" + pad2(m) + ":" + pad2(s) : pad2(m) + ":" + pad2(s);
    return { main: main, tenths: "," + (Math.floor(ms / 100) % 10) };
  };

  /** mm:ss,d */
  Stopwatch.format = function (ms) {
    var p = Stopwatch.formatParts(ms);
    return p.main + p.tenths;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Stopwatch;
  else root.Stopwatch = Stopwatch;
})(this);
