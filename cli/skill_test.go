package main

import "testing"

func TestSkillUpdateRejectsConflictingScopes(t *testing.T) {
	err := (&SkillUpdateCmd{Global: true, Project: true}).Run(&runtimeState{cli: &CLI{}})
	if exitCode(err) != exitUsage {
		t.Fatalf("expected usage error, got %v", err)
	}
}

func TestSkillCommandsRejectJSONOutput(t *testing.T) {
	err := (&SkillInstallCmd{}).Run(&runtimeState{cli: &CLI{JSON: true}})
	if exitCode(err) != exitUsage {
		t.Fatalf("expected usage error, got %v", err)
	}
}
