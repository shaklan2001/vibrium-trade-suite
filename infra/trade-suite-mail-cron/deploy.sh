#!/usr/bin/env bash
# Deploy the mail-cron Lambda and its EventBridge schedule (every 5 minutes).
#
#   APP_URL=https://<your-app>.vercel.app CRON_SECRET=<same value as in Vercel> ./deploy.sh
#   RATE="rate(10 minutes)" ... ./deploy.sh      change the interval
#
# Re-running updates the code and env. Uses the existing LamdaRole (no IAM role is created or edited).
# Resource-policy step: EventBridge needs permission to invoke this one function (add-permission).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REGION="${AWS_REGION:-ap-south-1}"
FN_NAME="${MAIL_CRON_FN_NAME:-trade-suite-mail-cron}"
RULE="${MAIL_CRON_RULE:-trade-suite-mail-cron-5min}"
RATE="${RATE:-rate(5 minutes)}"
ROLE_ARN="${LAMBDA_ROLE_ARN:-arn:aws:iam::173961275780:role/LamdaRole}"
AWS_BIN="${AWS_BIN:-aws}"
: "${APP_URL:?APP_URL is required (https://your-app.vercel.app)}"
: "${CRON_SECRET:?CRON_SECRET is required (same value as the app)}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
cp "$ROOT/handler.py" "$WORKDIR/"
rm -f "$ROOT/function.zip"
(cd "$WORKDIR" && zip -qr "$ROOT/function.zip" .)

ENV_JSON=$(APP_URL="$APP_URL" CRON_SECRET="$CRON_SECRET" python3 -c 'import json,os;print(json.dumps({"Variables":{"APP_URL":os.environ["APP_URL"],"CRON_SECRET":os.environ["CRON_SECRET"]}}))')

if $AWS_BIN lambda get-function --region "$REGION" --function-name "$FN_NAME" >/dev/null 2>&1; then
  echo "Updating ${FN_NAME}..."
  $AWS_BIN lambda update-function-code --region "$REGION" --function-name "$FN_NAME" --zip-file "fileb://$ROOT/function.zip" >/dev/null
  $AWS_BIN lambda wait function-updated --region "$REGION" --function-name "$FN_NAME"
  $AWS_BIN lambda update-function-configuration --region "$REGION" --function-name "$FN_NAME" --timeout 75 --memory-size 128 --environment "$ENV_JSON" >/dev/null
else
  echo "Creating ${FN_NAME}..."
  $AWS_BIN lambda create-function --region "$REGION" --function-name "$FN_NAME" \
    --runtime python3.12 --role "$ROLE_ARN" --handler handler.lambda_handler \
    --timeout 75 --memory-size 128 --zip-file "fileb://$ROOT/function.zip" --environment "$ENV_JSON" \
    --tags "Project=vibrium-trade-suite" >/dev/null
fi
$AWS_BIN lambda wait function-updated --region "$REGION" --function-name "$FN_NAME"
# One run at a time: a slow cycle must not stack with the next tick.
$AWS_BIN lambda put-function-concurrency --region "$REGION" --function-name "$FN_NAME" --reserved-concurrent-executions 1 >/dev/null 2>&1 || true

FN_ARN=$($AWS_BIN lambda get-function --region "$REGION" --function-name "$FN_NAME" --query Configuration.FunctionArn --output text)
RULE_ARN=$($AWS_BIN events put-rule --region "$REGION" --name "$RULE" --schedule-expression "$RATE" --state ENABLED --query RuleArn --output text)
$AWS_BIN lambda add-permission --region "$REGION" --function-name "$FN_NAME" --statement-id "${RULE}-invoke" \
  --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn "$RULE_ARN" >/dev/null 2>&1 || true
$AWS_BIN events put-targets --region "$REGION" --rule "$RULE" --targets "Id=1,Arn=${FN_ARN}" >/dev/null
echo "Scheduled ${FN_NAME} ${RATE} via rule ${RULE}"

echo "Test run..."
$AWS_BIN lambda invoke --region "$REGION" --function-name "$FN_NAME" /tmp/mail-cron-out.json >/dev/null
cat /tmp/mail-cron-out.json; echo
