#!/usr/bin/env bash
# Records a scripted buyer walkthrough on the Android emulator (see docs/demo.md).
# Needs: the demo stack up (scripts/demo.sh up), emulator booted, Expo Go with the buyer app on :8081,
# and ffmpeg. Coordinates are for the aidooi_pixel AVD (1080x2400).
set -euo pipefail

ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/demo-video"
SEGMENT="${1:-browse}"
mkdir -p "$OUT_DIR"

tap() { "$ADB" shell input tap "$1" "$2"; }
swipe() { "$ADB" shell input swipe "$1" "$2" "$3" "$4" "${5:-350}"; }
type_text() { "$ADB" shell input text "$1"; }
pause() { sleep "$1"; }
# Centre of the first element whose text or content-desc starts with $1 (or the Nth EditText with "edit:N").
locate() {
  "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || return 1
  "$ADB" exec-out cat /sdcard/ui.xml | python3 -I -c '
import re, sys
want = sys.argv[1]
xml = sys.stdin.read()
nodes = re.findall(r"<node([^>]*)>", xml)
def attr(n, k):
    m = re.search(k + r"=\"([^\"]*)\"", n)
    return m.group(1) if m else ""
hits = []
for n in nodes:
    b = re.search(r"bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", n)
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    if want.startswith("edit:"):
        ok = "EditText" in attr(n, "class")
    else:
        ok = attr(n, "text").startswith(want) or attr(n, "content-desc").startswith(want)
    if ok and x2 > x1 and y2 > y1:
        hits.append(((x1 + x2) // 2, (y1 + y2) // 2))
idx = int(want[5:]) if want.startswith("edit:") else 0
if idx >= len(hits):
    sys.exit(1)
print(*hits[idx])
' "$1"
}
# Tap a label, waiting up to 40 s for it to appear (screens load from the API).
tap_label() {
  local pos tries=0
  until pos="$(locate "$1")" && [ -n "$pos" ]; do
    tries=$((tries + 1)); [ "$tries" -gt 20 ] && { echo "not found: $1" >&2; return 1; }
    sleep 2
  done
  # shellcheck disable=SC2086
  tap $pos
}

# Focus the Nth text field, clear it, then type (the emulator drops keystrokes if they race the focus change).
fill() {
  tap_label "edit:$1"; pause 1
  "$ADB" shell input keyevent KEYCODE_MOVE_END
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do "$ADB" shell input keyevent KEYCODE_DEL; done
  type_text "$2"; pause 1
}

# Builds the Value-tier "Best overall" living room and stops on its room screen.
reach_room() {
  tap_label "Living room, "; pause 3
  fill 0 5; fill 1 4
  tap_label "Next"; pause 2
  tap_label "See budgets"; pause 6
  tap_label "Value"; pause 8
  tap_label "Best overall"; pause 5
}

if [ "$SEGMENT" = checkout ]; then
  swipe 540 1800 540 800 500; pause 1
  reach_room
fi

"$ADB" shell rm -f "/sdcard/$SEGMENT.mp4"
"$ADB" shell screenrecord --bit-rate 6000000 --time-limit 170 "/sdcard/$SEGMENT.mp4" &
REC=$!
trap '"$ADB" shell pkill -2 screenrecord || true' EXIT
pause 2

case "$SEGMENT" in
browse)
  pause 3
  swipe 540 1800 540 800 700; pause 2
  tap_label "Living room, "; pause 3
  fill 0 5; fill 1 4
  tap_label "Next"; pause 3
  swipe 540 1700 540 900 600; pause 2
  swipe 540 900 540 1700 600; pause 1
  tap_label "See budgets"; pause 6
  swipe 540 1700 540 1000 600; pause 2
  swipe 540 1000 540 1700 600; pause 1
  tap_label "Value"; pause 8
  swipe 540 1800 540 800 700; pause 2
  swipe 540 800 540 1800 700; pause 1
  tap_label "Best overall"; pause 5
  swipe 540 1900 540 600 700; pause 2
  tap_label "Kano Sofa"; pause 4
  swipe 540 1700 540 1000 600; pause 2
  tap_label "Close"; pause 2
  ;;
checkout)
  pause 1
  ;;
esac

pause 2
"$ADB" shell pkill -2 screenrecord || true # SIGINT lets it finalise the mp4
wait "$REC" 2>/dev/null || true
pause 1
"$ADB" pull "/sdcard/$SEGMENT.mp4" "$OUT_DIR/$SEGMENT.mp4"
echo "saved $OUT_DIR/$SEGMENT.mp4"
