# MLZ-Protokoll – Logbuch, Arbeitszeit, Nachweise

# Spracherkennung whisper.cpp – gleicher Stand wie in der Video-Zentrale (nur das Programm; Modelle kommen aus /models
# = Ordner der Video-Zentrale oder werden beim ersten Bedarf nach /data/whisper geladen)
FROM node:22-slim AS whisper
RUN apt-get update && apt-get install -y --no-install-recommends git cmake build-essential ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp /src \
 && cmake -S /src -B /src/build -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON \
      -DGGML_OPENMP=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DCMAKE_BUILD_TYPE=Release \
 && cmake --build /src/build -j"$(nproc)" --target whisper-cli

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
    MODEL_DIR=/models
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
COPY --from=whisper /src/build/bin/whisper-cli /usr/local/bin/whisper-cli
ARG APP_VERSION=
ENV APP_VERSION=$APP_VERSION
EXPOSE 8090
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8090/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "server/index.js"]
