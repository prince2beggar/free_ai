param()
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
$taskPin = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'prototype-toolchain.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskTools = Join-Path $taskRepo '.tools'
$taskInstall = Join-Path $taskTools ('node-v' + $taskPin.node.version + '-win-x64')
$taskNode = Join-Path $taskInstall 'node.exe'
if (Test-Path -LiteralPath $taskNode) {
    $taskVersion = & $taskNode --version
    if ($taskVersion -ne ('v' + $taskPin.node.version)) { throw 'Local Node version does not match the reviewed pin.' }
    Write-Output ('PASS: local Node ' + $taskVersion)
    exit 0
}
New-Item -ItemType Directory -Path $taskTools -Force | Out-Null
$taskZip = Join-Path $taskTools $taskPin.node.archive
Invoke-WebRequest -Uri $taskPin.node.url -OutFile $taskZip -UseBasicParsing -TimeoutSec 60
$taskHash = (Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($taskHash -ne $taskPin.node.sha256) { throw 'Node archive checksum mismatch; nothing will be extracted.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchive = [IO.Compression.ZipFile]::OpenRead($taskZip)
try {
    $taskBoundary = [IO.Path]::GetFullPath($taskTools) + [IO.Path]::DirectorySeparatorChar
    foreach ($taskEntry in $taskArchive.Entries) {
        $taskTarget = [IO.Path]::GetFullPath((Join-Path $taskTools $taskEntry.FullName))
        if (-not $taskTarget.StartsWith($taskBoundary, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes local tool directory.' }
    }
} finally { $taskArchive.Dispose() }
Expand-Archive -LiteralPath $taskZip -DestinationPath $taskTools -Force
$taskVersion = & $taskNode --version
if ($taskVersion -ne ('v' + $taskPin.node.version)) { throw 'Extracted Node version mismatch.' }
Write-Output ('PASS: verified archive and local Node ' + $taskVersion)
