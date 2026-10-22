terraform {
  required_version = ">= 1.10"
  required_providers {
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.29"
    }
  }
}

resource "tailscale_tailnet_key" "host" {
  reusable      = false
  ephemeral     = false
  preauthorized = true
  expiry        = 3600
  tags          = ["tag:agentbox"]
  description   = "agentbox host ${var.name}"
}

# The host joins once its server exists; reading its device waits for that.
resource "terraform_data" "server" {
  input = var.server_id
}

data "tailscale_device" "host" {
  hostname   = var.name
  wait_for   = "600s"
  depends_on = [terraform_data.server]
}

# A device looked up by hostname has no full name, so the device list supplies it.
data "tailscale_devices" "host" {
  name_prefix = "${var.name}."
  depends_on  = [data.tailscale_device.host]
}
