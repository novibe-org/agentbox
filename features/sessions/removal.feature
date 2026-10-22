@id:session-removal
Feature: Session removal
  As a developer who runs coding agents in agentbox sessions
  I want to remove a session I am done with
  So that my host keeps only the sessions I still work in

  Scenario: A session that lost its container keeps its work
    Given the developer has session "fix-login" on "box2" with a note in its workspace
    And the container of session "fix-login" is gone
    When the developer removes session "fix-login"
    Then the developer is told the work in "fix-login" cannot be checked
    And the note in "fix-login" is still on "box2"
