#!/usr/bin/env pwsh
# OFM API - Windows Development Setup (PowerShell)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "OFM API - Windows Development Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Clean cache
Write-Host "[1/4] Cleaning webpack cache..." -ForegroundColor Yellow
if (Test-Path "node_modules\.cache") {
    Remove-Item -Recurse -Force "node_modules\.cache"
    Write-Host "Cache cleaned!" -ForegroundColor Green
} else {
    Write-Host "No cache to clean." -ForegroundColor Gray
}
Write-Host ""

# Step 2: Generate Prisma
Write-Host "[2/4] Generating Prisma client..." -ForegroundColor Yellow
try {
    npx prisma generate
    if ($LASTEXITCODE -ne 0) {
        throw "Prisma generation failed"
    }
    Write-Host "Prisma client generated!" -ForegroundColor Green
} catch {
    Write-Host "WARNING: Prisma generation failed. Trying with checksum ignore..." -ForegroundColor Yellow
    $env:PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING = "1"
    npx prisma generate
}
Write-Host ""

# Step 3: Check database
Write-Host "[3/4] Checking if database needs migration..." -ForegroundColor Yellow
Write-Host "NOTE: If you see errors, your database might need migration." -ForegroundColor Gray
Write-Host "Run 'npm run migration:generate' if needed." -ForegroundColor Gray
Write-Host ""

# Step 4: Start server
Write-Host "[4/4] Starting development server..." -ForegroundColor Yellow
npm run dev
