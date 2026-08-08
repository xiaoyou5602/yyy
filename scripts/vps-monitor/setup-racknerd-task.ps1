# 创建 Windows 计划任务：每日检查 VPS 服务商官网低价套餐
# 用法：右键 → 使用 PowerShell 运行

$taskName = "CheckRackNerdDeals"
$scriptPath = "$env:USERPROFILE\withtoge\scripts\vps-monitor\check-racknerd-deals.js"
$nodePath = (Get-Command node).Source

# 创建任务动作
$action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$scriptPath`" --quiet"

# 每天上午 10:00；低价库存通常很短，可按需要调整频率
$trigger = New-ScheduledTaskTrigger -Daily -At "10:00"

# 配置：唤醒电脑运行、允许按需运行
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -WakeToRun

# 注册任务
Register-ScheduledTask -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "每日检查 DediRock、RackNerd、CloudCone 官网是否有年付低价套餐" `
  -Force

Write-Host "✅ 计划任务 '$taskName' 已创建！每天 10:00 自动检查官网"
Write-Host "   脚本：$scriptPath"
Write-Host ""
Write-Host "💡 查看任务：taskschd.msc  →  任务计划程序库"
Write-Host "💡 手动运行：schtasks /run /tn '$taskName'"
