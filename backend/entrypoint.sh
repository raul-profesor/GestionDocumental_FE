#!/bin/sh
set -e

echo "Esperando a que PostgreSQL esté listo..."

# Esperar hasta que el puerto 5432 de db esté accesible
until nc -z db 5432; do
  echo "PostgreSQL no está listo, reintentando en 2 segundos..."
  sleep 2
done

echo "PostgreSQL está listo. Sincronizando esquema..."
npx prisma db push

echo "Iniciando servidor..."
npm start
