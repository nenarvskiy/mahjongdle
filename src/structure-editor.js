import {
  PATTERNS, DEFAULT_PATTERN_POINTS, addCustomPattern, removeCustomPatterns,
} from './patterns.js';
import { clearPartitionCache } from './partition.js';

// v2: у структур v4 другие id и цены, старые сохранения применять нельзя.
const STORAGE_KEY = 'mahjongdle-structure-settings-v2';

export function parseStructureNotation(value) {
  const notation = String(value).replace(/\s+/g, '');
  if (!/^\d{2,8}$/.test(notation)) {
    throw new Error('Введите от 2 до 8 цифр');
  }
  const digits = [...notation].map(Number);
  if (digits.some((digit) => digit < 1 || digit > 9)) {
    throw new Error('Допустимы только цифры от 1 до 9');
  }
  for (let i = 1; i < digits.length; i++) {
    if (digits[i] < digits[i - 1]) throw new Error('Тайлы должны идти по возрастанию');
  }
  if (digits.at(-1) - digits[0] > 8) throw new Error('Форма должна помещаться в одну масть');
  return notation;
}

function patternNotation(pattern) {
  return pattern.notation ?? pattern.deltas.map((delta) => delta + 1).join('');
}

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function saveSettings() {
  try {
    const points = Object.fromEntries(PATTERNS.filter((pattern) => !pattern.custom).map(
      (pattern) => [pattern.id, pattern.points],
    ));
    const custom = PATTERNS.filter((pattern) => pattern.custom).map((pattern) => ({
      id: pattern.id,
      label: pattern.label,
      notation: pattern.notation,
      points: pattern.points,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ points, custom }));
  } catch {
    // Игра продолжает работать, даже если хранилище браузера отключено.
  }
}

export function loadStructureSettings() {
  const saved = readSaved();
  if (!saved) return;
  for (const pattern of PATTERNS) {
    const value = Number(saved.points?.[pattern.id]);
    if (Number.isFinite(value) && value >= 0) pattern.points = value;
  }
  removeCustomPatterns();
  for (const item of saved.custom ?? []) {
    try {
      const notation = parseStructureNotation(item.notation);
      const points = Number(item.points);
      if (!item.label?.trim() || !Number.isFinite(points) || points < 0) continue;
      addCustomPattern({ ...item, notation, points });
    } catch {
      // Повреждённая пользовательская форма просто пропускается.
    }
  }
  clearPartitionCache();
}

export function initStructureEditor({ onChange = () => {} } = {}) {
  loadStructureSettings();
  const dialog = document.getElementById('structure-dialog');
  const list = document.getElementById('structure-list');
  const openButton = document.getElementById('btn-structures');
  const closeButton = document.getElementById('btn-structures-close');
  const resetButton = document.getElementById('btn-structures-reset');
  const form = document.getElementById('structure-add-form');
  const error = document.getElementById('structure-error');

  const changed = () => {
    clearPartitionCache();
    saveSettings();
    renderList();
    onChange();
  };

  function renderList() {
    list.innerHTML = '';
    for (const pattern of PATTERNS) {
      const row = document.createElement('div');
      row.className = 'structure-row';

      const info = document.createElement('div');
      info.className = 'structure-info';
      const name = document.createElement('strong');
      name.textContent = pattern.label;
      const notation = document.createElement('span');
      notation.textContent = patternNotation(pattern);
      info.append(name, notation);

      const points = document.createElement('input');
      points.type = 'number';
      points.min = '0';
      points.max = '100000';
      points.step = '1';
      points.value = String(pattern.points);
      points.setAttribute('aria-label', `Очки: ${pattern.label}`);
      points.addEventListener('change', () => {
        const value = Number(points.value);
        if (!Number.isFinite(value) || value < 0) {
          points.value = String(pattern.points);
          return;
        }
        pattern.points = Math.round(value);
        changed();
      });

      row.append(info, points);
      if (pattern.custom) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'structure-remove';
        remove.textContent = 'Удалить';
        remove.addEventListener('click', () => {
          PATTERNS.splice(PATTERNS.indexOf(pattern), 1);
          changed();
        });
        row.append(remove);
      }
      list.append(row);
    }
  }

  openButton.addEventListener('click', () => {
    renderList();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  resetButton.addEventListener('click', () => {
    removeCustomPatterns();
    for (const pattern of PATTERNS) pattern.points = DEFAULT_PATTERN_POINTS[pattern.id];
    changed();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    error.textContent = '';
    const data = new FormData(form);
    try {
      const label = String(data.get('label') ?? '').trim();
      const notation = parseStructureNotation(data.get('notation'));
      const points = Number(data.get('points'));
      if (!label) throw new Error('Укажите название');
      if (!Number.isFinite(points) || points < 0) throw new Error('Укажите корректные очки');
      addCustomPattern({
        id: `custom-${Date.now()}-${PATTERNS.length}`,
        label,
        notation,
        points: Math.round(points),
      });
      form.reset();
      changed();
    } catch (caught) {
      error.textContent = caught.message;
    }
  });

  renderList();
}
