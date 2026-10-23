#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stats/scorestat.py — большой прогон системы очков v4.

ДВА ОСНОВНЫХ РЕЖИМА (флаг --mode) + два дизайнерских:

  discard (по умолчанию) — идеальный сброс. Для каждой случайной 14-тайловой
  руки + индикатор доры + индикатор урадор + ветер раунда/игрока для КАЖДОГО
  из <=14 возможных сбросов считается очковая стоимость получившейся
  13-тайловой руки по концепту игры (src/scoring.js, src/potential.js,
  src/partition.js, src/patterns.js):

    * состояние = шантен 13-тайловой руки (2-шантен / 1-шантен / тенпай);
    * тир = лучшая по хану рука, достижимая за минимальное число добора
      (риичи +rules.riichiHan, цумо нет, дора от индикатора; ака — как в игре:
      в стене по одному красному тайлу на масть, пятёрка руки красная с
      вероятностью n/4, хан дают красные пятёрки, оставшиеся в победной руке;
      фу не считаются, манган = 5+ хан) — то же, что analyzePotential/
      bestCompletion/valueTier в игре;
    * УРА-ДОРЫ (по умолчанию включены, --no-ura отключает): индикатор урадор
      лежит в мёртвой стене, поэтому он НЕ участвует в «решении» — по нему
      нельзя выбирать сброс и нельзя угадывать тир/структуру/яку. Модель
      двухэтапная, ровно как в игре:
        1) решение (сброс, целевая рука, тир, структура, яку) — по хану БЕЗ
           урадор;
        2) ФИНАЛЬНЫЙ СЧЁТ — по той же лучшей руке, но уже с открытыми
           урадорами: analyze возвращает и best (без урадор), и best_fin
           (с урадорами), и очки считаются по best_fin. Якуман урадоры не
           получает (как и дору) — это делает сам eval_regular;
    * база = таблица 3x6 (состояние x тир), финальные значения v4;
    * структура = bestPartition — ЛУЧШЕЕ разбиение 13 тайлов на паттерны v4
      (пара/пон/кан/чи/34/13/12/2345/23456/1122/334/246/3334);
    * яку = яку v4, выполняющиеся на 13 тайлах (доккоу ... ценный тайл).

  Идеальный сброс = тот, что даёт максимальный общий итог
  (база + структура + яку). Собираемая статистика:

    * гистограмма итогового счёта (линейная 0..4096 + log2 4096..1e9)
      -> score_hist.svg + score_hist.csv;
    * очки и количества по каждому ячейке состояния×тира, структуре, яку
      -> components.csv + отчёт в консоль (сравнение с проектировочным EV).

  complete — готовая стартовая рука. Для каждой случайной 14-тайловой дилерской
  руки + индикатор доры + индикатор урадор + ветер проверяется, ГОТОВА ли она
  (isWinningHand из src/shanten.js — стандарт 4 мендзена+пара, чиитоицу, кокуши).
  Готовая рука считается ровно как evaluateCompleteHand в игре (src/scoring.js):
  это «после решения», поэтому урадоры здесь считаются сразу (индикатор урадор
  уже открыт вместе с рукой):

    * хан: кокуши -> 13; чиитоицу и стандарт (если рука двойная — и то и другое)
      — max хана по ВСЕМ разложениям (игра ходит allDecompositions); готовая
      рука не имеет выигрышного тайла -> нет типа ожидания -> нет пинфу;
      риичи — тот же дефолт, что в режиме 1 (идеальная рука объявляет риичи,
      +rules.riichiHan; --no-riichi отключает); цумо отключён правилом;
      дора, ура-дора и ака — как в игре;
    * база = СТРОКА «ГОТОВАЯ РУКА» таблицы базы (последняя строка) x тир
      (flat-бонуса за готовую руку нет: строка уже = 2x строки «Тенпай»);
    * структура = лучшее разбиение ВСЕХ 14 тайлов; яку — на всех 14 тайлах.

  design / design-complete — дизайн-частоты (state x tier и строка «Готовая
  рука») в формате таблиц maj_stat, чтобы пересчитывать цены базы по K/P
  (см. write_design_report и config/scoring.json -> systems.v4.base.note).
  Отчёт содержит итоговые P, K, K/P и готовые числа для вставки в конфиг;

  Неготовые руки получают 0 очков. Собирается: вероятность готовности
  (P = готовых/дилерских, «1 из N»), типы (стандарт/чиитоицу/кокуши),
  тир, гистограмма счёта готовых рук, структуры/яку/ака/дора/хан внутри
  готовых -> те же файлы + консольный отчёт. Режим оптимизирован под очень
  большие прогоны: проверка готовности — быстрый reject по (сумма масти) % 3,
  хан считается только на готовых руках, локальный SplitMix64-генератор
  вместо np.random — ориентир на 12 ядрах ~1-2e6 рук/с на ядро,
  1e9 рук за ~1-2 минуты, 1e10 — десятки минут.

Все ЧИСЛА (таблица базы, цены структур и яку, пороги тиров, правила)
берутся из config/scoring.json -> systems.v4 — единственного источника.
Здесь только логика: как считать очки по этим числам.
Правка цен не требует изменений в коде; другой конфиг можно подсунуть
флагом --config.

База — design/mahahaahhaah.py (режим shanten): ядро analyze/eval_regular
переиспользуется как есть. Свои быстрые ядра:
  * shanten_fast — шантен по формуле игры (src/shanten.js), без перебора победных рук;
  * partition_v4 — лучшее разбиение через DP по мастям (паттерны не пересекают масти),
    сверено с рекурсивным bestPartition (и с JS-версией на 3000 руках) — совпадает;
  * detect_yaku_v4 — яку на 13 тайлах;
  * analyze вызывается только для сбросов с шантеном <= 2 и только на нужной
    глубине lim = шантен+1 (тенпай ~21 мкс вместо ~1135 мкс, 1-шантен ~104 вместо ~584).

Замеренная скорость (эта 12-поточная машина, numba): ~2.3e3 рук/с на одно ядро;
12 процессов дают на установившемся режиме ~14.5e3 рук/с (первую минуту идёт
компиляция numba в каждом процессе, поэтому в отчёте видно разгон).
Ориентиры по времени на этот прогон:
  1e6  ~ 1 мин     1e7  ~ 12 мин     1e8  ~ 2 ч     1e9  ~ 19 ч
На 16+ физических ядрах масштабируется почти линейно, поэтому миллиард
реалистичен примерно за ночь.

Запуск (на этой машине python — заглушка WindowsApps, используйте py;
из корня проекта, где лежит config/):
  py stats/scorestat.py -n 1000000000 -w 12          # миллиард рук (идеальные сбросы)
  py stats/scorestat.py -n 100000 -w 12              # быстрая проверка
  py stats/scorestat.py -n 100000 --quick            # один процесс
  py stats/scorestat.py --no-aka --no-riichi         # вариант без ака/риичи в тире
  py stats/scorestat.py --partition-check stats/fixtures/hands13.json
  py stats/scorestat.py --config config/scoring.json -n 20000 --quick
  py stats/scorestat.py --mode complete -n 1000000000 -w 12   # 1e9 готовых рук
  py stats/scorestat.py --mode complete -n 100000000 --quick
"""
import argparse
import json
import math
import multiprocessing as mp
import os
import sys
import time
from pathlib import Path

# --- ВАЖНО: до импорта numpy ---------------------------------------------
# Скрипт параллелится через multiprocessing. Если каждый воркер ещё и
# поднимает свои потоки OpenBLAS/OpenMP, получаем oversubscription:
# редкие 'OpenBLAS error: Memory allocation still failed after 10 retries'
# и зависания (deadlock внутри OpenBLAS). setdefault уважает значения,
# которые пользователь уже выставил в окружении.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "1")

import numpy as np

# Вывод может уходить в файл (PowerShell/cmd), а кодировка консоли на Windows —
# cp1251/cp866: символы вне неё (например, «∩») роняли отчёт UnicodeEncodeError.
# Ошибки кодирования заменяем: отчёт важнее отдельного символа.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except (AttributeError, ValueError):  # не текстовый поток / уже закрыт
        pass

try:
    from numba import njit
    HAVE_NUMBA = True
except ImportError:  # запасной вариант: чистый Python
    HAVE_NUMBA = False

    def njit(*args, **kwargs):
        if len(args) == 1 and callable(args[0]) and not kwargs:
            return args[0]
        return lambda f: f

# Индексы тайлов:
#   0-8 ман 1-9 | 9-17 пин 1-9 | 18-26 соу 1-9
#   27 восток, 28 юг, 29 запад, 30 север, 31 белый, 32 зелёный, 33 красный
LIM = 3  # максимум добираемых тайлов (2-шантен => 3 тайла)

# ---------------------------------------------------------------- константы

def _build_tables():
    th = np.zeros(34, np.int64)          # терминал или хонор
    for i in range(34):
        if i >= 27 or i % 9 in (0, 8):
            th[i] = 1
    green = np.zeros(34, np.int64)       # рюисо: 2,3,4,6,8 соу и зелёный дракон
    for r in (1, 2, 3, 5, 7):
        green[18 + r] = 1
    green[32] = 1
    dora_next = np.zeros(34, np.int64)   # индикатор -> дора
    for t in range(34):
        if t < 27:
            dora_next[t] = t // 9 * 9 + (t % 9 + 1) % 9
        elif t < 31:
            dora_next[t] = 27 + (t - 27 + 1) % 4
        else:
            dora_next[t] = 31 + (t - 31 + 1) % 3
    term13 = np.array([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33], np.int64)
    return th, green, dora_next, term13


TH, GREEN, DORA_NEXT, TERM13 = _build_tables()


def _build_ryanpeikou_table():
    # Рянпейко (определение исправлено 2026-10-22, порт 1:1 в src/yaku-v4.js):
    # ДВА НЕПЕРЕКРЫВАЮЩИХСЯ иппейко = 12 тайлов: 2*A + 2*B (A, B — любые цу,
    # могут совпадать; общий ранг требует 4 тайла) + пара (14-тайловая рука).
    # Таблица: для каждой неупорядоченной пары (A,B) — требуемые счёты (34,);
    # пары, где рангу нужно >4 тайлов, отброшены. 13-тайловый состав: пара не
    # требуется (c >= req). 14 тайлов: точное вложение — остаток 2 тайла обязан
    # быть парой, т.е. для некоторого k с req[k] <= 2: c[k] = req[k] + 2.
    # Старая формула (сумма min//2 >= 2) считала перекрывающиеся задвоенные
    # последовательности (11223344 -> «123» и «234») отдельными структурами и
    # завышала шанс ряпéйко в ~73 000 раз.
    shapes = []
    for b in (0, 9, 18):
        for p in range(7):
            shapes.append((b + p, b + p + 1, b + p + 2))
    rows = []
    for i in range(21):
        for j in range(i, 21):
            req = np.zeros(34, np.int8)
            for t in shapes[i]:
                req[t] += 2
            for t in shapes[j]:
                req[t] += 2
            if req.max() <= 4:
                rows.append(req)
    arr = np.stack(rows) if rows else np.zeros((0, 34), np.int8)
    return len(rows), arr


RY_N_PAIRS, RY_REQ = _build_ryanpeikou_table()


# индексы в массиве параметров par
# P_RIICHI — не флаг, а ХАН риичи (rules.riichiHan): в игре хан риичи берётся из
# конфига (src/yaku.js), в статистике — из этого слота.
P_DORA, P_RW, P_SW, P_RIICHI, P_TSUMO, P_AKA = 0, 1, 2, 3, 4, 5
# красные пятёрки: в стене по одному красному тайлу на масть; par-слоты
# помечают, какие пятёрки данной руки красные (в игре — ид '0m'/'0p'/'0s').
# Пять в руке красная с вероятностью n/4 (n = число пятёрок масти в руке).
P_AKA_M, P_AKA_P, P_AKA_S = 6, 7, 8
# Ура-дора: P_URA — вид тайла урадор (DORA_NEXT от ура-индикатора), -1 = урадор нет
# (перебор сброса тогда не пересчитывает хан с урадорами: экономия).
# ЕДИНАЯ конвенция «нет урадор = -1» и в analyze, и в eval_complete_hand; читать
# P_URA можно только под P_URA_ON == 1 либо через проверку par[P_URA] >= 0
# (см. guard в dfs/chiitoi_dfs). Вид тайла урадор не бывает отрицательным.
# P_URA_ON — 1, если урадоры учитываются в этом расчёте.
# Режим 1 (выбор сброса) считает БЕЗ урадор (P_URA_ON = 0), финальный хан — с ними;
# режим 2 (готовая рука) и финальный хан режима 1 — P_URA_ON = 1.
P_URA, P_URA_ON = 9, 10
PAR_SIZE = 11

# Константы SplitMix64 в знаковом int64-виде (для _splitmix64, режим 2).
SM64_ADD = -7046029254386353131    # 0x9E3779B97F4A7C15 mod 2^64
SM64_MUL1 = -4658895280553007687   # 0xBF58476D1CE4E5B9 mod 2^64
SM64_MUL2 = -7723592293110705685   # 0x94D049BB133111EB mod 2^64

# ---------------------------------------------------------------- общий конфиг
#
# Все стоимости живут в config/scoring.json (система v4 — systems.v4).
# Здесь конфиг раскладывается в массивы, которые читают ядра numba.

def _find_config():
    """config/scoring.json — ищем вверх от файла (устойчиво к переносу папок)."""
    here = Path(__file__).resolve().parent
    for base in (here, *here.parents):
        candidate = base / "config" / "scoring.json"
        if candidate.is_file():
            return candidate
    return here.parent / "config" / "scoring.json"


CONFIG_PATH = _find_config()

# коды флагов «край» для паттернов
EDGE_ANY, EDGE_NOT_EDGE, EDGE_EDGE_ONLY = 0, 1, 2
EDGE_CODES = {"any": EDGE_ANY, "notEdge": EDGE_NOT_EDGE, "edgeOnly": EDGE_EDGE_ONLY}

# Значения ниже заполняет apply_config() (и rebuild_dp_tables() для DP-таблиц).
CFG = {}
CFG_META = {}
CFG_RULES = {}
CFG_TIERS = []
BASE = np.zeros((1, 1), np.int64)
HAN_TO_TIER = np.zeros(64, np.int64)
STATE_NAMES = []
TIER_NAMES = []
ALL_STATE_NAMES = []
STRUCT_NAMES = []
STRUCT_NOTES = []
STRUCT_PTS = np.zeros(0, np.int64)
P_D = np.zeros((0, 5), np.int64)
P_MAXD = np.zeros(0, np.int64)
P_SAME = np.zeros(0, np.int64)
P_EDGE = np.zeros(0, np.int64)
YAKU_NAMES = []
YAKU_PTS = np.zeros(0, np.int64)
Y_IDX = {}
N_STRUCT = 0
N_YAKU = 0
S_PAIR = S_PON = S_KAN = 0
Y_SANSHOKU_DOKO = Y_CHINITSU = Y_SHOUSANGEN = Y_HONROUTOU = Y_SANANKOU = 0
Y_ITSU = Y_SANSHOKU_DOJUN = Y_HONITSU = Y_IIPEIKOU = Y_TANYAO = 0
Y_YAKUHAI_PON = Y_VALUABLE_PAIR = Y_VALUABLE_TILE = 0
Y_DAISUUSHI = Y_CHINROUTOU = Y_RYUUIISOU = Y_SHOUSUUSHI = 0
Y_TSUUIISOU = Y_DAISANGEN = Y_RYANPEIKOU = 0
STRUCT_P = np.zeros(0, np.float64)
YAKU_P = np.zeros(0, np.float64)
BASE_P = np.zeros((1, 1), np.float64)


def load_config(path=None):
    """Читает общий конфиг проекта."""
    with open(Path(path) if path else CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _pad_deltas(deltas, width=5):
    """Смещения паттерна + -1 как признак конца (как ждут pat_try/bp)."""
    return [int(x) for x in deltas] + [-1] * (width - len(deltas))


def _p_of(item):
    """Частота дизайна: либо p, либо 1/oneIn."""
    if "p" in item:
        return float(item["p"])
    return 1.0 / float(item["oneIn"])


def _build_han_to_tier(tiers, size=64):
    """хан -> индекс столбца тира (0 Normal ... 5 Якуман)."""
    arr = np.zeros(size, np.int64)
    for han in range(size):
        arr[han] = len(tiers) - 1
        for i, t in enumerate(tiers):
            hi = t.get("maxHan")
            if han >= int(t["minHan"]) and (hi is None or han <= int(hi)):
                arr[han] = i
                break
    return arr


def apply_config(cfg):
    """Разложить конфиг в массивы (кроме DP-таблиц — их строит rebuild_dp_tables)."""
    global CFG, CFG_META, CFG_RULES, CFG_TIERS
    global BASE, STATE_NAMES, TIER_NAMES, ALL_STATE_NAMES, HAN_TO_TIER
    global STRUCT_NAMES, STRUCT_NOTES, STRUCT_PTS, P_D, P_MAXD, P_SAME, P_EDGE
    global YAKU_NAMES, YAKU_PTS, Y_IDX, N_STRUCT, N_YAKU
    global S_PAIR, S_PON, S_KAN
    global Y_SANSHOKU_DOKO, Y_CHINITSU, Y_SHOUSANGEN, Y_HONROUTOU, Y_SANANKOU
    global Y_ITSU, Y_SANSHOKU_DOJUN, Y_HONITSU, Y_IIPEIKOU, Y_TANYAO
    global Y_YAKUHAI_PON, Y_VALUABLE_PAIR, Y_VALUABLE_TILE
    global Y_DAISUUSHI, Y_CHINROUTOU, Y_RYUUIISOU, Y_SHOUSUUSHI
    global Y_TSUUIISOU, Y_DAISANGEN, Y_RYANPEIKOU
    global STRUCT_P, YAKU_P, BASE_P

    CFG = cfg
    CFG_META = cfg.get("meta", {})
    v4 = cfg["systems"]["v4"]
    CFG_RULES = v4["rules"]
    CFG_TIERS = v4["tiers"]

    base = v4["base"]
    BASE = np.array(base["values"], np.int64)
    STATE_NAMES = list(base["rows"])
    TIER_NAMES = list(base["cols"])
    # Режим 1 работает только со строками 0..2 (2-янтэн..тенпай); последняя
    # строка таблицы — «Готовая рука» (режим 2), в режим 1 она не входит.
    ALL_STATE_NAMES = STATE_NAMES[:3] + [">=3 шантен"]
    HAN_TO_TIER = _build_han_to_tier(CFG_TIERS)

    structs = v4["structures"]["list"]
    STRUCT_NAMES = [s["label"] for s in structs]
    STRUCT_NOTES = [s.get("note") or s.get("notation", "") for s in structs]
    STRUCT_PTS = np.array([int(s["points"]) for s in structs], np.int64)
    P_D = np.array([_pad_deltas(s["deltas"]) for s in structs], np.int64)
    P_MAXD = np.array([max(int(x) for x in s["deltas"]) for s in structs], np.int64)
    P_SAME = np.array([1 if s["sameSuit"] else 0 for s in structs], np.int64)
    P_EDGE = np.array([EDGE_CODES.get(s.get("edge", "any"), EDGE_ANY) for s in structs], np.int64)
    N_STRUCT = len(structs)
    s_idx = {s["id"]: i for i, s in enumerate(structs)}
    S_PAIR, S_PON, S_KAN = s_idx["pair"], s_idx["pon"], s_idx["kan"]

    yaku = v4["yaku"]["list"]
    YAKU_NAMES = [y["label"] for y in yaku]
    YAKU_PTS = np.array([int(y["points"]) for y in yaku], np.int64)
    N_YAKU = len(yaku)
    Y_IDX = {y["id"]: i for i, y in enumerate(yaku)}
    Y_SANSHOKU_DOKO = Y_IDX["sanshoku_doko"]
    Y_CHINITSU = Y_IDX["chinitsu"]
    Y_SHOUSANGEN = Y_IDX["shousangen"]
    Y_HONROUTOU = Y_IDX["honroutou"]
    Y_SANANKOU = Y_IDX["sanankou"]
    Y_ITSU = Y_IDX["ittsu"]
    Y_SANSHOKU_DOJUN = Y_IDX["sanshoku_dojun"]
    Y_HONITSU = Y_IDX["honitsu"]
    Y_IIPEIKOU = Y_IDX["iipeikou"]
    Y_TANYAO = Y_IDX["tanyao"]
    Y_YAKUHAI_PON = Y_IDX["yakuhai_pon"]
    Y_VALUABLE_PAIR = Y_IDX["valuable_pair"]
    Y_VALUABLE_TILE = Y_IDX["valuable_tile"]
    Y_DAISUUSHI = Y_IDX["daisuushi"]
    Y_CHINROUTOU = Y_IDX["chinroutou"]
    Y_RYUUIISOU = Y_IDX["ryuuiisou"]
    Y_SHOUSUUSHI = Y_IDX["shousuushi"]
    Y_TSUUIISOU = Y_IDX["tsuuiisou"]
    Y_DAISANGEN = Y_IDX["daisangen"]
    Y_RYANPEIKOU = Y_IDX["ryanpeikou"]

    d = v4["designFrequencies"]
    STRUCT_P = np.array([_p_of(x) for x in d["structures"]], np.float64)
    YAKU_P = np.array([_p_of(x) for x in d["yaku"]], np.float64)
    BASE_P = np.array(d["base"]["values"], np.float64)

    # --- проверки конфига: опечатка не должна превращаться в тихую чушь в отчёте
    if BASE.shape[0] != len(STATE_NAMES):
        raise SystemExit("config: в base.values должно быть по строке на каждое состояние")
    if BASE.shape[1] != len(CFG_TIERS):
        raise SystemExit("config: число столбцов base.values должно совпадать с числом tiers")
    if STRUCT_P.size != N_STRUCT:
        raise SystemExit("config: designFrequencies.structures не совпадает по длине "
                         "со structures.list")
    if YAKU_P.size != N_YAKU:
        raise SystemExit("config: designFrequencies.yaku не совпадает по длине с yaku.list")
    if BASE_P.shape != BASE.shape:
        raise SystemExit("config: designFrequencies.base.values не совпадает по форме "
                         "с base.values")


apply_config(load_config())

# Фиксированные индексы тиров (для читаемости в отчёте).
TIER_NORMAL, TIER_MANGAN, TIER_HANEMAN = 0, 1, 2
TIER_BAIMAN, TIER_SANBAIMAN, TIER_YAKUMAN = 3, 4, 5

# Паттерны, яку, база и частоты дизайна — из конфига (см. apply_config выше).

# ---------------------------------------------------------------- подсчёт хана (ядро mode 1, +ака)

@njit
def eval_regular(trip, seq, pair, W, H, par):
    """Хан обычной руки (4 группы + пара). Возвращает: -1 нет яку, иначе хан (яку-ман = 13)."""
    rw = par[P_RW]
    sw = par[P_SW]
    ntrip = 0
    nseq = 0
    for i in range(34):
        ntrip += trip[i]
        nseq += seq[i]

    suit_tiles = np.zeros(3, np.int64)
    honors = 0
    has_th = False
    only_term = True
    all_green = True
    for i in range(34):
        if W[i] > 0:
            if i >= 27:
                honors += W[i]
                only_term = False
            else:
                suit_tiles[i // 9] += W[i]
                if i % 9 not in (0, 8):
                    only_term = False
            if TH[i] == 1:
                has_th = True
            if GREEN[i] == 0:
                all_green = False

    if ntrip == 4:
        return 13                                  # суанко (цумо, закрытая)
    if trip[31] == 1 and trip[32] == 1 and trip[33] == 1:
        return 13                                  # дайсанген
    winds_trip = trip[27] + trip[28] + trip[29] + trip[30]
    if winds_trip == 4:
        return 13                                  # дайсуси
    if winds_trip == 3 and 27 <= pair <= 30:
        return 13                                  # сёсуси
    if honors == 14:
        return 13                                  # цуисо
    if only_term:
        return 13                                  # чинрото
    if all_green:
        return 13                                  # рюисо
    for s in range(3):                             # тюренпото
        if suit_tiles[s] == 14:
            b = s * 9
            ok = W[b] >= 3 and W[b + 8] >= 3
            for r in range(1, 8):
                if W[b + r] < 1:
                    ok = False
            if ok:
                return 13

    han = 0
    han += par[P_RIICHI]                        # хан риичи из правил (rules.riichiHan)
    if par[P_TSUMO] == 1:
        han += 1

    # пинфу (ожидаемое правило: выигрышный тайл закрывает двустороннее ожидание)
    if ntrip == 0:
        pair_ok = True
        if pair >= 31:
            pair_ok = False
        elif pair >= 27 and (pair == rw or pair == sw):
            pair_ok = False
        if pair_ok:
            wait_ok = False
            for s in range(27):
                if seq[s] > 0:
                    r = s % 9
                    if W[s] > H[s] and r <= 5:
                        wait_ok = True
                    if W[s + 2] > H[s + 2] and r >= 1:
                        wait_ok = True
            if wait_ok:
                han += 1

    pk = 0
    for s in range(27):
        pk += seq[s] // 2
    if pk >= 2:
        han += 3
    elif pk == 1:
        han += 1

    han += trip[31] + trip[32] + trip[33]
    han += trip[rw]
    han += trip[sw]

    if not has_th:
        han += 1

    for r in range(7):
        if seq[r] > 0 and seq[9 + r] > 0 and seq[18 + r] > 0:
            han += 2
            break
    for b in (0, 9, 18):
        if seq[b] > 0 and seq[b + 3] > 0 and seq[b + 6] > 0:
            han += 2
            break

    ok = TH[pair] == 1
    if ok:
        for i in range(34):
            if trip[i] == 1 and TH[i] == 0:
                ok = False
            if seq[i] > 0 and not (i % 9 == 0 or i % 9 == 6):
                ok = False
    if ok:
        if nseq == 0:
            han += 2                     # хонрото
        elif honors == 0:
            han += 3                     # дзюнчан
        else:
            han += 2                     # чанта

    if nseq == 0:
        han += 2
    if ntrip >= 3:
        han += 2

    for r in range(9):
        if trip[r] == 1 and trip[9 + r] == 1 and trip[18 + r] == 1:
            han += 2
            break

    if trip[31] + trip[32] + trip[33] == 2 and pair >= 31:
        han += 2

    nsuits = 0
    for s in range(3):
        if suit_tiles[s] > 0:
            nsuits += 1
    if nsuits == 1:
        if honors > 0:
            han += 3
        else:
            han += 6

    # В игре (evaluateStandard) разложение без ХОТЯ БЫ ОДНОГО хан-яку
    # пропускается: дора/ака дают хан только если хан-яку есть. Значит,
    # «без яку + дора/ака» = рука без яку (han -1).
    han_yaku = han
    if han_yaku == 0:
        return -1

    # ака-дора: +1 хан за каждый КРАСНЫЙ 5, присутствующий в победной руке.
    # Красных в стене по одному на масть; par[P_AKA_*] — какие пятёрки руки
    # красные (та же семантика, что redFives в игре, см. src/evaluate.js).
    if par[P_AKA] == 1:
        if par[P_AKA_M] == 1 and W[4] > 0:
            han += 1
        if par[P_AKA_P] == 1 and W[13] > 0:
            han += 1
        if par[P_AKA_S] == 1 and W[22] > 0:
            han += 1

    han += W[par[P_DORA]]
    if par[P_URA_ON] == 1:
        han += W[par[P_URA]]
    return han


@njit
def eval_chiitoi(W, par):
    han = 2
    han += par[P_RIICHI]                        # хан риичи из правил (rules.riichiHan)
    if par[P_TSUMO] == 1:
        han += 1
    suit_tiles = np.zeros(3, np.int64)
    honors = 0
    has_simple = False
    has_th = False
    for i in range(34):
        if W[i] > 0:
            if i >= 27:
                honors += W[i]
            else:
                suit_tiles[i // 9] += W[i]
            if TH[i] == 1:
                has_th = True
            else:
                has_simple = True
    if honors == 14:
        pass  # цуисо-чиитоицу (7 пар хонор): в игре (evaluateChiitoitsu) это
        # НЕ якуман — чиитоицу 2 + хонрото 2 + дора/ака; считаем дальше.
    if not has_th:
        han += 1                         # тан'яо
    if not has_simple:
        han += 2                         # хонрото
    nsuits = 0
    for s in range(3):
        if suit_tiles[s] > 0:
            nsuits += 1
    if nsuits == 1:
        if honors > 0:
            han += 3
        else:
            han += 6
    if par[P_AKA] == 1:
        if par[P_AKA_M] == 1 and W[4] > 0:
            han += 1
        if par[P_AKA_P] == 1 and W[13] > 0:
            han += 1
        if par[P_AKA_S] == 1 and W[22] > 0:
            han += 1
    han += W[par[P_DORA]]
    if par[P_URA_ON] == 1:
        han += W[par[P_URA]]
    return han


# ---------------------------------------------------------------- готовые руки (mode 2)

@njit
def _splitmix64(st):
    """SplitMix64: (новое состояние, положительное int64-значение).
    Локальный генератор для дилерских рук: в разы быстрее np.random.randint
    и не трогает глобальный поток (режим 2 не связан с режимом 1).
    Константы — в знаковом виде (int64), переполнение заворачивается mod 2^64.

    ВАЖНО: реализация в знаковом int64 — сдвиги >> для отрицательных значений
    арифметические (знаковая расшифровка), поэтому поток НЕ идентичен
    каноническому беззнаковому SplitMix64 (различается ~87.5% выходов).
    Это НЕ дефект: поток эмпирически валидирован (2026-10-22, 5 прогонов
    по 2e10 рук + контрольные: частоты всех 34 видов в руке — точные в
    пределах 2 sigma; z mod 136, пары/4-ки соседних z, P(self-swap) по
    позициям — независимы и равномерны; кокуши/готовые/чиитоицу/стандарт/
    иппейко/рянпейко — все в пределах 1.6 sigma от точной комбинаторики).
    На беззнаковый uint64-вариант НЕ переводится: это сломало бы
    воспроизводимость по seed всех существующих прогонов.

    ВНИМАНИЕ (баг numba, проверено на этой версии): несколько ВЫЗОВОВ этой
    функции из разных мест тела одной нбит-функции дают сбитые результаты
    (со второго вызова z = 0). Поэтому в горячих циклах микс ИНЛАЙНится
    (simulate_complete_chunk, gen_complete_deals) — паттерн «один цикл,
    инлайн-микс»."""
    st = st + SM64_ADD
    z = st
    z = (z ^ (z >> 30)) * SM64_MUL1
    z = (z ^ (z >> 27)) * SM64_MUL2
    z = z ^ (z >> 31)
    return st, (z & 0x7FFFFFFFFFFFFFFF)


@njit
def _suit_melds(c, off):
    """Разлагается ли одна масть (c[off..off+8]) целиком на мендзены
    (секвенции + пон)? c временно меняется и восстанавливается.
    Первый ненулевой тайл i обязан войти либо в секвенцию, начинающуюся в i,
    либо в пон i (тайлов левее нет)."""
    i = off
    end = off + 9
    while i < end and c[i] == 0:
        i += 1
    if i == end:
        return True
    if i - off <= 6 and c[i + 1] >= 1 and c[i + 2] >= 1:
        c[i] -= 1
        c[i + 1] -= 1
        c[i + 2] -= 1
        ok = _suit_melds(c, off)
        c[i] += 1
        c[i + 1] += 1
        c[i + 2] += 1
        if ok:
            return True
    if c[i] >= 3:
        c[i] -= 3
        ok = _suit_melds(c, off)
        c[i] += 3
        if ok:
            return True
    return False


@njit
def complete_type(c):
    """Битовая маска готовой 14-тайловой руки: 1 — стандарт (4 мендзена + пара),
    2 — чиитоицу, 4 — кокуши; 0 — не готова. Логика — зеркало isWinningHand
    (src/shanten.js) с быстрым reject: у пары-кандидата масть — остаток 2,
    остальные масти — 0; хоноры дают только поны, поэтому каждый вид хоноров
    кратен 3 (пара хонора — ровно 2 этого вида, остальные хоноры — поны).
    Прошедшие reject проверяет точный DFS _suit_melds по мастям.
    Функция НЕ мутирует c."""
    ku = 0
    ktot = 0
    for i in range(13):
        t = c[TERM13[i]]
        if t >= 1:
            ku += 1
        ktot += t
    # Игра (isWinningHand): ВСЕ 14 тайлов — из 13 видов кокуши, ровно 13 видов
    # и одна пара. Присутствия всех 13 видов недостаточно: лишний вид (например
    # 7m вместо второго rd) руку не делает кокуши.
    if ku == 13 and ktot == 14:
        return 4
    pr = 0
    ok = True
    for i in range(34):
        t = c[i]
        if t == 2:
            pr += 1
        elif t != 0:
            ok = False
    mask = 2 if (ok and pr == 7) else 0
    t0 = 0
    for i in range(9):
        t0 += c[i]
    t1 = 0
    for i in range(9, 18):
        t1 += c[i]
    t2 = 0
    for i in range(18, 27):
        t2 += c[i]
    th = 0
    for i in range(27, 34):
        th += c[i]
    m0 = t0 % 3
    m1 = t1 % 3
    m2 = t2 % 3
    # Хоноры дают только поны: каждый вид хоноров должен быть кратен 3
    # (пара хонора — это «ровно 2», остальные хоноры — поны).
    hm0 = 0
    hm2 = 0
    for h in range(27, 34):
        r = c[h] % 3
        if r == 0:
            hm0 += 1
        elif r == 2:
            hm2 += 1
    for p in range(34):
        cp = c[p]
        if cp < 2:
            continue
        if p < 27:
            if hm0 != 7:
                continue
            s = p // 9
            if s == 0:
                okk = (m0 == 2 and m1 == 0 and m2 == 0)
            elif s == 1:
                okk = (m1 == 2 and m0 == 0 and m2 == 0)
            else:
                okk = (m2 == 2 and m0 == 0 and m1 == 0)
            if not okk:
                continue
        else:
            # пара хонора: ровно 2 этого вида, все остальные хоноры — поны
            if cp != 2 or hm0 != 6 or hm2 != 1 or m0 != 0 or m1 != 0 or m2 != 0:
                continue
        c[p] -= 2
        if _suit_melds(c, 0) and _suit_melds(c, 9) and _suit_melds(c, 18):
            c[p] += 2
            return mask | 1
        c[p] += 2
    return mask


@njit
def _std_dfs(c, W, i, par, trip, seq, pairp, best):
    """Перебор ВСЕХ стандартных разложений 12 тайлов (пара уже убрана из c —
    рабочей копии): на листе best[0] = max хана разложения. W — полная
    14-тайловая рука (с парой): eval_regular считает по ней (как игра —
    по полным counts); W == H -> нет выигрышного тайла -> нет пинфу."""
    while i < 34 and c[i] == 0:
        i += 1
    if i == 34:
        h = eval_regular(trip, seq, pairp[0], W, W, par)
        if h > best[0]:
            best[0] = h
        return
    if i < 27 and (i % 9) <= 6 and c[i + 1] >= 1 and c[i + 2] >= 1:
        c[i] -= 1
        c[i + 1] -= 1
        c[i + 2] -= 1
        seq[i] += 1
        _std_dfs(c, W, i, par, trip, seq, pairp, best)
        seq[i] -= 1
        c[i] += 1
        c[i + 1] += 1
        c[i + 2] += 1
    if c[i] >= 3:
        c[i] -= 3
        trip[i] += 1
        _std_dfs(c, W, i, par, trip, seq, pairp, best)
        trip[i] -= 1
        c[i] += 3


@njit
def eval_complete_han(c, par, trip, seq, pairp, best):
    """Хан готовой 14-тайловой руки — зеркало evaluateComplete (src/evaluate.js):
    кокуши -> 13; чиитоицу и стандарт (двойная рука — и то и другое) — max хана
    по всем разложениям. H := c: у готовой руки нет выигрышного тайла -> нет
    типа ожидания -> нет пинфу (игра winningTile не передаёт)."""
    ku = 0
    ktot = 0
    for i in range(13):
        t = c[TERM13[i]]
        if t >= 1:
            ku += 1
        ktot += t
    # кокуши = все 14 тайлов из 13 видов (см. isWinningHand), иначе — нет
    if ku == 13 and ktot == 14:
        return 13
    best[0] = -1
    pr = 0
    ok = True
    for i in range(34):
        t = c[i]
        if t == 2:
            pr += 1
        elif t != 0:
            ok = False
    if ok and pr == 7:
        h = eval_chiitoi(c, par)
        if h > best[0]:
            best[0] = h
    W14 = c.copy()
    for p in range(34):
        if c[p] < 2:
            continue
        c[p] -= 2
        for i in range(34):
            trip[i] = 0
        for i in range(27):
            seq[i] = 0
        pairp[0] = p
        _std_dfs(c, W14, 0, par, trip, seq, pairp, best)
        c[p] += 2
    return best[0]


@njit
def eval_complete_hand(c, ind, ura_ind, rw, sw, riichi, tsumo, aka, par, trip, seq, pairp,
                       best, pD, pG, pCh, str_cnt, yak_cnt,
                       yak_pts, hidx):
    """Полный счёт готовой 14-тайловой руки — зеркало evaluateCompleteHand
    (src/scoring.js): (хан, тир, база строки «Готовая рука» — последняя строка
    таблицы базы, структуры 14 тайлов, яку 14 тайлов). Риичи — тот же дефолт,
    что в режиме 1 (игра готовой руке передаёт riichi:true, как в potential.js);
    tsumo:true при rules.tsumo=false яку не даёт — передавать 0.
    Урадоры в готовой руке считаются всегда (готовая рука уже «после сброса»):
    par[P_URA_ON] = 1 при ura_ind >= 0."""
    par[P_DORA] = DORA_NEXT[ind]
    # Та же конвенция, что в analyze: нет урадор -> -1 (P_URA_ON = 0, значение
    # не читается; -1 вместо 0 — чтобы «нет урадор» нигде не выглядело как
    # валидный вид тайла 0).
    par[P_URA] = DORA_NEXT[ura_ind] if ura_ind >= 0 else -1
    par[P_URA_ON] = 1 if ura_ind >= 0 else 0
    par[P_RW] = rw
    par[P_SW] = sw
    par[P_RIICHI] = riichi
    par[P_TSUMO] = tsumo
    par[P_AKA] = aka
    han = eval_complete_han(c, par, trip, seq, pairp, best)
    tier = tier_of_han(han)
    base = BASE[BASE.shape[0] - 1, tier]
    for k in range(N_STRUCT):
        str_cnt[k] = 0
    str_pts = partition_v4(c, hidx, pD, pG, pCh, str_cnt)
    detect_yaku_v4(c, rw, sw, yak_cnt, yak_pts)
    yak_tot = 0
    for k in range(N_YAKU):
        yak_tot += yak_pts[k]
    return han, tier, base, str_pts, yak_tot


# ---------------------------------------------------------------- перебор (mode 1)

@njit
def dfs(i, ml, pl, cost, waste, H, maxc, iso, W, trip, seq, pairp, best, best_fin, par, lim):
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
                                    # par[P_URA_ON] = 0 -> han без урадор: это
                                    # оценка «решения» (какой сброс/руку целиться).
                                    par[P_URA_ON] = 0
                                    han = eval_regular(trip, seq, pairp[0], W, H, par)
                                    if han > best[lc]:
                                        best[lc] = han
                                    # финальный хан: та же рука уже с открытыми
                                    # урадорами (якуман урадоры не получает —
                                    # это делает сам eval_regular). Если урадор
                                    # в победной руке нет (или урадоры выключены:
                                    # тогда P_URA = -1), считать нечего.
                                    han_fin = han
                                    if par[P_URA] >= 0 and W[par[P_URA]] > 0:
                                        par[P_URA_ON] = 1
                                        han_fin = eval_regular(trip, seq, pairp[0], W, H, par)
                                    if han_fin > best_fin[lc]:
                                        best_fin[lc] = han_fin
                            elif i < 33:
                                dfs(i + 1, nml, npl, nc, nw, H, maxc, iso, W,
                                    trip, seq, pairp, best, best_fin, par, lim)
                            trip[i] = 0
                            seq[i] = 0
                    if added > 0:
                        W[i] -= added
                        W[i + 1] -= added
                        W[i + 2] -= added
                W[i] -= 2 * p
        W[i] -= 3 * t


@njit
def chiitoi_dfs(i, chosen, cost, waste, H, sufH, W, best, best_fin, par, lim):
    if chosen == 7:
        if waste + sufH[i] <= lim:
            par[P_URA_ON] = 0
            han = eval_chiitoi(W, par)          # «решение»: без урадор
            if han > best[cost]:
                best[cost] = han
            han_fin = han
            if par[P_URA] >= 0 and W[par[P_URA]] > 0:
                par[P_URA_ON] = 1
                han_fin = eval_chiitoi(W, par)  # финал: с урадорами
            if han_fin > best_fin[cost]:
                best_fin[cost] = han_fin
        return
    if i >= 34 or 34 - i < 7 - chosen:
        return
    cov = H[i] if H[i] < 2 else 2
    nc = cost + 2 - cov
    nw = waste + H[i] - cov
    if nc <= lim and nw <= lim:
        W[i] = 2
        chiitoi_dfs(i + 1, chosen + 1, nc, nw, H, sufH, W, best, best_fin, par, lim)
        W[i] = 0
    nw = waste + H[i]
    if nw <= lim:
        chiitoi_dfs(i + 1, chosen, cost, nw, H, sufH, W, best, best_fin, par, lim)


@njit
def analyze(H, ind, ura_ind, rw, sw, riichi, tsumo, aka, maxc, sufH, iso, W, trip, seq,
            pairp, best, best_fin, par, lim):
    """Возвращает (шантен 0..2, хан без урадор, хан с урадорами) или (-1, 0, 0),
    если шантен >= lim-1 (см. конец функции). Работает для 13-тайловой руки:
    cost = число доборов до победной руки = 14 - |W n H|.
    lim = минимальный возможный cost (шантен+1) — перебираем только его.

    Два хана считаются за один перебор:
      * best[] — лучшая рука БЕЗ урадор: по ней игра/статистика выбирают сброс
        (в момент сброса урадоры ещё не открыты);
      * best_fin[] — лучшая рука С урадорами: после открытия урадор лучшая
        достройка ищется заново, и её хан задаёт финальный тир и базу.
    par должен быть размером PAR_SIZE: P_DORA, P_URA, P_RW, P_SW, P_RIICHI, P_TSUMO,
    P_AKA заполняет analyze (P_URA_ON здесь всегда 0 — см. выше), а
    par[P_AKA_M/P/S] (красные пятёрки руки) задаёт вызывающий."""
    par[P_DORA] = DORA_NEXT[ind]
    par[P_URA] = DORA_NEXT[ura_ind] if ura_ind >= 0 else -1  # -1: урадор нет
    # Перебор считает хан БЕЗ урадор (это оценка «решения»): урадоры dfs
    # добавляет только в best_fin. Режим 2 включает P_URA_ON в eval_complete_hand.
    par[P_URA_ON] = 0
    par[P_RW] = rw
    par[P_SW] = sw
    par[P_RIICHI] = riichi
    par[P_TSUMO] = tsumo
    par[P_AKA] = aka
    for k in range(34):
        maxc[k] = 4
    maxc[ind] -= 1                    # одна копия индикатора доры не в стене
    if ura_ind >= 0:
        maxc[ura_ind] -= 1            # и одна копия индикатора урадор
    for k in range(37):
        sufH[k] = 0
    for k in range(33, -1, -1):
        sufH[k] = sufH[k + 1] + H[k]
    for k in range(LIM + 1):
        best[k] = -2                  # -2: рук с таким cost нет; -1: рука есть, но без яку
        best_fin[k] = -2

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
        dfs(0, 4, 1, 0, 0, H, maxc, iso, W, trip, seq, pairp, best, best_fin, par, lim)
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
        chiitoi_dfs(0, 0, 0, 0, H, sufH, W, best, best_fin, par, lim)

    kinds = 0
    has_pair = 0
    for k in range(13):
        c = H[TERM13[k]]
        if c > 0:
            kinds += 1
        if c >= 2:
            has_pair = 1
    kc = 14 - kinds - has_pair
    if kc <= lim and 13 > best[kc]:
        best[kc] = 13                     # кокуши — якуман, урадоры не добавляются
        best_fin[kc] = 13

    for c in range(lim + 1):
        if best[c] > -2:
            s = c - 1
            if s < 0:
                s = 0
            return s, best[c], best_fin[c]
    return -1, 0, 0


@njit
def tier_of_han(han):
    """Индекс столбца тира по хану (пороги берутся из конфига).
    han < 0 — победная рука без яку, очки идут как Normal."""
    if han < 0:
        return 0
    if han >= 64:
        return HAN_TO_TIER[63]
    return HAN_TO_TIER[han]

# ---------------------------------------------------------------- bestPartition v4

@njit
def pat_try(p, c, i):
    md = P_MAXD[p]
    if P_SAME[p] == 1:
        if i >= 27:
            return False
        if (i + md) // 9 != i // 9:
            return False
    if i < 27:
        pos = i % 9
        et = P_EDGE[p]
        if et == 1 and (pos == 0 or pos + md == 8):
            return False
        if et == 2 and not (pos == 0 or pos + md == 8):
            return False
    nd0 = 0
    nd1 = 0
    nd2 = 0
    nd3 = 0
    nd4 = 0
    t0 = P_D[p, 0]
    t1 = P_D[p, 1]
    t2 = P_D[p, 2]
    t3 = P_D[p, 3]
    t4 = P_D[p, 4]
    for d in range(5):
        dd = -1
        if d == 0:
            dd = t0
        elif d == 1:
            dd = t1
        elif d == 2:
            dd = t2
        elif d == 3:
            dd = t3
        else:
            dd = t4
        if dd < 0:
            break
        if dd == 0:
            nd0 += 1
        elif dd == 1:
            nd1 += 1
        elif dd == 2:
            nd2 += 1
        elif dd == 3:
            nd3 += 1
        else:
            nd4 += 1
    if c[i] < nd0:
        return False
    if nd1 and c[i + 1] < nd1:
        return False
    if nd2 and c[i + 2] < nd2:
        return False
    if nd3 and c[i + 3] < nd3:
        return False
    if nd4 and c[i + 4] < nd4:
        return False
    return True


@njit
def pat_apply(p, c, i, sign):
    """sign = -1 съесть, +1 вернуть."""
    for d in range(5):
        dd = P_D[p, d]
        if dd < 0:
            break
        c[i + dd] += sign


@njit
def bp(c, i0, k0, k1, memo):
    """Оптимальное разбиение: максимум суммы очков паттернов (рекурсия с мемо).
    i0 — нижняя граница для первого ненулевого тайла; k0/k1 — ключ (3 бита на тайл)."""
    first = i0
    while first < 34 and c[first] == 0:
        first += 1
    key = (k0, k1)
    if key in memo:
        return memo[key]
    if first == 34:
        memo[key] = 0
        return 0
    i = first
    # вариант «одиночка»
    if i < 17:
        k0s = k0 - (np.int64(1) << (3 * i))
        k1s = k1
    else:
        k0s = k0
        k1s = k1 - (np.int64(1) << (3 * (i - 17)))
    c[i] -= 1
    best = bp(c, i, k0s, k1s, memo)
    c[i] += 1
    # варианты паттернов с базой i
    for p in range(N_STRUCT):
        if not pat_try(p, c, i):
            continue
        k0p = k0
        k1p = k1
        for d in range(5):
            dd = P_D[p, d]
            if dd < 0:
                break
            t = i + dd
            if t < 17:
                k0p -= np.int64(1) << (3 * t)
            else:
                k1p -= np.int64(1) << (3 * (t - 17))
        pat_apply(p, c, i, -1)
        v = STRUCT_PTS[p] + bp(c, i, k0p, k1p, memo)
        if v > best:
            best = v
        pat_apply(p, c, i, 1)
    memo[key] = best
    return best


@njit
def bp_reconstruct(c, i0, k0, k1, memo, out_cnt):
    """Восстановить chosen-разбиение (те же выборы, что давали bp(c))."""
    i = i0
    kk0 = k0
    kk1 = k1
    while True:
        first = i
        while first < 34 and c[first] == 0:
            first += 1
        if first == 34:
            break
        i = first
        cur = memo[(kk0, kk1)]
        if i < 17:
            k0s = kk0 - (np.int64(1) << (3 * i))
            k1s = kk1
        else:
            k0s = kk0
            k1s = kk1 - (np.int64(1) << (3 * (i - 17)))
        c[i] -= 1
        key = (k0s, k1s)
        if key in memo and memo[key] == cur:
            kk0 = k0s
            kk1 = k1s
            continue
        c[i] += 1
        taken = -1
        for p in range(N_STRUCT):
            if not pat_try(p, c, i):
                continue
            k0p = kk0
            k1p = kk1
            for d in range(5):
                dd = P_D[p, d]
                if dd < 0:
                    break
                t = i + dd
                if t < 17:
                    k0p -= np.int64(1) << (3 * t)
                else:
                    k1p -= np.int64(1) << (3 * (t - 17))
            pat_apply(p, c, i, -1)
            keyp = (k0p, k1p)
            if keyp in memo and STRUCT_PTS[p] + memo[keyp] == cur:
                out_cnt[p] += 1
                taken = p
                kk0 = k0p
                kk1 = k1p
                break
            pat_apply(p, c, i, 1)
        if taken < 0:  # на всякий случай: съесть одиночку
            c[i] -= 1
            kk0 = k0s
            kk1 = k1s

# ---------------------------------------------------------------- яку v4

@njit
def detect_yaku_v4(c, rw, sw, cnt, pts):
    """Яку v4 на текущем составе (13 тайлов после сброса или все 14 готовой руки).
    cnt/pts: int64[N_YAKU] (индексы берутся из конфига).

    ГОТОВНОСТЬ РУКИ НЕ ПРОВЕРЯЕТСЯ — засчитывается само наличие структуры или
    свойства в составе (порт 1:1 в src/yaku-v4.js). Хонрото — универсальный, как
    в игре (n_th == total)."""
    for k in range(N_YAKU):
        cnt[k] = 0
        pts[k] = 0
    n_th = 0
    honors = 0
    s0 = 0
    s1 = 0
    s2 = 0
    npon = 0
    total = 0
    n_green = 0
    n_term = 0
    w3 = 0
    w2 = 0
    for i in range(34):
        x = c[i]
        if x == 0:
            continue
        total += x
        if TH[i] == 1:
            n_th += x
        if GREEN[i] == 1:
            n_green += x
        if i >= 27:
            honors += x
            if i <= 30:
                if x >= 3:
                    w3 += 1
                if x >= 2:
                    w2 += 1
        else:
            r = i % 9
            if r == 0 or r == 8:
                n_term += x
            if i < 9:
                s0 += x
            elif i < 18:
                s1 += x
            else:
                s2 += x
        if x >= 3:
            npon += 1
    # таняо / хонрото
    if n_th == 0:
        cnt[Y_TANYAO] = 1
        pts[Y_TANYAO] = YAKU_PTS[Y_TANYAO]
    if n_th == total:
        cnt[Y_HONROUTOU] = 1
        pts[Y_HONROUTOU] = YAKU_PTS[Y_HONROUTOU]
    # только хоноры / только терминалы / только зелёные (готовность не важна)
    if total > 0 and honors == total:
        cnt[Y_TSUUIISOU] = 1
        pts[Y_TSUUIISOU] = YAKU_PTS[Y_TSUUIISOU]
    if total > 0 and n_term == total:
        cnt[Y_CHINROUTOU] = 1
        pts[Y_CHINROUTOU] = YAKU_PTS[Y_CHINROUTOU]
    if total > 0 and n_green == total:
        cnt[Y_RYUUIISOU] = 1
        pts[Y_RYUUIISOU] = YAKU_PTS[Y_RYUUIISOU]
    # чиницу / хоницу
    ns = 0
    if s0 > 0:
        ns += 1
    if s1 > 0:
        ns += 1
    if s2 > 0:
        ns += 1
    if ns == 1 and honors == 0:
        cnt[Y_CHINITSU] = 1
        pts[Y_CHINITSU] = YAKU_PTS[Y_CHINITSU]
    elif ns == 1 and honors > 0:
        cnt[Y_HONITSU] = 1
        pts[Y_HONITSU] = YAKU_PTS[Y_HONITSU]
    # итцу
    for b in (0, 9, 18):
        it = 1
        for p in range(9):
            if c[b + p] == 0:
                it = 0
        if it:
            cnt[Y_ITSU] = 1
            pts[Y_ITSU] = YAKU_PTS[Y_ITSU]
            break
    # иппейко — точная формула игры (yaku-v4.js): по каждой масти и позиции
    # m = min(c[p], c[p+1], c[p+2]); если m >= 2, пара иппейко даёт m // 2
    # «инстанса» (одинаковые последовательности, перекрывающие тайлы,
    # считаются отдельно — важна наличие структуры, а не готовность руки).
    # рянпейко (определение исправлено 2026-10-22): два НЕПЕРЕКРЫВАЮЩИХСЯ
    # иппейко (12 тайлов 2*A + 2*B, см. RY_REQ) + пара при 14 тайлах;
    # в 13-тайловом составе пара не требуется.
    ip = 0
    for b in (0, 9, 18):
        for p in range(7):
            m = c[b + p]
            if c[b + p + 1] < m:
                m = c[b + p + 1]
            if c[b + p + 2] < m:
                m = c[b + p + 2]
            if m >= 2:
                ip += m >> 1
    ry = 0
    for pi in range(RY_N_PAIRS):
        r = 1
        for t in range(34):
            if c[t] < RY_REQ[pi, t]:
                r = 0
                break
        if not r:
            continue
        if total < 14:
            ry = 1  # 13 (или меньше) тайлов: 12 тайлов структуры + свободные
            break
        for t in range(34):
            if RY_REQ[pi, t] <= 2 and c[t] >= RY_REQ[pi, t] + 2:
                ry = 1  # точное вложение: 12 + пара = 14
                break
        if ry:
            break
    # рянпейко уже включает иппейко — слабый яку не засчитывается (2026-10-23)
    if ry:
        cnt[Y_RYANPEIKOU] = 1
        pts[Y_RYANPEIKOU] = YAKU_PTS[Y_RYANPEIKOU]
    elif ip >= 1:
        cnt[Y_IIPEIKOU] = 1
        pts[Y_IIPEIKOU] = YAKU_PTS[Y_IIPEIKOU]
    # сансёку додзюн
    for p in range(7):
        if (c[p] > 0 and c[p + 1] > 0 and c[p + 2] > 0
                and c[9 + p] > 0 and c[9 + p + 1] > 0 and c[9 + p + 2] > 0
                and c[18 + p] > 0 and c[18 + p + 1] > 0 and c[18 + p + 2] > 0):
            cnt[Y_SANSHOKU_DOJUN] = 1
            pts[Y_SANSHOKU_DOJUN] = YAKU_PTS[Y_SANSHOKU_DOJUN]
            break
    # сансёку доккоу — тройки одного ранга в трёх мастях (НЕ драконы)
    doko = 0
    for p in range(9):
        if c[p] >= 3 and c[9 + p] >= 3 and c[18 + p] >= 3:
            doko = 1
            break
    if doko:
        cnt[Y_SANSHOKU_DOKO] = 1
        pts[Y_SANSHOKU_DOKO] = YAKU_PTS[Y_SANSHOKU_DOKO]
    # драконы: три по 3+ => дайсанген (большие драконы); два по 3+ и третий парой
    # => сёсанген
    daisangen = c[31] >= 3 and c[32] >= 3 and c[33] >= 3
    if daisangen:
        cnt[Y_DAISANGEN] = 1
        pts[Y_DAISANGEN] = YAKU_PTS[Y_DAISANGEN]
    elif ((c[31] >= 3 and c[32] >= 3 and c[33] >= 2)
          or (c[31] >= 3 and c[33] >= 3 and c[32] >= 2)
          or (c[32] >= 3 and c[33] >= 3 and c[31] >= 2)):
        cnt[Y_SHOUSANGEN] = 1
        pts[Y_SHOUSANGEN] = YAKU_PTS[Y_SHOUSANGEN]
    # ветра: четыре по 3+ => дайсууши (большие ветра); три по 3+ и четвёртый парой
    # => сёсууши (малые ветра)
    daisuushi = w3 == 4
    shousuushi = (not daisuushi) and w3 == 3 and w2 == 4
    if daisuushi:
        cnt[Y_DAISUUSHI] = 1
        pts[Y_DAISUUSHI] = YAKU_PTS[Y_DAISUUSHI]
    elif shousuushi:
        cnt[Y_SHOUSUUSHI] = 1
        pts[Y_SHOUSUUSHI] = YAKU_PTS[Y_SHOUSUUSHI]
    # сананко — три тройки, но НЕ когда они «внутри» более сильного яку:
    # тройки дайсангена/дайсууши/сёсууши/сансёку-доккоу уже оплачены им (2026-10-23)
    if npon >= 3 and not daisangen and not daisuushi and not shousuushi and not doko:
        cnt[Y_SANANKOU] = 1
        pts[Y_SANANKOU] = YAKU_PTS[Y_SANANKOU]
    # ценные: драконы + ветер раунда + ветер игрока (rw/sw могут совпадать) —
    # по видам, каждый вид только на своей самой высокой ступеньке (2026-10-23):
    # 1 = «ценный тайл», 2 = «пара ценных», 3-4 = «якухай (пон ценного)»;
    # разные виды суммируются, ступеньки внутри вида не кумулируются.
    # rw/sw могут совпадать — дедупликация видов.
    kk = np.zeros(5, np.int64)
    nk = 0
    for k in (31, 32, 33, rw, sw):
        d = 0
        for j in range(nk):
            if kk[j] == k:
                d = 1
        if not d:
            kk[nk] = k
            nk += 1
    vpon = 0
    vpair = 0
    vtile = 0
    for j in range(nk):
        cc = c[kk[j]]
        if cc >= 3:
            vpon += 1
        elif cc == 2:
            vpair += 1
        elif cc == 1:
            vtile += 1
    if vpon:
        cnt[Y_YAKUHAI_PON] = vpon
        pts[Y_YAKUHAI_PON] = YAKU_PTS[Y_YAKUHAI_PON] * vpon
    if vpair:
        cnt[Y_VALUABLE_PAIR] = vpair
        pts[Y_VALUABLE_PAIR] = YAKU_PTS[Y_VALUABLE_PAIR] * vpair
    if vtile:
        cnt[Y_VALUABLE_TILE] = vtile
        pts[Y_VALUABLE_TILE] = YAKU_PTS[Y_VALUABLE_TILE] * vtile

# ---------------------------------------------------------------- шантен (концепт игры, src/shanten.js)

@njit
def shanten_fast(c):
    """Шантен 13-тайловой руки = min(стандарт, чиитоицу, кокуши) — как в игре."""
    c2 = c.copy()
    s_std = _shanten_std_rec(c2, 0, 0, 0, 0, 8)
    # чиитоицу
    pr = 0
    un = 0
    for i in range(34):
        if c[i] >= 2:
            pr += 1
        if c[i] >= 1:
            un += 1
    s_chi = 6 - pr + (7 - un if un < 7 else 0)
    # кокуши
    ku = 0
    hp = 0
    for i in range(13):
        if c[TERM13[i]] >= 1:
            ku += 1
        if c[TERM13[i]] >= 2:
            hp = 1
    s_ko = 13 - ku - hp
    s = s_std
    if s_chi < s:
        s = s_chi
    if s_ko < s:
        s = s_ko
    return s


@njit
def _shanten_std_rec(c, idx, melds, partials, pairs, best):
    while idx < 34 and c[idx] == 0:
        idx += 1
    if idx >= 34:
        head = 1 if pairs > 0 else 0
        extra = pairs - 1
        if extra < 0:
            extra = 0
        usable = partials + extra
        room = 4 - melds
        if usable > room:
            usable = room
        sh = 8 - 2 * melds - usable - head
        if sh < best:
            best = sh
        return best
    if c[idx] >= 3:
        c[idx] -= 3
        best = _shanten_std_rec(c, idx, melds + 1, partials, pairs, best)
        c[idx] += 3
    if idx < 27 and idx % 9 <= 6 and c[idx + 1] > 0 and c[idx + 2] > 0:
        c[idx] -= 1
        c[idx + 1] -= 1
        c[idx + 2] -= 1
        best = _shanten_std_rec(c, idx, melds + 1, partials, pairs, best)
        c[idx] += 1
        c[idx + 1] += 1
        c[idx + 2] += 1
    if c[idx] >= 2:
        c[idx] -= 2
        best = _shanten_std_rec(c, idx, melds, partials, pairs + 1, best)
        c[idx] += 2
    if idx < 27 and idx % 9 <= 7 and c[idx + 1] > 0:
        c[idx] -= 1
        c[idx + 1] -= 1
        best = _shanten_std_rec(c, idx, melds, partials + 1, pairs, best)
        c[idx] += 1
        c[idx + 1] += 1
    if idx < 27 and idx % 9 <= 6 and c[idx + 2] > 0:
        c[idx] -= 1
        c[idx + 2] -= 1
        best = _shanten_std_rec(c, idx, melds, partials + 1, pairs, best)
        c[idx] += 1
        c[idx + 2] += 1
    c[idx] -= 1
    best = _shanten_std_rec(c, idx, melds, partials, pairs, best)
    c[idx] += 1
    return best


# ---------------------------------------------------------------- структура: DP по мастям
#
# Точное зеркало игры (src/partition.js, bestPartition): рекурсия по состоянию
# (p, a, b, cc, d) масти с мемоизацией, где p — позиция (0..8), a — свободные
# тайлы в p, b, cc, d — резервы на p+1..p+3 (тайлы, уже съеденные паттернами,
# стартовавшими раньше). Опции в каждом состоянии перебираются В ИГРОВОМ
# ПОРЯДКЕ (таблицы OP_*): сначала «одиночка», затем структуры по порядку
# конфига (суйт-паттерны и локальные пара/пон/кан вперемешку). При равных
# очках берётся первая (строгий >) — как в игре; это важно: у пары и канчана
# равные 15 очков, и игра отдаёт предпочтение по порядку конфига.

# Заполняется rebuild_dp_tables() из конфига (до первого вызова ядер numba).
N_SUIT_STATES = 5 ** 5            # состояние (a, b, cc, d, e) — см. _suit_rec
# OP_KIND[p, j]: 0 = одиночка, 1 = суйт-паттерн, 2 = локальная (пара/пон/кан);
# OP_N0..OP_N4 — сколько тайлов съедается в p..p+4 (у локальной — размер в N0);
# OP_PTS — очки; OP_SID — индекс структуры (-1 у одиночки).
OP_KIND = np.zeros((9, 1), np.int32)
OP_N0 = np.zeros((9, 1), np.int32)
OP_N1 = np.zeros((9, 1), np.int32)
OP_N2 = np.zeros((9, 1), np.int32)
OP_N3 = np.zeros((9, 1), np.int32)
OP_N4 = np.zeros((9, 1), np.int32)
OP_PTS = np.zeros((9, 1), np.int64)
OP_SID = np.zeros((9, 1), np.int32)
OPT_CNT = np.zeros(9, np.int32)
# Хоноры — тот же «первый лучший»: HVAL[v] — очки v тайлов, HCH[v] — выбранный
# вариант (0 = одиночка, li+1 = li-я локальная структура в порядке конфига),
# HCSID/HSIZE — её индекс структуры и размер.
HVAL = np.zeros(5, np.int64)
HCH = np.zeros(5, np.int8)
HCSID = np.zeros(1, np.int64)
HSIZE = np.zeros(1, np.int8)
NEG_SCORE = -10 ** 15             # «недостижимо» в _suit_rec


def rebuild_dp_tables():
    """Собрать таблицы опций и разложения хоноров из уже загруженного конфига.
    Вызывается при импорте и повторно, если задан --config — ОБЯЗАТЕЛЬНО до
    первого вызова ядер numba (numba фиксирует значения глобальных массивов
    при компиляции)."""
    global OP_KIND, OP_N0, OP_N1, OP_N2, OP_N3, OP_N4, OP_PTS, OP_SID, OPT_CNT
    global HVAL, HCH, HCSID, HSIZE
    cap = N_STRUCT + 2
    OP_KIND = np.zeros((9, cap), np.int32)
    OP_N0 = np.zeros((9, cap), np.int32)
    OP_N1 = np.zeros((9, cap), np.int32)
    OP_N2 = np.zeros((9, cap), np.int32)
    OP_N3 = np.zeros((9, cap), np.int32)
    OP_N4 = np.zeros((9, cap), np.int32)
    OP_PTS = np.zeros((9, cap), np.int64)
    OP_SID = np.zeros((9, cap), np.int32)
    OPT_CNT = np.zeros(9, np.int32)
    local_order = []
    for p in range(9):
        j = 0
        OP_KIND[p, j] = 0                      # «одиночка» — всегда первая
        OP_N0[p, j] = 1
        OP_SID[p, j] = -1
        j += 1
        for i in range(N_STRUCT):
            deltas = [int(d) for d in P_D[i] if d >= 0]
            pts = int(STRUCT_PTS[i])
            if P_SAME[i] == 1:
                span = max(deltas)
                if p + span > 8:
                    continue
                edge = int(P_EDGE[i])
                if edge == EDGE_NOT_EDGE and (p == 0 or p + span == 8):
                    continue
                if edge == EDGE_EDGE_ONLY and not (p == 0 or p + span == 8):
                    continue
                OP_KIND[p, j] = 1
                for d in deltas:
                    if d == 0:
                        OP_N0[p, j] += 1
                    elif d == 1:
                        OP_N1[p, j] += 1
                    elif d == 2:
                        OP_N2[p, j] += 1
                    elif d == 3:
                        OP_N3[p, j] += 1
                    else:
                        OP_N4[p, j] += 1
            else:
                # все смещения нулевые => локальная комбинация (пара/пон/кан)
                local_order.append((len(deltas), pts, i))
                OP_KIND[p, j] = 2
                OP_N0[p, j] = len(deltas)
            OP_PTS[p, j] = pts
            OP_SID[p, j] = i
            j += 1
        OPT_CNT[p] = j
    # Хоноры: одиночка, затем локальные структуры по порядку конфига, при
    # равных очках — первый (как в игре).
    HVAL = np.zeros(5, np.int64)
    HCH = np.zeros(5, np.int8)
    HCSID = np.zeros(len(local_order) + 1, np.int64)
    HSIZE = np.zeros(len(local_order) + 1, np.int8)
    HCSID[0] = -1
    HSIZE[0] = 1
    for li, (size, pts, sid) in enumerate(local_order):
        HCSID[li + 1] = sid
        HSIZE[li + 1] = size
    for v in range(1, 5):
        best, bestch = -1, 0
        val = int(HVAL[v - 1])                 # одиночка
        if val > best:
            best, bestch = val, 0
        for li, (size, pts, sid) in enumerate(local_order):
            if size <= v:
                val = pts + int(HVAL[v - size])
                if val > best:
                    best, bestch = val, li + 1
        HVAL[v] = best
        HCH[v] = bestch


rebuild_dp_tables()


@njit
def _suit_rec(p, a, b, cc, d, e, c, p0, VV, VG, VC, stamp):
    """Рекурсия разбиения масти — точное зеркало bestPartition (src/partition.js).

    Состояние: p — позиция масти (0..8, 9 — конец), a — свободные тайлы в p
    (не занятые резервами и не съеденные одиночками), b, cc, d, e — резервы на
    p+1, p+2, p+3, p+4 (тайлы, уже съеденные паттернами, стартовавшими раньше;
    пятая компонента обязательна: паттерн с охватом 4, оставивший свободные
    тайлы в своей стартовой позиции, резервирует p+4).
    Опции перебираются в игровом порядке (таблицы OP_*: одиночка, затем
    структуры по порядку конфига); при равных очках берётся первая (строгий >)
    — как в игре. VV/VG — мемо (stamp), VC — бэктрек: (next_state << 4) |
    (OP_SID + 1), -1 для недостижимых состояний."""
    idx = p * N_SUIT_STATES + a * 625 + b * 125 + cc * 25 + d * 5 + e
    if VG[idx] == stamp:
        return VV[idx]
    if p == 9:
        best = 0 if (a == 0 and b == 0 and cc == 0 and d == 0 and e == 0) else NEG_SCORE
        VG[idx] = stamp
        VV[idx] = best
        VC[idx] = -1
        return best
    if a == 0:
        # позиция пуста (все тайлы съедены/запланированы): переходим дальше
        if p == 8:
            v = _suit_rec(9, 0, cc, d, e, 0, c, p0, VV, VG, VC, stamp)
            ni = 9 * N_SUIT_STATES + cc * 125 + d * 25 + e * 5
        else:
            a2 = c[p0 + p + 1] - b
            v = _suit_rec(p + 1, a2, cc, d, e, 0, c, p0, VV, VG, VC, stamp)
            ni = (p + 1) * N_SUIT_STATES + a2 * 625 + cc * 125 + d * 25 + e * 5
        VG[idx] = stamp
        VV[idx] = v
        if v > NEG_SCORE // 2:
            VC[idx] = ni << 4
        else:
            VC[idx] = -1
        return v
    best = NEG_SCORE
    best_ni = -1
    best_code = 0
    n = OPT_CNT[p]
    for j in range(n):
        kind = OP_KIND[p, j]
        if kind == 0:
            # одиночка
            if a == 1:
                if p == 8:
                    v = _suit_rec(9, 0, cc, d, e, 0, c, p0, VV, VG, VC, stamp)
                    ni = 9 * N_SUIT_STATES + cc * 125 + d * 25 + e * 5
                else:
                    a2 = c[p0 + p + 1] - b
                    v = _suit_rec(p + 1, a2, cc, d, e, 0, c, p0, VV, VG, VC, stamp)
                    ni = (p + 1) * N_SUIT_STATES + a2 * 625 + cc * 125 + d * 25 + e * 5
            else:
                v = _suit_rec(p, a - 1, b, cc, d, e, c, p0, VV, VG, VC, stamp)
                ni = p * N_SUIT_STATES + (a - 1) * 625 + b * 125 + cc * 25 + d * 5 + e
            tot = v
        elif kind == 1:
            n0 = OP_N0[p, j]
            if a < n0:
                continue
            n1 = OP_N1[p, j]
            n2 = OP_N2[p, j]
            n3 = OP_N3[p, j]
            n4 = OP_N4[p, j]
            if b + n1 > c[p0 + p + 1]:
                continue
            if cc + n2 > c[p0 + p + 2]:
                continue
            if d + n3 > c[p0 + p + 3]:
                continue
            if e + n4 > c[p0 + p + 4]:
                continue
            if a == n0:
                if p == 8:
                    v = _suit_rec(9, 0, cc + n2, d + n3, e + n4, 0, c, p0, VV, VG, VC, stamp)
                    ni = 9 * N_SUIT_STATES + (cc + n2) * 125 + (d + n3) * 25 + (e + n4) * 5
                else:
                    a2 = c[p0 + p + 1] - (b + n1)
                    v = _suit_rec(p + 1, a2, cc + n2, d + n3, e + n4, 0, c, p0, VV, VG, VC, stamp)
                    ni = (p + 1) * N_SUIT_STATES + a2 * 625 + (cc + n2) * 125 + (d + n3) * 25 + (e + n4) * 5
            else:
                v = _suit_rec(p, a - n0, b + n1, cc + n2, d + n3, e + n4, c, p0, VV, VG, VC, stamp)
                ni = p * N_SUIT_STATES + (a - n0) * 625 + (b + n1) * 125 + (cc + n2) * 25 + (d + n3) * 5 + (e + n4)
            tot = v + OP_PTS[p, j]
        else:
            size = OP_N0[p, j]
            if a < size:
                continue
            if a == size:
                if p == 8:
                    v = _suit_rec(9, 0, cc, d, e, 0, c, p0, VV, VG, VC, stamp)
                    ni = 9 * N_SUIT_STATES + cc * 125 + d * 25 + e * 5
                else:
                    a2 = c[p0 + p + 1] - b
                    v = _suit_rec(p + 1, a2, cc, d, e, 0, c, p0, VV, VG, VC, stamp)
                    ni = (p + 1) * N_SUIT_STATES + a2 * 625 + cc * 125 + d * 25 + e * 5
            else:
                v = _suit_rec(p, a - size, b, cc, d, e, c, p0, VV, VG, VC, stamp)
                ni = p * N_SUIT_STATES + (a - size) * 625 + b * 125 + cc * 25 + d * 5 + e
            tot = v + OP_PTS[p, j]
        if v <= NEG_SCORE // 2:
            continue
        if tot > best:
            best = tot
            best_ni = ni
            best_code = OP_SID[p, j] + 1
    VG[idx] = stamp
    VV[idx] = best
    if best_ni >= 0:
        VC[idx] = (best_ni << 4) | best_code
    else:
        VC[idx] = -1
    return best


@njit
def partition_v4(c, hidx, VV, VG, VC, str_cnt):
    """Лучшее разбиение 13 тайлов на паттерны v4: score + блоки в str_cnt.
    Полное зеркало игры (bestPartition), включая ничьи (порядок опций — из
    конфига, одиночка первая, строгий >). hidx — номер руки (для stamp'ов).
    Scratch: VV, VG, VC — int64[10*3125] (мемо очков / stamp'ы / бэктрек;
    переиспользуются между руками, сброс не нужен)."""
    score = 0
    for s in range(3):
        p0 = s * 9
        my_stamp = hidx * 30 + (s + 1)
        a0 = c[p0]
        score += _suit_rec(0, a0, 0, 0, 0, 0, c, p0, VV, VG, VC, my_stamp)
        # бэктрек блоков этой масти
        ni = a0 * 625
        while ni // N_SUIT_STATES < 9:
            pk = VC[ni]
            if pk < 0:
                break
            code = pk & 15
            ni = pk >> 4
            if code > 0:
                str_cnt[code - 1] += 1
    for k in range(27, 34):
        v = c[k]
        score += HVAL[v]
        while v > 0:
            ch = HCH[v]
            if ch == 0:
                v -= 1
            else:
                str_cnt[HCSID[ch]] += 1
                v -= HSIZE[ch]
    return score
N_HIST_LIN = 4097      # точные очки 0..4096
HIST_LOG_SHIFT = 12    # 4096 = 2^12, дальше логарифмические корзины
N_HIST_LOG = 19        # [2^12,2^13) ... [2^29,2^30), >=2^30
N_STATE = 4            # состояния после идеального сброса (вкл. ">=3 шантен")
N_CELLS = 18           # ячейки состояния×тира
N_TIER = 6             # число тиров (из конфига)

# Заполняется rebuild_offsets() — раскладка зависит от числа структур и яку.
OFF_HISTL = OFF_HISTG = OFF_STATE = 0
OFF_BASE_C = OFF_BASE_P = OFF_STR_C = OFF_STR_P = 0
OFF_YAK_C = OFF_YAK_P = OFF_TOTAL_PTS = OFF_HANDS = OFF_N_NO_YAKU = STATS_SIZE = 0
MEMO_CAP = 2_000_000

# Раскладка режима 2 (готовые руки) — заполняет rebuild_offsets_complete().
OFFC_HISTL = OFFC_HISTG = 0
OFFC_TOTAL = OFFC_N_DEALS = OFFC_N_COMPLETE = 0
OFFC_TYPE = OFFC_TIER_C = OFFC_TIER_P = OFFC_BASE_P = OFFC_BONUS_P = 0
OFFC_STR_C = OFFC_STR_P = OFFC_YAK_C = OFFC_YAK_P = 0
OFFC_AKA_C = OFFC_DORA_C = OFFC_HAN_C = STATS_C_SIZE = 0
N_AKA = 4        # 0..3 красных вида
N_DORA = 5       # 0..4 доры
N_URA = 5        # 0..4 урадор
N_HAN = 15       # хан -1..13 (последняя корзина — 13+)


def rebuild_offsets():
    """Раскладка массива статистики: зависит от конфига (число ячеек/структур/яку)."""
    global N_CELLS, N_TIER, OFF_HISTL, OFF_HISTG, OFF_STATE, OFF_BASE_C, OFF_BASE_P
    global OFF_STR_C, OFF_STR_P, OFF_YAK_C, OFF_YAK_P, OFF_TOTAL_PTS
    global OFF_HANDS, OFF_N_NO_YAKU, STATS_SIZE
    N_TIER = len(CFG_TIERS)
    N_CELLS = int(BASE.size)
    OFF_HISTL = 0
    OFF_HISTG = OFF_HISTL + N_HIST_LIN
    OFF_STATE = OFF_HISTG + N_HIST_LOG
    OFF_BASE_C = OFF_STATE + N_STATE
    OFF_BASE_P = OFF_BASE_C + N_CELLS
    OFF_STR_C = OFF_BASE_P + N_CELLS
    OFF_STR_P = OFF_STR_C + N_STRUCT
    OFF_YAK_C = OFF_STR_P + N_STRUCT
    OFF_YAK_P = OFF_YAK_C + N_YAKU
    OFF_TOTAL_PTS = OFF_YAK_P + N_YAKU
    OFF_HANDS = OFF_TOTAL_PTS + 1
    # руки без яку (заполняет только --mode yaku) и руки без структур+яку
    OFF_N_NO_YAKU = OFF_HANDS + 1
    STATS_SIZE = OFF_N_NO_YAKU + 1


def rebuild_offsets_complete():
    """Раскладка статистики режима 2 (готовые руки)."""
    global OFFC_HISTL, OFFC_HISTG, OFFC_TOTAL, OFFC_N_DEALS, OFFC_N_COMPLETE
    global OFFC_TYPE, OFFC_TIER_C, OFFC_TIER_P, OFFC_BASE_P, OFFC_BONUS_P
    global OFFC_STR_C, OFFC_STR_P, OFFC_YAK_C, OFFC_YAK_P
    global OFFC_AKA_C, OFFC_DORA_C, OFFC_URA_C, OFFC_HAN_C, STATS_C_SIZE
    OFFC_HISTL = 0
    OFFC_HISTG = OFFC_HISTL + N_HIST_LIN
    OFFC_TOTAL = OFFC_HISTG + N_HIST_LOG
    OFFC_N_DEALS = OFFC_TOTAL + 1
    OFFC_N_COMPLETE = OFFC_N_DEALS + 1
    OFFC_TYPE = OFFC_N_COMPLETE + 1          # 3: стандарт/чиитоицу/кокуши
    OFFC_TIER_C = OFFC_TYPE + 3
    OFFC_TIER_P = OFFC_TIER_C + N_TIER
    OFFC_BASE_P = OFFC_TIER_P + N_TIER
    OFFC_BONUS_P = OFFC_BASE_P + N_TIER
    OFFC_STR_C = OFFC_BONUS_P + 1
    OFFC_STR_P = OFFC_STR_C + N_STRUCT
    OFFC_YAK_C = OFFC_STR_P + N_STRUCT
    OFFC_YAK_P = OFFC_YAK_C + N_YAKU
    OFFC_AKA_C = OFFC_YAK_P + N_YAKU
    OFFC_DORA_C = OFFC_AKA_C + N_AKA
    OFFC_URA_C = OFFC_DORA_C + N_DORA
    OFFC_HAN_C = OFFC_URA_C + N_URA
    STATS_C_SIZE = OFFC_HAN_C + N_HAN


rebuild_offsets()
rebuild_offsets_complete()


@njit
def simulate_chunk(n, seed, riichi, aka, ura):
    """n случайных стартовых рук с идеальным сбросом. Возвращает S[STATS_SIZE].

    Две стадии (как в игре): сброс выбирается по счёту БЕЗ урадор (в момент
    сброса ура-индикатор закрыт), а в отчёт идёт финальный счёт выбранного
    сброса — с заново найденной лучшей рукой УЖЕ с урадорами."""
    np.random.seed(seed)
    S = np.zeros(STATS_SIZE, np.int64)
    deck = np.empty(136, np.int64)
    for k in range(136):
        deck[k] = k // 4
    H = np.zeros(34, np.int64)
    maxc = np.zeros(34, np.int64)
    sufH = np.zeros(37, np.int64)
    iso = np.zeros(40, np.int64)
    W = np.zeros(34, np.int64)
    trip = np.zeros(34, np.int64)
    seq = np.zeros(34, np.int64)
    pairp = np.zeros(1, np.int64)
    bestcost = np.zeros(LIM + 1, np.int64)
    bestfin = np.zeros(LIM + 1, np.int64)
    par = np.zeros(PAR_SIZE, np.int64)
    # scratch для DP-разбиения v4 (мемо очков / stamp'ы / бэктрек)
    pD = np.zeros(10 * N_SUIT_STATES, np.int64)
    pG = np.zeros(10 * N_SUIT_STATES, np.int64)
    pCh = np.zeros(10 * N_SUIT_STATES, np.int64)
    str_cnt = np.zeros(N_STRUCT, np.int64)
    yak_cnt = np.zeros(N_YAKU, np.int64)
    yak_pts = np.zeros(N_YAKU, np.int64)
    b_str = np.zeros(N_STRUCT, np.int64)
    b_str_pts = np.zeros(N_STRUCT, np.int64)
    b_yak = np.zeros(N_YAKU, np.int64)
    b_yak_pts = np.zeros(N_YAKU, np.int64)
    for h in range(n):
        # 14 тайлов руки + индикатор доры (14) + индикатор урадор (15)
        for k in range(16):
            j = k + np.random.randint(0, 136 - k)
            tmp = deck[k]
            deck[k] = deck[j]
            deck[j] = tmp
        for k in range(34):
            H[k] = 0
        for k in range(14):
            H[deck[k]] += 1
        ind = deck[14]
        ura_ind = deck[15] if ura else -1
        # ветер раунда — все четыре (в игре он детерминирован по дате, здесь
        # равновероятен); ветер игрока — все четыре.
        rw = 27 + np.random.randint(0, 4)
        sw = 27 + np.random.randint(0, 4)
        best_total = -1
        best_total_fin = 0
        best_state = 3
        best_tier = 0
        best_base = 0
        didx = 0
        for d in range(34):
            if H[d] == 0:
                continue
            H[d] -= 1
            # 1) шантен (концепт игры: min(стандарт, чиитоицу, кокуши))
            s = shanten_fast(H)
            # 2) структура: лучшее разбиение v4 (DP по мастям)
            for k in range(N_STRUCT):
                str_cnt[k] = 0
            str_pts_total = partition_v4(H, h * 14 + didx, pD, pG, pCh, str_cnt)
            # 3) яку (весь 13-тайловый состав)
            detect_yaku_v4(H, rw, sw, yak_cnt, yak_pts)
            yak_pts_total = 0
            for k in range(N_YAKU):
                yak_pts_total += yak_pts[k]
            # 4) тир (max-han) — только если шантен <= 2, иначе база = 0
            if s <= 2:
                # Красные пятёрки: в стене ровно один красный тайл на масть,
                # а 13-тайловая рука — случайное подмножество стены, поэтому
                # пятёрка масти красная с вероятностью n/4 (n — число пятёрок
                # этой масти в руке). Та же дилерская дистрибуция, что в игре
                # (ид '0m'/'0p'/'0s'); хан считает analyze по победной руке W.
                par[P_AKA_M] = 1 if (H[4] > 0 and np.random.rand() < H[4] * 0.25) else 0
                par[P_AKA_P] = 1 if (H[13] > 0 and np.random.rand() < H[13] * 0.25) else 0
                par[P_AKA_S] = 1 if (H[22] > 0 and np.random.rand() < H[22] * 0.25) else 0
                s2, han_dec, han_fin = analyze(H, ind, ura_ind, rw, sw, riichi, 0, aka,
                                               maxc, sufH, iso, W, trip, seq, pairp,
                                               bestcost, bestfin, par, s + 1)
                state = 2 - s
                # сброс выбирается по счёту без урадор (урадоры ещё закрыты)
                tier_dec = tier_of_han(han_dec)
                base_dec = BASE[state, tier_dec]
                # финальный счёт того же сброса — с урадорами
                tier_fin = tier_of_han(han_fin)
                base_fin = BASE[state, tier_fin]
            else:
                state = 3
                tier_dec = 0
                base_dec = 0
                tier_fin = 0
                base_fin = 0
            total = base_dec + str_pts_total + yak_pts_total
            if total > best_total:
                best_total = total
                # отчётный счёт — ФИНАЛЬНЫЙ (с урадорами): база берётся по
                # тиру лучшей руки уже с открытыми урадорами, как в игре
                best_total_fin = base_fin + str_pts_total + yak_pts_total
                best_state = state
                best_tier = tier_fin
                best_base = base_fin
                for k in range(N_STRUCT):
                    b_str[k] = str_cnt[k]
                    b_str_pts[k] = STRUCT_PTS[k] * str_cnt[k]
                for k in range(N_YAKU):
                    b_yak[k] = yak_cnt[k]
                    b_yak_pts[k] = yak_pts[k]
            H[d] += 1
            didx += 1
        S[OFF_TOTAL_PTS] += best_total_fin
        S[OFF_HANDS] += 1
        S[OFF_STATE + best_state] += 1
        if best_state <= 2:
            cell = best_state * N_TIER + best_tier
            S[OFF_BASE_C + cell] += 1
            S[OFF_BASE_P + cell] += best_base
        if best_total_fin <= N_HIST_LIN - 1:
            S[OFF_HISTL + best_total_fin] += 1
        else:
            v = best_total_fin
            b = 0
            while v >= 2:
                v = v >> 1
                b += 1
            idx = b - HIST_LOG_SHIFT
            if idx > N_HIST_LOG - 1:
                idx = N_HIST_LOG - 1
            S[OFF_HISTG + idx] += 1
        for k in range(N_STRUCT):
            S[OFF_STR_C + k] += b_str[k]
            S[OFF_STR_P + k] += b_str_pts[k]
        for k in range(N_YAKU):
            S[OFF_YAK_C + k] += b_yak[k]
            S[OFF_YAK_P + k] += b_yak_pts[k]
    return S


def _worker(args):
    return simulate_chunk(*args)


# ---------------------------------------------------------------- режим «только яку»

@njit
def simulate_yaku_chunk(n, seed, raw, greedy, struct_bound):
    """Режим 4 (--mode yaku): ТОЛЬКО структуры и яку, без шантенов.

    Зачем: шантен+analyze — самые дорогие части режима 1, а для проверки очень
    редких яку (большие ветра и т.п.) тир/база не нужны.

    raw=0: 14 тайлов -> перебираем все возможные сбросы, лучший = максимум
           (структуры + яку) на 13 тайлах — «суммарные очки без шантенов».
    raw=1: свойства считаются на самих 14 тайлах без сброса и без разбиения —
           чистая частота яку (дизайн-базис для designFrequencies.yaku), максимум
           скорости: ни ДП, ни шантена.

    greedy=1 (только при raw=0): ускорение без потери точности — сначала считаем
    ТОЛЬКО яку по всем сбросам (это дёшево), а разбиение (ДП) считаем лишь там,
    где оно может изменить выбор: если разрыв по яку между лучшим и остальными
    сбросом не больше безопасной границы суммы структур (struct_bound).
    При greedy=0 считается «в лоб» (эталон для сверки).

    Возвращает S[STATS_SIZE] в раскладке режима 1 (ячейки базы/состояний = 0)."""
    np.random.seed(seed)
    S = np.zeros(STATS_SIZE, np.int64)
    deck = np.empty(136, np.int64)
    for k in range(136):
        deck[k] = k // 4
    H = np.zeros(34, np.int64)
    pD = np.zeros(10 * N_SUIT_STATES, np.int64)
    pG = np.zeros(10 * N_SUIT_STATES, np.int64)
    pCh = np.zeros(10 * N_SUIT_STATES, np.int64)
    str_cnt = np.zeros(N_STRUCT, np.int64)
    yak_cnt = np.zeros(N_YAKU, np.int64)
    yak_pts = np.zeros(N_YAKU, np.int64)
    b_str = np.zeros(N_STRUCT, np.int64)
    b_str_pts = np.zeros(N_STRUCT, np.int64)
    b_yak = np.zeros(N_YAKU, np.int64)
    b_yak_pts = np.zeros(N_YAKU, np.int64)
    yk_sum = np.zeros(34, np.int64)      # яку-очки каждого сброса (проход 1)
    for h in range(n):
        for k in range(16):
            j = k + np.random.randint(0, 136 - k)
            tmp = deck[k]
            deck[k] = deck[j]
            deck[j] = tmp
        for k in range(34):
            H[k] = 0
        for k in range(14):
            H[deck[k]] += 1
        # ветра (нужны для ценных тайлов) — как в режиме 1: равновероятны
        rw = 27 + np.random.randint(0, 4)
        sw = 27 + np.random.randint(0, 4)
        best_total = 0
        best_yak = 0
        if raw:
            detect_yaku_v4(H, rw, sw, yak_cnt, yak_pts)
            for k in range(N_YAKU):
                best_total += yak_pts[k]
                b_yak[k] = yak_cnt[k]
                b_yak_pts[k] = yak_pts[k]
            if best_total == 0:
                S[OFF_N_NO_YAKU] += 1
        else:
            best_total = -1
            # --- проход 1: только яку (дёшево)
            for d in range(34):
                if H[d] == 0:
                    continue
                H[d] -= 1
                detect_yaku_v4(H, rw, sw, yak_cnt, yak_pts)
                s = 0
                for k in range(N_YAKU):
                    s += yak_pts[k]
                yk_sum[d] = s
                H[d] += 1
            top1 = -1
            top2 = -1
            arg1 = 0
            for d in range(34):
                if H[d] == 0:
                    continue
                s = yk_sum[d]
                if s > top1:
                    top2 = top1
                    top1 = s
                    arg1 = d
                elif s > top2:
                    top2 = s
            # --- проход 2: разбиение только там, где оно может повлиять
            didx = 0
            for d in range(34):
                if H[d] == 0:
                    continue
                if greedy and yk_sum[d] < top1 - struct_bound:
                    didx += 1
                    continue
                H[d] -= 1
                for k in range(N_STRUCT):
                    str_cnt[k] = 0
                str_pts = partition_v4(H, h * 14 + didx, pD, pG, pCh, str_cnt)
                detect_yaku_v4(H, rw, sw, yak_cnt, yak_pts)
                yak_total = 0
                for k in range(N_YAKU):
                    yak_total += yak_pts[k]
                total = str_pts + yak_total
                if total > best_total:
                    best_total = total
                    best_yak = yak_total
                    for k in range(N_STRUCT):
                        b_str[k] = str_cnt[k]
                        b_str_pts[k] = STRUCT_PTS[k] * str_cnt[k]
                    for k in range(N_YAKU):
                        b_yak[k] = yak_cnt[k]
                        b_yak_pts[k] = yak_pts[k]
                H[d] += 1
                didx += 1
        if not raw and best_yak == 0:
            S[OFF_N_NO_YAKU] += 1
        S[OFF_TOTAL_PTS] += best_total
        S[OFF_HANDS] += 1
        if best_total <= N_HIST_LIN - 1:
            S[OFF_HISTL + best_total] += 1
        else:
            v = best_total
            b = 0
            while v >= 2:
                v = v >> 1
                b += 1
            idx = b - HIST_LOG_SHIFT
            if idx > N_HIST_LOG - 1:
                idx = N_HIST_LOG - 1
            S[OFF_HISTG + idx] += 1
        for k in range(N_STRUCT):
            S[OFF_STR_C + k] += b_str[k]
            S[OFF_STR_P + k] += b_str_pts[k]
        for k in range(N_YAKU):
            S[OFF_YAK_C + k] += b_yak[k]
            S[OFF_YAK_P + k] += b_yak_pts[k]
    return S


def _worker_yaku(args):
    return simulate_yaku_chunk(*args)


@njit
def simulate_complete_chunk(n, seed, riichi, aka, complete_bonus, ura):
    """Режим 2: n случайных 14-тайловых дилерских рук (рука + индикатор доры +
    индикатор урадор). Готовая (isWinningHand) считается как evaluateCompleteHand
    в игре: строка «Готовая рука» (последняя в таблице базы) x тир +
    rules.completeBonus (в текущем конфиге 0) + структуры 14 тайлов +
    яку 14 тайлов (риичи — по общему дефолту, как в режиме 1; урадоры — считаются,
    готовая рука уже «после сброса»); неготовая получает 0. Возвращает S[STATS_C_SIZE].

    Оптимизации под очень большие прогоны:
      * проверка готовности — reject по (сумма масти) % 3 + мелкий DFS по
        мастям, без полного перебора;
      * хан/структуры/яку считаются ТОЛЬКО на готовых руках (~1e-5..1e-6 всех);
      * дилерская рука — локальный SplitMix64 (быстрее np.random.randint и не
        трогает глобальный поток); seed блока = seed + 7919*k, как в режиме 1.
    Модель ака та же, что в режиме 1: в стене один красный на масть, пятёрка
    руки красная с вероятностью n/4."""
    S = np.zeros(STATS_C_SIZE, np.int64)
    deck = np.empty(136, np.int64)
    for k in range(136):
        deck[k] = k // 4
    H = np.zeros(34, np.int64)
    trip = np.zeros(34, np.int64)
    seq = np.zeros(34, np.int64)
    pairp = np.zeros(1, np.int64)
    best = np.zeros(1, np.int64)
    par = np.zeros(PAR_SIZE, np.int64)
    # scratch для DP-разбиения v4 (мемо очков / stamp'ы / бэктрек)
    pD = np.zeros(10 * N_SUIT_STATES, np.int64)
    pG = np.zeros(10 * N_SUIT_STATES, np.int64)
    pCh = np.zeros(10 * N_SUIT_STATES, np.int64)
    str_cnt = np.zeros(N_STRUCT, np.int64)
    yak_cnt = np.zeros(N_YAKU, np.int64)
    yak_pts = np.zeros(N_YAKU, np.int64)
    st_a = seed & 0x7FFFFFFFFFFFFFFF
    if st_a == 0:
        st_a = SM64_ADD
    # Вторая НЕЗАВИСИМАЯ ветка для случайных величин (ветры, ака). Сделка
    # полностью определяет 64-битное состояние, поэтому «независимые» числа
    # из того же потока коррелируют с рукой; отдельное состояние лечит это.
    # Ветку сдвигаем на 5 шагов на каждую руку (в т.ч. неготовую), чтобы
    # поток не зависел от множества готовых рук.
    st_b = st_a
    st_b = ((st_b ^ (st_b >> 30)) * SM64_MUL1)
    st_b = ((st_b ^ (st_b >> 27)) * SM64_MUL2)
    st_b = st_b ^ (st_b >> 31)
    az = np.empty(5, np.int64)
    for h in range(n):
        # 14 тайлов руки + индикатор доры (14) + индикатор урадор (15):
        # частичный Fisher–Yates по 136-тайловой стене.
        # Микс инлайнится: см. предупреждение в _splitmix64 (баг numba).
        for k in range(16):
            s = st_a + SM64_ADD
            z = s
            z = (z ^ (z >> 30)) * SM64_MUL1
            z = (z ^ (z >> 27)) * SM64_MUL2
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
        S[OFFC_N_DEALS] += 1
        mask = complete_type(H)
        # ветры и ака — по второй независимой ветке, 5 доборов на каждую руку
        # (в т.ч. неготовую), чтобы поток не зависел от множества готовых рук
        for k in range(5):
            s = st_b + SM64_ADD
            z = s
            z = (z ^ (z >> 30)) * SM64_MUL1
            z = (z ^ (z >> 27)) * SM64_MUL2
            z = z ^ (z >> 31)
            st_b = s
            az[k] = z
        if mask == 0:
            continue
        rw = 27 + (az[0] % 4)
        sw = 27 + (az[1] % 4)
        if aka:
            par[P_AKA_M] = 1 if (H[4] > 0 and az[2] % 10000 < H[4] * 2500) else 0
            par[P_AKA_P] = 1 if (H[13] > 0 and az[3] % 10000 < H[13] * 2500) else 0
            par[P_AKA_S] = 1 if (H[22] > 0 and az[4] % 10000 < H[22] * 2500) else 0
        else:
            par[P_AKA_M] = 0
            par[P_AKA_P] = 0
            par[P_AKA_S] = 0
        S[OFFC_N_COMPLETE] += 1
        S[OFFC_TYPE + 0] += mask & 1
        S[OFFC_TYPE + 1] += (mask >> 1) & 1
        S[OFFC_TYPE + 2] += mask >> 2
        ind = deck[14]
        ura_ind = deck[15] if ura else -1
        han, tier, base, str_pts_total, yak_pts_total = eval_complete_hand(
            H, ind, ura_ind, rw, sw, riichi, 0, aka, par, trip, seq, pairp, best,
            pD, pG, pCh, str_cnt, yak_cnt, yak_pts, h + 1)
        total = base + complete_bonus + str_pts_total + yak_pts_total
        S[OFFC_TOTAL] += total
        S[OFFC_TIER_C + tier] += 1
        S[OFFC_TIER_P + tier] += total
        S[OFFC_BASE_P + tier] += base
        S[OFFC_BONUS_P] += complete_bonus
        if total <= N_HIST_LIN - 1:
            S[OFFC_HISTL + total] += 1
        else:
            v = total
            b = 0
            while v >= 2:
                v = v >> 1
                b += 1
            idx = b - HIST_LOG_SHIFT
            if idx > N_HIST_LOG - 1:
                idx = N_HIST_LOG - 1
            S[OFFC_HISTG + idx] += 1
        for k in range(N_STRUCT):
            S[OFFC_STR_C + k] += str_cnt[k]
            S[OFFC_STR_P + k] += STRUCT_PTS[k] * str_cnt[k]
        for k in range(N_YAKU):
            S[OFFC_YAK_C + k] += yak_cnt[k]
            S[OFFC_YAK_P + k] += yak_pts[k]
        if aka:
            S[OFFC_AKA_C + par[P_AKA_M] + par[P_AKA_P] + par[P_AKA_S]] += 1
        else:
            S[OFFC_AKA_C] += 1
        S[OFFC_DORA_C + H[par[P_DORA]]] += 1
        if ura:
            S[OFFC_URA_C + H[par[P_URA]]] += 1
        else:
            S[OFFC_URA_C] += 1
        hh = han + 1
        if hh > N_HAN - 1:
            hh = N_HAN - 1        # 13+ (несколько яку-манов или хан>13 с дорами)
        S[OFFC_HAN_C + hh] += 1
    return S


_COMPILE_SLOT_DONE = False


def _compile_slot_acquire():
    """Разрешение на компиляцию numba: не более одного процесса за раз.

    Компиляция simulate_complete_chunk — пик по памяти; при -w 12 двенадцать
    процессов, компилирующих одновременно, упираются в потолок (MemoryError
    в анализе CFG numba). Замок на файле сериализует только первую
    компиляцию каждого процесса; счёт уже скомпилирован и не блокируется.
    Любая ошибка замка игнорируется — прогон не должен из-за него падать.
    """
    try:
        import os as _os
        import time as _time
        path = _os.path.join(_os.environ.get('TEMP') or '.', 'mahjongdle_numba.lock')
        fd = _os.open(path, _os.O_CREAT | _os.O_RDWR)
        deadline = _time.time() + 3600.0
        while True:
            try:
                if _os.name == 'nt':
                    import msvcrt
                    _os.lseek(fd, 0, _os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return fd
            except OSError:
                if _time.time() > deadline:
                    return fd
                _time.sleep(1.0)
    except Exception:
        return None


def _compile_slot_release(fd):
    try:
        import os as _os
        if fd is None:
            return
        if _os.name == 'nt':
            import msvcrt
            _os.lseek(fd, 0, _os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_UN)
        _os.close(fd)
    except Exception:
        pass


def _worker_complete(args):
    """Воркер режима complete; первую компиляцию делает под общим замком."""
    global _COMPILE_SLOT_DONE
    if not _COMPILE_SLOT_DONE:
        fd = _compile_slot_acquire()
        try:
            result = simulate_complete_chunk(*args)
        finally:
            _compile_slot_release(fd)
            _COMPILE_SLOT_DONE = True
        return result
    return simulate_complete_chunk(*args)


@njit
def simulate_design_chunk(n, seed, riichi, aka, ura):
    """Дизайн-частоты БАЗЫ (состояние × тир) для пересчёта цен по K/P.

    Семантика дизайна (как в maj_stat): сброс выбирается по ШАНТЕНУ (лучший
    сброс), тир — по лучшей достижимой руке. Урадоры открываются после сброса,
    поэтому сброс выбирается без них, а тир берётся финальный (с ними) — ровно
    как считает игру/статистику режим 1.
    Структуры и яку не считаются: для базы они не нужны, а это в разы быстрее.
    Раскладка: S[state * N_TIER + tier] — руки, S[4 * N_TIER] — всего рук."""
    np.random.seed(seed)
    S = np.zeros(4 * N_TIER + 1, np.int64)
    deck = np.empty(136, np.int64)
    for k in range(136):
        deck[k] = k // 4
    H = np.zeros(34, np.int64)
    maxc = np.zeros(34, np.int64)
    sufH = np.zeros(37, np.int64)
    iso = np.zeros(40, np.int64)
    W = np.zeros(34, np.int64)
    trip = np.zeros(34, np.int64)
    seq = np.zeros(34, np.int64)
    pairp = np.zeros(1, np.int64)
    bestcost = np.zeros(LIM + 1, np.int64)
    bestfin = np.zeros(LIM + 1, np.int64)
    par = np.zeros(PAR_SIZE, np.int64)
    for h in range(n):
        for k in range(16):
            j = k + np.random.randint(0, 136 - k)
            tmp = deck[k]
            deck[k] = deck[j]
            deck[j] = tmp
        for k in range(34):
            H[k] = 0
        for k in range(14):
            H[deck[k]] += 1
        ind = deck[14]
        ura_ind = deck[15] if ura else -1
        rw = 27 + np.random.randint(0, 4)
        sw = 27 + np.random.randint(0, 4)
        # ака-пятёрки руки — один раз на руку (та же модель n/4)
        if aka:
            par[P_AKA_M] = 1 if (H[4] > 0 and np.random.rand() < H[4] * 0.25) else 0
            par[P_AKA_P] = 1 if (H[13] > 0 and np.random.rand() < H[13] * 0.25) else 0
            par[P_AKA_S] = 1 if (H[22] > 0 and np.random.rand() < H[22] * 0.25) else 0
        else:
            par[P_AKA_M] = 0
            par[P_AKA_P] = 0
            par[P_AKA_S] = 0
        best_sh = 9
        best_tier = 0
        for d in range(34):
            if H[d] == 0:
                continue
            H[d] -= 1
            s = shanten_fast(H)
            if s <= 2:
                s2, han_dec, han_fin = analyze(H, ind, ura_ind, rw, sw, riichi, 0, aka,
                                               maxc, sufH, iso, W, trip, seq, pairp,
                                               bestcost, bestfin, par, s + 1)
                tier = tier_of_han(han_fin)      # финальный тир — с урадорами
            else:
                tier = 0
            # «лучший сброс по шантену»; при равенстве — тир выше
            if s < best_sh or (s == best_sh and tier > best_tier):
                best_sh = s
                best_tier = tier
            H[d] += 1
        state = 3 if best_sh >= 3 else 2 - best_sh
        S[state * N_TIER + best_tier] += 1
        S[4 * N_TIER] += 1
    return S


def _worker_design(args):
    return simulate_design_chunk(*args)


@njit
def simulate_design_complete_chunk(n, seed, riichi, aka, ura):
    """Дизайн-частоты строки «Готовая рука»: тир готовых 14-тайловых рук.
    Раскладка: S[tier] — готовые руки тира, S[N_TIER] — дилерских рук,
    S[N_TIER + 1] — готовых всего."""
    S = np.zeros(N_TIER + 2, np.int64)
    deck = np.empty(136, np.int64)
    for k in range(136):
        deck[k] = k // 4
    H = np.zeros(34, np.int64)
    trip = np.zeros(34, np.int64)
    seq = np.zeros(34, np.int64)
    pairp = np.zeros(1, np.int64)
    best = np.zeros(1, np.int64)
    par = np.zeros(PAR_SIZE, np.int64)
    pD = np.zeros(10 * N_SUIT_STATES, np.int64)
    pG = np.zeros(10 * N_SUIT_STATES, np.int64)
    pCh = np.zeros(10 * N_SUIT_STATES, np.int64)
    str_cnt = np.zeros(N_STRUCT, np.int64)
    yak_cnt = np.zeros(N_YAKU, np.int64)
    yak_pts = np.zeros(N_YAKU, np.int64)
    st_a = seed & 0x7FFFFFFFFFFFFFFF
    if st_a == 0:
        st_a = SM64_ADD
    st_b = st_a
    st_b = ((st_b ^ (st_b >> 30)) * SM64_MUL1)
    st_b = ((st_b ^ (st_b >> 27)) * SM64_MUL2)
    st_b = st_b ^ (st_b >> 31)
    az = np.empty(5, np.int64)
    for h in range(n):
        for k in range(16):
            s = st_a + SM64_ADD
            z = s
            z = (z ^ (z >> 30)) * SM64_MUL1
            z = (z ^ (z >> 27)) * SM64_MUL2
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
        S[N_TIER] += 1
        mask = complete_type(H)
        for k in range(5):
            s = st_b + SM64_ADD
            z = s
            z = (z ^ (z >> 30)) * SM64_MUL1
            z = (z ^ (z >> 27)) * SM64_MUL2
            z = z ^ (z >> 31)
            st_b = s
            az[k] = z
        if mask == 0:
            continue
        rw = 27 + (az[0] % 4)
        sw = 27 + (az[1] % 4)
        if aka:
            par[P_AKA_M] = 1 if (H[4] > 0 and az[2] % 10000 < H[4] * 2500) else 0
            par[P_AKA_P] = 1 if (H[13] > 0 and az[3] % 10000 < H[13] * 2500) else 0
            par[P_AKA_S] = 1 if (H[22] > 0 and az[4] % 10000 < H[22] * 2500) else 0
        else:
            par[P_AKA_M] = 0
            par[P_AKA_P] = 0
            par[P_AKA_S] = 0
        ind = deck[14]
        ura_ind = deck[15] if ura else -1
        han, tier, base, str_pts_total, yak_pts_total = eval_complete_hand(
            H, ind, ura_ind, rw, sw, riichi, 0, aka, par, trip, seq, pairp, best,
            pD, pG, pCh, str_cnt, yak_cnt, yak_pts, h + 1)
        S[tier] += 1
        S[N_TIER + 1] += 1
    return S


def _worker_design_complete(args):
    return simulate_design_complete_chunk(*args)

# ---------------------------------------------------------------- запуск

def print_progress(done_chunks, chunk, n_total, t0):
    hands = min(n_total, done_chunks * chunk)
    el = time.time() - t0
    print(f"\r  проанализировано: {hands:,}/{n_total:,} рук "
          f"({hands / n_total * 100:.1f}%), {el:.0f} с, "
          f"{hands / max(el, 1e-9):,.0f} рук/с", end="", flush=True)


def run(n, workers, seed, chunk, quick, worker, build_arg, warm, stats_size):
    """Прогон блоков пулом процессов (или в одном). worker — top-level функция
    (picklable); build_arg(m, k) -> аргументы блока; warm() — прогрев/компиляция
    numba до запуска процессов; stats_size — размер результирующего массива."""
    warm()
    chunks = []
    left = n
    k = 0
    while left > 0:
        m = min(chunk, left)
        chunks.append(build_arg(m, k))
        left -= m
        k += 1
    total = np.zeros(stats_size, np.int64)
    done = 0
    t0 = time.time()
    if quick or workers <= 1:
        it = map(worker, chunks)
        pool = None
    else:
        pool = mp.Pool(workers)
        it = pool.imap_unordered(worker, chunks)
    for r in it:
        total += r
        done += 1
        if done % max(1, len(chunks) // 20) == 0 or done == len(chunks):
            print_progress(done, chunk, n, t0)
    if pool is not None:
        pool.close()
        pool.join()
    print()
    return total, time.time() - t0

# ---------------------------------------------------------------- отчёт

def fmt_int(v):
    return f"{int(v):,}"


def find_median(histl, histg, n):
    half = n / 2.0
    cum = 0
    for s in range(len(histl)):
        cum += int(histl[s])
        if cum >= half:
            return float(s), True
    for i, c in enumerate(histg):
        cum += int(c)
        if cum >= half:
            lo = (N_HIST_LIN - 1) << i
            hi = lo << 1
            if i == 18:
                hi = -1
            return (lo, hi), False
    return float(len(histl)), False


def make_svg(histl, histg, n, out, median, riichi, aka, ura=None, title=None):
    if title is None:
        ura_s = "" if ura is None else f", урадоры={'да' if ura else 'нет'}"
        title = (f"Распределение итоговых очков (идеальный сброс, N = {n:,}; "
                 f"риичи={'да' if riichi else 'нет'}, ака={'да' if aka else 'нет'}{ura_s})")
    pts = []
    for s in range(1, len(histl)):
        if histl[s] > 0:
            pts.append((math.log10(s), math.log10(int(histl[s]))))
    for i, c in enumerate(histg):
        if c > 0:
            lo = (N_HIST_LIN - 1) << i
            hi = lo << 1 if i < 18 else lo * 4
            pts.append((math.log10(math.sqrt(lo * hi)), math.log10(int(c))))
    pts.sort()
    W, Hh = 960, 540
    ML, MR, MT, MB = 74, 24, 46, 56
    pw, ph = W - ML - MR, Hh - MT - MB
    x0, x1 = 0.0, 9.0
    y1 = max(1, math.ceil(math.log10(n)))
    y0 = 0.0

    def X(v):
        return ML + (v - x0) / (x1 - x0) * pw

    def Y(v):
        return MT + (1 - (v - y0) / (y1 - y0)) * ph

    el = []
    el.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{Hh}" '
              f'font-family="Segoe UI, Arial, sans-serif" font-size="13">')
    el.append(f'<rect width="{W}" height="{Hh}" fill="white"/>')
    el.append(f'<text x="{W / 2}" y="24" text-anchor="middle" font-size="16" '
              f'font-weight="bold">{title}</text>')
    xlab = {0: "1", 1: "10", 2: "100", 3: "1k", 4: "10k", 5: "100k",
            6: "1M", 7: "10M", 8: "100M", 9: "1B"}
    for gx in range(10):
        px = X(gx)
        el.append(f'<line x1="{px:.1f}" y1="{MT}" x2="{px:.1f}" y2="{MT + ph}" '
                  f'stroke="#ddd"/>')
        el.append(f'<text x="{px:.1f}" y="{MT + ph + 18}" text-anchor="middle">'
                  f'{xlab[gx]}</text>')
    for gy in range(int(y1) + 1):
        py = Y(gy)
        el.append(f'<line x1="{ML}" y1="{py:.1f}" x2="{ML + pw}" y2="{py:.1f}" '
                  f'stroke="#eee"/>')
        el.append(f'<text x="{ML - 6}" y="{py + 4:.1f}" text-anchor="end">10^{gy}</text>')
    if isinstance(median, float):
        if median >= 1:
            px = X(math.log10(median))
            el.append(f'<line x1="{px:.1f}" y1="{MT}" x2="{px:.1f}" y2="{MT + ph}" '
                      f'stroke="#c33" stroke-dasharray="6,4"/>')
            el.append(f'<text x="{px:.1f}" y="{MT - 6}" text-anchor="middle" fill="#c33">'
                      f'медиана = {median:g}</text>')
    if len(pts) > 1:
        path = " ".join(f"{'M' if i == 0 else 'L'}{X(p[0]):.1f},{Y(min(p[1], y1)):.1f}"
                        for i, p in enumerate(pts))
        el.append(f'<path d="{path}" fill="none" stroke="#1565c0" stroke-width="1.6"/>')
        for p in pts:
            el.append(f'<circle cx="{X(p[0]):.1f}" cy="{Y(min(p[1], y1)):.1f}" r="2" '
                      f'fill="#1565c0"/>')
    el.append(f'<text x="{ML + pw / 2}" y="{Hh - 8}" text-anchor="middle">очки (log10)</text>')
    el.append(f'<text x="18" y="{MT + ph / 2}" text-anchor="middle" '
              f'transform="rotate(-90 18 {MT + ph / 2})">число рук (log10)</text>')
    el.append('</svg>')
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(el))


def write_csv(out_dir, S, n):
    histl = S[OFF_HISTL:OFF_HISTL + N_HIST_LIN]
    histg = S[OFF_HISTG:OFF_HISTG + N_HIST_LOG]
    with open(os.path.join(out_dir, "score_hist.csv"), "w", encoding="utf-8") as f:
        # n_deals в комментарии — чтобы отчётные инструменты (stats/tools/report_totals.py)
        # знали точное число раздач, не восстанавливая его из округлённых ev.
        # ВНИМАНИЕ: здесь гистограмма по ВСЕМ раздачам (неготовые руки = 0 очков),
        # поэтому сумма count = n_deals; в режиме 2 файл другой (там только готовые).
        f.write(f"# score_hist: распределение счёта рук (все раздачи, n_deals={n})\n")
        f.write("lo,hi,count,pct,cum_pct\n")
        cum = 0
        for s in range(N_HIST_LIN):
            c = int(histl[s])
            cum += c
            f.write(f"{s},{s},{c},{c / n * 100:.6f},{cum / n * 100:.6f}\n")
        for i in range(19):
            c = int(histg[i])
            cum += c
            lo = (N_HIST_LIN - 1) << i
            hi = (lo << 1) - 1 if i < 18 else -1
            f.write(f"{lo},{hi},{c},{c / n * 100:.6f},{cum / n * 100:.6f}\n")
    with open(os.path.join(out_dir, "components.csv"), "w", encoding="utf-8") as f:
        f.write("group,name,count,pct_hands,points,ev,designed_p,designed_ev,ratio\n")
        for st in range(3):
            for t in range(6):
                c = int(S[OFF_BASE_C + st * 6 + t])
                p = int(S[OFF_BASE_P + st * 6 + t])
                dp = float(BASE_P[st, t]) * float(BASE[st, t])
                de = dp
                ev = p / n
                ratio = ev / de if de > 0 else 0
                f.write(f"base,{STATE_NAMES[st]} / {TIER_NAMES[t]},{c},"
                        f"{c / n * 100:.6f},{p},{ev:.4f},{dp:.6f},{de:.4f},{ratio:.3f}\n")
        for k in range(N_STRUCT):
            c = int(S[OFF_STR_C + k])
            p = int(S[OFF_STR_P + k])
            de = float(STRUCT_P[k]) * float(STRUCT_PTS[k])
            ev = p / n
            ratio = ev / de if de > 0 else 0
            f.write(f"structure,{STRUCT_NAMES[k]} ({STRUCT_NOTES[k]}),{c},"
                    f"{c / n * 100:.6f},{p},{ev:.4f},{float(STRUCT_P[k]):.6f},{de:.4f},{ratio:.3f}\n")
        for k in range(N_YAKU):
            c = int(S[OFF_YAK_C + k])
            p = int(S[OFF_YAK_P + k])
            de = float(YAKU_P[k]) * float(YAKU_PTS[k])
            ev = p / n
            ratio = ev / de if de > 0 else 0
            f.write(f"yaku,{YAKU_NAMES[k]},{c},{c / n * 100:.6f},{p},{ev:.4f},"
                    f"{float(YAKU_P[k]):.6f},{de:.4f},{ratio:.3f}\n")


def write_yaku_csv(out_dir, S, n, raw, greedy):
    """CSV режима yaku: гистограмма (та же, что в режиме 1) + components.csv только
    по структурам и яку (базы/тиров в этом режиме нет — шантены не считаются)."""
    histl = S[OFF_HISTL:OFF_HISTL + N_HIST_LIN]
    histg = S[OFF_HISTG:OFF_HISTG + N_HIST_LOG]
    with open(os.path.join(out_dir, "score_hist.csv"), "w", encoding="utf-8") as f:
        f.write(f"# score_hist: распределение очков (структуры+яку, без шантенов;"
                f" все раздачи, n_deals={n})\n")
        f.write("lo,hi,count,pct,cum_pct\n")
        cum = 0
        for s in range(N_HIST_LIN):
            c = int(histl[s])
            cum += c
            f.write(f"{s},{s},{c},{c / n * 100:.6f},{cum / n * 100:.6f}\n")
        for i in range(19):
            c = int(histg[i])
            cum += c
            lo = (N_HIST_LIN - 1) << i
            hi = (lo << 1) - 1 if i < 18 else -1
            f.write(f"{lo},{hi},{c},{c / n * 100:.6f},{cum / n * 100:.6f}\n")
    with open(os.path.join(out_dir, "components_meta.txt"), "w", encoding="utf-8") as f:
        f.write(f"mode=yaku raw={int(raw)} greedy={int(greedy)} n_deals={n}\n"
                f"no_yaku_hands={int(S[OFF_N_NO_YAKU])}\n")
    with open(os.path.join(out_dir, "components.csv"), "w", encoding="utf-8") as f:
        f.write("group,name,count,pct_hands,points,ev,designed_p,designed_ev,ratio\n")
        if not raw:
            for k in range(N_STRUCT):
                c = int(S[OFF_STR_C + k])
                p = int(S[OFF_STR_P + k])
                de = float(STRUCT_P[k]) * float(STRUCT_PTS[k])
                ev = p / n
                ratio = ev / de if de > 0 else 0
                f.write(f"structure,{STRUCT_NAMES[k]} ({STRUCT_NOTES[k]}),{c},"
                        f"{c / n * 100:.6f},{p},{ev:.4f},{float(STRUCT_P[k]):.6f},"
                        f"{de:.4f},{ratio:.3f}\n")
        for k in range(N_YAKU):
            c = int(S[OFF_YAK_C + k])
            p = int(S[OFF_YAK_P + k])
            de = float(YAKU_P[k]) * float(YAKU_PTS[k])
            ev = p / n
            ratio = ev / de if de > 0 else 0.0
            f.write(f"yaku,{YAKU_NAMES[k]},{c},{c / n * 100:.6f},{p},{ev:.4f},"
                    f"{float(YAKU_P[k]):.6f},{de:.4f},{ratio:.3f}\n")


def print_yaku_report(S, n, elapsed, raw=False, greedy=True):
    """Отчёт режима yaku: только яку и структуры, без шантенов/тиров/базы."""
    if raw:
        mode = "только яку, без сброса (свойства случайных 14 тайлов)"
    else:
        mode = "только яку: лучший сброс по структурам+яку, БЕЗ шантенов"
    print("=" * 92)
    print(f"РЕЖИМ: {mode}")
    print(f"раздач: {n:,}   время: {elapsed:.1f} c   скорость: {n / elapsed:,.0f} рук/с"
          + ("" if raw else f"   ускорение прохода 2: {'да' if greedy else 'нет'}"))
    print("=" * 92)
    no_yak = int(S[OFF_N_NO_YAKU])
    tot_struct = 0
    tot_yak = 0
    print(f"руки без яку: {no_yak:,} ({no_yak / n * 100:.3f}%)\n")
    print(f"{'яку':<24}{'рук':>12}{'% рук':>10}{'1 из':>14}{'очки/рука':>14}{'всего очков':>18}")
    print("-" * 92)
    rows = []
    for k in range(N_YAKU):
        c = int(S[OFF_YAK_C + k])
        p = int(S[OFF_YAK_P + k])
        rows.append((p, c, k))
    for p, c, k in sorted(rows, reverse=True):
        tot_yak += p
        one_in = f"{n / c:,.0f}" if c else "—"
        print(f"{YAKU_NAMES[k]:<24}{c:>12,}{c / n * 100:>10.4f}{one_in:>14}"
              f"{p / n:>14.3f}{p:>18,}")
    print("-" * 92)
    print(f"{'ИТОГО ЯКУ':<24}{'':>12}{'':>10}{'':>14}{tot_yak / n:>14.3f}{tot_yak:>18,}")
    if not raw:
        print(f"\n{'структура':<24}{'блоков':>12}{'% блоков':>10}{'1 из':>14}"
              f"{'очки/рука':>14}{'всего очков':>18}")
        print("-" * 92)
        srows = [(int(S[OFF_STR_P + k]), int(S[OFF_STR_C + k]), k) for k in range(N_STRUCT)]
        blocks = sum(c for _, c, _ in srows)
        for p, c, k in sorted(srows, reverse=True):
            tot_struct += p
            one_in = f"{blocks / c:,.1f}" if c else "—"
            print(f"{STRUCT_NAMES[k]:<24}{c:>12,}{c / blocks * 100:>10.4f}{one_in:>14}"
                  f"{p / n:>14.3f}{p:>18,}")
        print("-" * 92)
        print(f"{'ИТОГО СТРУКТУРЫ':<24}{blocks:>12,}{'':>10}{'':>14}"
              f"{tot_struct / n:>14.3f}{tot_struct:>18,}")
    print()
    print(f"ИТОГО (структуры + яку): {tot_struct + tot_yak:,} очков, "
          f"{S[OFF_TOTAL_PTS] / n:,.4f} очков/рука")
    print("=" * 92)


def print_report(S, n, elapsed, riichi, aka, ura):
    histl = S[OFF_HISTL:OFF_HISTL + N_HIST_LIN]
    histg = S[OFF_HISTG:OFF_HISTG + N_HIST_LOG]
    total_pts = int(S[OFF_TOTAL_PTS])
    mean = total_pts / n
    median, exact = find_median(histl, histg, n)
    if exact:
        med_s = f"{median:g}"
    else:
        lo, hi = median
        med_s = f"{lo:,}..{hi:,}" if hi > 0 else f"{lo:,}+"
    print("=" * 100)
    print(f"Система v4, идеальный сброс. Рук: {n:,}   время: {elapsed:.1f} c "
          f"({n / max(elapsed, 1e-9):,.0f} рук/с)")
    print(f"Риичи в тире: {'да' if riichi else 'нет'}, ака: {'да' if aka else 'нет'}, "
          f"урадоры: {'да (финальный счёт; сброс — без них)' if ura else 'нет'}, "
          f"цумо: нет (правило), фу: не считаются (манган = 5+ хан)")
    print(f"Средний счёт: {mean:,.1f}   медиана: {med_s}")
    print("=" * 100)

    print("\nСостояния после идеального сброса (в скобках — дизайн, лучший сброс по шантену):")
    # Режим 1: состояния — только строки 0..2 (последняя строка таблицы —
    # «Готовая рука», к режиму 1 относится).
    # Раньше здесь стоял maj_stat, но дизайн-частоты теперь свои
    # (designFrequencies.base, пересчёт 2026-10-17), поэтому и подпись своя.
    maj = [float(BASE_P[i].sum()) for i in range(3)]
    maj.append(max(0.0, 1.0 - sum(maj)))
    for i in range(4):
        c = int(S[OFF_STATE + i])
        print(f"  {ALL_STATE_NAMES[i]:<14}{c:>14,}{c / n * 100:>12.4f}%   "
              f"(дизайн {maj[i] * 100:.4f}%)")

    print("\nБаза: состояние x тир")
    print(f"  {'ячейка':<22}{'рук':>14}{'% рук':>11}{'очки':>16}"
          f"{'EV':>10}{'EV-дизайн':>11}{'радио':>8}")
    base_ev_sim = 0
    for st in range(3):
        for t in range(N_TIER):
            c = int(S[OFF_BASE_C + st * N_TIER + t])
            p = int(S[OFF_BASE_P + st * N_TIER + t])
            ev = p / n
            de = float(BASE_P[st, t]) * float(BASE[st, t])
            ratio = ev / de if de > 0 else float('nan')
            base_ev_sim += ev
            print(f"  {STATE_NAMES[st] + ' / ' + TIER_NAMES[t]:<22}{c:>14,}"
                  f"{c / n * 100:>10.4f}%{p:>16,}{ev:>10.3f}{de:>11.3f}{ratio:>8.2f}")
    print(f"  {'ИТОГО база':<22}{'':>14}{'':>11}{'':>16}{base_ev_sim:>10.3f}")

    print("\nСтруктуры (блоки в лучших разбиениях 13 тайлов)")
    print(f"  {'структура':<24}{'блоков':>14}{'% рук':>11}{'очки':>18}"
          f"{'EV':>10}{'EV-дизайн':>11}{'радио':>8}")
    str_ev_sim = 0
    # порядок вывода — по убыванию цены (индексы структур — из конфига,
    # поэтому список не хардкодим)
    order = sorted(range(N_STRUCT), key=lambda k: (-float(STRUCT_PTS[k]), k))
    for k in order:
        c = int(S[OFF_STR_C + k])
        p = int(S[OFF_STR_P + k])
        ev = p / n
        de = float(STRUCT_P[k]) * float(STRUCT_PTS[k])
        ratio = ev / de if de > 0 else float('nan')
        str_ev_sim += ev
        print(f"  {STRUCT_NAMES[k] + ' (' + STRUCT_NOTES[k] + ')':<24}{c:>14,}"
              f"{c / n * 100:>10.3f}%{p:>18,}{ev:>10.3f}{de:>11.3f}{ratio:>8.2f}")
    print(f"  {'ИТОГО структуры':<24}{'':>14}{'':>11}{'':>18}{str_ev_sim:>10.3f}")

    print("\nЯку (на 13 тайлах после идеального сброса)")
    print(f"  {'яку':<24}{'рук':>14}{'% рук':>11}{'очки':>18}"
          f"{'EV':>10}{'EV-дизайн':>11}{'радио':>8}")
    yak_ev_sim = 0
    for k in range(N_YAKU):
        c = int(S[OFF_YAK_C + k])
        p = int(S[OFF_YAK_P + k])
        ev = p / n
        de = float(YAKU_P[k]) * float(YAKU_PTS[k])
        ratio = ev / de if de > 0 else float('nan')
        yak_ev_sim += ev
        once = f"1 из {n // c:,}" if c > 0 else "не встречено"
        print(f"  {YAKU_NAMES[k]:<24}{c:>14,}{c / n * 100:>10.4f}%{p:>18,}"
              f"{ev:>10.3f}{de:>11.3f}{ratio:>8.2f}   {once}")
    print(f"  {'ИТОГО яку':<24}{'':>14}{'':>11}{'':>18}{yak_ev_sim:>10.3f}")

    print("\nСводка EV на руку (симуляция vs дизайн v4):")
    design_base = sum(float(BASE_P[st, t]) * float(BASE[st, t])
                      for st in range(3) for t in range(N_TIER))
    design_str = sum(float(STRUCT_P[k]) * float(STRUCT_PTS[k]) for k in range(N_STRUCT))
    design_yak = sum(float(YAKU_P[k]) * float(YAKU_PTS[k]) for k in range(N_YAKU))
    print(f"  база       {base_ev_sim:>10.1f}   (дизайн {design_base:.0f})")
    print(f"  структуры  {str_ev_sim:>10.1f}   (дизайн {design_str:.0f})")
    print(f"  яку        {yak_ev_sim:>10.1f}   (дизайн {design_yak:.0f})")
    print(f"  итого      {base_ev_sim + str_ev_sim + yak_ev_sim:>10.1f}   "
          f"(дизайн {design_base + design_str + design_yak:.0f})")
    print("\nПримечание: дизайн P для структур/яку — базис «13 тайлов после сброса» "
          "(исторически maj_stat; сверено: режим yaku совпадает с таблицей в 2%). "
          "Семь джекпотов 2026-10-19 — точная вероятность случайной 13-тайловой руки "
          "(см. note в config); база — лучший сброс по шантену; симуляция — 13 тайлов")
    print("после идеального сброса (максимизирует общий итог, может жертвовать "
          "шантеном ради яку).")


# ---------------------------------------------------------------- отчёт режима 2

def print_complete_report(S, elapsed, riichi, aka, complete_bonus, ura):
    n_deals = int(S[OFFC_N_DEALS])
    n_complete = int(S[OFFC_N_COMPLETE])
    total_pts = int(S[OFFC_TOTAL])
    ev_deal = total_pts / n_deals if n_deals else 0.0
    ev_comp = total_pts / n_complete if n_complete else 0.0
    if n_complete:
        median, exact = find_median(S[OFFC_HISTL:OFFC_HISTL + N_HIST_LIN],
                                    S[OFFC_HISTG:OFFC_HISTG + N_HIST_LOG], n_complete)
        if exact:
            med_s = f"{median:g}"
        else:
            lo, hi = median
            med_s = f"{lo:,}..{hi:,}" if hi > 0 else f"{lo:,}+"
    else:
        med_s = "—"
    print("=" * 100)
    print(f"Система v4, режим: готовая рука (стартовые 14 тайлов). Дилерских рук: "
          f"{n_deals:,}   время: {elapsed:.1f} c "
          f"({n_deals / max(elapsed, 1e-9):,.0f} рук/с)")
    print(f"Ака: {'да' if aka else 'нет'}, "
          f"риичи: {'да (дефолт, как в режиме 1)' if riichi else 'нет (--no-riichi)'}, "
          f"урадоры: {'да' if ura else 'нет (--no-ura)'}, "
          f"цумо: нет (правило), фу: не считаются (манган = 5+ хан)")
    if n_complete:
        p = n_complete / n_deals
        print(f"Готовые руки: {n_complete:,}   P = {p:.6e}   (~1 из {n_deals // n_complete:,})")
    else:
        print(f"Готовых рук: 0   (P < {1.0 / max(n_deals, 1):.3e})")
    print(f"Средний счёт: {ev_deal:.2f} на дилерскую руку (неготовая = 0); "
          f"{ev_comp:,.1f} на готовую   медиана (готовых): {med_s}")
    complete_row = STATE_NAMES[-1]
    bonus_note = f" + бонус за готовность {complete_bonus}" if complete_bonus else ""
    print(f"База: строка «{complete_row}» таблицы базы{bonus_note}")
    print("=" * 100)

    print("\nТипы (двойная рука чиитоицу & стандарт идёт в оба счётчика):")
    type_names = ["Стандарт", "Чиитоицу", "Кокуши"]
    for i in range(3):
        c = int(S[OFFC_TYPE + i])
        pct = c / n_complete * 100 if n_complete else 0.0
        print(f"  {type_names[i]:<14}{c:>14,}{pct:>12.4f}% готовых")

    print(f"\nТиры (база = строка «{STATE_NAMES[-1]}»):")
    print(f"  {'тир':<12}{'готовых':>14}{'% готовых':>12}{'средний счёт':>16}"
          f"{'база EV/руку':>15}")
    base_ev = 0.0
    for t in range(N_TIER):
        c = int(S[OFFC_TIER_C + t])
        p = int(S[OFFC_TIER_P + t])
        bp = int(S[OFFC_BASE_P + t])
        base_ev += bp / n_deals
        avg = p / c if c else 0.0
        pct = c / n_complete * 100 if n_complete else 0.0
        print(f"  {TIER_NAMES[t]:<12}{c:>14,}{pct:>12.4f}{avg:>16,.1f}{bp / n_deals:>15.3f}")
    bonus_ev = int(S[OFFC_BONUS_P]) / n_deals if n_deals else 0.0
    print(f"  {'База+бонус':<12}{'':>14}{'':>12}{'':>16}{base_ev + bonus_ev:>15.3f}")

    print("\nСтруктуры (лучшее разбиение готовых 14 тайлов):")
    print(f"  {'структура':<24}{'блоков':>14}{'% готовых':>12}{'очки':>18}"
          f"{'EV/руку':>12}{'EV/готовую':>13}")
    str_ev = 0.0
    for k in range(N_STRUCT):
        c = int(S[OFFC_STR_C + k])
        p = int(S[OFFC_STR_P + k])
        str_ev += p / n_deals
        evc = p / n_complete if n_complete else 0.0
        pct = c / n_complete * 100 if n_complete else 0.0
        print(f"  {STRUCT_NAMES[k] + ' (' + STRUCT_NOTES[k] + ')':<24}{c:>14,}"
              f"{pct:>12.3f}{p:>18,}{p / n_deals:>12.3f}{evc:>13.3f}")
    print(f"  {'ИТОГО структуры':<24}{'':>14}{'':>12}{'':>18}{str_ev:>12.3f}")

    print("\nЯку (на всех 14 тайлах):")
    print(f"  {'яку':<24}{'готовых':>14}{'% готовых':>12}{'очки':>18}"
          f"{'EV/руку':>12}{'EV/готовую':>13}   частота")
    yak_ev = 0.0
    for k in range(N_YAKU):
        c = int(S[OFFC_YAK_C + k])
        p = int(S[OFFC_YAK_P + k])
        yak_ev += p / n_deals
        evc = p / n_complete if n_complete else 0.0
        pct = c / n_complete * 100 if n_complete else 0.0
        if c > 0:
            once = f"1 из {n_deals // c:,} рук"
        else:
            once = f"P < {1.0 / max(n_deals, 1):.1e}"
        print(f"  {YAKU_NAMES[k]:<24}{c:>14,}{pct:>12.4f}{p:>18,}"
              f"{p / n_deals:>12.3f}{evc:>13.3f}   {once}")
    print(f"  {'ИТОГО яку':<24}{'':>14}{'':>12}{'':>18}{yak_ev:>12.3f}")

    print("\nАка в готовых руках:")
    for a in range(N_AKA):
        c = int(S[OFFC_AKA_C + a])
        pct = c / n_complete * 100 if n_complete else 0.0
        print(f"  {a} красн.: {c:>14,}{pct:>12.4f}% готовых")
    print("Дора в готовых руках:")
    for d in range(N_DORA):
        c = int(S[OFFC_DORA_C + d])
        pct = c / n_complete * 100 if n_complete else 0.0
        print(f"  {d} дор:    {c:>14,}{pct:>12.4f}% готовых")
    print("Ура-дора в готовых руках:")
    for u in range(N_URA):
        c = int(S[OFFC_URA_C + u])
        pct = c / n_complete * 100 if n_complete else 0.0
        print(f"  {u} урадор: {c:>14,}{pct:>12.4f}% готовых")
    print("Хан готовых рук:")
    han_line = []
    for h in range(N_HAN):
        c = int(S[OFFC_HAN_C + h])
        label = "13+" if h == N_HAN - 1 else str(h - 1)
        han_line.append(f"{label}:{c:,}")
    print("  " + "  ".join(han_line))
    print("\nПримечание: EV/руку — на дилерскую руку (неготовая = 0); EV/готовую —")
    print("условно на готовую. Дизайн-частоты config для базы — строка «Готовая рука»")
    print("(измерена на 10b); для структур/яку — базис «13 тайлов после сброса» "
          "(исторически), джекпоты 2026-10-19 — случайная 13-тайловая рука.")


def write_complete_csv(out_dir, S):
    n_deals = int(S[OFFC_N_DEALS])
    n_complete = int(S[OFFC_N_COMPLETE])
    histl = S[OFFC_HISTL:OFFC_HISTL + N_HIST_LIN]
    histg = S[OFFC_HISTG:OFFC_HISTG + N_HIST_LOG]
    with open(os.path.join(out_dir, "score_hist.csv"), "w", encoding="utf-8") as f:
        f.write("# score_hist: распределение счёта ГОТОВЫХ рук "
                f"(n_deals={n_deals}, n_complete={n_complete})\n")
        f.write("lo,hi,count,pct,cum_pct\n")
        cum = 0
        base = n_complete if n_complete else 1
        for s in range(N_HIST_LIN):
            c = int(histl[s])
            cum += c
            f.write(f"{s},{s},{c},{c / base * 100:.6f},{cum / base * 100:.6f}\n")
        for i in range(N_HIST_LOG):
            c = int(histg[i])
            cum += c
            lo = (N_HIST_LIN - 1) << i
            hi = (lo << 1) - 1 if i < N_HIST_LOG - 1 else -1
            f.write(f"{lo},{hi},{c},{c / base * 100:.6f},{cum / base * 100:.6f}\n")
    with open(os.path.join(out_dir, "components.csv"), "w", encoding="utf-8") as f:
        f.write("# components (режим: готовая рука; EV — на дилерскую руку)\n")
        f.write("group,name,count,pct_hands,points,ev,designed_p,designed_ev,ratio\n")
        for i in range(3):
            c = int(S[OFFC_TYPE + i])
            f.write(f"type,{'Стандарт/Чиитоицу/Кокуши'.split('/')[i]},{c},"
                    f"{c / n_complete * 100 if n_complete else 0:.6f},0,0,0,0,0\n")
        complete_state = BASE.shape[0] - 1
        for t in range(N_TIER):
            c = int(S[OFFC_TIER_C + t])
            bp = int(S[OFFC_BASE_P + t])
            dp = float(BASE_P[complete_state, t])
            de = dp * float(BASE[complete_state, t])
            ev = bp / n_deals
            ratio = ev / de if de > 0 else 0
            f.write(f"base,{STATE_NAMES[complete_state]} / {TIER_NAMES[t]},{c},"
                    f"{c / n_complete * 100 if n_complete else 0:.6f},{bp},"
                    f"{ev:.4f},{dp:.8f},{de:.4f},{ratio:.3f}\n")
        for k in range(N_STRUCT):
            c = int(S[OFFC_STR_C + k])
            p = int(S[OFFC_STR_P + k])
            de = float(STRUCT_P[k]) * float(STRUCT_PTS[k])
            ev = p / n_deals
            ratio = ev / de if de > 0 else 0
            f.write(f"structure,{STRUCT_NAMES[k]} ({STRUCT_NOTES[k]}),{c},"
                    f"{c / n_complete * 100 if n_complete else 0:.6f},{p},{ev:.4f},"
                    f"{float(STRUCT_P[k]):.6f},{de:.4f},{ratio:.3f}\n")
        for k in range(N_YAKU):
            c = int(S[OFFC_YAK_C + k])
            p = int(S[OFFC_YAK_P + k])
            de = float(YAKU_P[k]) * float(YAKU_PTS[k])
            ev = p / n_deals
            ratio = ev / de if de > 0 else 0
            f.write(f"yaku,{YAKU_NAMES[k]},{c},"
                    f"{c / n_complete * 100 if n_complete else 0:.6f},{p},{ev:.4f},"
                    f"{float(YAKU_P[k]):.6f},{de:.4f},{ratio:.3f}\n")
        for a in range(N_AKA):
            c = int(S[OFFC_AKA_C + a])
            f.write(f"aka,{a} красн.,{c},{c / n_complete * 100 if n_complete else 0:.6f},"
                    f"0,0,0,0,0\n")
        for d in range(N_DORA):
            c = int(S[OFFC_DORA_C + d])
            f.write(f"dora,{d} дор,{c},{c / n_complete * 100 if n_complete else 0:.6f},"
                    f"0,0,0,0,0\n")
        for u in range(N_URA):
            c = int(S[OFFC_URA_C + u])
            f.write(f"ura,{u} урадор,{c},{c / n_complete * 100 if n_complete else 0:.6f},"
                    f"0,0,0,0,0\n")
        for h in range(N_HAN):
            c = int(S[OFFC_HAN_C + h])
            label = "13+" if h == N_HAN - 1 else str(h - 1)
            f.write(f"han,{label},{c},{c / n_complete * 100 if n_complete else 0:.6f},"
                    f"0,0,0,0,0\n")


def write_design_report(S, out_dir, riichi, aka, ura):
    """Дизайн-частоты базы и цены K/P (якорь: 2-шантен Normal = 100).
    Пишет design_frequencies.json и печатает таблицу. Цены — чистые K/P;
    авторские «полы» (Haneman/Sanbaiman/Yakuman) применяются к ним уже в
    config/scoring.json (см. design/scoring-v4.md)."""
    n = int(S[4 * N_TIER])
    counts = [[int(S[st * N_TIER + t]) for t in range(N_TIER)] for st in range(4)]
    p = [[(counts[st][t] / n if n else 0.0) for t in range(N_TIER)] for st in range(4)]
    anchor = p[0][0]
    k = 100.0 * anchor if anchor > 0 else 0.0
    price = [[(k / p[st][t] if p[st][t] > 0 else None) for t in range(N_TIER)]
             for st in range(4)]
    print("=" * 100)
    print(f"Дизайн-частоты базы (лучший сброс по шантену, тир — финальный, с урадорами). "
          f"Рук: {n:,}")
    print(f"риичи: {'да' if riichi else 'нет'}, ака: {'да' if aka else 'нет'}, "
          f"урадоры: {'да' if ura else 'нет'}")
    print(f"Якорь 2-шантен/Normal = 100  ->  K = {k:.6f}")
    print(f"\n{'состояние':<14}" + "".join(f"{TIER_NAMES[t]:>16}" for t in range(N_TIER)))
    for st in range(4):
        row = "".join(f"{p[st][t] * 100:>15.6f}%" for t in range(N_TIER))
        print(f"{ALL_STATE_NAMES[st] if st < len(ALL_STATE_NAMES) else STATE_NAMES[st]:<14}{row}")
    print(f"\n{'чистые K/P':<14}" + "".join(f"{TIER_NAMES[t]:>16}" for t in range(N_TIER)))
    for st in range(4):
        row = "".join(("—" if price[st][t] is None else f"{price[st][t]:>16,.1f}")
                      for t in range(N_TIER))
        print(f"{ALL_STATE_NAMES[st] if st < len(ALL_STATE_NAMES) else STATE_NAMES[st]:<14}{row}")
    print("=" * 100)
    payload = {
        "rules": {"riichiHan": riichi, "akaDora": bool(aka), "uraDora": bool(ura),
                  "tsumo": False},
        "hands": n,
        "anchor_price": 100,
        "K": k,
        "P_counts": counts,
        "P": p,
        "price_pure": price,
    }
    path = os.path.join(out_dir, "design_frequencies.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f"файл: {path}")


def write_design_complete_report(S, out_dir, riichi, aka, ura):
    """Дизайн-частоты строки «Готовая рука» (тир готовых стартовых рук)."""
    n = int(S[N_TIER])
    nc = int(S[N_TIER + 1])
    counts = [int(S[t]) for t in range(N_TIER)]
    p = [(c / n if n else 0.0) for c in counts]
    print("=" * 100)
    print(f"Дизайн-частоты строки «Готовая рука» (готовых {nc:,} из {n:,} дилерских).")
    print(f"риичи: {'да' if riichi else 'нет'}, ака: {'да' if aka else 'нет'}, "
          f"урадоры: {'да' if ura else 'нет'}")
    print(f"P(готовая) = {nc / n if n else 0:.6e}")
    for t in range(N_TIER):
        cond = counts[t] / nc * 100 if nc else 0.0
        print(f"  {TIER_NAMES[t]:<12}{counts[t]:>14,}   {cond:>10.4f}% готовых   "
              f"P(рука+тир) = {p[t]:.6e}")
    print("=" * 100)
    payload = {
        "rules": {"riichiHan": riichi, "akaDora": bool(aka), "uraDora": bool(ura),
                  "tsumo": False},
        "deals": n,
        "complete": nc,
        "P_complete": (nc / n if n else 0.0),
        "P_counts": counts,
        "P": p,
    }
    path = os.path.join(out_dir, "design_complete.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f"файл: {path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("-n", "--hands", type=int, default=100_000_000)
    ap.add_argument("-w", "--workers", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--seed", type=int, default=12345)
    ap.add_argument("--chunk", type=int, default=20_000, help="рук в одном блоке")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "out" / "last"),
                    help="каталог для score_hist.* и components.csv")
    ap.add_argument("--config", default=str(CONFIG_PATH),
                    help="свой конфиг со стоимостями (по умолчанию config/scoring.json)")
    ap.add_argument("--no-riichi", action="store_true", help="не считать риичи в тире")
    ap.add_argument("--no-aka", action="store_true", help="не считать ака-дору в тире")
    ap.add_argument("--no-ura", action="store_true",
                    help="не считать ура-дору (по умолчанию считается в финальном счёте)")
    ap.add_argument("--quick", action="store_true", help="один процесс (без пула)")
    ap.add_argument("--mode", choices=["discard", "complete", "design", "design-complete", "yaku"],
                    default="discard",
                    help="discard (по умолчанию) — идеальные сбросы 13 тайлов; "
                         "complete — вероятность и стоимость готовой стартовой "
                         "14-тайловой руки (зеркало evaluateCompleteHand); "
                         "design — дизайн-частоты базы state x tier для пересчёта "
                         "цен K/P; design-complete — дизайн-частоты строки «Готовая рука»; "
                         "yaku — ТОЛЬКО структуры и яку без шантенов/тиров/базы: "
                         "лучший сброс по суммарным очкам (структуры+яку); в разы "
                         "быстрее режима discard, для частот очень редких яку")
    ap.add_argument("--raw", action="store_true",
                    help="только для --mode yaku: свойства считаются на случайных 14 "
                         "тайлах без сброса и без разбиения — чистая частота яку "
                         "(максимальная скорость; дизайн-базис частот)")
    ap.add_argument("--no-greedy", action="store_true",
                    help="только для --mode yaku: не пропускать ДП там, где выбор уже "
                         "решён яку (медленнее; эталон для сверки с --mode yaku)")
    ap.add_argument("--partition-check", metavar="HANDS_JSON",
                    help="прочитать [[13-тайловые counts],...] и вывести очки разбиения")
    a = ap.parse_args()
    print(f"BLAS threads: OPENBLAS_NUM_THREADS={os.environ.get('OPENBLAS_NUM_THREADS')}, "f"OMP_NUM_THREADS={os.environ.get('OMP_NUM_THREADS')}")

    if Path(a.config).resolve() != Path(CONFIG_PATH).resolve():
        # другой конфиг: пересобрать массивы до первого вызова ядер numba
        apply_config(load_config(a.config))
        rebuild_dp_tables()
        rebuild_offsets()
        rebuild_offsets_complete()
        print(f"конфиг: {a.config}")

    if a.partition_check:
        with open(a.partition_check, "r", encoding="utf-8") as f:
            hands = json.load(f)
        NS = N_SUIT_STATES
        pD = np.zeros(10 * NS, np.int64)
        pG = np.zeros(10 * NS, np.int64)
        pCh = np.zeros(10 * NS, np.int64)
        str_cnt = np.zeros(N_STRUCT, np.int64)
        for h, counts in enumerate(hands):
            c = np.array(counts, np.int64)
            for k in range(N_STRUCT):
                str_cnt[k] = 0
            score = partition_v4(c, np.int64(h + 1), pD, pG, pCh, str_cnt)
            print(int(score))
        return

    if not HAVE_NUMBA:
        print("ВНИМАНИЕ: numba не найден — медленный чистый Python "
              "(установите: pip install numba)")

    aka = 0 if a.no_aka else (1 if CFG_RULES.get("akaDora") else 0)
    riichi = 0 if a.no_riichi else int(CFG_RULES.get("riichiHan", 0) or 0)
    ura = 0 if a.no_ura else (1 if CFG_RULES.get("uraDora") else 0)
    complete_bonus = int(CFG_RULES.get("completeBonus", 0))
    os.makedirs(a.out, exist_ok=True)

    if a.mode == "design":
        print(f"Считаем {a.hands:,} дилерских рук (режим: дизайн-частоты базы), "
              f"процессов: {a.workers if not a.quick else 1}")
        S, el = run(a.hands, a.workers, a.seed, a.chunk, a.quick,
                    _worker_design,
                    lambda m, k: (m, a.seed + 7919 * k, riichi, aka, ura),
                    lambda: simulate_design_chunk(1, 0, riichi, aka, ura),
                    4 * N_TIER + 1)
        print(f"время: {el:.1f} c "
              f"({int(S[4 * N_TIER]) / max(el, 1e-9):,.0f} рук/с)")
        write_design_report(S, a.out, riichi, aka, ura)
        return

    if a.mode == "design-complete":
        print(f"Считаем {a.hands:,} дилерских рук (режим: дизайн-частоты готовой руки), "
              f"процессов: {a.workers if not a.quick else 1}")
        S, el = run(a.hands, a.workers, a.seed, a.chunk, a.quick,
                    _worker_design_complete,
                    lambda m, k: (m, a.seed + 7919 * k, riichi, aka, ura),
                    lambda: simulate_design_complete_chunk(1, 0, riichi, aka, ura),
                    N_TIER + 2)
        print(f"время: {el:.1f} c "
              f"({int(S[N_TIER]) / max(el, 1e-9):,.0f} рук/с)")
        write_design_complete_report(S, a.out, riichi, aka, ura)
        return

    if a.mode == "complete":
        n_workers = a.workers if not a.quick else 1
        print(f"Считаем {a.hands:,} дилерских рук (режим: готовая рука, система v4), "
              f"процессов: {n_workers}")
        S, el = run(a.hands, a.workers, a.seed, a.chunk, a.quick,
                    _worker_complete,
                    lambda m, k: (m, a.seed + 7919 * k, riichi, aka, complete_bonus, ura),
                    lambda: simulate_complete_chunk(1, 0, riichi, aka, complete_bonus, ura),
                    STATS_C_SIZE)
        n_deals = int(S[OFFC_N_DEALS])
        n_complete = int(S[OFFC_N_COMPLETE])
        print_complete_report(S, el, riichi, aka, complete_bonus, ura)
        if n_complete:
            median, _ = find_median(S[OFFC_HISTL:OFFC_HISTL + N_HIST_LIN],
                                    S[OFFC_HISTG:OFFC_HISTG + N_HIST_LOG], n_complete)
        else:
            median, _ = 0, True
        make_svg(S[OFFC_HISTL:OFFC_HISTL + N_HIST_LIN],
                 S[OFFC_HISTG:OFFC_HISTG + N_HIST_LOG], max(n_complete, 1),
                 os.path.join(a.out, "score_hist.svg"), median, riichi, aka, ura,
                 title=(f"Готовые стартовые руки: распределение счёта "
                        f"(N = {n_deals:,} дилерских, готовых {n_complete:,}; "
                        f"риичи={'да' if riichi else 'нет'}, "
                        f"ака={'да' if aka else 'нет'}, "
                        f"урадоры={'да' if ura else 'нет'})"))
        write_complete_csv(a.out, S)
        print(f"\nФайлы: {os.path.join(a.out, 'score_hist.svg')}, "
              f"{os.path.join(a.out, 'score_hist.csv')}, "
              f"{os.path.join(a.out, 'components.csv')}")
        return

    if a.mode == "yaku":
        raw = 1 if a.raw else 0
        greedy = 0 if a.no_greedy else 1
        # Безопасная граница суммы структур на 13 тайлах: блоков не больше
        # 13//2 + 1, цена блока не выше максимальной в таблице. Проход 2 можно
        # пропускать для сброса, если он отстаёт от лучшего по яку больше чем на
        # эту границу — такой сброс не может выиграть даже с идеальным разбиением.
        struct_bound = (13 // 2 + 1) * int(STRUCT_PTS.max())
        what = "случайных 14-тайловых рук (свойства без сброса)" if raw else "рук"
        print(f"Считаем {a.hands:,} {what} (режим: только яку, без шантенов), "
              f"процессов: {a.workers if not a.quick else 1}")
        S, el = run(a.hands, a.workers, a.seed, a.chunk, a.quick,
                    _worker_yaku,
                    lambda m, k: (m, a.seed + 7919 * k, raw, greedy, struct_bound),
                    lambda: simulate_yaku_chunk(1, 0, raw, greedy, struct_bound),
                    STATS_SIZE)
        n = int(S[OFF_HANDS])
        print_yaku_report(S, n, el, raw=bool(raw), greedy=bool(greedy))
        median, _ = find_median(S[OFF_HISTL:OFF_HISTL + N_HIST_LIN],
                                S[OFF_HISTG:OFF_HISTG + N_HIST_LOG], n)
        make_svg(S[OFF_HISTL:OFF_HISTL + N_HIST_LIN], S[OFF_HISTG:OFF_HISTG + N_HIST_LOG], n,
                 os.path.join(a.out, "score_hist.svg"), median, riichi, aka, ura=None,
                 title=(f"Режим «только яку» (без шантенов): распределение очков "
                        f"структур+яку (N = {n:,})"))
        write_yaku_csv(a.out, S, n, raw, greedy)
        print(f"\nФайлы: {os.path.join(a.out, 'score_hist.svg')}, "
              f"{os.path.join(a.out, 'score_hist.csv')}, "
              f"{os.path.join(a.out, 'components.csv')}")
        return

    print(f"Считаем {a.hands:,} рук (идеальные сбросы, система v4), "
          f"процессов: {a.workers if not a.quick else 1}")
    S, el = run(a.hands, a.workers, a.seed, a.chunk, a.quick,
                _worker,
                lambda m, k: (m, a.seed + 7919 * k, riichi, aka, ura),
                lambda: simulate_chunk(1, 0, riichi, aka, ura),
                STATS_SIZE)
    n = int(S[OFF_HANDS])
    print_report(S, n, el, riichi, aka, ura)
    median, _ = find_median(S[OFF_HISTL:OFF_HISTL + N_HIST_LIN],
                            S[OFF_HISTG:OFF_HISTG + N_HIST_LOG], n)
    make_svg(S[OFF_HISTL:OFF_HISTL + N_HIST_LIN], S[OFF_HISTG:OFF_HISTG + N_HIST_LOG], n,
             os.path.join(a.out, "score_hist.svg"), median, riichi, aka, ura)
    write_csv(a.out, S, n)
    print(f"\nФайлы: {os.path.join(a.out, 'score_hist.svg')}, "
          f"{os.path.join(a.out, 'score_hist.csv')}, "
          f"{os.path.join(a.out, 'components.csv')}")


if __name__ == "__main__":
    main()
