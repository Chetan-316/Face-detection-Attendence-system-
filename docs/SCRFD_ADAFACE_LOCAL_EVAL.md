# SCRFD 2.5G KPS + AdaFace IR50 — Local Evaluation

This is the controlled evaluation path for the new PRAVAHAx biometric engine.

## What it activates

The local worker runs:

    camera frame -> SCRFD 2.5G KPS -> 5-point alignment -> AdaFace IR50 -> 512-D normalized embedding -> cosine matching -> temporal confirmation -> existing PRAVAHAx movement engine

No attendance, movement, RBAC, or gate workflow is replaced by this activation.

## Important licensing boundary

The setup script intentionally labels the downloaded public checkpoints as **research/evaluation only**.

- The SCRFD detector comes from the official InsightFace buffalo_m model pack. InsightFace states that its pretrained model-zoo weights are available for non-commercial research use unless a separate model license is obtained.
- The AdaFace IR50 file is an ONNX conversion of the public IR50 MS1MV2 checkpoint. The AdaFace code is MIT, but the pretrained checkpoint inherits training-dataset restrictions that must be reviewed before production/commercial deployment.

Do not copy these research checkpoint URLs into Render production environment variables.

## Windows setup

From the repository root:

~~~powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-scrfd-adaface-research.ps1
~~~

The setup downloads and SHA-256 verifies:

| Model | Local path | SHA-256 |
|---|---|---|
| SCRFD 2.5G KPS | models/scrfd_2.5g_kps.onnx | 041f73f47371333d1d17a6fee6c8ab4e6aecabefe398ff32cca4e2d5eaee0af9 |
| AdaFace IR50 MS1MV2 | models/adaface_ir50.onnx | 4b044ba54c3b193ca80b920194caee5b417dcca9cbdcfbc81118fa56c838538a |

The ONNX files remain ignored by Git.

## Verify model loading

~~~powershell
powershell -ExecutionPolicy Bypass -File scripts\start-scrfd-adaface-research.ps1 -VerifyOnly
~~~

Expected worker health characteristics:

- engine: scrfd_adaface
- detector: SCRFD
- detector version: 2.5G-KPS
- recognizer: AdaFace
- recognizer version: IR50-MS1MV2
- embedding dimension: 512
- template version: 2.0.0
- mock: false

## Start the backend with the new engine

~~~powershell
powershell -ExecutionPolicy Bypass -File scripts\start-scrfd-adaface-research.ps1
~~~

The environment is scoped to that PowerShell process. Closing the shell stops the local activation; it does not alter Render.

## Re-enrollment is required

Existing SFace profiles are 128-D and are intentionally incompatible with AdaFace's 512-D embedding space.

For a resident to be recognized under the research engine, enroll that resident once while scrfd_adaface is active. The old SFace profile is preserved for rollback.

Recommended first pilot:

1. re-enroll one resident;
2. verify front/left/right/up/down capture quality;
3. collect genuine and impostor similarity samples;
4. verify first-identification automatic IN/OUT;
5. test leave-frame/reappear re-arm behavior;
6. then expand to 5–10 residents before tuning thresholds.

The initial thresholds (0.45 / 0.30 / 0.06) are provisional and must be calibrated from real camera data.

## Production activation

Production activation is a separate step. It requires commercially cleared SCRFD and AdaFace-compatible weights or internally trained/relicensed alternatives.

Once approved artifacts exist, Render can use the existing configuration contract:

- BIOMETRIC_ENGINE=scrfd_adaface
- SCRFD_MODEL_URL or SCRFD_MODEL_PATH
- SCRFD_MODEL_SHA256
- ADAFACE_MODEL_URL or ADAFACE_MODEL_PATH
- ADAFACE_MODEL_SHA256
- ADAFACE_COLOR_SPACE
- explicit model/license provenance metadata

Do not activate production until those model rights are documented and the pilot thresholds are accepted.
