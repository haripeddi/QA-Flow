# QA Flow backend image
# Playwright base image already includes Node 20, Chromium, system deps, and Python 3.
FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app

# Install backend dependencies first (better layer caching)
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev

# Copy backend source
COPY backend ./backend

# BPMN flows and tags travel with the image (committed to git)
COPY bpmn ./bpmn

# Persistent data lives at /data (mounted as a volume in production)
ENV DATA_DIR=/data
ENV BPMN_DIR=/app/bpmn
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

WORKDIR /app/backend
CMD ["node", "--experimental-strip-types", "src/index.ts"]
