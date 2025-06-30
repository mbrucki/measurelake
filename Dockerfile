# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy application dependency files to the container.
COPY package*.json ./

# Install production dependencies.
RUN npm install --omit=dev

# Copy local code to the container.
COPY . .

# Expose the port the app runs on.
EXPOSE 8080

# Run the web service on container startup.
CMD [ "node", "index.js" ] 