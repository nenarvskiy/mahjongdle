# Mahjongdle — прод-образ.
#
# Требует build context = КОРЕНЬ репозитория:
#   Root Directory (Render) = пусто, Dockerfile Path = server/Dockerfile
#
# Подпапка server/ внутри образа СОХРАНЯЕТСЯ (/app/server/...). Почему:
#   * server/recalc.js импортирует ../src/scoring.js → из /app/server это /app/src ✔
#   * server/index.js раздаёт статику из HERE/.. = /app, а белый список STATIC_TOP
#     (index.html, styles.css, src, config, assets) лежит именно в /app ✔
# Если сплющить server/ в /app, импорт уйдёт в /src и упадёт с ERR_MODULE_NOT_FOUND.

FROM node:24-alpine

WORKDIR /app

# 1) Зависимости бекенда — в /app/server/node_modules
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev --no-audit --no-fund

# 2) Код бекенда — с сохранением подпапки server/
COPY server ./server

# 3) Общий код и фронтенд — в корень /app (его ждёт STATIC_TOP)
COPY src ./src
COPY config ./config
COPY assets ./assets
COPY index.html styles.css ./

# 4) Каталог под SQLite (подключите Render Disk и задайте DB_FILE)
RUN mkdir -p /app/server/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
