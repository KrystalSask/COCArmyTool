[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$artifactDir = Join-Path $projectRoot 'artifacts'
$stdoutLog = Join-Path $artifactDir 'desktop-dev.stdout.log'
$stderrLog = Join-Path $artifactDir 'desktop-dev.stderr.log'
$popup = New-Object -ComObject WScript.Shell

function Show-Message {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [int]$Seconds = 0,
        [int]$Icon = 64
    )
    $null = $popup.Popup($Message, $Seconds, 'COCArmyTool Development Launcher', $Icon)
}

try {
    $node = Get-Command node -ErrorAction SilentlyContinue
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    $rustc = Get-Command rustc -ErrorAction SilentlyContinue
    $cargo = Get-Command cargo -ErrorAction SilentlyContinue

    if (-not $node -or -not $npm) {
        Show-Message -Message 'Node.js 22 or newer and npm are required.' -Icon 16
        exit 1
    }
    if (-not $rustc -or -not $cargo) {
        Show-Message -Message 'The Rust toolchain (rustc and cargo) is required for desktop development.' -Icon 16
        exit 1
    }

    $runningApp = Get-Process -Name 'coc-army-tool' -ErrorAction SilentlyContinue
    if ($runningApp) {
        Show-Message -Message 'COCArmyTool is already running.' -Seconds 3
        exit 0
    }

    New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null

    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
        Show-Message -Message 'Installing project dependencies. This can take a few minutes.' -Seconds 4
        $install = Start-Process -FilePath $npm.Source -ArgumentList 'install' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -Wait -PassThru
        if ($install.ExitCode -ne 0) {
            Show-Message -Message "Dependency installation failed. See:`n$stderrLog" -Icon 16
            exit $install.ExitCode
        }
    }

    Show-Message -Message 'Starting COCArmyTool. The first compile may take a moment.' -Seconds 3
    $desktop = Start-Process -FilePath $npm.Source -ArgumentList 'run', 'desktop:dev' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -Wait -PassThru
    if ($desktop.ExitCode -ne 0) {
        Show-Message -Message "COCArmyTool stopped with an error. See:`n$stderrLog" -Icon 16
        exit $desktop.ExitCode
    }
}
catch {
    Show-Message -Message ("Unable to start COCArmyTool.`n" + $_.Exception.Message) -Icon 16
    exit 1
}
