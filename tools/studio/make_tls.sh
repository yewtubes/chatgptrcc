#!/bin/bash
# Creates the local backend's CA and server certificate in backend-tls/ (keys stay
# local and untracked). Existing keys are reused; the server certificate is
# reissued when its key is new. SANs: backend-tls/san.cnf.
set -euo pipefail
cd "$(dirname "$0")/../../backend-tls"
if [ ! -s ca.key ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 -subj "/CN=Local Roblox Backend CA" 2>/dev/null
  rm -f server.key
fi
if [ ! -s server.key ]; then
  openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=*.sitetest1.robloxlabs.com" -config san.cnf 2>/dev/null
  openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 825 -extfile san.cnf -extensions ext 2>/dev/null
fi
openssl verify -CAfile ca.crt server.crt
