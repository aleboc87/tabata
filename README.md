# TabatAle

Timer gratuito per allenamenti Tabata e cronometro. È una PWA: funziona nel browser, si installa sul telefono e va anche offline.

- Usala: https://aleboc87.github.io/tabatale/
- Codice: HTML, CSS e JavaScript semplici, senza librerie né passaggi di compilazione.

## Struttura

| File | Cosa fa |
| --- | --- |
| `index.html` | Le schermate (Home, Stopwatch, Set up Tabata, Saved workouts, Workout, Workout complete) |
| `styles.css` | Aspetto (palette Oceano) |
| `js/tabata-plan.js` | Impostazioni → elenco delle fasi e tempo totale |
| `js/tabata-runner.js` | Scorrimento delle fasi con l'orologio reale, pausa, avanti, indietro |
| `js/stopwatch.js` | Cronometro con LAP |
| `js/progress-bar.js` | Barra delle fasi e contatori |
| `js/sound.js` | Bip e voce |
| `js/time-picker.js` | Rotella minuti/secondi |
| `js/settings.js`, `js/workouts.js` | Ultime impostazioni e allenamenti salvati (solo sul dispositivo) |
| `js/navigation.js`, `js/app.js` | Navigazione e collegamento di tutto |
| `service-worker.js` | Funzionamento offline |

## Test

Vedi `tests/README.md`: `node --test tests/unit.test.js` e `node tests/e2e.js <indirizzo>`.

## Pubblicare una nuova versione

1. Modifica i file e aumenta `VERSION` in `service-worker.js` (es. `tabatale-v1.1.1`).
2. Fai il push su `main`: GitHub Pages pubblica in 1-2 minuti.
3. I telefoni vedono la nuova versione alla seconda apertura dell'app.

Voce generata con Kokoro TTS (Apache 2.0). Font Inter e Space Grotesk (SIL Open Font License, vedi `fonts/`).
