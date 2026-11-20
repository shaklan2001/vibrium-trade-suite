"use client";

import { useEffect, useState } from "react";
import { AGENT_DISPLAY_NAME_MAX_LENGTH } from "@/lib/trade/crew";

interface EditableNameProps {
  agentId: string;
  name: string;
  overridden: boolean;
  onRename: (id: string, value: string) => void;
}

/** Click the name to rename. An empty field restores the given name. */
export function EditableName({ agentId, name, overridden, onRename }: EditableNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  if (!editing) {
    return (
      <span className="identity-name-row">
        <button
          type="button"
          className="identity-name"
          onClick={() => setEditing(true)}
          title="Rename this agent"
        >
          {name}
        </button>
        {overridden ? (
          <button
            type="button"
            className="identity-reset"
            onClick={() => onRename(agentId, "")}
          >
            Reset
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <input
      className="identity-input"
      value={draft}
      maxLength={AGENT_DISPLAY_NAME_MAX_LENGTH}
      aria-label={`Name for ${name}`}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        onRename(agentId, draft);
        setEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onRename(agentId, draft);
          setEditing(false);
        } else if (event.key === "Escape") {
          setDraft(name);
          setEditing(false);
        }
      }}
    />
  );
}
