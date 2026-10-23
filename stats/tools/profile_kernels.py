# -*- coding: utf-8 -*-
"""Профиль: сколько занимает analyze / bp / yaku на типичной руке (numba)."""
import sys, time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import scorestat as ss

rng = np.random.default_rng(1)

def rand13():
    H = np.zeros(34, np.int64)
    wall = [k for k in range(34) for _ in range(4)]
    for _ in range(13):
        H[wall.pop(int(rng.integers(len(wall))))] += 1
    return H

hands = [rand13() for _ in range(400)]
ind = 31
rw, sw = 27, 29
aka = 1
riichi = int(ss.CFG_RULES.get("riichiHan", 1) or 0)

maxc = np.zeros(34, np.int64); sufH = np.zeros(37, np.int64)
iso = np.zeros(40, np.int64); W = np.zeros(34, np.int64)
trip = np.zeros(34, np.int64); seq = np.zeros(34, np.int64)
pairp = np.zeros(1, np.int64); bestcost = np.zeros(4, np.int64)
bestfin = np.zeros(4, np.int64)
par = np.zeros(ss.PAR_SIZE, np.int64)

# прогрев
ss.analyze(hands[0], ind, 5, rw, sw, riichi, 0, aka, maxc, sufH, iso, W, trip, seq, pairp, bestcost, bestfin, par, ss.LIM)
from numba.typed import Dict
memo = Dict()
memo[(np.int64(0), np.int64(0))] = 0
c13 = hands[0].copy()
k0 = k1 = 0
for i in range(17):
    k0 |= int(c13[i]) << (3*i); k1 |= int(c13[i+17]) << (3*i)
ss.bp(c13, 0, k0, k1, memo)
ss.detect_yaku_v4(hands[0], rw, sw, np.zeros(ss.N_YAKU, np.int64), np.zeros(ss.N_YAKU, np.int64))

N = 2000
t0 = time.perf_counter()
for h in hands * 5:
    ss.analyze(h, ind, 5, rw, sw, riichi, 0, aka, maxc, sufH, iso, W, trip, seq, pairp, bestcost, bestfin, par, ss.LIM)
t1 = time.perf_counter()
print(f"analyze:   {(t1-t0)/N*1e6:8.2f} us/вызов  (lim={ss.LIM}, шантен любой)")

t0 = time.perf_counter()
cnt = np.zeros(ss.N_STRUCT, np.int64)
for h in hands * 5:
    c13[:] = h
    k0 = k1 = 0
    for i in range(17):
        k0 |= int(c13[i]) << (3*i); k1 |= int(c13[i+17]) << (3*i)
    ss.bp(c13, 0, k0, k1, memo)
    for k in range(ss.N_STRUCT):
        cnt[k] = 0
    ss.bp_reconstruct(c13, 0, k0, k1, memo, cnt)
t1 = time.perf_counter()
print(f"bp+recon:  {(t1-t0)/N*1e6:8.2f} us/руку  (рекурсивный эталон)")

t0 = time.perf_counter()
yc = np.zeros(ss.N_YAKU, np.int64); yp = np.zeros(ss.N_YAKU, np.int64)
for h in hands * 5:
    ss.detect_yaku_v4(h, rw, sw, yc, yp)
t1 = time.perf_counter()
print(f"yaku:      {(t1-t0)/N*1e6:8.2f} us/руку")
