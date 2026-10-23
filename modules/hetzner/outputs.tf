output "ipv4" {
  value = hcloud_server.host.ipv4_address
}

output "server_id" {
  value = hcloud_server.host.id
}
