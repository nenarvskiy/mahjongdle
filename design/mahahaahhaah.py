#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Статистика потенциальной стоимости стартовых рук в риичи-маджонге.

Для случайной стартовой руки (14 тайлов) + случайный индикатор доры + ветер раунда
и ветер игрока считается:
  * шантен руки (после лучшего сброса): интересуют только 2-шантен, 1-шантен, тенпай;
  * лучшая по хану закрытая рука, в которую можно прийти ровно за (шантен + 1) добираемых
    тайлов (т.е. за минимально возможное число добора; тайлы можно менять по пути);
  * категория этой руки: обычная (<5 хан), манган, ханеман, байман, санбайман, якуман.

Как это работает (кратко)
-------------------------
Победная рука W (14 тайлов) достижима из руки H, если нужно добрать
cost = 14 - |W ∩ H| тайлов. Шантен = (минимальный cost) - 1. Поэтому вместо отдельной
функции шантена делается ОДИН перебор с отсечением: обходим все победные руки
(4 группы + пара, чиитойцу, кокуши), у которых cost <= 3, и для каждой считаем хан.
Отсечение: и «недостающих» тайлов, и «лишних» тайлов из руки должно быть <= 3
(их количество всегда совпадает). Это делает перебор очень дешёвым.
Итог по руке = максимум хан среди рук с cost == минимальному.

Допущения (всё настраивается флагами ниже/в CLI)
-------------------------------------------------
* Рука закрытая. По умолчанию есть риичи (+1) и цумо (+1), т.к. рука добирается тайлами
  из стены (закрытые триплеты остаются закрытыми). Отключается --no-riichi / --no-tsumo.
* Фу не считаются. Пинфу проверяется по условиям: 4 последовательности, пара не якухай,
  выигрышный (добранный!) тайл закрывает двустороннее ожидание.
* Манган = ровно 5 хан. Меньше 5 хан = «обычная» (по очкам не различаем).
  6-7 ханеман, 8-10 байман, 11-12 санбайман, 13+ (или яку-ман) якуман.
* Дора: один индикатор, его копия выбывает из стены (не может быть добрана).
  Дора добавляет хан за каждый такой тайл в итоговой руке. Ура, ака, иппацу — нет.
* Якухай: драконы, ветер раунда (восток/юг), ветер игрока (любой из 4); двойной ветер = 2 хан.
* Доступность тайлов учитывается: нельзя добрать тайл, все копии которого уже в руке/индикаторе
  (мёртвое ожидание). Поэтому шантен в очень редких случаях на 1 больше «учебного».
  Уже собранная 14-тайловая рука (тенхо, ~1e-6) относится к тенпаю.
* Каны не рассматриваются (санканцу/сууканцу, риншан, чанкан не учитываются),
  ситуативные яку (хайтей/хотей, тенхо/тихо) тоже.

Яку (закрытая рука):
  1 хан : риичи, менцумо, пинфу, тан'яо, иипейко, якухай (дракон/ветер раунда/ветер игрока)
  2 хан : чиитойцу, сансёку доджюн, иккицукан, чанта, тойтой, сананко, сансёку доккоу,
          хонрото, сёсанген
  3 хан : рянпейко, дзюнчан, хоницу
  6 хан : чиницу
  яку-ман: кокуши, суанко, дайсанген, сёсуси, дайсуси, цуисо, чинрото, рюисо, тюренпото

Ускорение: если установлен numba (pip install numba), всё компилируется в машинный код
(миллион рук за десятки секунд на одном ядре) + multiprocessing по всем ядрам.
Без numba код работает, но в десятки-сотни раз медленнее.

Два режима (аргумент mode в начале: shanten / yaku)
----------------------------------------------------
* shanten (по умолчанию) — исходный: раскладка шантен × категория лучшей руки.
* yaku — структуры и яку. Структуры и «локальные» яку засчитываются, если они
  есть среди 14 тайлов (на сброс не смотрим). Тан'яо/хонрото/хоницу/чиницу
  засчитываются, если можно сбросить ОДИН тайл так, чтобы условие выполнялось
  (т.е. в руке не более одного «лишнего» тайла для этого условия).
  «Ценный» тайл = дракон + ветер раунда + ветер игрока.
"""
import argparse
import multiprocessing as mp
import os
import time

import numpy as np

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

# индексы в массиве параметров par
P_DORA, P_RW, P_SW, P_RIICHI, P_TSUMO = 0, 1, 2, 3, 4

# ---------------------------------------------------------------- подсчёт хана

@njit
def eval_regular(trip, seq, pair, W, H, par):
    """Хан обычной руки (4 группы + пара). trip[i]=1 если триплет из тайла i,
    seq[i]=число последовательностей, начинающихся с i, pair - тайл пары.
    Возвращает: -1 нет яку, иначе хан (яку-ман = 13)."""
    rw = par[P_RW]
    sw = par[P_SW]
    ntrip = 0
    nseq = 0
    for i in range(34):
        ntrip += trip[i]
        nseq += seq[i]

    # ------- какие масти/хонорные тайлы есть в руке
    suit_tiles = np.zeros(3, np.int64)
    honors = 0
    has_th = False
    only_term = True   # только терминалы (нет хонор и нет простых)
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

    # ------- яку-маны
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

    # ------- обычные яку
    han = 0
    if par[P_RIICHI] == 1:
        han += 1
    if par[P_TSUMO] == 1:
        han += 1

    # пинфу
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
                    if W[s] > H[s] and r <= 5:            # ждали s и s+3
                        wait_ok = True
                    if W[s + 2] > H[s + 2] and r >= 1:    # ждали s-1 и s+2
                        wait_ok = True
            if wait_ok:
                han += 1

    # иипейко / рянпейко
    pk = 0
    for s in range(27):
        pk += seq[s] // 2
    if pk >= 2:
        han += 3
    elif pk == 1:
        han += 1

    # якухай
    han += trip[31] + trip[32] + trip[33]
    han += trip[rw]
    han += trip[sw]

    # тан'яо
    if not has_th:
        han += 1

    # сансёку доджюн, иккицукан
    for r in range(7):
        if seq[r] > 0 and seq[9 + r] > 0 and seq[18 + r] > 0:
            han += 2
            break
    for b in (0, 9, 18):
        if seq[b] > 0 and seq[b + 3] > 0 and seq[b + 6] > 0:
            han += 2
            break

    # чанта / дзюнчан / хонрото
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

    # тойтой, сананко
    if nseq == 0:
        han += 2
    if ntrip >= 3:
        han += 2

    # сансёку доккоу
    for r in range(9):
        if trip[r] == 1 and trip[9 + r] == 1 and trip[18 + r] == 1:
            han += 2
            break

    # сёсанген
    if trip[31] + trip[32] + trip[33] == 2 and pair >= 31:
        han += 2

    # хоницу / чиницу
    nsuits = 0
    for s in range(3):
        if suit_tiles[s] > 0:
            nsuits += 1
    if nsuits == 1:
        if honors > 0:
            han += 3
        else:
            han += 6

    if han == 0:
        return -1
    return han + W[par[P_DORA]]


@njit
def eval_chiitoi(W, par):
    han = 2
    if par[P_RIICHI] == 1:
        han += 1
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
        return 13                        # цуисо (7 пар хонор)
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
    return han + W[par[P_DORA]]

# ---------------------------------------------------------------- перебор

@njit
def dfs(i, ml, pl, cost, waste, H, maxc, iso, W, trip, seq, pairp, best, par):
    """Слева направо по тайлам: на тайле i решаем, сколько групп с него начинается
    (триплет 0/1, пара 0/1, последовательностей q). W - счётчики итоговой руки.
    cost  - сколько тайлов придётся добрать (в уже зафиксированных позициях),
    waste - сколько тайлов из руки не пошло в дело. Обе величины только растут,
    в конце они совпадают, поэтому обрезаем по любой из них."""
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
                        if nc <= LIM and nw <= LIM and nc + nw + iso[i + 3] <= 2 * LIM:
                            nml = ml - t - q
                            npl = pl - p
                            trip[i] = t
                            seq[i] = q
                            if p == 1:
                                pairp[0] = i
                            if nml == 0 and npl == 0:
                                # все группы выставлены; учитываем «хвост» j=i+1,i+2
                                lc = nc
                                for j in range(i + 1, i + 3):
                                    if j < 34:
                                        cc = W[j] if W[j] < H[j] else H[j]
                                        lc += W[j] - cc
                                if lc <= LIM:
                                    han = eval_regular(trip, seq, pairp[0], W, H, par)
                                    if han > best[lc]:
                                        best[lc] = han
                            elif i < 33:
                                dfs(i + 1, nml, npl, nc, nw, H, maxc, iso, W,
                                    trip, seq, pairp, best, par)
                            trip[i] = 0
                            seq[i] = 0
                    if added > 0:
                        W[i] -= added
                        W[i + 1] -= added
                        W[i + 2] -= added
                W[i] -= 2 * p
        W[i] -= 3 * t


@njit
def chiitoi_dfs(i, chosen, cost, waste, H, sufH, W, best, par):
    if chosen == 7:
        if waste + sufH[i] <= LIM:
            han = eval_chiitoi(W, par)
            if han > best[cost]:
                best[cost] = han
        return
    if i >= 34 or 34 - i < 7 - chosen:
        return
    cov = H[i] if H[i] < 2 else 2
    nc = cost + 2 - cov
    nw = waste + H[i] - cov
    if nc <= LIM and nw <= LIM:
        W[i] = 2
        chiitoi_dfs(i + 1, chosen + 1, nc, nw, H, sufH, W, best, par)
        W[i] = 0
    nw = waste + H[i]
    if nw <= LIM:
        chiitoi_dfs(i + 1, chosen, cost, nw, H, sufH, W, best, par)


@njit
def analyze(H, ind, rw, sw, riichi, tsumo, maxc, sufH, iso, W, trip, seq, pairp, best, par):
    """Возвращает (шантен 0..2, хан) или (-1, 0), если шантен >= 3."""
    par[P_DORA] = DORA_NEXT[ind]
    par[P_RW] = rw
    par[P_SW] = sw
    par[P_RIICHI] = riichi
    par[P_TSUMO] = tsumo
    for k in range(34):
        maxc[k] = 4
    maxc[ind] = 3                     # одна копия индикатора не в стене
    for k in range(37):
        sufH[k] = 0
    for k in range(33, -1, -1):
        sufH[k] = sufH[k + 1] + H[k]
    for k in range(LIM + 1):
        best[k] = -2                  # -2: рук с таким cost нет; -1: рука есть, но без яку

    # iso[k] = число «одиноких» тайлов (один экземпляр, нет соседей в масти на ±2)
    # на позициях >= k. Каждый такой тайл стоит минимум 1 лишнего или 1 добранного
    # тайла, поэтому cost + waste >= iso  =>  можно резать перебор.
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
        dfs(0, 4, 1, 0, 0, H, maxc, iso, W, trip, seq, pairp, best, par)
    # чиитойцу: быстрая нижняя оценка cost (7 разных пар, сначала пары, потом одиночки)
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
    if 14 - 2 * p7 - singles <= LIM:
        chiitoi_dfs(0, 0, 0, 0, H, sufH, W, best, par)

    # кокуши
    kinds = 0
    has_pair = 0
    for k in range(13):
        c = H[TERM13[k]]
        if c > 0:
            kinds += 1
        if c >= 2:
            has_pair = 1
    kc = 14 - kinds - has_pair
    if kc <= LIM and 13 > best[kc]:
        best[kc] = 13

    for c in range(LIM + 1):
        if best[c] > -2:
            s = c - 1
            if s < 0:
                s = 0                 # рука уже собрана (тенхо): относим к тенпаю
            return s, best[c]
    return -1, 0


@njit
def han_category(han):
    """0 нет яку, 1 обычная (<5), 2 манган, 3 ханеман, 4 байман, 5 санбайман, 6 якуман"""
    if han < 0:
        return 0
    if han < 5:
        return 1
    if han == 5:
        return 2
    if han < 8:
        return 3
    if han < 11:
        return 4
    if han < 13:
        return 5
    return 6

# ---------------------------------------------------------------- режим 2: структуры и яку

# Индексы событий в массиве счётчиков
E_PAIR, E_PON, E_KAN = 0, 1, 2
E_CHI, E_SEQ4, E_SEQ5 = 3, 4, 5
E_KANCHAN, E_RYAMEN, E_PENCHAN = 6, 7, 8
E_S334, E_S246, E_S3334, E_S1122 = 9, 10, 11, 12
E_IPEIKOU, E_ITTSU, E_SDOJUN, E_SDOKO = 13, 14, 15, 16
E_SANANKO, E_SHOUSANGEN = 17, 18
E_VTILE, E_VPAIR, E_VTRIP = 19, 20, 21
E_TANYAO, E_HONRO, E_HONITSU, E_CHINITSU = 22, 23, 24, 25
NEVENTS = 26

# (название, тип): структуры/яку — «есть среди 14», yaku* — «после одного сброса»
EVENTS = [
    ("пара (любая)", "структура"),
    ("пон (любой)", "структура"),
    ("кан (любой)", "структура"),
    ("234 (чи)", "структура"),
    ("2345 (4 подряд)", "структура"),
    ("23456 (5 подряд)", "структура"),
    ("13 (канчан)", "структура"),
    ("34 (ryanmen)", "структура"),
    ("12 (пенчан)", "структура"),
    ("334 (пара+сосед)", "структура"),
    ("246 (двойной канчан)", "структура"),
    ("3334 (пон+сосед)", "структура"),
    ("1122 (2 пары подряд)", "структура"),
    ("иппейко (2 одинаковых ряда)", "яку"),
    ("итсу (123456789)", "яку"),
    ("сансёку додзюн", "яку"),
    ("сансёку доккоу", "яку"),
    ("сананко (3+ пон)", "яку"),
    ("сёсанген (2 дракона+пара)", "яку"),
    ("1 ценный тайл", "яку"),
    ("пара ценных", "яку"),
    ("пон ценного (якухай)", "яку"),
    ("тан'яо (после сброса)", "yaku*"),
    ("хонрото (после сброса)", "yaku*"),
    ("хоницу (после сброса)", "yaku*"),
    ("чиницу (после сброса)", "yaku*"),
]


@njit
def count_events(H, rw, sw, C):
    """Одна 14-тайловая рука H -> приращение счётчиков C[NEVENTS].
    Структуры/локальные яку: если есть среди 14 тайлов (сброс не смотрим).
    тан'яо/хонрото/хоницу/чиницу: если можно сбросить один тайл так,
    чтобы условие выполнилось (не более одного «лишнего» тайла)."""
    has_pair = 0
    has_pon = 0
    has_kan = 0
    npon = 0
    n_th = 0
    honors = 0
    s0 = 0
    s1 = 0
    s2 = 0
    for i in range(34):
        c = H[i]
        if c == 0:
            continue
        if c >= 2:
            has_pair = 1
        if c >= 3:
            has_pon = 1
            npon += 1
        if c >= 4:
            has_kan = 1
        if i >= 27:
            honors += c
        elif i < 9:
            s0 += c
        elif i < 18:
            s1 += c
        else:
            s2 += c
        if TH[i] == 1:
            n_th += c
    C[E_PAIR] += has_pair
    C[E_PON] += has_pon
    C[E_KAN] += has_kan
    if npon >= 3:
        C[E_SANANKO] += 1
    if n_th <= 1:
        C[E_TANYAO] += 1
    if 14 - n_th <= 1:
        C[E_HONRO] += 1
    ms = s0
    if s1 > ms:
        ms = s1
    if s2 > ms:
        ms = s2
    if ms >= 13:
        C[E_CHINITSU] += 1
    if ms >= 1 and 14 - honors - ms <= 1:
        C[E_HONITSU] += 1
    f_chi = 0
    f_seq4 = 0
    f_seq5 = 0
    f_kan = 0
    f_rya = 0
    f_pen = 0
    f334 = 0
    f246 = 0
    f3334 = 0
    f1122 = 0
    f_iik = 0
    f_it = 0
    for b in (0, 9, 18):
        it = 1
        for p in range(9):
            if H[b + p] == 0:
                it = 0
        if it:
            f_it = 1
        for p in range(7):
            if H[b + p] > 0 and H[b + p + 1] > 0 and H[b + p + 2] > 0:
                f_chi = 1
        for p in range(6):
            if (H[b + p] > 0 and H[b + p + 1] > 0 and H[b + p + 2] > 0
                    and H[b + p + 3] > 0):
                f_seq4 = 1
        for p in range(5):
            if (H[b + p] > 0 and H[b + p + 1] > 0 and H[b + p + 2] > 0
                    and H[b + p + 3] > 0 and H[b + p + 4] > 0):
                f_seq5 = 1
        for p in range(7):
            if H[b + p] > 0 and H[b + p + 2] > 0:
                f_kan = 1
        for p in range(1, 7):
            if H[b + p] > 0 and H[b + p + 1] > 0:
                f_rya = 1
        if (H[b] > 0 and H[b + 1] > 0) or (H[b + 7] > 0 and H[b + 8] > 0):
            f_pen = 1
        for p in range(8):
            if H[b + p] >= 2 and H[b + p + 1] >= 1:
                f334 = 1
        for p in range(5):
            if H[b + p] >= 1 and H[b + p + 2] >= 1 and H[b + p + 4] >= 1:
                f246 = 1
        for p in range(8):
            if H[b + p] >= 3 and H[b + p + 1] >= 1:
                f3334 = 1
        for p in range(8):
            if H[b + p] >= 2 and H[b + p + 1] >= 2:
                f1122 = 1
        for p in range(7):
            if H[b + p] >= 2 and H[b + p + 1] >= 2 and H[b + p + 2] >= 2:
                f_iik = 1
    C[E_CHI] += f_chi
    C[E_SEQ4] += f_seq4
    C[E_SEQ5] += f_seq5
    C[E_KANCHAN] += f_kan
    C[E_RYAMEN] += f_rya
    C[E_PENCHAN] += f_pen
    C[E_S334] += f334
    C[E_S246] += f246
    C[E_S3334] += f3334
    C[E_S1122] += f1122
    C[E_IPEIKOU] += f_iik
    C[E_ITTSU] += f_it
    for p in range(7):
        if (H[p] > 0 and H[p + 1] > 0 and H[p + 2] > 0
                and H[9 + p] > 0 and H[9 + p + 1] > 0 and H[9 + p + 2] > 0
                and H[18 + p] > 0 and H[18 + p + 1] > 0 and H[18 + p + 2] > 0):
            C[E_SDOJUN] += 1
            break
    for r in range(9):
        if H[r] >= 3 and H[9 + r] >= 3 and H[18 + r] >= 3:
            C[E_SDOKO] += 1
            break
    # сёсанген: два драконьих пон + пара третьего (пара может быть 2 или 3)
    if ((H[31] >= 3 and H[32] >= 3 and H[33] >= 2)
            or (H[31] >= 3 and H[33] >= 3 and H[32] >= 2)
            or (H[32] >= 3 and H[33] >= 3 and H[31] >= 2)):
        C[E_SHOUSANGEN] += 1
    # ценные: драконы + ветер раунда + ветер игрока (rw/sw могут совпадать)
    vt = 0
    vp = 0
    vtr = 0
    for k in (31, 32, 33, rw, sw):
        c = H[k]
        if c >= 1:
            vt = 1
        if c >= 2:
            vp = 1
        if c >= 3:
            vtr = 1
    C[E_VTILE] += vt
    C[E_VPAIR] += vp
    C[E_VTRIP] += vtr


@njit
def simulate_yaku_chunk(n, seed, fixed_rw, fixed_sw):
    """n случайных стартовых рук, режим 2. Возвращает счётчики [NEVENTS]."""
    np.random.seed(seed)
    C = np.zeros(NEVENTS, np.int64)
    deck = np.empty(136, np.int64)
    for k in range(136):
        deck[k] = k // 4
    H = np.zeros(34, np.int64)
    for _ in range(n):
        for k in range(15):                       # частичная перетасовка Фишера-Йетса
            j = k + np.random.randint(0, 136 - k)
            tmp = deck[k]
            deck[k] = deck[j]
            deck[j] = tmp
        for k in range(34):
            H[k] = 0
        for k in range(14):
            H[deck[k]] += 1
        rw = fixed_rw if fixed_rw >= 0 else 27 + np.random.randint(0, 2)
        sw = fixed_sw if fixed_sw >= 0 else 27 + np.random.randint(0, 4)
        count_events(H, rw, sw, C)
    return C


def _worker_yaku(args):
    return simulate_yaku_chunk(*args)


@njit
def simulate_chunk(n, seed, riichi, tsumo, fixed_rw, fixed_sw):
    """n случайных стартовых рук. fixed_rw/fixed_sw: 27..30 или -1 (случайно).
    Возвращает таблицу res[шантен 0..2][категория 0..6]."""
    np.random.seed(seed)
    res = np.zeros((3, 7), np.int64)
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
    best = np.zeros(LIM + 1, np.int64)
    par = np.zeros(5, np.int64)
    for _ in range(n):
        for k in range(15):                       # частичная перетасовка Фишера-Йетса
            j = k + np.random.randint(0, 136 - k)
            tmp = deck[k]
            deck[k] = deck[j]
            deck[j] = tmp
        for k in range(34):
            H[k] = 0
        for k in range(14):
            H[deck[k]] += 1
        ind = deck[14]                            # индикатор доры
        rw = fixed_rw if fixed_rw >= 0 else 27 + np.random.randint(0, 2)
        sw = fixed_sw if fixed_sw >= 0 else 27 + np.random.randint(0, 4)
        s, han = analyze(H, ind, rw, sw, riichi, tsumo, maxc, sufH, iso, W, trip, seq,
                         pairp, best, par)
        if s >= 0:
            res[s, han_category(han)] += 1
    return res

# ---------------------------------------------------------------- запуск

def _worker(args):
    return simulate_chunk(*args)


CAT_NAMES = ["Нет яку", "Обычная (<5 хан)", "Манган (5)", "Ханеман (6-7)",
             "Байман (8-10)", "Санбайман (11-12)", "Якуман (13+)"]
SH_NAMES = {2: "2-шантен", 1: "1-шантен", 0: "Тенпай"}


def print_progress(done_chunks, chunk, n_total, t0):
    """Отображаемый счётчик: сколько рук проанализировано."""
    hands = min(n_total, done_chunks * chunk)
    el = time.time() - t0
    print(f"\r  проанализировано: {hands:,}/{n_total:,} рук "
          f"({hands / n_total * 100:.1f}%), {el:.0f} с, "
          f"{hands / max(el, 1e-9):,.0f} рук/с", end="", flush=True)


def run(n, workers, seed, riichi, tsumo, rw, sw, chunk):
    simulate_chunk(1, 0, riichi, tsumo, rw, sw)   # прогрев/компиляция до запуска процессов
    chunks = []
    left = n
    k = 0
    while left > 0:
        m = min(chunk, left)
        chunks.append((m, seed + 7919 * k, riichi, tsumo, rw, sw))
        left -= m
        k += 1
    total = np.zeros((3, 7), np.int64)
    done = 0
    t0 = time.time()
    if workers <= 1:
        it = map(_worker, chunks)
        pool = None
    else:
        pool = mp.Pool(workers)
        it = pool.imap_unordered(_worker, chunks)
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


def run_yaku(n, workers, seed, rw, sw, chunk):
    """Режим 2: структуры и яку. Возвращает (счётчики [NEVENTS], время)."""
    simulate_yaku_chunk(1, 0, rw, sw)            # прогрев/компиляция до запуска процессов
    chunks = []
    left = n
    k = 0
    while left > 0:
        m = min(chunk, left)
        chunks.append((m, seed + 7919 * k, rw, sw))
        left -= m
        k += 1
    total = np.zeros(NEVENTS, np.int64)
    done = 0
    t0 = time.time()
    if workers <= 1:
        it = map(_worker_yaku, chunks)
        pool = None
    else:
        pool = mp.Pool(workers)
        it = pool.imap_unordered(_worker_yaku, chunks)
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


def print_report(total, n, elapsed, riichi, tsumo, rw, sw):
    wnames = {27: "восток", 28: "юг", 29: "запад", 30: "север"}
    print("=" * 78)
    print(f"Стартовых рук (14 тайлов): {n:,}   время: {elapsed:.1f} c "
          f"({n / max(elapsed, 1e-9):,.0f} рук/с)")
    print(f"Риичи: {'да' if riichi else 'нет'}, цумо: {'да' if tsumo else 'нет'}, "
          f"ветер раунда: {wnames.get(rw, 'случайный E/S')}, "
          f"ветер игрока: {wnames.get(sw, 'случайный')}")
    print("Шантен - после лучшего сброса; категория - по лучшей руке за (шантен+1) добора.")
    print("=" * 78)
    for s in (2, 1, 0):
        row = total[s]
        cnt = int(row.sum())
        print(f"\n{SH_NAMES[s]}: {cnt:,} рук = {cnt / n * 100:.4f}% от всех")
        if cnt == 0:
            continue
        print(f"  {'Максимум руки':<22}{'Кол-во':>12}{'% внутри':>12}{'% от всех':>12}"
              f"{'накопл. ≥':>12}")
        cum = 0
        cum_from = {}
        for c in range(6, -1, -1):          # накопление «не хуже категории»
            cum += int(row[c])
            cum_from[c] = cum
        for c in range(7):
            if c == 0 and row[0] == 0:
                continue
            v = int(row[c])
            print(f"  {CAT_NAMES[c]:<22}{v:>12,}{v / cnt * 100:>11.3f}%"
                  f"{v / n * 100:>11.4f}%{cum_from[c] / cnt * 100:>11.3f}%")


def print_yaku_report(total, n, elapsed, rw, sw):
    wnames = {27: "восток", 28: "юг", 29: "запад", 30: "север"}
    print("=" * 100)
    print(f"Режим 'yaku / структуры'. Рук (14 тайлов): {n:,}   время: {elapsed:.1f} c "
          f"({n / max(elapsed, 1e-9):,.0f} рук/с)")
    print(f"Ветер раунда: {wnames.get(rw, 'случайный E/S')}, "
          f"ветер игрока: {wnames.get(sw, 'случайный')}")
    print("Структуры и локальные яку — засчитаны, если есть среди 14 тайлов (сброс не учитывается).")
    print("Тан'яо/хонрото/хоницу/чиницу — засчитаны, если одним сбросом условие выполнимо.")
    print("Ценный = драконы + ветер раунда + ветер игрока.")
    print("=" * 100)
    print(f"  {'событие':<30}{'тип':<10}{'кол-во':>14}{'%':>12}{'1 из':>16}")
    for i, (name, kind) in enumerate(EVENTS):
        v = int(total[i])
        once = f"1 из {n // v:,}" if v > 0 else "0 (не встречено)"
        print(f"  {name:<30}{kind:<10}{v:>14,}{v / n * 100:>11.4f}%{once:>16}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("mode", nargs="?", choices=["shanten", "yaku"], default="shanten",
                    help="режим: shanten (по умолчанию, как раньше) или yaku (структуры и яку)")
    ap.add_argument("-n", "--hands", type=int, default=500_000_000)
    ap.add_argument("-w", "--workers", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--seed", type=int, default=12345)
    ap.add_argument("--chunk", type=int, default=50_000, help="рук в одном блоке")
    ap.add_argument("--no-riichi", action="store_true", help="не добавлять хан за риичи")
    ap.add_argument("--no-tsumo", action="store_true", help="не добавлять хан за менцумо")
    ap.add_argument("--round-wind", choices=["E", "S", "W", "N"], help="фикс. ветер раунда")
    ap.add_argument("--seat-wind", choices=["E", "S", "W", "N"], help="фикс. ветер игрока")
    a = ap.parse_args()

    wmap = {"E": 27, "S": 28, "W": 29, "N": 30}
    rw = wmap[a.round_wind] if a.round_wind else -1
    sw = wmap[a.seat_wind] if a.seat_wind else -1
    riichi = 0 if a.no_riichi else 1
    tsumo = 0 if a.no_tsumo else 1

    if not HAVE_NUMBA:
        print("ВНИМАНИЕ: numba не найден - работает медленный чистый Python. "
              "Установите: pip install numba")

    if a.mode == "yaku":
        print(f"Считаем {a.hands:,} рук, режим 'yaku / структуры', процессов: {a.workers}")
        total, el = run_yaku(a.hands, a.workers, a.seed, rw, sw, a.chunk)
        print_yaku_report(total, a.hands, el, rw, sw)
        return

    print(f"Считаем {a.hands:,} рук, процессов: {a.workers}")
    total, el = run(a.hands, a.workers, a.seed, riichi, tsumo, rw, sw, a.chunk)
    print_report(total, a.hands, el, riichi, tsumo, rw, sw)


if __name__ == "__main__":
    main()