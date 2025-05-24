# Use a lightweight Node.js base image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy TypeScript configuration and source code
COPY tsconfig.json ./

COPY bot.ts bot.ts

# Build TypeScript to JavaScript
RUN npm run build

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

# Expose port if your app uses one (adjust as needed)
# EXPOSE 3000

# Health check (optional - adjust endpoint as needed)
# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#   CMD curl -f http://localhost:3000/health || exit 1

# Command to run the bot
CMD ["npm", "start"]
