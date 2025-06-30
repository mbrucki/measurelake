# ---- Base Stage ----
# Use a specific Node.js version for reproducibility. Alpine is used for its small size.
FROM node:18-alpine AS base
WORKDIR /usr/src/app
# Copy package files
COPY package*.json ./

# ---- Dependencies Stage ----
# Install production dependencies.
FROM base AS dependencies
RUN npm install --omit=dev

# ---- Release Stage ----
# This is the final image we'll publish.
# It starts from a clean base and copies only the necessary artifacts.
FROM node:18-alpine AS release
WORKDIR /usr/src/app

# Set production environment
ENV NODE_ENV=production

# Copy application code and dependencies from previous stages
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY package.json .
COPY index.js .

# Expose the port the app runs on.
# The actual port is determined by the PORT environment variable (defaults to 8080).
EXPOSE 8080

# The user that will run the application to avoid running as root.
USER node

# Command to run the application.
CMD ["node", "index.js"] 