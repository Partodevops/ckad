# ---- Lumen web image ----
FROM node:20-alpine

WORKDIR /app

# Install only production deps first (better layer caching)
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# App source
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Basic container healthcheck against the app's health route
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
