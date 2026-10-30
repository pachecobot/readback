#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Instale o Node.js em https://nodejs.org e rode de novo."; read; exit; }
if [ ! -f .env ]; then cp .env.example .env; echo "Abra o arquivo .env, cole suas chaves, salve e rode de novo."; open -e .env; exit; fi
[ -d node_modules ] || { echo "Instalando, só na primeira vez..."; npm install; }
(sleep 2; open http://localhost:3000) &
node server.js
