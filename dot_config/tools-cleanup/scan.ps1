# Read-only process scan. Never emit command lines or environment values.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not ('CleanupProtection' -as [type])) { Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CleanupProtection {
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessInformation(IntPtr handle, int infoClass, out uint level, uint size);
    public static bool IsAntimalware(int pid) {
        IntPtr handle = OpenProcess(0x1000, false, pid);
        if (handle == IntPtr.Zero) return false;
        try { uint level; return GetProcessInformation(handle, 7, out level, 4) && level == 3; }
        finally { CloseHandle(handle); }
    }
}
'@
}
[Console]::InputEncoding = [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$targets = [Console]::In.ReadToEnd() | ConvertFrom-Json
$hits = New-Object 'System.Collections.Generic.List[object]'
$roots = @{}
foreach ($target in $targets) {
    $roots[$target.id] = [IO.Path]::GetFullPath($target.path).TrimEnd('\').Replace('/', '\') + '\'
}
function Record-Path($value, $processId, $kind, $argument = $false) {
    if (!$value) { return }
    $value = $value.Replace('/', '\')
    foreach ($target in $targets) {
        $prefix = $roots[$target.id]
        $matchesPath = if ($argument) { $value.IndexOf($prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
            else { $value.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) }
        if ($matchesPath) { $hits.Add(@{id=$target.id; pid=[int]$processId; kind=$kind}) }
    }
}
$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$currentSession = [Diagnostics.Process]::GetCurrentProcess().SessionId
foreach ($entry in $processes) {
    # Idle/System and the secure kernel have no user-mode tool installation.
    if ($entry.ProcessId -in @(0, 4)) { continue }
    $unknown = $false
    Record-Path $entry.ExecutablePath $entry.ProcessId 'executable'
    Record-Path $entry.CommandLine $entry.ProcessId 'argument' $true
    # Cleanup manages this user's mise installations. Visible references from
    # any account still protect them, but unrelated system/other-user processes
    # cannot make the entire user's inventory permanently uncleanable.
    # Visible references were already checked for every session. User-mode
    # module inspection is scoped to this interactive session.
    if ($entry.SessionId -ne $currentSession) { continue }
    $process = $null
    try {
        $process = [Diagnostics.Process]::GetProcessById([int]$entry.ProcessId)
        if (!$entry.ExecutablePath -or !$entry.CommandLine) { $unknown = $true }
        foreach ($module in $process.Modules) { Record-Path $module.FileName $entry.ProcessId 'loaded module' }
    } catch {
        # Processes that exited during inspection cannot still use an install.
        if (Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue) { $unknown = $true }
        else { $unknown = $false }
    } finally { if ($process) { $process.Dispose() } }
    if ($unknown) {
        $owner = Invoke-CimMethod -InputObject $entry -MethodName GetOwnerSid -ErrorAction SilentlyContinue
        if ($owner -and $owner.ReturnValue -eq 0 -and $owner.Sid -ne $currentSid) { continue }
        # Windows-enforced Antimalware Light protection identifies trusted AV
        # processes even when Defender deliberately hides their executable and
        # modules. Do not identify them merely by a spoofable process name.
        if ([CleanupProtection]::IsAntimalware([int]$entry.ProcessId)) { continue }
        # An inaccessible process owned by this account remains uncertain.
        foreach ($target in $targets) {
            $hits.Add(@{id=$target.id; pid=[int]$entry.ProcessId; kind='inspection unavailable'})
        }
    }
}
ConvertTo-Json -InputObject @($hits.ToArray()) -Compress
