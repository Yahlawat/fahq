'use strict';

const windowsPlayback = String.raw`
$ErrorActionPreference = 'Stop'
$file = $env:FAHQ_AUDIO_FILE
if ([IO.Path]::GetExtension($file) -ieq '.wav') {
    $sound = [System.Media.SoundPlayer]::new($file)
    try { $sound.PlaySync() } finally { $sound.Dispose() }
    exit 0
}
Add-Type -AssemblyName PresentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$state = @{ done = $false; error = $null }
$player.add_MediaEnded({ $state.done = $true })
$player.add_MediaFailed({ $state.error = $_.ErrorException; $state.done = $true })
try {
    $player.Open([Uri]::new($file, [UriKind]::Absolute))
    $player.Play()
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (!$state.done -and [DateTime]::UtcNow -lt $deadline) {
        $player.Dispatcher.Invoke([Action]{}, [System.Windows.Threading.DispatcherPriority]::Background)
        Start-Sleep -Milliseconds 25
    }
    if ($state.error) { throw $state.error }
    if (!$state.done) { throw 'Audio playback timed out.' }
} finally {
    $player.Close()
}
`;

function playbackCommand(platform, file, volume) {
  switch (platform) {
    case 'darwin':
      return { command: 'afplay', args: ['-v', String(volume), file] };
    case 'win32':
      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand',
          Buffer.from(windowsPlayback, 'utf16le').toString('base64')],
        env: { ...process.env, FAHQ_AUDIO_FILE: file },
      };
    default:
      return {
        command: 'sh',
        args: ['-c', 'ffplay -nodisp -autoexit -loglevel quiet "$1" || mpg123 -q "$1" || paplay "$1"', 'fahq', file],
      };
  }
}

module.exports = { playbackCommand };
