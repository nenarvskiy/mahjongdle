"""Добавить очки за доры в эталонные фикстуры паритета.

Формула (та же, что в игре, src/dora-points.js):

    2^(n-1) * 100, где n — суммарное количество дор в руке:
    обычные доры (по индикатору), ура-доры (по индикатору ура) и красные
    пятёрки — по ОДНОЙ на масть (в игре красная дора считается за вид,
    redFives идёт через Set; в стене по одному красному тайлу на масть,
    поэтому и в руке их не может быть больше одной).

Доры продолжают давать и хан (он влияет на тир базы), поэтому очки добавляются
к expected.total поверх уже посчитанного эталона.

Запускать ПОСЛЕ перегенерации фикстур:

    py stats/tools/gen_v4_reference.py ...   # пересоздаёт v4_eval_cases.json
    py stats/tools/add_dora_points.py        # добавляет очки за доры

Скрипт идемпотентен: кейсы помечаются полем "doraPoints": true и повторно
очки не добавляются.
"""
import json
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
STATS = TOOLS.parent
sys.path.insert(0, str(STATS))

import scorestat as S  # noqa: E402

FIXTURES = STATS / "fixtures"
FILES = ["v4_eval_cases.json", "v4_complete_cases.json"]

WINDS = {"ew": 27, "sw": 28, "ww": 29, "nw": 30}
DRAGONS = {"wd": 31, "gd": 32, "rd": 33}
SUITS = {"m": 0, "p": 9, "s": 18}


def tile_to_index(tile):
    """'1m' -> 0, '0p' -> 13 (красная пятёрка = пятёрка), 'rd' -> 33."""
    if tile in WINDS:
        return WINDS[tile]
    if tile in DRAGONS:
        return DRAGONS[tile]
    if len(tile) != 2:
        return None
    num, suit = tile[0], tile[1]
    if suit not in SUITS:
        return None
    if num == "0":
        num = "5"
    return SUITS[suit] + int(num) - 1


def count_doras(tiles, indicator, ura):
    counts = [0] * 34
    reds = set()  # красные по видам: '0m'/'0p'/'0s' (в игре — Set redFives)
    for tile in tiles:
        idx = tile_to_index(tile)
        if idx is None:
            continue
        counts[idx] += 1
        if tile[0] == "0":
            reds.add(tile)
    n = 0
    if indicator is not None and int(indicator) >= 0:
        n += counts[int(S.DORA_NEXT[int(indicator)])]
    if ura is not None and int(ura) >= 0:
        n += counts[int(S.DORA_NEXT[int(ura)])]
    n += len(reds)
    return n


def dora_points(n):
    return 0 if n <= 0 else 2 ** (n - 1) * 100


def process(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = 0
    skipped = 0
    for case in data:
        expected = case.get("expected") or {}
        if expected.get("doraPoints"):
            skipped += 1
            continue
        n = count_doras(case.get("tiles") or [], case.get("indicator"), case.get("ura"))
        pts = dora_points(n)
        expected["total"] = int(expected.get("total", 0)) + pts
        expected["doraCount"] = n
        expected["doraPoints"] = True
        case["expected"] = expected
        changed += 1
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return len(data), changed, skipped


def main():
    for name in FILES:
        path = FIXTURES / name
        if not path.exists():
            print(f"{name}: нет файла, пропускаю")
            continue
        total, changed, skipped = process(path)
        print(f"{name}: кейсов {total}, обновлено {changed}, уже было {skipped}")


if __name__ == "__main__":
    main()
