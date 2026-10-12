param(
    [switch]$VerifyOnly,
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$scrfdPath = Join-Path $RepoRoot "models\scrfd_2.5g_kps.onnx"
$adafacePath = Join-Path $RepoRoot "models\adaface_ir50.onnx"
$workerPath = Join-Path $RepoRoot "src\modules\biometrics\workers\face_worker.py"
$modelCheckPath = Join-Path $RepoRoot "src\modules\biometrics\workers\download_models.py"

if (-not (Test-Path $scrfdPath) -or -not (Test-Path $adafacePath)) {
    throw "Research model weights are missing. Run scripts\setup-scrfd-adaface-research.ps1 first."
}

$env:BIOMETRIC_ENGINE = "scrfd_adaface"
$env:BIOMETRIC_MOCK = "false"
$env:BIOMETRIC_ALLOW_MOCK_FALLBACK = "false"

$env:SCRFD_MODEL_PATH = $scrfdPath
$env:SCRFD_MODEL_VERSION = "2.5G-KPS"
$env:SCRFD_MODEL_SHA256 = "041f73f47371333d1d17a6fee6c8ab4e6aecabefe398ff32cca4e2d5eaee0af9"
$env:SCRFD_MODEL_LICENSE = "InsightFace pretrained checkpoint - non-commercial research/evaluation only"
$env:SCRFD_MODEL_SOURCE = "Official InsightFace buffalo_m model-zoo pack"

$env:ADAFACE_MODEL_PATH = $adafacePath
$env:ADAFACE_MODEL_VERSION = "IR50-MS1MV2"
$env:ADAFACE_MODEL_SHA256 = "4b044ba54c3b193ca80b920194caee5b417dcca9cbdcfbc81118fa56c838538a"
$env:ADAFACE_MODEL_LICENSE = "AdaFace IR50 MS1MV2 research/evaluation checkpoint; upstream dataset terms apply"
$env:ADAFACE_MODEL_SOURCE = "AdaFace official checkpoint converted to ONNX; research evaluation only"
$env:ADAFACE_COLOR_SPACE = "BGR"

# Conservative first-pass thresholds. These must be calibrated on your actual camera/resident set.
$env:RECOGNITION_MATCH_THRESHOLD = "0.45"
$env:RECOGNITION_UNCERTAIN_THRESHOLD = "0.30"
$env:RECOGNITION_MIN_MARGIN = "0.06"

if (-not $env:PYTHON_BIN) {
    $env:PYTHON_BIN = "python"
}

Write-Host "============================================================"
Write-Host "PRAVAHAx SCRFD + AdaFace Local Research Engine"
Write-Host "============================================================"
Write-Host "Engine      : $env:BIOMETRIC_ENGINE"
Write-Host "Detector    : SCRFD 2.5G KPS"
Write-Host "Recognizer  : AdaFace IR50 MS1MV2"
Write-Host "Embedding   : 512-D"
Write-Host "Color space : $env:ADAFACE_COLOR_SPACE"
Write-Host "Mode        : LOCAL RESEARCH / EVALUATION ONLY"
Write-Host ""

Push-Location $RepoRoot
try {
    Write-Host "[1/2] Verifying pinned model files..."
    & $env:PYTHON_BIN $modelCheckPath
    if ($LASTEXITCODE -ne 0) {
        throw "Model verification failed with exit code $LASTEXITCODE"
    }

    Write-Host "[2/2] Loading SCRFD + AdaFace worker and requesting health..."
    '{"command":"health"}' | & $env:PYTHON_BIN $workerPath
    if ($LASTEXITCODE -ne 0) {
        throw "Biometric worker health check failed with exit code $LASTEXITCODE"
    }

    if ($VerifyOnly) {
        Write-Host ""
        Write-Host "[PASS] SCRFD + AdaFace research engine loaded successfully."
        Write-Host "No application server was started because -VerifyOnly was supplied."
        exit 0
    }

    Write-Host ""
    Write-Host "[PASS] Model load verified."
    Write-Host "Starting PRAVAHAx backend with SCRFD + AdaFace active..."
    npm run dev
}
finally {
    Pop-Location
}
