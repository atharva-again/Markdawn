package main

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
)

type DoctorCmd struct{}

type doctorResult struct {
	Version        string               `json:"version"`
	Server         string               `json:"server"`
	Authentication doctorAuthentication `json:"authentication"`
	Standalone     doctorCheck          `json:"standalone"`
	Skills         doctorCheck          `json:"skills"`
}

type doctorAuthentication struct {
	Status  string `json:"status"`
	Source  string `json:"source,omitempty"`
	User    string `json:"user,omitempty"`
	Message string `json:"message,omitempty"`
}

type doctorCheck struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

type renderedDoctorHealthError struct {
	cause error
}

func (e *renderedDoctorHealthError) Error() string { return e.cause.Error() }
func (e *renderedDoctorHealthError) Unwrap() error { return e.cause }

func (cmd *DoctorCmd) Run(r *runtimeState) error {
	result := doctorResult{
		Version:    buildVersion(),
		Standalone: inspectStandaloneInstall(),
		Skills:     inspectSkillsTool(),
	}
	server, err := r.serverURL()
	if err != nil {
		result.Server = "unavailable"
		result.Authentication = doctorAuthentication{Status: "unhealthy", Message: err.Error()}
		return renderDoctorHealthFailure(r, result, fmt.Errorf("determine server: %w", err))
	}
	result.Server = server
	cfg, err := r.config()
	if err != nil {
		result.Authentication = doctorAuthentication{Status: "unhealthy", Message: err.Error()}
		return renderDoctorHealthFailure(r, result, fmt.Errorf("load configuration: %w", err))
	}
	tokenSource := ""
	if os.Getenv("MARKDAWN_TOKEN") != "" {
		tokenSource = "MARKDAWN_TOKEN"
	} else if cfg.Token != "" {
		tokenSource = "saved configuration"
	}
	if tokenSource == "" {
		result.Authentication = doctorAuthentication{Status: "not_authenticated"}
		return renderDoctorResult(r, result)
	}
	c, err := r.client()
	if err != nil {
		result.Authentication = doctorAuthentication{Status: "unhealthy", Source: tokenSource, Message: err.Error()}
		return renderDoctorHealthFailure(r, result, fmt.Errorf("check authentication: %w", err))
	}
	response, err := c.request(http.MethodGet, "/me", nil, nil)
	if err != nil {
		result.Authentication = doctorAuthentication{Status: "unhealthy", Source: tokenSource, Message: err.Error()}
		return renderDoctorHealthFailure(r, result, fmt.Errorf("check authentication: %w", err))
	}
	var user authenticatedUser
	if err := decodeJSON(response, &user); err != nil {
		result.Authentication = doctorAuthentication{Status: "unhealthy", Source: tokenSource, Message: err.Error()}
		return renderDoctorHealthFailure(r, result, fmt.Errorf("check authentication: %w", err))
	}
	result.Authentication = doctorAuthentication{
		Status: "authenticated",
		Source: tokenSource,
		User:   user.Email,
	}
	return renderDoctorResult(r, result)
}

func renderDoctorHealthFailure(r *runtimeState, result doctorResult, cause error) error {
	if err := renderDoctorResult(r, result); err != nil {
		return err
	}
	return &renderedDoctorHealthError{
		cause: &cliError{Code: "doctor_unhealthy", Message: "doctor found unhealthy checks", Cause: cause},
	}
}

func inspectStandaloneInstall() doctorCheck {
	path, err := installReceiptPath()
	if err != nil {
		return doctorCheck{Status: "unknown", Message: err.Error()}
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return doctorCheck{Status: "not_installed", Message: "no standalone installation receipt"}
	}
	if err != nil {
		return doctorCheck{Status: "unhealthy", Message: fmt.Sprintf("read receipt: %v", err)}
	}
	receipt, err := decodeInstallReceipt(data)
	if err != nil {
		return doctorCheck{Status: "unhealthy", Message: fmt.Sprintf("invalid receipt: %v", err)}
	}
	info, err := os.Stat(receipt.BinaryPath)
	if err != nil {
		return doctorCheck{Status: "unhealthy", Message: fmt.Sprintf("inspect binary: %v", err)}
	}
	if !info.Mode().IsRegular() {
		return doctorCheck{Status: "unhealthy", Message: "standalone binary is not a regular file"}
	}
	return doctorCheck{Status: "healthy", Message: receipt.BinaryPath}
}

func inspectSkillsTool() doctorCheck {
	if _, err := exec.LookPath("npx"); err != nil {
		return doctorCheck{Status: "unavailable", Message: "optional: install Node.js to use npx skills"}
	}
	return doctorCheck{Status: "available", Message: "use npx skills add atharva-again/Markdawn --skill markdawn"}
}

func renderDoctorResult(r *runtimeState, result doctorResult) error {
	if r.cli.JSON {
		return r.printJSON(result)
	}
	if _, err := fmt.Fprintf(r.stdout, "Markdawn %s\n", terminalText(result.Version)); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(r.stdout, "Server: %s\n", terminalText(result.Server)); err != nil {
		return err
	}
	authentication := result.Authentication.Status
	if result.Authentication.User != "" {
		authentication += " as " + result.Authentication.User
	}
	if result.Authentication.Source != "" {
		authentication += " (" + result.Authentication.Source + ")"
	}
	if result.Authentication.Message != "" {
		authentication += " — " + result.Authentication.Message
	}
	if _, err := fmt.Fprintf(r.stdout, "Authentication: %s\n", terminalText(authentication)); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(r.stdout, "Standalone: %s — %s\n", terminalText(result.Standalone.Status), terminalText(result.Standalone.Message)); err != nil {
		return err
	}
	_, err := fmt.Fprintf(r.stdout, "Agent skills: %s — %s\n", terminalText(result.Skills.Status), terminalText(result.Skills.Message))
	return err
}
