Get-PnpDevice | Where-Object { $_.FriendlyName -like "*HUAWEI*" -or $_.FriendlyName -like "*Android*" -or $_.InstanceId -like "*12D1*" } | Format-List
