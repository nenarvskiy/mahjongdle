# Проверка: shanten_fast (концепт игры) == analyze (mode 1) по шантену, + max-han.
# Запуск: py stats/tools/check_shanten.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import scorestat as ss

rng = np.random.default_rng(11)
N = 2000
maxc = np.zeros(34, np.int64)
sufH = np.zeros(37, np.int64)
iso = np.zeros(40, np.int64)
W = np.zeros(34, np.int64)
trip = np.zeros(34, np.int64)
seq = np.zeros(34, np.int64)
pairp = np.zeros(1, np.int64)
bestcost = np.zeros(ss.LIM + 1, np.int64)
bestfin = np.zeros(ss.LIM + 1, np.int64)
par = np.zeros(ss.PAR_SIZE, np.int64)
ind = 31
ura = 5
rw, sw, riichi, aka = 27, 29, int(ss.CFG_RULES.get("riichiHan", 1) or 0), 1

mismatch = 0
dist = [0, 0, 0, 0]
for h in range(N):
    deck = np.arange(136)
    rng.shuffle(deck)
    H = np.zeros(34, np.int64)
    for t in deck[:13]:
        H[t // 4] += 1
    s_fast = ss.shanten_fast(H)
    # красные пятёрки: вероятность n/4 (в стене один красный тайл на масть)
    for kind, slot in ((4, ss.P_AKA_M), (13, ss.P_AKA_P), (22, ss.P_AKA_S)):
        par[slot] = 1 if (H[kind] > 0 and rng.random() < H[kind] * 0.25) else 0
    s_an, han, han_fin = ss.analyze(H, ind, ura, rw, sw, riichi, 0, aka, maxc, sufH, iso, W,
                                    trip, seq, pairp, bestcost, bestfin, par, 3)
    s = min(s_fast, 3)
    dist[s] += 1
    # analyze с lim = s_fast+1 должен дать те же ханы при совпадающем шантене
    if s_fast <= 2:
        s_an2, han2, han_fin2 = ss.analyze(H, ind, ura, rw, sw, riichi, 0, aka, maxc, sufH,
                                           iso, W, trip, seq, pairp, bestcost, bestfin, par,
                                           s_fast + 1)
        if s_an2 != s_fast or han2 != han or han_fin2 != han_fin:
            mismatch += 1
            if mismatch <= 5:
                print(f"lim-mismatch h={h}: fast={s_fast} (s2={s_an2}, han2={han2}/{han_fin2}) "
                      f"vs full s_an={s_an} han={han}/{han_fin}")
                print("H:", H)
            continue
    ok = (s_fast == s_an) if s_fast <= 2 else (s_an == -1)
    if not ok:
        mismatch += 1
        if mismatch <= 5:
            print(f"shanten mismatch h={h}: fast={s_fast} analyze={s_an} han={han}/{han_fin}")
            print("H:", H)

print(f"проверено: {N}, рассогласований шантен: {mismatch}")
print("распределение:", dist)
