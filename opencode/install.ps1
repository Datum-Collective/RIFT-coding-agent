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

# Maps one architecture token to RIFT's naming. Every source feeds this the same way: the Windows
# PROCESSOR_* variables spell AMD64/ARM64 and RuntimeInformation's enum spells X64/Arm64, and the
# switch is case-insensitive, so one mapper covers 'AMD64', 'X64', 'ARM64' and 'Arm64'.
function ConvertTo-RiftArch([string] $Token) {
    switch ($Token) {
        'AMD64' { return 'x64' }
        'X64'   { return 'x64' }
        'ARM64' { return 'arm64' }
    }
    return ''
}

# Returns 'x64' or 'arm64', or throws when the machine is genuinely unsupported or unreadable.
#
# Windows' own environment variables are the primary source of truth: the OS sets them at process
# start, whereas RuntimeInformation.OSArchitecture has been observed to come back $null on otherwise
# normal Windows installs. PROCESSOR_ARCHITEW6432 is consulted before PROCESSOR_ARCHITECTURE because
# it is only set under WOW64 (a 32-bit PowerShell on 64-bit Windows), where PROCESSOR_ARCHITECTURE
# says x86 but the x64 build is exactly what is wanted.
function Resolve-InstallArchitecture {
    param(
        [string] $ProcessorArchitectureW6432,
        [string] $ProcessorArchitecture,
        [object] $OsArch
    )

    if (-not [string]::IsNullOrEmpty($ProcessorArchitectureW6432)) {
        $mapped = ConvertTo-RiftArch $ProcessorArchitectureW6432
        if ($mapped) { return $mapped }
    }

    if (-not [string]::IsNullOrEmpty($ProcessorArchitecture)) {
        $mapped = ConvertTo-RiftArch $ProcessorArchitecture
        if ($mapped) { return $mapped }

        # x86 with no WOW64 entry is a genuinely 32-bit Windows box, not an unknown one.
        if ($ProcessorArchitecture -eq 'x86' -and [string]::IsNullOrEmpty($ProcessorArchitectureW6432)) {
            throw 'Unsupported architecture: 32-bit Windows is not supported. RIFT ships x64 and arm64 builds for Windows.'
        }
    }

    # Secondary fallback only, and never trusted blindly: calling .ToString() on the $null value some
    # Windows installs report is exactly what crashed the old installer, so it is null-checked here.
    if ($null -ne $OsArch) {
        $token = $OsArch.ToString()
        $mapped = ConvertTo-RiftArch $token
        if ($mapped) { return $mapped }

        if ($token -eq 'X86') {
            throw 'Unsupported architecture: 32-bit Windows is not supported. RIFT ships x64 and arm64 builds for Windows.'
        }
    }

    # Every source came up empty or unreadable: the machine cannot be auto-detected, so report what
    # was actually seen rather than the misleading "Unsupported architecture: ."
    $osText = if ($null -eq $OsArch) { '(unavailable)' } else { $OsArch.ToString() }
    throw "Could not determine the CPU architecture. PROCESSOR_ARCHITECTURE=[$ProcessorArchitecture] PROCESSOR_ARCHITEW6432=[$ProcessorArchitectureW6432] RuntimeInformation.OSArchitecture=[$osText]. RIFT ships x64 and arm64 builds for Windows."
}

function Get-TargetName([string] $Arch, [bool] $HasAvx2) {
    # Older CPUs need the baseline build; the normal one would crash on an illegal instruction.
    if ($Arch -eq 'x64' -and -not $HasAvx2) { return 'windows-x64-baseline' }
    return "windows-$Arch"
}

function Get-Target {
    $osArch = $null
    try { $osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture } catch { $osArch = $null }
    $arch = Resolve-InstallArchitecture `
        -ProcessorArchitectureW6432 $env:PROCESSOR_ARCHITEW6432 `
        -ProcessorArchitecture $env:PROCESSOR_ARCHITECTURE `
        -OsArch $osArch
    return Get-TargetName $arch (Test-Avx2)
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

# Every install ends by proving it actually happened, and naming where. This is also reachable from
# the "already installed" path, so a broken or partial install surfaces instead of exiting silently.
function Assert-Install([string] $Dir) {
    $exe = Join-Path $Dir 'rift.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw "RIFT is missing its executable: $exe" }
    $shim = Join-Path $Dir 'opencode.cmd'
    if (-not (Test-Path -LiteralPath $shim)) { throw "RIFT is missing the opencode shim: $shim" }
    Write-Host "Installed RIFT to: $Dir"
}

# Windows PATH is case-insensitive and tolerates a trailing separator, so 'c:\rift\bin' and
# 'C:\rift\bin\' are the same location. Never report a duplicate (or silently skip) over spelling.
function Test-PathEntry([string] $Entry, [string] $Dir) {
    if (-not $Entry -or -not $Dir) { return $false }
    $e = $Entry.TrimEnd('\').TrimEnd('/')
    $d = $Dir.TrimEnd('\').TrimEnd('/')
    return $e -eq $d   # -eq on strings is case-insensitive
}

# Pure PATH merge, separate from registry I/O so tests can drive it with strings. Returns what the
# persistent user PATH and the current process PATH should become, and whether the directory was
# already there (in which case nothing needs to be written).
function Merge-PathEntry {
    param(
        [AllowNull()][string] $UserPath,
        [AllowNull()][string] $ProcessPath,
        [string] $Dir
    )
    $entries  = @($UserPath -split ';' | Where-Object { $_ })
    $inUser   = @($entries | Where-Object { Test-PathEntry $_ $Dir }).Count -gt 0
    $inProc   = @($ProcessPath -split ';' | Where-Object { $_ } | Where-Object { Test-PathEntry $_ $Dir }).Count -gt 0

    $persisted = $UserPath
    $action = 'already-present'
    if (-not $inUser) {
        $persisted = (@($Dir) + $entries) -join ';'
        $action = 'added'
    }

    $process = $ProcessPath
    if (-not $inProc) {
        $process = if ($ProcessPath) { "$Dir;$ProcessPath" } else { $Dir }
    }

    [pscustomobject]@{
        Action      = $action      # 'added' or 'already-present'
        InUserPath  = $inUser
        InProcPath  = $inProc
        UserPath    = $persisted
        ProcessPath = $process
    }
}

function Add-ToUserPath([string] $Dir) {
    # Never setx: it truncates PATH at 1024 characters.
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $merged = Merge-PathEntry -UserPath $current -ProcessPath $env:Path -Dir $Dir

    if ($merged.Action -eq 'added') {
        [Environment]::SetEnvironmentVariable('Path', $merged.UserPath, 'User')
        # Re-read what actually landed, so a write that did not stick is a hard error instead of a
        # silent success. SetEnvironmentVariable is only effective if the value was truly persisted.
        $now = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (-not (@($now -split ';' | Where-Object { Test-PathEntry $_ $Dir }))) {
            throw "Installed RIFT to $Dir but the user PATH could not be updated. Re-run the installer as Administrator or add `"$Dir`" to your PATH manually."
        }
        Write-Muted "Added $Dir to your PATH."
    } else {
        # Already there: still refresh the current process if a stale console lacks it, and say so.
        Write-Muted "RIFT is already on your PATH: $Dir"
    }

    # Make the current session able to run `rift` immediately, and prepare for CI's GITHUB_PATH.
    $env:Path = $merged.ProcessPath
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
            # A re-run must still confirm the install is intact and self-heal the PATH, which an
            # earlier install (or an unrelated PATH edit) may have left stale.
            Assert-Install $InstallDir
            if (-not $NoModifyPath) { Add-ToUserPath $InstallDir }
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
Assert-Install $InstallDir
if (-not $NoModifyPath) { Add-ToUserPath $InstallDir }


# ---- the closing banner -------------------------------------------------------------------------------
# "Datum Software" in the six stripes of the 1977 Apple logo, blended smoothly. The art is two words with
# a four-column gap, kept as two blocks so it can sit side by side where there is room and stack where there
# is not: it is 98 columns wide, and a default console window is narrower than that.
# Single-quoted here-strings are fully literal, which matters: this art is full of backslashes.
$DatumLeft = @'
________       _____
___  __ \_____ __  /____  ________ ___
__  / / /  __ `/  __/  / / /_  __ `__ \
_  /_/ // /_/ // /_ / /_/ /_  / / / / /
/_____/ \__,_/ \__/ \__,_/ /_/ /_/ /_/
'@ -split '\r?\n'
$DatumRight = @'
             ____________
________________  __/_  /___      _______ ____________
__  ___/  __ \_  /_ _  __/_ | /| / /  __ `/_  ___/  _ \
_(__  )/ /_/ /  __/ / /_ __ |/ |/ // /_/ /_  /   /  __/
/____/ \____//_/    \__/ ____/|__/ \__,_/ /_/    \___/
'@ -split '\r?\n'

# Apple, 1977, top to bottom: green, yellow, orange, red, purple, blue.
$Stops = @(@(97, 187, 70), @(253, 184, 39), @(245, 130, 31), @(224, 58, 62), @(150, 61, 151), @(0, 157, 220))
# The same six for consoles that only know sixteen colours.
$LegacyColors = @('Green', 'Yellow', 'DarkYellow', 'Red', 'Magenta', 'Cyan')

function Get-GradientColor([double] $T) {
    if ($T -gt 1) { $T = 1 }
    $seg = $T * 5
    $k = [int][math]::Floor($seg)
    if ($k -gt 4) { $k = 4 }
    $f = $seg - $k
    $a = $Stops[$k]; $b = $Stops[$k + 1]
    return @(
        [int][math]::Round($a[0] + ($b[0] - $a[0]) * $f),
        [int][math]::Round($a[1] + ($b[1] - $a[1]) * $f),
        [int][math]::Round($a[2] + ($b[2] - $a[2]) * $f)
    )
}

# Writes lines with a gradient running left to right and a slight downward drift so rows are not
# identical. $Width is the widest line, $Row0 the row this block starts on and $Rows the rows in the whole
# picture, so several blocks written one after another still read as a single gradient.
function Write-Gradient([string[]] $Lines, [int] $Width, [int] $Row0, [int] $Rows, [string] $Mode) {
    $esc = [char]27
    for ($row = 0; $row -lt $Lines.Count; $row++) {
        $line = $Lines[$row]
        if ($Mode -eq 'none') { Write-Host $line; continue }

        $sb = New-Object System.Text.StringBuilder
        for ($i = 0; $i -lt $line.Length; $i++) {
            $ch = $line[$i]
            if ($ch -eq ' ') { [void]$sb.Append($ch); continue }
            $w = [math]::Max($Width - 1, 1)
            $r = [math]::Max($Rows - 1, 1)
            $t = 0.85 * $i / $w + 0.15 * ($row + $Row0) / $r
            if ($Mode -eq 'vt') {
                $c = Get-GradientColor $t
                [void]$sb.Append("$esc[38;2;$($c[0]);$($c[1]);$($c[2])m$ch")
            } else {
                [void]$sb.Append($ch)
            }
        }
        if ($Mode -eq 'vt') { Write-Host ($sb.ToString() + "$esc[0m") }
        else {
            # A console without VT support: one Write-Host per run of same-coloured characters.
            $cur = $null; $run = ''
            for ($i = 0; $i -lt $line.Length; $i++) {
                $ch = $line[$i]
                $idx = [int][math]::Min(5, [math]::Floor((0.85 * $i / [math]::Max($Width - 1, 1) + 0.15 * ($row + $Row0) / [math]::Max($Rows - 1, 1)) * 6))
                if ($cur -ne $null -and $idx -ne $cur -and $ch -ne ' ') {
                    Write-Host $run -NoNewline -ForegroundColor $LegacyColors[$cur]; $run = ''
                }
                if ($ch -ne ' ') { $cur = $idx }
                $run += $ch
            }
            if ($run.Length -gt 0) { Write-Host $run -NoNewline -ForegroundColor $LegacyColors[[int]($cur -as [int])] }
            Write-Host ''
        }
    }
}

function Write-Banner {
    $cols = 80
    try { $cols = [int]$Host.UI.RawUI.WindowSize.Width } catch { $cols = 80 }
    if ($cols -lt 1) { $cols = 80 }
    if ($env:RIFT_BANNER_COLS -match '^\d+$') { $cols = [int]$env:RIFT_BANNER_COLS }

    # Colour only where it will display properly: not when output is redirected, not when the user asked
    # for none, and true colour only where the console understands VT sequences.
    $mode = 'none'
    $redirected = $false
    try { $redirected = [Console]::IsOutputRedirected } catch { $redirected = $false }
    if (-not $redirected -and -not $env:NO_COLOR) {
        $vt = $false
        try { $vt = [bool]$Host.UI.SupportsVirtualTerminal } catch { $vt = $false }
        if ($vt) { $mode = 'vt' } else { $mode = 'legacy' }
    }
    # CI captures output, so it would only ever take the plain path. This lets a test force each of the
    # others and check them for real.
    if ($env:RIFT_BANNER_MODE -in @('vt', 'legacy', 'none')) { $mode = $env:RIFT_BANNER_MODE }

    $barWidth = 8
    if ($cols -ge 100) {
        for ($i = 0; $i -lt $DatumLeft.Count; $i++) {
            $l = $DatumLeft[$i]; $r = ''
            if ($i -lt $DatumRight.Count) { $r = $DatumRight[$i] }
            $joined = '{0,-39}    {1}' -f $l, $r
            Write-Gradient @($joined.TrimEnd()) 98 $i 5 $mode
        }
        $barWidth = 16
    } elseif ($cols -ge 58) {
        # Stacked: two words, each fits a narrower console. One gradient runs down both.
        Write-Gradient $DatumLeft 39 0 10 $mode
        Write-Gradient $DatumRight 55 5 10 $mode
        $barWidth = 9
    } else {
        Write-Gradient @('Datum Software') 14 0 1 $mode
    }

    # The six stripes as a rule underneath, the way the old logo was cut.
    if ($mode -ne 'none' -and $cols -ge 58) {
        $esc = [char]27
        $bar = [string][char]0x2501
        $seg = $bar * $barWidth
        if ($mode -eq 'vt') {
            $out = ''
            foreach ($s in $Stops) { $out += "$esc[38;2;$($s[0]);$($s[1]);$($s[2])m$seg" }
            Write-Host ($out + "$esc[0m")
        } else {
            for ($n = 0; $n -lt 6; $n++) { Write-Host $seg -NoNewline -ForegroundColor $LegacyColors[$n] }
            Write-Host ''
        }
    }
}

Write-Host ''
# A problem drawing the banner must never spoil an install that has already succeeded.
try { Write-Banner } catch {
    foreach ($line in $DatumLeft) { Write-Host $line }
    foreach ($line in $DatumRight) { Write-Host $line }
}
Write-Host ''
Write-Muted 'RIFT includes free models, to start:'
Write-Host ''
Write-Host 'cd <project>  ' -NoNewline; Write-Muted '# Open directory'
Write-Host 'rift          ' -NoNewline; Write-Muted '# Run command'
Write-Host ''
if ($NoModifyPath) {
    Write-Muted 'PATH was left unchanged (-NoModifyPath). Start RIFT with:'
    Write-Host "  $target"
} else {
    Write-Muted 'Open a new terminal so the PATH change takes effect.'
}
Write-Muted "For more information visit https://github.com/$Repo"
Write-Host ''
