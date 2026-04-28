FROM node:18-bullseye

# Usar usuario predeterminado 'node' (UID 1000 en la imagen oficial)
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate && chown -R node:node /app

RUN apt-get update && apt-get install -y netcat-openbsd && rm -rf /var/lib/apt/lists/*

# Crear directorio de uploads y asignar permisos al usuario node
RUN mkdir -p uploads && chown -R node:node uploads /app

# Cambiar al usuario node
USER node

EXPOSE 3001
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
