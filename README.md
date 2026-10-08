# Solo combo col gigante — Royale Arena 1v1

Gioca nel browser contro un bot di Clash Royale allenato con il machine learning:
**https://topacciobil.github.io/solo-combo-col-gigante/**

- Tu sei il blu, il bot il rosso. Mazzo per entrambi: Hog 2.6 (Hog Rider, Musketeer, Cannon, Ice Golem,
  Ice Spirit, Skeletons, Fireball, The Log). Tutte le carte a livello 11.
- Il bot ha prima **copiato migliaia di partite umane** (imitation learning sul dataset pubblico IL_Replay)
  e poi si è **migliorato giocando** (PPO con una penalità che lo tiene vicino alla copia).

## Come funziona

Niente server: tutto gira nel tuo browser.

| Pezzo | Cosa usa |
|---|---|
| Motore di battaglia | [RoyaleSim](https://github.com/RoyaleGym/RoyaleSim) (Rust, MIT), compilato in WebAssembly per Pyodide dal workflow `.github/workflows/pages.yml`, allo stesso commit su cui è stato allenato il bot |
| Ambiente (cosa vede il bot, mosse legali) | [RoyaleGym](https://github.com/RoyaleGym/RoyaleGym) 0.1.19, codice Python originale eseguito con [Pyodide](https://pyodide.org) |
| Bot | rete esportata in ONNX ed eseguita con onnxruntime-web; campionamento identico a RoyaleLearn |
| Grafica | canvas 2D, solo forme e simboli |

Il motore è intero e deterministico, quindi nel browser le battaglie sono identiche a quelle in Python.

## Avvertenze

Progetto amatoriale, **non affiliato né approvato da Supercell**. Non contiene asset del gioco e non
interagisce in alcun modo con il gioco vero o con i suoi server. Il motore non è identico al gioco reale
(vedi [How accurate is the engine](https://royalegym.github.io/RoyaleGym/accuracy/)).

## Licenze

Codice di questo repo: MIT. Motore e framework: RoyaleGym contributors, MIT.
