# QA Flow backend image
# Playwright base image already includes Node 20, Chromium, system deps, and Python 3.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

# Python Playwright bindings. Browsers already ship in the base image at
# /ms-playwright (PLAYWRIGHT_BROWSERS_PATH is set by the base image), so we do
# NOT re-download them here. pip is not guaranteed to be present on the base
# image, so install it via apt first. Playwright version must match the base
# image's Playwright version.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-pip \
    && python3 -m pip install --no-cache-dir --break-system-packages \
      playwright==1.60.0 \
      pyyaml \
    && rm -rf /var/lib/apt/lists/*

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
