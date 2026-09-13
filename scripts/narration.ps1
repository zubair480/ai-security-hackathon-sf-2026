# Generates the narration segments for scripts/record-demo.mjs using the Windows speech engine.
# Output: .state/video/<id>.wav and .state/video/narration.json. Re-record with a human voice
# by replacing the wav files and keeping the ids.

$dir = Join-Path $PSScriptRoot "..\.state\video"
New-Item -ItemType Directory -Force $dir | Out-Null

$segs = @(
  @{ id = "01-intro"; text = "PayeeLock. An AI accounts-payable agent that reads vendor email and pays invoices. The problem is business email compromise: an attacker sends a convincing bank-change email, and an agent that follows instructions wires the money to the wrong account. PayeeLock puts two boundaries around that agent. A Wasmer sandbox around the code it writes, and a ledger that binds every payment to an independently approved payee." },
  @{ id = "02-legit"; text = "Step one, a legitimate invoice. The real vendor sends invoice zero nine one two, for forty-eight thousand two hundred fifty dollars, through AgentMail. The agent writes a Python extractor. The Wasmer sandbox runs it with no network and only the email mounted. The ledger pays the approved account on file." },
  @{ id = "03-attack"; text = "Step two, the attack. A look-alike sender uses the same display name, references a real open invoice, and supplies a new routing and account number. It also embeds a confirmation script that tries to upload the vendor master file. The agent follows the instructions: it copies the script and proposes paying the new account. Inside the sandbox, the upload fails. DNS is disabled, and the vendor file is not mounted. And the ledger blocks the payment, because the destination does not match the approved account. Fifty-one thousand nine hundred dollars stays put. The bank change is parked for a human callback." },
  @{ id = "04-bankchange"; text = "Step three, a real bank change from the real vendor. Same rule: email can never change a payee. The request is parked. An AP manager calls the number already on file, rejects the attacker's request, and records the verified callback for the genuine one." },
  @{ id = "05-pay"; text = "Step four. The next invoice pays to the newly verified account. Legitimate work still completes." },
  @{ id = "06-close"; text = "Built today: the AgentMail inbox listener, the Wasmer execution boundary, the payee-bound ledger, the console, and fifteen tests. The buyer is an accounts-payable automation vendor, and the reason they pay is one line: the agent can be fooled, the payment cannot. Limits: synthetic records, a callback that is an attestation, and a sandbox that is one boundary, not a full audit." }
)

Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice("Microsoft Zira Desktop")
$s.Rate = 1
foreach ($g in $segs) {
  $f = Join-Path $dir ($g.id + ".wav")
  $s.SetOutputToWaveFile($f); $s.Speak($g.text); $s.SetOutputToNull()
}
$s.Dispose()

$json = ($segs | ForEach-Object { [pscustomobject]@{ id = $_.id; text = $_.text } }) | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $dir "narration.json"), $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "wrote $($segs.Count) segments to $dir"
