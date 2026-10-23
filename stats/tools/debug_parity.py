#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""stats/tools/debug_parity.py — для каждого рассогласованного случая печатает:
контекст, хан Python по каждому cost с пойманной W (инструментированная копия
dfs/chiitoi_dfs из scorestat) и детали. Запуск: py stats/tools/debug_parity.py [index ...]"""
import json
import sys
from pathlib import Path

import numpy as np

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS.parent))
import scorestat as ss  # noqa: E402

LIM = ss.LIM


# --- копия dfs из scorestat с ловлей W при обновлении best ---
def dfs(i, ml, pl, cost, waste, H, maxc, iso, W, trip, seq, pairp, best, captures, par, lim):
    can_seq = i < 27 and (i % 9) <= 6
    for t in range(2):
        if t == 1 and ml < 1:
            break
        W[i] += 3 * t
        if W[i] <= maxc[i]:
            for p in range(2):
                if p == 1 and pl < 1:
                    break
                W[i] += 2 * p
                if W[i] <= maxc[i]:
                    qmax = ml - t
                    if not can_seq:
                        qmax = 0
                    added = 0
                    for q in range(qmax + 1):
                        if q > 0:
                            W[i] += 1
                            W[i + 1] += 1
                            W[i + 2] += 1
                            added += 1
                            if W[i] > maxc[i] or W[i + 1] > maxc[i + 1] or W[i + 2] > maxc[i + 2]:
                                break
                        c = W[i] if W[i] < H[i] else H[i]
                        nc = cost + W[i] - c
                        nw = waste + H[i] - c
                        if nc <= lim and nw <= lim and nc + nw + iso[i + 3] <= 2 * LIM:
                            nml = ml - t - q
                            npl = pl - p
                            trip[i] = t
                            seq[i] = q
                            if p == 1:
                                pairp[0] = i
                            if nml == 0 and npl == 0:
                                lc = nc
                                for j in range(i + 1, i + 3):
                                    if j < 34:
                                        cc = W[j] if W[j] < H[j] else H[j]
                                        lc += W[j] - cc
                                if lc <= lim:
                                    han = ss.eval_regular(trip, seq, pairp[0], W, H, par)
                                    if han > best[lc]:
                                        best[lc] = han
                                        captures.append((lc, han, list(W)))
                            elif i < 33:
                                dfs(i + 1, nml, npl, nc, nw, H, maxc, iso, W,
                                    trip, seq, pairp, best, captures, par, lim)
                            trip[i] = 0
                            seq[i] = 0
                    if added > 0:
                        W[i] -= added
                        W[i + 1] -= added
                        W[i + 2] -= added
                W[i] -= 2 * p
        W[i] -= 3 * t


def chiitoi_dfs(i, chosen, cost, waste, H, sufH, W, best, captures, par, lim):
    if chosen == 7:
        if waste + sufH[i] <= lim:
            han = ss.eval_chiitoi(W, par)
            if han > best[cost]:
                best[cost] = han
                captures.append((cost, han, list(W), "chiitoi"))
        return
    if i >= 34 or 34 - i < 7 - chosen:
        return
    cov = H[i] if H[i] < 2 else 2
    nc = cost + 2 - cov
    nw = waste + H[i] - cov
    if nc <= lim and nw <= lim:
        W[i] = 2
        chiitoi_dfs(i + 1, chosen + 1, nc, nw, H, sufH, W, best, captures, par, lim)
        W[i] = 0
    nw = waste + H[i]
    if nw <= lim:
        chiitoi_dfs(i + 1, chosen, cost, nw, H, sufH, W, best, captures, par, lim)


def analyze_debug(H, ind, rw, sw, riichi, aka, red_m, red_p, red_s, lim):
    """Тот же анализ, что ss.analyze, но с ловлей лучших W по каждому cost."""
    maxc = np.zeros(34, np.int64)
    sufH = np.zeros(37, np.int64)
    iso = np.zeros(40, np.int64)
    W = np.zeros(34, np.int64)
    trip = np.zeros(34, np.int64)
    seq = np.zeros(34, np.int64)
    pairp = np.zeros(1, np.int64)
    best = np.zeros(LIM + 1, np.int64)
    par = np.zeros(ss.PAR_SIZE, np.int64)
    captures = []

    par[ss.P_DORA] = ss.DORA_NEXT[ind]
    par[ss.P_RW] = rw
    par[ss.P_SW] = sw
    par[ss.P_RIICHI] = riichi
    par[ss.P_TSUMO] = 0
    par[ss.P_AKA] = aka
    par[ss.P_AKA_M] = red_m
    par[ss.P_AKA_P] = red_p
    par[ss.P_AKA_S] = red_s
    for k in range(34):
        maxc[k] = 4
    maxc[ind] = 3
    for k in range(37):
        sufH[k] = 0
    for k in range(33, -1, -1):
        sufH[k] = sufH[k + 1] + H[k]
    for k in range(LIM + 1):
        best[k] = -2
    for k in range(40):
        iso[k] = 0
    for k in range(33, -1, -1):
        lone = 0
        if H[k] == 1:
            lone = 1
            if k < 27:
                r = k % 9
                for d in range(-2, 3):
                    if d != 0 and 0 <= r + d <= 8 and H[k + d] > 0:
                        lone = 0
        iso[k] = iso[k + 1] + lone
    if iso[0] <= 2 * LIM:
        dfs(0, 4, 1, 0, 0, H, maxc, iso, W, trip, seq, pairp, best, captures, par, lim)
    npairs = 0
    nkinds = 0
    for k in range(34):
        if H[k] >= 2:
            npairs += 1
        if H[k] >= 1:
            nkinds += 1
    p7 = npairs if npairs < 7 else 7
    singles = nkinds - npairs
    if singles > 7 - p7:
        singles = 7 - p7
    if 14 - 2 * p7 - singles <= lim:
        chiitoi_dfs(0, 0, 0, 0, H, sufH, W, best, captures, par, lim)
    kinds = 0
    has_pair = 0
    for k in range(13):
        c = H[ss.TERM13[k]]
        if c > 0:
            kinds += 1
        if c >= 2:
            has_pair = 1
    kc = 14 - kinds - has_pair
    if kc <= lim and 13 > best[kc]:
        best[kc] = 13
        captures.append((kc, 13, None, "kokushi"))

    for c in range(lim + 1):
        if best[c] > -2:
            s = c - 1
            if s < 0:
                s = 0
            return s, best[c], captures
    return -1, 0, captures


TILE_NAMES = []
for s in range(3):
    for p in range(9):
        TILE_NAMES.append(f"{p + 1}{'mps'[s]}")
TILE_NAMES += ["ew", "sw", "ww", "nw", "wd", "gd", "rd"]


def w_str(w):
    out = []
    for i in range(34):
        out.extend([TILE_NAMES[i]] * int(w[i]))
    return " ".join(out)


def main():
    cases = json.load(open(TOOLS.parent / "fixtures" / "v4_eval_cases.json", encoding="utf-8"))
    idxs = [int(x) for x in sys.argv[1:]] or list(range(len(cases)))
    # хан риичи — из правил; урадоры этот инструмент не моделирует
    # (par[P_URA_ON] остаётся 0 -> хан выводится без урадор, как «решение»)
    riichi = int(ss.CFG_RULES.get("riichiHan", 0) or 0)
    aka = 1 if ss.CFG_RULES.get("akaDora") else 0

    for i in idxs:
        c = cases[i]
        H = np.zeros(34, np.int64)
        for t in c["tiles"]:
            if t[0] == "0":
                H["mps".index(t[1]) * 9 + 4] += 1
            elif t[1] in "mps":
                H["mps".index(t[1]) * 9 + int(t[0]) - 1] += 1
            else:
                H[{"ew": 27, "sw": 28, "ww": 29, "nw": 30, "wd": 31, "gd": 32, "rd": 33}[t]] += 1
        red_m = 1 if "0m" in c["tiles"] else 0
        red_p = 1 if "0p" in c["tiles"] else 0
        red_s = 1 if "0s" in c["tiles"] else 0
        s = int(ss.shanten_fast(H))
        ind = c["indicator"]
        lim = s + 1 if s <= 2 else 1
        if s <= 2:
            s2, han, caps = analyze_debug(H, ind, c["roundWind"], c["seatWind"],
                                          riichi, aka, red_m, red_p, red_s, lim)
            print(f"[{i}] {' '.join(c['tiles'])} дор={ind}({TILE_NAMES[ind]}) "
                  f"rw={c['roundWind']} sw={c['seatWind']} red=({red_m},{red_p},{red_s})")
            print(f"     shanten={s} analyze: s2={s2} han={han} (ака считается по W)")
            for cap in caps:
                if len(cap) == 4 and cap[3] == "kokushi":
                    print(f"       cost={cap[0]} han={cap[1]} кокуши")
                elif len(cap) == 4:
                    print(f"       cost={cap[0]} han={cap[1]} (чиитоицу) {w_str(np.array(cap[2], np.int64))}")
                else:
                    print(f"       cost={cap[0]} han={cap[1]} {w_str(np.array(cap[2], np.int64))}")
        else:
            print(f"[{i}] shanten={s} (analyze не вызывается)")
        print(f"     expected: {json.dumps(c['expected'], ensure_ascii=False)}")


if __name__ == "__main__":
    main()
