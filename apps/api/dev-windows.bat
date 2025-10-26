@echo off
echo ========================================
echo OFM API - Windows Development Setup
echo ========================================
echo.

echo [1/4] Cleaning webpack cache...
if exist node_modules\.cache rmdir /s /q node_modules\.cache
echo Cache cleaned!
echo.

echo [2/4] Generating Prisma client...
call npx prisma generate
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Prisma generation failed. Trying with checksum ignore...
    set PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
    call npx prisma generate
)
echo.

echo [3/4] Checking if database needs migration...
echo NOTE: If you see errors, your database might need migration.
echo Run 'npm run migration:generate' if needed.
echo.

echo [4/4] Starting development server...
call npm run dev
