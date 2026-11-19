#requires -Version 5.1
<#
.SYNOPSIS
  Restore the APK signing keystore from the encrypted copy in this folder.

.DESCRIPTION
  Reads turnloom-debug.keystore.enc (TLKS1: magic + 16B salt + 16B IV + AES-256-CBC/PKCS7,
  key = PBKDF2-SHA256(passphrase, salt, 200000, 32)) and writes a keystore file.
  Default target is %USERPROFILE%\.android\debug.keystore, which is the build script default.

  ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI, so non-ASCII
  text in a script file can corrupt the parser. All Chinese notes live in README.md.

.EXAMPLE
  .\restore-signing.ps1                       # prompts for the passphrase
.EXAMPLE
  .\restore-signing.ps1 -KeystorePath D:\keys\turnloom.keystore -Force
#>
[CmdletBinding()]
param(
  [string]$SourcePath,
  [string]$KeystorePath,
  [string]$Passphrase,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $SourcePath) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $SourcePath = Join-Path $here 'turnloom-debug.keystore.enc'
}
if (-not $KeystorePath) { $KeystorePath = Join-Path $env:USERPROFILE '.android\debug.keystore' }

if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) { throw "encrypted keystore not found: $SourcePath" }
if (-not $Passphrase) {
  $secure = Read-Host -AsSecureString 'signing passphrase'
  $Passphrase = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if (-not $Passphrase) { throw 'passphrase is required' }

$blob = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $SourcePath).Path)
$magic = [Text.Encoding]::ASCII.GetBytes('TLKS1')
if ($blob.Length -lt ($magic.Length + 32)) { throw 'encrypted keystore is truncated' }
for ($i = 0; $i -lt $magic.Length; $i++) {
  if ($blob[$i] -ne $magic[$i]) { throw 'not a TLKS1 encrypted keystore' }
}

$salt = New-Object byte[] 16
$iv = New-Object byte[] 16
[Array]::Copy($blob, $magic.Length, $salt, 0, 16)
[Array]::Copy($blob, $magic.Length + 16, $iv, 0, 16)
$cipherLength = $blob.Length - $magic.Length - 32
$cipher = New-Object byte[] $cipherLength
[Array]::Copy($blob, $magic.Length + 32, $cipher, 0, $cipherLength)

$kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes(
  $Passphrase, $salt, 200000, [Security.Cryptography.HashAlgorithmName]::SHA256)
$aes = [Security.Cryptography.Aes]::Create()
$aes.Mode = [Security.Cryptography.CipherMode]::CBC
$aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
$aes.Key = $kdf.GetBytes(32)
$aes.IV = $iv
try {
  $plain = $aes.CreateDecryptor().TransformFinalBlock($cipher, 0, $cipher.Length)
} catch {
  throw 'wrong passphrase, or the encrypted file is corrupted'
}

$target = [IO.Path]::GetFullPath($KeystorePath)
if ((Test-Path -LiteralPath $target) -and -not $Force) {
  throw "keystore already exists: $target (add -Force to overwrite)"
}
$dir = Split-Path -Parent $target
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[IO.File]::WriteAllBytes($target, $plain)

$hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "restored -> $target ($($plain.Length) bytes)"
Write-Host "sha256   = $hash"
Write-Host 'alias    = androiddebugkey'
Write-Host 'Next, build with:'
Write-Host '  $env:TURNLOOM_STORE_PASS="android"; $env:TURNLOOM_KEY_PASS="android"'
Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-single-app.ps1 -OutDir <dir>'
