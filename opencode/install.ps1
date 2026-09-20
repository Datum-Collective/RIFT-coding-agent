<#
.SYNOPSIS
    Installs RIFT on Windows.

.DESCRIPTION
    Downloads the prebuilt binary for this machine from GitHub Releases, puts it in
    %LOCALAPPDATA%\rift\bin, and adds that directory to the user PATH. Both `rift` and
    `opencode` will start it.

.EXAMPLE
    irm https://raw.githubusercontent.com/Datum-Collective/RIFT-coding-agent/main/opencode/install.ps1 | iex

.EXAMPLE
    # irm | iex cannot take arguments, so pin a version like this:
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Datum-Collective/RIFT-coding-agent/main/opencode/install.ps1))) -Version 1.0.0
#>
[CmdletBinding()]
param(
    [string] $Version,
    [string] $BinaryPath,
    [string] $InstallDir,
    [switch] $NoModifyPath
)

$ErrorActionPreference = 'Stop'
# Stock PowerShell 5.1 still defaults to TLS 1.0, which github.com refuses.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'Datum-Collective/RIFT-coding-agent'
$App = 'rift'

function Write-Muted([string] $Text) { Write-Host $Text -ForegroundColor DarkGray }
function Write-Fail([string] $Text) { Write-Host $Text -ForegroundColor Red }

# irm | iex passes no arguments, so the environment is the only way to reach this script.
# VERSION is what `rift upgrade` sets, matching the bash installer.
if (-not $Version) { $Version = $env:RIFT_VERSION }
if (-not $Version) { $Version = $env:VERSION }
if (-not $InstallDir) { $InstallDir = $env:RIFT_INSTALL_DIR }
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'rift\bin' }

# --- which binary does this machine need -----------------------------------------------------

function Get-Target {
    # OSArchitecture is correct even when PowerShell itself is running x64-emulated on an ARM64
    # machine, which PROCESSOR_ARCHITECTURE is not.
    $arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
        'X64'   { 'x64' }
        'Arm64' { 'arm64' }
        default { throw "Unsupported architecture: $_. RIFT ships x64 and arm64 builds for Windows." }
    }

    if ($arch -eq 'x64' -and -not (Test-Avx2)) {
        # Older CPUs need the baseline build; the normal one would crash on an illegal instruction.
        return 'windows-x64-baseline'
    }
    return "windows-$arch"
}

function Test-Avx2 {
    try {
        $sig = '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int feature);'
        $k32 = Add-Type -MemberDefinition $sig -Name 'RiftKernel32' -Namespace 'Rift' -PassThru
        return $k32::IsProcessorFeaturePresent(40)  # PF_AVX2_INSTRUCTIONS_AVAILABLE
    } catch {
        # If the probe itself fails, assume the safer build.
        return $false
    }
}

function Get-LatestVersion {
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
            -Headers @{ 'User-Agent' = 'rift-installer' } -UseBasicParsing
        return ($release.tag_name -replace '^v', '')
    } catch {
        throw "Could not read the latest RIFT version from GitHub: $($_.Exception.Message)"
    }
}

# --- install ---------------------------------------------------------------------------------

function Install-Binary([string] $Source, [string] $Destination) {
    # Windows will not overwrite a running executable, but it will rename one. `rift upgrade`
    # re-runs this script from inside rift.exe, so the old image is moved aside and swept up by
    # the next install rather than deleted now.
    $old = "$Destination.old"
    Remove-Item $old -Force -ErrorAction SilentlyContinue
    if (Test-Path $Destination) { Move-Item $Destination $old -Force }
    try {
        Move-Item $Source $Destination -Force
    } catch {
        # %TEMP% on another volume makes Move-Item a copy, which can fail differently.
        Copy-Item $Source $Destination -Force
        Remove-Item $Source -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $old -Force -ErrorAction SilentlyContinue
}

function Add-Alias([string] $Dir) {
    # A symlink needs admin or Developer Mode, so `opencode` is a forwarding shim instead.
    # .cmd is in PATHEXT by default, so it resolves from cmd, PowerShell and Git Bash alike.
    Set-Content -Path (Join-Path $Dir 'opencode.cmd') -Encoding ASCII -Value @(
        '@echo off',
        '"%~dp0rift.exe" %*'
    )
}

function Add-ToUserPath([string] $Dir) {
    # Never setx: it truncates PATH at 1024 characters.
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($current -split ';' | Where-Object { $_ })
    if ($entries -notcontains $Dir) {
        [Environment]::SetEnvironmentVariable('Path', (@($Dir) + $entries) -join ';', 'User')
        Write-Muted "Added $Dir to your PATH."
    }
    if (($env:Path -split ';') -notcontains $Dir) { $env:Path = "$Dir;$env:Path" }
    if ($env:GITHUB_PATH) { Add-Content -Path $env:GITHUB_PATH -Value $Dir }
}

# --- run -------------------------------------------------------------------------------------

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$target = Join-Path $InstallDir 'rift.exe'
$versionFile = Join-Path $InstallDir 'rift.version'

if ($BinaryPath) {
    if (-not (Test-Path $BinaryPath)) { Write-Fail "Binary not found at $BinaryPath"; exit 1 }
    Write-Muted "Installing rift from: $BinaryPath"
    $staged = Join-Path ([System.IO.Path]::GetTempPath()) "rift_install_$PID.exe"
    Copy-Item $BinaryPath $staged -Force
    Install-Binary $staged $target
} else {
    if ($Version) { $Version = $Version -replace '^v', '' } else { $Version = Get-LatestVersion }

    if (Test-Path $target) {
        $installed = if (Test-Path $versionFile) {
            (Get-Content $versionFile -Raw).Trim()
        }

        if ($installed -eq $Version) {
            Write-Muted "Version $Version already installed"
            exit 0
        }
    }

    $file = "$App-$(Get-Target).zip"
    $url = "https://github.com/$Repo/releases/download/v$Version/$file"
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "rift_install_$PID"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null

    try {
        Write-Muted "Downloading rift $Version ($file)"
        $zip = Join-Path $tmp $file
        # PowerShell 5.1 renders download progress so slowly it dominates the transfer.
        $prev = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        try {
            Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        } finally {
            $ProgressPreference = $prev
        }

        try {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
        } catch {
            Expand-Archive -Path $zip -DestinationPath $tmp -Force
        }

        $extracted = Join-Path $tmp 'rift.exe'
        if (-not (Test-Path $extracted)) { throw "the archive did not contain rift.exe" }
        Unblock-File $extracted   # clear the downloaded-from-the-internet marker
        Install-Binary $extracted $target
    } catch {
        Write-Fail "Install failed: $($_.Exception.Message)"
        Write-Muted "Releases: https://github.com/$Repo/releases"
        exit 1
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($Version) { Set-Content -Path $versionFile -Encoding ASCII -Value $Version }
Add-Alias $InstallDir
if (-not $NoModifyPath) { Add-ToUserPath $InstallDir }

Write-Host ''
Write-Host '         ' -ForegroundColor DarkGray -NoNewline; Write-Host '    ▄    '
Write-Host '█▀▀█ ▀██▀' -ForegroundColor DarkGray -NoNewline; Write-Host ' █▀▀▀ ████'
Write-Host '█▀▀▄  ██ ' -ForegroundColor DarkGray -NoNewline; Write-Host ' █▀▀   ██ '
Write-Host '▀  ▀ ▀██▀' -ForegroundColor DarkGray -NoNewline; Write-Host ' ▀     ██ '
Write-Host ''
Write-Muted 'RIFT includes free models, to start:'
Write-Host ''
Write-Host 'cd <project>  ' -NoNewline; Write-Muted '# Open directory'
Write-Host 'rift          ' -NoNewline; Write-Muted '# Run command'
Write-Host ''
Write-Muted 'Open a new terminal so the PATH change takes effect.'
Write-Muted "For more information visit https://github.com/$Repo"
Write-Host ''
