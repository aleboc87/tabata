/*
 * TabatAle - Workout history
 * Remembers every completed workout (last 50) and the days you trained (last 400),
 * and counts the days in a row. Kept on this device only.
 * The store takes a storage object and a clock (a fake one in tests).
 */
(function (root) {
  "use strict";

  var KEY = "tabatale.history.v1";
  var MAX_ENTRIES = 50;
  var MAX_DAYS = 400;
  var WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  /** Local calendar day as "YYYY-MM-DD". */
  function dayKey(date) { return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()); }
  /** The day before/after, safe across clock changes (works at noon). */
  function shiftDay(date, delta) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta, 12, 0, 0);
    return d;
  }

  /** Results of AMRAP blocks, e.g. ["Burpees: 7 rounds"]: short plain texts only. */
  function cleanResults(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (r) { return typeof r === "string"; }).slice(0, 10).map(function (r) { return r.slice(0, 60); });
  }

  function HistoryStore(storage, clock) {
    this.storage = storage;
    this.clock = clock || function () { return Date.now(); };
    var data = this._read();
    this.entries = data.entries;
    this.days = data.days;
  }

  HistoryStore.prototype._read = function () {
    var empty = { entries: [], days: [] };
    try {
      var raw = this.storage && this.storage.getItem(KEY);
      var d = raw ? JSON.parse(raw) : null;
      if (!d || !Array.isArray(d.entries) || !Array.isArray(d.days)) return empty;
      return {
        entries: d.entries.filter(function (e) { return e && typeof e.t === "number"; }).slice(0, MAX_ENTRIES),
        days: d.days.filter(function (k) { return typeof k === "string"; }).slice(-MAX_DAYS)
      };
    } catch (e) { return empty; }
  };

  HistoryStore.prototype._write = function () {
    try { if (this.storage) this.storage.setItem(KEY, JSON.stringify({ entries: this.entries, days: this.days })); }
    catch (e) { /* storage full or blocked: the app keeps working */ }
  };

  /** Records a completed workout: { name, total (seconds), rounds, loops }. */
  HistoryStore.prototype.add = function (info) {
    var t = this.clock();
    this.entries.unshift({ t: t, name: info.name || "", total: info.total, rounds: info.rounds, loops: info.loops, blocks: info.blocks || 1, totalRounds: info.totalRounds || info.rounds * info.loops, kind: info.kind || "", results: cleanResults(info.results) });
    this.entries = this.entries.slice(0, MAX_ENTRIES);
    var key = dayKey(new Date(t));
    if (this.days.indexOf(key) < 0) {
      this.days.push(key);
      this.days.sort();
      this.days = this.days.slice(-MAX_DAYS);
    }
    this._write();
  };

  HistoryStore.prototype.list = function () { return this.entries.slice(); };
  HistoryStore.prototype.count = function () { return this.entries.length; };

  /**
   * Days in a row. Today counts if you already trained; if not, the streak that ended yesterday
   * is still alive until the end of today.
   */
  HistoryStore.prototype.streak = function () {
    var set = {};
    this.days.forEach(function (k) { set[k] = true; });
    var d = new Date(this.clock());
    if (!set[dayKey(d)]) d = shiftDay(d, -1);
    var n = 0;
    while (set[dayKey(d)]) { n++; d = shiftDay(d, -1); }
    return n;
  };

  /** The last 7 days, oldest first: [{ key, label, done, today }]. */
  HistoryStore.prototype.week = function () {
    var set = {};
    this.days.forEach(function (k) { set[k] = true; });
    var today = new Date(this.clock());
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var d = shiftDay(today, -i);
      var key = dayKey(d);
      out.push({ key: key, label: WEEKDAYS[d.getDay()], done: !!set[key], today: i === 0 });
    }
    return out;
  };

  HistoryStore.dayKey = dayKey;
  HistoryStore.MAX_ENTRIES = MAX_ENTRIES;

  if (typeof module !== "undefined" && module.exports) module.exports = HistoryStore;
  else root.HistoryStore = HistoryStore;
})(this);
