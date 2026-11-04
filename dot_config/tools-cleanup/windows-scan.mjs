import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function scannerSession(scanner, execute) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-cleanup-session-'));
  const request = path.join(directory, 'request.json');
  const response = path.join(directory, 'response.json');
  const stop = path.join(directory, 'stop');
  const payload = Buffer.from(JSON.stringify({ directory, scanner }), 'utf8').toString('base64');
  const encode = value => Buffer.from(value, 'utf16le').toString('base64');
  const launch = `
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $data.scanner = $data.scanner.Replace('[Console]::In.ReadToEnd()', '$request.input').Replace('$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value', ('$currentSid = ' + [char]39 + $sid + [char]39))
    $encodedData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($data | ConvertTo-Json -Compress)))
    $child = @'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__DATA__')) | ConvertFrom-Json
$scan = [ScriptBlock]::Create($data.scanner)
$requestFile = Join-Path $data.directory 'request.json'
$responseFile = Join-Path $data.directory 'response.json'
$stopFile = Join-Path $data.directory 'stop'
$deadline = [DateTime]::UtcNow.AddMinutes(15)
while ((Test-Path -LiteralPath $data.directory) -and !(Test-Path -LiteralPath $stopFile) -and [DateTime]::UtcNow -lt $deadline) {
  if (!(Test-Path -LiteralPath $requestFile)) { Start-Sleep -Milliseconds 100; continue }
  try {
    $request = [IO.File]::ReadAllText($requestFile) | ConvertFrom-Json
    Remove-Item -LiteralPath $requestFile
    $result = @{ok=$true; output=((& $scan) -join [Environment]::NewLine)}
  } catch { $result = @{ok=$false; output='Process inspection failed.'} }
  [IO.File]::WriteAllText(($responseFile + '.tmp'), ($result | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath ($responseFile + '.tmp') -Destination $responseFile
}
'@
    $child = $child.Replace('__DATA__', $encodedData)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child))
    try { $null = Start-Process -FilePath "$PSHOME\\powershell.exe" -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList "-NoProfile -NonInteractive -EncodedCommand $encoded" } catch { exit 1 }
  `;
  let launched = false;
  return {
    scan(_scanner, input) {
      if (!launched) {
        console.log('CHECK approve Windows UAC once for the read-only scanner session');
        execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(launch)], { stdio: 'inherit', windowsHide: true });
        launched = true;
      }
      fs.writeFileSync(request + '.tmp', JSON.stringify({ input }));
      fs.renameSync(request + '.tmp', request);
      const deadline = Date.now() + 120_000;
      while (!fs.existsSync(response)) {
        if (Date.now() > deadline) throw new Error('Administrator process scan timed out; cleanup stopped.');
        pause(100);
      }
      const result = JSON.parse(fs.readFileSync(response, 'utf8'));
      fs.unlinkSync(response);
      if (!result.ok) throw new Error('Administrator process inspection failed; cleanup stopped.');
      return result.output;
    },
    close() {
      fs.writeFileSync(stop, '1');
      // The helper sees the stop file within 100ms; leave it available until
      // that deadline before deleting only this invocation's fixed files.
      pause(500);
      for (const name of ['request.json', 'request.json.tmp', 'response.json', 'response.json.tmp', 'stop']) {
        try { fs.unlinkSync(path.join(directory, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      try { fs.rmdirSync(directory); } catch { /* A timed-out helper may still be finishing a read-only scan. */ }
    },
  };
}
