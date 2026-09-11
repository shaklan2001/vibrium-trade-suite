"use client";

import ReactMarkdown from "react-markdown";

/** Soft-normalize common stream/LLM glitches that jam markdown blocks together. */
export function normalizeAssistantMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/([^\n])(#{1,6}\s)/g, "$1\n\n$2")
    .replace(/([^\n])(---+)(?=\n|\s|#|$)/g, "$1\n\n$2")
    .replace(/(---+)(?=[^\n])/g, "$1\n\n")
    .replace(/([.!:?])\s*(\d+\.\s)/g, "$1\n\n$2")
    .replace(/([.!:?])\s*([-*]\s+\S)/g, "$1\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function MarkdownMessage({ content }: { content: string }) {
  const md = normalizeAssistantMarkdown(content);
  if (!md) return null;

  return (
    <div className="copilot-md text-[13px] leading-relaxed text-zinc-800">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mb-2 mt-3 text-base font-semibold text-zinc-900 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-3 text-[15px] font-semibold text-zinc-900 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-2.5 text-sm font-semibold text-zinc-900 first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 text-zinc-700">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-zinc-700 marker:text-zinc-400">{children}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-zinc-900">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-zinc-700">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="font-medium text-teal-700 underline underline-offset-2 hover:text-teal-800"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          code: ({ children, className }) => {
            const isBlock = Boolean(className);
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-md bg-zinc-900/90 px-3 py-2 font-mono text-[12px] text-zinc-100">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-zinc-200/80 px-1 py-0.5 font-mono text-[12px] text-zinc-800">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded-md last:mb-0">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-3 border-zinc-200" />,
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-teal-600/40 pl-3 text-zinc-600 last:mb-0">
              {children}
            </blockquote>
          ),
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}
