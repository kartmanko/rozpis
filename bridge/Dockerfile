# Rovnaký obraz beží na Fly.io aj na naske. Líšia sa iba premennou BRIDGE_ID.
FROM node:20-alpine

WORKDIR /app

# najprv závislosti, nech sa build cachuje
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY index.js ./

# Sem sa ukladá prihlásenie do WhatsAppu (súbory z QR kódu).
# MUSÍ to byť trvalé úložisko, inak sa po každom reštarte pýta QR znova.
ENV AUTH_DIR=/data/auth
VOLUME ["/data"]

CMD ["node", "index.js"]
