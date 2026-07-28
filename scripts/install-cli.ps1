$ErrorActionPreference = 'Stop'

$repository = 'atharva-again/Markdawn'
$releaseBaseURL = "https://github.com/$repository/releases"
$installDir = if ($env:MARKDAWN_INSTALL_DIR) { $env:MARKDAWN_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Markdawn\bin' }
$requestedVersion = $env:MARKDAWN_VERSION
$modifyPath = $env:MARKDAWN_MODIFY_PATH -eq '1'
$httpTimeoutSeconds = $env:MARKDAWN_HTTP_TIMEOUT_SECONDS
$maxReleaseArchiveBytes = 256MB
$maxReleaseBinaryBytes = 128MB
$maxReleaseArchiveEntries = 1024
$maxReleaseZipDirectoryBytes = 8MB

function Fail([string]$Message) {
  throw "markdawn installer: $Message"
}

function Download-ReleaseAsset([string]$Uri, [string]$Path, [long]$MaximumBytes, [int]$TimeoutSeconds, [string]$Label) {
  Add-Type -AssemblyName System.Net.Http
  $client = [Net.Http.HttpClient]::new()
  if ($TimeoutSeconds -gt 0) { $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds) } else { $client.Timeout = [Threading.Timeout]::InfiniteTimeSpan }
  $response = $null
  try {
    $response = $client.GetAsync($Uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { Fail "could not download ${Label}: unexpected HTTP status $($response.StatusCode)" }
    $contentLength = $response.Content.Headers.ContentLength
    if ($null -ne $contentLength -and $contentLength -gt $MaximumBytes) { Fail "$Label exceeds $MaximumBytes bytes" }
    $source = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    try {
      $destination = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try {
        $buffer = New-Object byte[] 81920
        [long]$written = 0
        while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $written += $read
          if ($written -gt $MaximumBytes) { Fail "$Label exceeds $MaximumBytes bytes" }
          $destination.Write($buffer, 0, $read)
        }
      } finally {
        $destination.Dispose()
      }
    } finally {
      $source.Dispose()
    }
  } finally {
    if ($null -ne $response) { $response.Dispose() }
    $client.Dispose()
  }
}

function Assert-ReleaseZipDirectory([string]$Path) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    if ($stream.Length -lt 22) { Fail 'release ZIP end record is missing' }
    $windowLength = [Math]::Min([int64]65557, $stream.Length)
    $stream.Seek(-$windowLength, [IO.SeekOrigin]::End) | Out-Null
    $buffer = New-Object byte[] $windowLength
    $offset = 0
    while ($offset -lt $buffer.Length) {
      $read = $stream.Read($buffer, $offset, $buffer.Length - $offset)
      if ($read -le 0) { Fail 'could not read release ZIP end record' }
      $offset += $read
    }
    for ($index = $buffer.Length - 22; $index -ge 0; $index--) {
      if ($buffer[$index] -ne 0x50 -or $buffer[$index + 1] -ne 0x4b -or $buffer[$index + 2] -ne 0x05 -or $buffer[$index + 3] -ne 0x06) { continue }
      $commentLength = [BitConverter]::ToUInt16($buffer, $index + 20)
      if ($index + 22 + $commentLength -ne $buffer.Length) { continue }
      $entries = [BitConverter]::ToUInt16($buffer, $index + 10)
      $directorySize = [BitConverter]::ToUInt32($buffer, $index + 12)
      $directoryOffset = [BitConverter]::ToUInt32($buffer, $index + 16)
      if ($entries -eq 0xffff -or $directorySize -eq 0xffffffff -or $directoryOffset -eq 0xffffffff) { Fail 'release ZIP archive uses unsupported ZIP64 metadata' }
      if ($entries -gt $maxReleaseArchiveEntries) { Fail "release ZIP archive contains more than $maxReleaseArchiveEntries entries" }
      if ($directorySize -gt $maxReleaseZipDirectoryBytes) { Fail "release ZIP central directory exceeds $maxReleaseZipDirectoryBytes bytes" }
      $directoryEnd = [uint64]$directoryOffset + [uint64]$directorySize
      $endRecordOffset = [uint64]($stream.Length - $windowLength + $index)
      if ($directoryEnd -gt $endRecordOffset) { Fail 'release ZIP central directory is invalid' }
      return
    }
    Fail 'release ZIP end record is missing'
  } finally {
    $stream.Dispose()
  }
}

function Extract-ReleaseBinary([string]$ArchivePath, [string]$DestinationPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  Assert-ReleaseZipDirectory $ArchivePath
  $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $entries = @($archive.Entries | Where-Object { $_.FullName -ceq 'markdawn.exe' })
    if ($entries.Count -ne 1) { Fail 'release archive must contain exactly one markdawn.exe binary' }
    $entry = $entries[0]
    $unixFileType = ($entry.ExternalAttributes -shr 16) -band 0xf000
    if ($entry.FullName.EndsWith('/') -or ($unixFileType -ne 0 -and $unixFileType -ne 0x8000)) { Fail 'release archive markdawn.exe entry is not a regular file' }
    if ($entry.Length -gt $maxReleaseBinaryBytes) { Fail "release binary exceeds $maxReleaseBinaryBytes bytes" }
    if ($entry.CompressedLength -gt $maxReleaseArchiveBytes) { Fail "compressed release binary exceeds $maxReleaseArchiveBytes bytes" }
    $source = $entry.Open()
    try {
      $destination = [IO.File]::Open($DestinationPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try {
        $buffer = New-Object byte[] 81920
        [long]$written = 0
        while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $written += $read
          if ($written -gt $maxReleaseBinaryBytes) { Fail "release binary exceeds $maxReleaseBinaryBytes bytes" }
          $destination.Write($buffer, 0, $read)
        }
        if ($written -ne $entry.Length) { Fail 'release archive markdawn.exe entry has an invalid length' }
      } finally {
        $destination.Dispose()
      }
    } finally {
      $source.Dispose()
    }
  } finally {
    $archive.Dispose()
  }
}

if ($requestedVersion -and $requestedVersion -notmatch '^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
  Fail 'MARKDAWN_VERSION must be a semantic version such as v1.2.3'
}
$parsedHttpTimeoutSeconds = 0
if ($httpTimeoutSeconds -and (-not [int]::TryParse($httpTimeoutSeconds, [ref]$parsedHttpTimeoutSeconds) -or $parsedHttpTimeoutSeconds -le 0)) { Fail 'MARKDAWN_HTTP_TIMEOUT_SECONDS must be a positive 32-bit integer' }

$installDir = [IO.Path]::GetFullPath($installDir)
if ($modifyPath -and $installDir.Contains([IO.Path]::PathSeparator)) { Fail 'MARKDAWN_INSTALL_DIR must not contain the PATH separator when --modify-path is enabled' }
$stateDir = if ($env:MARKDAWN_INSTALL_STATE_DIR) { $env:MARKDAWN_INSTALL_STATE_DIR } else { Join-Path $env:LOCALAPPDATA 'Markdawn' }
$stateDir = [IO.Path]::GetFullPath($stateDir)

$architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
switch ($architecture.ToUpperInvariant()) {
  'AMD64' { $goarch = 'amd64' }
  'ARM64' { $goarch = 'arm64' }
  default { Fail "unsupported architecture: $architecture" }
}

if ($requestedVersion) {
  $version = $requestedVersion.TrimStart('v')
  $archive = "markdawn_${version}_windows_${goarch}.zip"
  $downloadBase = "$releaseBaseURL/download/cli/v$version"
} else {
  $archive = "markdawn_windows_${goarch}.zip"
  $downloadBase = "$releaseBaseURL/latest/download"
}

$temporaryDir = Join-Path ([IO.Path]::GetTempPath()) ("markdawn-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryDir | Out-Null
$finalizerBinary = $null

try {
  $archivePath = Join-Path $temporaryDir $archive
  $checksumsPath = Join-Path $temporaryDir 'checksums.txt'
  Download-ReleaseAsset "$downloadBase/$archive" $archivePath $maxReleaseArchiveBytes $parsedHttpTimeoutSeconds $archive
  Download-ReleaseAsset "$downloadBase/checksums.txt" $checksumsPath 1MB $parsedHttpTimeoutSeconds 'checksums.txt'

  $checksumLines = @(Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match ("\s\s" + [Regex]::Escape($archive) + '$') })
  if ($checksumLines.Count -ne 1) { Fail "checksums.txt must contain exactly one entry for $archive" }
  $checksumLine = $checksumLines[0]
  $expectedChecksum = ($checksumLine -split '\s+')[0]
  if ($expectedChecksum -notmatch '^[0-9a-fA-F]{64}$') { Fail "checksums.txt contains an invalid SHA-256 value for $archive" }
  if ($checksumLine -cne "$expectedChecksum  $archive") { Fail "checksums.txt contains an invalid entry for $archive" }
  $actualChecksum = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash
  if ($actualChecksum -ne $expectedChecksum) { Fail "SHA-256 verification failed for $archive" }

  $newBinary = Join-Path $temporaryDir 'markdawn.exe'
  Extract-ReleaseBinary $archivePath $newBinary
  if (Test-Path -LiteralPath $installDir) {
    if (-not (Test-Path -LiteralPath $installDir -PathType Container)) { Fail "$installDir exists and is not a directory" }
  } else {
    New-Item -ItemType Directory -Path $installDir -ErrorAction Stop | Out-Null
  }
  $finalizerBinary = Join-Path $installDir (".markdawn-finalize-" + [Guid]::NewGuid().ToString('N') + '.exe')
  Copy-Item -LiteralPath $newBinary -Destination $finalizerBinary -ErrorAction Stop
  $previousStateDir = $env:MARKDAWN_INSTALL_STATE_DIR
  $env:MARKDAWN_INSTALL_STATE_DIR = $stateDir
  try {
    if ($modifyPath) {
      $pathFile = if ($env:MARKDAWN_PROFILE_PATH) { [IO.Path]::GetFullPath($env:MARKDAWN_PROFILE_PATH) } else { $PROFILE.CurrentUserAllHosts }
      & $finalizerBinary standalone-finalize --install-dir $installDir --path-file $pathFile --path-style powershell
    } else {
      & $finalizerBinary standalone-finalize --install-dir $installDir
    }
    if ($LASTEXITCODE -ne 0) { Fail 'could not finalize standalone installation' }
  } finally {
    if ($null -eq $previousStateDir) { Remove-Item Env:MARKDAWN_INSTALL_STATE_DIR -ErrorAction SilentlyContinue } else { $env:MARKDAWN_INSTALL_STATE_DIR = $previousStateDir }
  }
  Write-Output "Markdawn installed to $(Join-Path $installDir 'markdawn.exe')"
  if ($modifyPath) { Write-Output 'Updated PowerShell PATH configuration.' } else { Write-Output "Add $installDir to your PATH, then run: markdawn login" }
} finally {
  if ($finalizerBinary -and (Test-Path -LiteralPath $finalizerBinary)) { Remove-Item -LiteralPath $finalizerBinary -Force -ErrorAction Stop }
  if (Test-Path -LiteralPath $temporaryDir) { Remove-Item -LiteralPath $temporaryDir -Recurse -Force }
}
