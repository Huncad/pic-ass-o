# Picasso — offline változat

Egyetlen fájl: **`Picasso-offline.html`**. Céges rendezvényre készült, laptopra és kivetítőre.

- **Nem kell hozzá internet, webszerver vagy telepítés.** Dupla kattintás a fájlra, és megnyílik a böngészőben (Edge vagy Chrome).
- **Semmilyen hálózati kapcsolatot nem nyit.** A fájl biztonsági szabálya (CSP, `connect-src 'none'`) a böngészőben
  minden letöltést és küldést letilt. Minden benne van: kód, betűtípusok, a teljes szótár (12 099 szó).
- **Nincs benne** zene, hang, fiók, regisztráció, reklám, követés vagy süti. Csak a játékosneveket és a beállításokat
  jegyzi meg a böngésző helyi tárolójában, és csak ezen a gépen.

## Játék kivetítővel (ajánlott)

1. Csatlakoztasd a kivetítőt, majd nyomd meg a **Win + P** billentyűt, és válaszd a **Kiterjesztés** lehetőséget
   (ne a Másolást!).
2. Nyisd meg a `Picasso-offline.html` fájlt, és kattints a **Kivetítő ablak megnyitása** gombra.
   Ha a böngésző letiltja a felugró ablakot, engedélyezd.
3. Húzd át az új ablakot a kivetítő képernyőjére, és kattints benne a **Teljes képernyő** gombra.
4. A laptop képernyője a rajzolóé: itt választja ki és látja a szót. A kivetítőn csak az élő rajz, a rajzoló neve,
   az óra és az állás látszik. A szó ott csak a kör végén jelenik meg.

Kivetítő nélkül, egy képernyőn is működik: ilyenkor a szó csak a „👁 Szó” gomb nyomva tartásakor látszik.

## Menet

- 2–12 játékos (vagy csapat). A sorrendet a játék sorsolja.
- A soron következő rajzoló a laptophoz lép, és 3 szóból választ (egyszer kérhet másik hármat).
- Rajzol, a többiek **hangosan tippelnek**. Aki kitalálja, annak a nevére kattint a rajzoló. A kitaláló 50–100 pontot
  kap aszerint, mennyi idő maradt, a rajzoló 50-et.
- Ha lejár az idő, még megadható, ha valaki az utolsó pillanatban bekiabálta a megfejtést.
- A **Szünet** gomb megállítja az órát és eltakarja a rajzot. Ablakváltáskor a játék magától szünetel.
- A végén dobogó és teljes eredménylista látható, a kivetítőn is.

## Fejlesztőknek

A forrás az `src/offline.html`. Ebből a build-szkript állítja össze a kész fájlt: beágyazza a betűtípusokat és a
`szavak-*.txt` szólistákat.

```bash
node offline/build.mjs          # → offline/Picasso-offline.html
node tests/e2e/offline.cjs      # böngészős teszt (SHOTS=mappa: képernyőképek)
```
