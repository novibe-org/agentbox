variable "name" {
  description = "Host name, the host's name in the tailnet"
  type        = string
}

variable "server_id" {
  description = "ID of the host's server, so the host's device is read once the server exists"
  type        = string
}
