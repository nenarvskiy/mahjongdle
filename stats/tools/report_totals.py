#!/usr/bin/env python
"""Суммарные очки по категориям из `components.csv` (одного или нескольких прогонов).

`components.csv` пишет сам `stats/scorestat.py` (ключ `--out`); в нём по каждой
категории есть `count` и `points` — это и есть суммарные очки категории за прогон.
Здесь они складываются по файлам (несколько прогонов с разными `--seed` = один
большой прогон) и печатаются таблицей: категория, рук, сумма очков, доля от всех
очков, EV на раздачу.

Категории (`group`):
  * `base`      — ячейки «состояние × тир» (режим 1: строки 2-сянтэн..тенпай;
                  режим 2: строка «Готовая рука»);
  * `structure` — 13 паттернов (кан, пон, чи, ...);
  * `yaku`      — 13 яку;
  * `type`      — типы готовой руки (стандарт/чиитоицу/кокуши), только режим 2.

Примеры:

    py stats/tools/report_totals.py                      # stats/out/20m
    py stats/tools/report_totals.py stats/out/complete10b
    py stats/tools/report_totals.py stats/out/20m --group base
    py stats/tools/report_totals.py run_a run_b run_c    # сложить три прогона
    py stats/tools/report_totals.py run_a --deals 100000000   # если n_deals не выводится

Оговорка: `points` — это очки КАТЕГОРИИ (сколько всего очков она принесла за все
руки), а не «очки за одну руку». EV на раздачу = points / n_deals, поэтому сумма
EV по всем категориям = средний счёт рук в прогоне (последняя строка таблицы —
проверка: она должна совпасть с «Средний счёт» в `report.txt`).
"""
from __future__ import annotations

import argparse
import csv
import io
import re
import sys
from pathlib import Path

GROUPS = ("base", "structure", "yaku", "type")
GROUP_RU = {
    "base": "база (состояние × тир)",
    "structure": "структуры",
    "yaku": "яку",
    "type": "типы готовой руки",
}


def read_csv(path: Path) -> tuple[list[dict], str]:
    """Читает components.csv (и комментарии-строки '#' — там бывает n_deals)."""
    raw = None
    for enc in ("utf-8-sig", "cp1251"):
        try:
            raw = path.read_text(encoding=enc)
            break
        except UnicodeDecodeError:
            continue
    if raw is None:
        raise SystemExit(f"не удалось прочитать {path} ни в UTF-8, ни в cp1251")
    head = "\n".join(l for l in raw.splitlines() if l.startswith("#"))
    body = "\n".join(l for l in raw.splitlines() if l.strip() and not l.startswith("#"))
    return list(csv.DictReader(io.StringIO(body))), head


def deals_of(path: Path, rows: list[dict], head: str) -> int:
    """Число раздач прогона.

    Сначала точный источник — комментарий соседнего `score_hist.csv`
    (`# score_hist: ... n_deals=...`), потом комментарий самого components.csv,
    и только в крайнем случае оценка из points/ev строк базы (ev в CSV округлён,
    поэтому оценка даёт ~1e-6 относительной погрешности).
    """
    for name in ("score_hist.csv",):
        sib = path.parent / name
        if sib.is_file():
            try:
                txt = sib.read_text(encoding="utf-8-sig", errors="replace")
            except OSError:
                txt = ""
            m = re.search(r"n_deals\s*=\s*(\d+)", txt)
            if m:
                return int(m.group(1))
            # Гистограмма режима 1 идёт по ВСЕМ раздачам (неготовые = 0 очков),
            # поэтому её сумма и есть n_deals; в режиме 2 сумма = готовые руки
            # (меньше, чем ячейки базы), и этот путь не срабатывает.
            counts = sum(int(float(l.split(",")[2]))
                         for l in txt.splitlines()[1:]
                         if l.count(",") >= 2 and l.split(",")[2].strip().isdigit())
            base_counts = sum(float(r["count"] or 0) for r in rows
                              if r.get("group") == "base")
            if counts > base_counts > 0:
                return counts
    m = re.search(r"n_deals\s*=\s*(\d+)", head)
    if m:
        return int(m.group(1))
    for r in rows:
        if r.get("group") != "base":
            continue
        try:
            ev = float(r["ev"])
            pts = float(r["points"])
        except (TypeError, ValueError, KeyError):
            continue
        if ev > 0 and pts > 0:
            return int(round(pts / ev))
    return 0


def collect(paths: list[str], deals_override: int | None):
    """Складывает count/points по (group, name) из всех прогонов."""
    agg: dict[tuple[str, str], dict[str, float]] = {}
    deals = 0
    for item in paths:
        p = Path(item)
        if p.is_dir():
            p = p / "components.csv"
        if not p.is_file():
            raise SystemExit(f"нет файла {p}")
        rows, head = read_csv(p)
        d = deals_of(p, rows, head)
        if deals_override:
            d = deals_override
        if not d:
            raise SystemExit(
                f"{p}: не удалось определить число раздач — задайте --deals")
        deals += d
        for r in rows:
            group = r.get("group")
            if group not in GROUPS:
                continue
            key = (group, r.get("name", "?"))
            slot = agg.setdefault(key, {"count": 0.0, "points": 0.0, "pct_sum": 0.0})
            slot["count"] += float(r["count"] or 0)
            slot["points"] += float(r["points"] or 0)
            slot["pct_sum"] += float(r["pct_hands"] or 0)
        print(f"  + {p}  раздач {d:,}", file=sys.stderr)
    return agg, deals


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="*", default=["stats/out/20m"],
                    help="каталоги прогонов или components.csv (по умолчанию stats/out/20m)")
    ap.add_argument("--group", action="append", choices=GROUPS,
                    help="показать только эти группы (можно несколько)")
    ap.add_argument("--top", type=int, default=0,
                    help="в каждой группе показать только N категорий с максимумом очков")
    ap.add_argument("--deals", type=int, default=0,
                    help="число раздач на прогон, если его не удалось вывести из файла")
    a = ap.parse_args()

    agg, deals = collect(a.paths, a.deals or None)
    if not agg:
        raise SystemExit("в файлах не нашлось ни одной категории")

    grand = sum(v["points"] for v in agg.values())
    groups = a.group or [g for g in GROUPS if any(k[0] == g for k in agg)]

    print(f"\nРаздач: {deals:,}   Всего очков: {grand:,.0f}   "
          f"Средний счёт: {grand / deals:,.4f}")

    print("\nПо группам:")
    print(f"  {'группа':<26}{'категорий':>10}{'очки':>22}{'доля':>9}{'EV/раздачу':>13}")
    for g in GROUPS:
        keys = [k for k in agg if k[0] == g]
        if not keys:
            continue
        pts = sum(agg[k]["points"] for k in keys)
        print(f"  {GROUP_RU[g]:<26}{len(keys):>10}{pts:>22,.0f}"
              f"{pts / grand * 100:>8.2f}%{pts / deals:>13,.3f}")

    for g in groups:
        keys = sorted((k for k in agg if k[0] == g),
                      key=lambda k: -agg[k]["points"])
        if a.top:
            keys = keys[:a.top]
        if not keys:
            continue
        print(f"\n{GROUP_RU[g]}:")
        print(f"  {'категория':<26}{'рук':>16}{'% рук':>10}"
              f"{'очки':>24}{'доля':>9}{'EV/раздачу':>13}")
        for k in keys:
            v = agg[k]
            ev = v["points"] / deals
            print(f"  {k[1]:<26}{v['count']:>16,.0f}{v['count'] / deals * 100:>9.4f}%"
                  f"{v['points']:>24,.0f}{v['points'] / grand * 100:>8.2f}%{ev:>13,.3f}")
    print()


if __name__ == "__main__":
    main()