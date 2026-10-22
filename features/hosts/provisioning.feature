@id:host-provisioning
Feature: Host provisioning
  As a developer who runs coding agents in agentbox sessions
  I want to create a session host with one command
  So that I get a host for sessions without setting up a server by hand

  Scenario: A new host on Hetzner runs sessions
    Given the developer has no hosts yet
    When the developer creates host "box2" on Hetzner
    Then session "fix-login" started on "box2" from "acme/workspace" opens with the workspace checked out

  Scenario: A host being created tells the developer each step
    Given the developer has no hosts yet
    When the developer creates host "box2" on Hetzner
    Then the developer is told in turn that server "box2" is being created, is up at its address, and is ready

  Scenario: Without Hetzner access no host is created
    Given the developer has not given agentbox access to a Hetzner project
    When the developer creates host "box2" on Hetzner
    Then the developer is told agentbox needs an API token for a Hetzner project
    And the developer has no hosts

  Scenario: A host name that is taken is refused
    Given the developer has host "box2" with session "fix-login" on it
    When the developer creates host "box2" on Hetzner
    Then the developer is told host "box2" already exists
    And session "fix-login" on "box2" opens with its work intact

  @backlog
  Scenario: A host that fails halfway leaves nothing behind
    Given Hetzner has no capacity left in Nuremberg
    When the developer creates host "box2" on Hetzner in Nuremberg
    Then the developer is told Hetzner has no capacity in Nuremberg
    And the developer has no hosts and nothing billed on Hetzner

  @backlog
  Scenario: The first host is where sessions go by default
    Given the developer has created host "box2" as their first host
    When the developer starts session "fix-login" from "acme/workspace" without naming a host
    Then session "fix-login" opens on "box2"
