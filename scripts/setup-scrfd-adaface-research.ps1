param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$modelsDir = Join-Path $RepoRoot "models"
$tempDir = Join-Path $env:TEMP "pravahax-scrfd-adaface"
$buffaloZip = Join-Path $tempDir "buffalo_m.zip"
$buffaloExtract = Join-Path $tempDir "buffalo_m"
$scrfdTarget = Join-Path $modelsDir "scrfd_2.5g_kps.onnx"
$adafaceTarget = Join-Path $modelsDir "adaface_ir50.onnx"

# Research/evaluation checkpoints only. Do not use these URLs for commercial production.
$buffaloUrl = "https://github.com/deepinsight/insightface/releases/download/model-zoo/buffalo_m.zip"
$buffaloZipSha256 = "d98264bd8f2dc75cbc2ddce2a14e636e02bb857b3051c234b737bf3b614edca9"
$scrfdSha256 = "041f73f47371333d1d17a6fee6c8ab4e6aecabefe398ff32cca4e2d5eaee0af9"

$adafaceUrl = "https://huggingface.co/datnt114/adaface-onnx/resolve/main/ir50.onnx?download=true"
$adafaceSha256 = "4b044ba54c3b193ca80b920194caee5b417dcca9cbdcfbc81118fa56c838538a"

function Assert-Sha256 {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Expected,
        [Parameter(Mandatory=$true)][string]$Label
    )

    if (-not (Test-Path $Path)) {
        throw "$Label is missing at $Path"
    }

    $actual = (Get-FileHash -Algorithm SHA256 $Path).Hash.ToLowerInvariant()
    if ($actual -ne $Expected.ToLowerInvariant()) {
        throw "$Label SHA256 mismatch. Expected $Expected, got $actual"
    }

    Write-Host "[PASS] $Label SHA256: $actual"
}

Write-Host "============================================================"
Write-Host "PRAVAHAx SCRFD + AdaFace Research Weight Setup"
Write-Host "============================================================"
Write-Host ""
Write-Host "IMPORTANT: These public checkpoints are for local research/evaluation."
Write-Host "Do not deploy them commercially unless you have appropriate model/data rights."
Write-Host ""

New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

if (-not (Test-Path $scrfdTarget)) {
    Write-Host "[1/4] Downloading official InsightFace buffalo_m model pack..."
    Invoke-WebRequest -Uri $buffaloUrl -OutFile $buffaloZip
    Assert-Sha256 -Path $buffaloZip -Expected $buffaloZipSha256 -Label "buffalo_m.zip"

    if (Test-Path $buffaloExtract) {
        Remove-Item -Recurse -Force $buffaloExtract
    }
    New-Item -ItemType Directory -Force -Path $buffaloExtract | Out-Null

    Write-Host "[2/4] Extracting SCRFD 2.5G KPS detector..."
    Expand-Archive -Path $buffaloZip -DestinationPath $buffaloExtract -Force

    $detector = Get-ChildItem -Path $buffaloExtract -Recurse -File -Filter "det_2.5g.onnx" |
        Select-Object -First 1

    if (-not $detector) {
        throw "det_2.5g.onnx was not found inside buffalo_m.zip"
    }

    Copy-Item -Force $detector.FullName $scrfdTarget
} else {
    Write-Host "[1/4] SCRFD model already present; verifying it."
}

Assert-Sha256 -Path $scrfdTarget -Expected $scrfdSha256 -Label "SCRFD 2.5G KPS"

if (-not (Test-Path $adafaceTarget)) {
    Write-Host "[3/4] Downloading AdaFace IR50 MS1MV2 ONNX research checkpoint..."
    Invoke-WebRequest -Uri $adafaceUrl -OutFile $adafaceTarget
} else {
    Write-Host "[3/4] AdaFace model already present; verifying it."
}

Assert-Sha256 -Path $adafaceTarget -Expected $adafaceSha256 -Label "AdaFace IR50 MS1MV2"

Write-Host "[4/4] Model files are ready."
Write-Host ""
Write-Host "SCRFD : $scrfdTarget"
Write-Host "AdaFace: $adafaceTarget"
Write-Host ""
Write-Host "Next:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\start-scrfd-adaface-research.ps1 -VerifyOnly"
Write-Host "Then:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\start-scrfd-adaface-research.ps1"
