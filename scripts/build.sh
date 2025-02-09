#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
DOCKER_DIR=$SCRIPT_DIR/../src/docker

cd $DOCKER_DIR

aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin 345594579451.dkr.ecr.eu-central-1.amazonaws.com
docker build --platform linux/amd64,linux/arm64 -t webnodets-repo . 
docker tag webnodets-repo:latest 345594579451.dkr.ecr.eu-central-1.amazonaws.com/webnodets-repo:latest
docker push 345594579451.dkr.ecr.eu-central-1.amazonaws.com/webnodets-repo:latest
