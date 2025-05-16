FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy server code
COPY src ./src
COPY data ./data

# Copy built frontend
COPY dashboard/build ./dashboard/build

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose the port
EXPOSE 8080

# Start the server
CMD ["node", "src/server.js"] 