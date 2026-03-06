FROM node:20-alpine

# Prisma requires OpenSSL on Alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Install ALL deps (including prisma CLI devDep needed for generate)
COPY package*.json ./
RUN npm ci

# Copy source
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client while prisma CLI is still available
RUN npx prisma generate

# Prune devDependencies to slim the image
RUN npm prune --omit=dev

# Create non-root user and fix ownership before switching
RUN addgroup -S brutus && adduser -S brutus -G brutus && chown -R brutus:brutus /app
USER brutus

EXPOSE 3001

CMD ["node", "src/index.js"]
