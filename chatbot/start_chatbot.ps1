Set-Location -LiteralPath $PSScriptRoot
& ".\.venv\Scripts\python.exe" ".\backend.py" --load-model --serve
