#!/usr/bin/env bash
# Screenshots of the iOS and watchOS apps against a running demo node.
#   scripts/shoot-native-apple.sh <iphone-sim-udid> <watch-sim-udid> <node-base-url> <out-dir>
# Needs: built apps (xcodebuild … -derivedDataPath apps/apple/build/dd), node with password "demo".
set -euo pipefail
IPH=$1 WAT=$2 NODE=$3 OUT=$4
TMP=$(mktemp -d)
APP=apps/apple/build/dd/Build/Products/Debug-iphonesimulator/Satchel.app
WAPP=apps/apple/build/dd/Build/Products/Debug-watchsimulator/SatchelWatch.app
curl -s -c "$TMP/ck" -H 'content-type: application/json' -d '{"password":"demo"}' "$NODE/admin/api/login" >/dev/null
link() { curl -s -b "$TMP/ck" -X POST -H 'content-type: application/json' -H "origin: $NODE" -d '{}' "$NODE/admin/api/pair" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).link))'; }
shot() { xcrun simctl io "$1" screenshot "$TMP/$2.png" >/dev/null 2>&1; cp "$TMP/$2.png" "$OUT/$2.png"; }
run() { local sim=$1 id=$2; shift 2; xcrun simctl terminate "$sim" "$id" >/dev/null 2>&1 || true; xcrun simctl launch "$sim" "$id" "$@" >/dev/null; }
mkdir -p "$OUT"

xcrun simctl uninstall "$IPH" dev.satchel.ios >/dev/null 2>&1 || true
xcrun simctl install "$IPH" "$APP"
xcrun simctl ui "$IPH" appearance light
run "$IPH" dev.satchel.ios; sleep 4; shot "$IPH" ios-pair
run "$IPH" dev.satchel.ios -SatchelSkipAuth -SatchelPairLink "$(link)" -SatchelTab approvals; sleep 8; shot "$IPH" ios-approvals
run "$IPH" dev.satchel.ios -SatchelSkipAuth -SatchelOpenFirstApproval; sleep 9; shot "$IPH" ios-approval-detail
run "$IPH" dev.satchel.ios -SatchelSkipAuth -SatchelTab inbox -SatchelRevealAll; sleep 5; shot "$IPH" ios-inbox
for tab in upcoming capture settings; do run "$IPH" dev.satchel.ios -SatchelSkipAuth -SatchelTab $tab; sleep 7; shot "$IPH" "ios-$tab"; done
xcrun simctl ui "$IPH" appearance dark
run "$IPH" dev.satchel.ios -SatchelSkipAuth -SatchelOpenFirstApproval; sleep 9; shot "$IPH" ios-approval-detail-dark
xcrun simctl ui "$IPH" appearance light

xcrun simctl uninstall "$WAT" dev.satchel.ios.watchkitapp >/dev/null 2>&1 || true
xcrun simctl install "$WAT" "$WAPP"
run "$WAT" dev.satchel.ios.watchkitapp; sleep 5; shot "$WAT" watch-enroll
run "$WAT" dev.satchel.ios.watchkitapp -SatchelPairLink "$(link)"; sleep 8; shot "$WAT" watch-approvals
run "$WAT" dev.satchel.ios.watchkitapp -SatchelOpenFirstApproval; sleep 9; shot "$WAT" watch-approval-detail
rm -rf "$TMP"
echo "screenshots in $OUT"
