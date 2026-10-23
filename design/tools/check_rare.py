#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Перепроверка редких событий против 5B-симуляции (mahahaahhaah yaku)."""
from math import comb

TOTAL = comb(136, 14)
C = {k: comb(4, k) for k in range(5)}

def dragon3(a_min, b_min, c_min):
    s = 0
    for a in range(a_min, 5):
        for b in range(b_min, 5):
            for c in range(c_min, 5):
                rem = 14 - a - b - c
                if rem < 0:
                    continue
                s += C[a] * C[b] * C[c] * comb(124, rem)
    return s

# сёсанген: два дракона >=3 + третий >=2 (объединение по 3 варианту, с пересечением)
one = dragon3(3, 3, 2)          # 31>=3,32>=3,33>=2
all3 = dragon3(3, 3, 3)         # все три >=3 (пересечение всех трёх)
sho = 3 * one - 3 * all3 + all3
p_sho = sho / TOTAL
print(f"сёсанген (форма): {p_sho:.6e} = 1/{1/p_sho:,.0f}   (5B: 1514/5e9 = 1/{5e9/1514:,.0f})")

# сансёку доккоу: пон во всех трёх мастях с одним номером (включения-исключения по 9 позициям)
# проще: точное значение уже было 1/31,772,595; проверяем через оценку
# P(фикс. номер r): (P(3 копии конкретного тайла)) в трёх мастях
def ge3_one_kind():
    # P(конкретный вид имеет >=3 в 14)
    return (C[3]*comb(132, 11) + C[4]*comb(132, 10)) / TOTAL
p_fix = ge3_one_kind() ** 3     # грубая нижняя оценка для фикс. r (зависимы, но близко)
print(f"оценка фикс-r доккоу: {p_fix:.3e} (для ориентира)")

# сравнение базовых
for name, p5b in [("дoko", 171/5e9), ("sdojun", 312052/5e9), ("ittsu", 133986/5e9),
                  ("sanankou", 104519/5e9), ("honitsu", 3506609/5e9),
                  ("chinitsu", 800/5e9), ("honro", 64810/5e9), ("tanyao", 42010647/5e9)]:
    print(f"  {name:10s} 5B: 1/{1/p5b:,.0f}")
