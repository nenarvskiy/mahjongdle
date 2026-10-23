# Одноразовый анализ прогона 100M (stats/out/100m) + сравнение с 20M.
import csv
import numpy as np

OUT = r"C:\Users\pyv20\OneDrive\Desktop\Работа\mahjongdle\stats\out"
N = 100_000_000


def read_hist(path):
    lo, hi, cnt = [], [], []
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            lo.append(float(row["lo"]))
            hi.append(float(row["hi"]))
            cnt.append(float(row["count"]))
    return np.array(lo), np.array(hi), np.array(cnt)


def read_components(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


lo, hi, cnt = read_hist(f"{OUT}/100m/score_hist.csv")
vals = np.where(lo == hi, lo, np.sqrt(lo * np.maximum(hi, lo)))
total = cnt.sum()
mean = float((vals * cnt).sum() / total)
cs = np.cumsum(cnt) / total
q = lambda p: float(np.interp(p, cs, vals))
print(f"рук: {int(total):,}  среднее: {mean:,.1f}  медиана: {q(0.5):,.0f}  мода: {int(lo[np.argmax(cnt[:4097])])}")
for p in (0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99, 0.999):
    print(f"  P{int(p*1000)/10:>4}: {q(p):>12,.0f}")
exact = lo == hi
for a, b, name in [(0, 100, "<=100"), (101, 1000, "101..1000"), (1001, 10000, "1001..10k"),
                   (10001, 100000, "10k..100k"), (100001, 1e10, ">100k")]:
    mask = (exact & (lo >= a) & (lo <= b)) | (~exact & (lo >= a) & (hi <= b))
    print(f"  {name:>12}: {cnt[mask].sum()/total*100:8.3f}%")

c = read_components(f"{OUT}/100m/components.csv")
c2 = read_components(f"{OUT}/20m/components.csv")


def ev_block(rows, group, n):
    return sum(float(r["points"]) for r in rows if r["group"] == group) / n


print("\n--- EV на руку, 100M ---")
tot = 0
for g in ("base", "structure", "yaku"):
    v = ev_block(c, g, N)
    tot += v
    print(f"  {g:>10}: {v:>10.2f}")
print(f"  {'ИТОГО':>10}: {tot:>10.2f}")

print("\n--- EV на руку, 20M (старая модель ака) ---")
tot2 = 0
for g in ("base", "structure", "yaku"):
    v = ev_block(c2, g, 20_000_000)
    tot2 += v
    print(f"  {g:>10}: {v:>10.2f}")
print(f"  {'ИТОГО':>10}: {tot2:>10.2f}")


def dist(rows, group, key, n):
    out = {}
    for r in rows:
        if r["group"] == group:
            out[key(r["name"])] = out.get(key(r["name"]), 0) + int(r["count"])
    return {k: v / n * 100 for k, v in out.items()}


order_s = ["2-шантен", "1-шантен", "Тенпай"]
order_t = ["Normal", "Манган", "Ханеман", "Байман", "Санбайман", "Якуман"]
ssplit = lambda nm: nm.split(" / ")[0]
tsplit = lambda nm: nm.split(" / ")[1]
s100 = dist(c, "base", ssplit, N)
s20 = dist(c2, "base", ssplit, 20_000_000)
t100 = dist(c, "base", tsplit, N)
t20 = dist(c2, "base", tsplit, 20_000_000)

print("\n--- Состояния, % рук ---")
print(f"  {'состояние':<12}{'100M':>10}{'20M':>10}{'maj_stat':>10}")
maj = [19.50, 2.33, 0.070]
for i, k in enumerate(order_s):
    print(f"  {k:<12}{s100.get(k,0):>10.3f}{s20.get(k,0):>10.3f}{maj[i]:>10.3f}")
print(f"  {'>=3':<12}{100-sum(s100.values()):>10.3f}{100-sum(s20.values()):>10.3f}{78.10:>10.3f}")

print("\n--- Тиры, % рук ---")
print(f"  {'тир':<12}{'100M':>10}{'20M':>10}{'дельта':>10}")
for k in order_t:
    print(f"  {k:<12}{t100.get(k,0):>10.3f}{t20.get(k,0):>10.3f}{t100.get(k,0)-t20.get(k,0):>+9.3f}")

print("\n--- База: ячейки, отклонение от дизайна (100M) ---")
cells = {}
for r in c:
    if r["group"] == "base":
        cells[(r["name"].split(" / ")[0], r["name"].split(" / ")[1])] = r
for st in order_s:
    for k in order_t:
        r = cells[(st, k)]
        flag = "  <--" if int(r["count"]) > 1000 and abs(float(r["ratio"]) - 1) > 0.1 else ""
        print(f"  {st:<12} {k:<10} рук {int(r['count']):>10,}  EV {float(r['ev']):>8.2f} "
              f"диз {float(r['designed_ev']):>8.2f}  x{float(r['ratio']):.2f}{flag}")

print("\n--- Структуры: EV и отклонение (100M) ---")
srows = sorted((r for r in c if r["group"] == "structure"), key=lambda r: -float(r["points"]))
for r in srows:
    flag = "  <--" if int(r["count"]) > 1_000_000 and abs(float(r["ratio"]) - 1) > 0.15 else ""
    print(f"  {r['name']:<24} рук {int(r['count']):>12,}  EV {float(r['points'])/N:>7.3f}  x{float(r['ratio']):.2f}{flag}")

print("\n--- Яку: EV и отклонение (100M) ---")
yrows = sorted((r for r in c if r["group"] == "yaku"), key=lambda r: -float(r["points"]))
for r in yrows:
    flag = "  <--" if int(r["count"]) > 10_000 and abs(float(r["ratio"]) - 1) > 0.1 else ""
    print(f"  {r['name']:<24} рук {int(r['count']):>12,}  EV {float(r['points'])/N:>7.3f}  x{float(r['ratio']):.2f}{flag}")
