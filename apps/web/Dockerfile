FROM node:24.21.0-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY --chown=node:node . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
# Listens on all interfaces inside the container network namespace only;
# host exposure is controlled by compose.yaml (host loopback only).
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
