# PIC-ASS-O

Ingyenes, magyar rajzolós-kitalálós party játék a böngészőben, regisztráció nélkül.
Élő oldal: <https://pic-ass-o.netlify.app>

## Felépítés

| Hely | Mi ez |
|---|---|
| `index.html` | Az oldal váza (képernyők, ablakok) |
| `css/picasso.css` | A teljes stíluslap |
| `js/picasso.js` | A játék fő modulja (hálózat, rajzolás, körök, UI, admin) |
| `js/rules.js` | Tiszta szabályok és bemenet-ellenőrzők (tippellenőrzés, normalizálás, rajzadatok szűrése) |
| `js/account.js` | Fiók a böngészőben (v4.40): belépés / regisztráció ablak, névigazoló jegy, statisztika- és beállítás-szinkron |
| `js/changelog.js` | Kiadási napló — csak megnyitáskor töltődik be |
| `vendor/` | Trystero + MQTT saját példányban, és a QR-kód rajzoló a 2FA-hoz (lásd `vendor/README.md`) |
| `netlify/functions/` | Szerveroldali függvények: fiókok (`account`), kitiltás, admin, Gist-proxy, értesítők, szójelzések, TURN |
| `netlify/lib/` | Közös segédfüggvények (ütközésbiztos Blobs-írás, munkamenet, szólista, fiókok magja, levélküldő) |
| `server/` | Saját játékszerver (WebSocket-továbbító, szobalista, ranglista) — telepítés: `server/TELEPITES.md` |
| `offline/` | **Picasso offline változat**: egyetlen önálló HTML-fájl (internet, webszerver és zene nélkül, kivetítős közönségablakkal) — lásd `offline/README.md` |
| `szavak-*.txt` | Tartalék szólista (az élő lista a Gistben van) |
| `tests/` | Tesztek |

Nincs build-lépés: a Netlify a fájlokat úgy szolgálja ki, ahogy vannak. A `_redirects`
elzárja a belső részeket (`/server/`, `/tests/`, `/netlify/` stb.), a `_headers` érvényesített
CSP-t ad (soron belüli szkript és eseménykezelő nem megengedett — `onclick=`, `onsubmit=`
helyett `addEventListener`). A böngészős tesztek ugyanezzel a CSP-vel futnak.

## Tesztek

```bash
npm install
npm test            # szabályok, Netlify-függvények, játékszerver
npm run test:e2e    # teljes kör, elárasztás/csalás elleni védelem, betöltés/visszalépés/akadálymentesség (Playwright + Chromium)
```

Vizuális összevetés (pl. CSS-módosítás előtt és után):

```bash
# kezdő- és beállítóképernyő (egy futó statikus kiszolgálóval, pl. python3 -m http.server 8765)
node tests/visual/snap.cjs http://127.0.0.1:8765/ elotte
# játékképernyők: két játékos végigjátszik egy teljes játékot (48 kép, a kiszolgálókat maga indítja)
node tests/visual/game.cjs elotte
# … módosítás után ugyanez "utana" mappába, majd:
python3 tests/visual/diff.py elotte utana
```

A játékképernyős képek futásról futásra azonosak (rögzített véletlen és álló óra), így
bármilyen eltérés valódi változást jelez.

### CSS-módosítás biztonságosan

A képeknél érzékenyebb mérce a **kiszámított stílus**: minden elem (a rejtettek is — chat,
menü, ablakok) ~130 tulajdonsága, 124 állapotban (6 kijelző/téma × 12 menüállapot +
2 × 26 játékállapot).

```bash
STYLES=1 node tests/visual/menus.cjs elotte-menu
STYLES=1 node tests/visual/game.cjs  elotte-jatek
# … CSS-módosítás …
STYLES=1 node tests/visual/menus.cjs utana-menu
STYLES=1 node tests/visual/game.cjs  utana-jatek
node tests/visual/style-diff.cjs elotte-menu utana-menu     # -v: részletek
node tests/visual/style-diff.cjs elotte-jatek utana-jatek
```

Elemzők:

```bash
node tests/tools/css-audit.mjs          # bizonyíthatóan halott deklarációk (--fix: törlés)
node tests/tools/css-imp-trial.mjs elotte-menu elotte-jatek munka   # !important-ok mérésen alapuló levétele
```

Új verziónál a `js/changelog.js` elejére kerül a bejegyzés, és a `js/picasso.js` `APP_VERSION` értéke is átírandó (teszt ellenőrzi).

### Terhelés és tömeg (v4.52)

```
npm run test:load      # 100 szoba × 8 játékos + 160 nézelődő a szobalistán, 45 mp (paraméterezhető: node tests/load/load.mjs szobák játékos/szoba mp)
npm run test:crowd     # valódi böngészők: 20 fős szoba, 4 párhuzamos szoba, 40 szobás szobalista (SHOTS=mappa: képernyőképek)
```

Mért eredmények (4 magos gép, egy Node-folyamat): 960 kapcsolat → 1 ms átlag / 11 ms p99 késleltetés, 140 MB, 16% CPU;
2400 kapcsolat → 1 ms / 105 ms, 266 MB, 33% CPU; 4800 kapcsolat → 11 ms / 0,7 mp, 420 MB, 65% CPU, elveszett üzenet nélkül.
A szerver `MAX_RSS_MB` (alapból 400) fölött nem fogad új kapcsolatot (a böngésző ilyenkor a közvetlen, P2P útra vált).
Beállítható még: `MAX_CONN_PER_IP` (alapból 150), `MAX_ROOMS` (500), `WS_DEFLATE` (`regi` / `ki`).

## Netlify környezeti változók

| Név | Kötelező? | Mire |
|---|---|---|
| `GITHUB_TOKEN` | ajánlott | Gist írása az adminból, és a Gist-proxy 60 helyett 5000 kérés/óra keretet kap |
| `NETLIFY_API_TOKEN` | nem | Visszajelzések olvasása az adminban |
| `PICASSO_SERVER_SECRET` | nem | A játékszerver szójelzései (ugyanaz, mint a szerver `WORDS_SECRET`-je) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | a regisztrációhoz és az e-mail értesítőhöz | Levélküldés (megerősítő, belépőlink- és értesítő levelek) |
| `ACCOUNT_EXTRA_EMAIL_DOMAINS` | nem | Regisztrációnál csak magánszemélyes e-mail szolgáltatók címe fogadható el (lista: `netlify/lib/mail.mjs`); ezzel további domaineket engedhetsz meg, vesszővel elválasztva |
| `ACCOUNT_MAIL_DAILY_CAP` | nem | A fiókkal kapcsolatos levelek napi plafonja (alapból 200) |
| `MAIL_DAILY_CAP` | nem | Napi levélplafon (alapból 450; a Gmail kb. 500-at enged) |
| `MUSIC_REPO` | nem | A zenés tároló (`felhasznalo/tarolo`); nélküle az admin nem írhat tárolóba |
| `ADMIN_PASSWORD_RECORD` | nem | Admin jelszó-lenyomat kívülről (`{"v":1,"salt":…,"iter":…,"hash":…}`); alapból a Blobs tárolja |
| `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` / `METERED_API_KEY` | nem | TURN-közvetítő a közvetlen (P2P) kapcsolathoz |

## Fiókok (v4.40)

A regisztráció önkéntes; fiók nélkül ugyanúgy lehet játszani. Felépítés:

- **`netlify/functions/account.mjs`** kezeli a fiókokat (Netlify Blobs, `picasso-accounts` tároló). **Jelszó nincs (v4.45):**
  belépés jelkulccsal (passkey / WebAuthn, `@simplewebauthn/server`) vagy e-mailben küldött, 15 percig élő, egyszer
  használható belépőlinkkel. Gépen a „📱 A telefonomra” gomb a böngésző QR-kódos (hybrid) útját kéri, így a jelkulcs a
  telefonon jön létre. A munkamenet-kulcs `HttpOnly; Secure; SameSite=Strict` sütiben él, a tárolóban csak a SHA-256
  lenyomata; a megerősítő és belépőlinkek kulcsából szintén csak lenyomat. A v4.45 előtti jelszó-lenyomatokat és
  2FA-kulcsokat a függvény az első induláskor törli (`mig/nopw` jelző).
- **Névvédelem:** a böngésző egy 15 percig élő, ECDSA P-256 aláírású *névigazoló jegyet* kér, ami a játékos pillanatnyi
  kapcsolat-azonosítójához és (a saját szervernél) a kapcsolat titkos kulcsához kötött. A játékszerver a nyilvános kulccsal
  ellenőrzi, és regisztrált névvel jegy nélkül nem enged bemutatkozni; a szobanyitó és a többi böngésző ugyanezt ellenőrzi
  (ebből lesz a ✔ jelvény). A titkos aláírókulcs az első használatkor jön létre, és a Blobs tárolóban marad.
- **Ha a saját játékszerver nem érhető el** (tartalék P2P mód), a névvédelmet csak a szobanyitó böngészője és a ✔ jelvény
  adja — ez gyengébb, mert egy módosított kliens szobanyitóként a saját szobájában bármit megjeleníthet. A ✔ jelvényt
  viszont ilyenkor sem lehet hamisítani a többi játékos eszközén.
- **Ranglista:** csak jeggyel igazolt játékos kerül fel; fióktörléskor a Netlify aláírt kéréssel (`/api/forget`) töröltet a szerverrel.
- **Tesztek:** `tests/netlify.test.mjs` (fiók-függvények), `tests/server.test.mjs` (jegyellenőrzés, névvédelem),
  `tests/e2e/account.cjs` (teljes folyamat böngészőben, a valódi függvényekkel).

**Admin jelszó (v4.30):** a lenyomat már nem a nyilvános Gistben, hanem a Netlify Blobs tárolóban van.
A régi `admin.json` az első sikeres admin belépéskor magától átköltözik és törlődik a Gistből —
de a Gist korábbi változatai nyilvánosak maradnak, ezért **utána állíts be új jelszót** az admin oldalon.
