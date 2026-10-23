# mahjongdle-server — вход через Google + таблица дня (Node 24, node:sqlite)
FROM node:24-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# data/ — файл SQLite (подключите volume: /app/data)
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
