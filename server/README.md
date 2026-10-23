# mahjongdle-server

API для [mahjongdle](../README.md): **вход через Google** и **таблица рекордов
дня**. Сервер сам раздаёт и статический фронтенд (один origin, один порт),
поэтому всё можно держать на одной машине — даже без домена (Tailscale
Funnel, см. ниже) — или классически: статика на GitHub Pages/Vercel/Netlify +
API на своём сервере (Render / VPS / Fly / Docker, что угодно, где Node 24+).

## Как это работает

```
Браузер (статика)                        server/
─────────────────                        ─────────
1. Кнопка «Войти через Google»
   (Google Identity Services, popup)
2. Google отдаёт ID-токен (JWT) ────────▶ 3. POST /api/auth/login {idToken}
                                           проверка подписи (JWKS Google),
                                           issuer, audience = client ID
                                           (google-auth-library)
4. ◀────────────────────────────────── {token: сессия JWT 30 дней, user}
5. Сессия в localStorage, заголовок Bearer
6. POST /api/scores {date, score}   ────▶ upsert: лучший на (user, date)
7. GET  /api/scores/:date           ────▶ публичный топ-10 дня
```

* Токен Google проверяется **на сервере** — клиенту доверия нет.
* Сессия — собственный JWT HS256 (node:crypto, без jsonwebtoken), 30 дней.
* База — `node:sqlite` (встроена в Node 24), один файл `data/leaderboard.db`.
  Две таблицы: `users` (id = Google `sub`) и `scores` (PK: user+date).
* На сервере хранится **лучший** результат игрока за день; при равенстве очков
  выше тот, кто записался раньше.
* В таблицу идёт только «рука дня» — та, что сгенерирована кнопкой
  «Сгенерировать руку» (раз в день; до генерации на экране 14 рубашек,
  кнопка затем неактивна до следующего дня, рука хранится в localStorage
  браузера).

## Эндпоинты

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/api/auth/login` | `{idToken}` | `{token, user{id,email,name,picture,role}}` |
| GET | `/api/me` | — | `{user (с role)}` |
| POST | `/api/scores` | `{date, score, discarded?, tiles?}` | `{score, isBest, rank}` |
| GET | `/api/scores/:date?limit=N` | — | `{date, rows:[{id,name,picture,score,discarded}]}` |
| GET | `/api/roles` | — (только admin) | `{admin:[email], test:[email]}` |
| POST | `/api/roles` | `{email, role: admin\|test\|player}` (только admin) | новый файл ролей |
| POST | `/api/events` | `{mode, kind:'hand', payload}` (блок посчитанной руки; анонимы тоже) | `{id}` |
| PATCH | `/api/events/:id` | `{payload}` (пересчёт той же руки; владелец) | `{id, payload}` |
| POST | `/api/events/:id/report` | `{text}` (жалоба к блоку; владелец) | `{id, report}` |
| GET | `/api/events?reports=1&limit=` | — (только admin) | `{rows:[…]}` — новые сначала |
| GET | `/health` | — | `{ok:true}` |

`date` — `YYYY-MM-DD` (день по Москве, тот же, что у фронтенда в
`daily-context.js`). `score` — целое ≥ 0. Все ошибки — JSON `{error}`.

## Роли: admin / test / player

* **player** — по умолчанию: рука дня (1 в день, идёт в таблицу рекордов).
* **test** — + тестовый режим: неограниченные руки и ручные руки
  13/14 тайлов с теми же правилами оценки; **ничего из тестового режима не
  попадает в таблицу, статистику и будущие достижения** — фронтенд в этом
  режиме просто не вызывает `POST /api/scores`.
* **admin** — всё как у test + панель «Роли (admin)» в игре.

Списки — в файле **`server/config/roles.json`** (НЕ в корневом `config/` —
корневой раздаётся браузеру):

```json
{
  "admin": ["вы@example.com"],
  "test": ["тестер@example.com"]
}
```

* Файл перечитывается **на каждый запрос** (hot-reload): владелец правит его
  на сервере — роль применится при следующем входе/опросе, **без рестарта**.
  Роль возвращается в `/api/auth/login` и `/api/me`, а фронтенд при загрузке
  страницы подтягивает актуальную роль (`refreshMe`).
* Управлять списками можно и без SSH: кнопка «Роли (admin)» (только admin) —
  добавление email + роли, «убрать» (= player).
* `player` — это «не в списках», отдельного списка нет.

## Сквозной лог (`events`)

Игра пишет на сервер всё важное (таблица `events` в `data/leaderboard.db`):

* **`hand`** — один блок = одна **посчитанная** рука: тайлы, условия (ветра,
  дора, ура, день), режим (`daily` / `test`) и **счёт с полной разбивкой
  «что за что»** (база, структуры, каждый яку с очками, потенциал).
  Если игрок нажал «Сообщить об ошибке», жалоба лежит в том же блоке
  (`payload.report = {text, ts}`) — отдельной записи-жалобы нет.
  Просто сгенерированная рука без счёта в лог **не пишется** (сервер требует
  `payload.total`), а пересчёт при смене условий/другом сбросе обновляет
  тот же блок (`PATCH`), не создавая новый.

Данные игрока (id/email/имя) сервер подставляет **из своей сессии** —
в теле запроса только игровые данные; анонимные руки логируются с
`user_* = null` («аноним»). `POST /api/events` открыт (в т.ч. анонимам), но ограничен: `mode` ∈
daily/test, `kind` = `hand`, обязателен `payload.total`, размер payload
≤ 20 КБ, rate-limit 60 событий/мин на IP. Правка блока (`PATCH`) и жалоба —
**только владелец** блока (иначе 404). Чтение — `GET /api/events` **только
admin**; `?reports=1` — лишь блоки с жалобами.

Админ смотрит всё в игре: кнопка **«Логи и жалобы»** — карточки с
таймом, игроком, режимом, рукой (тайлами) и разбивкой счёта; жалобы —
с текстом.

## Настройка Google Cloud Console

1. [console.cloud.google.com](https://console.cloud.google.com) → ваш проект
   (или новый).
2. **APIs & Services → OAuth consent screen**:
   * User Type: **External** (Internal — только если у всех аккаунты вашей
     доменной организации).
   * Заполнить приложение: имя (например «Mahjongdle»), email контактный,
     домен.
   * Scopes: **достаточно базовых** (email, profile) — их GIS запрашивает
     сам; добавлять scope не нужно.
   * Пока статус **Testing**, в него могут войти только аккаунты из
     «Test users» (добавьте себя) — и токен живёт 7 дней. Для публичной
     таблицы: **Publish app** (Review app → Publish).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   * Type: **Web application**.
   * **Authorized JavaScript origins** — домены фронтенда:
     * dev: `http://localhost:3000` (или порт локального сервера статики),
     * прод: `https://ваш-домен.github.io`, `https://mahjongdle.example.com`…
   * **Authorized redirect URI** — не нужен (GIS с ID-токеном не редиректит).
   * Скопировать **Client ID** (`...apps.googleusercontent.com`).

## Локальный запуск

Один процесс отдаёт и API, и игру (один origin — CORS не нужен):

```powershell
cd server
npm install

# переменные окружения (или server/.env + node --env-file=.env index.js)
$env:GOOGLE_CLIENT_ID='1234...-abcdefgh.apps.googleusercontent.com'
$env:SESSION_SECRET='длинная-случайная-строка'   # ≥ 16 символов:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$env:PORT='3000'
npm start
```

Открываете **http://localhost:3000** — это сама игра (API:
`http://localhost:3000/health` → `{"ok":true}`). В **`config/auth.json`**
(корень проекта) вписать client ID:

```json
{
  "googleClientId": "1234...-abcdefgh.apps.googleusercontent.com",
  "apiBaseUrl": ""
}
```

Пустой `apiBaseUrl` = API на том же origin, что и игра. После этого в шапке
появится кнопка «Войти через Google», а под результатом — «Таблица дня».
Пока `googleClientId` пустой — функция выключена, игра работает как раньше.

`STATIC_DIR` — каталог фронтенда (по умолчанию корень проекта);
`STATIC_DIR=off` — только API, когда фронтенд раздаётся отдельно
(`npx serve .` в корне): тогда в `config/auth.json` `apiBaseUrl` = адрес
сервера, а `CORS_ORIGINS` = origin фронтенда.

## Публичный сайт без домена (Tailscale Funnel)

Чтобы в игру можно было играть с любого устройства по HTTPS, не покупая домен:

1. Поставить [Tailscale](https://tailscale.com) на машину, где крутится сервер
   (хватает бесплатного личного плана), залогиниться в tailnet.
2. Запустить сервер на порту 3000 (как в «Локальном запуске»).
3. `tailscale funnel 3000` — Tailscale публикует порт по HTTPS на адресе
   `https://<имя-машины>.<ваш-tailnet>.ts.net` (точный адрес — в выводе команды).
4. Этот адрес добавить в **Authorized JavaScript origins** Google Cloud Console.
5. Ссылку передать тестировщикам; `apiBaseUrl` остаётся `""` (один origin).

Ограничения: машина должна быть включена и не уснуть — это тестовый хостинг.
Для постоянного — тот же код на VPS (Oracle/GCP free tier, работает постоянно)
+ Tailscale Funnel: адрес по-прежнему `*.ts.net`, домен не нужен. Кнопка
Google требует HTTPS или localhost — именно это и даёт Funnel; по локальному
IP (`http://192.168.x.x`) кнопка работать не будет.

### Несколько пользователей

Пока статус приложения **Testing**, заходить могут только аккаунты из
«Test users». Чтобы пускались любые люди: **Review app → Publish app** —
с базовыми скоупами (email, profile) они нечувствительные, публикация
проходит мгновенно, без верификации.

## Деплой

### Сервер

Любой хостинг с Node 24+ и постоянным файлом (нужен для SQLite):

* **Render / Fly.io / Railway** — репозиторий + start command
  `npm --prefix server start` (или `cd server && npm start`), переменные
  окружения как выше, volume на `server/data` (Render: Disk).
* **VPS** — systemd / pm2: `pm2 start server/index.js --name mahjongdle`.
* **Docker** — см. `server/Dockerfile`.

Обязательно:

* `SESSION_SECRET` — случайный, не коммитится.
* HTTPS (Render/VPS — через TLS-сертификат; фронтенд на https не будет
  ходить на http-API; Tailscale Funnel — HTTPS из коробки).
* Origin, на котором открыта игра, добавить в Google Cloud Console
  **Authorized JavaScript origins** (домен / `*.ts.net` / `http://localhost:3000`).
* `CORS_ORIGINS` — только если фронтенд раздаётся отдельно от сервера
  (`STATIC_DIR=off`); при общем origin он не нужен.
* `config/roles.json` — файл списков ролей. На хостинге с эфемерным диском
  (Render без volume) правки «панелью ролей» живут, пока жив контейнер:
  положите `server/config` на volume рядом с `server/data` либо держите
  списки в репозитории/секретах и копируйте файл при деплое.

### Фронтенд (статика)

* **GitHub Pages** — опубликовать корень репозитория (actions или
  Settings → Pages). В `config/auth.json`: `apiBaseUrl` = URL сервера,
  `googleClientId` = client ID; домен Pages добавить в authorized origins.
* **Vercel / Netlify** — import репозитория, build command не нужен
  (pure static), publish directory = корень.

> Альтернатива «своему серверу»: тот же код легко превратить в serverless
> функцию Vercel/Netlify, но SQLite там не подойдёт (нужна Postgres/Supabase)
> — это уже другой вариант, здесь он не поддерживается.

## Тесты

```powershell
node --test test/server.test.js   # 11 тестов: вход, сессии, валидация, ранги, CORS, роли, лог
node --test                       # весь проект (игра + сервер)
```

В тестах Google подменяется заглушкой (сеть не нужна). Реальная проверка
`google-auth-library` (JWKS) происходит на живом сервере: поддельный
ID-токен получает 401.

## Файлы

```
server/
  index.js      — точка входа (env, БД, listen)
  app.js        — фабрика приложения: маршруты, CORS, валидация
  auth.js       — сессионный JWT HS256 (node:crypto)
  google.js     — проверка Google ID-токена (google-auth-library)
  db.js         — node:sqlite: users, scores (лучший на день), топ-10, events (лог)
  roles.js      — роли admin/test/player: файл config/roles.json, hot-reload
  config/       — roles.json (списки email; НЕ раздаётся статикой)
  package.json  — зависимости: express, google-auth-library
  .env.example  — шаблон переменных окружения
  Dockerfile    — образ для деплоя
  data/         — leaderboard.db (создаётся автоматически, в .gitignore)
```
