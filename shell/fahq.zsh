# fahq for terminals outside VS Code (Terminal.app, iTerm, Ghostty...): plays the sound
# when a command fails. Source this file from ~/.zshrc to enable it.
#   fahq off | on | test

# VS Code and Cursor terminals are handled by the extension, so don't play twice.
[[ $TERM_PROGRAM == vscode ]] && return

zmodload zsh/datetime
autoload -Uz add-zsh-hook

typeset -g FAHQ_SOUND=${FAHQ_SOUND:-${${(%):-%x}:A:h:h}/media/fahq.wav}
typeset -g FAHQ_COOLDOWN=${FAHQ_COOLDOWN:-2}   # seconds
typeset -g FAHQ_VOLUME=${FAHQ_VOLUME:-1}       # 0 to 1
typeset -g FAHQ_MUTE_FILE=${FAHQ_MUTE_FILE:-$HOME/.fahq_muted}
typeset -g _fahq_ran=0 _fahq_last=0

_fahq_play() {
  afplay -v $FAHQ_VOLUME $FAHQ_SOUND &>/dev/null &!
}

# Only set when a command actually ran, so pressing Enter on an empty prompt
# doesn't replay the last failure.
_fahq_preexec() { _fahq_ran=1 }

_fahq_precmd() {
  local code=$?
  (( _fahq_ran )) || return 0
  _fahq_ran=0
  # 130 = Ctrl+C, 146/148 = Ctrl+Z. Not mistakes.
  (( code == 0 || code == 130 || code == 146 || code == 148 )) && return 0
  [[ -e $FAHQ_MUTE_FILE ]] && return 0
  (( EPOCHREALTIME - _fahq_last < FAHQ_COOLDOWN )) && return 0
  _fahq_last=$EPOCHREALTIME
  _fahq_play
}

fahq() {
  case $1 in
    off)  touch $FAHQ_MUTE_FILE && echo "fahq muted in all terminals outside VS Code" ;;
    on)   rm -f $FAHQ_MUTE_FILE && echo "fahq on" ;;
    test) _fahq_play ;;
    *)    echo "usage: fahq off | on | test"; return 1 ;;
  esac
}

add-zsh-hook preexec _fahq_preexec
add-zsh-hook precmd _fahq_precmd
