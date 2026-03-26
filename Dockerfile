FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY scripts/ ./scripts/
ARG CACHEBUST=1
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

CMD ["node", "dist/cli.js", "server"]
