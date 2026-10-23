#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stats/tools/gen_complete_reference.py — эталонные оценки ГОТОВЫХ 14-тайловых
рук для сверки игры (JS evaluateCompleteHand) со статистикой (Python scorestat,
режим --mode complete).

Скрипт случайно дилует 14 тайлов + индикатор доры + индикатор урадор +
ветер раунда/игрока + красные пятёрки ('0m'/'0p'/'0s' — те же, что в игре),
оставляет только ГОТОВЫЕ руки (isWinningHand) и для каждой считает оценку
именно так, как готовую стартовую руку считает игра (src/scoring.js ->
evaluateCompleteHand):

  * хан: кокуши -> 13; чиитоицу и стандарт (двойная рука — и то и другое)
    max хана по ВСЕМ разложениям (allDecompositions); готовая рука не имеет
    выигрышного тайла -> нет пинфу/типа ожидания; риичи игра готовой руке
    СЧИТАЕТ (+rules.riichiHan, как и potential.js); цумо отключён правилом;
    дора, ака и ура-дора — как в игре;
  * база = строка «Готовая рука» (последняя строка таблицы базы) x тир;
  * структура = лучшее разбиение всех 14 тайлов, яку — на всех 14 тайлах.

Перед генерацией быстрое ядро complete_type сверяется с прямым портом
isWinningHand (src/shanten.js) на случайных руках (маски должны совпасть
побитово), чтобы reject по (сумма масти) % 3 не скрывал ошибку логики.

Результат — stats/fixtures/v4_complete_cases.json; тест
test/v4-complete-parity.test.js прогоняет те же руки через JS и требует
побитового совпадения.

Запуск из корня проекта:
    py stats/tools/gen_complete_reference.py
    py stats/tools/gen_complete_reference.py --random 800 --seed 7
"""
import argparse
import json
import sys
from pathlib import Path

# консоль Windows (cp1251) не умеет печатать часть символов — не падаем из-за вывода
try:
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass

import numpy as np

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS.parent))  # чтобы import scorestat

import scorestat as ss  # noqa: E402  (строит таблицы из конфига при импорте)
from scorestat import _splitmix64, complete_type  # noqa: E402  (нужны как globals numba)

KOKUSHI = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]
FIVE_KINDS = [4, 13, 22]  # 5m 5p 5s

STRUCT_IDS = []
YAKU_IDS = []


def index_to_tile(index):
    if index < 27:
        suit = "mps"[index // 9]
        return f"{index % 9 + 1}{suit}"
    return ["ew", "sw", "ww", "nw", "wd", "gd", "rd"][index - 27]


def tile_to_index(tile):
    if tile[0] == "0":
        return tile_to_index(f"5{tile[1]}")
    if tile[1] in "mps":
        return "mps".index(tile[1]) * 9 + int(tile[0]) - 1
    return 27 + {t: i for i, t in enumerate(["ew", "sw", "ww", "nw", "wd", "gd", "rd"])}[tile]


def counts_of_tiles(tiles):
    c = np.zeros(34, np.int64)
    for t in tiles:
        c[tile_to_index(t)] += 1
    return c


def tiles_of_counts(c, red_fives):
    """tiles из counts: red_fives = {kind: 1} — одна пятёрка вида красная."""
    tiles = []
    red_left = dict(red_fives)
    for i in range(34):
        for _ in range(int(c[i])):
            if red_left.get(i, 0) > 0:
                red_left[i] -= 1
                tiles.append(f"0{'mps'[i // 9]}")
            else:
                tiles.append(index_to_tile(i))
    return tiles


# ---------------------------------------------------------------- эталонная проверка готовности (порт src/shanten.js)

def ref_4melds(c):
    i = 0
    while i < 34 and c[i] == 0:
        i += 1
    if i >= 34:
        return True
    if c[i] >= 3:
        c[i] -= 3
        r = ref_4melds(c)
        c[i] += 3
        if r:
            return True
    if i < 27 and (i % 9) <= 6 and c[i + 1] > 0 and c[i + 2] > 0:
        c[i] -= 1
        c[i + 1] -= 1
        c[i + 2] -= 1
        r = ref_4melds(c)
        c[i] += 1
        c[i + 1] += 1
        c[i + 2] += 1
        if r:
            return True
    return False


def ref_complete_mask(c):
    """Маска готовности: 1 — стандарт, 2 — чиитоицу, 4 — кокуши (порт isWinningHand)."""
    mask = 0
    for p in range(34):
        if c[p] < 2:
            continue
        t = np.array(c, np.int64)
        t[p] -= 2
        if ref_4melds(t):
            mask |= 1
    pr = 0
    ok = True
    for i in range(34):
        if c[i] == 2:
            pr += 1
        elif c[i] != 0:
            ok = False
    if ok and pr == 7:
        mask |= 2
    k = 0
    pair = 0
    for i in range(34):
        if i not in KOKUSHI and c[i]:
            return mask  # не кокуши, но остальные биты уже учтены
        if c[i] >= 1:
            k += 1
        if c[i] >= 2:
            pair += 1
    if k == 13 and pair == 1:
        mask |= 4
    return mask


def fuzz_check(n, seed):
    """Сверяем быстрое ядро complete_type с эталонным портом на n руках."""
    rng = np.random.default_rng(seed)
    bad = 0
    for h in range(n):
        c = np.zeros(34, np.int64)
        for _ in range(14):
            c[int(rng.integers(0, 34))] += 1
        fast = int(complete_type(c))
        slow = ref_complete_mask(c)
        if fast != slow:
            bad += 1
            print(f"  РАСХОЖДЕНИЕ [{h}]: fast={fast} slow={slow} counts={list(map(int, c))}")
            if bad > 5:
                break
    return bad


# ---------------------------------------------------------------- генератор готовых рук (numba)

@ss.njit
def gen_complete_deals(n_deals, seed, n_max, tiles_out, ind_out, ura_out, rw_out, sw_out, red_out):
    """Дилует случайные 14-тайловые руки и записывает готовые в массивы.
    tiles_out[n, 14] — индексы тайлов; red_out[n, 3] — 0/1 красная ли пятёрка
    масти (модель n/4, та же, что в режиме 2). Возвращает число записанных.
    В мёртвой стене два индикатора: доры (deck[14]) и урадор (deck[15])."""
    st_a = seed & 0x7FFFFFFFFFFFFFFF
    if st_a == 0:
        st_a = ss.SM64_ADD
    # вторая независимая ветка (ветры/ака) — см. simulate_complete_chunk
    st_b = st_a
    st_b = ((st_b ^ (st_b >> 30)) * ss.SM64_MUL1)
    st_b = ((st_b ^ (st_b >> 27)) * ss.SM64_MUL2)
    st_b = st_b ^ (st_b >> 31)
    deck = np.empty(136, np.int64)
    for k in range(136):
        deck[k] = k // 4
    H = np.zeros(34, np.int64)
    written = 0
    az = np.empty(5, np.int64)
    for _ in range(n_deals):
        # микс инлайнится: баг numba при нескольких call-site'ах _splitmix64
        for k in range(16):
            s = st_a + ss.SM64_ADD
            z = s
            z = (z ^ (z >> 30)) * ss.SM64_MUL1
            z = (z ^ (z >> 27)) * ss.SM64_MUL2
            z = z ^ (z >> 31)
            st_a = s
            j = k + (z % (136 - k))
            tmp = deck[k]
            deck[k] = deck[j]
            deck[j] = tmp
        for k in range(34):
            H[k] = 0
        for k in range(14):
            H[deck[k]] += 1
        for k in range(5):
            s = st_b + ss.SM64_ADD
            z = s
            z = (z ^ (z >> 30)) * ss.SM64_MUL1
            z = (z ^ (z >> 27)) * ss.SM64_MUL2
            z = z ^ (z >> 31)
            st_b = s
            az[k] = z
        if complete_type(H) == 0:
            continue
        rw = 27 + (az[0] % 4)
        sw = 27 + (az[1] % 4)
        for k in range(14):
            tiles_out[written, k] = deck[k]
        ind_out[written] = deck[14]
        ura_out[written] = deck[15]
        rw_out[written] = rw
        sw_out[written] = sw
        for i in range(3):
            kind = 4 + i * 9
            n = int(H[kind])
            zr = az[2 + i]
            red_out[written, i] = 1 if (n > 0 and zr % 10000 < n * 2500) else 0
        written += 1
        if written >= n_max:
            break
    return written


# ---------------------------------------------------------------- оценка эталона

def evaluate_complete_14(c, ind, ura, rw, sw, red_m, red_p, red_s, hidx, scratch):
    """Оценка готовой 14-тайловой руки — тот же код, что в simulate_complete_chunk
    (eval_complete_hand из scorestat): база = строка «Готовая рука» таблицы базы,
    структуры и яку — на всех 14 тайлах, риичи — по общему дефолту (хан из
    rules.riichiHan, как в игре: potential.js и evaluateCompleteHand передают
    riichi:true), урадоры — считаются (готовая рука уже «после сброса»)."""
    par, trip, seq, pairp, best = scratch[0:5]
    pD, pG, pCh, str_cnt = scratch[5:9]
    yak_cnt, yak_pts = scratch[9:11]
    aka = 1 if ss.CFG_RULES.get("akaDora") else 0
    riichi = int(ss.CFG_RULES.get("riichiHan", 0) or 0)
    ura_on = 1 if ss.CFG_RULES.get("uraDora") else 0
    par[ss.P_AKA_M] = red_m
    par[ss.P_AKA_P] = red_p
    par[ss.P_AKA_S] = red_s
    han, tier, base, str_pts, yak_pts_total = ss.eval_complete_hand(
        c, int(ind), int(ura) if ura_on else -1, int(rw), int(sw), riichi, 0, aka,
        par, trip, seq, pairp,
        best, pD, pG, pCh, str_cnt, yak_cnt, yak_pts,
        np.int64(hidx))
    structures = {STRUCT_IDS[k]: int(str_cnt[k])
                  for k in range(ss.N_STRUCT) if str_cnt[k] > 0}
    yaku = {YAKU_IDS[k]: int(yak_pts[k])
            for k in range(ss.N_YAKU) if yak_pts[k] > 0}
    return {
        "complete": True,
        "han": int(han),
        "tier": int(tier),
        "base": int(base),
        "structurePoints": int(str_pts),
        "structures": structures,
        "yaku": yaku,
        "yakuPoints": int(yak_pts_total),
        "total": int(base) + int(str_pts) + int(yak_pts_total),
    }


def main():
    global STRUCT_IDS, YAKU_IDS
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--random", type=int, default=600,
                    help="сколько случайных готовых рук собрать")
    ap.add_argument("--deals", type=int, default=300_000_000,
                    help="максимум дилерских рук для поиска случайных готовых")
    ap.add_argument("--seed", type=int, default=20260929)
    ap.add_argument("--fuzz", type=int, default=200_000,
                    help="рук для сверки complete_type с эталонным портом (0 — выкл.)")
    ap.add_argument("--out", default=str(TOOLS.parent / "fixtures" / "v4_complete_cases.json"))
    a = ap.parse_args()

    with open(ss.CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    v4 = cfg["systems"]["v4"]
    STRUCT_IDS = [s["id"] for s in v4["structures"]["list"]]
    YAKU_IDS = [y["id"] for y in v4["yaku"]["list"]]
    assert len(STRUCT_IDS) == ss.N_STRUCT and len(YAKU_IDS) == ss.N_YAKU

    # 0) Сверка быстрого ядра с эталонным портом isWinningHand.
    if a.fuzz > 0:
        print(f"сверка complete_type с эталонным портом: {a.fuzz:,} рук...")
        bad = fuzz_check(a.fuzz, a.seed)
        if bad:
            raise SystemExit(f"complete_type расходится с эталоном: {bad} рук")
        print("  совпадает (complete_type == isWinningHand)")

    NS = ss.N_SUIT_STATES
    scratch = [
        np.zeros(ss.PAR_SIZE, np.int64), np.zeros(34, np.int64),
        np.zeros(34, np.int64), np.zeros(1, np.int64), np.zeros(1, np.int64),
        np.zeros(10 * NS, np.int64), np.zeros(10 * NS, np.int64),
        np.zeros(10 * NS, np.int64),
        np.zeros(ss.N_STRUCT, np.int64),
        np.zeros(ss.N_YAKU, np.int64), np.zeros(ss.N_YAKU, np.int64),
    ]

    cases = []
    hidx_counter = [0]

    def add_case(c, ind, ura, rw, sw, tiles, note=""):
        hidx_counter[0] += 1
        red_fives = {}
        for i, kind in enumerate(FIVE_KINDS):
            if "0" + "mps"[kind // 9] in tiles:
                red_fives[kind] = 1
        expected = evaluate_complete_14(c, ind, ura, rw, sw,
                                        red_fives.get(4, 0), red_fives.get(13, 0),
                                        red_fives.get(22, 0), hidx_counter[0], scratch)
        case = {
            "tiles": tiles,
            "indicator": int(ind),
            "ura": int(ura),
            "roundWind": int(rw),
            "seatWind": int(sw),
            "expected": expected,
        }
        if note:
            case["note"] = note
        cases.append(case)

    # 1) Случайные готовые руки (numba-генератор).
    print(f"генерация случайных готовых рук (до {a.random} шт, до {a.deals:,} дилерских)...")
    tiles_buf = np.zeros((a.random, 14), np.int64)
    ind_buf = np.zeros(a.random, np.int64)
    ura_buf = np.zeros(a.random, np.int64)
    rw_buf = np.zeros(a.random, np.int64)
    sw_buf = np.zeros(a.random, np.int64)
    red_buf = np.zeros((a.random, 3), np.int64)
    t0 = __import__("time").time()
    n = int(gen_complete_deals(a.deals, a.seed, a.random, tiles_buf, ind_buf, ura_buf,
                               rw_buf, sw_buf, red_buf))
    el = __import__("time").time() - t0
    print(f"  найдено: {n:,} готовых за {el:.0f} c "
          f"(~1 на {int(a.deals / max(n, 1)) // 1000 * 1000 if n else 0:,} дилерских)")
    for i in range(n):
        red_fives = {}
        for j, kind in enumerate(FIVE_KINDS):
            if red_buf[i, j] == 1:
                red_fives[kind] = 1
        c = np.zeros(34, np.int64)
        for k in range(14):
            c[tiles_buf[i, k]] += 1
        tiles = tiles_of_counts(c, red_fives)
        assert sum(int(c[k]) for k in range(34)) == 14
        add_case(c, int(ind_buf[i]), int(ura_buf[i]), int(rw_buf[i]), int(sw_buf[i]), tiles)

    # 2) Указанные руки — покрытие особых путей (14 тайлов, индикатор, rw, sw).
    curated = [
        (["2m", "3m", "4m", "5m", "6m", "7m", "2p", "3p", "4p", "5p", "6p", "7p", "sw", "sw"], 24, 27, 29,
         "бессе яку кроме риичи (1 хан, Normal)"),
        (["2m", "3m", "4m", "5m", "6m", "7m", "2p", "3p", "4p", "5p", "6p", "7p", "8s", "8s"], 24, 27, 28,
         "таняо + 2 доры, БЕЗ пинфу (нет выигрышного тайла)"),
        (["1m", "1m", "3m", "3m", "5p", "5p", "7s", "7s", "ew", "ew", "wd", "wd", "rd", "rd"], 0, 28, 30,
         "чиитоицу чистый (3 хана: 2 + риичи)"),
        (["0p", "0p", "3m", "3m", "5s", "5s", "7s", "7s", "ew", "ew", "wd", "wd", "rd", "rd"], 9, 27, 31,
         "чиитоицу + 2 ака (5 хан)"),
        (["1m", "9m", "1p", "9p", "1s", "9s", "ew", "sw", "ww", "nw", "wd", "gd", "rd", "rd"], 4, 27, 27,
         "кокуши мусо (13)"),
        (["2m", "2m", "3m", "3m", "4m", "4m", "5m", "5m", "6m", "6m", "7m", "7m", "8m", "8m"], 24, 29, 29,
         "двойная: стандарт (иппэйко+таняо+риичи=5) vs чиитоицу (4)"),
        (["1m", "1m", "1m", "2m", "2m", "2m", "3m", "3m", "3m", "4m", "4m", "4m", "5m", "5m"], 0, 27, 29,
         "2 разложения: суанко (13) vs чиницу+иппэйко+3 доры (10) -> 13"),
        (["2s", "2s", "2s", "3s", "3s", "3s", "4s", "4s", "4s", "6s", "6s", "6s", "8s", "8s"], 24, 28, 28,
         "рюусо (13) + суанко (13)"),
        (["2m", "3m", "4m", "wd", "wd", "wd", "gd", "gd", "gd", "rd", "rd", "rd", "8m", "8m"], 24, 27, 30,
         "дайсанген (13)"),
        (["1m", "1m", "1m", "2p", "2p", "2p", "3s", "3s", "3s", "4m", "4m", "4m", "5p", "5p"], 22, 29, 28,
         "суанко (13)"),
        (["1m", "1m", "9m", "9m", "1p", "1p", "9p", "9p", "1s", "1s", "9s", "9s", "ew", "ew"], 0, 27, 29,
         "чиитоицу-цуисо: НЕ якуман (чиитоицу 2 + хонрото 2 + риичи = 5, манган)"),
        (["2m", "3m", "4m", "5p", "6p", "7p", "2s", "3s", "4s", "5s", "5s", "5s", "ew", "ew"], 24, 27, 29,
         "пара ценных (ветер раунда), 1 хан (риичи)"),
        (["0m", "0m", "0m", "2p", "3p", "4p", "5s", "6s", "7s", "8m", "8m", "9m", "9m", "9m"], 18, 27, 30,
         "ака в поне + таняо (3 хана)"),
        (["1m", "1m", "1m", "2m", "2m", "3m", "3m", "4m", "4m", "5m", "6m", "7m", "8m", "9m"], 8, 27, 29,
         "итцу (1 дора, 2 хана)"),
        (["1m", "2m", "3m", "1p", "2p", "3p", "1s", "2s", "3s", "4m", "4m", "4m", "5m", "6m"], 24, 28, 31,
         "сансёку додзюн + 1122-разложение"),
        (["2m", "2m", "4p", "4p", "6s", "6s", "8s", "8s", "ew", "ew", "sw", "sw", "1m", "1m"], 11, 27, 29,
         "чиитоицу + 2 доры (5 хан)"),
        # --- ценные: мультисаунды по видам в готовой руке (2026-10-23) ---
        (["2m", "3m", "4m", "5p", "6p", "7p", "7s", "8s", "9s", "ew", "ew", "sw", "sw", "sw"], 24, 27, 28,
         "ценный пон (ветра места) + ценная пара (ветер раунда): 2 разных вида"),
        (["wd", "wd", "wd", "gd", "gd", "gd", "1m", "2m", "3m", "4p", "5p", "6p", "7s", "7s"], 24, 27, 29,
         "2 × ценный пон (пара не дракон — сёсангена нет)"),
        (["1m", "9m", "1p", "9p", "1s", "9s", "ew", "sw", "ww", "nw", "wd", "gd", "rd", "rd"], 24, 27, 28,
         "кокуши: 4 × «1 ценный тайл» + пара ценных (rd)"),
    ]
    for tiles, ind, rw, sw, note in curated:
        c = counts_of_tiles(tiles)
        assert c.sum() == 14, f"в руках {tiles} не 14 тайлов"
        assert complete_type(c) != 0, f"рука {tiles} не готова!"
        add_case(c, ind, (ind + 3) % 34, rw, sw, tiles, note)

    # 3) Ура-дора в готовой руке: индикатор подбирается так, чтобы урадорой был
    # тайл ИЗ руки (гарантированное покрытие), плюс случай «ура = дора».
    def indicator_for_dora(idx):
        return int(np.where(ss.DORA_NEXT == idx)[0][0])

    curated_ura = [
        # [14 тайлов, тайл-урадора, индикатор доры (None — «ура = дора»), rw, sw]
        (["2m", "3m", "4m", "5m", "6m", "7m", "2p", "3p", "4p", "5p", "6p", "7p", "8s", "8s"], "8s", 24, 27, 28),
        (["1m", "1m", "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "9m", "9m", "9m"], "1m", 24, 28, 29),
        (["2m", "3m", "4m", "5p", "6p", "7p", "2s", "3s", "4s", "5s", "5s", "5s", "ew", "ew"], "2s", None, 27, 29),
    ]
    for tiles, ura_tile, ind, rw, sw in curated_ura:
        c = counts_of_tiles(tiles)
        assert c.sum() == 14, f"в руках {tiles} не 14 тайлов"
        assert complete_type(c) != 0, f"рука {tiles} не готова!"
        ura = indicator_for_dora(tile_to_index(ura_tile))
        if ind is None:
            ind = ura
        add_case(c, ind, ura, rw, sw, tiles, f"ура-дора {ura_tile}")

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(cases, f, ensure_ascii=False, indent=1)
    from collections import Counter
    tiers = Counter(case["expected"]["tier"] for case in cases)
    hans = Counter(case["expected"]["han"] for case in cases)
    print(f"случайных: {n}, указанных: {len(curated)}")
    print(f"файл: {out} ({len(cases)} рук)")
    print("тиры:", dict(sorted(tiers.items())))
    print("ханы:", dict(sorted(hans.items())))


if __name__ == "__main__":
    main()
