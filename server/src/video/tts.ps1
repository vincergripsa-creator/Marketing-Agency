# Offline French voice: one WAV and its word events per line. Windows only, spawned by speech.ts with -ExecutionPolicy Bypass.
# ASCII only: PowerShell 5.1 reads a BOM-less script in the system code page.
#   -List              prints the installed voices as JSON
#   -InJson a.json     a JSON array of strings; writes <OutDir>/vo-<n>.wav and <OutDir>/timings.json
param([string]$InJson, [string]$OutDir, [string]$Voice = '', [int]$Rate = 1, [switch]$List)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$syn = New-Object System.Speech.Synthesis.SpeechSynthesizer

function Write-Utf8([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

$installed = @($syn.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo })
if ($List) {
  $rows = @($installed | ForEach-Object { @{ name = $_.Name; culture = $_.Culture.Name } })
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  [Console]::Out.Write((ConvertTo-Json -InputObject $rows -Compress))
  exit 0
}

# The asked voice, else the first fr-FR, Hortense preferred.
$french = @($installed | Where-Object { $_.Culture.Name -eq 'fr-FR' })
$chosen = @($installed | Where-Object { $_.Name -eq $Voice }) + @($french | Where-Object { $_.Name -like '*Hortense*' }) + $french
if ($chosen.Count -eq 0) { throw 'no fr-FR voice installed' }
$syn.SelectVoice($chosen[0].Name)
$syn.Rate = $Rate

# No @() here: PowerShell 5.1 hands the whole array down the pipe as one object, the assignment is what unrolls it.
$lines = Get-Content -LiteralPath $InJson -Raw -Encoding UTF8 | ConvertFrom-Json
# 16 kHz mono, always: AudioPosition assumes the voice's native rate, so at 22.05 kHz every time reads 1.378 x too large.
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

# Queued events, no -Action: none is lost, and the end of a line is an event, not a poll. They arrive out of order: speech.ts sorts them.
Register-ObjectEvent -InputObject $syn -EventName SpeakProgress -SourceIdentifier 'tts.word' | Out-Null
Register-ObjectEvent -InputObject $syn -EventName SpeakCompleted -SourceIdentifier 'tts.done' | Out-Null

$result = New-Object System.Collections.ArrayList
$i = 0
foreach ($t in $lines) {
  $i++
  $wav = Join-Path $OutDir "vo-$i.wav"
  $syn.SetOutputToWaveFile($wav, $fmt)
  [void]$syn.SpeakAsync([string]$t)
  $done = Wait-Event -SourceIdentifier 'tts.done' -Timeout 60
  if ($null -eq $done) { throw "timeout on line $i" }
  $done | Remove-Event
  $syn.SetOutputToNull()
  Start-Sleep -Milliseconds 40 # the last SpeakProgress can land just behind SpeakCompleted
  $words = New-Object System.Collections.ArrayList
  foreach ($e in @(Get-Event -SourceIdentifier 'tts.word' -ErrorAction SilentlyContinue)) {
    $a = $e.SourceEventArgs
    [void]$words.Add(@{ t = $a.Text; c = $a.CharacterPosition; ms = $a.AudioPosition.TotalMilliseconds })
    $e | Remove-Event
  }
  [void]$result.Add(@{ text = [string]$t; wav = $wav; words = $words })
}
Unregister-Event -SourceIdentifier 'tts.word'
Unregister-Event -SourceIdentifier 'tts.done'
Write-Utf8 (Join-Path $OutDir 'timings.json') (ConvertTo-Json -InputObject @{ voice = $chosen[0].Name; lines = $result } -Depth 6 -Compress)
$syn.Dispose()
