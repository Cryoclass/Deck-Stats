$ErrorActionPreference = 'Continue'
$sp = "C:\Users\ccrepin\AppData\Local\Temp\claude\c--dev-Testhand\fc0e6619-545e-4c32-bffe-ff54b39dd448\scratchpad\audit05"
$out = "$sp\ab-batch-results.jsonl"
if (Test-Path $out) { Remove-Item $out }

function Restore-Snapshot {
  docker stop testhand-audit05-app 2>$null | Out-Null
  docker stop testhand-audit05-app-batch 2>$null | Out-Null
  docker exec testhand-audit05-db psql -U ygo -d postgres -qc "drop database ygo with (force)" -c "create database ygo template ygo_snapshot" | Out-Null
}

function Start-App($variant) {
  if ($variant -eq 'actuel') {
    docker start testhand-audit05-app | Out-Null
    return 'http://testhand-audit05-app:8787'
  }
  $exists = docker ps -a --filter name=^testhand-audit05-app-batch$ --format '{{.Names}}'
  if ($exists) { docker start testhand-audit05-app-batch | Out-Null }
  else { docker run -d --name testhand-audit05-app-batch --label purpose=testhand-audit05 --network testhand-audit05-net -e DATABASE_URL=postgres://ygo:audit05@db:5432/ygo -e NODE_ENV=production -e TRUST_PROXY=1 -e INVITE_CODES=audit05-code -e APP_ORIGIN=http://localhost:8797 testhand-audit05-app:batch | Out-Null }
  return 'http://testhand-audit05-app-batch:8787'
}

foreach ($run in @(@('actuel', 50), @('lot', 50), @('actuel', 75), @('lot', 75), @('lot', 100), @('lot', 250))) {
  $variant = $run[0]; $rate = $run[1]
  Restore-Snapshot
  $base = Start-App $variant
  Start-Sleep -Seconds 4
  $container = if ($variant -eq 'actuel') { 'testhand-audit05-app' } else { 'testhand-audit05-app-batch' }
  $statsJob = Start-Job -ArgumentList $container -ScriptBlock { param($c) Start-Sleep -Seconds 45; docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}}' $c testhand-audit05-db; docker exec testhand-audit05-db psql -U ygo -d ygo -Atc "select coalesce(state,'?') || '=' || count(*) from pg_stat_activity where datname='ygo' and pid <> pg_backend_pid() group by state" }
  $line = docker run --rm --label purpose=testhand-audit05 --network testhand-audit05-net -v "${sp}:/audit" node:22-alpine node /audit/paced.mjs $base $rate 60
  $stats = Receive-Job -Job $statsJob -Wait; Remove-Job $statsJob
  $obj = $line | ConvertFrom-Json
  $obj | Add-Member -NotePropertyName variante -NotePropertyValue $variant
  $obj | Add-Member -NotePropertyName dockerStats -NotePropertyValue ($stats -join ' | ')
  ($obj | ConvertTo-Json -Compress -Depth 6) | Out-File -FilePath $out -Append -Encoding utf8
  "=== {0} à {1} req/s : envoyées {2} en {3} s ; global p50={4} p95={5} p99={6}" -f $variant, $rate, $obj.sent, $obj.seconds, $obj.overall.p50, $obj.overall.p95, $obj.overall.p99
  foreach ($r in $obj.rows) { "   {0,-32} n={1,-5} p50={2,-6} p95={3,-6} p99={4,-6} err={5}" -f $r.label, $r.n, $r.p50, $r.p95, $r.p99, $r.err }
  "   " + ($stats -join ' | ')
}
Restore-Snapshot
"FIN"
