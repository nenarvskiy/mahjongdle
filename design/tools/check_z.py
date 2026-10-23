#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Z-проверка 5B-симуляции (mahahaahhaah yaku) против точных 14-тайловых вероятностей.
z = (obs - exp)/sigma. |z|>3 = подозрение."""
import math
from math import comb

TOTAL = comb(136, 14)
W4 = [1, 4, 6, 4, 1]
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
    p = [1]
    for _ in range(power):
        p = pmul(p, term, cap)
    return p


def coeff(p, k):
    return p[k] if 0 <= k < len(p) else 0


def suit_no_trigger(W, pred):
    states = {(0, (-1, -1, -1, -1)): {0: 1}}
    for p in range(9):
        ns = {}
        for (trig, (a, b, c, d)), poly in states.items():
            if trig:
                continue
            for cnt in range(5):
                nt = 0
                if p >= W - 1:
                    q = p - W + 1
                    hist = (a, b, c, d)
                    wl = [hist[i] for i in range(W - 2, -1, -1)] + [cnt]
                    if pred(q, wl):
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


def p_local(W, pred):
    A = suit_no_trigger(W, pred)
    none3 = [0] * 15
    for t in range(15):
        s = 0
        for i in range(t + 1):
            for j in range(t - i + 1):
                k = t - i - j
                s += A[i] * A[j] * A[k]
        none3[t] = s
    G7 = powpoly(G, 7)
    none14 = sum(none3[i] * G7[14 - i] for i in range(15) if G7[14 - i])
    return 1 - none14 / TOTAL


def p_global_any(r):
    term = [W4[c] for c in range(r)]
    return 1 - coeff(powpoly(term, 34), 14) / TOTAL


def p_sanankou():
    dp = {(0, 0): 1}
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


def p_ittsu():
    G9 = powpoly(G, 9)
    F9 = powpoly([0, 4, 6, 4, 1], 9)
    none1 = [g - f for g, f in zip(G9, F9)]
    none1_cu = pmul(pmul(none1, none1), none1)
    G7 = powpoly(G, 7)
    none14 = sum(none1_cu[i] * G7[14 - i] for i in range(15) if G7[14 - i])
    return 1 - none14 / TOTAL


def p_shousangen():
    C = {k: comb(4, k) for k in range(5)}
    def d3(a0, b0, c0):
        s = 0
        for a in range(a0, 5):
            for b in range(b0, 5):
                for c in range(c0, 5):
                    r = 14 - a - b - c
                    if r >= 0:
                        s += C[a] * C[b] * C[c] * comb(124, r)
        return s
    one, all3 = d3(3, 3, 2), d3(3, 3, 3)
    return (3 * one - 3 * all3 + all3) / TOTAL


def p_sdojun():
    # доудзюн на ранге r: в каждой масти виды {r,r+1,r+2} >= 1 (r = 0..6).
    # Включения-исключения по парам рангов; тройки невозможны (мин. 15 тайлов).
    F = [0, 4, 6, 4, 1]  # один вид, >=1
    def c3(kinds, free):
        f = powpoly(F, kinds)
        return coeff(pmul(pmul(f, f), pmul(f, powpoly(G, free))), 14)
    A = c3(3, 25)   # 7 рангов
    B = c3(4, 22)   # 6 смежных пар
    Cc = c3(5, 19)  # 5 перекрывающихся пар (r, r+2)
    D = c3(6, 16)   # 10 несмежных пар
    return (7 * A - 6 * B - 5 * Cc - 10 * D) / TOTAL


def comps(j, lo, hi):
    if j == 1:
        for v in range(lo, hi + 1):
            yield (v,)
        return
    for v in range(lo, hi + 1):
        for rest in comps(j - 1, lo, hi):
            yield (v,) + rest


def p_any_of_k(k, r):
    total = 0
    for j in range(1, k + 1):
        sign = 1 if j % 2 else -1
        s = 0
        for comp in comps(j, r, 4):
            rem = 14 - sum(comp)
            if rem < 0:
                continue
            s += math.prod(W4[c] for c in comp) * comb(136 - 4 * j, rem)
        total += sign * comb(k, j) * s
    return total / TOTAL


P_TANYAO = (comb(84, 14) + comb(52, 1) * comb(84, 13)) / TOTAL
P_HONRO = (comb(52, 14) + comb(84, 1) * comb(52, 13)) / TOTAL
P_CHINITSU = 3 * (comb(36, 14) + comb(100, 1) * comb(36, 13)) / TOTAL
P_HONITSU = 3 * (comb(64, 14) + comb(72, 1) * comb(64, 13)) / TOTAL
V1 = 0.75 * p_any_of_k(5, 1) + 0.25 * p_any_of_k(4, 1)
VP = 0.75 * p_any_of_k(5, 2) + 0.25 * p_any_of_k(4, 2)
VT = 0.75 * p_any_of_k(5, 3) + 0.25 * p_any_of_k(4, 3)

N = 5_000_000_000
obs = {
    'пара': 4560429133, 'пон': 550693095, 'кан': 12478184,
    '234': 2577037135, '2345': 791448662, '23456': 197584144,
    '13': 4734414245, '34': 4508082266, '12': 2821614823,
    '334': 1765039524, '246': 2093256265, '3334': 117978049,
    '1122': 249328780, 'иппейко': 6606421, 'итсу': 133986,
    'сдоуджун': 312052, 'сдоккоу': 171, 'сананко': 104519,
    'сёсанген': 1514, '1ценн': 4445943286, 'парац': 1155272290,
    'понц': 78859445, 'таняо': 42010647, 'хонрото': 64810,
    'хоницу': 3506609, 'чиницу': 800,
}
exact = {
    'пара': p_global_any(2), 'пон': p_global_any(3), 'кан': p_global_any(4),
    '234': p_local(3, lambda q, w: all(v > 0 for v in w)),
    '2345': p_local(4, lambda q, w: all(v > 0 for v in w)),
    '23456': p_local(5, lambda q, w: all(v > 0 for v in w)),
    '13': p_local(3, lambda q, w: w[0] > 0 and w[2] > 0),
    '34': p_local(2, lambda q, w: 1 <= q <= 6 and w[0] > 0 and w[1] > 0),
    '12': p_local(2, lambda q, w: q in (0, 7) and w[0] > 0 and w[1] > 0),
    '334': p_local(2, lambda q, w: w[0] >= 2 and w[1] >= 1),
    '246': p_local(5, lambda q, w: w[0] > 0 and w[2] > 0 and w[4] > 0),
    '3334': p_local(2, lambda q, w: w[0] >= 3 and w[1] >= 1),
    '1122': p_local(2, lambda q, w: w[0] >= 2 and w[1] >= 2),
    'иппейко': p_local(3, lambda q, w: all(v >= 2 for v in w)),
    'итсу': p_ittsu(), 'сананко': p_sanankou(), 'сёсанген': p_shousangen(),
    'сдоуджун': p_sdojun(),
    '1ценн': V1, 'парац': VP, 'понц': VT,
    'таняо': P_TANYAO, 'хонрото': P_HONRO, 'хоницу': P_HONITSU, 'чиницу': P_CHINITSU,
}
# доккоу — точное из exact_probs.py (включения-исключения, проверено ранее)
exact['сдоккоу'] = 1 / 31772595

print(f"{'событие':<10}{'точный P':>14}{'exp':>14}{'obs':>14}{'z':>8}")
print("-" * 62)
worst = []
for name in obs:
    p = exact[name]
    e = N * p
    o = obs[name]
    sig = math.sqrt(e * (1 - p)) if e > 1000 else math.sqrt(e)
    z = (o - e) / sig
    worst.append((abs(z), name, z, e, o))
    print(f"{name:<10}{p:>14.6e}{e:>14.1f}{o:>14,}{z:>8.2f}")
print("-" * 62)
worst.sort(reverse=True)
print("Наибольшие отклонения:", ", ".join(f"{n}: z={z:+.2f}" for _, n, z, _, _ in worst[:5]))
bad = [f"{n} z={z:+.2f}" for _, n, z, _, _ in worst if abs(z) > 3]
print("Аномалий |z|>3:", bad if bad else "НЕТ — данные чистые")
