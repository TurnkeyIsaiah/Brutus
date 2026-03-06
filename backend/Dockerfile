FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client
RUN npx prisma generate

# Non-root user
RUN addgroup -S brutus && adduser -S brutus -G brutus
USER brutus

EXPOSE 3001

CMD ["node", "src/index.js"]
