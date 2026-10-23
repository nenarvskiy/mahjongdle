# Проверка: partition_v4 (DP) == bp (рекурсия, сверенная с naive) по score и блокам.
# Запуск: py stats/tools/check_partition.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import scorestat as ss

rng = np.random.default_rng(7)
N = 4000
mismatch = 0
maxopt = 0
for p in range(9):
    maxopt = max(maxopt, ss.OPT_CNT[p])
print("max options per pos:", maxopt)

D = np.zeros(10 * ss.N_SUIT_STATES, np.int64)
G = np.zeros(10 * ss.N_SUIT_STATES, np.int64)
Ch = np.zeros(10 * ss.N_SUIT_STATES, np.int64)
str_cnt = np.zeros(ss.N_STRUCT, np.int64)

from numba.typed import Dict
memo = Dict()
memo[(np.int64(0), np.int64(0))] = 0


def rand13():
    deck = np.arange(136)
    rng.shuffle(deck)
    c = np.zeros(34, np.int64)
    for t in deck[:13]:
        c[t // 4] += 1
    return c


# прогрев
c0 = rand13()
k0 = 0
k1 = 0
for i in range(17):
    k0 |= int(c0[i]) << (3 * i)
    k1 |= int(c0[i + 17]) << (3 * i)
ss.bp(c0.copy(), 0, np.int64(k0), np.int64(k1), memo)
ss.partition_v4(c0.copy(), np.int64(0), D, G, Ch, str_cnt)

for h in range(1, N + 1):
    c = rand13()
    cc = c.copy()
    k0 = 0
    k1 = 0
    for i in range(17):
        k0 |= int(cc[i]) << (3 * i)
        k1 |= int(cc[i + 17]) << (3 * i)
    old = ss.bp(cc, 0, np.int64(k0), np.int64(k1), memo)
    str_cnt[:] = 0
    new = ss.partition_v4(c.copy(), np.int64(h), D, G, Ch, str_cnt)
    blk = 0
    for k in range(ss.N_STRUCT):
        blk += ss.STRUCT_PTS[k] * str_cnt[k]
    if old != new or blk != new:
        mismatch += 1
        if mismatch <= 5:
            print(f"RASSOGREUSH h={h}: bp={old} dp={new} blk={blk}")
            print("c:", c)
            print("blocks:", str_cnt)

print(f"проверено: {N}, рассогласований: {mismatch}")
