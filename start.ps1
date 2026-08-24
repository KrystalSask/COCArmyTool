[CmdletBinding()]
param(
    [ValidateSet('', 'desktop', 'web', 'test', 'e2e', 'build', 'desktop-build', 'check', 'help')]
    [string]$Action = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $projectRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js was not found. Install Node.js 22 or newer and try again.'
    }

    $arguments = @('scripts/start.mjs')
    if ($Action) {
        $arguments += $Action
    }
    & node @arguments
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
