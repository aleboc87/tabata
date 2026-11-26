/*
 * TabatAle - Tabata runner
 * Walks through the phase list using the real clock: it remembers when the
 * current phase started and computes the time left from "now", so the timer
 * never drifts and catches up after the phone was in the background.
 * Every method takes "now" in milliseconds (Date.now()), which makes it testable.
 */
(function (root) {
  "use strict";

  var BACK_THRESHOLD_MS = 2000; // "back" goes to the previous phase if the current one started less than 2 s ago

  function TabataRunner(phases) {
    if (!phases || !phases.length) throw new Error("A workout needs at least one phase");
    this.phases = phases;
    this.idx = 0;
    this.phaseStartAt = 0;
    this.paused = false;
    this.pausedAt = 0;
    this.done = false;
    this.started = false;
    this.jumps = 0; // grows on every start, pause, resume, skip and back
  }

  TabataRunner.prototype.start = function (now) {
    this.idx = 0;
    this.phaseStartAt = now;
    this.paused = false;
    this.done = false;
    this.started = true;
    this.jumps++;
  };

  /** The moment used for calculations: frozen while paused. */
  TabataRunner.prototype._clock = function (now) {
    return this.paused ? this.pausedAt : now;
  };

  /**
   * Moves forward through every phase that has ended by "now".
   * Returns the list of events: { type: "phase", idx } and finally { type: "done" }.
   */
  TabataRunner.prototype.update = function (now) {
    var events = [];
    if (!this.started || this.paused || this.done) return events;
    while (now - this.phaseStartAt >= this.phases[this.idx].dur * 1000) {
      this.phaseStartAt += this.phases[this.idx].dur * 1000;
      this.idx++;
      if (this.idx >= this.phases.length) {
        this.idx = this.phases.length - 1;
        this.done = true;
        events.push({ type: "done" });
        break;
      }
      events.push({ type: "phase", idx: this.idx });
    }
    return events;
  };

  TabataRunner.prototype.current = function () {
    return this.phases[this.idx];
  };

  TabataRunner.prototype.next = function () {
    return this.phases[this.idx + 1] || null;
  };

  TabataRunner.prototype.elapsedInPhaseMs = function (now) {
    if (this.done) return this.current().dur * 1000;
    return Math.max(0, this._clock(now) - this.phaseStartAt);
  };

  TabataRunner.prototype.remainingInPhaseMs = function (now) {
    if (this.done) return 0;
    return Math.max(0, this.current().dur * 1000 - this.elapsedInPhaseMs(now));
  };

  TabataRunner.prototype.remainingTotalMs = function (now) {
    var later = 0;
    for (var i = this.idx + 1; i < this.phases.length; i++) later += this.phases[i].dur * 1000;
    return this.remainingInPhaseMs(now) + later;
  };

  /** Wall-clock time (ms) at which phase i starts, assuming no pause from now on. */
  TabataRunner.prototype.phaseStartTime = function (i, now) {
    var t = this.phaseStartAt + (this.paused ? now - this.pausedAt : 0);
    if (i >= this.idx) {
      for (var k = this.idx; k < i; k++) t += this.phases[k].dur * 1000;
    } else {
      for (var j = i; j < this.idx; j++) t -= this.phases[j].dur * 1000;
    }
    return t;
  };

  TabataRunner.prototype.pause = function (now) {
    if (this.paused || this.done) return;
    this.update(now);
    if (this.done) return;
    this.paused = true;
    this.pausedAt = now;
    this.jumps++;
  };

  TabataRunner.prototype.resume = function (now) {
    if (!this.paused) return;
    this.phaseStartAt += now - this.pausedAt;
    this.paused = false;
    this.jumps++;
  };

  /** Jumps to the start of the next phase. Returns false when there is none (the workout is done). */
  TabataRunner.prototype.skip = function (now) {
    if (this.done) return false;
    this.update(now);
    if (this.done) return false;
    if (this.idx + 1 >= this.phases.length) {
      this.done = true;
      this.jumps++;
      return false;
    }
    this.idx++;
    this.phaseStartAt = this._clock(now);
    this.jumps++;
    return true;
  };

  TabataRunner.prototype.canGoBack = function (now) {
    return !(this.idx === 0 && this.elapsedInPhaseMs(now) < BACK_THRESHOLD_MS);
  };

  /** Back to the start of this phase, or to the previous phase if this one started less than 2 s ago. */
  TabataRunner.prototype.back = function (now) {
    if (this.done) return;
    this.update(now);
    if (this.done) return;
    if (this.elapsedInPhaseMs(now) < BACK_THRESHOLD_MS && this.idx > 0) this.idx--;
    this.phaseStartAt = this._clock(now);
    this.jumps++;
  };

  TabataRunner.BACK_THRESHOLD_MS = BACK_THRESHOLD_MS;

  if (typeof module !== "undefined" && module.exports) module.exports = TabataRunner;
  else root.TabataRunner = TabataRunner;
})(this);
