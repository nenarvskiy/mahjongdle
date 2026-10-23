# Жёсткие руки: одна масть, каны, 3334/23456/1122, много хоноров.
# Пишем JSON в stats/fixtures и сверяем разбиение двумя Python-путями (bp и DP).
# Запуск: py stats/tools/gen_hard_hands.py
import json
from pathlib import Path

import numpy as np
import sys

STATS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STATS))
import scorestat as ss

OUT = STATS / "fixtures" / "hands_hard.json"
OUT_SCORES = STATS / "fixtures" / "hard_scores.txt"

rng = np.random.default_rng(777)
hands = []


def add(c):
    c = [int(x) for x in c]
    assert len(c) == 34, (len(c), c)
    assert sum(c) == 13, (sum(c), c)
    assert all(0 <= x <= 4 for x in c), c
    hands.append(c)


# 1) все 13 тайлов одной масти (случайно)
for _ in range(400):
    suit = int(rng.integers(0, 3)) * 9
    wall = [suit + p for p in range(9) for _ in range(4)]
    rng.shuffle(wall)
    c = [0] * 34
    for t in wall[:13]:
        c[t] += 1
    add(c)

# 2) одна масть + каны/тройки (высокие кратности)
for _ in range(400):
    suit = int(rng.integers(0, 3)) * 9
    c = [0] * 34
    left = 13
    while left > 0:
        p = suit + int(rng.integers(0, 9))
        take = min(left, int(rng.integers(1, 5)))
        if c[p] + take > 4:
            take = 4 - c[p]
        if take <= 0:
            continue
        c[p] += take
        left -= take
    if sum(c) == 13:
        add(c)

# 3) явные паттерны: 3334, 23456, 1122/334/246, каны, 7 пар, хоноры
def mk(man, pin, sou, hon):
    c = list(man) + list(pin) + list(sou) + list(hon)
    assert len(c) == 34, len(c)
    return c


explicit = [
    # 3334 в манах + одиночки (1,2 ман нельзя — соседи)
    mk([3, 1, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0, 1]),
    # 23456 в манах + 1111/1111 в пин/соу
    mk([1, 1, 1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0, 0, 0], [0] * 7),
    # 1122+334 в манах
    mk([2, 2, 0, 1, 1, 1, 0, 0, 0], [1, 1, 1, 0, 0, 0, 0, 0, 0], [1, 1, 1, 0, 0, 0, 0, 0, 0], [0] * 7),
    # кан + 23456 в пин + 1111 в соу
    mk([4, 0, 0, 0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0, 0, 0], [0] * 7),
    # 246 во всех трёх мастях
    mk([1, 0, 1, 0, 1, 0, 0, 0, 0], [1, 0, 1, 0, 1, 0, 0, 0, 0], [1, 0, 1, 0, 1, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0]),
    # только хоноры: 2,2,2,2,2,3
    mk([0] * 9, [0] * 9, [0] * 9, [2, 2, 2, 2, 2, 3, 0]),
    # хоноры: кан, кан, кан, одиночка
    mk([0] * 9, [0] * 9, [0] * 9, [4, 4, 4, 1, 0, 0, 0]),
    # 7 пар
    mk([2, 2, 2, 2, 2, 2, 0, 0, 1], [0] * 9, [0] * 9, [0] * 7),
    # плотная масть 333+22+33+22 (высокие кратности)
    mk([3, 2, 3, 2, 3, 0, 0, 0, 0], [0] * 9, [0] * 9, [0] * 7),
    # одна масть целиком (1-9 + добавки)
    mk([1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 0, 0, 0, 0, 0], [0] * 9, [0] * 7),
    # кан в каждой масти + одиночка
    mk([4, 0, 0, 0, 0, 0, 0, 0, 0], [4, 0, 0, 0, 0, 0, 0, 0, 0], [4, 0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0]),
    # чи + рянмен + канчан внахлёст
    mk([1, 1, 1, 1, 1, 1, 1, 1, 0], [1, 1, 0, 0, 0, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0]),
]
for c in explicit:
    add(c)

OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(hands, f)

# DP-путь
NS = ss.N_SUIT_STATES
pD = np.zeros(10 * NS, np.int64); pG = np.zeros(10 * NS, np.int64)
pCh = np.zeros(10 * NS, np.int64)
str_cnt = np.zeros(ss.N_STRUCT, np.int64)
dp_scores = []
for h, cs in enumerate(hands):
    c = np.array(cs, np.int64)
    for k in range(ss.N_STRUCT):
        str_cnt[k] = 0
    dp_scores.append(int(ss.partition_v4(c, np.int64(h + 1), pD, pG, pCh, str_cnt)))

# bp-путь (рекурсия)
from numba.typed import Dict
memo = Dict()
memo[(np.int64(0), np.int64(0))] = 0
bp_scores = []
for cs in hands:
    c = np.array(cs, np.int64)
    k0 = k1 = 0
    for i in range(17):
        k0 |= int(c[i]) << (3 * i)
        k1 |= int(c[i + 17]) << (3 * i)
    bp_scores.append(int(ss.bp(c, 0, np.int64(k0), np.int64(k1), memo)))

bad = sum(1 for a, b in zip(dp_scores, bp_scores) if a != b)
print("жёстких рук:", len(hands), " расхождений DP vs bp:", bad, "->", OUT)
with open(OUT_SCORES, "w", encoding="utf-8") as f:
    f.write("\n".join(str(x) for x in dp_scores) + "\n")