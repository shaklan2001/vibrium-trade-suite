"use client";

import { useCallback, useEffect, useState } from "react";
import {
  readIdentityOverrides,
  writeIdentityOverrides,
  CREW,
  sanitizeAgentName,
} from "@/lib/trade/crew";

/** Local display names. Unknown ids and invalid strings are dropped at the storage boundary. */
export function useCrewNames() {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    setNames(readIdentityOverrides());
  }, []);

  const rename = useCallback((id: string, raw: string) => {
    const agent = CREW.find((item) => item.id === id);
    if (!agent) return;
    const next = sanitizeAgentName(raw);
    setNames((prev) => {
      const copy = { ...prev };
      if (!next || next === agent.name) delete copy[id];
      else copy[id] = next;
      writeIdentityOverrides(copy);
      return copy;
    });
  }, []);

  return { names, rename };
}
