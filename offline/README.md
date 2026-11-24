# Picasso — offline csapatverseny

Egyetlen fájl: **`Picasso-offline.html`**. Céges rendezvényre készült, laptopra és kivetítőre.

- **Nem kell hozzá internet, webszerver vagy telepítés.** Dupla kattintás a fájlra, és megnyílik a böngészőben (Edge vagy Chrome).
- **Semmilyen hálózati kapcsolatot nem nyit.** A fájl biztonsági szabálya (CSP, `connect-src 'none'`) a böngészőben
  minden letöltést és küldést letilt. Minden benne van: kód, betűtípusok, a teljes szótár (12 099 szó).
- **Nincs benne** zene, hang, fiók, regisztráció, reklám, követés vagy süti.
- **Tárolt adatok:** a csapatok (szám, név nélkül is megadható csapatnév, tagok neve) és a menetek pontjai a
  böngésző helyi tárolójában (`localStorage`), csak ezen a gépen. Bármikor törölhetők.

## A verseny menete

1. **Csapatok** oldal: minden csapat kap egy számot, nevet (nem kötelező) és tagokat. Egy ember csak egy csapatban
   lehet. A listát Excelből is be lehet illeszteni (`1: Anna, Béla` vagy `2 Kék bálnák: Csaba, Dóra`).
2. **Beállítások:** egy csapat ideje (1–5 perc vagy egyéni) és a szavak nehézsége.
3. **Csapat indítása:** a csapat választ, ki kezd rajzolni, és ekkor indul az óra. A fix idő alatt minél több rajzot
   kell kitalálniuk. Minden kitalált vagy passzolt szó után a csapat dönti el, ki rajzolja a következőt.
4. **Pontozás:** kitalált rajzonként 1 pont jár a csapatnak. A passz nem jár levonással (de elmegy vele az idő).
   A rajzoló külön nem kap pontot.
5. **Összesítő:** a csapatok összpontszáma (több menet esetén összeadva). Egy csapatra kattintva látszanak a menetei,
   egy hibás menet ott törölhető.

Ha a böngésző menet közben bezáródik vagy lefagy, újranyitáskor a félbeszakadt menet folytatható vagy lezárható.

## Kivetítő

1. Csatlakoztasd a kivetítőt, majd nyomd meg a **Win + P** billentyűt, és válaszd a **Kiterjesztés** lehetőséget
   (ne a Másolást!).
2. Kattints a **Kivetítő ablak megnyitása** gombra (ha a böngésző letiltja a felugró ablakot, engedélyezd), húzd át
   az ablakot a kivetítőre, és kattints a **Teljes képernyő** gombra.
3. A laptop képernyője a rajzolóé, itt látszik a szó. A kivetítőn az élő rajz, a csapat, a rajzoló, a pontszám és az
   idő látszik, a szó csak a kitalálása vagy passzolása után villan fel. Menetek között az összesítő látszik.

Kivetítő nélkül, egy képernyőn is működik: ilyenkor a szó csak a „👁 Szó” gomb nyomva tartásakor látszik.

## Adatok

- **Mentés fájlba / Betöltés fájlból:** biztonsági mentés JSON fájlba, ami egy másik gépen is visszatölthető
  (így a csapatok előre, egy másik gépen is megadhatók).
- **Eredmények törlése:** a pontok nullázása (a csapatok megmaradnak).

## Harmadik féltől származó elemek

- Betűtípusok: **Nunito** és **Kalam**, mindkettő [SIL Open Font License 1.1](https://openfontlicense.org)
  alatt, ami a beágyazást és a céges használatot is megengedi.
- Az ikonok a gép saját emoji-betűtípusából jönnek (a fájl nem tartalmaz képet).

## Fejlesztőknek

A forrás az `src/offline.html`. Ebből a build-szkript állítja össze a kész fájlt: beágyazza a betűtípusokat és a
`szavak-*.txt` szólistákat.

```bash
node offline/build.mjs          # → offline/Picasso-offline.html
node tests/e2e/offline.cjs      # böngészős teszt (SHOTS=mappa: képernyőképek)
```
