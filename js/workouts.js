/*
 * TabatAle - Saved workouts
 * Up to 10 Tabata setups, each with a name, kept on this device only.
 * The store takes a storage object (localStorage in the app, a fake one in tests).
 */
(function (root) {
  "use strict";

  var KEY = "tabatale.workouts.v1";
  var MAX = 10;
  var NAME_MAX = 30;

  /** Lower case, no accents, single spaces: used to compare and search names. */
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function cleanName(s) {
    return String(s || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  }

  function WorkoutStore(storage, clock) {
    this.storage = storage;
    this.clock = clock || function () { return Date.now(); };
    this.items = this._read();
  }

  WorkoutStore.prototype._read = function () {
    try {
      var raw = this.storage && this.storage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.filter(function (w) { return w && typeof w.id === "string" && typeof w.name === "string" && w.cfg; }).slice(0, MAX);
    } catch (e) { return []; }
  };

  WorkoutStore.prototype._write = function () {
    try { if (this.storage) this.storage.setItem(KEY, JSON.stringify(this.items)); return true; }
    catch (e) { return false; }
  };

  WorkoutStore.prototype.count = function () { return this.items.length; };
  WorkoutStore.prototype.isFull = function () { return this.items.length >= MAX; };

  WorkoutStore.prototype.get = function (id) {
    for (var i = 0; i < this.items.length; i++) if (this.items[i].id === id) return this.items[i];
    return null;
  };

  WorkoutStore.prototype.findByName = function (name) {
    var f = fold(name);
    for (var i = 0; i < this.items.length; i++) if (fold(this.items[i].name) === f) return this.items[i];
    return null;
  };

  /** Most recently used (or saved) first. */
  WorkoutStore.prototype.list = function () {
    return this.items.slice().sort(function (a, b) { return (b.usedAt || 0) - (a.usedAt || 0); });
  };

  /** Workouts whose name contains the text, ignoring case and accents. */
  WorkoutStore.prototype.search = function (text) {
    var q = fold(text);
    var all = this.list();
    if (!q) return all;
    return all.filter(function (w) { return fold(w.name).indexOf(q) >= 0; });
  };

  /**
   * Saves a setup under a name.
   * Returns { ok: true, workout } or { ok: false, error: "empty" | "exists" | "full", existing? }.
   * With replace: true, a workout with the same name is overwritten.
   */
  WorkoutStore.prototype.save = function (name, cfg, opts) {
    opts = opts || {};
    var n = cleanName(name);
    if (!n) return { ok: false, error: "empty" };
    var existing = this.findByName(n);
    var now = this.clock();
    if (existing) {
      if (!opts.replace) return { ok: false, error: "exists", existing: existing };
      existing.name = n;
      existing.cfg = JSON.parse(JSON.stringify(cfg));
      existing.usedAt = now;
      this._write();
      return { ok: true, workout: existing };
    }
    if (this.isFull()) return { ok: false, error: "full" };
    var w = {
      id: "w" + now.toString(36) + Math.random().toString(36).slice(2, 7),
      name: n,
      cfg: JSON.parse(JSON.stringify(cfg)),
      createdAt: now,
      usedAt: now
    };
    this.items.push(w);
    this._write();
    return { ok: true, workout: w };
  };

  /** Renames. Returns { ok } or { ok: false, error: "empty" | "exists" | "missing" }. */
  WorkoutStore.prototype.rename = function (id, name) {
    var w = this.get(id);
    if (!w) return { ok: false, error: "missing" };
    var n = cleanName(name);
    if (!n) return { ok: false, error: "empty" };
    var other = this.findByName(n);
    if (other && other.id !== id) return { ok: false, error: "exists", existing: other };
    w.name = n;
    this._write();
    return { ok: true, workout: w };
  };

  WorkoutStore.prototype.remove = function (id) {
    var before = this.items.length;
    this.items = this.items.filter(function (w) { return w.id !== id; });
    this._write();
    return this.items.length < before;
  };

  WorkoutStore.prototype.markUsed = function (id) {
    var w = this.get(id);
    if (!w) return;
    w.usedAt = this.clock();
    this._write();
  };

  WorkoutStore.MAX = MAX;
  WorkoutStore.NAME_MAX = NAME_MAX;
  WorkoutStore.fold = fold;

  if (typeof module !== "undefined" && module.exports) module.exports = WorkoutStore;
  else root.WorkoutStore = WorkoutStore;
})(this);
