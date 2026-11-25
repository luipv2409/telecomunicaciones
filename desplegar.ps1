# ==========================================
# TRACE-MIN - Script de Despliegue en 1 Clic
# ==========================================
# Sube tus cambios a GitHub y actualiza japon-server automáticamente

Write-Host "🚀 [1/3] Subiendo cambios a GitHub..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error al hacer git push. Verifica tu conexión a internet o tus credenciales de GitHub." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "`n📥 [2/3] Descargando cambios en japon-server..." -ForegroundColor Cyan
ssh -o BatchMode=yes eliot@japon-server "cd /home/eliot/teleco && git pull origin main"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error en japon-server al hacer git pull." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "`n🔨 [3/3] Reconstruyendo contenedores Docker..." -ForegroundColor Cyan
ssh -o BatchMode=yes eliot@japon-server "cd /home/eliot/teleco && docker compose up -d --build"

Write-Host "`n✅ ¡Despliegue exitoso!" -ForegroundColor Green
Write-Host "🌐 Accede en: https://trace.cybersec7.xyz" -ForegroundColor Yellow
