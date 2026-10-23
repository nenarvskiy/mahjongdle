import csv, io, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load(p):
    rows = {}
    with io.open(p, encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            kind = (r.get('kind') or '').strip()
            rid = (r.get('id') or '').strip()
            lab = (r.get('label') or '').strip()
            try:
                pph = float(r.get('points_per_hand') or 0)
            except ValueError:
                pph = 0.0
            rows[(kind, rid or lab)] = pph
    return rows

a_p = os.path.join(BASE, 'out', 'old', 'yaku100m', 'components.csv')
b_p = os.path.join(BASE, 'out', 'old', '20m-yaku-1020', 'components.csv')
a = load(a_p)
b = load(b_p)

lines = []
for kind in ('structure',):
    keys = sorted(k for k in a if k[0] == kind)
    ta = tb = 0.0
    for k in keys:
        va = a[k]
        vb = b.get(k, 0.0)
        ta += va
        tb += vb
        d = (vb - va) / va * 100 if va else 0.0
        lines.append('%-10s %-14s %10.3f %10.3f  %+7.2f%%' % (kind, k[1], va, vb, d))
    d = (tb - ta) / ta * 100 if ta else 0.0
    lines.append('TOTAL      %-14s %10.3f %10.3f  %+7.2f%%' % (kind, ta, tb, d))

ka = sorted(k for k in a if k[0] == 'yaku')
ta = tb = 0.0
for k in ka:
    va = a[k]
    vb = b.get(k, 0.0)
    ta += va
    tb += vb
lines.append('')
lines.append('TOTAL yaku %10.3f %10.3f  %+7.2f%%' % (ta, tb, (tb - ta) / ta * 100 if ta else 0.0))
for k in ka:
    if 'peikou' in k[1]:
        lines.append('yaku %s: %.3f -> %.3f' % (k[1], a[k], b.get(k, 0.0)))

dst = os.path.join(os.environ.get('TEMP', '.'), 'mj_cmp.txt')
with io.open(dst, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('rows_a=%d rows_b=%d -> %s' % (len(a), len(b), dst), flush=True)
