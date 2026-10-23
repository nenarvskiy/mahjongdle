# Генерация случайных 13-тайловых рук и эталонных очков разбиения (DP) —
# для сверки Python <-> JS (src/partition.js).
# Запуск: py stats/tools/gen_hands.py
#   -> stats/fixtures/hands13.json, stats/fixtures/hands13_scores.txt
import json
import sys
from pathlib import Path

import numpy as np

STATS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STATS))
import scorestat as ss

FIXTURES = STATS / "fixtures"
HANDS = FIXTURES / "hands13.json"
SCORES = FIXTURES / "hands13_scores.txt"

rng = np.random.default_rng(2024)
N = 3000
hands = []
for _ in range(N):
    deck = np.arange(136)
    rng.shuffle(deck)
    c = [0] * 34
    for t in deck[:13]:
        c[t // 4] += 1
    hands.append(c)

FIXTURES.mkdir(parents=True, exist_ok=True)
with open(HANDS, "w", encoding="utf-8") as f:
    json.dump(hands, f)

# эталон: DP-разбиение (partition_v4) по конфигу
NS = ss.N_SUIT_STATES
pD = np.zeros(10 * NS, np.int64)
pG = np.zeros(10 * NS, np.int64)
pCh = np.zeros(10 * NS, np.int64)
str_cnt = np.zeros(ss.N_STRUCT, np.int64)
scores = []
for h, counts in enumerate(hands):
    c = np.array(counts, np.int64)
    for k in range(ss.N_STRUCT):
        str_cnt[k] = 0
    scores.append(int(ss.partition_v4(c, np.int64(h + 1), pD, pG, pCh, str_cnt)))

with open(SCORES, "w", encoding="utf-8") as f:
    f.write("\n".join(str(x) for x in scores) + "\n")

print(f"написано рук: {len(hands)} -> {HANDS}")
print(f"эталонные очки (DP) -> {SCORES}")