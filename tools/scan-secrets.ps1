[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'gitleaks-version.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$' -or
    $manifest.binary_sha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Invalid pinned Gitleaks manifest.'
}
$binaryPath = Join-Path $repositoryRoot ('.tools/gitleaks/{0}/gitleaks.exe' -f $manifest.version)
if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) {
    throw 'Scanner is missing. Run tools/install-gitleaks.ps1 before scanning.'
}
$binaryHash = (Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($binaryHash -ne $manifest.binary_sha256) {
    throw 'Scanner checksum mismatch; refusing to execute it.'
}

$configPath = Join-Path $repositoryRoot '.gitleaks.toml'
Push-Location -LiteralPath $repositoryRoot
try {
    & $binaryPath dir $repositoryRoot --config $configPath --redact=100 --no-banner --no-color --log-level error --ignore-gitleaks-allow --timeout 120
    $scanExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($scanExitCode -eq 0) {
    Write-Output 'PASS: no secret findings in the working tree.'
} else {
    Write-Output ('FAIL: secret scan returned exit code {0}; findings remain redacted.' -f $scanExitCode)
}
exit $scanExitCode
