"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DEFAULT_WORKSPACE_PROCESS,
  WORKSPACE_PROCESS_STORAGE_KEY,
  getWorkspaceProcess,
  inferProcessFromPath,
  isValidWorkspaceProcess,
  pathAllowedInProcess,
  type WorkspaceProcess,
  type WorkspaceProcessId,
} from "@/lib/trade/workspaceProcess";

type WorkspaceProcessContextValue = {
  processId: WorkspaceProcessId;
  process: WorkspaceProcess;
  setProcessId: (id: WorkspaceProcessId, opts?: { navigate?: boolean }) => void;
  hydrated: boolean;
};

const WorkspaceProcessContext =
  createContext<WorkspaceProcessContextValue | null>(null);

function readStoredProcess(): WorkspaceProcessId {
  if (typeof window === "undefined") return DEFAULT_WORKSPACE_PROCESS;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PROCESS_STORAGE_KEY);
    if (isValidWorkspaceProcess(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_WORKSPACE_PROCESS;
}

export function WorkspaceProcessProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [processId, setProcessIdState] = useState<WorkspaceProcessId>(
    DEFAULT_WORKSPACE_PROCESS,
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setProcessIdState(readStoredProcess());
    setHydrated(true);
  }, []);

  // Visiting an exclusive process route syncs the toggle.
  useEffect(() => {
    if (!hydrated) return;
    const inferred = inferProcessFromPath(pathname);
    if (inferred && inferred !== processId) {
      setProcessIdState(inferred);
      try {
        window.localStorage.setItem(WORKSPACE_PROCESS_STORAGE_KEY, inferred);
      } catch {
        /* ignore */
      }
    }
  }, [hydrated, pathname, processId]);

  const setProcessId = useCallback(
    (id: WorkspaceProcessId, opts?: { navigate?: boolean }) => {
      setProcessIdState(id);
      try {
        window.localStorage.setItem(WORKSPACE_PROCESS_STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
      if (opts?.navigate === false) return;
      if (!pathAllowedInProcess(pathname, id)) {
        router.push(getWorkspaceProcess(id).homeHref);
      }
    },
    [pathname, router],
  );

  const value = useMemo(
    () => ({
      processId,
      process: getWorkspaceProcess(processId),
      setProcessId,
      hydrated,
    }),
    [processId, setProcessId, hydrated],
  );

  return (
    <WorkspaceProcessContext.Provider value={value}>
      {children}
    </WorkspaceProcessContext.Provider>
  );
}

export function useWorkspaceProcess() {
  const ctx = useContext(WorkspaceProcessContext);
  if (!ctx) {
    throw new Error(
      "useWorkspaceProcess must be used within WorkspaceProcessProvider",
    );
  }
  return ctx;
}
