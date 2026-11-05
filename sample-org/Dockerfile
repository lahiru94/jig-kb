# One image for all sample retailer services; Compose picks the service with SERVICE_ENTRY.
FROM node:22.12-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY platform ./platform
COPY sample-org ./sample-org
RUN npm ci --ignore-scripts
ENV NODE_ENV=production
CMD ["sh", "-c", "npx tsx $SERVICE_ENTRY"]
