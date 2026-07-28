package main

import "fmt"

func completionScript(shell string) (string, error) {
	switch shell {
	case "bash":
		return `# bash completion for markdawn
_markdawn() {
  local cur prev
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "login logout whoami update uninstall help page folder completion" -- "$cur") )
  elif [[ ${COMP_WORDS[1]} == page && $COMP_CWORD -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "list view create edit update" -- "$cur") )
  elif [[ ${COMP_WORDS[1]} == page && ${COMP_WORDS[2]} == edit && $COMP_CWORD -eq 3 ]]; then
    COMPREPLY=( $(compgen -W "exact" -- "$cur") )
  elif [[ ${COMP_WORDS[1]} == folder && $COMP_CWORD -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "list" -- "$cur") )
  fi
}
complete -F _markdawn markdawn
`, nil
	case "zsh":
		return `#compdef markdawn
_markdawn() {
  local -a commands page_commands
  commands=(login logout whoami update uninstall help page folder completion)
  page_commands=(list view create edit update)
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  elif [[ $words[2] == page && CURRENT == 3 ]]; then
    _describe 'page command' page_commands
  elif [[ $words[2] == page && $words[3] == edit && CURRENT == 4 ]]; then
    _values 'edit mode' exact
  elif [[ $words[2] == folder && CURRENT == 3 ]]; then
    _values 'folder command' list
  else
    _arguments '*:argument:_files'
  fi
}
compdef _markdawn markdawn
`, nil
	case "fish":
		return `complete -c markdawn -f
complete -c markdawn -n '__fish_use_subcommand' -a 'login logout whoami update uninstall help page folder completion'
complete -c markdawn -n '__fish_seen_subcommand_from page' -a 'list view create edit update'
complete -c markdawn -n '__fish_seen_subcommand_from page; and __fish_seen_subcommand_from edit' -a 'exact'
complete -c markdawn -n '__fish_seen_subcommand_from folder' -a 'list'
`, nil
	default:
		return "", fmt.Errorf("unsupported shell %q", shell)
	}
}
