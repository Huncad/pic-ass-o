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
| `js/changelog.js` | Kiadási napló — csak megnyitáskor töltődik be |
| `vendor/` | Trystero + MQTT saját példányban (lásd `vendor/README.md`) |
| `netlify/functions/` | Szerveroldali függvények: kitiltás, admin, Gist-proxy, értesítők, szójelzések, TURN |
| `netlify/lib/` | Közös segédfüggvények (ütközésbiztos Blobs-írás, munkamenet, szólista) |
| `server/` | Saját játékszerver (WebSocket-továbbító, szobalista, ranglista) — telepítés: `server/TELEPITES.md` |
| `szavak-*.txt` | Tartalék szólista (az élő lista a Gistben van) |
| `tests/` | Tesztek |

Nincs build-lépés: a Netlify a fájlokat úgy szolgálja ki, ahogy vannak.

## Tesztek

```bash
npm install
npm test            # szabályok, Netlify-függvények, játékszerver
npm run test:e2e    # teljes kör két böngészőben (Playwright + Chromium kell hozzá)
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

Új verziónál a `js/changelog.js` elejére kerül a bejegyzés, és a `js/picasso.js` `APP_VERSION` értéke is átírandó (teszt ellenőrzi).

## Netlify környezeti változók

| Név | Kötelező? | Mire |
|---|---|---|
| `GITHUB_TOKEN` | ajánlott | Gist írása az adminból, és a Gist-proxy 60 helyett 5000 kérés/óra keretet kap |
| `NETLIFY_API_TOKEN` | nem | Visszajelzések olvasása az adminban |
| `PICASSO_SERVER_SECRET` | nem | A játékszerver szójelzései (ugyanaz, mint a szerver `WORDS_SECRET`-je) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | az e-mail értesítőhöz | Levélküldés |
| `MAIL_DAILY_CAP` | nem | Napi levélplafon (alapból 450; a Gmail kb. 500-at enged) |
| `MUSIC_REPO` | nem | A zenés tároló (`felhasznalo/tarolo`); nélküle az admin nem írhat tárolóba |
| `ADMIN_PASSWORD_RECORD` | nem | Admin jelszó-lenyomat kívülről (`{"v":1,"salt":…,"iter":…,"hash":…}`); alapból a Blobs tárolja |
| `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` / `METERED_API_KEY` | nem | TURN-közvetítő a közvetlen (P2P) kapcsolathoz |

**Admin jelszó (v4.30):** a lenyomat már nem a nyilvános Gistben, hanem a Netlify Blobs tárolóban van.
A régi `admin.json` az első sikeres admin belépéskor magától átköltözik és törlődik a Gistből —
de a Gist korábbi változatai nyilvánosak maradnak, ezért **utána állíts be új jelszót** az admin oldalon.
