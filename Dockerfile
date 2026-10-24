# MLZ-Protokoll – Logbuch, Arbeitszeit, Nachweise
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-slim
# ffmpeg: Arbeitskopie der Sprachaufnahme für die Erkennung · openssl: RFC-3161-Zeitstempel · ca-certificates: Prüfung der Zeitstempel
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8090 \
    DATA_DIR=/data \
    TZ=Europe/Berlin \
    WHISPER_URL=http://speaches:8000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
ARG APP_VERSION=
ENV APP_VERSION=$APP_VERSION
EXPOSE 8090
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8090/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "server/index.js"]
