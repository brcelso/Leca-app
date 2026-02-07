# Setup Dev Script for Leca (Google + Cloudflare)

Write-Host "--- Iniciando ambiente de desenvolvimento do Leca ---" -ForegroundColor Cyan

# 1. Instalar dependencias se necessario
if (!(Test-Path "node_modules")) {
    Write-Host "[App] Instalando dependencias..." -ForegroundColor Yellow
    npm install
}

if (!(Test-Path "server/node_modules")) {
    Write-Host "[Server] Instalando dependencias..." -ForegroundColor Yellow
    Set-Location server
    npm install
    Set-Location ..
}

# 2. Inicializar Banco de Dados D1 Local
Write-Host "[D1] Inicializando banco local..." -ForegroundColor Yellow
Set-Location server
npx wrangler d1 execute leca-db --local --file=schema.sql --yes
Set-Location ..

# 3. Iniciar Servidores
Write-Host "--- Pronto! Iniciando Leca (App + Server) ---" -ForegroundColor Green
npm run dev:full
