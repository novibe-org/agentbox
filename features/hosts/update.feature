@id:host-update
Feature: Host update
  As a developer who runs coding agents in agentbox sessions
  I want my hosts to run the agentbox version I use
  So that what a new agentbox brings works on the hosts I already have

  Scenario: A host from an older agentbox is brought up to date when it is used
    Given the developer has host "devbox" from agentbox 0.2.1, with a dev server running in session "fix-login"
    When the developer starts session "add-search" on "devbox" with agentbox 0.3.0
    Then the developer is told "devbox" was updated from 0.2.1 to 0.3.0
    And session "add-search" opens, and the dev server in "fix-login" is still running

  Scenario: A host setting up a session is not updated
    Given the developer has host "devbox" from agentbox 0.2.1, setting up session "fix-login"
    When the developer starts session "add-search" on "devbox" with agentbox 0.3.0
    Then the developer is told "devbox" cannot be updated while "fix-login" is being set up
    And session "fix-login" finishes its setup
