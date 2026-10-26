@id:host-update
Feature: Host update
  As a developer who runs coding agents in agentbox sessions
  I want my hosts to run the agentbox version I use
  So that what a new agentbox brings works on the hosts I already have

  Scenario: A host from agentbox 0.4 is refused, with what to do
    Given the developer has host "devbox" from agentbox 0.4
    When the developer starts session "add-search" on "devbox"
    Then the developer is told "devbox" is too old to run sessions, and to create it again

  @backlog
  Scenario: A host with an older k3s is brought up to date when it is used
    Given the developer has host "devbox" with k3s 1.36, and a dev server running in session "fix-login"
    When the developer starts session "add-search" on "devbox" with an agentbox that expects k3s 1.37
    Then the developer is told "devbox" was brought up to date
    And session "add-search" opens, and the dev server in "fix-login" is still running
