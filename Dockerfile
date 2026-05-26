# Stage 1: Build React Frontend
FROM node:22-alpine AS builder
WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy full source code
COPY . .

# Build Vite client static assets
RUN npm run build

# Stage 2: Create Lean Production Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install git in runner container to support cloning repositories
RUN apk add --no-cache git

# Copy dependency specifications
COPY package*.json ./

# Install only production dependencies (Express, Cors, Dotenv, etc.)
RUN npm ci --only=production

# Copy Express server files
COPY server/ ./server/

# Copy React compiled bundle from builder stage
COPY --from=builder /app/dist ./dist

# Expose backend server port
EXPOSE 5000

# Set start command
CMD ["npm", "start"]
