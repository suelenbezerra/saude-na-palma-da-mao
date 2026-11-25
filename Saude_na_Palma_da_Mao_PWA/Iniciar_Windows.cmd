@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 24 ou superior pelo site oficial nodejs.org.
  pause
  exit /b 1
)
echo Abra no navegador: http://localhost:4173
echo Mantenha esta janela aberta enquanto usar o projeto.
node --env-file-if-exists=.env.local server.cjs
pause
