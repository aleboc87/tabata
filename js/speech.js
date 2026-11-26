/*
 * TabatAle - Spoken exercise names
 * Uses the voice already built into the phone (speechSynthesis), so any name works, in any language,
 * also offline. It speaks a moment after the recorded clips ("Let's GO", "Rest") so they do not overlap.
 * If the phone has no voice, nothing happens.
 */
(function (root) {
  "use strict";

  var timer = 0;

  function synth() {
    try { return root.speechSynthesis && root.SpeechSynthesisUtterance ? root.speechSynthesis : null; } catch (e) { return null; }
  }

  function utter(text, lang) {
    var u = new root.SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    u.rate = 1;
    return u;
  }

  /** Call from a tap (START): some phones only allow speech after one. */
  function unlock() {
    var s = synth();
    if (!s) return;
    try {
      var u = utter(" ");
      u.volume = 0;
      s.speak(u);
    } catch (e) { /* ignore */ }
  }

  /** Says the name after delay ms; with next, "Next" comes first, in English like the rest of the app. */
  function say(text, next, delay) {
    var s = synth();
    if (!s || !text) return;
    cancel();
    timer = setTimeout(function () {
      timer = 0;
      try {
        if (next) s.speak(utter("Next", "en-US"));
        s.speak(utter(text)); // the name keeps the phone's own language
      } catch (e) { /* ignore */ }
    }, delay || 0);
  }

  function cancel() {
    if (timer) { clearTimeout(timer); timer = 0; }
    var s = synth();
    if (s) { try { s.cancel(); } catch (e) { /* ignore */ } }
  }

  root.Speech = { unlock: unlock, say: say, cancel: cancel };
})(this);
