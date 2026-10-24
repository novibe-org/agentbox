@id:host-provisioning
Feature: Host provisioning
  As a developer who runs coding agents in agentbox sessions
  I want to create a session host with one command
  So that I get a host for sessions without setting up a server by hand

  Scenario: A new host on Hetzner runs sessions
    Given the developer has no hosts yet
    When the developer creates host "devbox" on Hetzner
    Then session "fix-login" started on "devbox" from "acme/workspace" opens with the workspace checked out

  Scenario: A host being created tells the developer each step
    Given the developer has no hosts yet
    When the developer creates host "devbox" on Hetzner
    Then the developer is told in turn that server "devbox" is being created, is up at its address, and is ready

  Scenario: Without Hetzner access no host is created
    Given the developer has not given agentbox access to a Hetzner project
    When the developer creates host "devbox" on Hetzner
    Then the developer is told agentbox needs an API token for a Hetzner project
    And the developer has no hosts

  Scenario: A host name that is taken is refused
    Given the developer has host "devbox" with session "fix-login" on it
    When the developer creates host "devbox" on Hetzner
    Then the developer is told host "devbox" already exists
    And session "fix-login" on "devbox" opens with its work intact

  @backlog
  Scenario: A host that fails halfway leaves nothing behind
    Given Hetzner has no capacity left in Nuremberg
    When the developer creates host "devbox" on Hetzner in Nuremberg
    Then the developer is told Hetzner has no capacity in Nuremberg
    And the developer has no hosts and nothing billed on Hetzner

  @backlog
  Scenario: The first host is where sessions go by default
    Given the developer has created host "devbox" as their first host
    When the developer starts session "fix-login" from "acme/workspace" without naming a host
    Then session "fix-login" opens on "devbox"

  @id:host-on-tailnet
  Rule: A host on the developer's tailnet takes no connection from the internet

    Scenario: A host on the developer's tailnet is closed to the internet
      Given the developer has given agentbox access to their tailnet
      When the developer creates host "devbox" on Hetzner on their tailnet
      Then session "fix-login" started on "devbox" from "acme/workspace" opens with the workspace checked out
      And nothing on the internet outside the tailnet can connect to "devbox"

    Scenario: Without tailnet access no tailnet host is created
      Given the developer has not given agentbox access to their tailnet
      When the developer creates host "devbox" on Hetzner on their tailnet
      Then the developer is told agentbox needs an OAuth client for their tailnet
      And the developer has no hosts

    @backlog
    Scenario: The sessions on a tailnet host cannot reach the developer's other devices
      Given the developer has host "devbox" on their tailnet, and their laptop "mbp" is on it too
      When session "fix-login" on "devbox" tries to connect to "mbp"
      Then the connection is refused

  @id:host-moves-to-tailnet
  Rule: A host moves onto the developer's tailnet without stopping its sessions or locking the developer out

    Scenario: A host open to the internet moves onto the developer's tailnet
      Given the developer has host "devbox" with session "fix-login" on it, open to the internet
      And a dev server is running in "fix-login"
      When the developer moves "devbox" onto their tailnet
      Then the dev server in "fix-login" is still running, with its work intact
      And nothing on the internet outside the tailnet can connect to "devbox"

    Scenario: A host that cannot be reached over the tailnet stays open to the internet
      Given the developer has host "devbox" with session "fix-login" on it, open to the internet
      And their tailnet does not let them reach "devbox"
      When the developer moves "devbox" onto their tailnet
      Then the developer is told "devbox" cannot be reached over their tailnet
      And session "fix-login" on "devbox" opens with its work intact
