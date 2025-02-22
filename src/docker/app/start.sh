#!/bin/bash

# Check if the environment variable WORKER_TYPE is set to "leader"
if [ "$WORKER_TYPE" == "leader" ]; then
  echo "WORKER_TYPE is leader"
  exit 0
else
  echo "WORKER_TYPE is not leader"
  exit 1
fi