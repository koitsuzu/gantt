# ========== Stage 1: Build frontend ==========
FROM node:20-alpine AS builder

WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ========== Stage 2: Production ==========
FROM node:20-alpine

# Install Python3 for PDF export (generate_pdf.py)
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Install server dependencies
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server source
COPY server/ ./server/

# Copy built frontend
COPY --from=builder /app/client/dist ./client/dist

# Create empty data directory (fresh database on first run)
RUN mkdir -p /app/server/data

# Environment
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

WORKDIR /app/server
CMD ["node", "app.js"]
