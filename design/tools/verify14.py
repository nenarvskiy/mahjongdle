#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ТОЧНЫЕ 14-тайловые вероятности всех событий режима 'yaku' (без симуляции).
Кросс-чек: mahahahaahhaah.py (yaku, 200k симуляции) vs struct_probs.py (старый референс).
События считаются по правилам режима 2:
  * структуры/локальные яку — если есть среди 14 тайлов;
  * тан'яо/хонрото/хоницу/чиницу — если одним сбросом условие выполнимо;
  * ценные = драконы + ветер раунда + ветер игрока (случайные ветры, усреднено).
"""
import math
from math import comb

TOTAL = comb(136, 14)
W4 = [1, 4, 6, 4, 1]  # C(4, c)
G = [1, 4, 6, 4, 1]


def pmul(a, b, cap=14):
    n = min(len(a) + len(b) - 1, cap + 1)
    c = [0] * n
    for i in range(len(a)):
        if not a[i]:
            continue
        for j in range(len(b)):
            if i + j >= n or not b[j]:
                continue
            c[i + j] += a[i] * b[j]
    return c


def powpoly(term, power, cap=14):
    poly = [1]
    for _ in range(power):
        poly = pmul(poly, term, cap)
    return poly


def coeff(poly, k):
    return poly[k] if 0 <= k < len(poly) else 0


# ---------- DP по одной масти для локальных событий ----------

def suit_no_trigger(event_W, pred):
    """A[w] = способов выбрать w тайлов из 36 физической масти (9 видов x 4),
    где событие НИГДЕ не сработало. pred(q, window) -> bool, window = W счётов
    по возрастанию позиций."""
    states = {(0, (-1, -1, -1, -1)): {0: 1}}
    for p in range(9):
        ns = {}
        for (trig, (a, b, c, d)), poly in states.items():
            if trig:
                continue
            for cnt in range(5):
                nt = 0
                if p >= event_W - 1:
                    q = p - event_W + 1
                    hist = (a, b, c, d)
                    wlist = [hist[i] for i in range(event_W - 2, -1, -1)] + [cnt]
                    if pred(q, wlist):
                        nt = 1
                st = (nt, (cnt, a, b, c))
                d2 = ns.setdefault(st, {})
                for w, n in poly.items():
                    if w + cnt <= 14:
                        d2[w + cnt] = d2.get(w + cnt, 0) + n * W4[cnt]
        states = ns
    A = [0] * 15
    for (trig, _), poly in states.items():
        if not trig:
            for w, n in poly.items():
                A[w] += n
    return A


def p_local(event_W, pred):
    A = suit_no_trigger(event_W, pred)
    none3 = [0] * 15
    for i in range(15):
        s = 0
        for a in range(i + 1):
            for b in range(i - a + 1):
                c = i - a - b
                s += A[a] * A[b] * A[c]
        none3[i] = s
    G7 = powpoly(G, 7)
    none14 = sum(none3[i] * G7[14 - i] for i in range(15) if G7[14 - i])
    return 1 - none14 / TOTAL


LOCAL = {
    '234 (чи)':        (3, lambda q, w: w[0] > 0 and w[1] > 0 and w[2] > 0),
    '2345 (4 подряд)': (4, lambda q, w: all(v > 0 for v in w)),
    '23456 (5 подряд)':(5, lambda q, w: all(v > 0 for v in w)),
    '13 (канчан)':     (3, lambda q, w: w[0] > 0 and w[2] > 0),
    '34 (ryanmen)':    (2, lambda q, w: 1 <= q <= 6 and w[0] > 0 and w[1] > 0),
    '12 (пенчан)':     (2, lambda q, w: q in (0, 7) and w[0] > 0 and w[1] > 0),
    '334':             (2, lambda q, w: w[0] >= 2 and w[1] >= 1),
    '246':             (5, lambda q, w: w[0] > 0 and w[2] > 0 and w[4] > 0),
    '3334':            (2, lambda q, w: w[0] >= 3 and w[1] >= 1),
    '1122':            (2, lambda q, w: w[0] >= 2 and w[1] >= 2),
    'иппейко':         (3, lambda q, w: w[0] >= 2 and w[1] >= 2 and w[2] >= 2),
}


def p_ittsu():
    G9 = powpoly(G, 9)
    F9 = powpoly([0, 4, 6, 4, 1], 9)          # все 9 видов >= 1
    none1 = [g - f for g, f in zip(G9, F9)]
    none1_cu = pmul(pmul(none1, none1), none1)
    G7 = powpoly(G, 7)
    none14 = sum(none1_cu[i] * G7[14 - i] for i in range(15) if G7[14 - i])
    return 1 - none14 / TOTAL


def p_global_any(r):
    """P(хотя бы один вид имеет >= r)."""
    term = [W4[c] for c in range(r)]
    poly = powpoly(term, 34)
    return 1 - coeff(poly, 14) / TOTAL


def p_sanankou():
    dp = {(0, 0): 1}  # (тайлов, min(3, число видов с >=3))
    for _ in range(34):
        nd = {}
        for (w, t), n in dp.items():
            for cnt in range(5):
                if w + cnt > 14:
                    continue
                nt = min(3, t + (1 if cnt >= 3 else 0))
                nd[(w + cnt, nt)] = nd.get((w + cnt, nt), 0) + n * W4[cnt]
        dp = nd
    no = sum(n for (w, t), n in dp.items() if w == 14 and t < 3)
    return 1 - no / TOTAL


def p_shousangen():
    GE3 = [0, 0, 0, 4, 1]
    GE2 = [0, 0, 6, 4, 1]
    poly = pmul(pmul(pmul(GE3, GE3), GE2), powpoly(G, 29))
    return 3 * coeff(poly, 14) / TOTAL


def comps(j, lo, hi):
    if j == 1:
        for v in range(lo, hi + 1):
            yield (v,)
        return
    for v in range(lo, hi + 1):
        for rest in comps(j - 1, lo, hi):
            yield (v,) + rest


def p_any_of_k(k, r):
    """P(хотя бы один из k конкретных видов имеет >= r) — включения-исключения."""
    total = 0
    for j in range(1, k + 1):
        sign = 1 if j % 2 else -1
        s = 0
        for comp in comps(j, r, 4):
            k14 = 14 - sum(comp)
            if k14 < 0:
                continue
            s += math.prod(W4[c] for c in comp) * comb(136 - 4 * j, k14)
        total += sign * comb(k, j) * s
    return total / TOTAL


# ---- «после одного сброса» (не более одного лишнего тайла) ----
P_TANYAO = (comb(84, 14) + comb(52, 1) * comb(84, 13)) / TOTAL
P_HONRO = (comb(52, 14) + comb(84, 1) * comb(52, 13)) / TOTAL
P_CHINITSU = 3 * (comb(36, 14) + comb(100, 1) * comb(36, 13)) / TOTAL
P_HONITSU = 3 * (comb(64, 14) + comb(72, 1) * comb(64, 13)) / TOTAL

# ветры: P(ветер игрока == ветер раунда) = 1/4 -> 4 вида, иначе 5
V1 = 0.75 * p_any_of_k(5, 1) + 0.25 * p_any_of_k(4, 1)
VP = 0.75 * p_any_of_k(5, 2) + 0.25 * p_any_of_k(4, 2)
VT = 0.75 * p_any_of_k(5, 3) + 0.25 * p_any_of_k(4, 3)

results = [
    ('пара (любая)', p_global_any(2)),
    ('пон (любой)', p_global_any(3)),
    ('кан (любой)', p_global_any(4)),
]
for name, (W, pred) in LOCAL.items():
    results.append((name, p_local(W, pred)))
results += [
    ('иппейко', p_local(3, lambda q, w: w[0] >= 2 and w[1] >= 2 and w[2] >= 2)),
    ('итсу (12345689)', p_ittsu()),
    ('сананко (3+ пон)', p_sanankou()),
    ('сёсанген', p_shousangen()),
    ('1 ценный тайл', V1),
    ('пара ценных', VP),
    ('пон ценного', VT),
    ("тан'яо (после сброса)", P_TANYAO),
    ('хонрото (после сброса)', P_HONRO),
    ('хоницу (после сброса)', P_HONITSU),
    ('чиницу (после сброса)', P_CHINITSU),
]

# старый референс struct_probs.py (14 тайлов) и симуляция 200k (mahahaahhaah yaku)
old_ref = {
    'пара (любая)': 91.20873, 'пон (любой)': 11.01419, 'кан (любой)': 0.24956,
    '234 (чи)': 51.54213, '2345 (4 подряд)': 15.82932, '23456 (5 подряд)': 3.95164,
    '13 (канчан)': 94.68805, '34 (ryanmen)': 90.16210, '12 (пенчан)': 56.43160,
    '334': 35.30068, '246': 41.86563, '3334': 1.77125, '1122': 4.98691,
    'иппейко': 0.13215, 'итсу (12345689)': 0.00268, 'сананко (3+ пон)': 0.00209,
    '1 ценный тайл': 96.71228, 'пара ценных': 21.99546, 'пон ценного': 1.49433,
}
old_other = {'сёсанген': 100 / 4672641, 'хоницу (после сброса)': None,
             'чинрото': None}
sim200 = {
    'пара (любая)': 91.1665, 'пон (любой)': 10.9870, 'кан (любой)': 0.2345,
    '234 (чи)': 51.5270, '2345 (4 подряд)': 15.8770, '23456 (5 подряд)': 3.9700,
    '13 (канчан)': 94.7505, '34 (ryanmen)': 90.2200, '12 (пенчан)': 56.6820,
    '334': 35.2975, '246': 42.0005, '3334': 2.3440, '1122': 4.9465,
    'иппейко': 0.1335, 'итсу (12345689)': 0.0025, 'сананко (3+ пон)': 0.0025,
    'сёсанген': 0.0, '1 ценный тайл': 88.8570, 'пара ценных': 23.0560,
    'пон ценного': 1.5650, "тан'яо (после сброса)": 0.8320,
    'хонрото (после сброса)': 0.0015, 'хоницу (после сброса)': 0.0625,
    'чиницу (после сброса)': 0.0,
}

print(f"TOTAL C(136,14) = {TOTAL:,}\n")
print(f"{'событие':<26}{'ТОЧНО %':>12}{'1 из':>14}{'сим 200k %':>12}{'старый ref %':>14}")
print("-" * 82)
for name, p in results:
    once = f"1 из {1 / p:,.0f}" if p > 0 else "-"
    s = sim200.get(name)
    o = old_ref.get(name)
    s_s = f"{s:>11.4f}%" if s is not None else f"{'-':>11}"
    o_s = f"{o:>13.4f}%" if o is not None else f"{'-':>13}"
    flag = ""
    if o is not None and abs(o - p * 100) / max(p * 100, 1e-9) > 0.03:
        flag = "  <-- РАСХОЖДЕНИЕ со старым ref"
    print(f"{name:<26}{p * 100:>11.4f}%{once:>14}{s_s}{o_s}{flag}")
