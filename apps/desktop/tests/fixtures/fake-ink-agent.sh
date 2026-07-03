#!/usr/bin/env bash
set -euo pipefail

frame=0
last_input=""
painted=0
original_stty=""

if [[ -t 0 ]]; then
  original_stty="$(stty -g || true)"
  stty -echo
fi

restore_tty() {
  if [[ -n "$original_stty" ]]; then
    stty "$original_stty" || true
  fi
}

trap restore_tty EXIT

cols() {
  local value
  value="$(stty size 2>/dev/null | awk '{print $2}')"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 )); then
    value="$(tput cols 2>/dev/null || printf '120')"
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 )); then
    value=120
  fi
  printf '%s' "$value"
}

repeat_to_cols() {
  local pattern="$1"
  local width="$2"
  local out=""
  while ((${#out} < width)); do
    out+="$pattern"
  done
  printf '%s' "${out:0:width}"
}

ruler() {
  local width="$1"
  repeat_to_cols "----+----1----+----2----+----3----+----4----+----5----+----6----+----7----+----8----+----9----+----0" "$width"
}

box_line() {
  local width="$1"
  if (( width <= 1 )); then
    printf '┌'
  elif (( width == 2 )); then
    printf '┌┐'
  else
    printf '┌%s┐' "$(repeat_to_cols '─' "$((width - 2))")"
  fi
}

line_to_cols() {
  local text="$1"
  local width="$2"
  if ((${#text} > width)); then
    printf '%s' "${text:0:width}"
  else
    printf '%-*s' "$width" "$text"
  fi
}

repaint() {
  local width
  width="$(cols)"
  frame=$((frame + 1))

  if (( painted == 1 )); then
    printf '\033[6A'
  fi
  painted=1

  printf '\r\033[2K%s\r\n' "$(line_to_cols "FAKE-INK v1 frame=${frame} cols=${width}" "$width")"
  printf '\r\033[2K%s\r\n' "$(ruler "$width")"
  printf '\r\033[2K%s\r\n' "$(box_line "$width")"
  printf '\r\033[2K%s\r\n' "$(line_to_cols "input: ${last_input}" "$width")"
  printf '\r\033[2K%s\r\n' "$(line_to_cols "status: ⣾ repainting 🧪 stable width oracle" "$width")"
  printf '\r\033[2K%s' "$(repeat_to_cols '─' "$width")"
}

trap repaint WINCH
repaint

while IFS= read -r line; do
  last_input="$line"
  repaint
done
