# Prompt: "Royale Arena" 2.5D — versione definitiva

## 0. Obiettivo e limite non negoziabile
Trasforma il sito `topacciobil.github.io/solo-combo-col-gigante` (oggi canvas 2D a forme) in un gioco **2.5D**
che dia la stessa sensazione di una partita di Clash Royale: arena verticale vista dall'alto e inclinata,
modelli 3D animati, incantesimi con effetti, interfaccia di battaglia completa, fluido su desktop e telefono.

**Gameplay identico, grafica originale.** Le meccaniche sono già identiche: il motore RoyaleSim gira nel browser e
i suoi hash coincidono con quelli nativi (test.html, 335/335). La grafica invece NON può essere quella di Supercell.
La [Fan Content Policy di Supercell](https://supercell.com/en/fan-content-policy/) vieta di "creare nuovi prodotti
o contenuti basati sugli asset Supercell", anche gratuiti, e vieta di modificarli. Quindi:
- **Vietato** usare modelli, texture, icone, animazioni, suoni, font, logo o UI estratti dal gioco o presi da siti
  di "ripped assets"; vietato ricalcarli.
- **Consentito**: modelli CC0 di terzi (KayKit, licenza CC0, nessuna attribuzione obbligatoria, la diamo
  comunque), geometria e shader procedurali scritti da noi, suoni sintetizzati con WebAudio.
- Nomi delle carte: restano quelli descrittivi del motore (Hog Rider, Musketeer...), che già usa RoyaleGym. Nessun
  nome "Clash Royale" nel titolo del sito o nel dominio. Avviso obbligatorio nel footer e nella schermata di caricamento:
  *"Questo materiale non è ufficiale e non è approvato da Supercell. Per maggiori informazioni consulta la Fan Content
  Policy di Supercell: www.supercell.com/fan-content-policy."*

## 1. Riferimento visivo (descrizione, non asset)
- **Camera**: proiezione **ortografica** (le unità lontane hanno la stessa dimensione di quelle vicine), arena
  in verticale, inclinata di circa 50-55° rispetto al piano (vista "obliqua dall'alto"), senza rotazione sull'asse
  verticale. La metà blu (giocatore) sta in basso. Nessun movimento di camera durante la partita, salvo un leggero
  scuotimento quando cade una torre.
- **Arena 18×32 tile**: prato con due tonalità a scacchi molto tenue; fiume orizzontale (righe 15-16) con acqua
  animata e sponde in pietra; due ponti di legno sulle colonne 2,5-4,5 e 13,5-15,5; bordi dell'arena con mura basse,
  alberi e rocce fuori dal campo. Corsie di terra battuta più chiare dalle torri ai ponti (solo decorative).
- **Torri**: torre del re al centro di ogni metà (3×3 tile al suolo, la più alta) e due torri principessa (3×3,
  davanti); colori di squadra blu e rossa; barra HP sopra con il numero. Sulle torri principessa c'è un arciere che
  tira frecce; sulla torre del re un cannone/re che "dorme" (icona zZ) finché la torre non si attiva. Distrutta: la
  torre diventa un rudere fumante con detriti.
- **Unità**: modelli low-poly cartoon con contorno scuro (outline), ombra a blob morbida sotto i piedi, colore di
  squadra visibile (fascia, scudo o accessorio tinto blu/rosso), barra HP piccola solo quando la vita non è piena,
  orientamento verso la direzione di marcia o il bersaglio. Le unità volanti stanno più in alto, con l'ombra a terra.
- **UI di battaglia** (overlay HTML sopra il canvas WebGL):
  - In alto a sinistra: nome avversario e corone; in alto a destra: timer `m:ss` e la scritta "x2 Elisir" / "x3"
    nell'ultimo minuto e in overtime; banner "Overtime" e "60 secondi rimasti".
  - In basso: 4 carte (cornice, ritratto 3D renderizzato del modello, costo in una goccia viola), riquadro piccolo
    "Prossima" a sinistra, barra dell'elisir a 10 segmenti con numero, riempimento continuo e luccichio quando è piena.
  - Trascinando una carta: zona nemica oscurata in rosso, sagoma "fantasma" semitrasparente del modello (truppe) o
    cerchio del raggio (incantesimi) sotto il dito, che si muove a scatti di tile; rilasciando fuori dall'arena si
    annulla.
- **Schermate**: caricamento con barra e avviso legale; menu (scelta avversario, regole brevi); fine partita con
  corone animate, "Vittoria / Sconfitta / Pareggio", pulsanti Rivincita, Menu e Scarica replay.

## 2. Architettura (si aggiunge a quella esistente, non la sostituisce)
- Motore: invariato (`engine-worker.js` + `py/game.py` in Pyodide, bot in onnxruntime-web). Si arricchisce solo
  il frame con i campi già presenti nell'`EntityState` che servono all'animazione: `facing` (direzione),
  `attack_phase` (0 riposo, 1 carica, 2 colpo/cooldown), `target_uid`, `deploy_ticks`, `stun_ticks`, e per gli
  incantesimi `motion`, `travelled`, `length`; per i proiettili `firer_card_id`.
- Rendering: **three.js** (versione fissa, modulo ES da jsDelivr con import map, es. `three@0.160.0`) in
  `render3d.js`. `game.js` conserva la logica di UI e input e delega il disegno a un'interfaccia
  `Renderer { init(meta), frame(interpolated, dt), pick(clientX, clientY) -> tile }`, con due implementazioni:
  `Renderer2D` (quella di oggi, fallback se WebGL non c'è) e `Renderer3D`.
- Coordinate: motore (x verso destra, y verso il rosso, in tile) → three.js `X = x - 9`, `Z = 16 - y`, `Y` = altezza
  (unità volanti `Y = 1.6`). Click e touch: raycast sul piano `Y = 0` → tile `(floor(x), floor(y))`.
- Asset in `site/assets/` (sotto 25 MB in tutto, caricati in parallelo con barra di avanzamento, cache HTTP):
  i modelli glb **ottimizzati** con `gltf-transform` (meshopt + texture webp/ktx2, rimozione delle animazioni non
  usate, dedup), fatto da uno script `tools/build_assets.mjs` e committato già ottimizzato.

## 3. Mappatura carte → modelli (Hog 2.6, i soli 8 della modalità attuale; ogni altra carta ha un fallback)
| Carta | Modello / costruzione | Animazioni | Note |
|---|---|---|---|
| Skeletons (×3) | KayKit `Skeleton_Minion.glb` | idle, walk/run, attack (spada), death | scala piccola, arma corta |
| Musketeer | KayKit `Rogue_Hooded.glb` + accessorio balestra/fucile | idle, walk, shoot, death | proiettile: pallottola con scia |
| Hog Rider | KayKit `Barbarian.glb` (martello) **in sella a un maiale procedurale** (sfere e capsule rosa, zampe animate via codice) | run (galoppo), attack (martellata) | salto del fiume: arco parabolico se il motore lo segnala (posizione che attraversa l'acqua fuori dai ponti) |
| Ice Golem | procedurale: blocchi di "ghiaccio" sfaccettati (shader frost, emissive azzurro) | camminata pesante, pugno, morte con esplosione di ghiaccio che rallenta (effetto azzurro ad area) | |
| Ice Spirits | procedurale: piccola sfera ghiacciata con occhi, saltellante | salto kamikaze verso il bersaglio, esplosione azzurra | |
| Cannon | procedurale: affusto di legno + canna in metallo ruotabile verso il bersaglio | rinculo al colpo, fumo | edificio: barra della durata che cala |
| Fireball | procedurale: sfera emissiva arancione con particelle, traiettoria ad arco dal re verso il bersaglio | impatto: esplosione, fumo, onda d'urto ad anello, scossa leggera | raggio dell'area dal motore |
| The Log | procedurale: tronco cilindrico con corteccia | cade (motion AIRBORNE), rotola (ROLLING) lungo `travelled/length`, polvere | |
| Torre principessa | KayKit `building_tower_A_{blue,red}.gltf` + arciere `Rogue.glb` in cima | arciere: idle/shoot verso `target_uid` | frecce come proiettili |
| Torre del re | KayKit `building_castle_{blue,red}.gltf` + `Knight.glb` in cima | zZ finché `king_active` è falso; animazione di "risveglio" all'attivazione | |
| Decorazioni | KayKit hexagon: `building_bridge_A`, `tree_single_*`, `rock_single_*`, `wall_straight` | — | solo fuori dalla griglia giocabile |

Tinta di squadra: materiale "team" su accessori o fascia (blu `#3d8bff`, rosso `#ff4d5e`) e anello a terra sotto ogni
unità. Contorno: secondo passaggio con le normali spinte in fuori, oppure `OutlinePass` se il costo resta sotto 2 ms.

## 4. Animazione guidata dal motore (nessuna invenzione di gameplay)
Il motore è l'unica fonte di verità: la grafica interpreta lo stato, non lo anticipa.
- Interpolazione posizione per `uid` tra i tick (frame a 20 Hz → 60 fps), già presente.
- Stato dell'animazione di ogni unità: `deploying` (deploy_ticks > 0: discesa dall'alto con polvere e un cerchio
  che si riempie), `walk` (si sposta più di 0,02 tile per tick), `attack` (attack_phase 1/2 con un target valido:
  rivolta verso il target), `idle`, `stunned` (stun_ticks > 0: animazione in pausa e alone azzurro), `dead`
  (l'uid sparisce dal frame: animazione di morte di 0,6 s e dissolvenza, ma solo visiva).
- Rotazione: verso `facing` se non nullo, altrimenti verso la direzione del movimento; slerp di 120 ms.
- Danni: lampo bianco sul materiale quando l'HP scende; numeri solo sulle torri (come nel riferimento).
- Torri: scossa e frammenti quando prendono danno; crollo animato con polvere quando spariscono; corona che vola verso
  il contatore in alto.

## 5. Audio (sintetizzato, nessun file del gioco)
WebAudio con piccoli sintetizzatori: tocco carta, schiocco di piazzamento, colpo di spada, sparo, cannone, esplosione
della Fireball, rotolamento del Log, crollo della torre, fanfara di vittoria e di sconfitta. Volume e mute nel menu.
Musica: nessuna, oppure un loop generativo semplice disattivabile.

## 6. Prestazioni e compatibilità
- 60 fps su un portatile medio e 30+ su un telefono di fascia media: al massimo ~40 unità animate, `SkinnedMesh` con
  `AnimationMixer` condivisi per tipo, ombre a blob (niente shadow map), un solo DirectionalLight + luce
  emisferica, pixel ratio limitato a 2.
- Input: mouse (clic e trascinamento) e touch (trascinamento dalla carta), tasti 1-4 / Esc.
- Il motore non deve mai bloccare il disegno: resta nel Web Worker.
- WebGL assente o errore: si passa da solo al Renderer2D di oggi.

## 7. Verifica (obbligatoria prima di ogni push)
1. `test.html`: ancora 335/335 hash identici (la grafica non tocca il motore).
2. Partita completa nel pannello Browser contro il bot RL: screenshot di menu, piazzamento con sagoma fantasma,
   combattimento sul ponte, Fireball, Log, torre distrutta, schermata finale. Nessun errore in console.
3. Misura degli fps (`renderer.info` + media dei frame) a inizio partita e nel momento più affollato; risultati in LOG.
4. Vista mobile (375×812) con tocco simulato.
5. Peso del sito: totale scaricato al primo caricamento, annotato nel README.

## 8. Consegna
- Sito aggiornato su GitHub Pages, README con la sezione "Crediti asset" (KayKit by Kay Lousberg, CC0;
  three.js MIT; RoyaleGym MIT; Pyodide MPL-2.0; onnxruntime-web MIT) e l'avviso Supercell.
- Sezione nel LOG del progetto: decisioni, misure, problemi e soluzioni.
