#!/bin/bash

export REPO_NAME=webnodets-repo
export VERSION_TAG=latest
export ACCOUNT_ID=$(aws sts get-caller-identity | jq -r .Account)
export ECR_SERVICE=${ACCOUNT_ID}.dkr.ecr.eu-central-1.amazonaws.com
export REPO_URI=${ECR_SERVICE}/${REPO_NAME}:${VERSION_TAG}

export SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
export DOCKER_DIR=$SCRIPT_DIR/../src/docker

cd $DOCKER_DIR

aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.eu-central-1.amazonaws.com
docker build --platform linux/amd64 --provenance false -t ${REPO_NAME}:${VERSION_TAG} . 
docker tag ${REPO_NAME}:${VERSION_TAG} ${REPO_URI}
docker push ${REPO_URI}
