@echo off
setlocal

title Stop TeacherDesk
echo.
echo Stopping TeacherDesk local servers on ports 8000 and 5173...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=@(8000,5173); $pids=@(); foreach($port in $ports){ $connections=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; foreach($connection in $connections){ if($connection.OwningProcess){ $pids += [int]$connection.OwningProcess } } }; $pids=$pids | Sort-Object -Unique; if(-not $pids){ Write-Host 'No TeacherDesk server ports are listening.'; exit 0 }; foreach($processId in $pids){ Write-Host ('Stopping PID {0} and child processes' -f $processId); & taskkill.exe /PID $processId /T /F 2>$null | Out-Host }; Start-Sleep -Seconds 1; foreach($port in $ports){ $remaining=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; if($remaining){ Write-Host ('WARNING: port {0} is still listening. Close its server window manually if needed.' -f $port) } }"

echo.
echo Done. If any TeacherDesk server window remains open, you can close it manually.
pause
