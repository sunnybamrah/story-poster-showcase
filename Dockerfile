FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium poppler-utils ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production STORY_POSTER_HOSTED=1 STORY_POSTER_DATA_DIRECTORY=/data STORY_POSTER_GENERATION_ROUTE=subscription STORY_POSTER_CHROME=/usr/bin/chromium
USER node
CMD ["npm", "run", "start:hosted"]
