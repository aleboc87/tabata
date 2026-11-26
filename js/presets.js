/*
 * TabatAle - Ready-made workouts
 * Fixed setups the user can open, change and save under their own name.
 * They do not count toward the 10 saved workouts.
 */
(function (root) {
  "use strict";

  function make(name, over) {
    var base = { prep: true, prepDur: 10, work: 20, rest: 10, rounds: 8, loops: 1, between: 60, cool: false, coolDur: 120 };
    Object.keys(over).forEach(function (k) { base[k] = over[k]; });
    return { id: "preset-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: name, cfg: base };
  }

  var PRESETS = [
    make("Classic Tabata", {}),
    make("Beginner", { work: 20, rest: 40, rounds: 6 }),
    make("HIIT 30/30", { work: 30, rest: 30, rounds: 10 }),
    make("Endurance", { work: 40, rest: 20, rounds: 8 }),
    make("Core blast", { work: 45, rest: 15, rounds: 6, cool: true, coolDur: 60 })
  ];

  var API = {
    list: function () { return PRESETS.slice(); },
    get: function (id) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i]; return null; },
    search: function (fold, text) {
      var q = fold(text);
      if (!q) return PRESETS.slice();
      return PRESETS.filter(function (p) { return fold(p.name).indexOf(q) >= 0; });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Presets = API;
})(this);
