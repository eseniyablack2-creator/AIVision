$ports = @(5174, 8000)

foreach ($port in $ports) {
  $lines = netstat -ano | Select-String ":$port\s+.*LISTENING\s+(\d+)$"
  foreach ($line in $lines) {
    if ($line.Matches.Count -gt 0) {
      $procId = [int]$line.Matches[0].Groups[1].Value
      try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
        Write-Host "Stopped process PID $procId on port $port"
      } catch {
        Write-Host "Failed to stop PID $procId on port ${port}: $($_.Exception.Message)"
      }
    }
  }
}

