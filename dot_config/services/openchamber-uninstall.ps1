$ErrorActionPreference = 'Stop'

$task = Get-ScheduledTask -TaskPath '\' | Where-Object TaskName -eq 'dev.openchamber.web'
if ($task) {
    Disable-ScheduledTask -InputObject $task | Out-Null
    if ($task.State -eq 'Running') { Stop-ScheduledTask -InputObject $task }
    Unregister-ScheduledTask -InputObject $task -Confirm:$false
}

$dataDir = if ($env:OPENCHAMBER_DATA_DIR) { $env:OPENCHAMBER_DATA_DIR.Trim() }
if (!$dataDir) { $dataDir = Join-Path $HOME '.config/openchamber' }
foreach ($name in @('bin/OpenChamber.ps1', 'startup.env')) {
    $file = Join-Path $dataDir $name
    if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file }
}

$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$servers = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'bun.exe'" | Where-Object {
    $_.CommandLine -match '(?i)[\\/]node_modules[\\/]@openchamber[\\/]web[\\/]build[\\/](?:bin[\\/]cli\.js"?\s+serve|server[\\/]index\.js"?)(?:\s|$)' -and
    (($_.CommandLine -notmatch '\s(?:--port|-p)(?:[=\s])') -or ($_.CommandLine -match '\s(?:--port|-p)(?:[=\s])"?3000"?(?:\s|$)'))
}

foreach ($server in $servers) {
    $owner = Invoke-CimMethod -InputObject $server -MethodName GetOwnerSid
    if ($owner.Sid -eq $currentSid) {
        $process = Get-Process -Id $server.ProcessId -ErrorAction SilentlyContinue
        if ($process -and [Math]::Abs(($process.StartTime - $server.CreationDate).TotalMilliseconds) -lt 1) {
            Stop-Process -InputObject $process -ErrorAction Stop
            if (!$process.WaitForExit(5000)) {
                throw "OpenChamber process $($server.ProcessId) is still running."
            }
        }
    }
}

Write-Output 'OpenChamber startup removed and port 3000 server stopped.'
