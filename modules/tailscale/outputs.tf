output "auth_key" {
  value     = tailscale_tailnet_key.host.key
  sensitive = true
}

output "dns_name" {
  value = trimsuffix(data.tailscale_device.host.name, ".")
}
