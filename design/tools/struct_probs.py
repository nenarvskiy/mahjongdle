"""Точные вероятности структур/событий для 13- и 14-тайловых рук.
13 тайлов — как в игре после сброса. Веса C(4,c) на копии типа."""
from math import comb
from itertools import combinations

C4 = [comb(4, c) for c in range(5)]
FREE = [1, 4, 6, 4, 1]

def mul(a, b, size):
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

def poly_pow(base, n, size):
    out = [1] + [0] * (size - 1)
    for _ in range(n):
        out = mul(out, base, size)
    return out

def pfmt(good, total):
    if good is None or good <= 0:
        return "0"
    return f"{good / total * 100:.5f}%   (1 из {total / good:,.0f})"

HONOR = {13: poly_pow(FREE, 7, 14), 14: poly_pow(FREE, 7, 15)}

def suit_gen(fn, window, cap, n_tiles):
    """DP по 9 позициям масти. fn(последние window счётов, capped по cap) -> bool.
    Возвращает (poly_event, poly_none)."""
    st0 = (0,) * window
    ev = {(False, st0): {0: 1}}
    for _ in range(9):
        nev = {}
        for (has, st), wmap in ev.items():
            for w, v in wmap.items():
                if not v:
                    continue
                for c in range(0, 5):
                    if w + c >= n_tiles + 1:
                        continue
                    cc = min(c, cap)
                    trig = has or fn(st + (cc,))[-1] if False else (has or fn((st + (cc,))[-window:]))
                    key = (trig, (st + (cc,))[-window:])
                    d = nev.setdefault(key, {})
                    d[w + c] = d.get(w + c, 0) + v * C4[c]
        ev = nev
    pe = [0] * (n_tiles + 1)
    pn = [0] * (n_tiles + 1)
    for (has, st), wmap in ev.items():
        tgt = pe if has else pn
        for w, v in wmap.items():
            tgt[w] += v
    return pe, pn

def any_suit(fn, window, cap, n_tiles):
    """P(событие хотя бы в одной масти), числитель и total."""
    N = comb(136, n_tiles)
    pe, pn = suit_gen(fn, window, cap, n_tiles)
    none3 = mul(mul(pn, pn, n_tiles + 1), pn, n_tiles + 1)
    none_all = mul(none3, HONOR[n_tiles], n_tiles + 1)[n_tiles]
    return N - none_all, N

SHAPES = {
    'chi_234':     (lambda w: len(w) == 3 and all(w), 3, 1),
    'seq_2345':    (lambda w: len(w) == 4 and all(w), 4, 1),
    'seq_23456':   (lambda w: len(w) == 5 and all(w), 5, 1),
    'kanchan_13':  (lambda w: w[0] >= 1 and w[2] >= 1, 3, 1),
    'pair_334':    (lambda w: w[0] >= 2 and w[1] >= 1, 2, 2),
    'gap_246':     (lambda w: w[0] >= 1 and w[2] >= 1 and w[4] >= 1, 5, 1),
    'pon3334':     (lambda w: w[0] >= 3 and w[1] >= 1, 4, 4),
    'dble_1122':   (lambda w: w[0] >= 2 and w[1] >= 2, 2, 2),
    'iipeikou':    (lambda w: w[0] >= 2 and w[1] >= 2 and w[2] >= 2, 3, 2),
}

def positional(cond_fn, n_tiles):
    """cond_fn(pos, c_prev, c_cur) — событие на паре (pos-1, pos)."""
    N = comb(136, n_tiles)
    ev = {(False, 0, 0): {0: 1}}
    for pos in range(9):
        nev = {}
        for (has, c1, c2), wmap in ev.items():
            for w, v in wmap.items():
                if not v:
                    continue
                for c in range(0, 5):
                    if w + c >= n_tiles + 1:
                        continue
                    trig = has
                    if pos >= 1 and cond_fn(pos, c1, c):
                        trig = True
                    key = (trig, min(c, 1), c1)
                    d = nev.setdefault(key, {})
                    d[w + c] = d.get(w + c, 0) + v * C4[c]
        ev = nev
    pe, pn = [0] * (n_tiles + 1), [0] * (n_tiles + 1)
    for (has, _, _), wmap in ev.items():
        tgt = pe if has else pn
        for w, v in wmap.items():
            tgt[w] += v
    none3 = mul(mul(pn, pn, n_tiles + 1), pn, n_tiles + 1)
    none_all = mul(none3, HONOR[n_tiles], n_tiles + 1)[n_tiles]
    return N - none_all, N

def ge1_pow(m, n):
    return sum(comb(m, a) * ((-1) ** (m - a)) * comb(135 + (n - 13) - 4 * m + 4 * a, n)
               for a in range(m + 1))

def ge3_pow(m, n):
    t = 0
    for a in range(0, m + 1):
        k = n - 3 * (m - a) - 4 * a
        nn = 135 + (n - 13) - 4 * m
        if 0 <= k <= nn:
            t += comb(m, a) * (4 ** (m - a)) * comb(nn, k)
    return t

def sanshoku_dojun(n):
    t = 0
    for size in range(1, 8):
        sign = (-1) ** (size + 1)
        for J in combinations(range(7), size):
            covered = set()
            for p in J:
                covered.update([p, p + 1, p + 2])
            t += sign * ge1_pow(3 * len(covered), n)
    return t

def sanshoku_doko(n):
    t = 0
    for size in range(1, 10):
        sign = (-1) ** (size + 1)
        for J in combinations(range(9), size):
            t += sign * ge3_pow(3 * len(J), n)
    return t

def at_least_one_special(k, special, n):
    p = 0
    size = n + 1
    for j in range(1, k + 1):
        nn = mul(poly_pow(special, j, size), poly_pow(FREE, 34 - j, size), size)[n]
        p += ((-1) ** (j + 1)) * comb(k, j) * nn
    return p

def run(n):
    N = comb(136, n)
    size = n + 1
    r = {}
    r['pair_any'] = (N - poly_pow([1, 4], 34, size)[n], N)
    r['pon_any'] = (N - poly_pow([1, 4, 6], 34, size)[n], N)
    r['kan_any'] = (N - poly_pow([1, 4, 6, 4], 34, size)[n], N)
    # ровно k пон / пар
    pon_k = {k: comb(34, k) * mul(poly_pow([0, 0, 0, 4, 1], k, size),
                                  poly_pow([1, 4, 6], 34 - k, size), size)[n] for k in range(5)}
    pair_k = {k: comb(34, k) * mul(poly_pow([0, 0, 6, 4, 1], k, size),
                                   poly_pow([1, 4], 34 - k, size), size)[n] for k in range(8)}
    r['pon_3plus'] = (pon_k[3] + pon_k[4], N)
    r['pair_3plus'] = (sum(pair_k[k] for k in range(3, 8)), N)
    for name, (fn, window, cap) in SHAPES.items():
        r[name] = any_suit(fn, window, cap, n)
    r['ryanmen'] = positional(lambda pos, a, b: 2 <= pos <= 7 and a >= 1 and b >= 1, n)
    r['penchan'] = positional(lambda pos, a, b: pos in (1, 8) and a >= 1 and b >= 1, n)
    r['tanyao'] = (comb(84, n), N)
    r['honitsu'] = (3 * (comb(64, n) - comb(36, n) - comb(28, n)), N)
    r['chinitsu'] = (3 * comb(36, n), N)
    r['honroutou'] = (comb(52, n), N)
    r['ittsu'] = (3 * ge1_pow(9, n) - 3 * ge1_pow(18, n) + ge1_pow(27, n), N)
    r['sanshoku_dojun'] = (sanshoku_dojun(n), N)
    r['sanshoku_doko'] = (sanshoku_doko(n), N)
    r['yaku_pair_5'] = (int((4 * at_least_one_special(4, [0, 0, 6, 4, 1], n)
                             + 4 * at_least_one_special(5, [0, 0, 6, 4, 1], n)) / 8), N)
    r['yaku_triplet_5'] = (int((4 * at_least_one_special(4, [0, 0, 0, 4, 1], n)
                                + 4 * at_least_one_special(5, [0, 0, 0, 4, 1], n)) / 8), N)
    r['valuable_tile_any'] = (N - comb(108, n), N)
    return r, pon_k, pair_k

for n in (13, 14):
    r, pon_k, pair_k = run(n)
    N = r['pair_any'][1]
    print(f"=== {n} ТАЙЛОВ  (TOTAL = C({135 + (n - 13)},{n}) = {N:,}) ===\n")
    for k, (good, tot) in r.items():
        print(f"{k:16s} {pfmt(good, tot)}")
    print("ровно k пар:", {k: pfmt(v, N) for k, v in pair_k.items() if v})
    print("ровно k пон:", {k: pfmt(v, N) for k, v in pon_k.items() if v})
    print()

