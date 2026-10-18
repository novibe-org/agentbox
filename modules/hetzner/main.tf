terraform {
  required_version = ">= 1.10"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.70"
    }
  }
}

resource "hcloud_ssh_key" "host" {
  name       = "agentbox-${var.name}"
  public_key = trimspace(var.ssh_public_key)
}

resource "hcloud_firewall" "host" {
  name = "agentbox-${var.name}"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_volume" "state" {
  name     = "agentbox-${var.name}"
  size     = var.volume_size
  location = var.location
  format   = "ext4"
}

resource "hcloud_server" "host" {
  name         = var.name
  server_type  = var.server_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.host.id]
  firewall_ids = [hcloud_firewall.host.id]
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    ssh_public_key = trimspace(var.ssh_public_key)
    volume_id      = hcloud_volume.state.id
  })
}

resource "hcloud_volume_attachment" "state" {
  volume_id = hcloud_volume.state.id
  server_id = hcloud_server.host.id
}
