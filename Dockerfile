# Use a lightweight Node.js base image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json .

# Install dependencies
RUN npm install

# Copy TypeScript configuration and source code
COPY tsconfig.json .
COPY src/ ./src/

# Build TypeScript to JavaScript
RUN npm run build

# Copy .env
COPY .env .

# Create logs directory
RUN mkdir -p logs

# Command to run the bot
CMD ["npm", "start"]