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

# A firewall without rules lets nothing in; SSH is a firewall of its own, so leaving the internet
# removes it whole instead of emptying a rule set.
resource "hcloud_firewall" "base" {
  name = "agentbox-${var.name}-base"
}

resource "hcloud_firewall" "ssh" {
  count = var.tailnet ? 0 : 1
  name  = "agentbox-${var.name}"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

moved {
  from = hcloud_firewall.host
  to   = hcloud_firewall.ssh[0]
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
  firewall_ids = concat([hcloud_firewall.base.id], hcloud_firewall.ssh[*].id)
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    ssh_public_key   = trimspace(var.ssh_public_key)
    volume_id        = hcloud_volume.state.id
    host_key         = trimspace(var.host_key)
    host_key_pub     = trimspace(var.host_key_pub)
    provision        = file("${path.module}/provision.sh")
    join_tailnet     = file("${path.module}/join-tailnet.sh")
    name             = var.name
    tailnet_auth_key = var.tailnet_auth_key == null ? "" : var.tailnet_auth_key
  })

  lifecycle {
    ignore_changes = [user_data]
  }
}

resource "hcloud_volume_attachment" "state" {
  volume_id = hcloud_volume.state.id
  server_id = hcloud_server.host.id
}

# A server's cloud-init runs at its first boot only, so a running server joins the tailnet over SSH.
resource "terraform_data" "tailnet_join" {
  count            = var.join_running_host ? 1 : 0
  triggers_replace = [hcloud_server.host.id]

  connection {
    type        = "ssh"
    host        = hcloud_server.host.ipv4_address
    user        = "agentbox"
    private_key = var.ssh_private_key
    host_key    = var.ssh_host_key
  }

  provisioner "file" {
    source      = "${path.module}/join-tailnet.sh"
    destination = "/tmp/agentbox-join-tailnet"
  }

  provisioner "remote-exec" {
    inline = ["sudo sh /tmp/agentbox-join-tailnet '${var.tailnet_auth_key}' '${var.name}'", "rm /tmp/agentbox-join-tailnet"]
  }
}
