$ErrorActionPreference = 'Stop'
$stateDirectory = Join-Path $PSScriptRoot '.public-access'
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$addressPath = Join-Path $stateDirectory 'address.txt'

# Файл блокировки удерживается до завершения запуска и туннеля.
try {
    $launcherLock = [IO.File]::Open(
        (Join-Path $stateDirectory 'launcher.lock'),
        [IO.FileMode]::OpenOrCreate,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
    )
} catch [IO.IOException] {
    # Первый экземпляр может ещё получать публичный адрес.
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-Path $addressPath) {
            $address = (Get-Content $addressPath -Raw).Trim()
            if ($address -match '^https://[a-zA-Z0-9.-]+\.(lhr\.life|localhost\.run)$') {
                Write-Output $address
                if ($env:RSL_NO_BROWSER -ne '1') { Start-Process $address }
                return
            }
        }
        Start-Sleep -Seconds 1
    }
    throw 'Первый запуск ещё не получил адрес. Проверьте первое окно запуска.'
}

try {
$previousAddress = $null
if (Test-Path $addressPath) {
    $previousAddress = (Get-Content $addressPath -Raw).Trim()
    Remove-Item -LiteralPath $addressPath
}
try {
    $response = Invoke-WebRequest 'http://127.0.0.1:8000/hello' -UseBasicParsing -TimeoutSec 3
} catch {
    $python = 'python'
    foreach ($candidate in @((Join-Path $PSScriptRoot '.venv/Scripts/python.exe'), (Join-Path (Split-Path $PSScriptRoot) '.venv/Scripts/python.exe'))) {
        if (Test-Path $candidate) { $python = $candidate; break }
    }
    Start-Process $python -ArgumentList @('-m','uvicorn','mainFastAPI:app','--host','127.0.0.1','--port','8000') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDirectory ("server-" + $PID + ".log")) -RedirectStandardError (Join-Path $stateDirectory ("server-error-" + $PID + ".log")) | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            $response = Invoke-WebRequest 'http://127.0.0.1:8000/hello' -UseBasicParsing -TimeoutSec 2
            $ready = $true
            break
        } catch {}
    }
    if (-not $ready) { throw 'Сервер не запустился. Подробности в папке .public-access' }
}
if ($response.Content.Trim() -ne '"It works!"') { throw 'На порту 8000 другое приложение.' }
# Поддерживаем также туннель, запущенный старой версией скрипта.
if ($previousAddress) {
    $address = $previousAddress
    if ($address -match '^https://[a-zA-Z0-9.-]+\.(lhr\.life|localhost\.run)$') {
        try {
            $check = Invoke-WebRequest ($address + '/hello') -UseBasicParsing -TimeoutSec 8
            if ($check.Content.Trim() -eq '"It works!"') {
                Set-Content $addressPath $address
                Write-Output $address
                if ($env:RSL_NO_BROWSER -ne '1') { Start-Process $address }
                return
            }
        } catch {}
    }
    Remove-Item -LiteralPath $addressPath
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
# Показываем только адрес страницы. Служебный вывод остаётся в файле.
$ErrorActionPreference = 'Continue'
& ssh -T -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityFile=none `
    -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$knownHosts" `
    -o ServerAliveInterval=20 -o ServerAliveCountMax=3 `
    -o ExitOnForwardFailure=yes -R 80:127.0.0.1:8000 nokey@localhost.run -- --output json 2> (Join-Path $stateDirectory ("tunnel-error-" + $PID + ".log")) |
    ForEach-Object {
        $line = [string]$_
        Add-Content (Join-Path $stateDirectory ("tunnel-" + $PID + ".log")) $line
        $match = [regex]::Match($line, 'https://[a-zA-Z0-9.-]+\.(?:lhr\.life|localhost\.run)')
        if ($match.Success -and $match.Value -notmatch 'https://(?:admin\.)?localhost.run') {
            if ($match.Value -ne $lastAddress) {
                $lastAddress = $match.Value
                Set-Content (Join-Path $stateDirectory 'address.txt') $lastAddress
                Write-Output $lastAddress
                if ($env:RSL_NO_BROWSER -ne '1') { Start-Process $lastAddress }
            }
        }
    }
if ($LASTEXITCODE -ne 0) { throw 'Соединение прервано. Подробности в папке .public-access' }
} finally {
    $launcherLock.Dispose()
}
