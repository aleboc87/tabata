/*
 * TabatAle - Navigation
 * Shows one screen at a time and makes the phone's back button / back gesture
 * behave like the arrow or X on the screen (same confirmations).
 *
 * History trick: while a screen other than Home is open, the app keeps exactly one
 * extra entry in the browser history. The system back removes it; we then run the
 * same action as the on-screen arrow, and add the entry again if we stay.
 */
(function (root) {
  "use strict";

  var SCREENS = ["home", "stopwatch", "setup", "saved", "history", "run", "done"];
  var current = "home";
  var depth = 0;          // 1 while our extra history entry exists
  var ignorePop = false;  // true while we remove the entry ourselves
  var onBack = null;
  var listeners = [];

  function el(name) { return document.getElementById("screen-" + name); }

  function push() {
    try { history.pushState({ tabatale: "screen" }, ""); depth = 1; } catch (e) { /* ignore */ }
  }

  function show(name) {
    if (SCREENS.indexOf(name) < 0) return;
    SCREENS.forEach(function (s) { el(s).hidden = s !== name; });
    var prev = current;
    current = name;
    if (name === "home" && depth === 1) {
      ignorePop = true;
      depth = 0;
      history.back();
    } else if (name !== "home" && depth === 0) {
      push();
    }
    var title = el(name).querySelector("h1");
    if (title && prev !== name) {
      title.setAttribute("tabindex", "-1");
      try { title.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    listeners.forEach(function (fn) { fn(name, prev); });
  }

  function init(backHandler) {
    onBack = backHandler;
    try { history.replaceState({ tabatale: "base" }, ""); } catch (e) { /* ignore */ }
    root.addEventListener("popstate", function () {
      if (ignorePop) { ignorePop = false; return; }
      depth = 0;
      if (onBack) onBack(current, "system");
      if (current !== "home" && depth === 0) push();
    });
  }

  root.Nav = {
    init: init,
    show: show,
    current: function () { return current; },
    onChange: function (fn) { listeners.push(fn); }
  };
})(this);
