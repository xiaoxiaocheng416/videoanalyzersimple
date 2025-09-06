# Docker: Node + Python + FFmpeg + yt-dlp
FROM node:18-bullseye-slim

# Base system deps: python3, pip, ffmpeg, certs, and yt-dlp via pip
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
 && pip3 install --no-cache-dir -U yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production deps first (uses package-lock.json for reproducibility)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the rest of the backend source
COPY . .

# Runtime env and port
ENV PORT=5001
EXPOSE 5001

# Start the server
CMD ["node", "server.js"]

