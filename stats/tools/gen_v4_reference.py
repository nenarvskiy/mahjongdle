#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stats/tools/gen_v4_reference.py — эталонные оценки отдельных рук для сверки
игры (JS) со статистикой (Python).

Система v4 реализована в двух местах — src/ (игра) и stats/scorestat.py
(статистика) — и обе стороны читают config/scoring.json. Этот скрипт считает
оценку каждой 13-тайловой руки именно так, как её считает игра, но Python-
ядрами scorestat (shanten_fast / partition_v4 / detect_yaku_v4 / analyze /
tier_of_han), и складывает результат в stats/fixtures/v4_eval_cases.json.
Тест test/v4-parity.test.js прогоняет те же руки через JS evaluateHand и
требует побитового совпадения.

Одна рука = 13 тайлов + индикатор доры + индикатор урадор + ветер раунда/игрока
+ пометка, какие пятёрки в руке красные (ид '0m'/'0p'/'0s' — те же, что в игре).
Модель ака совпадает с игрой: в стене по одному красному тайлу на масть,
пятёрка руки красная с вероятностью n/4 (n — число пятёрок масти в руке),
+1 хан за каждый красный вид, оставшийся в победной руке. analyze получает
эти пометки через par[P_AKA_M/P/S] (см. scorestat.py).
В expected два хана: han — «решение» БЕЗ урадор (по нему выбирается сброс),
hanWithUra — финальный (после открытия урадор лучшая рука ищется заново);
тир/база/итог считаются по финальному хану — как в игре (src/potential.js).
Если победной руки нет (analyze вернул (-1, 0, 0)), хан = -1 — семантика
EMPTY в игре (src/potential.js): «без яку», тир Normal.

Запуск из корня проекта:
    py stats/tools/gen_v4_reference.py
    py stats/tools/gen_v4_reference.py --cases 200 --seed 7
"""
import argparse
import json
import random
import sys
from pathlib import Path

import numpy as np

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS.parent))  # чтобы import scorestat

import scorestat as ss  # noqa: E402  (строит таблицы из конфига при импорте)

FIVE_KINDS = [4, 13, 22]  # 5m 5p 5s

# id структур/яку из конфига (порядок совпадает с порядком в scorestat —
# apply_config читает тот же config/scoring.json).
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


def red_flags_of_tiles(tiles):
    m = 1 if "0m" in tiles else 0
    p = 1 if "0p" in tiles else 0
    s = 1 if "0s" in tiles else 0
    return m, p, s


def evaluate_hand_13(c, ind, ura, rw, sw, riichi, aka, red_m, red_p, red_s, hidx, scratch):
    """Оценка одной 13-тайловой руки — тот же код, что тело цикла в
    simulate_chunk. hidx — уникальный номер руки (для штамп'ов memo).

    Красные пятёрки (red_*) — через par[P_AKA_*] в analyze: хан ака считается
    по победной руке W, как в игре. Если победной руки нет (s2 == -1),
    хан = -1 — семантика EMPTY в игре (src/potential.js).

    Два хана: han — «решение» без урадор (по нему выбирают сброс), hanWithUra —
    финальный (после открытия урадор лучшая рука ищется заново); тир/база/итог
    считаются по финальному хану — так же, как в игре (src/potential.js)."""
    maxc, sufH, iso, W, trip, seq, pairp, bestcost, bestfin, par = scratch[:10]
    pD, pG, pCh, str_cnt = scratch[10:14]
    yak_cnt, yak_pts = scratch[14:16]

    s = int(ss.shanten_fast(c))
    for k in range(ss.N_STRUCT):
        str_cnt[k] = 0
    str_pts = int(ss.partition_v4(c, np.int64(hidx), pD, pG, pCh, str_cnt))
    ss.detect_yaku_v4(c, rw, sw, yak_cnt, yak_pts)
    yak_pts_total = int(yak_pts.sum())

    if s <= 2:
        par[ss.P_AKA_M] = red_m
        par[ss.P_AKA_P] = red_p
        par[ss.P_AKA_S] = red_s
        s2, han0, han_fin0 = ss.analyze(c, ind, ura, rw, sw, riichi, 0, aka,
                                        maxc, sufH, iso, W, trip, seq, pairp, bestcost,
                                        bestfin, par, s + 1)
        han = -1 if s2 == -1 else int(han0)
        han_fin = -1 if s2 == -1 else int(han_fin0)
        state = 2 - s
        tier = int(ss.tier_of_han(han_fin))
        base = int(ss.BASE[state, tier])
    else:
        han, han_fin, state, tier, base = -1, -1, 3, 0, 0

    structures = {STRUCT_IDS[k]: int(str_cnt[k])
                  for k in range(ss.N_STRUCT) if str_cnt[k] > 0}
    yaku = {YAKU_IDS[k]: int(yak_pts[k])
            for k in range(ss.N_YAKU) if yak_pts[k] > 0}
    return {
        "shanten": s, "han": han, "hanWithUra": han_fin,
        "state": state, "tier": tier, "base": base,
        "structures": structures,
        "structurePoints": str_pts,
        "yaku": yaku,
        "yakuPoints": yak_pts_total,
        "total": base + str_pts + yak_pts_total,
    }


def main():
    global STRUCT_IDS, YAKU_IDS
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cases", type=int, default=120,
                    help="сколько случайных рук взять из fixtures/hands13.json")
    ap.add_argument("--seed", type=int, default=20260929)
    ap.add_argument("--out", default=str(TOOLS.parent / "fixtures" / "v4_eval_cases.json"))
    a = ap.parse_args()

    rng = random.Random(a.seed)
    riichi = int(ss.CFG_RULES.get("riichiHan", 0) or 0)
    aka = 1 if ss.CFG_RULES.get("akaDora") else 0
    ura_on = 1 if ss.CFG_RULES.get("uraDora") else 0

    # id из конфига — те же, что и в игре (src/patterns.js, src/yaku-v4.js).
    with open(ss.CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    v4 = cfg["systems"]["v4"]
    STRUCT_IDS = [s["id"] for s in v4["structures"]["list"]]
    YAKU_IDS = [y["id"] for y in v4["yaku"]["list"]]
    assert len(STRUCT_IDS) == ss.N_STRUCT and len(YAKU_IDS) == ss.N_YAKU

    NS = ss.N_SUIT_STATES
    scratch = [
        np.zeros(34, np.int64), np.zeros(37, np.int64), np.zeros(40, np.int64),
        np.zeros(34, np.int64), np.zeros(34, np.int64), np.zeros(34, np.int64),
        np.zeros(1, np.int64), np.zeros(ss.LIM + 1, np.int64),
        np.zeros(ss.LIM + 1, np.int64),
        np.zeros(ss.PAR_SIZE, np.int64),
        np.zeros(10 * NS, np.int64), np.zeros(10 * NS, np.int64),
        np.zeros(10 * NS, np.int64),
        np.zeros(ss.N_STRUCT, np.int64),
        np.zeros(ss.N_YAKU, np.int64), np.zeros(ss.N_YAKU, np.int64),
    ]

    cases = []
    hidx_counter = [0]  # уникальные штамп'ы для memo в partition_v4

    def add_case(c, ind, ura, rw, sw, tiles, note=""):
        hidx_counter[0] += 1
        red_m, red_p, red_s = red_flags_of_tiles(tiles)
        expected = evaluate_hand_13(c, int(ind), int(ura), int(rw), int(sw), riichi, aka,
                                    red_m, red_p, red_s, hidx_counter[0], scratch)
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

    # 1) Случайные руки из фикстуры + случайный контекст (как в большом прогоне).
    hands_path = TOOLS.parent / "fixtures" / "hands13.json"
    with open(hands_path, "r", encoding="utf-8") as f:
        random_hands = json.load(f)
    for counts in random_hands[:a.cases]:
        c = np.array(counts, np.int64)
        ind = rng.randrange(34)
        # ура-индикатор — независимый тайл мёртвой стены (может совпасть с дорой:
        # в стене 4 копии вида, индикаторы — разные физические тайлы)
        ura = rng.randrange(34) if ura_on else 0
        rw = 27 + rng.randrange(4)
        sw = 27 + rng.randrange(4)
        # Красные пятёрки: вероятность n/4 (в стене один красный тайл на масть).
        red_fives = {}
        for kind in FIVE_KINDS:
            n = int(c[kind])
            if n > 0 and rng.random() < n * 0.25:
                red_fives[kind] = 1
        tiles = tiles_of_counts(c, red_fives)
        add_case(c, ind, ura, rw, sw, tiles)

    # 2) Указанные руки — покрытие особых путей (тиры, яку, ака, кан, формы).
    curated = [
        # [13 тайлов, индикатор, rw, sw]
        (["1m", "2m", "3m", "1p", "2p", "3p", "1s", "2s", "3s", "7s", "8s", "9s", "7m"], 24, 27, 29),
        (["1m", "1m", "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "9m", "9m"], 24, 28, 29),
        (["1m", "9m", "1p", "9p", "1s", "9s", "ew", "sw", "ww", "nw", "wd", "gd", "5m"], 24, 27, 30),
        (["2m", "2m", "3m", "3m", "4m", "4m", "5m", "5m", "6m", "6m", "7m", "7m", "8m"], 4, 27, 29),
        (["1m", "9m", "1p", "9p", "1s", "9s", "9m", "9p", "9s", "ew", "sw", "ww", "nw"], 24, 28, 27),
        (["1m", "2m", "4m", "5m", "7p", "8p", "2s", "4s", "6s", "ew", "sw", "wd", "wd"], 30, 27, 27),
        (["0m", "3m", "4m", "1p", "2p", "3p", "1s", "2s", "3s", "7m", "rd", "rd", "rd"], 3, 28, 28),
        (["0m", "0p", "0s", "1m", "2m", "3m", "1p", "2p", "3p", "1s", "2s", "3s", "rd"], 24, 27, 29),
        (["5m", "5m", "5m", "5m", "1p", "2p", "3p", "4s", "5s", "6s", "7s", "8s", "9s"], 24, 27, 29),
        (["1m", "1m", "2m", "2m", "3m", "3m", "4m", "5m", "6m", "rd", "rd", "rd", "ew"], 24, 27, 29),
        (["1m", "2m", "3m", "1p", "2p", "3p", "1s", "2s", "3s", "5m", "5m", "5m", "5m"], 24, 27, 28),
        (["3m", "3m", "3m", "4m", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p"], 24, 28, 30),
        (["2m", "4m", "6m", "2p", "4p", "6p", "2s", "4s", "6s", "3m", "5m", "7m", "9m"], 24, 27, 29),
        (["1m", "2m", "4m", "1p", "2p", "4p", "1s", "2s", "4s", "7m", "8m", "ew", "sw"], 24, 28, 29),
        (["6m", "6m", "6m", "7m", "2p", "3p", "4p", "5s", "6s", "7s", "8s", "9s", "ew"], 24, 27, 27),
        (["1m", "1m", "1p", "1p", "1s", "1s", "9m", "9m", "9p", "9p", "9s", "9s", "ew"], 24, 27, 29),
        (["2m", "3m", "4m", "2m", "3m", "4m", "2p", "3p", "4p", "5p", "6p", "7p", "8p"], 24, 28, 30),
        (["1m", "1m", "2m", "3m", "1p", "2p", "3p", "1s", "2s", "3s", "7m", "8m", "9m"], 3, 27, 29),
        (["5m", "5m", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p", "5m", "5m"], 24, 28, 29),
        (["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1m", "1m", "2m", "3m"], 24, 27, 28),
        (["2m", "2m", "3m", "3m", "4m", "5m", "5m", "5m", "6m", "7m", "8m", "9m", "1p"], 24, 29, 27),
        (["4m", "4m", "4m", "5m", "1p", "1p", "1p", "2p", "3p", "4p", "5p", "6p", "7p"], 24, 27, 29),
        (["1m", "1m", "1m", "1p", "1p", "1p", "1s", "1s", "1s", "9m", "9m", "9m", "9p"], 24, 28, 27),
        (["3m", "3m", "3m", "3m", "4m", "4m", "4m", "4m", "5m", "5m", "5m", "5m", "6m"], 24, 27, 29),
        (["1m", "2m", "3m", "5m", "5m", "5m", "6m", "7m", "8m", "9m", "1p", "1p", "2p"], 3, 28, 30),
        (["1m", "1m", "2m", "2m", "3m", "3m", "4m", "5m", "5m", "7m", "7m", "9m", "9m"], 24, 27, 29),
        (["2p", "3p", "4p", "2p", "3p", "4p", "2s", "3s", "4s", "2m", "4m", "6m", "8m"], 24, 27, 29),
        # --- новые плоские яку (2026-10-19): проверяется САМО свойство состава,
        # готовность руки не требуется — поэтому руки намеренно «недоделанные».
        # рянпейко (два иппейко) + иппейко одновременно
        (["1m", "2m", "3m", "1m", "2m", "3m", "4p", "5p", "6p", "4p", "5p", "6p", "9s"], 24, 27, 29),
        (["2s", "3s", "4s", "2s", "3s", "4s", "6s", "7s", "8s", "6s", "7s", "8s", "1m"], 24, 28, 30),
        # рянпейко из перекрывающихся последовательностей (123 x2 + 234 x2)
        (["1m", "2m", "3m", "1m", "2m", "3m", "2m", "3m", "4m", "2m", "3m", "4m", "5m"], 24, 27, 29),
        # большие драконы (три дракона по 3)
        (["wd", "wd", "wd", "gd", "gd", "gd", "rd", "rd", "rd", "1m", "2m", "3m", "9p"], 24, 27, 29),
        # только хоноры (все 13 тайлов — хоноры)
        (["ew", "ew", "ew", "sw", "sw", "wd", "wd", "gd", "gd",
          "rd", "rd", "nw", "nw"], 24, 28, 27),
        # сёсанген: два дракона по 3 + третий парой (граница с дайсангеном)
        (["wd", "wd", "wd", "gd", "gd", "gd", "rd", "rd", "1m", "2m", "3m", "4m", "5m"], 24, 27, 29),
        # малые ветра (три ветра по 3 + четвёртый парой)
        (["ew", "ew", "ew", "sw", "sw", "sw", "ww", "ww", "ww", "nw", "nw", "1m", "2m"], 24, 27, 30),
        # большие ветра (четыре ветра по 3)
        (["ew", "ew", "ew", "sw", "sw", "sw", "ww", "ww", "ww", "nw", "nw", "nw", "1m"], 24, 28, 29),
        # только терминалы (хоноров нет) — и хонрото заодно
        (["1m", "1m", "1m", "9m", "9m", "9m", "1p", "1p", "1p", "9p", "9p", "9s", "9s"], 24, 27, 29),
        # только зелёные (2,3,4,6,8s + зелёный дракон) — и хоницу/иппейко заодно
        (["2s", "2s", "2s", "3s", "3s", "4s", "4s", "6s", "6s", "8s", "8s", "gd", "gd"], 24, 27, 28),
        # не зелёные: 9s в составе — рюисо быть не должно
        (["2s", "2s", "3s", "3s", "4s", "4s", "6s", "6s", "8s", "8s", "gd", "gd", "9s"], 24, 27, 28),
        # сансёку доккоу: тройки 1 в трёх мастях (id больше НЕ срабатывает на драконов)
        (["1m", "1m", "1m", "1p", "1p", "1p", "1s", "1s", "1s", "5m", "6m", "7m", "9p"], 24, 27, 29),
        # --- ценные: мультисаунды по видам + без кумуляции ступенек (2026-10-23) ---
        # две пары ценных (ветер раунда + ветра места) = 2 × «пара ценных»
        (["ew", "ew", "sw", "sw", "1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s"], 24, 27, 28),
        # два ценных пона (сёсанген): 2 × «якухай» + «пара ценных» (пара — свой вид)
        (["wd", "wd", "wd", "gd", "gd", "gd", "rd", "rd", "1m", "2m", "3m", "4p", "5p"], 24, 27, 29),
        # смешанно: ценный пон + ценная пара + одиночный ценный (три вида)
        (["wd", "wd", "wd", "gd", "gd", "rd", "1m", "2m", "3m", "4p", "5p", "6p", "7s"], 24, 27, 29),
        # четыре одиночных ценных = 4 × «1 ценный тайл»
        (["ew", "sw", "wd", "gd", "1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s"], 24, 27, 28),
    ]
    for i, (tiles, ind, rw, sw) in enumerate(curated):
        c = counts_of_tiles(tiles)
        assert c.sum() == 13, f"в руках {tiles} не 13 тайлов"
        ura = (ind + 1 + i) % 34 if ura_on else 0
        add_case(c, ind, ura, rw, sw, tiles, "указанная рука")

    # 3) Ура-дора: индикатор подбирается так, чтобы урадорой был тайл ИЗ руки —
    # гарантированное покрытие урадор (включая случай «ура = дора»).
    def indicator_for_dora(idx):
        return int(np.where(ss.DORA_NEXT == idx)[0][0])

    curated_ura = [
        # [13 тайлов, тайл-урадора, индикатор доры (None — «ура = дора»), rw, sw]
        (["1m", "2m", "3m", "1p", "2p", "3p", "1s", "2s", "3s", "7m", "7m", "9m", "9m"], "9m", 24, 27, 29),
        (["1m", "1m", "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "9m", "9m"], "1m", 24, 28, 29),
        (["0m", "3m", "4m", "1p", "2p", "3p", "1s", "2s", "3s", "7m", "rd", "rd", "rd"], "5m", 3, 28, 28),
        (["5m", "5m", "5m", "5m", "1p", "2p", "3p", "4s", "5s", "6s", "7s", "8s", "9s"], "5p", 24, 27, 29),
        (["2p", "3p", "4p", "2p", "3p", "4p", "2s", "3s", "4s", "2m", "4m", "6m", "8m"], "2s", 24, 27, 29),
        # ура = дора: обе копии одного вида лежат в мёртвой стене (добора вида нет)
        (["1m", "2m", "3m", "1p", "2p", "3p", "1s", "2s", "3s", "7m", "7m", "9m", "9m"], "9m", None, 27, 29),
    ]
    for tiles, ura_tile, ind, rw, sw in curated_ura:
        c = counts_of_tiles(tiles)
        assert c.sum() == 13, f"в руках {tiles} не 13 тайлов"
        if not ura_on:
            add_case(c, 0 if ind is None else ind, 0, rw, sw, tiles, "урадоры выключены")
            continue
        ura = indicator_for_dora(tile_to_index(ura_tile))
        if ind is None:
            ind = ura
        add_case(c, ind, ura, rw, sw, tiles, f"ура-дора {ura_tile}")

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(cases, f, ensure_ascii=False, indent=1)
    print(f"случайных рук: {min(a.cases, len(random_hands))}, "
          f"указанных: {len(curated) + len(curated_ura)}")
    print(f"файл: {out} ({len(cases)} рук)")

    # Сводка по тирам/состояниям, чтобы было видно, что покрытие нормальное.
    from collections import Counter
    states = Counter(case["expected"]["state"] for case in cases)
    tiers = Counter(case["expected"]["tier"] for case in cases)
    print("состояния:", dict(sorted(states.items())))
    print("тиры     :", dict(sorted(tiers.items())))


if __name__ == "__main__":
    main()
