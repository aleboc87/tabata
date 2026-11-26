/*
 * TabatAle - Share a workout by link
 * The workout (name + setup) is packed into the part of the address after "#", so the link
 * works without any server and nothing is sent anywhere. Opening a link only fills in the setup:
 * everything that comes from a link is cleaned and checked first.
 */
(function (root) {
  "use strict";

  var PARAM = "w=";
  var MAX_TOKEN = 3000;

  function toB64Url(text) {
    var b64;
    if (typeof Buffer !== "undefined") b64 = Buffer.from(text, "utf8").toString("base64");
    else b64 = root.btoa(unescape(encodeURIComponent(text)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromB64Url(token) {
    var b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf8");
    return decodeURIComponent(escape(root.atob(b64)));
  }

  /** The packed text for a workout. Plan is the TabataPlan module. */
  function encode(Plan, name, cfg) {
    var clean = Plan.normalizeCfg(cfg);
    return toB64Url(JSON.stringify({ v: 1, n: Plan.cleanName(name), c: clean }));
  }

  /** The address that opens the workout. */
  function makeUrl(base, token) {
    return String(base).replace(/#.*$/, "") + "#" + PARAM + token;
  }

  /** Reads "#w=..." from a hash. Returns { name, cfg } or null when it is missing, damaged or not a valid workout. */
  function decode(Plan, hash) {
    try {
      var h = String(hash || "").replace(/^#/, "");
      if (h.indexOf(PARAM) !== 0) return null;
      var token = h.slice(PARAM.length);
      if (!token || token.length > MAX_TOKEN || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
      var data = JSON.parse(fromB64Url(token));
      if (!data || typeof data !== "object" || data.v !== 1 || !data.c || typeof data.c !== "object") return null;
      var cfg = Plan.normalizeCfg(data.c);
      if (!Plan.validate(cfg).ok) return null;
      return { name: Plan.cleanName(data.n), cfg: cfg };
    } catch (e) { return null; }
  }

  /**
   * Reads what a person pastes: the whole link, a chat message that contains the link, or just the code.
   * Returns { name, cfg } or null.
   */
  function parseInput(Plan, text) {
    var t = String(text == null ? "" : text).trim();
    if (!t || t.length > 20000) return null;
    var m = /#w=([A-Za-z0-9_-]+)/.exec(t);
    var token = m ? m[1] : (/^[A-Za-z0-9_-]+$/.test(t) ? t : null);
    return token ? decode(Plan, "#" + PARAM + token) : null;
  }

  /** The code of a workout (the part after "#w="), for copying by hand. */
  function tokenOf(hash) {
    var h = String(hash || "").replace(/^#/, "");
    return h.indexOf(PARAM) === 0 ? h.slice(PARAM.length) : "";
  }

  /** True when the address carries a shared workout (even a broken one). */
  function hasShared(hash) { return String(hash || "").replace(/^#/, "").indexOf(PARAM) === 0; }

  var api = { encode: encode, decode: decode, makeUrl: makeUrl, hasShared: hasShared, parseInput: parseInput, tokenOf: tokenOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Share = api;
})(this);
