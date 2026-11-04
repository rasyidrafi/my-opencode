import { spawnSync } from 'node:child_process';

const encode = script => Buffer.from(script, 'utf16le').toString('base64');

export function powershell(script, input, operation = 'user environment', execute = spawnSync) {
  const prelude = "$ErrorActionPreference = 'Stop'; [Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false);\n";
  const result = execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(prelude + script)], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.code ?? `exit ${result.status}`;
    throw new Error(`Windows ${operation} update failed (${reason}); no secret output was printed.`);
  }
}

export function saveWindowsEnvironment(environment, retired = [], execute = spawnSync) {
  powershell(`
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    # .NET's User setter broadcasts WM_SETTINGCHANGE for every value. Hung
    # desktop windows can turn a small batch into a long blocking operation.
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
    try {
      foreach ($property in $payload.environment.PSObject.Properties) {
        $key.SetValue($property.Name, [string]$property.Value, [Microsoft.Win32.RegistryValueKind]::String)
      }
      foreach ($name in $payload.retired) { $key.DeleteValue([string]$name, $false) }
      $key.Flush()
    } finally { $key.Dispose() }
  `, JSON.stringify({ environment, retired }), 'user environment', execute);
  // Notify desktop launchers separately, with a strict deadline. A notification
  // timeout must never turn a successful Registry write into a setup failure.
  notifyWindowsEnvironment(execute);
}

export function notifyWindowsEnvironment(execute = spawnSync) {
  const script = `
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EnvironmentNotification {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
    $result = [UIntPtr]::Zero
    $null = [EnvironmentNotification]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$result)
  `;
  try {
    powershell(script, '', 'environment notification',
      (command, args, options) => execute(command, args, { ...options, timeout: 3_000 }));
    return true;
  } catch { return false; }
}

export function restrictWindowsDirectory(target, execute = spawnSync) {
  // Only the path and original account SID enter the elevated command. Secret
  // values stay in the unelevated process and are never written to temp files.
  const repair = `
    $ErrorActionPreference = 'Stop'
    $acl = [System.IO.Directory]::GetAccessControl($target, [System.Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existingRule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($existingRule) }
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    [System.IO.Directory]::SetAccessControl($target, $acl)
  `;
  const script = `
    $target = [Console]::In.ReadToEnd()
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    try { ${repair} }
    catch [System.UnauthorizedAccessException] {
      $data = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{target=$target; sid=$sid.Value} | ConvertTo-Json -Compress)))
      $child = '$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + $data + '")) | ConvertFrom-Json; $target = $data.target; $sid = New-Object System.Security.Principal.SecurityIdentifier($data.sid);' + [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encode(repair)}'))
      $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child))
      try {
        $process = Start-Process -FilePath "$PSHOME\\powershell.exe" -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList "-NoProfile -NonInteractive -EncodedCommand $encoded"
        if ($process.ExitCode -ne 0) { throw 'Permission repair failed.' }
      } catch { throw 'Administrator permission repair failed or the UAC prompt was cancelled.' }
    }
  `;
  // No timeout while the user is deciding whether to accept the UAC prompt.
  powershell(script, target, 'directory permissions (administrator approval may be required)',
    (command, args, options) => execute(command, args, { ...options, timeout: undefined }));
}
