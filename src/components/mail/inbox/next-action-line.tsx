import { ListChecks } from "lucide-react";
import Link from "next/link";
import type { InboxItem } from "@/lib/mail/inboxTypes";

/** The agent's single next step for the deal, with the people it involves and the emails it rests on. */
export function NextActionLine({ next, dealCode, hrefFor }: { next: NonNullable<InboxItem["nextAction"]>; dealCode?: string | null; hrefFor?: (ref: string) => string | null }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md bg-white px-3 py-2 text-sm text-zinc-800 ring-1 ring-teal-200">
      <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
      <div>
        <strong>Next{dealCode ? ` on ${dealCode}` : ""}:</strong> {next.action}
        <div className="mt-0.5 text-xs text-zinc-500">
          {[next.owner && `owner ${next.owner}`, next.to && `for ${next.to}`, next.due && `by ${next.due}`].filter(Boolean).join(" · ")}
          {next.basedOn.map((ref) => {
            const href = hrefFor?.(ref);
            return href ? (
              <Link key={ref} href={href} className="ml-2 text-teal-700 hover:underline">
                email {ref.slice(0, 4)}
              </Link>
            ) : null;
          })}
        </div>
      </div>
    </div>
  );
}
