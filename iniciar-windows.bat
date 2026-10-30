@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js em https://nodejs.org e rode de novo. & pause & exit /b)
if not exist .env (copy .env.example .env >nul & echo Abra o arquivo .env, cole suas chaves, salve e rode de novo. & notepad .env & exit /b)
if not exist node_modules (echo Instalando, so na primeira vez... & call npm install)
start "" http://localhost:3000
node server.js
pause
