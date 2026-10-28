#Requires -Version 5.1
<#[.SYNOPSIS]
Copies the packaged Franchise Explorer source into an EXISTING local Git clone.
Never replaces manifest.json or touches .git; does not push or publish.
Example:
  powershell -ExecutionPolicy Bypass -File .\Jellyfin-Franchise-Explorer\scripts\Apply-Repository-Upgrade.ps1 -RepositoryPath 'C:\Code\Jellyfin-Franchise-Explorer'
#>
param([Parameter(Mandatory=$true)][string]$RepositoryPath)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath $RepositoryPath).Path
$packageRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$projectName = 'Jellyfin-Franchise-Explorer'
if (-not (Test-Path -LiteralPath (Join-Path $repository '.git'))) {
    throw "RepositoryPath must point to an existing Git clone containing .git: $repository"
}
if (-not (Test-Path -LiteralPath (Join-Path $repository 'manifest.json'))) {
    throw "Existing manifest.json not found. Refusing to overwrite or reconstruct the Jellyfin catalog."
}
if (([IO.Path]::GetFullPath($packageRoot)).TrimEnd('\') -eq ([IO.Path]::GetFullPath($repository)).TrimEnd('\')) {
    throw 'Extract the upgrade ZIP separately from the Git repository before running this script.'
}
$sourceProject = Join-Path $packageRoot $projectName
$sourceWorkflows = Join-Path $packageRoot '.github\workflows'
if (-not (Test-Path -LiteralPath (Join-Path $sourceWorkflows 'build.yml')) -or
    -not (Test-Path -LiteralPath (Join-Path $sourceProject 'src'))) {
    throw 'Upgrade package is incomplete. Verify that the ZIP was fully extracted.'
}
# Refuse to overwrite unrelated uncommitted changes when a Git executable is available.
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
    & git -C $repository status --porcelain --untracked-files=no | ForEach-Object {
        if ($_.Trim()) { throw 'Existing local repository has uncommitted changes. Commit or stash them first.' }
    }
}
Write-Host 'Copying the new project folder and updated root documentation/workflows...'
$projectTarget = Join-Path $repository $projectName
New-Item -ItemType Directory -Path $projectTarget -Force | Out-Null
Get-ChildItem -LiteralPath $sourceProject -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $projectTarget -Recurse -Force
}
foreach ($name in @('README.md','LICENSE','.gitignore')) {
    Copy-Item -LiteralPath (Join-Path $packageRoot $name) -Destination (Join-Path $repository $name) -Force
}
$workflowTarget = Join-Path $repository '.github\workflows'
New-Item -ItemType Directory -Path $workflowTarget -Force | Out-Null
foreach ($name in @('build.yml','release.yml')) {
    Copy-Item -LiteralPath (Join-Path $sourceWorkflows $name) -Destination (Join-Path $workflowTarget $name) -Force
}
# Remove the superseded location ONLY after the complete replacement was copied.
foreach ($oldPath in @('src','scripts','docs','examples','CHANGELOG.md')) {
    $target = Join-Path $repository $oldPath
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
Get-ChildItem -LiteralPath $repository -Filter 'mock-browser-*.png' -File -ErrorAction SilentlyContinue |
    Remove-Item -Force
Write-Host ''
Write-Host 'Source update copied. Your root manifest.json was preserved.' -ForegroundColor Green
Write-Host 'Open GitHub Desktop, review the changed files, Commit to main, then Push origin.'
Write-Host 'Wait for BOTH GitHub Actions validation jobs to pass. Do NOT publish yet if either fails.'
