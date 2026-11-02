<#
.SYNOPSIS
    Regression tests for the Windows installer in opencode/install.ps1.

.DESCRIPTION
    Two things are tested, independently:

    Architecture detection. Get-Target picks the release artifact for an x64 or arm64 Windows machine.
    It used to ask RuntimeInformation.OSArchitecture and switch on the raw enum; a later fix
    normalized that enum to a string. Neither works on a Windows install where OSArchitecture itself
    is $null: .ToString() then dies and the installer reports "Unsupported architecture: ." on an
    ordinary x64 machine. The installer now reads PROCESSOR_ARCHITEW6432 / PROCESSOR_ARCHITECTURE
    first (W6432 ahead of PROCESSOR_ARCHITECTURE, so 32-bit PowerShell on 64-bit Windows still
    selects x64) and only falls back to RuntimeInformation.OSArchitecture with an explicit $null
    check. These tests drive that logic with injected values, so every branch - including the exact
    broken-machine values - is reproduced regardless of the architecture this runs on.

    PATH handling. The installer must verifiably put the install directory on the persistent user
    PATH and on the current process PATH, and must say explicitly whether it added the directory,
    found it already present, or could not persist it. The decision logic lives in the pure function
    Merge-PathEntry (no registry I/O), which these tests drive with injected PATH strings so the real
    user PATH is never touched. File/self-verification and the -NoModifyPath end-to-end behavior are
    exercised with throwaway directories under %TEMP%.

    Run it from either host:
        pwsh ./opencode/test/install-target.ps1
        powershell.exe -NoProfile -File .\opencode\test\install-target.ps1

.EXAMPLE
    pwsh -NoProfile -File ./opencode/test/install-target.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path (Join-Path $PSScriptRoot '..\install.ps1')).Path
$script:pass = 0
$script:fail = 0

function Test-Result([object] $Got, [object] $Expected, [string] $What) {
    if ($Got -ne $Expected) {
        Write-Host "   FAIL  $What`: expected [$Expected], got [$Got]"
        $script:fail++
    } else {
        Write-Host "   PASS  $What"
        $script:pass++
    }
}

# --- pull the detection functions out of the installer ------------------------------------------

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors) {
    $errors | ForEach-Object { Write-Host "   FAIL  install.ps1 failed to parse: $($_.Message)" }
    $script:fail++
    exit 1
}

$byName = @{}
foreach ($fn in $ast.FindAll(
    { param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] },
    $true
)) {
    if (-not $byName.ContainsKey($fn.Name)) { $byName.Add($fn.Name, $fn.Extent.Text) }
}

foreach ($name in 'ConvertTo-RiftArch', 'Resolve-InstallArchitecture', 'Get-TargetName', 'Get-Target', 'Test-Avx2',
    'Test-PathEntry', 'Merge-PathEntry', 'Add-ToUserPath', 'Assert-Install') {
    if (-not $byName.ContainsKey($name)) {
        Write-Host "   FAIL  $name not found in install.ps1"
        exit 1
    }
}

# Build one fresh scriptblock per call so the extracted functions share a scope and stay isolated
# from the test harness itself. $OsArch goes through an [object], exactly like the real installer.
function Invoke-Resolve([string] $ProcArch, [string] $ProcArch6432, [object] $OsArch) {
    $block = [scriptblock]::Create(@(
        'param([string] $ProcArch, [string] $ProcArch6432, [object] $OsArch)',
        $byName['ConvertTo-RiftArch'],
        $byName['Resolve-InstallArchitecture'],
        'Resolve-InstallArchitecture -ProcessorArchitectureW6432 $ProcArch6432 -ProcessorArchitecture $ProcArch -OsArch $OsArch'
    ) -join "`n")
    & $block $ProcArch $ProcArch6432 $OsArch
}

function Test-Resolve([string] $ProcArch, [string] $ProcArch6432, [object] $OsArch, [string] $Expected, [string] $What) {
    try {
        $got = Invoke-Resolve $ProcArch $ProcArch6432 $OsArch
    } catch {
        Write-Host "   FAIL  $What`: threw unexpectedly: [$($_.Exception.Message)]"
        $script:fail++
        return
    }
    if ($got -ne $Expected) {
        Write-Host "   FAIL  $What`: expected [$Expected], got [$got]"
        $script:fail++
    } else {
        Write-Host "   PASS  $What"
        $script:pass++
    }
}

function Test-ResolveError([string] $ProcArch, [string] $ProcArch6432, [object] $OsArch, [string] $Match, [string] $What) {
    try {
        $null = Invoke-Resolve $ProcArch $ProcArch6432 $OsArch
    } catch {
        $msg = $_.Exception.Message
        if ($msg -match $Match) {
            Write-Host "   PASS  $What"
            $script:pass++
            return
        }
        Write-Host "   FAIL  $What`: error [$msg] did not match [$Match]"
        $script:fail++
        return
    }
    Write-Host "   FAIL  $What`: no error was thrown"
    $script:fail++
}

# --- artifact naming keeps its AVX2 behavior -----------------------------------------------------

function Invoke-TargetName([string] $Arch, [bool] $HasAvx2) {
    $block = [scriptblock]::Create(@(
        'param([string] $Arch, [bool] $HasAvx2)',
        $byName['Get-TargetName'],
        'Get-TargetName $Arch $HasAvx2'
    ) -join "`n")
    & $block $Arch $HasAvx2
}

Write-Host 'Artifact naming (AVX2 behavior preserved):'

Test-Result (Invoke-TargetName 'x64'   $true)  'windows-x64'          'x64 + AVX2 -> windows-x64'
Test-Result (Invoke-TargetName 'x64'   $false) 'windows-x64-baseline' 'x64 without AVX2 -> windows-x64-baseline'
Test-Result (Invoke-TargetName 'arm64' $true)  'windows-arm64'        'arm64 + AVX2 -> windows-arm64'
Test-Result (Invoke-TargetName 'arm64' $false) 'windows-arm64'        'arm64 without AVX2 -> windows-arm64 (AVX2 never consulted)'

# --- the environment variables are the primary source --------------------------------------------

Write-Host ''
Write-Host 'Environment variables are the primary source:'

Test-Resolve 'AMD64' ''      $null 'x64'   'PROCESSOR_ARCHITECTURE=AMD64, W6432 empty -> x64 (native x64)'
Test-Resolve 'AMD64' $null   $null 'x64'   'PROCESSOR_ARCHITECTURE=AMD64, W6432 unset -> x64'
Test-Resolve 'amd64' ''      $null 'x64'   'lowercase amd64 still maps to x64'
Test-Resolve 'ARM64' ''      $null 'arm64' 'PROCESSOR_ARCHITECTURE=ARM64, W6432 empty -> arm64 (native ARM64)'
Test-Resolve 'x86'   'AMD64' $null 'x64'   '32-bit PowerShell on x64 Windows (W6432=AMD64) -> x64'
Test-Resolve 'x86'   'ARM64' $null 'arm64' '32-bit PowerShell on ARM64 Windows (W6432=ARM64) -> arm64'
Test-Resolve 'ARM64' 'AMD64' $null 'x64'   'W6432 wins over PROCESSOR_ARCHITECTURE when they disagree'

# --- the exact real-world regression ---------------------------------------------------------------

Write-Host ''
Write-Host "The exact broken machine: OSArchitecture is null but Windows itself says AMD64/ARM64:"

Test-Resolve 'AMD64' ''  $null                        'x64'   'null OSArchitecture + PROCESSOR_ARCHITECTURE=AMD64 -> x64, must NOT throw'
Test-Resolve 'ARM64' ''  $null                        'arm64' 'null OSArchitecture + PROCESSOR_ARCHITECTURE=ARM64 -> arm64, must NOT throw'
Test-Resolve 'AMD64' $null $null                      'x64'   'null OSArchitecture + PROCESSOR_ARCHITECTURE=AMD64 + W6432 null -> x64'
Test-Resolve 'AMD64' ''  ([System.Runtime.InteropServices.Architecture]::X64) 'x64' 'null-safe: OSArchitecture X64 + env AMD64 -> x64 (env wins)'

# --- RuntimeInformation is only a secondary fallback -------------------------------------------------

Write-Host ''
Write-Host 'RuntimeInformation.OSArchitecture remains a secondary fallback:'

Test-Resolve ''     ''  ([System.Runtime.InteropServices.Architecture]::X64)   'x64'   'env empty + OSArchitecture=X64 -> x64'
Test-Resolve ''     ''  ([System.Runtime.InteropServices.Architecture]::Arm64) 'arm64' 'env empty + OSArchitecture=Arm64 -> arm64'
Test-Resolve ''     ''  'ARM64'                                                'arm64' 'env empty + OSArchitecture string "ARM64" -> arm64'
Test-Resolve 'IA64' ''  ([System.Runtime.InteropServices.Architecture]::X64)   'x64'   'unknown PROCESSOR_ARCHITECTURE falls back to OSArchitecture=X64'

# --- 32-bit Windows is rejected with a clear message -----------------------------------------------

Write-Host ''
Write-Host '32-bit Windows is rejected with a clear message:'

Test-ResolveError 'x86' '' $null '32-bit Windows is not supported' 'PROCESSOR_ARCHITECTURE=x86, W6432 empty -> clear 32-bit error'
Test-ResolveError 'x86' '' ([System.Runtime.InteropServices.Architecture]::X86) '32-bit Windows is not supported' 'x86 in both sources -> clear 32-bit error'

# --- total detection failure is a diagnostic error ----------------------------------------------------

Write-Host ''
Write-Host 'Total detection failure reports diagnostics, never the vague "Unsupported architecture: .":'

Test-ResolveError 'M68000' '' $null '^Could not determine the CPU architecture' 'unknown arch + null OSArchitecture -> detection failure'
Test-ResolveError 'M68000' '' $null 'PROCESSOR_ARCHITECTURE=\[M68000\]'       'failure message names PROCESSOR_ARCHITECTURE'
Test-ResolveError 'M68000' '' $null 'PROCESSOR_ARCHITEW6432=\[\]'              'failure message names PROCESSOR_ARCHITEW6432'
Test-ResolveError 'M68000' '' $null 'unavailable'                               'failure message reports null OSArchitecture as unavailable'
Test-ResolveError ''      '' $null '^Could not determine the CPU architecture' 'no source at all -> detection failure'

$diag = $null
try { $null = Invoke-Resolve 'M68000' '' $null } catch { $diag = $_.Exception.Message }
if ($diag -and $diag -notmatch 'Unsupported architecture') {
    Write-Host '   PASS  detection failure is not phrased as "Unsupported architecture"'
    $script:pass++
} else {
    Write-Host "   FAIL  detection failure came out as [$diag]"
    $script:fail++
}

# --- PATH merge: the decision logic, driven with injected strings (never the real registry) -------------

function Invoke-Merge([string] $UserPath, [string] $ProcessPath, [string] $Dir) {
    $block = [scriptblock]::Create(@(
        'param([AllowNull()][string] $UserPath, [AllowNull()][string] $ProcessPath, [string] $Dir)',
        $byName['Test-PathEntry'],
        $byName['Merge-PathEntry'],
        'Merge-PathEntry -UserPath $UserPath -ProcessPath $ProcessPath -Dir $Dir'
    ) -join "`n")
    & $block $UserPath $ProcessPath $Dir
}

Write-Host ''
Write-Host 'PATH merge (pure decision logic, injected strings):'

$m = Invoke-Merge 'C:\Windows' 'C:\Windows' 'C:\rift\bin'
Test-Result $m.Action       'added'           'path absent -> marked added'
Test-Result $m.UserPath     'C:\rift\bin;C:\Windows' 'path absent -> prepended to persistent user PATH, no duplicate'
Test-Result $m.ProcessPath  'C:\rift\bin;C:\Windows' 'path absent -> prepended to current process PATH'
Test-Result $m.InUserPath   $false            'path absent -> not counted as already present'

$m = Invoke-Merge 'C:\rift\bin;C:\Windows' 'C:\rift\bin;C:\Windows' 'C:\rift\bin'
Test-Result $m.Action       'already-present' 'path already present -> explicitly already-present, no rewrite'
Test-Result $m.UserPath     'C:\rift\bin;C:\Windows' 'path already present -> persistent PATH untouched (no duplicate)'

$m = Invoke-Merge 'c:\RIFT\BIN\;C:\w' 'C:\Windows' 'C:\rift\bin'
Test-Result $m.Action       'already-present' 'case + trailing-backslash variants count as the same entry'
Test-Result $m.InUserPath   $true             'case + trailing-backslash variants recognized present'
Test-Result $m.ProcessPath  'C:\rift\bin;C:\Windows' 'stale console lacking the entry is refreshed in-process'

$m = Invoke-Merge 'C:\rift\oldbin;C:\w' 'C:\Windows' 'C:\rift\bin'
Test-Result $m.Action       'added'           'stale/different RIFT directory is not mistaken for the real one'
Test-Result $m.UserPath     'C:\rift\bin;C:\rift\oldbin;C:\w' 'stale entry survives, real one added, no data loss'

$m = Invoke-Merge '' '' 'C:\rift\bin'
Test-Result $m.Action       'added'           'empty user PATH -> added'
Test-Result $m.UserPath     'C:\rift\bin'     'empty user PATH -> the single entry is the install dir'

$m = Invoke-Merge $null '' 'C:\rift\bin'
Test-Result $m.Action       'added'           'null user PATH -> added without error'
Test-Result $m.UserPath     'C:\rift\bin'     'null user PATH -> persisted value is just the install dir'

$m = Invoke-Merge 'C:\Windows' 'C:\rift\bin;C:\w' 'C:\rift\bin'
Test-Result $m.Action       'added'           'present only in current process -> still added to persistent PATH'
Test-Result $m.InProcPath   $true             'present only in current process -> process PATH already has it'

$m = Invoke-Merge 'C:\Program Files\Go' 'C:\Program Files\Go' 'C:\My Rift\bin'
Test-Result $m.Action       'added'           'install directory with spaces -> handled'
Test-Result $m.UserPath     'C:\My Rift\bin;C:\Program Files\Go' 'install directory with spaces -> persisted correctly'

$m = Invoke-Merge 'C:\Windows;C:\rift\bin' '' 'c:\rift\bin\'
Test-Result $m.Action       'already-present' 'trailing backslash on the install dir still matches an existing entry'

# --- Test-PathEntry directly -----------------------------------------------------------------------------

Write-Host ''
Write-Host 'Test-PathEntry (membership semantics):'

function Invoke-PathEntry([string] $Entry, [string] $Dir) {
    $block = [scriptblock]::Create(@(
        'param([string] $Entry, [string] $Dir)',
        $byName['Test-PathEntry'],
        'Test-PathEntry $Entry $Dir'
    ) -join "`n")
    & $block $Entry $Dir
}

Test-Result (Invoke-PathEntry 'C:\rift\bin'   'C:\rift\bin')   $true  'exact match -> true'
Test-Result (Invoke-PathEntry 'c:\rift\bin'   'C:\RIFT\BIN')   $true  'case differs -> true (Windows PATH is case-insensitive)'
Test-Result (Invoke-PathEntry 'C:\rift\bin\'  'C:\rift\bin')   $true  'trailing backslash ignored -> true'
Test-Result (Invoke-PathEntry 'C:\rift\bin2'  'C:\rift\bin')   $false 'different directory -> false'
Test-Result (Invoke-PathEntry ''              'C:\rift\bin')   $false 'empty entry -> false'
Test-Result (Invoke-PathEntry 'C:\rift\bin'   '')              $false 'empty dir -> false'

# --- Assert-Install: self-verification against the filesystem ---------------------------------------------

function Invoke-Assert([string] $Dir) {
    $block = [scriptblock]::Create(@(
        'param([string] $Dir)',
        $byName['Assert-Install'],
        'Assert-Install $Dir'
    ) -join "`n")
    & $block $Dir
}

Write-Host ''
Write-Host 'Assert-Install (self-verification of what was written):'

$probeDir = Join-Path ([System.IO.Path]::GetTempPath()) "rift-assert-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
try {
    $missing = $false
    try { $null = Invoke-Assert $probeDir } catch { $missing = $true }
    if ($missing) {
        Write-Host '   PASS  Assert-Install fails when the directory is empty'
        $script:pass++
    } else {
        Write-Host '   FAIL  Assert-Install passed on an empty directory'
        $script:fail++
    }

    Set-Content -Path (Join-Path $probeDir 'rift.exe') -Encoding ASCII -Value 'x'
    $missingExe = $false
    try { $null = Invoke-Assert $probeDir } catch { $missingExe = $true }
    if ($missingExe) {
        Write-Host '   PASS  Assert-Install fails when opencode.cmd is missing'
        $script:pass++
    } else {
        Write-Host '   FAIL  Assert-Install passed with only rift.exe present'
        $script:fail++
    }

    Set-Content -Path (Join-Path $probeDir 'opencode.cmd') -Encoding ASCII -Value '@echo off'
    try {
        $null = Invoke-Assert $probeDir
        Write-Host '   PASS  Assert-Install verifies both rift.exe and opencode.cmd exist'
        $script:pass++
    } catch {
        Write-Host "   FAIL  Assert-Install rejected a complete install: [$($_.Exception.Message)]"
        $script:fail++
    }
} finally {
    Remove-Item $probeDir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- end to end: -NoModifyPath must leave the real user PATH untouched but still install -------------------

Write-Host ''
Write-Host 'End to end (-NoModifyPath installs binaries, leaves the real user PATH alone):'

$fake = Join-Path ([System.IO.Path]::GetTempPath()) "rift-fake-$(Get-Random).exe"
$CopyProbe = Join-Path $env:SystemRoot 'System32\where.exe'
if (Test-Path $CopyProbe) { Copy-Item $CopyProbe $fake -Force }
$e2eDir = Join-Path ([System.IO.Path]::GetTempPath()) "rift-e2e-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $e2eDir | Out-Null
$userPathBefore = [Environment]::GetEnvironmentVariable('Path', 'User')
try {
    if (-not (Test-Path $fake)) {
        Write-Host '   SKIP  (where.exe unavailable; end-to-end install not run)'
    } else {
        $inst = & $installer -BinaryPath $fake -InstallDir $e2eDir -NoModifyPath 6>&1 2>&1 | Out-String
        if ((Test-Path -LiteralPath (Join-Path $e2eDir 'rift.exe')) -and
            (Test-Path -LiteralPath (Join-Path $e2eDir 'opencode.cmd'))) {
            Write-Host '   PASS  -NoModifyPath still produces rift.exe and opencode.cmd'
            $script:pass++
        } else {
            Write-Host '   FAIL  -NoModifyPath install did not produce rift.exe and opencode.cmd'
            $script:fail++
        }
        if ($inst -match 'Installed RIFT to:') {
            Write-Host '   PASS  installer states the install location'
            $script:pass++
        } else {
            Write-Host '   FAIL  installer output has no explicit install location'
            $script:fail++
        }
        if ($inst -match 'PATH was left unchanged') {
            Write-Host '   PASS  -NoModifyPath says the PATH was left unchanged'
            $script:pass++
        } else {
            Write-Host '   FAIL  -NoModifyPath does not state PATH handling'
            $script:fail++
        }
        $after = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($after -eq $userPathBefore) {
            Write-Host '   PASS  -NoModifyPath left the persistent user PATH untouched'
            $script:pass++
        } else {
            Write-Host '   FAIL  -NoModifyPath modified the persistent user PATH'
            $script:fail++
        }
    }
} finally {
    Remove-Item $fake -Force -ErrorAction SilentlyContinue
    Remove-Item $e2eDir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- mechanism guards: the two previous bugs must not come back --------------------------------------

Write-Host ''
Write-Host 'Mechanism guards:'

$buggy = $byName['Resolve-InstallArchitecture'] -match 'OSArchitecture\s*\.\s*ToString' -or
         $byName['Get-Target'] -match 'OSArchitecture\s*\.\s*ToString'
if ($buggy) {
    Write-Host '   FAIL  the installer must never call .ToString() on RuntimeInformation.OSArchitecture itself'
    $script:fail++
} else {
    Write-Host '   PASS  no direct .ToString() on OSArchitecture (this was the crash)'
    $script:pass++
}

$gt = $byName['Get-Target']
$i6432 = $gt.IndexOf('PROCESSOR_ARCHITEW6432')
$iArch = $gt.IndexOf('PROCESSOR_ARCHITECTURE')
if ($i6432 -ge 0 -and $iArch -ge 0 -and $i6432 -lt $iArch) {
    Write-Host '   PASS  PROCESSOR_ARCHITEW6432 is consulted before PROCESSOR_ARCHITECTURE'
    $script:pass++
} else {
    Write-Host "   FAIL  W6432 must be read before PROCESSOR_ARCHITECTURE (found $i6432 / $iArch)"
    $script:fail++
}

# --- the real machine must always resolve successfully -------------------------------------------------

Write-Host ''
Write-Host 'The real machine (whatever this host is) must always resolve:'

$realBlock = [scriptblock]::Create(@(
    $byName['ConvertTo-RiftArch'],
    $byName['Resolve-InstallArchitecture'],
    $byName['Get-TargetName'],
    $byName['Get-Target'],
    $byName['Test-Avx2'],
    'Get-Target'
) -join "`n")
try {
    $real = & $realBlock
} catch {
    Write-Host "   FAIL  Get-Target on this host threw: [$($_.Exception.Message)]"
    $script:fail++
    $real = ''
}
if ($real -match '^windows-(x64(-baseline)?|arm64)$') {
    Write-Host "   PASS  Get-Target on this host -> $real"
    $script:pass++
} elseif ($real) {
    Write-Host "   FAIL  Get-Target on this host returned an unexpected value: [$real]"
    $script:fail++
}

Write-Host ''
Write-Host "RESULT: $($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }