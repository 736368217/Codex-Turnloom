#requires -Version 5.1
<#
.SYNOPSIS
  Encrypt the APK signing keystore into this folder (only when the signing material changes).

.DESCRIPTION
  Output format: magic "TLKS1" + 16B salt + 16B IV + AES-256-CBC(PKCS7) ciphertext.
  The key is derived from the passphrase with PBKDF2-SHA256 (200000 rounds).
  The passphrase is never stored in this repository.

  ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI.

.EXAMPLE
  .\encrypt-signing.ps1 -Keystore "$env:USERPROFILE\.android\debug.keystore" -OutPath .\turnloom-debug.keystore.enc
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Keystore,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [Parameter(Mandatory = $true)][string]$Passphrase
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $Keystore -PathType Leaf)) { throw "keystore not found: $Keystore" }
if ($Passphrase.Length -lt 12) { throw 'passphrase must be at least 12 characters' }

$plain = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Keystore).Path)

$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$salt = New-Object byte[] 16
$iv = New-Object byte[] 16
$rng.GetBytes($salt)
$rng.GetBytes($iv)

$kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes(
  $Passphrase, $salt, 200000, [Security.Cryptography.HashAlgorithmName]::SHA256)
$key = $kdf.GetBytes(32)

$aes = [Security.Cryptography.Aes]::Create()
$aes.Mode = [Security.Cryptography.CipherMode]::CBC
$aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
$aes.Key = $key
$aes.IV = $iv
$cipher = $aes.CreateEncryptor().TransformFinalBlock($plain, 0, $plain.Length)

$magic = [Text.Encoding]::ASCII.GetBytes('TLKS1')
$out = New-Object byte[] ($magic.Length + $salt.Length + $iv.Length + $cipher.Length)
[Array]::Copy($magic, 0, $out, 0, $magic.Length)
[Array]::Copy($salt, 0, $out, $magic.Length, $salt.Length)
[Array]::Copy($iv, 0, $out, $magic.Length + $salt.Length, $iv.Length)
[Array]::Copy($cipher, 0, $out, $magic.Length + $salt.Length + $iv.Length, $cipher.Length)

$target = [IO.Path]::GetFullPath($OutPath)
$dir = Split-Path -Parent $target
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[IO.File]::WriteAllBytes($target, $out)
Write-Host ("encrypted -> {0} ({1} bytes); plaintext sha256 {2}" -f $target, $out.Length,
  (Get-FileHash -LiteralPath $Keystore -Algorithm SHA256).Hash.ToLowerInvariant())
