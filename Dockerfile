# Usar una imagen de Node.js con soporte para compilación (necesario para better-sqlite3)
FROM node:20-slim AS builder

# Instalar dependencias necesarias para compilar better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Segunda etapa para una imagen más ligera
FROM node:20-slim

# Instalar librerías de tiempo de ejecución
RUN apt-get update && apt-get install -y \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app /app

# Definir variables de entorno
ENV PORT=3000
ENV DB_PATH=/app/data/inventory.db

# Crear carpeta para la base de datos persistente
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
