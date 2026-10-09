#!/bin/sh
set -eu
npx prisma migrate deploy
npm run prisma:seed
node dist/src/main.js
