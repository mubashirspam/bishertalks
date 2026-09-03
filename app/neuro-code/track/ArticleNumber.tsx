"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * The parcel's number, with a button that copies it.
 *
 * A button rather than plain text because of where this number has to go next:
 * India Post publish no link we can send someone to that carries it, so
 * tracking a parcel means opening their site and typing thirteen characters
 * into a box. Copying is the difference between that working first time and a
 * customer mistyping one digit and being told their parcel does not exist.
 *
 * The only client component on the tracking page, and deliberately the
 * smallest one that could work — the page around it stays a server component.
 */
export default function ArticleNumber({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard access can be refused — an insecure origin, or a
          // browser that asks. The number is on screen either way, so there is
          // nothing to recover from and nothing worth alarming anyone about.
        }
      }}
      title="Copy this number"
      className="group inline-flex items-center gap-1.5 font-mono text-neutral-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
    >
      {value}
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-neutral-400 group-hover:text-primary-500" />
      )}
    </button>
  );
}
