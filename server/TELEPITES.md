# PIC-ASS-O játékszerver telepítése a mini PC-re

A szerver egy kis Debian-konténerben fut a Proxmoxon, és a **Tailscale Funnel** teszi elérhetővé az interneten egy állandó `https://…ts.net` címen. Így nem kell portot nyitni a routeren, és domain sem kell.

Ha a szerver valamiért nem fut, a játék magától a régi (P2P) úton megy tovább, tehát semmit nem lehet „elrontani”.

---

## 1. Debian sablon letöltése

1. Nyisd meg a Proxmox webfelületét (`https://192.168.50.250:8006`).
2. Bal oldalt a fában kattints a **local** tárolóra (a géped neve alatt).
3. Középen válaszd a **CT Templates** fület.
4. Kattints a **Templates** gombra.
5. A listában keresd meg a **debian-12-standard** sort, jelöld ki, és kattints a **Download** gombra.
6. Várd meg, amíg a felugró ablakban megjelenik a `TASK OK`, aztán zárd be.

## 2. Konténer létrehozása

1. Jobb felül kattints a kék **Create CT** gombra.
2. **General** fül:
   - Hostname: `picasso`
   - Password: adj meg egy jelszót (ezzel lépsz be a konsolban, `root` felhasználóval)
   - Az **Unprivileged container** maradjon bepipálva.
   - Jegyezd fel a **CT ID**-t (pl. `105`), később kell.
3. **Template** fül: Storage `local`, Template `debian-12-standard…`
4. **Disks** fül: Disk size `4` GB elég.
5. **CPU** fül: Cores `1`.
6. **Memory** fül: Memory `512`, Swap `512`.
7. **Network** fül: IPv4 **Static**, IPv4/CIDR `192.168.50.251/24`, Gateway `192.168.50.1`
   (ha a .251 foglalt, válassz egy másik szabad címet).
8. **DNS** fül: hagyd üresen (a gépét használja).
9. **Confirm** fül: a **Start after created** NE legyen bepipálva még. Kattints a **Finish** gombra.

## 3. Tailscale-engedély a konténernek

A Tailscale-nek kell egy speciális hálózati eszköz (`/dev/net/tun`), amit alapból a konténer nem kap meg.

1. Bal oldalt kattints a **Proxmox gépre** (nem a konténerre), majd fent a **>_ Shell** gombra.
2. Másold be ezt (a `105` helyére a saját CT ID-d kerüljön):

```bash
cat >> /etc/pve/lxc/105.conf <<'EOF'
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
EOF
```

3. Bal oldalt kattints a `picasso` konténerre, és fent a **Start** gombbal indítsd el.

## 4. A játékszerver telepítése

1. A `picasso` konténernél kattints a **>_ Console** gombra, és lépj be (`root` + a jelszavad).
2. Másold be ezt az egy sort:

```bash
apt-get update && apt-get install -y curl && BRANCH=test bash <(curl -fsSL https://raw.githubusercontent.com/Huncad/pic-ass-o/test/server/telepites.sh)
```

> Ha a `test` ágat már összefésülted a `main`-be, a két `test` szót írd át `main`-re.

3. A végén ezt kell látnod: `✅ Kész! A szerver fut: http://192.168.50.251:8787/ranglista`
4. Próbáld ki: a gépeden nyisd meg ezt a címet böngészőben. Az üres ranglistának kell megjelennie.

**Frissítés később:** ugyanezt a sort futtasd újra a konzolban.

## 5. Elérhetővé tétel az interneten (Tailscale Funnel)

Még mindig a konténer konzoljában:

1. Tailscale telepítése:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --hostname=picasso
```

2. Kiír egy `https://login.tailscale.com/…` linket. Nyisd meg, és jelentkezz be ugyanazzal a fiókkal, mint a Proxmoxnál.
3. Kapcsold be a nyilvános elérést:

```bash
tailscale funnel --bg 8787
```

4. Ha először csinálod, kiír egy linket, hogy engedélyezd a Funnelt (és a HTTPS-tanúsítványt) a fiókodban. Nyisd meg, kattints az engedélyezésre, aztán futtasd újra a fenti parancsot.
5. A végén kiírja a nyilvános címet, valami ilyesmit: `https://picasso.tail1234.ts.net`
6. **Teszt:** a telefonodon kapcsold KI a wifit (mobilnetről!), és nyisd meg: `https://picasso.tail1234.ts.net/ranglista`. Ha megjelenik, kész.

A `--bg` miatt ez újraindítás után is megmarad.

## 6. A játék rákötése a szerverre

A `js/picasso.js` elején (v4.30 előtt az `index.html`-ben) van egy sor:

```js
const PICASSO_SERVER_URL = '';
```

Ide kell beírni a Funnel címét (perjel nélkül a végén):

```js
const PICASSO_SERVER_URL = 'https://picasso.tail1234.ts.net';
```

Commit a `test` ágra → a Netlify branch deploy-on kipróbálod → ha jó, összefésülöd a `main`-be.

**Kipróbálás commit nélkül:** a játék oldalán a böngésző konzoljában (F12) futtasd:
`localStorage.setItem('picasso-server-url', 'https://picasso.tail1234.ts.net')`, majd töltsd újra az oldalt.
Visszaállítás: `localStorage.removeItem('picasso-server-url')`.

## Honnan tudom, hogy működik?

- A kezdőképernyőn a szobalista mellett ez áll: **🟢 kapcsolódva a játékszerverhez · N online**
- Megjelenik a **🏆 Közös ranglista** link.
- A kapcsolódási naplóban (ⓘ) `S01` és `hálózat: saját szerver` sorok vannak.

## Szójelentések titkos kulcsa (v4.12-től)

A lerajzolt és a hibásnak jelölt szavakat a játékszerver továbbítja a Netlify felé, egy közös titkos kulccsal. Ehhez **mindkét helyen ugyanaz** a legalább 24 karakteres, véletlen érték kell. A kulcsot **soha ne tedd fel a GitHubra**.

1. Készíts egy kulcsot a konténer konzoljában: `openssl rand -hex 24`
2. **Szerver:** hozd létre a `/etc/systemd/system/picasso.service.d/secret.conf` fájlt ezzel a tartalommal (a kulcsot írd be a helyére):

   ```
   [Service]
   Environment=WORDS_SECRET=ide-a-kulcs
   ```

   Utána: `chmod 600 /etc/systemd/system/picasso.service.d/secret.conf && systemctl daemon-reload && systemctl restart picasso`
3. **Netlify:** Project configuration → Environment variables → Add a variable. A kulcs neve `PICASSO_SERVER_SECRET`, az értéke ugyanaz a kulcs. A hatókörnél elég a Functions. Mentés után indíts egy új deployt (Deploys → Trigger deploy).

Ha a kulcs hiányzik, a játék működik, csak a közös szólisták nem frissülnek.

Nem kötelező beállítások: `WORD_USED_DAY_CAP` (alapból 300) és `WORD_BLOCK_DAY_CAP` (alapból 20) — ennyi szót jelezhet naponta összesen az egész játék.

## Hasznos parancsok (a konténer konzoljában)

| Mit | Parancs |
|---|---|
| Élő napló | `journalctl -u picasso -f` |
| Újraindítás | `systemctl restart picasso` |
| Állapot | `curl -s localhost:8787/api/health` |
| Funnel állapota | `tailscale funnel status` |
| Ranglista mentése | `/var/lib/picasso/games.json` (érdemes a Proxmox-mentésbe tenni) |
| Frissítés a `test` ágról | `BRANCH=test bash <(curl -fsSL https://raw.githubusercontent.com/Huncad/pic-ass-o/test/server/telepites.sh)` |

A szerver leállításkor (`systemctl stop/restart`) azonnal elmenti a ranglistát.

## Alternatíva: Cloudflare Tunnel

Ha van saját domained a Cloudflare-en, a Funnel helyett mehet Cloudflare Tunnel is (`cloudflared`), az is portnyitás nélkül működik. Ehhez a Zero Trust felületen kell egy Tunnel, ami a `http://localhost:8787` címre mutat. Szólj, ha erre váltanál.
