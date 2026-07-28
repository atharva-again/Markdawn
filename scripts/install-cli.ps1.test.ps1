$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$installerSource = Join-Path $repositoryRoot 'scripts/install-cli.ps1'
$installer = $installerSource
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('markdawn-installer-test-' + [Guid]::NewGuid().ToString('N'))
$script:archiveEntries = @([PSCustomObject]@{ Name = 'markdawn.exe'; Contents = 'test binary' })
$script:malformedArchive = $false
$script:oversizedArchive = $false
$script:finalizerBinary = $null
$assetRoot = Join-Path $testRoot 'assets'
$assetDirectory = Join-Path $assetRoot 'latest/download'
$serverJob = $null

function Write-OversizedZip([string]$Path) {
  $name = [Text.Encoding]::ASCII.GetBytes('markdawn.exe')
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $writer = New-Object IO.BinaryWriter($stream)
    try {
      $writer.Write([uint32]0x04034b50)
      $writer.Write([uint16]20); $writer.Write([uint16]0); $writer.Write([uint16]0); $writer.Write([uint16]0); $writer.Write([uint16]0)
      $writer.Write([uint32]0); $writer.Write([uint32]0); $writer.Write([uint32]0)
      $writer.Write([uint16]$name.Length); $writer.Write([uint16]0); $writer.Write($name)
      $centralOffset = 30 + $name.Length
      $writer.Write([uint32]0x02014b50)
      $writer.Write([uint16]20); $writer.Write([uint16]20); $writer.Write([uint16]0); $writer.Write([uint16]0); $writer.Write([uint16]0); $writer.Write([uint16]0)
      $writer.Write([uint32]0); $writer.Write([uint32]0); $writer.Write([uint32]134217729)
      $writer.Write([uint16]$name.Length); $writer.Write([uint16]0); $writer.Write([uint16]0); $writer.Write([uint16]0); $writer.Write([uint16]0)
      $writer.Write([uint32]0); $writer.Write([uint32]0); $writer.Write($name)
      $writer.Write([uint32]0x06054b50)
      $writer.Write([uint16]0); $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
      $writer.Write([uint32](46 + $name.Length)); $writer.Write([uint32]$centralOffset); $writer.Write([uint16]0)
    } finally {
      $writer.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Publish-TestAssets {
  New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null
  $archivePath = Join-Path $assetDirectory 'markdawn_windows_amd64.zip'
  if ($script:malformedArchive) {
    [IO.File]::WriteAllBytes($archivePath, [byte[]]@(0x50, 0x4b, 0x03))
  } elseif ($script:oversizedArchive) {
    Write-OversizedZip $archivePath
  } else {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stream = [IO.File]::Open($archivePath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
      $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
      try {
        foreach ($archiveEntry in $script:archiveEntries) {
          $entry = $zip.CreateEntry($archiveEntry.Name)
          $entryStream = $entry.Open()
          try {
            if ($archiveEntry.Name -eq 'markdawn.exe' -and $null -ne $script:finalizerBinary) {
              $bytes = [IO.File]::ReadAllBytes($script:finalizerBinary)
              $entryStream.Write($bytes, 0, $bytes.Length)
            } else {
              $writer = New-Object IO.StreamWriter($entryStream, [Text.UTF8Encoding]::new($false))
              try { $writer.Write($archiveEntry.Contents) } finally { $writer.Dispose() }
              $entryStream = $null
            }
          } finally {
            if ($null -ne $entryStream) { $entryStream.Dispose() }
          }
        }
      } finally {
        $zip.Dispose()
      }
    } finally {
      $stream.Dispose()
    }
  }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText((Join-Path $assetDirectory 'checksums.txt'), "$hash  markdawn_windows_amd64.zip`n", [Text.UTF8Encoding]::new($false))
}

function Start-TestServer {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  $serverJob = Start-Job -ScriptBlock {
    param([string]$Prefix, [string]$Root)
    $listener = [Net.HttpListener]::new()
    $listener.Prefixes.Add($Prefix)
    $listener.Start()
    Write-Output 'ready'
    try {
      while ($true) {
        $context = $listener.GetContext()
        $path = switch ($context.Request.Url.AbsolutePath) {
          '/latest/download/markdawn_windows_amd64.zip' { Join-Path $Root 'markdawn_windows_amd64.zip' }
          '/latest/download/checksums.txt' { Join-Path $Root 'checksums.txt' }
          default { $null }
        }
        if ($null -eq $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
          $context.Response.StatusCode = 404
        } else {
          $bytes = [IO.File]::ReadAllBytes($path)
          $context.Response.ContentLength64 = $bytes.Length
          $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        $context.Response.Close()
      }
    } finally {
      $listener.Close()
    }
  } -ArgumentList "http://127.0.0.1:$port/", $assetDirectory
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (@(Receive-Job $serverJob -Keep -ErrorAction Stop) -contains 'ready') { break }
    Start-Sleep -Milliseconds 25
  }
  if (@(Receive-Job $serverJob -Keep -ErrorAction Stop) -notcontains 'ready') { throw 'test release server did not start' }
  return @{ Job = $serverJob; BaseURL = "http://127.0.0.1:$port" }
}

try {
  $script:finalizerBinary = Join-Path $testRoot 'markdawn.exe'
  Push-Location (Join-Path $repositoryRoot 'cli')
  try { & go build -o $script:finalizerBinary . } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw 'could not build standalone finalizer fixture' }
  Publish-TestAssets
  $server = Start-TestServer
  $serverJob = $server.Job
  $installer = Join-Path $testRoot 'install-cli.ps1'
  $installerContents = Get-Content -LiteralPath $installerSource -Raw
  $installerContents = $installerContents.Replace('$releaseBaseURL = "https://github.com/$repository/releases"', "`$releaseBaseURL = '$($server.BaseURL)'")
  [IO.File]::WriteAllText($installer, $installerContents, [Text.UTF8Encoding]::new($false))
  $installDir = Join-Path $testRoot 'bin'
  $stateDir = Join-Path $testRoot 'state'
  $env:MARKDAWN_INSTALL_DIR = $installDir
  $env:MARKDAWN_INSTALL_STATE_DIR = $stateDir
  $env:LOCALAPPDATA = $testRoot
  $env:PROCESSOR_ARCHITECTURE = 'AMD64'
  Remove-Item Env:MARKDAWN_MODIFY_PATH -ErrorAction SilentlyContinue

  & $installer
  & $installer

  if (-not (Test-Path -LiteralPath (Join-Path $installDir 'markdawn.exe') -PathType Leaf)) { throw 'installer did not create markdawn.exe' }
  $receipt = Get-Content -LiteralPath (Join-Path $stateDir 'install.json') -Raw | ConvertFrom-Json
  if ($receipt.pathFile -ne '') { throw "default receipt pathFile = $($receipt.pathFile)" }

  $unicodeInstallDir = Join-Path $testRoot 'bín'
  $profilePath = Join-Path $testRoot 'Microsoft.PowerShell_profile.ps1'
  [IO.File]::WriteAllText($profilePath, "# profile`r`n", [Text.UnicodeEncoding]::new($false, $true))
  $env:MARKDAWN_INSTALL_DIR = $unicodeInstallDir
  $stateDir = Join-Path $testRoot 'state-path'
  $env:MARKDAWN_INSTALL_STATE_DIR = $stateDir
  $env:MARKDAWN_PROFILE_PATH = $profilePath
  $env:MARKDAWN_MODIFY_PATH = '1'
  & $installer
  & $installer

  $profileBytes = [IO.File]::ReadAllBytes($profilePath)
  if ($profileBytes[0] -ne 0xff -or $profileBytes[1] -ne 0xfe) { throw 'installer did not preserve UTF-16 LE profile encoding' }
  $profile = [Text.UnicodeEncoding]::new($false, $true).GetString($profileBytes)
  if (-not $profile.Contains($unicodeInstallDir)) { throw 'installer did not preserve the Unicode install path in the profile' }
  $receipt = Get-Content -LiteralPath (Join-Path $stateDir 'install.json') -Raw | ConvertFrom-Json
  if ($receipt.pathFile -ne $profilePath) { throw "PATH receipt = $($receipt.pathFile)" }

  $laterPathInstallDir = Join-Path $testRoot 'later-path-bin'
  $laterPathStateDir = Join-Path $testRoot 'state-later-path'
  $laterPathProfile = Join-Path $testRoot 'later-path-profile.ps1'
  $env:MARKDAWN_INSTALL_DIR = $laterPathInstallDir
  $env:MARKDAWN_INSTALL_STATE_DIR = $laterPathStateDir
  $env:MARKDAWN_PROFILE_PATH = $laterPathProfile
  Remove-Item Env:MARKDAWN_MODIFY_PATH -ErrorAction SilentlyContinue
  & $installer
  $env:MARKDAWN_MODIFY_PATH = '1'
  & $installer
  $receipt = Get-Content -LiteralPath (Join-Path $laterPathStateDir 'install.json') -Raw | ConvertFrom-Json
  if ($receipt.pathFile -ne $laterPathProfile) { throw "later PATH opt-in receipt = $($receipt.pathFile)" }
  if (-not ([IO.File]::ReadAllText($laterPathProfile).Contains($laterPathInstallDir))) { throw 'later PATH opt-in did not update the profile' }

  $rollbackInstallDir = Join-Path $testRoot 'rollback-bin'
  $rollbackStateDir = Join-Path $testRoot 'state-rollback'
  $rollbackProfile = Join-Path $testRoot 'rollback-profile.ps1'
  New-Item -ItemType Directory -Force -Path (Join-Path $rollbackStateDir 'install.json') | Out-Null
  $env:MARKDAWN_INSTALL_DIR = $rollbackInstallDir
  $env:MARKDAWN_INSTALL_STATE_DIR = $rollbackStateDir
  $env:MARKDAWN_PROFILE_PATH = $rollbackProfile
  $env:MARKDAWN_MODIFY_PATH = '1'
  try {
    & $installer
    throw 'receipt publication failure was accepted'
  } catch {
    if ($_.Exception.Message -eq 'receipt publication failure was accepted') { throw }
  }
  if (Test-Path -LiteralPath (Join-Path $rollbackInstallDir 'markdawn.exe')) { throw 'failed install did not roll back the binary' }
  if (Test-Path -LiteralPath $rollbackProfile) { throw 'failed install did not roll back the PowerShell profile' }

  $invalidInstallDir = Join-Path $testRoot 'invalid-bin'
  $invalidStateDir = Join-Path $testRoot 'state-invalid'
  New-Item -ItemType Directory -Force -Path $invalidInstallDir, $invalidStateDir | Out-Null
  [IO.File]::WriteAllText((Join-Path $invalidInstallDir 'markdawn.exe'), 'previous binary', [Text.UTF8Encoding]::new($false))
  $invalidReceipt = [PSCustomObject]@{ schemaVersion = 1; installMethod = 'standalone'; installDir = $invalidInstallDir; binaryPath = (Join-Path $invalidInstallDir 'markdawn.exe'); pathFile = ''; unknown = $true } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path $invalidStateDir 'install.json'), $invalidReceipt, [Text.UTF8Encoding]::new($false))
  $env:MARKDAWN_INSTALL_DIR = $invalidInstallDir
  $env:MARKDAWN_INSTALL_STATE_DIR = $invalidStateDir
  Remove-Item Env:MARKDAWN_MODIFY_PATH -ErrorAction SilentlyContinue
  try {
    & $installer
    throw 'invalid receipt was accepted'
  } catch {
    if ($_.Exception.Message -eq 'invalid receipt was accepted') { throw }
  }
  if ([IO.File]::ReadAllText((Join-Path $invalidInstallDir 'markdawn.exe')) -ne 'previous binary') { throw 'invalid receipt install replaced the previous binary' }

  $unexpectedInstallDir = Join-Path $testRoot 'unexpected-bin'
  $unexpectedStateDir = Join-Path $testRoot 'state-unexpected'
  $script:archiveEntries = @(
    [PSCustomObject]@{ Name = 'markdawn.exe'; Contents = 'test binary' },
    [PSCustomObject]@{ Name = 'unexpected/payload.txt'; Contents = 'must not be extracted' }
  )
  Publish-TestAssets
  $env:MARKDAWN_INSTALL_DIR = $unexpectedInstallDir
  $env:MARKDAWN_INSTALL_STATE_DIR = $unexpectedStateDir
 & $installer
 if (-not (Test-Path -LiteralPath (Join-Path $unexpectedInstallDir 'markdawn.exe') -PathType Leaf)) { throw 'installer did not extract markdawn.exe from an archive with unrelated entries' }
 if (Test-Path -LiteralPath (Join-Path $testRoot 'unexpected')) { throw 'installer extracted an unrelated archive entry' }

  $tooManyEntriesInstallDir = Join-Path $testRoot 'too-many-entries-bin'
  $tooManyEntriesStateDir = Join-Path $testRoot 'state-too-many-entries'
  $script:archiveEntries = @([PSCustomObject]@{ Name = 'markdawn.exe'; Contents = 'test binary' })
  for ($index = 0; $index -lt 1024; $index++) { $script:archiveEntries += [PSCustomObject]@{ Name = "entry-$index"; Contents = '' } }
  Publish-TestAssets
  $env:MARKDAWN_INSTALL_DIR = $tooManyEntriesInstallDir
  $env:MARKDAWN_INSTALL_STATE_DIR = $tooManyEntriesStateDir
  try {
    & $installer
    throw 'archive with too many entries was accepted'
  } catch {
    if ($_.Exception.Message -eq 'archive with too many entries was accepted') { throw }
  }
  if (Test-Path -LiteralPath (Join-Path $tooManyEntriesInstallDir 'markdawn.exe')) { throw 'archive with too many entries installed a binary' }

 $malformedInstallDir = Join-Path $testRoot 'malformed-bin'
  $malformedStateDir = Join-Path $testRoot 'state-malformed'
  $script:archiveEntries = @([PSCustomObject]@{ Name = 'markdawn.exe'; Contents = 'test binary' })
  $script:malformedArchive = $true
  Publish-TestAssets
  $env:MARKDAWN_INSTALL_DIR = $malformedInstallDir
  $env:MARKDAWN_INSTALL_STATE_DIR = $malformedStateDir
  try {
    & $installer
    throw 'malformed archive was accepted'
  } catch {
    if ($_.Exception.Message -eq 'malformed archive was accepted') { throw }
  }
  if (Test-Path -LiteralPath (Join-Path $malformedInstallDir 'markdawn.exe')) { throw 'malformed archive installed a binary' }

  $oversizedInstallDir = Join-Path $testRoot 'oversized-bin'
  $oversizedStateDir = Join-Path $testRoot 'state-oversized'
  $script:malformedArchive = $false
  $script:oversizedArchive = $true
  Publish-TestAssets
  $env:MARKDAWN_INSTALL_DIR = $oversizedInstallDir
  $env:MARKDAWN_INSTALL_STATE_DIR = $oversizedStateDir
  $oversizedFailure = $null
  try {
    & $installer
    throw 'oversized archive was accepted'
  } catch {
    if ($_.Exception.Message -eq 'oversized archive was accepted') { throw }
    $oversizedFailure = $_
  }
  if ($null -eq $oversizedFailure -or $oversizedFailure.Exception.Message -notmatch 'exceeds') { throw "unexpected oversized archive error: $oversizedFailure" }
  if (Test-Path -LiteralPath (Join-Path $oversizedInstallDir 'markdawn.exe')) { throw 'oversized archive installed a binary' }
} finally {
  if ($null -ne $serverJob) { Stop-Job $serverJob -ErrorAction SilentlyContinue; Remove-Job $serverJob -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
