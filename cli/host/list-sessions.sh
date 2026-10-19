docker ps -a --filter label=agentbox.session --format '{{.Label "agentbox.session"}}\t{{.Status}}'
