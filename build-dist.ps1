# Builds orsolo-gravite/: only what the public site serves. Blender sources, PNG masters and dev pages stay out.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$out = "orsolo-gravite"  # the folder name becomes the Vercel project name
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null

Copy-Item index.html, styles.css, still.webp -Destination $out
Get-ChildItem *.js | Copy-Item -Destination $out

New-Item -ItemType Directory $out\frames | Out-Null
Copy-Item frames\anchors.json $out\frames
foreach ($seq in 'intro', 'bridge', 'explode') {
  Copy-Item "frames\$seq" "$out\frames\$seq" -Recurse
}
if (Test-Path frames\path) { Copy-Item frames\path $out\frames\path -Recurse }

# Long-lived caching for frames and the still; the page and scripts revalidate.
@'
{
  "cleanUrls": true,
  "headers": [
    { "source": "/frames/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/still.webp", "headers": [{ "key": "Cache-Control", "value": "public, max-age=86400" }] }
  ]
}
'@ | ForEach-Object { [IO.File]::WriteAllText((Join-Path $PWD "$out\vercel.json"), $_, (New-Object Text.UTF8Encoding $false)) }

$files = Get-ChildItem $out -Recurse -File
"${out}: $($files.Count) files, " + [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 2) + " MB"
