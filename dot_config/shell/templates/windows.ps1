# Installed by mise run shell:setup. Windows user environment is inherited.
& {
    $paths = @((Join-Path $env:USERPROFILE 'bin'), (Join-Path $env:USERPROFILE '.local/bin'))
    $data = if ($env:MISE_DATA_DIR) { $env:MISE_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'mise' }
    $paths += Join-Path $data 'shims'
    $seen = @{}
    $env:Path = (@($paths | Where-Object { Test-Path -LiteralPath $_ -PathType Container }) + @($env:Path -split ';') | Where-Object {
        if (!$_) { return $false }
        $key = $_.TrimEnd('\').ToLowerInvariant()
        if ($seen.ContainsKey($key)) { return $false }
        $seen[$key] = $true
        return $true
    }) -join ';'
}
if (!$global:__my_opencode_windows_initialized) {
    $global:__my_opencode_windows_initialized = $true
    if (Get-Command mise -CommandType Application -ErrorAction SilentlyContinue) {
        if ($PSVersionTable.PSVersion.Major -ge 6) {
            mise activate pwsh | Out-String | Invoke-Expression
        } else {
            mise activate powershell | Out-String | Invoke-Expression
        }
    }
    if (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.config/shell/local.ps1') -PathType Leaf) {
        . (Join-Path $env:USERPROFILE '.config/shell/local.ps1')
    }
}
