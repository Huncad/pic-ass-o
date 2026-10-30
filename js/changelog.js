// PIC-ASS-O — kiadási napló (v4.30: külön fájl, csak a napló megnyitásakor töltődik be)
// Minden új verzió ide kerül, ÉS a js/picasso.js APP_VERSION értéke is átírandó
// (a tesztek ellenőrzik, hogy a kettő egyezik).
export const CHANGELOG = [
  { version:'4.31', changes:[
    'Fekvő telefonon a rajzoló nézet új elrendezést kapott: balra a rajzlap teljes magasságban, jobbra a játékosok, az eszközök és a tippek. Régen alig maradt hely a rajzra.',
    'Kis telefonon (pl. iPhone SE) minden szín látszik, az eszközök egy sorban vannak, és nagyobb a rajzlap.',
    'A rajzlap a kör elején rögtön a végleges méretével jelenik meg (nem ugrik meg egy pillanattal később).',
    'A választott szó felvillanása keskeny kijelzőn sem töri ketté a szót.'
  ]},
  { version:'4.30', changes:[
    'Telefonon rövidebb a szobabeállítás: a név és a láthatóság után a többi beállítás egy nyitható „További beállítások” részben van, a fejléce mutatja az aktuális értékeket.',
    'Keskeny telefonon nagyobbak az avatarok, könnyebb eltalálni őket.',
    'iPhone-on a kivágás (notch) és az alsó csík mellett is rendben jelenik meg a játék.',
    'A szobalista állapota telefonon is teljes egészében olvasható.',
    'A titkos szó jobban védett: a rajzolás közben más eszközére semmilyen formában nem jut el.',
    'Megbízhatóbb kapcsolat a játékszerverrel nagy forgalom esetén is: egy üzenet sem vész el.',
    'Gyorsabb betöltés: a játék részei külön töltődnek, és a böngésző jobban el tudja tárolni őket.'
  ]},
  { version:'4.29', changes:[
    'A szavak megbízhatóbban töltődnek be, és gyenge kapcsolatnál vagy új eszközön sem fogynak el.',
    'Szoba létrehozásakor a gomb kiírja, ha még a kapcsolat készül elő.',
    'Új játékosoknál a szürke (Grafit) színvilág az alapértelmezett. Aki már választott témát, annál az marad.',
    'Szobanyitáskor beállítható, hány pontot vonjon le a játék egy rossz tippért (0, 1, 2, 3, 5 vagy 10).',
    'Ha a Fehér tábla vagy a Krémpapír témát választod, a sötét mód magától kikapcsol, így a háttér tényleg világos lesz.',
    'Fehér tábla és Krémpapír témában sötétebb lett a sárga, zöld és kék szöveg, hogy jobban olvasható legyen; a gombok pedig világosabb hátteret kaptak, így a feliratuk is jól olvasható.',
    'Ha elküldöd a játék linkjét, az üzenetben saját előnézeti kép jelenik meg.',
    'Közös ranglista: a gomb megbízhatóan megjelenik a kezdőképernyőn, és a ranglista a játékon belül nyílik meg, a beállított színvilággal.'
  ]},
  { version:'4.28', changes:[
    'Kezdőképernyő: kikerült az „Új vagy a játékban? Így működik” link, mert ugyanazt nyitotta meg, mint a Súgó gomb.'
  ]},
  { version:'4.27', changes:[
    'Sorozat: ha valaki 3 vagy több rajzot egymás után kitalál, a neve mellett megjelenik a 🔥 és a sorozat hossza (3, 5, 7 és 10 jó tippnél a chat is szól). Ha egy rajzot nem talál ki, a sorozata megszakad; ha a rajzoló passzol, nem változik semmi.',
    'Új jelvények a játék végén a meglévő két mellett: 🔥 Leghosszabb sorozat, 🥇 Villámkezű (legtöbbször ő találta ki elsőként), 🎯 Hibátlan tippelő (legalább 3 találat, rossz tipp nélkül), 🤪 Legbátrabb tippelő (a legtöbb tévedés).',
    'A statisztikád oldalon új „Jelvényeid” rész: hányszor nyerted el az egyes jelvényeket, és mi volt a leghosszabb sorozatod.'
  ]},
  { version:'4.26', changes:[
    'Gyorsreakció-korlát: 10 másodperc alatt legfeljebb 3 reakciót lehet küldeni (gombbal és billentyűvel is), utána egy kis felirat mutatja, mikor lehet újra. A többiek gépe is legfeljebb 4-et mutat 10 másodpercenként egy játékostól.'
  ]},
  { version:'4.25', changes:[
    'A már lerajzolt szavak ismétlésvédelme 30 napig tart: utána a szó magától újra előkerülhet.'
  ]},
  { version:'4.24', changes:[
    'Rossz tippnél a „−1” már nem a tipp mellett, hanem a játékos pontszáma mellett villan fel rövid időre.'
  ]},
  { version:'4.23', changes:[
    'Javítás iPhone-ra: a festékes vödör nem önti el többé az egész lapot.'
  ]},
  { version:'4.22', changes:[
    '12 új, vicces avatar (bohóc, ufó, robot, szellem, dínó, álruhás, cowboy, kaki, csirke, fagyos, bolondos, laza).',
    'Az avatarok középre kerültek, és sötét, enyhén színezett hátteret kaptak, így egyik sem olvad bele a saját színébe.'
  ]},
  { version:'4.21', changes:[
    'Javítás iPhone-ra: nem feketedik el többé a rajzvászon. Ha mégis megtörténne, a játék pár tized másodperc alatt helyreállítja a rajzzal együtt.'
  ]},
  { version:'4.20', changes:[
    'Pontozás: egy rossz tipp már csak 1 pontot ér, és azonnal levonódik, amint a rajzoló gépe elutasítja (a játékos pontszáma mellett rövid időre „−1” jelenik meg).  A pontszám 0 alá nem mehet.'
  ]},
  { version:'4.18', changes:[
    'Visszavonva a fülek: a „Szoba létrehozása” gomb és a nyitott szobák listája megint egyszerre látszik.',
    'Szín helyett avatart választhatsz (12 állat) — a többiek a neved mellett ezt látják. Régebbi verzión a hozzá tartozó szín látszik.'
  ]},
  { version:'4.17', changes:[
    'Új kezdőkártya: két fül („Szoba létrehozása” és „Csatlakozás”), alatta a neved, a színed és egy nagy gomb. A Csatlakozás fülön a nyitott szobák listája van, a fülön pedig látszik, hány szoba nyitott.',
    'Visszakerült a színválasztás: a nevednél ez a szín látszik a többieknek.'
  ]},
  { version:'4.16', changes:[
    'Kezdőképernyő: a „Szoba létrehozása” gomb közvetlenül a név alá került, így telefonon is görgetés nélkül látszik. A nyitott szobák listája alatta van.',
    'Meghívó linkkel érkezve a „Csatlakozás a partihoz” a fő gomb, a szobanyitás visszafogottabb.',
    'Rövidebb telefonos tipp, rövidebb gombfeliratok; gépen már nem lógnak ki az alsó gombok.'
  ]},
  { version:'4.15', changes:[
    'Frissített adatvédelmi tájékoztató.'
  ]},
  { version:'4.14', changes:[
    'Pontozás: minden rossz tipp −5 pontot ér a tippelőnek (akkor is, ha később kitalálja, vagy ha végül senki sem találja ki). A kör végén látszik, kinek hány rossz tippje volt. A pontszám 0 alá nem mehet. A rajzoló pontjai nem változtak, a szabotázsvédelem megmarad.'
  ]},
  { version:'4.13', changes:[
    'Javítás: a hibás szavak jelölése akkor is jól működik, ha nézők is vannak a szobában.'
  ]},
  { version:'4.12', changes:[
    'Az oldal újra nagyítható (akadálymentesség); a rajzlapon és a gombokon a nagyítás továbbra sem zavarja a rajzolást.'
  ]},
  { version:'4.11', changes:[
    'Gyorsreakciók az 1–7 számbillentyűkkel (a szám ott van a gombokon), és új reakció: 🤦 homlokra csapás.',
    'Javítás: előfordult, hogy két játékos jó kóddal sem találta meg egymást. Most megbízhatóan összekerülnek.',
    'Gyorsabb indulás, főleg rossz hálózaton.',
    'A jobb kattintásos menü újra működik az oldalon (linkek, szövegek, mezők); csak a rajzlapon és a gombokon marad letiltva.'
  ]},
  { version:'4.10', changes:[
    'Rajz-visszajátszás: nagyjából olyan tempóban játssza le a rajzot, ahogy készült, és lejátszás közben állítható a sebesség (0,5× – 4×). A kép már nem nyúlik meg, pontosan a rajz arányában jelenik meg.',
    'Tippelés hanggal: a tippmező melletti 🎙️ gombbal gépelés helyett ki is mondhatod a tippjeidet. Amíg be van kapcsolva, folyamatosan figyel; ha gyorsan több szót mondasz egymás után, mindegyik külön tippként megy el, és ha a gép rosszul hallotta, de valamelyik másik olvasata jó, az is számít. A kör végén magától kikapcsol. (Chrome-ban és iPhone-on Safariban működik.)',
    'Telefonos tippelő képernyő újratervezve: a visszaszámláló nem lóg bele a körszámlálóba, a rajzlap pontosan a rajz arányában jelenik meg (nincsenek üres sávok), a tipplista kitölti a maradék helyet, és a legújabb tipp közvetlenül a beíró mező fölött látszik. Nyitott billentyűzetnél semmi nem ugrál: a rajz és a lista arányosan zsugorodik.',
    'Megújult kezdőképernyő: áttekinthető kártyák (játékos beállításai, elérhető szobák, értesítő, súgó). A játékosszínt már nem kell választani — mindenki automatikusan kap egyet.',
    'Telefonról belépve egy bezárható jelzés javasolja, hogy ha lehet, laptopon, számítógépen vagy tableten játssz — rajzolni ott sokkal kényelmesebb.',
    'Új, részletes adatvédelmi tájékoztató. A közös ranglista bejegyzései 1 év után törlődnek.',
    'Új szoba értesítő: a kezdőoldalon megadhatod az e-mail címedet, és szólunk, ha valaki új nyilvános szobát nyit (legfeljebb 15 percenként egy levél). Először egy megerősítő levél érkezik, így senki nem iratkoztathat fel mást. Leiratkozni bármelyik levél alján, vagy a cím újbóli beírásával lehet. A kezdőoldalon látszik, hányan vannak feliratkozva.'
  ]},
  { version:'4.01', changes:[
    'Javítás: ha egy játékos kapcsolata menet közben megakadt, a tippek és a rajz fél percig is késhettek, aztán egyszerre jelentek meg. Most a játék néhány másodpercen belül észreveszi, ha a kapcsolat elakadt, újracsatlakozik, és minden közben elküldött üzenet megérkezik, duplázás nélkül.'
  ]},
  { version:'4.00', changes:[
    'Gyorsabb, stabilabb kapcsolat: a játék egy saját szerveren keresztül fut, így mindenki ugyanúgy, gyorsan csatlakozik. Ha a szerver épp nem érhető el, minden a régi úton működik tovább.',
    'Visszacsatlakozás: ha lezár a telefon vagy egy pillanatra elmegy a net, a szerver egy percig megtartja a helyedet, és a közben történteket visszatéréskor megkapod — a többiek észre sem veszik.',
    'Közös ranglista: a befejezett játékok eredménye (becenév + pont) a szerverre kerül, a kezdőképernyő „🏆 Közös ranglista” linkje mutatja az összesítést.',
    'Rajz-visszajátszás: a játék végi galériában egy rajzra koppintva a „▶️ Visszajátszás” gomb lejátssza, hogyan készült.'
  ]},
  { version:'3.86', changes:[
    'Stabilabb működés akkor is, ha egyszerre sokan játszanak.',
    'Frissített adatvédelmi tájékoztató.'
  ]},
  { version:'3.85', changes:[
    'Kitiltás: akit a szobanyitó kirúgott (vagy a többiek megszavaztak), az az eszközéről és az IP-címéről sem tud többé visszalépni abba a szobába. Ha valakit egy napon belül legalább két különböző szobából kirúgnak, egy hétre az egész játékból ki lesz tiltva.'
  ]},
  { version:'3.84', changes:[
    'Újratöltés után nem lesz „Név 2”: ha valaki újratölti az oldalt, miközben a régi kapcsolata még nincs lezárva, visszakapja a nevét, a pontjait és a helyét a sorrendben. Ha mégis „Név 2” lett belőle, amint a régi példánya lemarad, az új megkapja a saját nevét, és a nevek rendben maradnak a többiek képernyőjén is.',
    'Gyenge kapcsolat jelzése: ha valaki sorozatosan lemarad a játékból, vagy nem éri el a szobanyitót, megjelenik neki egy figyelmeztetés teendőkkel (wifi és mobilnet váltása, VPN kikapcsolása, nem beépített böngésző használata, újratöltés). A szobanyitó a chatben látja, ha valaki kapcsolata gyenge.'
  ]},
  { version:'3.83', changes:[
    'Szavak ismétlődése: ami az adott játékban egyszer lehetőségként megjelent (a három választható szó), az abban a játékban többet nem jön elő, akkor sem, ha a rajzoló kilépett, mielőtt választott volna. Az, amit valaki csak felajánlásként kapott, de nem rajzolt le, egy későbbi játékban megjelenhet. Amit lerajzoltak, az továbbra sem ismétlődik (amíg a szintről el nem fogynak a többi szavak).'
  ]},
  { version:'3.82', changes:[
    'Javítás: a hangerő-keverő (🎚️) és a témaválasztó (🎨) panelje átlátszó volt, átlátszott mögüle a háttér és a gombok. Most tömör hátterű, és a többi elem fölött jelenik meg.'
  ]},
  { version:'3.81', changes:[
    'Zenelépető: a hangerő-keverőben (🎚️) ⏮ / ⏭ gombbal lehet az előző vagy a következő számra lépni, és látszik az aktuális szám címe. A zene csak a menükben és a váróban szól, ezért a lépető is csak ott jelenik meg.'
  ]},
  { version:'3.80', changes:[
    'Az egyszemélyes mód megszűnt: a gépi játékos és a böngészős rajzfelismerő nem működött megbízhatóan. A játék visszaállt az egyszemélyes mód előtti állapotra (v3.70), minden más funkció — statisztika, chat, témák, szavak — változatlan.'
  ]},
  { version:'3.70', changes:[
    'A chat fejlécén új ⚙️ Beállítások gomb: itt állítható a chat betűmérete (Kicsi / Normál / Nagy / Óriás, vagy A− / A+ gombokkal 5%-onként, 70–180% között). A beállítást a gép megjegyzi.'
  ]},
  { version:'3.69', changes:[
    'Javítva: sötét módban a rajzlap melletti díszítő rajzok (ceruza, csillag, pálcikaember stb.) a sötétítés helyett világosabbak lettek. Most sötét módban halványabbak, mint világosban.'
  ]},
  { version:'3.68', changes:[
    'Új (gépen): a chat rögzíthető a képernyő bal vagy jobb széléhez oldalsávként — a fejlécén lévő 📌 gombbal, vagy úgy, hogy az ablakot a képernyő széléhez húzod. Ilyenkor a játék (a rajzlap is) a maradék helyen rendeződik el, így a chat semmit nem takar ki. Az oldalsáv belső széle húzással szélesíthető, a 🪟 gombbal pedig visszaalakítható lebegő ablakká. A beállítást a gép megjegyzi.'
  ]},
  { version:'3.67', changes:[
    'A „📊 Statisztikáim” ablak nagy képernyőn kiszélesedik, és úgy méreteződik, hogy görgetés nélkül, egyben látszódjon.'
  ]},
  { version:'3.66', changes:[
    'A „📊 Statisztikáim” ablak nagy képernyőn a játék többi részével arányosan nagyobb lett, és a címe alatt látszik, mióta gyűjti az eszköz a statisztikát.'
  ]},
  { version:'3.65', changes:[
    'Ami egyszer már feladvány volt bármelyik játékban, az többet nem kerül elő, amíg az adott szint összes szava el nem fogy.'
  ]},
  { version:'3.64', changes:[
    'Sötét módban a nevek melletti színes karikák, az animált gyorsreakciók, a reakció- és chatgombok, valamint az ünneplő effektek (konfetti, emojik) is sötétebbek lettek, hogy illeszkedjenek a többihez.'
  ]},
  { version:'3.63', changes:[
    'Szobanyitáskor a „Saját szavak a játékosoktól” résznél választható a „Nincsenek saját szavak” is: ilyenkor a váróteremben nem jelenik meg a saját szavak mezője, és csak a beépített szavakkal játszotok.'
  ]},
  { version:'3.62', changes:[
    'Több rejtett hiba javítva a körök és a szavak kezelésében:',
    '• A kör végén az „Én jövök” 10 másodperces visszaszámlálása a v3.54 óta 5 másodpercenként újraindult, így automatikusan sosem indult el a következő rajz.',
    '• Ha valaki menet közben belépett, a rajzoló eszköze ritkán újraszinkronizált, és ez eldobta a folyamatban lévő rajzát. Rajzolás (és szóválasztás) közben most soha nincs újraszinkron.',
    '• Újraszinkronnál az eszköz elfelejtette a már lerajzolt szavakat — most megtartja őket, így ebből sem lehet ismétlődés.'
  ]},
  { version:'3.61', changes:[
    'Javítva: néha magától „Megjelölted” állt egy szón, amit nem jelöltél meg. Egy korábbi játék jelölése „ragadt át” arra a körre, amelyik ugyanannál a rajzolónál ugyanannyiadik volt. A jelölés most a szóhoz és az adott játékhoz tartozik.',
    'Javítva: egy szó (pl. „kamionajtó”) egy játékon belül többször is előjöhetett. A többi felkínált szót a játék eddig elfelejtette elküldeni a többieknek, és aki lemaradt egy kör végéről, annál a lerajzolt szó sem került be a „már volt” listába. Most minden eszköz megjegyzi az összes lerajzolt és felkínált szót, akkor is, ha épp nem azt a kört nézte, és a szobanyitó pár másodpercenként egyezteti a lerajzolt szavak listáját.'
  ]},
  { version:'3.60', changes:[
    'A hibás szó megjelölése visszavonható akkor is, ha a kör végi képernyő már továbblépett: az „📋 Előző kör” ablakban is ott van a jelölés gombja. A gomb felirata egyértelműbb lett („↩️ Jelölés visszavonása”). Ha már elég jelölés gyűlt össze, a bejelentés nem vonható vissza, és ezt a játék ki is írja.'
  ]},
  { version:'3.59', changes:[
    'A kör végén a fő feliratban az is látszik, kinek a rajzáról volt szó, pl. „🎉 Kitti kitalálta Marci rajzát!”, „🎉 Eltaláltad Évi rajzát!”, „⌛ Lejárt az idő — senki nem találta ki Adam rajzát!”.'
  ]},
  { version:'3.58', changes:[
    'Javítva: ha az utolsó pillanatban választottál szót, a lejáró automatikus választás „lecsaphatott” egy másik szóra ugyanabban a pillanatban — te az egyiket rajzoltad, a játék a másikat várta. Mostantól ha az ujjad / egered már egy szón van, az automatikus választás nem lép közbe.',
    'A választás után 2 másodpercre nagy felirat mutatja: „✏️ Ezt rajzolod: …”, és a szó a rajzlap fölött is felvillan — így azonnal látszik, ha nem az lett, amire gondoltál.'
  ]},
  { version:'3.57', changes:[
    'Súlyos hiba javítva: ha a sorrend-egyeztetés miatt valaki túl korán elindította a saját rajzát, az a még futó rajzot „felülírhatta” a többieknél — a rajzoló pl. „zongorázás”-t rajzolt, a kör végén mégis „héja” jelent meg. Mostantól egy futó rajzot semmilyen későbbi rajz nem válthat le; aki túl korán indított, automatikusan visszalép, és a sorra kerülésekor rajzol. A rajzoló 5 másodpercenként megerősíti a saját futó körét, így a lemaradók is utolérik.'
  ]},
  { version:'3.56', changes:[
    'Javítva: egy saját szóként beküldött szó (pl. „vonalkód”) minden visszavágóban újra előkerült, és mivel saját szó mindig van a felkínáltak között, újra és újra felajánlotta a játék. Visszavágóban most már csak a még nem rajzolt saját szavak maradnak meg.',
    'Az eszköz megjegyzi az elmúlt játékokban rajzolt szavakat (kb. 600-at), és ezeket is kerüli, amíg van elég más szó — így a beépített szavak sem ismétlődnek játékok között.',
    'Chat: a szöveges smiley-k automatikusan emojivá alakulnak, pl. :D → 😄, :) → 🙂, :P → 😛, :O → 😮, ;) → 😉, <3 → ❤️, XD → 😆.'
  ]},
  { version:'3.55', changes:[
    'Javítva: aki lemaradt egy rajz indulásáról, annál „X most nézi a szavát” maradt kint, miközben a többiek már látták a rajzot. Az egyeztetés most a rajz állapotát is figyeli (szóválasztás / rajzolás / vége), és pár másodpercen belül beállítja a lemaradt eszközt.'
  ]},
  { version:'3.54', changes:[
    'Javítva: aki menet közben lépett be, lemaradhatott egy kör indulásáról, és utána rossz játékosra várt („Évire vár”), miközben a többiek már rá vártak. Mostantól a szobanyitó pár másodpercenként jelzi, hol tart a játék, és aki lemaradt, automatikusan újraszinkronizál. Ha a következő rajz az övé, megkapja az „Én jövök” gombot. A belépő a következő két rajz sorrendjét sem változtatja már meg.'
  ]},
  { version:'3.53', changes:[
    'Javítva: instabil kapcsolat a v3.50 óta. Aki telefonon háttérbe tette a játékot (pl. a szobanyitó, miközben elküldte a meghívót), azt 30 másodperc után kiléptette a játék — a szobanyitónál ez a szoba gazdájának cseréjét is okozta, és az újonnan belépők nem tudtak csatlakozni. Mostantól a háttérbe tétel csak jelzés („💤 háttérben”), senkit nem léptet ki. A „kilépek” jelzést is csak a ténylegesen bezáruló oldal küldi, és ha utána mégis jelentkezik, bent marad.'
  ]},
  { version:'3.52', changes:[
    'Új: 📊 Statisztikáim (a kezdőképernyőn és a játék menüjében). Játékidő, lejátszott játékok, győzelmek és dobogók, összes és legjobb pontszám; rajzolóként a kitalált rajzok aránya, a legkönnyebben és a legnehezebben kitalált szavad, és amit senki nem talált ki; tippelőként a találati arány, a leggyorsabb és az átlagos tippidő; és hogy kikkel játszol a legtöbbet. Csak az eszközödön tárolódik.'
  ]},
  { version:'3.51', changes:[
    'Új témák a 🎨 gomb alatt: Kávé, Smaragd, valamint két világos téma, a Fehér tábla és a Krémpapír. A világos témákon minden szöveg, keret és mező sötét színű lett, hogy mindenhol jól olvasható legyen; a sötét mód ezeken is működik.'
  ]},
  { version:'3.50', changes:[
    'Aki bezárja a játékot, azt a többiek kb. 10 másodpercen belül kilépettnek látják (eddig akár egy percig is bent maradt). Ha csak újratöltötte az oldalt, ez alatt visszatér, és megmarad a helye és a pontjai.',
    'Telefonon, ha valaki háttérbe teszi a játékot, a többiek látják („💤 háttérben”). Gépen a másik fülre váltás nem számít távollétnek.',
    'A játékoslistákon és a váróteremben halványan, „💤” jelöléssel látszik, akinek épp nincs kapcsolata, háttérben van, vagy épp kilép.'
  ]},
  { version:'3.49', changes:[
    'Javítva: a chatablak átméretezésekor a megfogott bal felső sarok követi az egeret, a szemközti (jobb alsó) sarok pedig a helyén marad — mint egy rendes ablaknál.'
  ]},
  { version:'3.48', changes:[
    'A chatablak áthelyezhető, mint egy Windows-ablak: a fejlécét lenyomva tartva (egérrel egyszerűen megfogva) húzhatod bárhová. A helyét megjegyzi; a fejlécre duplán kattintva visszakerül az alaphelyére.'
  ]},
  { version:'3.47', changes:[
    '„Mi ez?”: nem mutat olyan szócikket, ami csak névrokon (pl. film, zenekar, település, személy), és kiszűri a térképeket, zászlókat, címereket, logókat, diagramokat és portrékat. Ha mégis rossz a kép, a „🚫 Nem ez a kép” gombbal elrejthető, és annál a szónál többé nem jelenik meg.'
  ]},
  { version:'3.46', changes:[
    'Szobanyitáskor egyéni körszám is megadható (1–20) az „Egyéni:” mezőben.',
    'A tippelőknél az utolsó 15 másodpercben piros, pulzáló keret és nagy visszaszámláló jelzi, hogy fogy az idő; az utolsó 5 másodpercben még erősebben (telefonon rezgéssel).',
    'Chat: ha egyszerre többen írnak, az üzenetek mindig a megírás sorrendjében jelennek meg, a „gépel…” sor nem ugráltatja az ablakot, és nem ragad be, ha valaki abbahagyta a gépelést.'
  ]},
  { version:'3.45', changes:[
    'A chatablak PC-n nagyobb lett (420×560), és a bal felső sarkánál fogva átméretezhető; a méretet megjegyzi (dupla kattintás a sarokra: alapméret).',
    'A chat mindig az új üzenetre görget, ha alul vagy — akkor is, ha az ablak zárva volt. Ha visszagörgettél olvasni, egy „⬇ Új üzenet” gomb jelzi, hogy jött új üzenet.',
    'A kör végi pontlistán már nem szerepel, aki kilépett a játékból (a végső eredménynél „kilépett” jelöléssel megmarad, ha szerzett pontot).',
    'Ha valaki kilép, a hátralévő körök rövidebbek lesznek: annyi rajz jut egy körre, ahány játékos maradt (pl. 3 helyett 2).',
    'A tippmezőben rövidebb lett a várakozó szöveg, hogy kiférjen: „Még nem rajzol…”.'
  ]},
  { version:'3.43', changes:[
    'A „Mi ez?” nem mutat félrevezető fél-választ: összetett szónál csak akkor magyaráz, ha mindkét részt megtalálta, különben a képkeresést ajánlja. A leírás mindig egész mondatokból áll, nem vágódik el mondat közepén.'
  ]},
  { version:'3.42', changes:[
    'A „Mi ez?” gomb csak rajzolás közben látszik, a szóválasztásnál már nincs ott.',
    'A „Mi ez?” csak olyan leírást mutat, ami tényleg ahhoz a szóhoz tartozik. Összetett szavaknál (pl. hegedűhúr) a két részt magyarázza el külön (hegedű + húr). Ha nincs megbízható találat, ezt őszintén megírja, és a képkeresést ajánlja.'
  ]},
  { version:'3.41', changes:[
    'Új: „Mi ez?” segítség a rajzolónak. A felkínált szavak mellett és rajzolás közben a szó mellett is van egy kis ? gomb: rányomva megjelenik egy kép és egy rövid leírás a szóról (Wikipédiából), és egy gombbal képkeresés is indítható. Csak a rajzoló látja, a tippelők nem, és az óra közben megy tovább.'
  ]},
  { version:'3.40', changes:[
    'Új: három nehézségi szint. A korábbi „Nehéz” lista neve mostantól „Közepes”, és van egy új, valóban „Nehéz” szint is — ritkább tárgyak, fogalmak és elvont szavak (pl. délibáb, kentaur, szerelem, visszhang). A szobanyitásnál bármelyik kombináció választható, alapból a könnyű és a közepes van bekapcsolva.'
  ]},
  { version:'3.39', changes:[
    'Javítva (telefon): a rajzoló eszköztár jobb oldali ikonjai (radír, vissza, újra, törlés) túl kicsik voltak — most ugyanakkorák, mint a bal oldali eszközök.'
  ]},
  { version:'3.38', changes:[
    'Javítva (telefon): tippelés közben, ha a képernyőn húztad az ujjad, az egész játék elgörgett. Most csak a tipplista és a játékossáv görgethető, a többi rész nem mozdul.',
    'Új: néző mód. A kezdőképernyőn bejelölheted, hogy „Csak nézőként csatlakozom” — így mindent látsz élőben (rajz, tippek, pontok, csevegés), de nem rajzolsz, nem tippelsz és nem kapsz pontot. Ideális kivetítőhöz egy bulin. A nézők nem számítanak bele a létszámkorlátba, a váróteremben külön sorban látszanak, a szobanyitó eltávolíthatja őket, és futó játékhoz is csatlakozhatnak.'
  ]},
  { version:'3.37', changes:[
    'Ha a szobában már van ugyanilyen nevű játékos, az átnevezésről most egy jól látható, háttérrel ellátott ablak szól (régi név → új név), amit egy gombbal kell tudomásul venni.'
  ]},
  { version:'3.36', changes:[
    'Szóbejelentés: egy szó csak akkor számít hibásnak, ha legalább 2 játékos megjelöli — két játékosnál tehát mindkettőnek. Kettőnél több játékosnál továbbra is a játékosok legalább fele kell.',
    'A hibásnak jelölt szó azonnal kikerül a játékból, amíg át nem nézik.'
  ]},
  { version:'3.35', changes:[
    'Nagy képernyőn a váróterem (és minden kicsit túl magas képernyő) most kicsinyít, hogy görgetés nélkül kiférjen.',
    'Tippelni csak akkor lehet, ha a rajzoló már elkezdett rajzolni — addig a tippmező zárolva van.',
    'Nem lehet két azonos nevű játékos egy szobában: aki később lép be ugyanazzal a névvel (kis-nagybetűtől és ékezettől függetlenül), automatikusan sorszámot kap (pl. „Adam 2”), és erről értesítést is lát. Az oldal újratöltése után visszatérő játékos megtartja a nevét és a pontjait.'
  ]},
  { version:'3.34', changes:[
    'Nagy képernyőn minden képernyő (kezdő, szobanyitás, váróterem, kör vége, játék vége, "Te jössz!") ugyanabban a kitöltő keretben és ugyanakkora méretarányban jelenik meg, így az elrendezés egységes, nem ugrál a méret képernyőnként.'
  ]},
  { version:'3.33', changes:[
    'Nagy képernyőn a tippelő nézetben a rajz most kitölti az ablak teljes magasságát (eddig legfeljebb 760 pixel magas lehetett), és a tipp-oszlop is szélesebb.'
  ]},
  { version:'3.32', changes:[
    'Széles képernyőn a kezdőképernyő két oszlopos: balra a logó, jobbra a kártya. Nagy képernyőn (pl. teljes képernyős gépen) a kezdőképernyő, a szobanyitás, a váróterem és az eredményképernyők arányosan felnagyítva kitöltik az ablakot. Telefonon és a rajzoló/tippelő nézetben semmi nem változik.'
  ]},
  { version:'3.31', changes:[
    'Galéria: a rajzok alatt a kör tippjei is látszanak (ki mit tippelt, ✅ helyes, 🔥 közeli). A kártyán az utolsó 6, a rajzra koppintva az összes.',
    'Játék végén jól látható szavazópanel van a képernyő alján: hány igen van, ki mondott már igent, és egy visszaszámláló sáv. Az utolsó 10 másodpercben piros lesz és lüktet.'
  ]},
  { version:'3.30', changes:[
    'Ha többen ugyanazt a saját szót küldték be, a kitalálók akkor is megkapják a pontjukat. A saját szaváért csak a rajzoló nem kap pontot.'
  ]},
  { version:'3.29', changes:[
    'Saját szavak, új szabály: mindenki csak a saját maga által beküldött szavakat kaphatja rajzolásra, a többiekéit nem. Ha a rajzoló a saját szavát választja, ő nem kap pontot, a kitalálók viszont igen. A választásnál a szó mellett ott a jelzés: „Saját szavad · neked 0 pont”.',
    'A „Saját szavaid” mező tartalmát a játék nem jegyzi meg, és a szoba elhagyásakor kiürül.'
  ]},
  { version:'3.28', changes:[
    'Egy játékban egy szó csak egyszer kerül elő, sem feladványként, sem választható szóként. Eddig a fel nem választott szavak később újra előjöhettek, és a csak kis- és nagybetűben, ékezetben eltérő, illetve mindkét nehézségben szereplő szavakat a játék különbözőnek vette. Ha a saját szavak elfogynak, beépített szavak jönnek helyettük ismétlés helyett.',
    'Telefonon az „Előző kör” gomb csak ikonként (📋) jelenik meg, hogy elférjen.'
  ]},
  { version:'3.27', changes:[
    'Közeli tippért nem jár pont. Eddig az apró elírás vagy egy plusz rag (pl. „labdarúgó” a „labdarúgás” helyett) teljes értékű találatnak számított, most „közel!” jelzést kap, és pont nélkül fut tovább a kör. Az ékezet, a kis- és nagybetű és a szóköz továbbra sem számít.',
    'Szóbejelentés: a kör végén egy koppintással megjelölhető a hibás vagy értelmetlen szó. Ha a játékosok legalább fele megjelöli, a szót átnézzük. A saját beküldött szavak nem jelölhetők.',
    'Sötét módban minden szín sötétebb lett: gombok, kiemelések, rajzpaletta, menük. A sötét mód és a színvilág most már együtt is használható.',
    'A színvilág játék közben is állítható a ☰ Menüben.'
  ]},
  { version:'3.26', changes:[
    'Javítva: Firefoxban (és néhány jelszókezelőnél) a tippmező és a chat alatt nem ugrik fel többé „Új e-mail álnév” ajánlat.',
    'A chat és a gyors reakció gombja áthelyezhető: nyomd hosszan, húzd ahová szeretnéd, és engedd el. Ha a felül megjelenő „alaphelyzet” célra ejted, visszaugrik a helyére. Telefonon és gépen is működik, és az eszköz megjegyzi a helyét.',
    'Új körszámítás: egy kör most az, amikor mindenki egyszer rajzolt. A kijelzés például: „Kör 2 / 3 · 1/4. rajz”.',
    'A kör eredménye nem tűnik el, amikor a következő rajzoló megnyomja az „Én jövök” gombot. A tippelők addig az eredménynél maradnak, amíg a rajzoló szót választ, és csak a rajzolás indulásakor lépnek tovább (vagy ha a „Tovább” gombra koppintanak). Az előző kör eredménye a rajzolás alatt is visszanézhető az „📋 Előző kör” gombbal.'
  ]},
  { version:'3.25', changes:[
    'Fair saját szavak: a váróteremben minden játékos beküldhet legfeljebb 15 saját szót, a többiekét nem látja. A szobanyitó csak azt dönti el, hogy ezek a beépítettekkel keverve vagy önmagukban legyenek.',
    'Ha valaki a saját beküldött szavát találja ki, a tippjét elfogadjuk (csak ő látja), de nem jár érte pont, és a kört sem zárja le. A rajzoló pontjába sem számít bele. A saját szavadat te is rajzolhatod.',
    'A beírt saját szavaidat az eszközöd megjegyzi a következő játékra.'
  ]},
  { version:'3.24', changes:[
    'Javítva: gépen a tippmező (és a chat, a név, a szobanév és a szobakód mezője) alatt nem ajánl fel többé a böngésző vagy a jelszókezelő e-mail-címet, korábbi bevitelt vagy automatikus kitöltést.'
  ]},
  { version:'3.23', changes:[
    'Nagy képernyőn a rajzoló két oldalán a krétafirkák most a teljes magasságot kitöltik, és nem lógnak a rajzlap alá.',
    'Telefonon is új külső: a tippelőnél logó a felső sáv alatt, krétafirkás háttér, kártyás tippmező és tipplista; a rajzolónál lekerekített rajzlap és eszköztár.'
  ]},
  { version:'3.22', changes:[
    'Nagy képernyőn a rajzoló és a tippelő nézet is keretes táblán jelenik meg, fent középen a logóval, jobbra az időzítővel, a két oldalon halvány krétafirkákkal, így nem marad üres a kép széle.',
    'A tippelőnél: „Tippeld meg, mit rajzol!” cím, sárga papírrepülő küldés gomb, „Korábbi tippek” lista.'
  ]},
  { version:'3.21', changes:[
    'A rajzoló és a tippelő képernyő is megkapta a krétatáblás külsőt: lekerekített rajzlap árnyékkal, kártyás tipplista buborékokban, sötét eszköztár-sáv, egységes menü- és időzítőgombok, kiemelt saját szín és aktív eszköz.'
  ]},
  { version:'3.20', changes:[
    'Megújult kezdőképernyő: krétatábla-hangulat, új logó, nagyobb színválasztó, kiemelt „Szoba létrehozása” gomb, rendezettebb gombsor és lábléc. Minden színtémában és sötét módban is a téma színeit használja.',
    'A többi képernyő is megkapta az új külsőt: számozott lépések a szobanyitásnál (gépen kétoszlopos elrendezéssel), krétatáblás „Te jössz!” képernyő, a rajzoló eszköztárán vonalas ikonok és sárgán kiemelt aktív eszköz, halvány krétafirkák a rajzlap körül.'
  ]},
  { version:'3.18', changes:[
    'Új: saját szavak. Szobanyitáskor beírhatsz legfeljebb 150 saját szót, és eldöntheted, hogy a beépítettekkel keverve vagy csak ezekből játszatok. Ilyenkor a választható szavak között mindig ott van legalább egy saját.',
    'Új: saját statisztika a kezdőképernyőn (játékok, győzelmek, legjobb eredmény). Csak ezen az eszközön tárolódik.',
    'Új: Adatvédelem ablak a kezdőképernyőn, és egy gomb, amellyel minden helyben tárolt adatod törölhető.',
    'Akadálymentesség: a képernyő újra nagyítható (két ujjal), a képernyőolvasók felolvassák a chatet és az idő fogyását, a billentyűzetes fókusz jól látható.'
  ]},
  { version:'3.17', changes:[
    'Tartalék út: ha két eszköz nem tud közvetlenül kapcsolódni (router, iPhone, VPN, mobilnet), a játék magától egy másik úton megy tovább. A tartalom ilyenkor is titkosítva utazik.'
  ]},
  { version:'3.15', changes:[
    'Sötét módban a rajz színei is alkalmazkodnak: minden szín kicsit sötétebb és tompább, így nem vakítanak a sötét lapon (a fekete továbbra is világosszürke lesz). Csak a te képernyődön változik a megjelenés — a többiek a saját beállításuk szerint látják a rajzot, a galériába mentett kép pedig mindig az eredeti színekkel készül.'
  ]},
  { version:'3.14', changes:[
    'Javítva: ha tipp írása közben valaki kitalálta a szót, a félig beírt tipp a következő körben is ott maradt a tippmezőben. Most minden új kör üres tippmezővel indul.'
  ]},
  { version:'3.13', changes:[
    'Javítva: iPhone-on néhány kör után újra fekete lehetett a rajzlap. A játék minden kör végén készít egy képet a galériához, és az iOS ezeknek a memóriáját magától nem adta vissza; ha a rajzvásznak memóriakorlátja betelt, a rajzlap feketére váltott. Most ezek a vásznak használat után azonnal felszabadulnak, és a rajzlap tétlenség idején is magától frissül, így egy esetleges törlés után pár másodpercen belül helyreáll.'
  ]},
  { version:'3.12', changes:[
    'Javítva: ha játék közben egyetlen játékossal szakadt meg a kapcsolat (pl. egy közös wifin lévő iPhone-nal), a játék az egész szobát újraépítette, és ezzel a jó kapcsolatokat is elvágta — újra és újra. Most csak akkor épít újra, ha mindenkivel megszakadt a kapcsolat.'
  ]},
  { version:'3.11', changes:[
    'A hibadiagnózis felismeri, ha két eszköz ugyanazon a wifin van, és megmondja a teendőt.'
  ]},
  { version:'3.10', changes:[
    'Új: automatikus hibadiagnózis. Ha valaki nem tud csatlakozni, vagy megszakad a kapcsolat, a játék megmondja, hol a gond (a csatlakozó képernyőn, a váróteremben és a chatben).'
  ]},
  { version:'3.09', changes:[
    'Javítva: ha a játék végi szavazásnál a szobanyitót az időtúllépés kiléptette, a szoba a maradék egy játékossal a listán maradt, pedig már nem lehetett benne játszani. Most az ilyen szoba lekerül a listáról.',
    'Szobanyitáskor a játék szól, ha már van ugyanilyen nevű szoba a listán, hogy ne legyen két egyforma. Az automatikus névből („Adam szobája”) ilyenkor „Adam szobája (2)” lesz.'
  ]},
  { version:'3.07', changes:[
    'Rajzolás közben jóval kevesebb adat megy a hálózaton, ami rajztáblával és gyengébb kapcsolaton sokat számít.'
  ]},
  { version:'3.06', changes:[
    'Javítva: rajztáblával (és néha egérrel) előfordult, hogy a játék nem vette észre a toll felemelését, így a következő érintés összekötötte az új vonalat az előzővel. Most a felemelt toll lebegése már nem rajzol, és az új érintés mindig új vonalat kezd.'
  ]},
  { version:'3.05', changes:[
    'Rajztábla (Wacom és más tollas eszközök) támogatása: a vonal vastagsága követi a toll nyomását (a tippelők is így látják), a toll radír vége radírként működik, és a gyors tollmozdulatok is simák maradnak, mert a játék a toll minden mért pozícióját felhasználja. A toll oldalsó gombja nem nyit menüt a rajzlapon.'
  ]},
  { version:'3.04', changes:[
    'Javítva: aki gyorsan újratöltötte az oldalt (vagy összeomlott nála), azt a játék egy második, azonos nevű játékosként engedte vissza, a régi „szellem” példánya pedig mindenkit várakoztatott. Most a visszatérőt felismeri, és a régi helyére lép.',
    'Javítva: ha a rajzoló oldala rajzolás közben újratöltődött (összeomlott vagy frissítette), a játék visszaengedte, de tippelőként a saját körébe, így nem tudott rajzolni, a többiek pedig a kör végéig vártak. Most ilyenkor a félbemaradt kört azonnal a következő játékos veszi át új szóval, a visszatérő pedig megtartja a pontjait és a későbbi köreit.'
  ]},
  { version:'3.03', changes:[
    'Új: kapcsolati napló. A ☰ Menü → 📋 Kapcsolati napló másolása gombbal vágólapra tehető, és elküldhető, ha segítség kell egy kapcsolódási hibánál.'
  ]},
  { version:'3.02', changes:[
    'Új szín a rajzolásnál: zöld.',
    'Javítva: ha játék közben megszakadt a két eszköz közötti kapcsolat, mindketten azt látták, hogy a másik kilépett, pedig mindketten ott voltak. Most a játék a háttércsatornán ellenőrzi, hogy a másik még a szobában van-e; ha igen, nem jelzi kilépésnek, hanem magától újraépíti a kapcsolatot, és a játék onnan folytatódik.'
  ]},
  { version:'3.01', changes:[
    'Javítva: a tippelők visszaszámláló csíkja nem a rajzlap tetején futott, hanem túllógott rajta mindkét oldalon (főleg gépen). Most pontosan a rajzlap felső szélén halad, ahogy a rajzolónál.'
  ]},
  { version:'3.00', changes:[
    'Gépen a zene és a hangok akkor is szólnak, ha másik lapfülre vagy ablakra váltasz. Telefonon és tableten továbbra is elhallgatnak, amikor a játék a háttérbe kerül (másik app, lezárt képernyő).'
  ]},
  { version:'2.97', changes:[
    'Javítva: aki csatlakozáskor előbb egy másik játékossal kapcsolódott össze, mint a szobanyitóval, azt a játék „bent lévőnek” vette, pedig a szobanyitó nem látta (a többiek viszont igen). Most a csatlakozás csak akkor sikeres, ha a szobanyitóval is létrejött a kapcsolat; addig a játék tovább próbálkozik.',
    'A szobanyitó a váróteremben látja, ha valaki épp csatlakozni próbál („⏳ … csatlakozik…”).'
  ]},
  { version:'2.96', changes:[
    'Ha csatlakozáskor nem jön létre a kapcsolat a szobanyitóval, a játék magától újrapróbálja, és a hibaüzenet is megmondja, mi akadt el.'
  ]},
  { version:'2.95', changes:[
    'Javítva: a tűzijáték és a konfetti (főleg a játék végén) másodpercekre belassította, beszaggatta a játékot, leginkább telefonon. Az effektek most jóval kevesebb erőforrást használnak, kevesebb, de ugyanolyan látványos részecskével, időben elosztva; ha a készülék mégis lassulna, maguktól ritkulnak.'
  ]},
  { version:'2.94', changes:[
    'Új, megbízhatóbb szobalista, főleg iPhone-on: a telefon már nem veszíti el a más gépen nyitott szobákat.'
  ]},
  { version:'2.92', changes:[
    'A betű-súgó ismét csak a kör felétől jelenik meg (a szó hosszával és egy betűvel), utána fokozatosan, egyesével nyílik fel még néhány betű — legfeljebb a szó kb. fele, és legfeljebb 4 betű.'
  ]},
  { version:'2.91', changes:[
    'Javítva: a rajz egy idő után nem ott jelent meg, ahol az ujjad volt (főleg a lap alján és jobb szélén), és a rajzlap kisebb maradt a rendelkezésre álló helynél. Most a lap mindig kitölti a helyet, és pontosan az ujjad alá rajzol.',
    'Telefonon nagyobb lett a rajzlap: vékonyabb a tippsáv és kisebb az alsó margó, főleg kis képernyőn (iPhone mini, SE) és a Messenger böngészőjében.',
    'Javítva: iPhone-on a rajzlap néha fekete lett, sötétszürke vonalakkal (az iOS a háttérben — pl. egy gyors Messenger-váltásnál — törli a rajzlap memóriáját). Most a játék ezt észreveszi, és azonnal újrarajzolja a képet.',
    'Kikapcsolva a nagyítás dupla koppintásra és két ujjal: gyors, egymás utáni koppintás (pl. kétszer Vissza) már nem nagyít bele a játékba.'
  ]},
  { version:'2.90', changes:[
    'Új pontozás a rajzolónak: annyi pontot kap, amilyen gyorsan lerajzolta a szót — az utolsó módosításáig mérve (vonal, kitöltés, visszavonás, törlés). Csak akkor jár, ha valaki kitalálta. A „Mennyi pontot kap a rajzoló?” beállítás megszűnt.',
    'Érthetőbb beállítás: „Mikor ér véget a kör? — Az első helyes tippnél / Ha már mindenki kitalálta”. Tippelni mindkét esetben mindenki tud.'
  ]},
  { version:'2.89', changes:[
    'Új beállítás szobanyitáskor: „Mindenki kitalálhatja” — a kör addig tart, amíg mindenki eltalálta (vagy lejár az idő), és mindenki a saját gyorsasága szerint kap pontot. A rajzoló az átlagot kapja. A megoldás közben senkinél nem látszik.',
    'Új beállítás: a rajzoló kaphat fele annyi pontot, mint a tippelő. Két játékosnál így lesz győztes (eddig mindig döntetlen lett).',
    'Engedékenyebb tippellenőrzés: a szóköz és kötőjel nem számít, egy rövid rag belefér („hóemberek”, „biciklit”), hosszabb szónál egy elütés is. A nagyon közeli tippek automatikusan „közel!” jelölést kapnak.',
    'Betű-súgó: a szó hossza már a kör elejétől látszik, a betűk pedig véletlenszerű helyen nyílnak fel, nem mindig balról.',
    'Rajzolás közben a rajzoló nem írhatja be a megoldást a chatbe, és hangüzenetet sem küldhet. A „Mindenki kitalálhatja” módban ugyanez vonatkozik arra, aki már eltalálta.',
    'A Törlés visszavonható: a ↶ gomb visszahozza az egész rajzot. Új ↷ Újra gomb, gépen Ctrl+Z / Ctrl+Y.',
    'Új eszköz: téglalap. A vastagság mellett élő előnézet mutatja az ecset méretét és színét.',
    'Simább vonalak: a gyors mozdulat nem lesz szögletes.',
    'A festékes vödör minden eszközön pontosan ugyanúgy tölt ki, és hosszú rajznál sem lassul be a tippelők telefonja.',
    'Ha a játék motorja nem tud betöltődni (hálózati tiltás, reklámblokkoló), üres képernyő helyett érthető hibaüzenet és Újratöltés gomb jelenik meg.'
  ]},
  { version:'2.87', changes:[
    'Telefonon tippelőként is 3 tipp látszik egyszerre (eddig csak 1), ugyanúgy, mint rajzolóként: egy tömör sor tippenként.',
    'Új külsőt kapott a rajzoló „közel?” gombja: halvány sárga, lapos kapszula a zöld, domború gomb helyett.'
  ]},
  { version:'2.86', changes:[
    'A rajzolói képernyő gépen (és fekvő telefonon) rendbe téve: a rajzlap középen, a tipplista közvetlenül mellette, sötét kártyán; eltűnt a fehér sáv és a szürke doboz, az időcsík pedig a rajzlap tetején fut, nem a képernyő teljes szélességében.'
  ]},
  { version:'2.85', changes:[
    'A rajzlap mostantól minden eszközön négyzet alakú: amekkora részre a rajzoló rajzolni tud, pontosan azt látja mindenki más is, telefonon és gépen egyaránt. A lapon kívüli rész sötét, így egyértelmű, hol a rajzlap széle.',
    'A kör végén nem ugrik fel külön felirat a kör eredménye fölé: az eredményképernyő címe személyre szabott lett („Eltaláltad!”, „… kitalálta a rajzodat!”).'
  ]},
  { version:'2.84', changes:[
    'Javítva: telefonon a vonalvastagság-csúszka összenyomódott, csak a fogantyúja látszott. Most a színválasztóval együtt saját sort kap, teljes szélességben; az eszközgombok egy sorba férnek alatta.'
  ]},
  { version:'2.83', changes:[
    'Javítva: a vonalvastagság-csúszka telefonon nem mozdult. Most nagyobb, jól látható sárga fogantyúja van.',
    'A visszaszámláló a felső sáv közepére került, a rajzolónál és a tippelőknél is; a rajzolandó szó alatta, saját sorban látszik.',
    'A betűsegéd a rajzlap tetején középen jelenik meg, sötét alapon sárga keretben, így bármilyen színű a rajz, jól olvasható, és nem takarja a rajzolást.'
  ]},
  { version:'2.82', changes:[
    'Rajzolóként a túl hosszú szó lassan oda-vissza gördül, így végig olvasható; a nehézségi címke (Könnyű/Közepes) a rajzolói sávról kikerült.',
    'Telefonon a vonalvastagság-állító a középső sorba került, az eszközgombok alulra, és az alsó szél is több helyet kapott.',
    'Játék végén az „Akartok még egy partit?” kérdés csak akkor látszik, ha még van kivel játszani és még lehet rá válaszolni.',
    'A „Kilépés az egész szobából” link nem jelenik meg duplán a „Nem, kilépek” gomb mellett.'
  ]},
  { version:'2.81', changes:[
    'Rajzolás közben a rajzlapon kívüli véletlen húzás már nem görgeti a képernyőt.',
    'Telefonon a vonalvastagság-állító feljebb került, távol az alsó sávtól, ahonnan véletlenül ki lehetett lépni az alkalmazásból.',
    'Új szín a palettán: barna.'
  ]},
  { version:'2.80', changes:[
    'Fekvő mód telefonon teljesen átdolgozva: a játék a billentyűzet fölötti látható részhez igazodik, a chat és a reakció gomb a felső sávba került, a chat jobb oldali, teljes magasságú panelként nyílik, gépelés közben pedig a névsor és a feliratok eltűnnek, hogy a rajz és a beviteli mező kiférjen. A nagy (Pro Max) iPhone-okon is működik.'
  ]},
  { version:'2.79', changes:[
    'Mobilnetről csatlakozó telefon is megbízhatóbban megtalálja a szobát.'
  ]},
  { version:'2.78', changes:[
    'Javítva: lassú hálózaton (pl. mobilnetről) a csatlakozás gyakran csak a 3. próbálkozásra sikerült, mert a játék 12 másodpercenként megszakította és újrakezdte a majdnem kész kapcsolatot. Most egyetlen folyamatos próbálkozás tart legfeljebb 45 másodpercig, élő másodpercszámlálóval.'
  ]},
  { version:'2.77', changes:[
    'A kapcsolat állapota most a valóságot mutatja: csatlakozáskor „Keresem a szobát…”, sikertelen próbálkozás után pedig piros „Nem sikerült kapcsolódni” (korábban hibásan „Kapcsolódva” állt ott).',
    'Az állapotsor melletti ⓘ jellel megnyitható a hálózati jelentés.'
  ]},
  { version:'2.76', changes:[
    'Javítva: a zene (főleg iPhone-on) akkor is szólt, ha a játék a háttérben volt. Most elhallgat, és visszatéréskor folytatódik.',
    'Javítva: csatlakozáskor a próbálkozás-számláló csúnyán tört két sorba.'
  ]},
  { version:'2.75', changes:[
    'A QR-kód kikerült a váróteremből.',
    'Hangerő és sötét mód minden képernyőn: ahol nincs saját menü, a jobb felső sarokban ⚙️ gomb nyitja meg.',
    'Megszűnt a külön „Chat hang” kapcsoló: a chat hangját a Játékhangok hangereje szabályozza.',
    'Javítva: szóválasztáskor a szó egy pillanatra eltűnt, amikor ráállt a kurzor.',
    'Telepített webappban nem jelenik meg az iPhone wifis figyelmeztetés, mert ott úgysem javítható.',
    'Javítva: a meghívó linkről telepített webapp nem próbál minden indításkor ugyanabba a régi szobába belépni.',
    'A cenzúra (trágárságszűrő) kikerült a játékból.'
  ]},
  { version:'2.73', changes:[
    'Javítva: iPhone-on az „iPhone-kapcsolat javítása” gomb sikertelen próbálkozás után végtelen körben újra felajánlotta ugyanazt. Most a hiba oka látható marad, és csak akkor lehet újrapróbálni, ha annak van értelme.',
    'Új beállítás szobanyitáskor: hány szóból választhat a rajzoló a kör elején (1, 2, 3, 5, 7 vagy 10).',
    'A QR-kód csak a szobanyitó képernyőjén jelenik meg.',
    'Látványosabb effektek: tűzijáték és felugró felirat találatkor, lejárt időnél és a játék végén, pattogó szóválasztó gombok, pontszám-animáció.'
  ]},
  { version:'2.72', changes:[
    'Első indításkor egy háromlépéses, átugorható „Hogyan működik?” útmutató fogad — később a kezdőképernyő ❓ gombjával bármikor újra megnézhető.',
    'A váróteremben QR-kód jelenik meg: a többiek a telefon kamerájával beolvasva azonnal csatlakozhatnak.',
    'Szavazásos kizárás: a váróteremben a 🗳️ gombbal, játék közben a játékos nevére koppintva szavazhatsz valaki kizárásáról. Ha a többiek többsége egyetért, kikerül a szobából.',
    'Trágárságszűrő a nevekre, a chatre és a tippekre.',
    'Igazságosabb pontozás: a pontokat minden eszköz maga számolja ki az eltelt időből, így senki nem tud utólag pontot „csalni” magának.',
    'Samsung böngészőben és a Messenger/Facebook beépített böngészőjében felugró ablak javasolja az ajánlott böngészőt (Android: Chrome, iPhone: Safari).'
  ]},
  { version:'2.71', changes:[
    'Új visszaszámláló: kompakt kapszula egy fogyó körrel és egyenletes szélességű számokkal (pl. 1:05), a rajzlap tetején pedig egy vékony időcsík fogy. 20 másodpercnél sárgára, 10-nél pirosra vált. Telefonon és PC-n is.'
  ]},
  { version:'2.70', changes:[
    'Telefonon a chat a fejlécben lévő gombja alatt, felül nyílik meg, és a billentyűzet sem takarja ki.'
  ]},
  { version:'2.69', changes:[
    'Új telefonos játékképernyő: a rajzot semmi nem takarja. A tippek a rajz alatti sávba kerültek, a chat és a reakció gomb a fejlécbe, a rajzolandó szó az időzítő mellé, így a rajzlap nagyobb lett.',
    'Rajzolásnál a színek egy sorban, az eszközök és a Radír / Vissza / Törlés kompakt ikongombként, a vastagság a saját szín mellett.',
    'Tippelésnél a beírómező alul van, közvetlenül a billentyűzet fölött, és a képernyő a billentyűzet megnyitásakor sem csúszik el: a rajz, a tippek és a beírómező is látszik.'
  ]},
  { version:'2.68', changes:[
    'Kijavítva: ha telefonon nyitottál szobát, a telefon egy idő után átválthatott egy nem működő jelzőhálózatra, és a többiek nem látták a szobát. Most a telefon a megbízható úton marad.',
    'Kijavítva: telefonon a rajz fölötti tipplistában a „〰 közel” gomb nem volt megnyomható.',
    'Az „Ott vagy még?” kérdés csak akkor jön elő, ha a rajzoló még semmit nem rajzolt. Aki már rajzolt, azt nem zavarja, a kör ideje úgyis lejár.'
  ]},
  { version:'2.66', changes:[
    'Lassú hálózaton (pl. ha a wifi blokkolja a közvetlen kapcsolatot) több idő jut a kapcsolat felépítésére: 10 helyett 30 másodperc.',
    'iPhone-on a helyi-cím javítás gombja akkor is megjelenik, ha be van állítva közvetítő szerver, de a kapcsolat mégsem jön létre.'
  ]},
  { version:'2.65', changes:[
    'Megbízhatóbb szobakeresés, és ha a telefon nem talál senkit, magától más hálózatra vált.',
    'Új 🔄 Frissítés gomb a szobalistánál: újraépíti a keresést, ha a szoba nem jelenik meg.'
  ]},
  { version:'2.64', changes:[
    'A játék végén 30 másodperc van szavazni az új partira (visszaszámlálással). Aki addig nem mond igent, kikerül a szobából, így senki nem tudja a többieket feltartani, és az új parti csak az igent mondókkal indul.'
  ]},
  { version:'2.63', changes:[
    'Kijavítva: ha valakinek (főleg telefonon) csendben megszakadt a kapcsolata, a játék a többieknél néha nem vette észre, és örökké rá várt, például rajzolás közben vagy a következő kör indításánál. Mostantól minden eszköz pár másodpercenként jelzi, hogy még él, és aki 20 másodpercig hallgat, azt a szokásos türelmi idő után kilépettnek veszi a játék, és továbbadja a ceruzát.'
  ]},
  { version:'2.62', changes:[
    'Javítva: telefonon a szobalista játék közben megzavarhatta a kapcsolatot, és úgy tűnhetett, mindenki kilépett.'
  ]},
  { version:'2.61', changes:[
    'Telefonon a szobalista nem ragad be: ha 20 másodperc alatt senkit nem talál, magától más úton próbálkozik.'
  ]},
  { version:'2.59', changes:[
    'Háttérzene: az oldal betöltésekor és minden játék után véletlenszerűen választott zenével indul (egymás után kétszer nem ugyanazzal), onnan sorban megy tovább, és az utolsó után a lista elejéről folytatja.'
  ]},
  { version:'2.58', changes:[
    'A külön hang be/ki gomb megszűnt: a hangerő-szabályzóban a játékhangok és a zene mellett is van saját némítás gomb. Némításkor a csúszka a helyén marad, visszakapcsoláskor ugyanolyan hangos lesz.',
    'Minden, amit magadnak beállítasz, megmarad ezen az eszközön (böngészőben és a kezdőképernyőre tett alkalmazásban is): a neved, a színed, a téma, a sötét mód, a hangerők és némítások, a chat hangja, és a legutóbbi szobabeállításaid (nehézség, körök, idő, súgó, létszám, láthatóság, szobanév).'
  ]},
  { version:'2.57', changes:[
    'Javítva: iPhone-on a játék végi galériából nem lehetett rajzot menteni. Egy rajzra koppintva most nagyban megnyílik, a „Mentés / megosztás” gombbal (majd „Kép mentése”) a Fotókba menthető, vagy nyomva tartással is. Az „Összes egy képben” gomb iPhone-on szintén a megosztás menüt nyitja.'
  ]},
  { version:'2.56', changes:[
    'Új: háttérzene. A főmenüben és a szobában, a játék indulásáig szólnak a feltöltött zenék egymás után; induláskor fokozatosan elhalkulnak, majd leállnak.',
    'Új: a játékhangok és a zene hangereje külön állítható (a főoldal alján a 🎚️ gombbal, játék közben a ☰ menüben). Teljesen lehúzva néma. A beállítás ezen az eszközön megmarad.'
  ]},
  { version:'2.55', changes:[
    'Új: a rajzoló három szó közül választhat (ha mindkét nehézség be van kapcsolva, mindig van köztük könnyű és nehéz is). Ha 10 másodpercig nem választ, a játék dönt helyette. A „Passz” gomb ezzel megszűnt.',
    'Új rajzeszközök: kitöltés (festékes vödör), egyenes vonal és kör/ellipszis.',
    'Új: a játék végén galéria mutatja a parti összes rajzát a szavakkal. Egy rajzra koppintva letölthető, vagy az összes egyetlen képben menthető és megosztható.',
    'Új: ha a szobanyitó kilép, a szoba nem hal meg — valaki más automatikusan átveszi a szerepét (indítás, késők beengedése, új parti).',
    'Gyorsabb rajzközvetítés: részletes rajzoknál és lassú mobilneten sokkal kevesebb akadás.',
    'Javítva: ha megtelik a rajz (vonás- vagy pontkorlát), a rajzoló most üzenetet kap, és előtte figyelmeztetést is — eddig egyszerűen nem rajzolt tovább a toll.'
  ]},
  { version:'2.54', changes:[
    'Új: a rajzoló a tippek mellett megjelenő „〰 közel” gombbal megjelölheti, ha valaki közel jár a megoldáshoz. A tipp mindenkinél „🔥 közel!” jelzést kap, a tippelő pedig külön értesítést és egy kis hangjelzést. Pontot nem ad, csak segít.',
    'Új: ha telefonon a Messenger, a Facebook, az Instagram vagy más alkalmazás beépített böngészőjében, illetve a Samsung böngészőben nyitod meg a játékot, a főoldalon figyelmeztetés jelenik meg, mert ezekben gyakran nem jön létre a kapcsolat. Androidon egy gombnyomással átnyithatod Chrome-ba, iPhone-on a link másolásával Safariba.'
  ]},
  { version:'2.53', changes:[
    'Kijavítva: ha játék közben pár másodpercre átváltottál másik lapra vagy alkalmazásra, visszatérve a játék kidobott. A visszatérő telefon a még éppen újraépülő kapcsolatok miatt azt hitte, mindenki más kilépett, és a saját képernyőjén lezárta a játékot. Mostantól ilyenkor is türelmi idő jár, és a kapcsolat kiesése után 45 másodperc van a visszatérésre (eddig 12 volt). Aki szándékosan lép ki, az továbbra is azonnal eltűnik a többieknél.'
  ]},
  { version:'2.52', changes:[
    'Kijavítva: ha valaki újratöltötte az oldalt játék közben, és visszalépett, kétszer szerepelt a listában, a pontjai pedig kettéváltak a régi és az új példánya között. Mostantól, ha ugyanazzal a névvel tér vissza, átveszi a régi pontjait és a helyét a sorrendben.',
    'Kijavítva: egy kilépés vagy újracsatlakozás után a játékosok gépein eltérhetett a rajzolási sorrend, és előfordult, hogy két játékos kölcsönösen egymásra várt a következő kör indításával. Mostantól a sorrendet a szobanyitó gépe határozza meg és küldi el mindenkinek, így mindenki ugyanazt látja.'
  ]},
  { version:'2.50', changes:[
    'Javítva: telefonon nem jelent meg a szobalista, és nem lehetett csatlakozni egyetlen szobához sem.'
  ]},
  { version:'2.48', changes:[
    'Kijavítva: ha játék közben megnyitottad a menüt, és onnan kiléptél a szobából, a menü nyitva maradt a kezdőképernyőn. Mostantól bármilyen módon kerülsz ki a játékból (saját kilépés, „Ott vagy még?” időtúllépés, hiba), a menü bezáródik.',
    'iPhone-on a játék hangja mostantól a lenémított telefonon is szól (iOS 17-től), zajos háttérhangfájl nélkül. Ha a menüben kikapcsolod a hangot, a telefon visszakapja a szokásos néma üzemmódot.',
    'Telefonhívás, képernyőzár vagy alkalmazásváltás után a hang magától visszatér az első érintésre — eddig előfordulhatott, hogy ilyenkor végleg elnémult.',
    'Igazságosabb pontozás: a helyes tipp 50 alappontot ér, plusz legfeljebb 50 gyorsasági bónuszt (a kör hosszához arányítva). A rajzoló mostantól PONTOSAN ugyanannyit kap, mint a kitaláló — eddig fix 20 pontot kapott, bármi történt. Így aki szándékosan lassan vagy rosszul rajzol, ugyanannyit veszít vele, mint a tippelő, a többiekhez képest pedig csak magának árt. Ha senki nem találja ki, a rajzoló sem kap pontot.'
  ]},
  { version:'2.47', changes:[
    'A sötét mód mostantól nem csak a rajzvásznat sötétíti el, hanem az egész felületet: a hátteret, a tipp- és csevegő-beviteli mezőket, mindent. Amíg be van kapcsolva, a főképernyőn nem lehet másik játékszínt választani (a kettő ütközne) — a felső sávban a témaválasztó ilyenkor el is tűnik. A sötét mód mostantól a főképernyő alsó sávjából is be- és kikapcsolható, nemcsak a menüből.',
    'Kijavítva: sötét módban rajzolás közben a fekete szín élőben (még mielőtt elengedted az egeret/ujjadat) egy sötétebb szürkével jelent meg, mint utólag — most mindig ugyanaz a (világosabb, szimpatikusabb) szürke jelenik meg, akár rajzolás közben, akár utólagos újrarajzoláskor.',
    'Eltávolítva a telefonos néma mód megkerülésére szánt, folyamatosan futó halk hangfájl — sokaknak zavaró zajként hallatszott. A hang most megint teljesen néma, amíg valódi hatás nem szól bele.'
  ]},
  { version:'2.45', changes:[
    'Az „Ott vagy még?” ablakban van egy jelölőnégyzet: „Ebben a körben már befejeztem a rajzolást”. Ha bejelölöd, abban a körben a játék már nem kérdez rá újra, és nem is léptet ki inaktivitás miatt — a következő körödben viszont újra figyel.',
    'Telefonon a játék már nem nyúlik be a kijelző legtetejére: a felső sáv nem csúszik a bevágás (notch) és az állapotsor alá, fölötte mindig marad egy kis szabad hely.',
    'Telefonon a találgató képernyő felső sávja egyetlen sorba került: Kilépés gomb, hátralévő idő, a kör száma és (ha van) a betűsegéd egymás mellett. Nagyon keskeny kijelzőn a Kilépés gombon csak az ajtó ikon látszik.'
  ]},
  { version:'2.44', changes:[
    'Ha a rajzoló 30 másodpercig nem csinál semmit (nem rajzol, nem vált színt/vastagságot), felugrik egy „Ott vagy még?" kérdés. Ha erre sem érkezik válasz még 30 másodpercig (összesen 1 perc után), a rajzoló automatikusan kilép a szobából — akkor is, ha ő a szobanyitó.',
    'Kijavítva egy hibát, ahol egy telefon kijelzőjének elsötétülése (kilépés a képernyőzárba) a többieknél helyesen kilépésként jelent meg, de az érintett saját eszközén a játék tovább futott, csak már egyedül — a program mostantól a képernyő visszakapcsolásakor (és időnként háttérben is) ellenőrzi, hogy a többiek valóban még kapcsolatban vannak-e, és ha nem, ugyanúgy lezárja az állapotot, mintha rendesen kilépett volna valaki.'
  ]},
  { version:'2.43', changes:[
    'A v2.42 még csak fekvő módban tette teljes képernyőssé a találgató képernyőt — állóban, hiába görgettél fel teljesen, a tetején a Kilépés gomb és az időzítő a telefon állapotsora mögé csúszott, alul pedig a tipp-mező le tudott lógni a képernyőről. Mostantól a találgató képernyő MINDEN telefonos méretben (állóban és fekvőben is) a teljes kijelzőt kitöltő, rögzített panel — a jegyzőkönyv/időzítő a kijelző kivágása (bevágás, kezelősáv) alá van igazítva, a vászon és a tipp-doboz pedig úgy osztozik a helyen, hogy mindig kiférjen görgetés nélkül, és ne is lehessen elgörgetni mellőle.',
    'Minden új körnél — és így minden új játék elején is — az ecset visszaáll az alapértelmezett fekete színre és vastagságra, a radír pedig kikapcsol, függetlenül attól, mit állított be az adott játékos az előző körében.'
  ]},
  { version:'2.42', changes:[
    'Kijavítva a v2.41 igazi hiányossága: a nagy „PIC-ASS-O” cím, az alcím és az alsó sáv (verziószám, hányan játszanak, hang- és témaváltó) eddig MINDEN képernyőn ott maradt — a találgatásnál, a lobbiban, az eredményeknél is —, nem csak a kezdőlapon. Emiatt kellett görgetni álló módban, és emiatt tűnt túl nagynak a felső sáv fekvő módban, főleg Androidon. Mostantól ez a sáv csak a kezdőlapon látszik, minden más képernyő a teljes helyet a játéknak használja.'
  ]},
  { version:'2.41', changes:[
    'Fekvő (landscape) módban a rajzoló és a találgató képernyő is a vászon mellé teszi a tippsávot/csevegést, keskenyebb szegélyekkel — nem kell többé görgetni egy elforgatott telefonon, és a lobbi/eredmény képernyők is jobban kiférnek kis kijelzőn.',
    'Rajzolás (és általában a játék) közben a véletlen szövegkijelölés és az iOS-es kijelölő buborék ki van kapcsolva — a név, csevegés és egyéb beviteli mezők továbbra is normálisan kijelölhetők.',
    'A chat mostantól telefonon nem ugrik fel magától új üzenetnél: az ikon megpöccen, és a jelvény mutatja, hány olvasatlan üzenet van.',
    'A játék végén minden játékos szavazhat, hogy akar-e még egy partit: „Igen” esetén vár a többiekre, „Nem” esetén azonnal kilép. A szobanyitó csak akkor indíthat új partit, ha mindenki más is igent mondott.',
    'Hozzáadva a „Kezdőképernyőhöz adás” / telepíthető webapp támogatás: ikon, teljes képernyős indulás böngészősáv nélkül, mindkét tájolásban.'
  ]},
  { version:'2.39', changes:[
    'Megbízhatóbb csatlakozás akkor is, ha a közvetlen kapcsolat nem jön létre (pl. mobilnet, szigorú router).',
    'A szobalista nem állítja többé, hogy „Még nincs nyitva szoba", ha valójában csak nem sikerült kapcsolódni a többiekhez — ilyenkor ezt mondja ki.'
  ]},
  { version:'2.38', changes:[
    'Javítva: iPhone-on és Safariban a játék el sem indult.'
  ]},
  { version:'2.37', changes:[
    'iPhone / Safari: ha ugyanazon a wifin nem jön létre kapcsolat, megjelenik egy „📶 iPhone-kapcsolat javítása” gomb. Egyszer mikrofon-engedélyt kér, de semmit nem vesz fel, csak így engedi az iPhone a közvetlen kapcsolatot.',
    'A Messenger (Facebook, Instagram) beépített böngészője ezt a javítást nem engedi — ilyenkor a program azt javasolja, hogy nyisd meg az oldalt Safariban.'
  ]},
  { version:'2.36', changes:[
    'Biztonság: csalni nem lehet. Más pontszámát átírni, más nevében rajzolni vagy a játékot más helyett indítani nem lehet.',
    'Javítva: egy hibás rajzadat megakaszthatta a rajz megjelenítését a tippelőknél.',
    'Rajzolás: egyetlen koppintás is látszik (eddig a pont nélküli vonás láthatatlan volt), a második ujj nem veszi el a megkezdett vonást, a megszakított érintés (pl. bejövő hívás, képernyőforgatás) nem ragasztja be a rajzolást, és a nulla méretű rajzfelület sem okoz hibát.',
    'Hosszú rajznál kevesebb adat megy a hálózaton, a rajz ugyanaz marad.',
    'Javítva: menet közben belépve néha üres váróteremben ragadtál.',
    'Kilépéskor a mikrofon is leáll, a fül bezárásakor pedig a szoba azonnal lekerül a szobalistáról.',
    'Ha a szobanyitó kilép, a többiek egyértelmű jelzést kapnak róla (a lobbiban és a chatben is), hogy abban a szobában már nem indul új játék — eddig csak vártak.',
    'Chat: a régi üzenetek (és a bennük lévő hangfelvételek) egy idő után kikerülnek a listából, így hosszú játék alatt sem fogy el a memória. A megjelenő név mindig az, akit a játék az adott játékoshoz ismer, nem az, amit az üzenet állít magáról.',
    'Apróságok: a szobalétrehozás és a csatlakozás gombja nem indítható kétszer, a „Passz" és az „Én jövök" gomb nem okoz hibát elkésett kattintásra, a nem támogatott mikrofon/hangformátum érthető üzenetet kap, a konfetti-animáció pedig nem fut feleslegesen a háttérben.'
  ]},
  { version:'2.35', changes:[
    'Visszajelzés gomb a főképernyőn: hibát jelenthetsz, funkciót kérhetsz, vagy véleményt írhatsz (név és elérhetőség nélkül is).',
    'Chat: bármelyik üzenetre lehet emojival reagálni (👍 😂 ❤️ 😱 👏 🤔 😡) — a reakciók számlálóval jelennek meg az üzenet alatt, a saját reakciód újra megnyomva visszavonható. Korábbi üzenetre válaszolni is lehet: a válasz fölött megjelenik az idézett üzenet, amire kattintva odaugrik az eredetihez.',
    'A szoba a szobalistán marad, amikor elindul a játék ("🎮 Folyamatban" jelöléssel), és menet közben is lehet csatlakozni hozzá — rajzolás közben, kör vége képernyőn, sőt a játék vége után is (ilyenkor a visszavágóban már részt vesz). A szoba létszámkorlátját ilyenkor is betartja: ha megtelt, nem lehet belépni, de a kilépő játékosok helye felszabadul.',
    'Aki menet közben csatlakozik, megkapja a játék állását (pontok, kör, az addig megrajzolt vonalak, a betű-súgó, a hátralévő idő), a többiek pedig értesülnek róla. A hátralévő körök rajzolási sorrendjét a program újratervezi, hogy az újonnan érkező is sorra kerüljön; a körök száma nem változik, a soron következő kör sorrendjét pedig nem érinti.'
  ]},
  { version:'2.34', changes:[
    'Kijavítva: a chat emoji-listája kis kijelzőn (pl. Androidos telefonon) csak egy sort mutatott, mert a billentyűzet elvitte a helyet, és a lista összenyomódott. Most az emoji gomb megnyomásakor a billentyűzet bezárul (telefonon emoji beszúrása után sem ugrik vissza), a lista nem nyomódhat össze, és az üzenetek listája ad neki helyet.',
    'Kijavítva: telefonon tippeléskor a rajzfelület túl nagy volt, ezért a tipp beírására fel-le kellett görgetni. Most a rajzfelület úgy méreteződik, hogy a rajz és a tipp beírása is elférjen a képernyőn görgetés nélkül (kisebb oldalsó/felső margókkal). Ami eddig is elfért, az változatlan marad; a billentyűzet felugrása nem zsugorítja a rajzot.'
  ]},
  { version:'2.33', changes:[
    'Javítva: iPhone-on a szobalista keresése közben az oldal néhány másodperc után összeomlott.',
    'Összeomlás-védelem: ha az előző betöltés összeomlott, a szobalista magától nem indul újra (nehogy ismétlődjön), hanem a szobalista melletti feliratra koppintva kapcsolható be. Meghívó-linkkel ilyenkor is lehet csatlakozni.',
    'Új hibajelzés: a szobalista melletti állapotjelző (🟠) megmondja, ha talált másik játékost, de a két hálózat nem engedi a közvetlen kapcsolatot; a csatlakozási hibaüzenet is külön jelzi ezt.',
    'Új diagnosztika: a szobalista melletti ⓘ jelre koppintva látszik, hogy az eszközöd hálózata engedi-e a közvetlen kapcsolatot.',
    'Csatlakozáskor 12 mp jut egy próbálkozásra 9 helyett.'
  ]},
  { version:'2.32', changes:[
    'Böngésző-értesítés a szobanyitónak: ha valaki belép a szobádba vagy kilép belőle, a böngésző jelez (amíg másik fülön vagy ablakban vagy). Az engedélyt szoba létrehozásakor kéri a böngésző, a lobbiban pedig ki is látszik, hogy be van-e kapcsolva.',
    'Javítva: ha a játék végén mindenki más kilépett, majd új szobát hoztál létre, az új szoba beállító képernyőjén rögtön megjelent a régi "Időközben mindenki más kilépett a szobából…" üzenet. Az új szoba mostantól tiszta lappal indul, és a régi szoba késői eseményei sem zavarnak be.'
  ]},
  { version:'2.29', changes:[
    'Biztonság: a feladvány mostantól nem kerül ki a hálózatra. A szót csak a rajzoló eszköze ismeri; a tippeket is csak neki küldik el, ő ellenőrzi őket, és mindenkinek megmutatja az ellenőrzött tippet. A szó a kör végén, az eredménnyel együtt derül ki mindenkinek. Ezért a böngésző fejlesztői eszközeiből sem olvasható ki a megfejtés.'
  ]},
  { version:'2.28', changes:[
    'Gyorsreakciók: a 🔥 helyett 😡 (mérges fej) van.',
    'A rajzoló rajzolás közben is látja a feladványt (a képernyő tetején, a nehézségi szinttel együtt).',
    '10 másodperces visszaszámláló az "Én jövök — kezdem!", a "Megnézem a szót" és a "Kezdem a rajzolást!" gombokon: ha a játékos nem nyomja meg, a gomb magától megnyomódik.',
    'Javítva: ha ketten egyszerre találták el a szót, eszközönként más lehetett a nyertes, és dupla pont járt. Most a rajzoló dönt: az első hozzá érkező helyes tipp nyer, mindenkinél ugyanaz az eredmény.',
    'Javítva: ha a soron következő rajzoló kilépett, miközben a kör vége képernyő látszott, a játék örökre megállt. Most automatikusan a következő aktív játékos jön.',
    'Javítva: a visszaszámláló az eszközök órájának eltérése miatt máshogy járhatott a tippelőknél és a rajzolónál; a pontszám is ettől függött. Most mindenki a saját érkezési idejéhez méri, a pontot a rajzoló számolja. Ha a rajzoló eszköze nem jelzi az idő lejártát, a többiek pár másodperc után maguktól továbblépnek.',
    'Javítva: aki már elindult játékba próbált becsatlakozni, korábban egy üres váróteremben ragadt (hibákkal); most jelzést kap, hogy a játék már fut.',
    'Javítva: a "Passz" gomb után is azt írta ki, hogy lejárt az idő; most azt, hogy a rajzoló passzolt.',
    'Javítva: kilépéskor a régi szoba chatje bent maradt, és a visszaszámláló tovább futott a háttérben.',
    'Biztonság: egy játékos a nevével, színével, hangüzenettel vagy reakcióval kódot tudott csempészni a többiek oldalába; ezek most szűrve vannak. A kör végét csak a rajzoló jelenthet be.'
  ]},
  { version:'2.27', changes:[
    'A főképernyő szobalistájában most már a zárt (kódos) szobák is megjelennek, nem csak a nyilvánosak. Minden szobánál jól látható jelölés van: zöld "🌐 Nyilvános" vagy sárga "🔒 Zárt" címke és színes szél. Zárt szobára kattintva a kódot kell megadni (hibás kódnál azonnal jelzi), a kód a szoba lobbijában újra látható. A zárt szoba kódja soha nem kerül ki a listára, csak egy visszafejthetetlen ujjlenyomata.',
    'Gyorsreakciók: a név sötét, lekerekített címkén jelenik meg, így a fehér rajzvásznon is olvasható, és az animáció kb. 5 másodpercig látszik a korábbi ~2 helyett.',
    'Megszűnt az "extra kihívás-kártyák" opció: a szoba beállításai közül és a játékmenetből is kikerült.'
  ]},
  { version:'2.26', changes:[
    'A főképernyőről kikerült a "Csatlakozás kóddal" kártya: nyilvános szobába a listából, privát szobába a meghívó linkkel lehet belépni. A privát szoba lobbija ezért a kód helyett a meghívó-link másolását ajánlja.',
    'A "Szoba létrehozása" gomb kompakt, középre igazított gomb lett a nagy kártya helyett.',
    'Új játékos-sáv tippelés és rajzolás közben: minden belépett játékos állandóan látszik (színes körrel, névvel, ponttal; a rajzolót ✏️ jelzi, téged "Te"), és aki kilép, azonnal eltűnik belőle. Tippeléskor a küldő chipje felvillan.',
    'A tippek listája most a küldő színes körével és nevével jelenik meg, a saját tippjeid külön kiemelve; a rajzolónál is.',
    'Megbízhatóbb szobalista: a nyitott szobák gyorsabban megjelennek, a lejártak eltűnnek, és látszik, van-e kapcsolat.',
    'Kijavítva: ha egy képernyő magasabb volt a kijelzőnél (pl. a szoba beállításai telefonon), a teteje elérhetetlenül kicsúszott a képernyő fölé — most mindig görgethető.',
    'Kijavítva: a szoba láthatósága (privát/nyilvános) néha eltérhetett a kapcsoló állásától, ha előtte másik szobához csatlakoztál — így a szoba nem került fel a listára.'
  ]},
  { version:'2.25', changes:[
    'Nyilvános szoba meghívója: a szöveg most már kifejezetten megnevezi a szobát, és megmondja, milyen néven keresd a nyilvános szobák listájában.',
    'Rajzolás és tippelés közben a bal felső sarokban a kilépő ikon mellett felirat is van: "🚪 Kilépés".',
    'Kijavítva: a játék végén az "Új játék ezekkel a játékosokkal" gomb akkor is működött, ha közben mindenki más kilépett. Most letiltódik, és jelzi, hogy már nincs kivel folytatni — akkor is, ha a beállító képernyőn vagy éppen.',
    'Kijavítva: aki szándékosan kilép, azt a többiek azonnal látják (nem kell kivárni a kapcsolat-megszakadási türelmi időt), és az újrainduló játékba már nem kerülnek vissza kilépett játékosok.'
  ]},
  { version:'2.24', changes:[
    'Játékos-színek: a kezdőképernyőn 8 szín közül választhatsz magadnak — ez megjelenik pöttyként a neved mellett a lobbiban, a pontszámlálókban és a chatben is. Eszközönként megjegyzi magát.',
    'Betű-súgó (ki-be kapcsolható a beállításoknál): ha senki nem találja ki a szót, a kör 40%-ánál és 70%-ánál automatikusan felfed egy-egy betűt (legfeljebb a szó feléig).',
    'Végjáték-kitüntetések: a játék végén két apró "díj" jelenik meg a lejátszott meccs alapján — "⚡ Leggyorsabb tippelő" és "🎨 Legjobb rajzoló" (a mások által kitalált rajzokért kapott pontok alapján).',
    'Gyors reakció-emojik: rajzolás/tippelés közben egy 🙂 gombbal elküldhetsz egy gyors reakciót (👏 😂 😱 ❤️ 🤔 🔥), ami mindenkinél felvillan a képernyőn.'
  ]},
  { version:'2.23', changes:[
    'Az AI ellenfél kikerült a játékból.'
  ]},
  { version:'2.20', changes:[
    'Kijavítva: nyilvános szobánál a "Kapcsolódva — kód: ..." felirat még mindig kiírta a kódot a lobbi tetején — most csak annyit mutat, hogy "Kapcsolódva a szobához", sehol nem jelenik meg a kód.',
    'A szobából mostantól rajzolás és tippelés közben, illetve kör végén is bármikor ki lehet lépni egy "🚪" / "Kilépés a szobából" gombbal, nem csak a lobbiban vagy a végén.'
  ]},
  { version:'2.19', changes:[
    'A visszaszámláló mostantól középen, felül jelenik meg (nem a bal felső sarokban), és kicsit nagyobb méretben, mind a rajzolónál, mind a tippelőknél.'
  ]},
  { version:'2.17', changes:[
    'Rajzolás közben a beérkező tippek PC-n a rajzoló saját képernyőjén is jobb oldali sávban jelennek meg (nem egy vékony sávban alul), ugyanúgy mint a tippelőknél.',
    'Nagyobb rajzfelület PC-n, amikor más rajzol.',
    'A chat ablak automatikusan megnyílik, ha valaki üzenetet küld és a panel épp zárva volt — így nem marad észrevétlen.'
  ]},
  { version:'2.16', changes:[
    'Kijavítva: PC-n a rajzfelület túl hosszúvá vált a torzulás-javítás óta (görgetni kellett) — a rajzfelület mostantól reszponzív, mindig belefér a képernyőbe, arányát megtartva.',
    'Kijavítva: átadás után a soron következő játékosnak néha kétszer egymás után kellett rajzolnia.',
    'Nagyobb képernyőn a tippelő mezők a rajzfelület jobb oldalára kerülnek (nem alá), nagyobb, olvashatóbb betűmérettel.',
    'A létszámkorlátnál 2 és 3 fő is választható.',
    'Kijavítva: nyilvános, kód nélküli szoba esetén a kód többé nem jelenik meg a lobbiban, és a meghívó-link sem tartalmazza.'
  ]},
  { version:'2.15', changes:[
    'Nyilvános szoba létrehozási lehetőség: kód nélkül, egy kattintással csatlakozhatnak mások a listából (a privát szobák továbbra sem jelennek meg a listában, csak kóddal érhetők el).',
    'Maximum létszám beállítható egy szobánál — a limit felett senki sem tud csatlakozni.',
    'Kirúgás lehetősége a lobbiban: a szobanyitó indítás előtt eltávolíthat bárkit, aki nem kívánt módon csatlakozott.',
    'Öt választható megjelenési téma (Zöld tábla, Óceán, Éjkék neon, Naplemente, Grafit) a lábléc 🎨 gombjával, eszközönként megjegyezve.'
  ]},
  { version:'2.14', changes:[
    'Kijavítva: a rajz torzult (vertikálisan összenyomva jelent meg), ha a rajzoló és a néző eszköze eltérő alakú (arányú) képernyőt használt — pl. telefonon rajzolva, PC-n nézve. Mostantól minden eszköz a rajzoló valódi képernyő-arányát használja.',
    'Ez a kiadási napló — a verziószámra kattintva bármikor visszanézhető a teljes történet.'
  ]},
  { version:'2.13', changes:[
    'A "Szó: ❓❓❓❓❓" placeholder teljesen eltávolítva, sehol nem jelenik meg többé.'
  ]},
  { version:'2.12', changes:[
    'A csatlakozás megbízhatóbb: a szoba elérhetőségét most közvetlenül próbálja ellenőrizni (nem egy külön "szobalista" kapcsolattól függ), és lassabb hálózat esetén automatikusan újrapróbálkozik, mielőtt hibát jelezne.'
  ]},
  { version:'2.11', changes:[
    'Kijavítva: rövid hálózati akadozás (pl. telefon képernyőjének elsötétedése) miatt a játék tévesen "a másik fél kilépett" hibát jelzett — most türelmi időt kap a kapcsolat helyreállására.',
    'Látványos, mindenki számára megjelenő értesítés, ha a rajzoló ténylegesen kilép, és valaki más veszi át.',
    'A tippelők (és a rajzoló saját maga) elől is el van rejtve, hány betűből áll a szó.',
    'Meghívó-link a lobbiban: a kód begépelése helyett egy kattintással lehet csatlakozni.',
    'Képernyőolvasó-címkék az ikon-gombokra, figyelmeztetés, ha "Új játékot" indítanál, de már csak te maradtál a szobában.'
  ]},
  { version:'2.10', changes:[
    '"Új játék" a végén nem igényel új szobát — a szobanyitó új beállításokkal, ugyanazokkal a játékosokkal indíthat újra.',
    'Körszámlálás javítva (a beállított szám most a teljes játék összes körét jelenti, nem szorzódik a játékosok számával); új opciók: 10, 15, 20 kör.',
    'Chat üzenetek mellett megjelenik a küldés időpontja (óra:perc).',
    'Vissza gombok a beállítás- és csatlakozás-képernyőn, illetve "Szoba elhagyása" a lobbiban.'
  ]},
  { version:'2.8', changes:[
    'Élő "Jelenleg X játékos játszik" számláló a lábléc alján.'
  ]},
  { version:'2.7', changes:[
    'Az elérhető szobák listájából eltávolítva a belépési kód (azt csak a szobanyitótól közvetlenül lehet megtudni) — kattintásra a kód-beíró képernyőre visz, ahol a kódot be kell gépelni.',
    'Hover közben eltűnt a felesleges vízszintes görgetősáv a szobalistában.'
  ]},
  { version:'2.6', changes:[
    'Több szoba hozható létre egyszerre, mindegyik saját névvel.',
    'Valós idejű szobalista a kezdőképernyőn — amint valaki szobát nyit, azonnal megjelenik mindenkinél.'
  ]},
  { version:'2.5', changes:[
    'Csatlakozási hangjelzés, amikor valaki új játékosként belép.',
    'Néma/hangos kapcsoló a chat ablakban az új üzenet értesítési hangjához, saját, globális hangkapcsoló a lábléc alján.',
    'A játék neve mostantól PIC-ASS-O.'
  ]},
  { version:'2.4', changes:[
    'Emoji-választó a chatben.',
    'Gépelés-jelző ("X gépel…") valós időben.',
    'Kilépés / kapcsolat-megszakadás jelzése a chatben.',
    'Ha a rajzoló kilép rajzolás közben, automatikus átadás valaki másnak, új szóval.',
    'Ha csak 1 játékos marad, a játék automatikusan véget ér.'
  ]},
  { version:'2.3', changes:[
    'Chat ablak: szöveges üzenetek és rövid hangüzenetek küldése.',
    '"Senki nem találta ki" gomb átnevezve "Passz"-ra, és a "telefonodon" szövegek "saját eszközödön"-re javítva.'
  ]},
  { version:'2.2', changes:[
    'A játékosok száma nem előre beállítandó, hanem automatikusan annyi, amennyien csatlakoznak.',
    'Látványos animációk a kezdőképernyőn (lebegő ikonok, belépő animációk).'
  ]},
  { version:'2.0', changes:[
    'Teljes újraépítés: mindenki a saját eszközén játszik, a rajzoló képernyője a rajztábla, a többiek élőben tippelnek.'
  ]},
  { version:'1.5', changes:[
    'Csak könnyű és közepes nehézségi szint, sokkal több (kb. 270) új, konkrét, jól rajzolható szóval bővítve.'
  ]},
  { version:'1.4', changes:[
    'Minden feladvány kizárólag egyetlen szóból áll (korábban szólások és többszavas jelenetek is előfordultak).'
  ]},
  { version:'1.3', changes:[
    'Nehézségi szintek (Könnyű / Közepes / Nehéz / Rémálom) és kreatív "kihívás-kártyák" (pl. "csak egy színt használhatsz").',
    'Jobb egérgomb letiltva a rajzfelületen és az egész játékban.'
  ]},
  { version:'1.2', changes:[
    'Modernebb, réteges hangeffektek (kattintás, helyes/rossz tipp, lejárt idő, végjáték-fanfár).',
    '3, 4 és 5 perces időopciók a korábbi 30–120 mp mellett.'
  ]},
  { version:'1.1', changes:[
    'Több eszközön is játszható: a rajzoló saját eszköze a rajztábla, a többiek a sajátjukon tippelnek élőben.'
  ]},
  { version:'1.0', changes:[
    'Az első verzió: HTML alapú, 2–4 fős party rajzjáték. Rajzolás egérrel egyetlen közös eszközön, körbeadva; színválasztó, radír, visszaszámláló, pontszámítás, konfetti és hangeffektek.'
  ]},
];
