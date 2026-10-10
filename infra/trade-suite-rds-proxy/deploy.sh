#!/usr/bin/env bash
# Deploy trade-suite-rds-proxy into the same VPC as vibrium-backend rds-query-proxy.
# Uses LamdaRole + writer endpoint. Schema isolation: trade_suite only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REGION="${AWS_REGION:-ap-south-1}"
FN_NAME="${TRADE_SUITE_RDS_PROXY_NAME:-trade-suite-rds-proxy}"
ROLE_ARN="${LAMBDA_ROLE_ARN:-arn:aws:iam::173961275780:role/LamdaRole}"
AWS_BIN="${AWS_BIN:-aws}"

DB_HOST="${DB_HOST:-aurora-vibrium-cluster.cluster-c1oswcu829p8.ap-south-1.rds.amazonaws.com}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-vibriumdb}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD required}"

SG="${VPC_SECURITY_GROUP_IDS:-sg-0063a3078175d0a10}"
SUBNETS="${VPC_SUBNET_IDS:-subnet-0a5be9e8d2563d285,subnet-0f43f9f6038b65b85,subnet-0e9e5cd494dac87da}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

python3 -m pip install -q pg8000 -t "$WORKDIR"
cp "$ROOT/handler.py" "$WORKDIR/"
(cd "$WORKDIR" && zip -qr "$ROOT/function.zip" .)

ENV_JSON=$(DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" python3 - <<'PY'
import json, os
print(json.dumps({"Variables": {
  "DB_HOST": os.environ["DB_HOST"],
  "DB_PORT": os.environ["DB_PORT"],
  "DB_NAME": os.environ["DB_NAME"],
  "DB_USER": os.environ["DB_USER"],
  "DB_PASSWORD": os.environ["DB_PASSWORD"],
  "LOG_LEVEL": "INFO",
}}))
PY
)

if $AWS_BIN lambda get-function --region "$REGION" --function-name "$FN_NAME" >/dev/null 2>&1; then
  echo "Updating ${FN_NAME}..."
  $AWS_BIN lambda update-function-code --region "$REGION" \
    --function-name "$FN_NAME" --zip-file "fileb://$ROOT/function.zip" >/dev/null
  $AWS_BIN lambda wait function-updated --region "$REGION" --function-name "$FN_NAME"
  $AWS_BIN lambda update-function-configuration --region "$REGION" \
    --function-name "$FN_NAME" \
    --timeout 60 --memory-size 256 \
    --environment "$ENV_JSON" \
    --vpc-config "SubnetIds=${SUBNETS},SecurityGroupIds=${SG}" >/dev/null
else
  echo "Creating ${FN_NAME}..."
  $AWS_BIN lambda create-function --region "$REGION" \
    --function-name "$FN_NAME" \
    --runtime python3.12 \
    --role "$ROLE_ARN" \
    --handler handler.lambda_handler \
    --timeout 60 --memory-size 256 \
    --zip-file "fileb://$ROOT/function.zip" \
    --environment "$ENV_JSON" \
    --vpc-config "SubnetIds=${SUBNETS},SecurityGroupIds=${SG}" \
    --tags "Project=vibrium-trade-suite,Scope=trade_suite_schema_only" >/dev/null
fi

$AWS_BIN lambda wait function-updated --region "$REGION" --function-name "$FN_NAME" || true
echo "Deployed ${FN_NAME}"
echo "Invoking migrate..."
printf '%s' '{"action":"migrate"}' > /tmp/ts-migrate.json
$AWS_BIN lambda invoke --region "$REGION" --function-name "$FN_NAME" \
  --payload file:///tmp/ts-migrate.json /tmp/ts-migrate-out.json >/dev/null
cat /tmp/ts-migrate-out.json
echo
