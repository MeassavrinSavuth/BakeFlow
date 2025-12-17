#!/bin/bash

# Script to whitelist domain for Messenger Extensions via Graph API

PAGE_ACCESS_TOKEN="your_page_access_token_here"
DOMAIN="https://consuelo-subcardinal-nonfallaciously.ngrok-free.dev"

curl -X POST "https://graph.facebook.com/v18.0/me/thread_settings" \
  -H "Content-Type: application/json" \
  -d "{
    \"setting_type\": \"domain_whitelisting\",
    \"whitelisted_domains\": [\"$DOMAIN\"],
    \"domain_action_type\": \"add\"
  }" \
  -G -d "access_token=$PAGE_ACCESS_TOKEN"

echo ""
echo "✅ Domain whitelist request sent!"
