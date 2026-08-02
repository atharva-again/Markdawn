package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/alecthomas/kong"
	"github.com/charmbracelet/huh"
)

type CLI struct {
	JSON    bool             `short:"j" help:"Write stable JSON to stdout."`
	Plain   bool             `help:"Disable colors and rich Markdown rendering."`
	NoInput bool             `help:"Never prompt; fail when input or selection is required."`
	URL     string           `help:"Override the Markdawn server URL." placeholder:"URL"`
	Timeout time.Duration    `help:"HTTP request and retry timeout." default:"30s"`
	Version kong.VersionFlag `name:"version" short:"v" help:"Print the version."`

	Login      LoginCmd              `cmd:"" help:"Authenticate with a named API token."`
	Logout     LogoutCmd             `cmd:"" help:"Remove the locally stored API token."`
	Whoami     WhoamiCmd             `cmd:"" help:"Show the authenticated user."`
	Page       PageCmd               `cmd:"" help:"Read and edit pages."`
	Folder     FolderCmd             `cmd:"" help:"Discover accessible folders."`
	Trash      TrashCmd              `cmd:"" help:"Manage deleted pages and folders."`
	Export     ExportCmd             `cmd:"" help:"Export Markdawn content."`
	Import     ImportCmd             `cmd:"" help:"Import Markdawn content."`
	Update     UpdateCmd             `cmd:"" help:"Update a standalone Markdawn installation."`
	Uninstall  UninstallCmd          `cmd:"" help:"Remove a standalone Markdawn installation."`
	Doctor     DoctorCmd             `cmd:"" help:"Check CLI, authentication, and standalone install health."`
	Skill      SkillCmd              `cmd:"" help:"Install or update the optional Markdawn agent skill."`
	Finalize   StandaloneFinalizeCmd `cmd:"" name:"standalone-finalize" hidden:""`
	Completion CompletionCmd         `cmd:"" help:"Generate a shell completion script."`
}

type LoginCmd struct{}

type LogoutCmd struct{}
type WhoamiCmd struct{}

type UpdateCmd struct {
	Version string `arg:"" optional:"" help:"Install this release version instead of the latest stable release." placeholder:"VERSION"`
}

type UninstallCmd struct {
	Purge  bool `help:"Also remove saved Markdawn configuration and credentials."`
	DryRun bool `help:"Show what would be removed without removing it."`
	Yes    bool `help:"Skip the uninstall confirmation prompt."`
}

type StandaloneFinalizeCmd struct {
	InstallDir string `required:""`
	PathFile   string `optional:""`
	PathStyle  string `optional:""`
}

type SkillCmd struct {
	Install SkillInstallCmd `cmd:"" help:"Install the Markdawn skill with npx skills."`
	Update  SkillUpdateCmd  `cmd:"" help:"Update an installed Markdawn skill with npx skills."`
}

type SkillInstallCmd struct {
	Global bool `short:"g" help:"Install for all projects instead of the current project."`
	Copy   bool `help:"Copy skill files instead of using symlinks where supported."`
	Yes    bool `short:"y" help:"Skip npx skills confirmation prompts."`
}

type SkillUpdateCmd struct {
	Global  bool `short:"g" help:"Update only globally installed skills."`
	Project bool `short:"p" help:"Update only project-installed skills."`
	Yes     bool `short:"y" help:"Skip npx skills confirmation prompts."`
}

type PageCmd struct {
	List   PageListCmd   `cmd:"" help:"List accessible pages."`
	View   PageViewCmd   `cmd:"" help:"View a page's Markdown."`
	Create PageCreateCmd `cmd:"" help:"Create a page."`
	Edit   PageEditCmd   `cmd:"" help:"Edit a page's authored Markdown."`
	Update PageUpdateCmd `cmd:"" help:"Update a page's title or icon."`
	Move   PageMoveCmd   `cmd:"" help:"Move pages."`
	Copy   PageCopyCmd   `cmd:"" help:"Copy pages."`
	Delete PageDeleteCmd `cmd:"" help:"Move pages to Trash."`
}

type FolderCmd struct {
	List   FolderListCmd   `cmd:"" help:"List accessible folders."`
	Create FolderCreateCmd `cmd:"" help:"Create a folder."`
	Update FolderUpdateCmd `cmd:"" help:"Rename a folder."`
	Move   FolderMoveCmd   `cmd:"" help:"Move folders."`
	Copy   FolderCopyCmd   `cmd:"" help:"Copy folders."`
	Delete FolderDeleteCmd `cmd:"" help:"Move folders to Trash."`
}

type TrashCmd struct {
	List    TrashListCmd    `cmd:"" help:"List trashed pages and folders."`
	Restore TrashRestoreCmd `cmd:"" help:"Restore trashed items."`
	Delete  TrashDeleteCmd  `cmd:"" help:"Permanently delete trashed items."`
	Empty   TrashEmptyCmd   `cmd:"" help:"Permanently delete all trashed items."`
}

type ExportCmd struct {
	Page ExportPageCmd `cmd:"" help:"Export one page with its attachments."`
	All  ExportAllCmd  `cmd:"" help:"Export all accessible pages as a ZIP."`
}

type ImportCmd struct {
	Page   ImportPageCmd   `cmd:"" help:"Import one Markdown page."`
	Folder ImportFolderCmd `cmd:"" help:"Import a folder or Obsidian vault."`
}

type CompletionCmd struct {
	Shell string `arg:"" enum:"bash,zsh,fish" help:"Shell to generate completion for."`
}

func (cmd *LoginCmd) Run(r *runtimeState) error {
	cfg, err := r.config()
	if err != nil {
		return err
	}
	baseURL := cfg.BaseURL
	if envURL := os.Getenv("MARKDAWN_URL"); envURL != "" {
		baseURL = envURL
	}
	if r.cli.URL != "" {
		baseURL = r.cli.URL
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")

	token := strings.TrimSpace(os.Getenv("MARKDAWN_TOKEN"))
	if token == "" && r.interactive() {
		input := huh.NewInput().Title("API token").Description("Create a named token in Markdawn Settings.").EchoMode(huh.EchoModePassword).Value(&token)
		err = huh.NewForm(huh.NewGroup(input)).WithInput(r.stdin).WithOutput(r.stderr).RunWithContext(r.ctx)
		if errors.Is(err, huh.ErrUserAborted) {
			return &cliError{Code: "aborted", Message: "login cancelled"}
		}
	} else if token == "" && !r.stdinTTY {
		reader := bufio.NewReader(io.LimitReader(r.stdin, 4097))
		token, err = reader.ReadString('\n')
	}
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	token = strings.TrimSpace(token)
	if token == "" {
		if r.stdinTTY && !r.interactive() {
			return usageError("API token is required in MARKDAWN_TOKEN when terminal input is disabled")
		}
		return usageError("API token is required on stdin or in MARKDAWN_TOKEN")
	}
	user, err := r.verifyToken(baseURL, token)
	if err != nil {
		statusCode := 0
		var apiError *cliError
		if errors.As(err, &apiError) {
			statusCode = apiError.StatusCode
		}
		return &cliError{
			Code: "token_validation_failed", Message: "token validation failed",
			StatusCode: statusCode, Cause: err,
		}
	}
	cfg.BaseURL = baseURL
	cfg.Token = token
	if err := saveConfig(cfg); err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(loginResult{Server: baseURL, User: user})
	}
	_, err = fmt.Fprintf(
		r.stdout,
		"Logged in to %s as %s <%s>\n",
		terminalText(baseURL),
		terminalText(user.Name),
		terminalText(user.Email),
	)
	return err
}

func (cmd *LogoutCmd) Run(r *runtimeState) error {
	if err := removeConfig(); err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(map[string]bool{"loggedOut": true})
	}
	if _, err := fmt.Fprintln(r.stdout, "Logged out."); err != nil {
		return err
	}
	if os.Getenv("MARKDAWN_TOKEN") != "" {
		if _, err := fmt.Fprintln(r.stderr, "MARKDAWN_TOKEN is still set and will continue to authenticate commands."); err != nil {
			return err
		}
	}
	return nil
}

func (cmd *WhoamiCmd) Run(r *runtimeState) error {
	c, err := r.client()
	if err != nil {
		return err
	}
	response, err := c.request(http.MethodGet, "/me", nil, nil)
	if err != nil {
		return err
	}
	var user authenticatedUser
	if err := decodeJSON(response, &user); err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(user)
	}
	server, err := r.serverURL()
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(
		r.stdout,
		"%s <%s>\n%s\n",
		terminalText(user.Name),
		terminalText(user.Email),
		terminalText(server),
	)
	return err
}

func (cmd *CompletionCmd) Run(r *runtimeState) error {
	script, err := completionScript(cmd.Shell)
	if err != nil {
		return err
	}
	_, err = fmt.Fprint(r.stdout, script)
	return err
}

func marshalBody(value any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode request: %w", err)
	}
	return data, nil
}
