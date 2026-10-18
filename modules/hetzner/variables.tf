variable "name" {
  description = "Host name, unique among the developer's hosts"
  type        = string
}

variable "ssh_public_key" {
  description = "Public key of the host's own key pair, authorized for the agentbox user"
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
