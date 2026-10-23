@id:cli-update @backlog
Feature: CLI update
  As a developer who runs coding agents in agentbox sessions
  I want agentbox to keep itself up to date
  So that I always have what the latest release brings, without upgrading by hand

  Scenario: The CLI updates itself before it runs a command
    Given the developer has agentbox 0.3.0, and 0.3.1 is released
    When the developer lists their sessions
    Then the developer is told agentbox was updated from 0.3.0 to 0.3.1
    And their sessions are listed
