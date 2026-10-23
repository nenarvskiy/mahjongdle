# Насколько сохраняется порядок «дизайн vs симуляция» и как весомы выбросы.
# Запуск: py stats/tools/report_rank_check.py [components.csv]
import csv
import math
import sys
from pathlib import Path

DEFAULT = Path(__file__).resolve().parents[1] / "out" / "20m" / "components.csv"
path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
rows = list(csv.DictReader(open(path, encoding="utf-8")))
N = sum(int(r["count"]) for r in rows if r["group"] == "base")  # всего рук


def spearman(a, b):
    n = len(a)
    ra = {v: i for i, v in enumerate(sorted(a))}
    rb = {v: i for i, v in enumerate(sorted(b))}
    xa = [ra[v] for v in a]
    xb = [rb[v] for v in b]
    ma = sum(xa) / n
    mb = sum(xb) / n
    num = sum((xa[i] - ma) * (xb[i] - mb) for i in range(n))
    da = math.sqrt(sum((v - ma) ** 2 for v in xa))
    db = math.sqrt(sum((v - mb) ** 2 for v in xb))
    return num / (da * db)


def flips(a, b):
    n = len(a)
    f = 0
    for i in range(n):
        for j in range(i + 1, n):
            if (a[i] - a[j]) * (b[i] - b[j]) < 0:
                f += 1
    return f, n * (n - 1) // 2


for grp in ("base", "structure", "yaku"):
    g = [r for r in rows if r["group"] == grp and int(r["count"]) > 0]
    d = [float(r["designed_ev"]) for r in g]
    s = [float(r["ev"]) for r in g]
    print(f"=== {grp}: ячеек со счётом > 0: {len(g)}")
    print(f"    Спирмен(дизайн, симуляция) = {spearman(d, s):.3f};  инверсий пар: {flips(d, s)[0]} из {flips(d, s)[1]}")
    tot_pts = sum(float(r["points"]) for r in g)
    for lo, hi, lab in ((0.0, 0.5, "<0.5x"), (0.5, 2.0, "0.5-2x"), (2.0, 3.0, "2-3x"), (3.0, 1e9, ">3x")):
        sel = [r for r in g if lo <= float(r["ratio"]) < hi]
        pts = sum(float(r["points"]) for r in sel)
        print(f"    {lab:>7}: {len(sel):>2} ячеек | их очки = {pts / N:8.3f} EV/руку = "
              f"{pts / tot_pts * 100 if tot_pts else 0:5.1f}% суммы группы")
    print("    ячейки вне 0.5-2x:")
    for r in g:
        rt = float(r["ratio"])
        if 0.5 <= rt <= 2.0:
            continue
        c = int(r["count"])
        sig = 1 / math.sqrt(c) if c else 0
        noise = abs(rt - 1) < 2 * sig * max(rt, 1.0)
        print(f"      {r['name']:24} ratio {rt:5.2f}  n={c:>9,}  1-сигма шум {sig * 100:5.1f}%  "
              f"{'в пределах шума' if noise else 'СИСТЕМАТИЧЕСКИЙ'}")