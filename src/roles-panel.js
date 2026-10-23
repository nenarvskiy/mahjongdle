/**
 * Панель ролей (только admin): списки admin/test по email Google-аккаунтов.
 * Источник правды — server/config/roles.json (сервер), здесь только редактор.
 * player — «не в списках», отдельного списка нет: «убрать» = роль player.
 * Влияние ролей: test и admin получают тестовый режим, admin — эту панель.
 * При следующем логине (или refreshMe на странице) роль применится —
 * без повторного логина, если аккаунт уже вошёл (hot-reload на сервере).
 */
import { fetchRoles, setUserRole } from './auth.js';

export function initRolesPanel() {
  const dialog = document.getElementById('roles-dialog');
  if (!dialog) return;

  const adminList = dialog.querySelector('#roles-admin');
  const testList = dialog.querySelector('#roles-test');
  const adminCount = dialog.querySelector('#roles-admin-count');
  const testCount = dialog.querySelector('#roles-test-count');
  const form = dialog.querySelector('#roles-add-form');
  const emailInput = dialog.querySelector('#roles-email');
  const roleSelect = dialog.querySelector('#roles-role');
  const error = dialog.querySelector('#roles-error');

  document.getElementById('btn-roles').addEventListener('click', () => {
    dialog.showModal();
    refresh();
  });
  dialog.querySelector('#btn-roles-close').addEventListener('click', () => dialog.close());

  function showError(message) {
    error.textContent = message ?? '';
    error.hidden = !message;
  }

  async function refresh() {
    try {
      const { admin, test } = await fetchRoles();
      renderList(adminList, adminCount, admin);
      renderList(testList, testCount, test);
      showError(null);
    } catch (e) {
      showError(e.message);
    }
  }

  function renderList(listEl, countEl, emails) {
    listEl.innerHTML = '';
    countEl.textContent = emails.length;
    for (const email of emails) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = email;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'roles-remove';
      btn.textContent = 'убрать';
      btn.addEventListener('click', async () => {
        try {
          await setUserRole(email, 'player');
          await refresh();
        } catch (e) {
          showError(e.message);
        }
      });
      li.append(span, btn);
      listEl.append(li);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await setUserRole(emailInput.value.trim(), roleSelect.value);
      emailInput.value = '';
      await refresh();
    } catch (err) {
      showError(err.message);
    }
  });
}
