<#
.SYNOPSIS
    Regression tests for the architecture detection in opencode/install.ps1.

.DESCRIPTION
    Get-Target maps the OS architecture to the artifact name. It used to feed the raw
    System.Runtime.InteropServices.Architecture enum straight into a switch(), and on some machines
    the stringified form did not match 'X64' or 'Arm64', so the default case fired and the install
    died with "Unsupported architecture" even though the machine was an ordinary x64 box.

    Get-Target must instead normalize the enum to a stable string before the switch. These tests
    extract that function out of install.ps1 and drive it with injected architectures, so the
    results are the same whether this runs on an x64, an Arm64, or a CI worker. They also assert the
    normalization is actually present in the shipped source, so a revert to matching the raw enum is
    caught even on a machine where the quirk does not reproduce.

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

# --- pull Get-Target out of the installer -------------------------------------------------------

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors) {
    $errors | ForEach-Object { Write-Host "   FAIL  install.ps1 failed to parse: $($_.Message)" }
    $script:fail++
    exit 1
}

$getTarget = $ast.FindAll(
    { param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] },
    $true
) | Where-Object { $_.Name -eq 'Get-Target' } | Select-Object -First 1
if (-not $getTarget) {
    Write-Host '   FAIL  Get-Target not found in install.ps1'
    exit 1
}
$getTargetSrc = $getTarget.Extent.Text

# The test owns the architecture, so swap the real OS lookup for a parameter of the enclosing
# scope. The .ToString() normalization is deliberately left in place and is exercised for real.
$testSrc = $getTargetSrc -replace '\[System\.Runtime\.InteropServices\.RuntimeInformation\]::OSArchitecture', '$Arch'

function Invoke-Target([object] $Arch, [bool] $HasAvx2) {
    # Runs in a fresh scriptblock so Get-Target resolves Test-Avx2 and $Arch from one scope, and
    # Get-Target is invoked at the end so the scriptblock returns its result.
    $block = [scriptblock]::Create(@(
        'param([object] $Arch, [bool] $HasAvx2)',
        'function Test-Avx2 { return $HasAvx2 }',
        $testSrc,
        'Get-Target'
    ) -join "`n")
    return & $block $Arch $HasAvx2
}

function Invoke-TargetError([object] $Arch, [bool] $HasAvx2) {
    $threw = $false
    $msg = ''
    try {
        $null = Invoke-Target $Arch $HasAvx2
    } catch {
        $threw = $true
        $msg = $_.Exception.Message
    }
    return @($threw, $msg)
}

# --- the exact failure mode: an enum value, normalised to a string, still selects the right build --

Write-Host 'Architecture selection (raw enum values, exactly what RuntimeInformation returns):'

Test-Result (Invoke-Target ([System.Runtime.InteropServices.Architecture]::X64)        $true)  'windows-x64'          'X64 + AVX2 -> windows-x64'
Test-Result (Invoke-Target ([System.Runtime.InteropServices.Architecture]::X64)        $false) 'windows-x64-baseline' 'X64 without AVX2 -> windows-x64-baseline'
Test-Result (Invoke-Target ([System.Runtime.InteropServices.Architecture]::Arm64)      $false) 'windows-arm64'        'Arm64 -> windows-arm64'
Test-Result (Invoke-Target ([System.Runtime.InteropServices.Architecture]::Arm64)      $true)  'windows-arm64'        'Arm64 -> windows-arm64 (AVX2 never consulted)'
Test-Result (Invoke-Target 'X64'                                                       $true)  'windows-x64'          'a plain "X64" string still matches after normalization'

Write-Host 'Anything else is a clear, explicit error:'

$bad = Invoke-TargetError ([System.Runtime.InteropServices.Architecture]::X86) $true
if (-not $bad[0]) { Write-Host '   FAIL  X86 did not throw'; $script:fail++ }
elseif ($bad[1] -notmatch '^Unsupported architecture: X86\.?' -or $bad[1] -notmatch 'ships x64 and arm64 builds') {
    Write-Host "   FAIL  X86 error was not clear: [$($bad[1])]"
    $script:fail++
} else {
    Write-Host "   PASS  X86 -> 'Unsupported architecture' with the architecture named"
    $script:pass++
}

# An undefined member (a future Architecture value) must also be rejected rather than guessed at.
$future = [System.Enum]::ToObject([System.Runtime.InteropServices.Architecture], 999)
$bad = Invoke-TargetError $future $true
if (-not $bad[0]) { Write-Host '   FAIL  unknown architecture 999 did not throw'; $script:fail++ }
elseif ($bad[1] -notmatch 'Unsupported architecture') {
    Write-Host "   FAIL  unknown architecture 999 gave an unclear error: [$($bad[1])]"
    $script:fail++
} else {
    Write-Host '   PASS  unknown architecture 999 -> clear "Unsupported architecture" error'
    $script:pass++
}

# --- the real machine (whatever this host is) must never hit the unsupported path -----------------

$testAvx2 = $ast.FindAll(
    { param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] },
    $true
) | Where-Object { $_.Name -eq 'Test-Avx2' } | Select-Object -First 1
$realBlock = [scriptblock]::Create(@($testAvx2.Extent.Text, $getTargetSrc, 'Get-Target') -join "`n")
$real = & $realBlock
if ($real -notmatch '^windows-(x64(-baseline)?|arm64)$') {
    Write-Host "   FAIL  Get-Target on this host returned an unexpected value: [$real]"
    $script:fail++
} else {
    Write-Host "   PASS  Get-Target on this host -> $real"
    $script:pass++
}

# --- the regression guard: the enum must be normalized to a string before switch() ----------------
# Behavioral tests cannot tell the old code from the fix on every machine (mostly the raw enum does
# stringify to 'X64' and matches). These tests therefore also pin the mechanism: Get-Target as
# shipped must call .ToString() on the architecture value instead of switching on the raw enum.

$guard = $getTargetSrc -match 'OSArchitecture\s*\.\s*ToString\s*\(\s*\)' -or
         $getTargetSrc -match '\$osArch\s*\.\s*ToString\s*\(\s*\)'
if ($guard) {
    Write-Host '   PASS  Get-Target normalizes the architecture enum to a string before switch()'
    $script:pass++
} else {
    Write-Host '   FAIL  Get-Target appears to switch on the raw Architecture enum; this is the exact bug install-target.ps1 guards against.'
    $script:fail++
}

Write-Host ''
Write-Host "RESULT: $($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }