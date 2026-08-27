[CmdletBinding()]
param()

# COCArmyTool Windows x64 便携版打包脚本（仅 Windows）。
#
# 用法：
#   npm run release:portable
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-portable.ps1
#
# 行为：生产前端构建 -> Tauri release 构建（--no-bundle，不生成 NSIS/MSI）
#       -> 暂存 COCArmyTool.exe 与使用说明 -> 生成
#       release/COCArmyTool-v<版本>-windows-x64-portable.zip。
# 版本号只取自 src-tauri/tauri.conf.json（与 package.json、Cargo.toml 同一发布元数据），
# 不允许命令行覆盖；打包前校验 EXE 的产品版本与项目版本一致、PE 架构确为 x64，
# 任何一步失败都会中止，不会打包过期或错标版本的产物。

$ErrorActionPreference = 'Stop'
# npm 经 cmd 调用 Windows PowerShell 5.1：管道与文件读取默认按 ANSI 代码页，
# 必须显式使用 UTF-8，否则中文配置（tauri.conf.json）会解析失败、输出会乱码。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path

function Assert-Success {
    param([int]$Code, [string]$Message)
    if ($Code -ne 0) {
        throw "$Message（退出码 $Code）"
    }
}

# 读取 PE 头 Machine 字段：0x8664 = AMD64（x64），0x014c = i386。
function Get-PEMachine {
    param([string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $reader = [System.IO.BinaryReader]::new($stream)
        $stream.Position = 0x3C
        $peOffset = $reader.ReadInt32()
        $stream.Position = $peOffset + 4
        return $reader.ReadUInt16()
    }
    finally {
        $stream.Dispose()
    }
}

try {
    # 1. 版本号：只从 tauri.conf.json 读取（唯一权威来源），不允许覆盖，
    #    避免 ZIP 文件名与 EXE 内嵌版本不一致。
    $tauriConf = Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri\tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $Version = [string]$tauriConf.version
    if ($Version -notmatch '^\d+\.\d+\.\d+$') {
        throw "无效版本号：$Version（需要形如 0.2.0）"
    }

    $releaseDir = Join-Path $projectRoot 'release'
    $stagingDir = Join-Path $releaseDir 'staging'
    $zipPath = Join-Path $releaseDir "COCArmyTool-v$Version-windows-x64-portable.zip"
    $exeSource = Join-Path $projectRoot 'src-tauri\target\release\coc-army-tool.exe'
    $readmeTemplate = Join-Path $projectRoot 'scripts\portable-readme-zh.txt'
    $buildStart = Get-Date

    # 2. 环境检查：缺少任一工具直接失败。
    foreach ($command in 'node', 'npm.cmd', 'rustc', 'cargo') {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "缺少 $command，无法构建便携版。请先安装 Node.js 22+ 和 Rust stable。"
        }
    }
    $npm = (Get-Command 'npm.cmd' -ErrorAction SilentlyContinue).Source

    # 3. 清理旧暂存与旧 ZIP，防止混入过期产物。
    if (Test-Path -LiteralPath $stagingDir) {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force
    }
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    # 4. 生产前端构建（tsc + vite）。
    Write-Host '== [1/4] 生产前端构建 npm run build =='
    Push-Location $projectRoot
    try {
        & $npm run build
        Assert-Success $LASTEXITCODE '生产前端构建失败'
    }
    finally {
        Pop-Location
    }

    # 5. Tauri release 构建（--no-bundle：只产出 EXE，不生成安装包）。
    #    先删除旧 EXE，确保 Cargo 必须重新链接本次产物，避免打包陈旧二进制。
    if (Test-Path -LiteralPath $exeSource) {
        Remove-Item -LiteralPath $exeSource -Force
    }
    Write-Host '== [2/4] Tauri release 构建（--no-bundle，无 NSIS/MSI）=='
    Push-Location $projectRoot
    try {
        & $npm run desktop:release
        Assert-Success $LASTEXITCODE 'Tauri release 构建失败'
    }
    finally {
        Pop-Location
    }

    # 6. 校验产物：本次构建生成、产品版本与项目版本一致、PE 架构确为 x64。
    if (-not (Test-Path -LiteralPath $exeSource)) {
        throw "未找到构建产物：$exeSource"
    }
    $exeInfo = Get-Item -LiteralPath $exeSource
    if ($exeInfo.LastWriteTime -lt $buildStart) {
        throw '构建产物时间戳早于本次构建开始时间，拒绝打包可能过期的 EXE。'
    }
    $fileVersion = [string]$exeInfo.VersionInfo.ProductVersion
    if (-not $fileVersion.StartsWith($Version, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "EXE 产品版本 $fileVersion 与项目版本 $Version 不一致，拒绝打包（防止错标版本）。"
    }
    $machine = Get-PEMachine -Path $exeSource
    if ($machine -ne 0x8664) {
        throw "EXE PE Machine 字段为 0x$('{0:x4}' -f $machine)（非 x64/AMD64），拒绝以 windows-x64 命名打包。"
    }
    Write-Host "构建产物：$($exeInfo.Name)，产品版本 $fileVersion，PE 架构 x64，$($exeInfo.Length) 字节"

    # 7. 暂存运行时交付物：改名后的用户入口 EXE + 简体中文使用说明。
    Write-Host '== [3/4] 暂存运行时交付物 =='
    New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
    Copy-Item -LiteralPath $exeSource -Destination (Join-Path $stagingDir 'COCArmyTool.exe')
    $readme = Get-Content -LiteralPath $readmeTemplate -Raw -Encoding UTF8
    $readme = $readme.Replace('{version}', $Version).Replace('{date}', (Get-Date).ToString('yyyy-MM-dd'))
    [System.IO.File]::WriteAllText(
        (Join-Path $stagingDir '使用说明.txt'),
        $readme,
        (New-Object System.Text.UTF8Encoding($true)))

    # 8. 打包 ZIP（两个条目位于 ZIP 根目录）。
    Write-Host '== [4/4] 创建 ZIP =='
    Compress-Archive -Path (Join-Path $stagingDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

    # 9. 校验 ZIP 只包含预期条目。
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entries = @($zip.Entries | ForEach-Object { $_.FullName })
        $expected = @('COCArmyTool.exe', '使用说明.txt')
        foreach ($name in $expected) {
            if ($entries -notcontains $name) {
                throw "ZIP 缺少条目：$name"
            }
        }
        foreach ($name in $entries) {
            if ($expected -notcontains $name) {
                throw "ZIP 包含意外条目：$name"
            }
        }
    }
    finally {
        $zip.Dispose()
    }

    # 10. 清理暂存目录，只保留最终 ZIP。
    Remove-Item -LiteralPath $stagingDir -Recurse -Force

    $zipInfo = Get-Item -LiteralPath $zipPath
    Write-Host ''
    Write-Host "便携版打包完成：$($zipInfo.FullName)"
    Write-Host ("大小：{0:N2} MB" -f ($zipInfo.Length / 1MB))
    Write-Host "内容：COCArmyTool.exe（产品版本 $fileVersion）、使用说明.txt"
}
catch {
    Write-Error "便携版打包失败：$($_.Exception.Message)"
    exit 1
}

exit 0
