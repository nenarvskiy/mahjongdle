"""
Точный (без симуляции) расчёт вероятностей событий в случайной 14-тайловой руке
из 136 физических тайлов (34 типа × 4 копии). Равномерное 14-подмножество.

ВАЖНО: каждый тип имеет 4 физических копии. Число способов выбрать c копий
конкретного типа = C(4,c). Поэтому полином на тип = Σ C(4,c) x^c = (1+x)^4.
"""
from math import comb
from itertools import combinations

TOTAL = comb(136, 14)
SIZE = 15

C4 = [comb(4, c) for c in range(5)]  # [1,4,6,4,1]

def mul(a, b, size=SIZE):
    out = [0] * size
    for i, ai in enumerate(a):
        if not ai:
            continue
        for j, bj in enumerate(b):
            if i + j >= size:
                break
            if not bj:
                continue
            out[i + j] += ai * bj
    return out

# полиномы на тип с весами C(4,c)
P_FREE = [1, 4, 6, 4, 1]        # (1+x)^4, без ограничений
P_MAX1 = [1, 4]                  # ≤1 копия
P_MAX2 = [1, 4, 6]               # ≤2 копии
P_MAX3 = [1, 4, 6, 4]            # ≤3 копии
P_GE2  = [0, 0, 6, 4, 1]         # ≥2 копии
P_GE3  = [0, 0, 0, 4, 1]         # ≥3 копии
P_GE1  = [0, 4, 6, 4, 1]         # ≥1 копия

def poly_pow(base, n, size=SIZE):
    out = [1] + [0] * (size - 1)
    for _ in range(n):
        out = mul(out, base, size)
    return out

def pct(x, total=TOTAL):
    if x <= 0:
        return "0"
    p = x / total
    return f"{p * 100:.6f}%   (1 из {total / x:,.0f})"

res = {}

# ---------- 1. Кан (≥4 одного типа) ----------
no_kan = poly_pow(P_MAX3, 34)[14]
res['kan_any'] = TOTAL - no_kan

# ---------- 2. Пара/триплет среди k конкретных типов ----------
def at_least_one_special(k, special):
    """P(≥1 из k конкретных типов имеет special-количество), IE."""
    p = 0
    for j in range(1, k + 1):
        n = mul(poly_pow(special, j), poly_pow(P_FREE, 34 - j), SIZE)[14]
        p += ((-1) ** (j + 1)) * comb(k, j) * n
    return p

# Якухай: 3 дракона всегда + круг + место.
# 4 из 8 комбинаций ветров: круг==место -> 4 типа; 4 из 8: 5 типов.
res['yaku_pair_5']   = (4 * at_least_one_special(4, P_GE2) + 4 * at_least_one_special(5, P_GE2)) / 8
res['yaku_triplet_5'] = (4 * at_least_one_special(4, P_GE3) + 4 * at_least_one_special(5, P_GE3)) / 8

# ---------- 3. Ровно k пон / ровно k пар ----------
def exact_k(k, special, rest):
    return comb(34, k) * mul(poly_pow(special, k), poly_pow(rest, 34 - k), SIZE)[14]

pon_k = {k: exact_k(k, P_GE3, P_MAX2) for k in range(0, 5)}
res['pon_3plus'] = sum(pon_k[k] for k in range(3, 5))
pair_k = {k: exact_k(k, P_GE2, P_MAX1) for k in range(0, 8)}
res['pair_any'] = TOTAL - pair_k[0]
res['pair_3plus'] = sum(pair_k[k] for k in range(3, 8))

# ---------- 4. Масти (чистые группы физических тайлов) ----------
res['chinitsu']    = 3 * comb(36, 14)
res['honitsu']     = 3 * (comb(64, 14) - comb(36, 14) - comb(28, 14))
res['tanyao']      = comb(84, 14)
res['honroutou']   = comb(52, 14)
res['chinroutou']  = comb(24, 14)
res['tsuuiisou']   = comb(28, 14)
res['ryuuiisou']   = comb(24, 14)

# ---------- 5. Иппейко: DP по масти (запрещено 3 подряд с ≥2), веса C(4,c) ----------
def suit_poly_no_iipeikou():
    # state: (prev_ge2, prev2_ge2)
    dp = [[0] * SIZE for _ in range(4)]
    dp[0][0] = 1
    for _ in range(9):
        ndp = [[0] * SIZE for _ in range(4)]
        for st in range(4):
            for w in range(SIZE):
                v = dp[st][w]
                if not v:
                    continue
                b1 = (st >> 1) & 1
                b2 = st & 1
                for c in range(0, 5):
                    g = 1 if c >= 2 else 0
                    if b1 and b2 and g:
                        continue
                    if w + c >= SIZE:
                        continue
                    nst = (g << 1) | b1
                    ndp[nst][w + c] += v * C4[c]
        dp = ndp
    a = [0] * SIZE
    for st in range(4):
        for w in range(SIZE):
            a[w] += dp[st][w]
    return a

A = suit_poly_no_iipeikou()
A3 = mul(mul(A, A), A)
honor28 = [comb(28, i) for i in range(15)]
res['iipeikou'] = TOTAL - mul(A3, honor28, SIZE)[14]

# ---------- 6. Иццу / саншоку-доуджун (инклюзия-эксклюзия) ----------
def ge1_pow(m):
    return sum(comb(m, a) * ((-1) ** (m - a)) * comb(136 - 4 * m + 4 * a, 14) for a in range(m + 1))

res['ittsu'] = 3 * ge1_pow(9) - 3 * ge1_pow(18) + ge1_pow(27)

def sanshoku_dojun_p():
    total = 0
    for size in range(1, 8):
        sign = (-1) ** (size + 1)
        for J in combinations(range(7), size):
            covered = set()
            for p in J:
                covered.update([p, p + 1, p + 2])
            total += sign * ge1_pow(3 * len(covered))
    return total

res['sanshoku_dojun'] = sanshoku_dojun_p()

# ---------- 7. Саншоку-доко (∃ p: c_p ≥3 во всех трёх мастях) ----------
def ge3_pow(m):
    # (4x^3 + x^4)^m * (1+x)^(136-4m), coeff x^14
    total = 0
    for a in range(0, m + 1):
        # a типов дают 4 копии, (m-a) дают 3
        k = 14 - 3 * (m - a) - 4 * a
        n = 136 - 4 * m
        if 0 <= k <= n:
            total += comb(m, a) * (4 ** (m - a)) * comb(n, k)
    return total

def sanshoku_doko_p():
    total = 0
    for size in range(1, 10):
        sign = (-1) ** (size + 1)
        for J in combinations(range(9), size):
            total += sign * ge3_pow(3 * len(J))
    return total

res['sanshoku_doko'] = sanshoku_doko_p()

# ---------- 8. Шосанген (2 драконьих пона + пара третьего) ----------
def shousangen():
    p = mul(poly_pow(P_GE3, 2), P_GE2, SIZE)
    p = mul(p, poly_pow(P_FREE, 29), SIZE)
    return 3 * p[14]

res['shousangen'] = shousangen()

# ---------- вывод ----------
print(f"TOTAL 14-подмножеств = {TOTAL:,}\n")
for k in ['kan_any', 'yaku_pair_5', 'yaku_triplet_5', 'iipeikou', 'ittsu',
          'honitsu', 'chinitsu', 'tanyao', 'pon_3plus', 'honroutou',
          'chinroutou', 'tsuuiisou', 'ryuuiisou', 'sanshoku_dojun',
          'sanshoku_doko', 'shousangen', 'pair_any', 'pair_3plus']:
    print(f"{k:18s} {pct(res[k])}")

print("\nраспределение количества пар (ровно k):")
for k in range(0, 8):
    print(f"  {k} пар: {pct(pair_k[k])}")
print("распределение количества пон (ровно k):")
for k in range(0, 5):
    print(f"  {k} пон: {pct(pon_k[k])}")
