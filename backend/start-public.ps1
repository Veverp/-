$ErrorActionPreference = 'Stop'

# Сначала должен быть запущен FastAPI на порту 8000.
$response = Invoke-WebRequest 'http://127.0.0.1:8000/hello' -UseBasicParsing -TimeoutSec 8
if ($response.Content.Trim() -ne '"It works!"') {
    throw 'На порту 8000 запущено другое приложение.'
}

# SSH уже входит в Windows. Данные соединения храним рядом с проектом.
$stateDirectory = Join-Path $PSScriptRoot '.public-access'
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$knownHosts = Join-Path $stateDirectory 'known_hosts'

# Проверяем ключ сервиса по отпечатку из https://localhost.run/docs/security.
# Windows PowerShell 5 считает обычное приветствие SSH сообщением об ошибке.
$ErrorActionPreference = 'Continue'
$keys = & ssh-keyscan -T 10 -t ed25519 localhost.run 2>$null
$ErrorActionPreference = 'Stop'
if (-not $keys) { throw 'Не удалось подключиться к localhost.run.' }
$keys | Set-Content -Encoding ascii $knownHosts
$fingerprint = & ssh-keygen -lf $knownHosts
if ($fingerprint -notmatch 'SHA256:pG6qrBxubYfWa1Zadu/V0NUgjEDiBds/7e2xzte/QNM') {
    throw 'Ключ сервиса изменился. Проверь его по официальной документации.'
}

$knownHosts = $knownHosts.Replace('\', '/')
Write-Host 'Публичная ссылка https://... появится ниже. Передай её другу.'
Write-Host 'Оставь это окно и сервер открытыми. Ctrl+C останавливает туннель.'

& ssh -T -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityFile=none `
    -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$knownHosts" `
    -o ServerAliveInterval=20 -o ServerAliveCountMax=3 `
    -o ExitOnForwardFailure=yes -R 80:127.0.0.1:8000 nokey@localhost.run

if ($LASTEXITCODE -ne 0) { throw 'Туннель отключился. Запусти команду ещё раз.' }
