# TabatAle tests

1. Logic (Node 18+): `node --test tests/unit.test.js`
2. Browser (Playwright + Chromium): serve the app folder (e.g. `python3 -m http.server 8123`), then
   `node tests/e2e.js http://localhost:8123/`
