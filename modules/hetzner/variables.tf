variable "name" {
  description = "Host name, unique among the developer's hosts"
  type        = string
}

variable "ssh_public_key" {
  description = "Public key of the host's own key pair, authorized for the agentbox user"
  type        = string
}

variable "host_key" {
  description = "The server's first ed25519 host key, which the CLI replaces after its first connection"
  type        = string
  sensitive   = true
}

variable "host_key_pub" {
  description = "Public half of host_key"
  type        = string
}

variable "release" {
  description = "agentbox release whose agentboxd the host runs, the CLI's own version"
  type        = string
}

variable "server_type" {
  description = "Hetzner server type"
  type        = string
  default     = "cpx32"
}

variable "location" {
  description = "Hetzner location of the server and its volume"
  type        = string
  default     = "nbg1"
}

variable "volume_size" {
  description = "Size in GB of the volume at /var/lib/agentbox: session clones, logins and the pnpm store"
  type        = number
  default     = 50
}

variable "tailnet_auth_key" {
  description = "Auth key the host joins the developer's tailnet with at its first boot"
  type        = string
  default     = null
  sensitive   = true
}

variable "tailnet" {
  description = "Whether the host is reached over the developer's tailnet only, with no port open to the internet"
  type        = bool
  default     = false
}
