param(
    [string]$ExePath = "",
    [string]$ResultPath = ""
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSCommandPath
$root = Resolve-Path (Join-Path $here "..")

if ($ExePath -eq "") {
    $ExePath = Join-Path $root "apps/backend/dist/lifescribe-backend.exe"
}
if (-not (Test-Path $ExePath)) {
    throw "Packaged backend not found at $ExePath. Run scripts/build-backend.ps1 first."
}

if ($ResultPath -eq "") {
    $ResultPath = Join-Path ([IO.Path]::GetTempPath()) (
        "lifescribe-packaged-docling-smoke-" + [guid]::NewGuid().ToString("N") + ".txt"
    )
}

"PACKAGED_DOCLING_SMOKE_START" | Set-Content -Path $ResultPath

$tmp = Join-Path ([IO.Path]::GetTempPath()) (
    "lifescribe-packaged-smoke-" + [guid]::NewGuid().ToString("N")
)
New-Item -ItemType Directory -Path $tmp | Out-Null
$vault = Join-Path $tmp "vault"
$inputDir = Join-Path $tmp "inputs"
New-Item -ItemType Directory -Path $inputDir | Out-Null

$makeFiles = @'
from pathlib import Path
from pptx import Presentation

root = Path(r"__INPUT_DIR__")

prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[5])
slide.shapes.title.text = "Packaged Docling Smoke"
textbox = slide.shapes.add_textbox(914400, 1828800, 7315200, 914400)
textbox.text_frame.text = "PPTX import through packaged LifeScribe backend."
prs.save(root / "smoke.pptx")

pdf = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]"
    b"/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
    b"4 0 obj<</Length 44>>stream\n"
    b"BT /F1 24 Tf 72 700 Td (Hello, world.) Tj ET\n"
    b"endstream endobj\n"
    b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
    b"xref\n0 6\n0000000000 65535 f \n"
    b"0000000010 00000 n \n0000000053 00000 n \n"
    b"0000000100 00000 n \n0000000190 00000 n \n"
    b"0000000250 00000 n \n"
    b"trailer<</Size 6/Root 1 0 R>>\nstartxref\n310\n%%EOF\n"
)
(root / "smoke.pdf").write_bytes(pdf)
'@.Replace("__INPUT_DIR__", $inputDir.Replace("\", "\\"))

Push-Location (Join-Path $root "apps/backend")
try {
    $makeFiles | uv run python -
} finally {
    Pop-Location
}

$process = New-Object System.Diagnostics.Process
$process.StartInfo.FileName = $ExePath
$process.StartInfo.Arguments = "--port 0 --auth-token smoke-token"
$process.StartInfo.WorkingDirectory = Split-Path $ExePath
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.RedirectStandardOutput = $true
$process.StartInfo.RedirectStandardError = $true
$process.StartInfo.CreateNoWindow = $true

try {
    [void]$process.Start()
    $line = $process.StandardOutput.ReadLine()
    "startup=$line" | Add-Content -Path $ResultPath
    if (-not $line) {
        throw "backend did not print startup JSON"
    }

    $startup = $line | ConvertFrom-Json
    $base = "http://$($startup.host):$($startup.port)"
    $headers = @{ Authorization = "Bearer smoke-token" }

    for ($i = 0; $i -lt 120; $i++) {
        try {
            Invoke-RestMethod -Method Get -Uri "$base/health" -Headers $headers | Out-Null
            break
        } catch {
            if ($i -eq 119) {
                throw
            }
            Start-Sleep -Milliseconds 500
        }
    }

    Invoke-RestMethod `
        -Method Post `
        -Uri "$base/vault/init" `
        -Headers $headers `
        -ContentType "application/json" `
        -Body (@{ path = $vault } | ConvertTo-Json) |
        Out-Null

    $files = @((Join-Path $inputDir "smoke.pptx"), (Join-Path $inputDir "smoke.pdf"))
    $job = Invoke-RestMethod `
        -Method Post `
        -Uri "$base/ingest/jobs" `
        -Headers $headers `
        -ContentType "application/json" `
        -Body (@{ files = $files } | ConvertTo-Json)

    $terminal = $null
    for ($i = 0; $i -lt 240; $i++) {
        $status = Invoke-RestMethod -Method Get -Uri "$base/ingest/jobs/$($job.job_id)" -Headers $headers
        if (@("completed", "completed_with_failures", "failed", "cancelled") -contains $status.status) {
            $terminal = $status
            break
        }
        Start-Sleep -Seconds 1
    }

    if ($null -eq $terminal) {
        throw "ingest job did not finish before timeout"
    }
    if ($terminal.status -ne "completed" -or $terminal.succeeded -ne 2 -or $terminal.failed -ne 0) {
        throw ($terminal | ConvertTo-Json -Depth 10)
    }

    $notes = Invoke-RestMethod -Method Get -Uri "$base/vault/notes?type=SourceRecord" -Headers $headers
    $pdfNote = $notes | Where-Object { $_.source_path -like "*smoke.pdf" } | Select-Object -First 1
    $pptxNote = $notes | Where-Object { $_.source_path -like "*smoke.pptx" } | Select-Object -First 1

    if ($null -eq $pptxNote -or $pptxNote.engine_selected -notlike "docling*") {
        throw "PPTX did not record Docling engine selection"
    }
    if ($null -eq $pdfNote -or $pdfNote.page_count -ne 1) {
        throw "PDF did not preserve page_count=1"
    }

    $summary = "PACKAGED_DOCLING_SMOKE_OK status=$($terminal.status) succeeded=$($terminal.succeeded) " +
        "pptx_engine=$($pptxNote.engine_selected) pdf_engine=$($pdfNote.engine_selected) " +
        "pdf_page_count=$($pdfNote.page_count)"
    $summary | Add-Content -Path $ResultPath
    Write-Host $summary
} catch {
    "PACKAGED_DOCLING_SMOKE_FAIL $($_.Exception.Message)" | Add-Content -Path $ResultPath
    throw
} finally {
    if (-not $process.HasExited) {
        $process.Kill()
    }
    $process.Dispose()
}
