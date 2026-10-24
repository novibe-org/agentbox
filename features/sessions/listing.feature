@id:session-listing
Feature: Session listing
  As a developer who runs coding agents in agentbox sessions
  I want to see my sessions on all my hosts with one command
  So that I know what runs where

  Scenario: A developer without sessions is told how to start one
    Given the developer has host "devbox"
    When the developer lists their sessions
    Then the developer is told there are no sessions yet, and how to start one on "devbox"

  Scenario: A host that does not answer hides no other host's sessions
    Given the developer has session "fix-login" on "devbox", and host "claude-box" does not answer
    When the developer lists their sessions
    Then the developer is told "claude-box" does not answer
    And the developer sees session "fix-login" on "devbox"
