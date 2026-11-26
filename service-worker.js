/*
 * TabatAle - Offline support
 * On first visit, copies every file of the app to the device. Afterwards the app
 * opens from that copy, also without internet. A new version (new VERSION below)
 * is downloaded in the background and used the next time the app is opened.
 */
var VERSION = "tabatale-v1.2.0";
var FILES = [
  "./",
  "index.html",
  "styles.css",
  "manifest.json",
  "js/tabata-plan.js",
  "js/tabata-runner.js",
  "js/stopwatch.js",
  "js/progress-bar.js",
  "js/sound.js",
  "js/settings.js",
  "js/workouts.js",
  "js/time-picker.js",
  "js/navigation.js",
  "js/app.js",
  "audio/go.mp3",
  "audio/rest.mp3",
  "audio/done.mp3",
  "fonts/inter-latin-400-normal.woff2",
  "fonts/inter-latin-500-normal.woff2",
  "fonts/inter-latin-600-normal.woff2",
  "fonts/inter-latin-700-normal.woff2",
  "fonts/space-grotesk-latin-500-normal.woff2",
  "fonts/space-grotesk-latin-600-normal.woff2",
  "fonts/space-grotesk-latin-700-normal.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) { return cache.addAll(FILES); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(function (cache) {
      var lookup = req.mode === "navigate" ? cache.match("index.html") : cache.match(req, { ignoreSearch: true });
      return lookup.then(function (hit) {
        return hit || fetch(req);
      });
    })
  );
});
