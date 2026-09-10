#!/bin/sh
set -e
cd /app
ls -la | head -25
node server.js &
PID=$!
sleep 4
if kill -0 $PID 2>/dev/null; then
  echo "SERVER_RUNNING_OK_4s"
  kill $PID
  exit 0
else
  echo "SERVER_NOT_RUNNING_FAIL"
  exit 1
fi
