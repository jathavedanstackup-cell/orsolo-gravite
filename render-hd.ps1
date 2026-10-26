# Re-renders every sequence natively at 1920x1200 and swaps the webp frames in as each one finishes.
# Resumable: frames already rendered are skipped, so it can be stopped and restarted.
# Continue: Blender, ffmpeg and git write progress to stderr, which PowerShell 5.1 would treat as fatal under Stop.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
$env:ORSOLO_SCALE = "150"
$env:ORSOLO_SAMPLES = "20"  # OIDN cleans up the rest; the higher pixel count already averages more rays
$hd = "frames_hd"

function Encode($src, $dst) {
  foreach ($f in Get-ChildItem "$src\f*.png") {
    ffmpeg -v error -y -i $f.FullName -c:v libwebp -quality 85 -compression_level 4 (Join-Path $dst ($f.BaseName + ".webp"))
  }
  "$(Get-Date -Format HH:mm) encoded $src -> $dst"
}

# Publishes the frames swapped in so far: GitHub (which redeploys Pages) and Vercel production.
function Publish($what) {
  # New frame URLs, so browsers drop the year-long cached copies
  $js = [IO.File]::ReadAllText("$PWD\frames.js") -replace 'FRAME_VERSION = "[^"]*"', "FRAME_VERSION = `"hd$(Get-Date -Format MMddHHmm)`""
  [IO.File]::WriteAllText("$PWD\frames.js", $js, (New-Object Text.UTF8Encoding $false))
  git add frames frames.js blender/watch.py render-hd.ps1 2>&1 | Out-Null
  git commit -q -m "perf: native 1920x1200 renders for $what" 2>&1 | Out-Null
  git push -q 2>&1 | Out-Null
  & .\build-dist.ps1 | Out-Null
  npx --yes vercel@latest deploy orsolo-gravite --prod --yes 2>&1 | Select-Object -Last 1
  "$(Get-Date -Format HH:mm) published $what"
}

function Render($mode, $out, $arg) {
  "$(Get-Date -Format HH:mm) rendering $mode"
  & $blender -b -P blender\watch.py -- $mode $out $arg 2>&1 | Select-String "Error" | Select-Object -First 5
}

Render intro "$hd\intro" 48;    Encode "$hd\intro" "frames\intro"
Render bridge "$hd\bridge" 16;  Encode "$hd\bridge" "frames\bridge"
Publish "the intro and bridge"
Render path "$hd\path" all
foreach ($seg in "reassemble", "approach", "hold", "dive", "emerge", "craft") { Encode "$hd\path\$seg" "frames\path\$seg" }
Publish "the tourbillon and craft camera path"
Render seq "$hd\explode" 72;    Encode "$hd\explode" "frames\explode"
Publish "the exploded movement"
"$(Get-Date -Format HH:mm) done"
