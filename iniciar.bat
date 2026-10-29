@echo off
rem Abre o Dashboard B3 com dois cliques. Fechar esta janela encerra o dashboard.
title Dashboard B3
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Instale o Node.js 24 ou mais novo: https://nodejs.org
  pause
  exit /b 1
)
node scripts\iniciar.mjs
if errorlevel 1 pause
