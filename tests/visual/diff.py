# PIC-ASS-O — két képernyőkép-mappa összevetése (v4.30, v4.31: zajtűrés)
# Használat: python3 tests/visual/diff.py <régi mappa> <új mappa> [<diff mappa>]
# Egy kép akkor "azonos", ha legfeljebb NOISE_PX képpont tér el érezhetően
# (élsimítás, betűrajzolás apró különbségei nem számítanak eltérésnek).
import os, sys
from PIL import Image, ImageChops
NOISE_PX = 40
a, b = sys.argv[1], sys.argv[2]
outd = sys.argv[3] if len(sys.argv) > 3 else None
if outd: os.makedirs(outd, exist_ok=True)
bad = 0
for f in sorted(os.listdir(a)):
    if not f.endswith('.png'): continue
    pb = os.path.join(b, f)
    if not os.path.exists(pb): print('HIÁNYZIK', f); bad += 1; continue
    ia, ib = Image.open(os.path.join(a, f)).convert('RGB'), Image.open(pb).convert('RGB')
    if ia.size != ib.size:
        print(f'MÉRET  {f}: {ia.size} -> {ib.size}'); bad += 1; continue
    d = ImageChops.difference(ia, ib).convert('L')
    box = d.getbbox()
    if not box: print(f'azonos {f}'); continue
    px = d.point(lambda v: 255 if v > 24 else 0).histogram()[255]
    if px <= NOISE_PX: print(f'azonos {f} (zaj: {px} képpont)'); continue
    print(f'ELTÉR  {f}: {px} képpont, terület {box}')
    bad += 1
    if outd: d.point(lambda v: 255 if v > 24 else 0).save(os.path.join(outd, f))
print(f'— {bad} eltérő kép')
sys.exit(1 if bad else 0)
