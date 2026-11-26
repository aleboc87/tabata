/*
 * TabatAle - Settings memory
 * Remembers the last Tabata setup and the mute choice on this device only.
 * If the browser blocks storage (private mode), the app simply starts from the defaults.
 */
(function (root) {
  "use strict";

  var KEY = "tabatale.settings.v1";
  var MUTE_KEY = "tabatale.muted.v1";

  function read(key) {
    try { return root.localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { root.localStorage.setItem(key, value); } catch (e) { /* storage not available */ }
  }

  /** The saved setup merged over the defaults; values stay as typed (strings) for the form. */
  function loadSetup(defaults) {
    var cfg = {};
    Object.keys(defaults).forEach(function (k) {
      cfg[k] = typeof defaults[k] === "boolean" ? defaults[k] : String(defaults[k]);
    });
    var raw = read(KEY);
    if (!raw) return cfg;
    try {
      var saved = JSON.parse(raw);
      Object.keys(cfg).forEach(function (k) {
        if (!(k in saved)) return;
        if (typeof cfg[k] === "boolean") cfg[k] = !!saved[k];
        else if (/^\d{1,4}$/.test(String(saved[k]))) cfg[k] = String(saved[k]);
      });
    } catch (e) { /* damaged data: use the defaults */ }
    return cfg;
  }

  function saveSetup(cfg) {
    write(KEY, JSON.stringify(cfg));
  }

  function loadMuted() {
    return read(MUTE_KEY) === "1";
  }

  function saveMuted(m) {
    write(MUTE_KEY, m ? "1" : "0");
  }

  root.Settings = { loadSetup: loadSetup, saveSetup: saveSetup, loadMuted: loadMuted, saveMuted: saveMuted };
})(this);
