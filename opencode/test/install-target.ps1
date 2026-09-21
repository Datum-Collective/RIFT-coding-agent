<#
.SYNOPSIS
    Regression tests for the Windows architecture detection in opencode/install.ps1.

.DESCRIPTION
    Get-Target picks the release artifact for an x64 or arm64 Windows machine. It used to ask
    RuntimeInformation.OSArchitecture and switch on the raw enum; a later fix normalized that enum to
    a string. Neither works on a Windows install where OSArchitecture itself is $null: .ToString()
    then dies with "You cannot call a method on a null-valued expression" and the installer reports
    "Unsupported architecture: ." on a perfectly ordinary x64 machine.

    The installer now reads Windows' own PROCESSOR_ARCHITEW6432 / PROCESSOR_ARCHITECTURE environment
    variables first - W6432 ahead of PROCESSOR_ARCHITECTURE, so a 32-bit PowerShell running on 64-bit
    Windows (which reports ARCHITECTURE=x86) still selects the x64 build - and only falls back to
    RuntimeInformation.OSArchitecture when the environment says nothing usable, with an explicit
    $null check on that value.

    These tests pull the detection functions out of install.ps1 and drive them with injected values,
    so every branch - including a $null OSArchitecture and the exact values observed on the machine
    that reported the bug - is reproduced regardless of the architecture of the machine this runs on.

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

foreach ($name in 'ConvertTo-RiftArch', 'Resolve-InstallArchitecture', 'Get-TargetName', 'Get-Target', 'Test-Avx2') {
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