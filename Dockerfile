# ==========================================
# Stage 1: Build & Compilation Stage
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install all dependencies (needed for compiling TypeScript)
RUN npm install

# Copy application source code
COPY . .

# Build the TypeScript project into dist/
RUN npm run build

# ==========================================
# Stage 2: Production Runner Stage
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Copy package manifests and compiled files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

# Install production-only dependencies to keep the image slim
RUN npm install --omit=dev

# Ensure local uploads directory exists
RUN mkdir -p uploads

# Expose API port
EXPOSE 3001

# Run the API server
CMD ["node", "dist/index.js"]
