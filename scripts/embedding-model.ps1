param(
    [ValidateSet('prepare', 'benchmark')]
    [string]$Action = 'prepare',

    [ValidateSet('multilingual-e5-small', 'paraphrase-multilingual-minilm')]
    [string]$Model = 'paraphrase-multilingual-minilm'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

$models = @{
    'multilingual-e5-small' = @{
        Repository = 'intfloat/multilingual-e5-small'
        Revision = '614241f622f53c4eeff9890bdc4f31cfecc418b3'
        ModelRemoteFile = 'onnx/model.onnx'
        ModelFile = 'model.onnx'
        ModelSha256 = 'ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665'
        TokenizerRemoteFile = 'tokenizer.json'
        TokenizerFile = 'tokenizer.json'
        TokenizerSha256 = '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39'
        Dimension = 384
        MaxTokens = 512
        TextPrefix = 'query: '
    }
    'paraphrase-multilingual-minilm' = @{
        Repository = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
        Revision = 'e8f8c211226b894fcb81acc59f3b34ba3efd5f42'
        ModelRemoteFile = 'onnx/model_quint8_avx2.onnx'
        ModelFile = 'model.onnx'
        ModelSha256 = '98a01d88b7de996cdea58c32ca71208c09968d143798814b2ea09d3439dc334f'
        TokenizerRemoteFile = 'tokenizer.json'
        TokenizerFile = 'tokenizer.json'
        TokenizerSha256 = '2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8'
        Dimension = 384
        MaxTokens = 128
        TextPrefix = ''
    }
}

$selected = $models[$Model]
$destination = Join-Path $projectRoot "backend/models/$Model"

function Get-Checksum([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-ModelArtifact(
    [string]$RemoteFile,
    [string]$FileName,
    [string]$ExpectedChecksum
) {
    $destinationFile = Join-Path $destination $FileName
    if ((Test-Path -LiteralPath $destinationFile) -and
        (Get-Checksum $destinationFile) -eq $ExpectedChecksum) {
        Write-Output "Valid artifact already present: $destinationFile"
        return
    }

    $temporaryFile = "$destinationFile.download"
    $uri = "https://huggingface.co/$($selected.Repository)/resolve/$($selected.Revision)/${RemoteFile}?download=true"
    & curl.exe --fail --location --silent --show-error --output $temporaryFile $uri
    if ($LASTEXITCODE -ne 0) {
        throw "Artifact download failed with exit code ${LASTEXITCODE}: $RemoteFile"
    }
    $actualChecksum = Get-Checksum $temporaryFile
    if ($actualChecksum -ne $ExpectedChecksum) {
        Remove-Item -LiteralPath $temporaryFile
        throw "Checksum mismatch for $RemoteFile. Expected $ExpectedChecksum, received $actualChecksum."
    }
    Move-Item -LiteralPath $temporaryFile -Destination $destinationFile -Force
    Write-Output "Prepared verified artifact: $destinationFile"
}

if ($Action -eq 'prepare') {
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Get-ModelArtifact $selected.ModelRemoteFile $selected.ModelFile $selected.ModelSha256
    Get-ModelArtifact $selected.TokenizerRemoteFile $selected.TokenizerFile $selected.TokenizerSha256
    exit 0
}

$modelPath = Join-Path $destination $selected.ModelFile
$tokenizerPath = Join-Path $destination $selected.TokenizerFile
if (!(Test-Path -LiteralPath $modelPath) -or !(Test-Path -LiteralPath $tokenizerPath)) {
    throw "Model artifacts are missing. Run: .\scripts\embedding-model.ps1 prepare $Model"
}

Push-Location (Join-Path $projectRoot 'backend')
try {
    & .\mvnw.cmd -B -ntp `
        '-Dtest=OnnxEmbeddingBenchmarkTest' `
        "-Dembedding.benchmark.directory=$destination" `
        "-Dembedding.benchmark.model-id=$($selected.Repository)" `
        "-Dembedding.benchmark.model-version=$($selected.Revision)" `
        "-Dembedding.benchmark.dimension=$($selected.Dimension)" `
        "-Dembedding.benchmark.max-tokens=$($selected.MaxTokens)" `
        "-Dembedding.benchmark.model-sha256=$($selected.ModelSha256)" `
        "-Dembedding.benchmark.tokenizer-sha256=$($selected.TokenizerSha256)" `
        "-Dembedding.benchmark.text-prefix=$($selected.TextPrefix)" `
        test
    if ($LASTEXITCODE -ne 0) {
        throw "Embedding benchmark failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
