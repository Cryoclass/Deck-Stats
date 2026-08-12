# Relance le projet complet : Postgres (Docker) + back Fastify + front Vite.
# Usage : ./start.ps1   (depuis la racine du repo, PowerShell)
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host '==> Postgres (Docker)...' -ForegroundColor Cyan
docker compose up -d | Out-Host

Write-Host '==> Attente du healthcheck DB...' -ForegroundColor Cyan
for ($i = 0; $i -lt 60; $i++) {
    $status = (docker inspect -f '{{.State.Health.Status}}' ygo-proba-db 2>$null)
    if ($status -eq 'healthy') { Write-Host '    DB healthy.' -ForegroundColor Green; break }
    Start-Sleep -Seconds 1
}
if ($status -ne 'healthy') { throw "La DB n'est pas healthy (statut: $status). Voir: docker compose logs db" }

Write-Host '==> Back (:8787) + Front (:5173)...' -ForegroundColor Cyan
Write-Host '    Front : http://localhost:5173  |  Ctrl+C pour tout arreter.' -ForegroundColor DarkGray
npm run dev
