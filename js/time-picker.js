/*
 * TabatAle - Time picker
 * A bottom sheet with two scroll wheels (minutes and seconds 0-59), like a phone's timer.
 * Scroll (or drag) each wheel, then press Set. Arrow keys work too on a computer.
 */
(function (root) {
  "use strict";

  var ITEM = 44;            // height of one row in px (must match .wheel-item in styles.css)
  var $ = function (id) { return document.getElementById(id); };
  var current = null;       // { min, max, onSet }
  var wheels = {};

  function pad2(n) { return String(n).padStart(2, "0"); }
  function clock(s) { return Math.floor(s / 60) + ":" + pad2(s % 60); }

  function Wheel(el, count, format, onChange) {
    this.el = el;
    this.count = count;
    this.onChange = onChange;
    var self = this, timer = 0;
    el.textContent = "";
    var top = document.createElement("div");
    top.className = "wheel-pad";
    el.appendChild(top);
    for (var i = 0; i < count; i++) {
      var item = document.createElement("div");
      item.className = "wheel-item num";
      item.textContent = format(i);
      item.setAttribute("data-v", i);
      el.appendChild(item);
    }
    var bottom = document.createElement("div");
    bottom.className = "wheel-pad";
    el.appendChild(bottom);
    el.onscroll = function () {
      clearTimeout(timer);
      timer = setTimeout(function () { self._changed(); }, 60);
    };
    el.onclick = function (e) {
      var v = e.target && e.target.getAttribute && e.target.getAttribute("data-v");
      if (v !== null && v !== undefined) self.set(Number(v), true);
    };
    el.onkeydown = function (e) {
      if (e.key === "ArrowUp") { e.preventDefault(); self.set(self.value() - 1, true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); self.set(self.value() + 1, true); }
      else if (e.key === "PageUp") { e.preventDefault(); self.set(self.value() - 10, true); }
      else if (e.key === "PageDown") { e.preventDefault(); self.set(self.value() + 10, true); }
    };
  }
  Wheel.prototype.value = function () {
    return Math.max(0, Math.min(this.count - 1, Math.round(this.el.scrollTop / ITEM)));
  };
  Wheel.prototype.set = function (v, smooth) {
    v = Math.max(0, Math.min(this.count - 1, v));
    try { this.el.scrollTo({ top: v * ITEM, behavior: smooth ? "smooth" : "auto" }); }
    catch (e) { this.el.scrollTop = v * ITEM; }
    if (!smooth) this._changed();
  };
  Wheel.prototype._changed = function () {
    var v = this.value();
    this.el.setAttribute("aria-valuenow", v);
    var items = this.el.querySelectorAll(".wheel-item");
    for (var i = 0; i < items.length; i++) items[i].classList.toggle("is-sel", i === v);
    if (this.onChange) this.onChange(v);
  };

  function total() {
    return wheels.min.value() * 60 + wheels.sec.value();
  }

  function refresh() {
    if (!current) return;
    var t = total();
    var hint = $("picker-hint");
    var setBtn = $("picker-set");
    if (t < current.min) {
      hint.textContent = "Minimum " + clock(current.min);
      hint.classList.add("is-bad");
      setBtn.disabled = true;
    } else if (t > current.max) {
      hint.textContent = "Maximum " + clock(current.max);
      hint.classList.add("is-bad");
      setBtn.disabled = true;
    } else {
      hint.textContent = t + " seconds";
      hint.classList.remove("is-bad");
      setBtn.disabled = false;
    }
  }

  function open(opts) {
    current = opts;
    $("picker-title").textContent = opts.label;
    var maxMin = Math.floor(opts.max / 60);
    var minEl = $("wheel-min"), secEl = $("wheel-sec");
    minEl.setAttribute("aria-valuemax", maxMin);
    secEl.setAttribute("aria-valuemax", 59);
    wheels.min = new Wheel(minEl, maxMin + 1, String, refresh);
    wheels.sec = new Wheel(secEl, 60, pad2, refresh);
    $("picker").hidden = false;
    var v = Math.max(opts.min, Math.min(opts.max, opts.value || 0));
    wheels.min.set(Math.floor(v / 60), false);
    wheels.sec.set(v % 60, false);
    refresh();
    secEl.focus({ preventScroll: true });
  }

  function close() {
    var was = current;
    current = null;
    $("picker").hidden = true;
    if (was && was.returnFocus) { try { was.returnFocus.focus(); } catch (e) { /* ignore */ } }
  }

  function init() {
    $("picker-cancel").addEventListener("click", close);
    $("picker-set").addEventListener("click", function () {
      if (!current) return;
      var t = total();
      if (t < current.min || t > current.max) return;
      var fn = current.onSet;
      close();
      fn(t);
    });
    $("picker").addEventListener("click", function (e) {
      if (e.target === $("picker")) close(); // tap outside the sheet
    });
  }

  root.TimePicker = {
    init: init,
    open: open,
    close: close,
    isOpen: function () { return !!current; },
    format: clock
  };
})(this);
