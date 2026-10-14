#!/usr/bin/env bash
# PIC-ASS-O játékszerver — telepítés és frissítés egy lépésben.
# Futtatás a Proxmox-konténerben, rootként:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Huncad/pic-ass-o/main/server/telepites.sh)
# Újrafuttatva frissít (letölti a legújabb verziót és újraindítja a szervert).
set -euo pipefail

BRANCH="${BRANCH:-main}"
DIR=/opt/pic-ass-o

echo "==> Csomagok (Node.js, git)…"
apt-get update -qq
apt-get install -y -qq nodejs npm git curl >/dev/null

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "HIBA: túl régi Node.js ($(node -v)). Debian 12 vagy újabb sablont használj." >&2
  exit 1
fi

if [ -d "$DIR/.git" ]; then
  echo "==> Frissítés ($BRANCH ág)…"
  git -C "$DIR" fetch -q --depth 1 origin "$BRANCH"
  git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  echo "==> Letöltés ($BRANCH ág)…"
  git clone -q --depth 1 --branch "$BRANCH" https://github.com/Huncad/pic-ass-o "$DIR"
fi

echo "==> Függőségek…"
cd "$DIR/server"
npm install --omit=dev --no-audit --no-fund -s

id picasso >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin picasso
mkdir -p /var/lib/picasso
chown picasso:picasso /var/lib/picasso

echo "==> Szolgáltatás…"
cp "$DIR/server/picasso.service" /etc/systemd/system/picasso.service
systemctl daemon-reload
systemctl enable -q picasso
systemctl restart picasso
sleep 1

if curl -fsS http://127.0.0.1:8787/api/health >/dev/null; then
  IP=$(hostname -I | awk '{print $1}')
  echo
  echo "✅ Kész! A szerver fut: http://$IP:8787/ranglista"
  echo "   Napló:    journalctl -u picasso -f"
  echo "   Frissítés: ugyanezt a parancsot futtasd újra."
else
  echo "❌ A szerver nem indult el. Nézd meg: journalctl -u picasso -n 50" >&2
  exit 1
fi
