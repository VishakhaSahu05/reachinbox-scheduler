# One image for production: builds the dashboard and the API, and the API serves the dashboard.

FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-slim AS backend
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:22-slim
# procps provides `ps`, which concurrently needs to stop its child processes cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends openssl procps && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY --from=backend /app/backend ./
COPY --from=frontend /app/frontend/dist /app/frontend-dist
ENV NODE_ENV=production FRONTEND_DIST=/app/frontend-dist PORT=4000
EXPOSE 4000
# Apply pending migrations, then run the API and the worker. `exec` makes concurrently PID 1 so
# `docker stop` reaches the processes and the worker can finish in-flight sends before exiting.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node_modules/.bin/concurrently -k -n api,worker 'node dist/server.js' 'node dist/worker.js'"]
