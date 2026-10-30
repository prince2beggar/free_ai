param([ValidateSet('install', 'dev', 'check', 'test', 'browser', 'build', 'format', 'audit', 'sbom', 'phase1', 'phase1-check', 'phase1-test', 'phase1-browser', 'phase1-format', 'phase1-security', 'phase1-sbom', 'phase1-readiness', 'phase1-coverage', 'phase2', 'phase2-registry', 'phase2-ledger', 'phase2-governor', 'phase2-router', 'phase2-router-preview', 'phase2-router-browser', 'phase2-router-coverage', 'phase2-abuse', 'phase2-abuse-preview', 'phase2-abuse-browser', 'phase2-abuse-coverage', 'phase2-test', 'phase2-check', 'phase2-browser', 'phase2-coverage', 'phase2-governor-coverage')][string]$Task = 'dev')
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
$taskPin = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'prototype-toolchain.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskRuntime = Join-Path $taskRepo ('.tools\node-v' + $taskPin.node.version + '-win-x64')
$taskNode = Join-Path $taskRuntime 'node.exe'
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Run tools/install-prototype-node.ps1 first; the prototype uses the reviewed local runtime.' }
$taskOriginalPath = $env:PATH
$taskOriginalTls = $env:NODE_TLS_REJECT_UNAUTHORIZED
$taskLocation = Get-Location
try {
    $env:PATH = $taskRuntime + [IO.Path]::PathSeparator + $taskOriginalPath
    $env:NODE_TLS_REJECT_UNAUTHORIZED = '1'
    Set-Location -LiteralPath $taskRepo
    $taskNpm = Join-Path $taskRuntime 'node_modules\npm\bin\npm-cli.js'
    if ($Task -eq 'install') {
        if (Test-Path -LiteralPath (Join-Path $taskRepo 'package-lock.json')) {
            & $taskNode --use-system-ca $taskNpm ci --include=dev --ignore-scripts --no-fund --no-audit --registry=https://registry.npmjs.org --cache=.tools/npm-verified-cache
        } else {
            & $taskNode --use-system-ca $taskNpm install --include=dev --ignore-scripts --no-fund --no-audit --registry=https://registry.npmjs.org --cache=.tools/npm-verified-cache
        }
    } elseif ($Task -eq 'audit') {
        & $taskNode --use-system-ca $taskNpm audit --include=dev --audit-level=moderate --registry=https://registry.npmjs.org --cache=.tools/npm-verified-cache
    } elseif ($Task -eq 'sbom' -or $Task -eq 'phase1-sbom') {
        $taskSbom = & $taskNode --use-system-ca $taskNpm sbom --sbom-format=cyclonedx --include=dev
        if ($LASTEXITCODE -ne 0) { throw 'SBOM generation failed.' }
        $taskSbomFile = if ($Task -eq 'phase1-sbom') { 'docs\phase1-sbom.json' } else { 'docs\prototype-sbom.json' }
        [IO.File]::WriteAllText((Join-Path $taskRepo $taskSbomFile), ($taskSbom -join "`n") + "`n", (New-Object Text.UTF8Encoding $false))
        Write-Output ('PASS: wrote ' + $taskSbomFile)
    } else {
        $taskScript = if ($Task -eq 'browser') { 'test:browser' } elseif ($Task.StartsWith('phase1-')) { $Task.Replace('phase1-', 'phase1:') } elseif ($Task.StartsWith('phase2-')) { $Task.Replace('phase2-', 'phase2:') } else { $Task }
        & $taskNode --use-system-ca $taskNpm run $taskScript
    }
    $taskExit = $LASTEXITCODE
} finally {
    $env:PATH = $taskOriginalPath
    $env:NODE_TLS_REJECT_UNAUTHORIZED = $taskOriginalTls
    Set-Location -LiteralPath $taskLocation.Path
}
exit $taskExit
