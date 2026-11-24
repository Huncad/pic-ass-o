# Picasso — offline csapatverseny

Egyetlen fájl: **`Picasso-offline.html`**. Céges rendezvényre készült, laptopra és kivetítőre.
Az IT részére készült leírás: **[`IT-LEIRAS.md`](IT-LEIRAS.md)**.

- **Nem kell hozzá internet, webszerver vagy telepítés.** Dupla kattintás a fájlra, és megnyílik a böngészőben (Edge vagy Chrome).
- **Semmilyen hálózati kapcsolatot nem nyit.** A fájl biztonsági szabálya (CSP, `connect-src 'none'`) a böngészőben
  minden letöltést és küldést letilt. Minden benne van: kód, betűtípusok, a teljes szótár (12 099 szó).
- **Nincs benne** zene, hang, fiók, regisztráció, reklám, követés vagy süti.
- **Adatok:** csak a laptop böngészőjében, és ha a játékot 12, 24 vagy 48 óráig (alapból 24 óra) senki nem
  használja, maguktól törlődnek. A „Rendezvény lezárása” gombbal bármikor véglegesen törölhetők.

## A verseny menete

1. **Csapatok** oldal: minden csapat kap egy számot, nevet (nem kötelező) és tagokat (keresztnév vagy becenév is
   elég). Egy ember csak egy csapatban lehet. A lista Excelből is beilleszthető (`1: Anna, Béla` vagy
   `2 Kék bálnák: Csaba, Dóra`).
2. **Beállítások:** egy csapat ideje (1–5 perc vagy egyéni) és a szavak nehézsége.
3. **Csapat indítása:** a csapat választ, ki kezd rajzolni, és ekkor indul az óra. A fix idő alatt minél több rajzot
   kell kitalálniuk. Minden szó után a csapat dönti el, ki rajzolja a következőt.
4. **Pontozás (a laptopot egy semleges játékvezető kezeli):** amikor valaki kimondja a jó szót, a játékvezető annak
   a nevére koppint (a rajzolóé nem jelenik meg). Ez 1 pont a csapatnak és 1 személyes pont a kitalálónak.
   A rajzoló nem kap pontot. A passz nem jár levonással.
5. **Átláthatóság:** a kivetítőn azonnal felvillan a szó és a kitaláló neve („✔ kanál — Béla”). Ha vita van, az
   utolsó pont **10 másodpercig javítható**: más kapja meg, vagy „senki, nincs pont”. Minden menet naplója
   (szó, kitaláló, rajzoló, időpont, javítás) visszanézhető az összesítőben.
6. **Összesítő:** csapat-rangsor (több menet összeadva) és **top 10 személyes ranglista**, a kivetítőn is.
   Egy hibás menet a csapat adatlapján törölhető.
7. **Rendezvény lezárása:** dobogós végeredmény (a kivetítőn is), mentés fájlba, majd minden adat végleges törlése.

Ha a böngésző menet közben bezáródik vagy lefagy, újranyitáskor a félbeszakadt menet folytatható vagy lezárható.

## Kivetítő

1. Csatlakoztasd a kivetítőt, majd nyomd meg a **Win + P** billentyűt, és válaszd a **Kiterjesztés** lehetőséget
   (ne a Másolást!).
2. Kattints a **Kivetítő ablak megnyitása** gombra (ha a böngésző letiltja a felugró ablakot, engedélyezd), húzd át
   az ablakot a kivetítőre, és kattints a **Teljes képernyő** gombra.
3. A laptop képernyője a rajzolóé és a játékvezetőé, itt látszik a szó. A kivetítőn az élő rajz, a csapat, a
   rajzoló, a pontszám és az idő látszik, a szó csak a kitalálása vagy passzolása után villan fel. Menetek között
   az összesítő látszik.

## Adatok

- **Mentés fájlba / Betöltés fájlból:** biztonsági mentés JSON fájlba. A csapatok így előre, akár egy másik gépen is
  megadhatók. A fájl neveket tartalmaz, ezért a rendezvény után töröljétek.
- **Eredmények törlése:** a pontok nullázása (a csapatok megmaradnak).

## Licencek

A beágyazott **Nunito** és **Kalam** betűtípus SIL Open Font License 1.1 alatt van (`OFL.txt`; a játékban is
olvasható a Kezdőlap → „Licencek” alatt). A fájl nem tartalmaz képet, hangot vagy külső könyvtárat.

## Fejlesztőknek

A forrás az `src/offline.html`. Ebből a build-szkript állítja össze a kész fájlt: beágyazza a betűtípusokat, a
licencszöveget és a `szavak-*.txt` szólistákat.

```bash
node offline/build.mjs          # → offline/Picasso-offline.html
node tests/e2e/offline.cjs      # böngészős teszt (SHOTS=mappa: képernyőképek)
```
