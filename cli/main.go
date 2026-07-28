package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"

	"github.com/alecthomas/kong"
)

var (
	version = "dev"
	commit  = ""
)

func buildVersion() string {
	result := version
	if result == "dev" {
		if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
			result = info.Main.Version
		}
	}
	if commit != "" {
		short := commit
		if len(short) > 7 {
			short = short[:7]
		}
		result += " (" + short + ")"
	}
	return result
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cli := CLI{}
	parser, err := kong.New(
		&cli,
		kong.Name("markdawn"),
		kong.Description("Read and edit Markdawn pages from the terminal."),
		kong.UsageOnError(),
		kong.ConfigureHelp(kong.HelpOptions{Compact: true, Summary: true}),
		kong.Vars{"version": buildVersion()},
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, "markdawn:", err)
		os.Exit(exitInternal)
	}
	arguments := os.Args[1:]
	if len(arguments) > 0 && arguments[0] == "help" {
		arguments = append(arguments[1:], "--help")
	}
	parsed, err := parser.Parse(arguments)
	if err != nil {
		jsonOutput := false
		for _, argument := range arguments {
			if argument == "--json" || argument == "-j" {
				jsonOutput = true
				break
			}
		}
		if jsonOutput {
			_ = json.NewEncoder(os.Stdout).Encode(jsonErrorEnvelope{
				Error: jsonError{Code: "invalid_arguments", Message: err.Error()},
			})
		} else {
			fmt.Fprintln(os.Stderr, "markdawn:", err)
			var parseError *kong.ParseError
			if errors.As(err, &parseError) && parseError.Context != nil {
				_ = parseError.Context.PrintUsage(false)
			}
		}
		os.Exit(exitUsage)
	}
	runtime := newRuntime(ctx, &cli, os.Stdin, os.Stdout, os.Stderr)
	err = parsed.Run(runtime)
	if err == nil {
		return
	}
	if errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, "markdawn: interrupted")
		os.Exit(exitInterrupted)
	}
	runtime.printError(err)
	os.Exit(exitCode(err))
}
