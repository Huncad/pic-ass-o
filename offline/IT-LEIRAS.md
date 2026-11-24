# Picasso offline — rövid leírás az IT részére (security sanity check)

**Mire kérjük az IT-t:** erősítsétek meg, hogy egy belső céges rendezvényen használhatjuk ezt az egyfájlos, offline
HTML játékot egy céges (managed) laptopon, a vállalati böngészőben.

## 1. Összefoglalás

| Kérdés | Válasz |
|---|---|
| Mi ez? | Rajzolós-kitalálós csapatjáték, egyetlen HTML-fájl (`Picasso-offline.html`, kb. 430 kB). |
| Kell telepíteni? | **Nem.** Nincs telepítő, futtatható állomány (exe/msi), bővítmény vagy rendszergazdai jog. |
| Hogyan fut? | A fájlt a helyi lemezről megnyitjuk Edge-ben vagy Chrome-ban (`file://`). |
| Van hálózati forgalma? | **Nincs.** A fájl biztonsági szabálya minden hálózati kérést letilt (lásd 3. pont). |
| Van szerver, felhő vagy külső szolgáltatás? | **Nincs.** Nincs backend, API, CDN, analitika, telemetria vagy reklám. |
| Személyes adat? | Csak a játékosok keresztneve vagy beceneve és a pontjaik, kizárólag a laptop böngészőjében, automatikus törléssel (lásd 4. pont). |
| Külső kód vagy könyvtár? | **Nincs.** Saját, natív JavaScript. Csak két beágyazott betűtípus van benne (SIL OFL 1.1, lásd 5. pont). |

## 2. Működés röviden

- A laptopot a játékvezető kezeli: elindítja a csapat menetét, és a kitaláló nevére koppint.
- A kivetítőre egy második böngészőablak kerül, amit maga a játék nyit meg (`about:blank`). Windowson ehhez a
  „Kiterjesztés” kijelzőmódot használjuk (Win + P). Ez az ablak ugyanazon a gépen, a memórián keresztül frissül,
  hálózat nélkül.
- Hang, zene, kamera, mikrofon, helymeghatározás és értesítés nincs. Ezekhez nem is kér engedélyt.

## 3. Hálózat és biztonság

A fájl elején Content Security Policy (CSP) áll, amit a böngésző kényszerít ki:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:;
connect-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none';
form-action 'none'; base-uri 'none'
```

- `connect-src 'none'`: a böngésző **semmilyen** kimenő kapcsolatot nem enged (fetch, XHR, WebSocket, beacon).
- Külső szkript, stíluslap, kép, betű vagy keret **nem tölthető be**, csak a fájlba ágyazott tartalom
  (`data:` URI és beágyazott kód). Az `'unsafe-inline'` azért kell, mert minden kód magában a fájlban van. Kívülről
  semmi nem tölthető be.
- A felhasználói bevitel (csapatnév, tagnév) mindig szövegként kerül a lapra (`textContent`), HTML-ként soha.
  `eval` vagy `new Function` nincs a kódban. Az `innerHTML` és a `document.write` csak a kivetítő ablak rögzített,
  saját sablonját írja ki.
- A mentésfájl betöltésekor a játék ellenőrzi és megtisztítja a tartalmat (típusok, hosszkorlátok, darabszámok).
- **Ellenőrizhető:** a böngésző fejlesztői eszközeinek Network (Hálózat) lapján játék közben sem jelenik meg kérés.
  Ezt egy automata böngészőteszt is ellenőrzi minden változat előtt (141 ellenőrzés, köztük: „egyetlen hálózati kérés
  sem történt”, „a CSP tiltja a kimenő kérést”).

## 4. Adatkezelés

**Milyen adat?**
- Csapat: szám, nem kötelező csapatnév, tagok neve. Keresztnév vagy becenév is elég, ezt javasoljuk.
- Menetenként: a kitalált vagy passzolt szavak, ki rajzolta, ki találta ki, az időpont a meneten belül, és a menet
  kezdete. Ebből számoljuk a csapat-összesítőt és a top 10 személyes ranglistát.
- Beállítások: menetidő, nehézség, megőrzési idő.

**Hol?** Csak a laptop böngészőprofiljának helyi tárolójában (`localStorage`, a fájl saját tárolóterülete).
Az adat nem hagyja el a gépet, és más weboldal nem fér hozzá.

**Meddig?**
- **Automatikus törlés:** ha a játékot 12, 24 vagy 48 óráig (beállítható, alapból 24 óra) senki nem használja,
  minden csapat-, név- és eredményadat magától törlődik. Ez a következő megnyitáskor, nyitva hagyott lapon pedig
  percenként ellenőrzött.
- **„Rendezvény lezárása”:** a végeredmény megjelenítése után egy gombbal minden adat véglegesen törölhető.
- **„Eredmények törlése”:** a pontok bármikor nullázhatók.

**Mentés fájlba:** csak a felhasználó kérésére történik, egy JSON-fájlba, a gépen, a böngésző szokásos letöltésével.
A fájl a neveket is tartalmazza, ezért a céges szabályok szerint kell kezelni, és a rendezvény után törölni.

**Cél:** kizárólag a rendezvényen zajló játék pontozása. Profilalkotás, továbbítás vagy más célú felhasználás nincs.

## 5. Harmadik féltől származó elemek, licencek

| Elem | Forrás | Licenc |
|---|---|---|
| Nunito betűtípus | Copyright 2014 The Nunito Project Authors | SIL Open Font License 1.1: beágyazás és céges használat megengedett |
| Kalam betűtípus | Copyright (c) 2014 Indian Type Foundry | SIL Open Font License 1.1 |
| Szólista (12 099 szó) | A Picasso projekt saját anyaga | saját |
| Ikonok | A Windows saját emoji-betűtípusa (a fájl nem tartalmaz képet) | – |

A betűtípusok licencének teljes szövege és a szerzői jogi sorok a játékban is olvashatók (Kezdőlap → „Licencek”).
A projekt tárolójában az `offline/OFL.txt` fájlban vannak.

## 6. Javasolt használati mód

1. A fájl a céges laptop helyi lemezén vagy a céges OneDrive-on legyen, **ne USB-meghajtón**.
2. Megnyitás a vállalati Edge böngészőben. A kivetítő ablakhoz egyszer engedélyezni kell a felugró ablakot ennél
   a fájlnál.
3. Csapat- és tagnévnek keresztnév vagy becenév is elég.
4. A rendezvény végén: „Rendezvény lezárása” → (ha kell) mentés → „Minden adat végleges törlése”. Az esetleges
   mentésfájlt a szabályok szerint kezeljük, és a szükséges idő után töröljük.

## 7. A jóváhagyott változat azonosítása

Hogy a jóváhagyott és a rendezvényen használt fájl biztosan ugyanaz legyen, a fájl SHA-256 lenyomata
ellenőrizhető PowerShellben:

```powershell
Get-FileHash .\Picasso-offline.html -Algorithm SHA256
```

A jelen leíráshoz tartozó változat lenyomata:

```
cc520ca5a0ad30c4c6dc713fa23e810dd88846dc7a5f977d56873b26449387df
```
