"use client";

import { vibriumGet, vibriumPost } from "./vibriumClient";
import type { VoiceBot, WorkflowMeta } from "@/types/vibrium";

export async function listVoiceBots() {
  const data = await vibriumGet<{ bots?: VoiceBot[] } | VoiceBot[]>(
    "/voice-bots",
  );
  if (Array.isArray(data)) return data;
  return data?.bots || [];
}

export async function listWorkflows() {
  try {
    const data = await vibriumGet<
      { workflows?: WorkflowMeta[] } | WorkflowMeta[]
    >("/workflows");
    if (Array.isArray(data)) return data;
    return data?.workflows || [];
  } catch {
    return [];
  }
}

export async function addLead(body: {
  workflow_id: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  country_code?: string;
  email?: string;
  [key: string]: unknown;
}) {
  return vibriumPost("/add-lead", body);
}

export async function getPresignedUpload(body: {
  filename: string;
  content_type?: string;
  folder?: string;
}) {
  return vibriumPost<{
    upload_url?: string;
    url?: string;
    s3_key?: string;
    key?: string;
    public_url?: string;
  }>("/uploads/presigned-url", body);
}

export async function listEmailThreads(params?: {
  limit?: number;
  q?: string;
}) {
  try {
    return await vibriumGet<unknown>("/email/ses/threads", params);
  } catch {
    try {
      return await vibriumGet<unknown>("/email-ses/threads", params);
    } catch {
      return { threads: [] };
    }
  }
}
