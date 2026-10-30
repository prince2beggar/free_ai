[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $PSScriptRoot 'gitleaks-version.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -ne 'X64' -or
    [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This installer supports Windows x64 only; use the official release for another platform.'
}
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$' -or
    $manifest.archive_sha256 -notmatch '^[a-f0-9]{64}$' -or
    $manifest.binary_sha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Invalid pinned Gitleaks manifest.'
}
$expectedUrl = 'https://github.com/gitleaks/gitleaks/releases/download/v{0}/gitleaks_{0}_windows_x64.zip' -f $manifest.version
if ($manifest.archive_url -ne $expectedUrl) {
    throw 'The tool download must use the exact pinned official GitHub release.'
}

$installDirectory = Join-Path $repositoryRoot ('.tools/gitleaks/{0}' -f $manifest.version)
$binaryPath = Join-Path $installDirectory 'gitleaks.exe'
if (Test-Path -LiteralPath $binaryPath -PathType Leaf) {
    $binaryHash = (Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($binaryHash -ne $manifest.binary_sha256) {
        throw 'Existing Gitleaks binary does not match the pinned checksum; review it before replacing it.'
    }
} else {
    $downloadDirectory = Join-Path $repositoryRoot '.tools/downloads'
    New-Item -ItemType Directory -Path $downloadDirectory,$installDirectory -Force | Out-Null
    $archivePath = Join-Path $downloadDirectory ('gitleaks_{0}_windows_x64.zip' -f $manifest.version)
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        Invoke-WebRequest -UseBasicParsing -Uri $manifest.archive_url -OutFile $archivePath
    }
    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($archiveHash -ne $manifest.archive_sha256) {
        throw 'Gitleaks archive does not match the pinned checksum; nothing was extracted.'
    }
    Expand-Archive -LiteralPath $archivePath -DestinationPath $installDirectory -Force
    $binaryHash = (Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($binaryHash -ne $manifest.binary_sha256) {
        throw 'Extracted Gitleaks binary does not match the pinned checksum.'
    }
}

$installedVersion = (& $binaryPath version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $installedVersion -ne $manifest.version) {
    throw 'Installed scanner does not report the pinned version.'
}
Write-Output ('PASS: Gitleaks {0} ready locally; executable checksum and version verified.' -f $manifest.version)
