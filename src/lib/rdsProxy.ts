import {
  InvokeCommand,
  LambdaClient,
} from "@aws-sdk/client-lambda";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const FN =
  process.env.TRADE_SUITE_RDS_PROXY_NAME || "trade-suite-rds-proxy";

let client: LambdaClient | null = null;

function getClient() {
  if (client) return client;
  client = new LambdaClient({ region: REGION });
  return client;
}

export type ProxyResult<T = unknown> = {
  success: boolean;
  error?: string;
  data?: T;
  counts?: {
    total?: number;
    byStage?: Record<string, number>;
    byStatus?: Record<string, number>;
    byModel?: Record<string, number>;
    spendUsd?: number;
  };
};

/** Invoke the VPC Lambda that talks to Aurora schema trade_suite only. */
export async function invokeTradeSuiteRds<T = unknown>(
  payload: Record<string, unknown>,
): Promise<ProxyResult<T>> {
  const res = await getClient().send(
    new InvokeCommand({
      FunctionName: FN,
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
  if (res.FunctionError) {
    const raw = res.Payload
      ? Buffer.from(res.Payload).toString("utf8")
      : res.FunctionError;
    return { success: false, error: `Lambda error: ${raw}` };
  }
  const text = res.Payload ? Buffer.from(res.Payload).toString("utf8") : "{}";
  try {
    return JSON.parse(text) as ProxyResult<T>;
  } catch {
    return { success: false, error: `Bad Lambda payload: ${text.slice(0, 200)}` };
  }
}

/** Opt-in only — mirrors vibrium-backend callers that set RDS_PROXY_LAMBDA_NAME. */
export function isRdsProxyEnabled(): boolean {
  return process.env.TRADE_SUITE_DB_MODE === "rds-proxy";
}
