#!/usr/bin/env bash
# Assemble the Golazo demo video from the recorded segments and generated cards.
# Silent, 1920x1080, 30fps. No music. Captions in a bottom strip that never
# covers terminal content.
set -euo pipefail

D="$(cd "$(dirname "$0")" && pwd)"
SEG="$D/segments"
BUILD="$D/build"
BS="${1:?pass the blockscout png path}"   # blockscout screenshot (live tx)
mkdir -p "$BUILD"

FB=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
FR=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
BG='#171717'; TEAL='#2dd4bf'; WHITE='#e6edf3'; DIM='#8b98a5'

# ---- cards ----------------------------------------------------------------
convert -size 1920x1080 xc:"$BG" \
  -font "$FB" -pointsize 168 -fill "$TEAL" -kerning 6 -gravity North -annotate +0+300 'GOLAZO' \
  -font "$FR" -pointsize 48 -fill "$WHITE" -gravity North -annotate +0+540 'an agent-payable World Cup 2026 data API on Injective' \
  -font "$FR" -pointsize 30 -fill "$DIM"   -gravity North -annotate +0+640 'free archive plus premium analytics paid in USDC, agent to API' \
  "$BUILD/card_title.png"

convert -size 1920x1080 xc:"$BG" \
  -font "$FR" -pointsize 52 -fill "$WHITE" -gravity North -annotate +0+380 'The 2026 World Cup ended on July 19.' \
  -font "$FR" -pointsize 52 -fill "$WHITE" -gravity North -annotate +0+470 'The data is now a permanent archive.' \
  -font "$FB" -pointsize 56 -fill "$TEAL"  -gravity North -annotate +0+620 'Nobody made it agent-payable. Golazo does.' \
  "$BUILD/card_problem.png"

convert -size 1920x1080 xc:"$BG" \
  -font "$FB" -pointsize 60 -fill "$TEAL"  -gravity North -annotate +0+320 'github.com/nevodesigns/golazo' \
  -font "$FR" -pointsize 34 -fill "$DIM"   -gravity North -annotate +0+470 'built on four Injective technologies' \
  -font "$FB" -pointsize 46 -fill "$WHITE" -gravity North -annotate +0+560 'x402       MCP Server       Agent Skills       CCTP' \
  -font "$FR" -pointsize 30 -fill "$DIM"   -gravity North -annotate +0+690 'agent-payable World Cup 2026 data, settled in USDC' \
  "$BUILD/card_closing.png"

# ---- caption strips (transparent, bar at bottom 80px) ---------------------
mkcap() { # $1 out  $2 label  $3 desc
  convert -size 1920x1080 xc:none \
    -fill '#12181f' -draw "rectangle 0,1000 1920,1080" \
    -fill "$TEAL"   -draw "rectangle 0,1000 1920,1003" \
    -font "$FB" -pointsize 26 -fill "$TEAL"  -gravity NorthWest -annotate +64+1030 "$2" \
    -font "$FR" -pointsize 26 -fill "$WHITE" -gravity NorthWest -annotate +380+1030 "$3" \
    "$1"
}
mkcap "$BUILD/cap_free.png"  "FREE API"       "the full tournament archive, no key and no payment"
mkcap "$BUILD/cap_money.png" "PAID QUERY"     "an agent signs EIP-3009 and settles 0.01 USDC on Injective, then gets the data"
mkcap "$BUILD/cap_proof.png" "ON-CHAIN PROOF" "the same settlement on Injective Blockscout, 0.01 USDC, status success"
mkcap "$BUILD/cap_agent.png" "AGENT SKILL"    "the installed skill drives real Golazo tool calls to answer a question"
mkcap "$BUILD/cap_cctp.png"  "CCTP V2"        "the agent can refuel its own USDC from Avalanche Fuji to Injective"

# ---- encode helpers -------------------------------------------------------
V="-r 30 -c:v libx264 -pix_fmt yuv420p -profile:v high -preset medium -crf 20"

card() { ffmpeg -y -loglevel error -loop 1 -t "$2" -i "$1" -vf "format=yuv420p" $V "$3"; }

term() { # $1 seg.mp4  $2 dur  $3 cap.png  $4 out
  ffmpeg -y -loglevel error -i "$1" -i "$3" -filter_complex \
    "[0:v]trim=0:$2,setpts=PTS-STARTPTS,pad=1920:1080:0:0:color=0x171717[p];[p][1:v]overlay=0:0,fps=30,format=yuv420p[v]" \
    -map "[v]" $V "$4"
}

still() { # $1 png  $2 dur  $3 cap.png  $4 out
  ffmpeg -y -loglevel error -loop 1 -t "$2" -i "$1" -i "$3" -filter_complex \
    "[0:v]scale=1920:1000[s];[s]pad=1920:1080:0:0:color=0x171717[p];[p][1:v]overlay=0:0,fps=30,format=yuv420p[v]" \
    -map "[v]" $V "$4"
}

echo "encoding clips..."
card "$BUILD/card_title.png"   5 "$BUILD/01_title.mp4"
card "$BUILD/card_problem.png" 7 "$BUILD/02_problem.mp4"
term "$SEG/free.mp4"  16  "$BUILD/cap_free.png"  "$BUILD/03_free.mp4"
term "$SEG/money.mp4" 30  "$BUILD/cap_money.png" "$BUILD/04_money.mp4"
still "$BS"           6   "$BUILD/cap_proof.png" "$BUILD/05_proof.mp4"
term "$SEG/agent.mp4" 15.5 "$BUILD/cap_agent.png" "$BUILD/06_agent.mp4"
term "$SEG/cctp.mp4"  15.5 "$BUILD/cap_cctp.png"  "$BUILD/07_cctp.mp4"
card "$BUILD/card_closing.png" 8 "$BUILD/08_closing.mp4"

echo "concatenating..."
ffmpeg -y -loglevel error \
  -i "$BUILD/01_title.mp4" -i "$BUILD/02_problem.mp4" -i "$BUILD/03_free.mp4" \
  -i "$BUILD/04_money.mp4" -i "$BUILD/05_proof.mp4" -i "$BUILD/06_agent.mp4" \
  -i "$BUILD/07_cctp.mp4" -i "$BUILD/08_closing.mp4" \
  -f lavfi -t 200 -i anullsrc=r=44100:cl=stereo \
  -filter_complex "[0:v][1:v][2:v][3:v][4:v][5:v][6:v][7:v]concat=n=8:v=1:a=0[v]" \
  -map "[v]" -map 8:a -shortest \
  -r 30 -c:v libx264 -pix_fmt yuv420p -profile:v high -preset medium -crf 20 \
  -c:a aac -b:a 128k -movflags +faststart "$D/golazo-demo.mp4"

echo "done: $D/golazo-demo.mp4"
ffprobe -v error -show_entries format=duration:stream=width,height -of default=noprint_wrappers=1 "$D/golazo-demo.mp4"
