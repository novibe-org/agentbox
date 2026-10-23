output "auth_key" {
  value     = tailscale_tailnet_key.host.key
  sensitive = true
}

output "dns_name" {
  value = one([for d in data.tailscale_devices.host.devices : trimsuffix(d.name, ".") if d.id == data.tailscale_device.host.id])
}
