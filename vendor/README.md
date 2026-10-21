# vendor/ — a játék saját példánya a Trystero és MQTT könyvtárakból

Azért van itt, hogy a játékoldalon ne fusson külső CDN-ről betöltött kód (v4.11).
Pontosan ugyanazok a rögzített verziók, mint korábban az esm.run-ról:
trystero@0.25.4, @trystero-p2p/torrent@0.25.4, @trystero-p2p/mqtt@0.25.4, mqtt@5.15.2.

Újraépítés (ha valaha verziót kell váltani — mindhármat EGYSZERRE, mert közös a magjuk):

    npm i trystero@X @trystero-p2p/torrent@X @trystero-p2p/mqtt@X mqtt@Y esbuild
    # belépési fájlok: export * from 'trystero' / '@trystero-p2p/torrent' / '@trystero-p2p/mqtt',
    # valamint egy mqtt.js, ami az mqtt modult default exportként adja tovább
    npx esbuild e/trystero.js e/trystero-torrent.js e/trystero-mqtt.js e/mqtt.js \
      --bundle --splitting --format=esm --minify --platform=browser \
      --outdir=vendor --chunk-names=chunks/[name]-[hash] --legal-comments=external

Utána az index.html-ben a VENDOR_V értéket is át kell írni.
