#!/usr/bin/env bash
# PIC-ASS-O: konténer létrehozása + szerver telepítése, a Proxmox gép Shelljéből.
# Futtatás a Proxmox HOST shelljében (nem konténerben):
#   bash <(curl -fsSL https://raw.githubusercontent.com/Huncad/pic-ass-o/test/server/proxmox-konterner.sh)
# Újrafuttatva nem hoz létre újat: a meglévő "picasso" konténert frissíti.
set -euo pipefail
BRANCH="${BRANCH:-test}"
say(){ echo; echo "==> $*"; }

command -v pct >/dev/null || { echo "Ezt a Proxmox gép Shelljében futtasd, ne konténerben." >&2; exit 1; }

ID=$(pct list | awk 'NR>1 && $NF=="picasso"{print $1}' | head -1)
if [ -z "$ID" ]; then
  ID=$(pvesh get /cluster/nextid)
  say "Debian sablon keresése…"
  pveam update >/dev/null 2>&1 || true
  T=$(pveam available --section system | awk '/debian-12-standard/{print $2}' | sort -V | tail -1)
  [ -n "$T" ] || { echo "Nem találom a debian-12 sablont." >&2; exit 1; }
  if ! pveam list local | grep -q "$T"; then say "Sablon letöltése ($T)…"; pveam download local "$T" >/dev/null; fi
  STORAGE=local-lvm
  pvesm status | awk 'NR>1{print $1}' | grep -qx local-lvm || STORAGE=local
  say "Konténer létrehozása (ID: $ID, tároló: $STORAGE)…"
  pct create "$ID" "local:vztmpl/$T" --hostname picasso --cores 1 --memory 512 --swap 512 \
    --rootfs "$STORAGE:4" --net0 name=eth0,bridge=vmbr0,ip=dhcp \
    --unprivileged 1 --features nesting=1 --onboot 1 >/dev/null
  cat >> "/etc/pve/lxc/$ID.conf" <<'EOF'
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
EOF
else
  say "Már van picasso konténer (ID: $ID) — frissítem."
fi

pct status "$ID" | grep -q running || { say "Indítás…"; pct start "$ID"; }
say "Várok a hálózatra…"
for i in $(seq 1 60); do
  pct exec "$ID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
  sleep 2
done

say "Játékszerver telepítése…"
pct exec "$ID" -- bash -c "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null && \
  BRANCH=$BRANCH bash <(curl -fsSL https://raw.githubusercontent.com/Huncad/pic-ass-o/$BRANCH/server/telepites.sh)"

say "Tailscale telepítése…"
pct exec "$ID" -- bash -c "command -v tailscale >/dev/null || (curl -fsSL https://tailscale.com/install.sh | sh >/dev/null)"

if pct exec "$ID" -- tailscale status >/dev/null 2>&1; then
  say "A Tailscale már be van jelentkezve."
else
  say "Tailscale bejelentkezés — nyisd meg az alábbi linket, és lépj be:"
  pct exec "$ID" -- tailscale up --hostname=picasso
fi

say "Nyilvános elérés (Funnel) bekapcsolása…"
if pct exec "$ID" -- tailscale funnel --bg 8787; then
  echo
  echo "✅ KÉSZ. A fenti https://…ts.net címet küldd el Claude-nak."
else
  echo
  echo "⚠️  Ha fent egy engedélyező linket látsz: nyisd meg, engedélyezd, aztán futtasd újra ugyanezt a parancsot."
fi
