$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$direcciones = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.InterfaceAlias -notlike 'vEthernet*' -and
        $_.InterfaceAlias -notlike 'WSL*' -and
        $_.InterfaceAlias -notlike '*Loopback*' -and
        $_.InterfaceAlias -notlike '*VirtualBox*' -and
        $_.InterfaceAlias -notlike '*VMware*'
    } |
    Sort-Object -Property InterfaceAlias

$listaIps = @($direcciones | ForEach-Object { $_.IPAddress })
$env:HOST_IPS = ($listaIps -join ',')

Write-Host ''
Write-Host '=== TRACE-MIN: iniciando servidor ===' -ForegroundColor Cyan
docker compose up -d --build

Write-Host ''
Write-Host '=== Servidor listo ===' -ForegroundColor Green
Write-Host 'Panel web en esta PC:  http://localhost:8080'
Write-Host ''
Write-Host 'IPs de esta PC (usa la que corresponda a la red que usa tu celular/ESP32):' -ForegroundColor Yellow
foreach ($d in $direcciones) {
    Write-Host ("  {0,-28} {1}" -f $d.InterfaceAlias, $d.IPAddress)
}
Write-Host ''
Write-Host 'Datos para la APK / ESP32:  IP = (la de arriba)   Puerto = 3001'
Write-Host 'Si el celular no conecta, abre los puertos en el firewall (PowerShell como administrador):'
Write-Host '  New-NetFirewallRule -DisplayName "TRACE-MIN" -Direction Inbound -Protocol TCP -LocalPort 3001,8080,8443 -Action Allow'
Write-Host ''
