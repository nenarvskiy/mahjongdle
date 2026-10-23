# Инверсии порядка: значимые (дизайн-величины реально различаются) или дрожание почти равных.
# Запуск: py stats/tools/report_inversions.py [components.csv]
import csv
import sys
from pathlib import Path

DEFAULT = Path(__file__).resolve().parents[1] / "out" / "20m" / "components.csv"
path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
rows = list(csv.DictReader(open(path, encoding="utf-8")))

for grp in ("base", "structure", "yaku"):
    g = [r for r in rows if r["group"] == grp and int(r["count"]) > 0]
    print(f"=== {grp}")
    d = [float(r["designed_ev"]) for r in g]
    s = [float(r["ev"]) for r in g]
    inv_all = 0
    inv_meaning = []
    for i in range(len(g)):
        for j in range(i + 1, len(g)):
            if (d[i] - d[j]) * (s[i] - s[j]) < 0:
                inv_all += 1
                rel = abs(d[i] - d[j]) / max(d[i], d[j])
                if rel > 0.10:
                    inv_meaning.append((g[i]["name"], g[j]["name"], rel, d[i], d[j], s[i], s[j]))
    print(f"    всего инверсий: {inv_all}; из них у пар, различающихся по дизайну >10%: {len(inv_meaning)}")
    for a, b, rel, di, dj, si, sj in inv_meaning[:12]:
        print(f"      {a} ({di:.1f}) vs {b} ({dj:.1f})  разрыв {rel*100:4.0f}%  -> симуляция {si:.1f} / {sj:.1f}")
    # масштаб разброса дизайновых EV
    print(f"    разброс дизайновых EV: {min(d):.3f} .. {max(d):.3f}"
          f"  (коэффициент вариации {100*(max(d)-min(d))/ (sum(d)/len(d)):.1f}%)")