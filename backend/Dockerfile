FROM node:18-bullseye

# Crear usuario no root
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app

COPY package*.json ./
RUN npm install && chown -R appuser:appuser /app

COPY . .
RUN npx prisma generate && chown -R appuser:appuser /app

RUN apt-get update && apt-get install -y netcat-openbsd && rm -rf /var/lib/apt/lists/*
# Crear directorio de uploads y asignar permisos
RUN mkdir -p uploads && chown -R appuser:appuser uploads

# Cambiar al usuario no root
USER appuser

EXPOSE 3001
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
