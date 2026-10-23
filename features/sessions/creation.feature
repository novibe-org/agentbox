@id:session-creation
Feature: Session creation
  As a developer who runs coding agents in agentbox sessions
  I want to start a session for a task with one command
  So that every task gets its own workspace on my host

  Scenario: A new session opens with the workspace set up
    Given the developer has host "devbox"
    When the developer starts session "fix-login" from "acme/workspace" on "devbox"
    Then session "fix-login" opens with "acme/app" checked out by the workspace's setup

  Scenario: A session id that is taken is refused
    Given the developer has session "fix-login" on "devbox" with a note in its workspace
    When the developer starts session "fix-login" from "acme/workspace" on "another-devbox"
    Then the developer is told session "fix-login" already exists on "devbox"
    And session "fix-login" opens with its note intact

  Scenario: A session opens from an app that does not have agentbox on its PATH
    Given the developer has host "devbox"
    When the developer starts session "fix-login" from "acme/workspace" on "devbox"
    Then session "fix-login" opens from a terminal app that runs ssh without the developer's PATH

  @backlog
  Scenario: A session whose setup fails tells the developer why
    Given the setup of "acme/workspace" fails cloning "acme/app"
    When the developer starts session "fix-login" from "acme/workspace" on "devbox"
    Then the developer is told the setup of "fix-login" failed cloning "acme/app"

  @backlog
  Scenario: A session finishes setting up while the laptop sleeps
    Given the developer has host "devbox"
    When the developer starts session "fix-login" from "acme/workspace" on "devbox" and the laptop goes to sleep
    Then session "fix-login" opens with "acme/app" checked out by the workspace's setup
