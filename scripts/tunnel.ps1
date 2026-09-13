# Exposes the local PayeeLock server (http://localhost:4310) on a public Cloudflare quick-tunnel URL.
# No Cloudflare account needed. The URL is random and lives as long as this process does.
# Usage: powershell -File scripts/tunnel.ps1   (run `npm run serve` first)

$ErrorActionPreference = "Stop"
$bin = Join-Path $env:LOCALAPPDATA "payeelock\cloudflared.exe"
if (-not (Test-Path $bin)) {
  New-Item -ItemType Directory -Force (Split-Path $bin) | Out-Null
  Write-Host "Downloading cloudflared..."
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $bin
}
$log = Join-Path $PSScriptRoot "..\.state\tunnel.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
if (Test-Path $log) { Remove-Item $log }
$p = Start-Process -FilePath $bin -ArgumentList "tunnel", "--url", "http://localhost:4310", "--no-autoupdate" -RedirectStandardError $log -WindowStyle Hidden -PassThru
Write-Host "cloudflared pid $($p.Id); waiting for URL..."
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($m) { $url = $m.Matches[0].Value; Write-Host "Public URL: $url"; Set-Content -Path (Join-Path $PSScriptRoot "..\.state\tunnel-url.txt") -Value $url; exit 0 }
}
Write-Host "No URL after 30s; see $log"
exit 1
