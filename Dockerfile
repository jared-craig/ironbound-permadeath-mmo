FROM node:22-bookworm-slim

WORKDIR /app

# Copy application files
COPY package.json ./
COPY src ./src
COPY public ./public

# Ensure persistent SQLite data directory exists and is writable
RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DB_PATH=/app/data/ironbound.sqlite

EXPOSE 3000

CMD ["node", "--no-warnings", "src/index.js"]
