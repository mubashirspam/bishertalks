"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";

/**
 * Client component purely so the copy handler can exist — the thank-you page
 * itself is a Server Component, and passing an onClick from one crashes the
 * render ("Event handlers cannot be passed to Client Component props").
 */
export default function CopyLinkButton() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/neuro-code`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked on insecure origins and in some in-app browsers.
      // Not worth an error state on a thank-you page — just do nothing.
    }
  };

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-sm transition-all"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5" /> Copied
        </>
      ) : (
        <>
          <Share2 className="w-3.5 h-3.5" /> Copy Link
        </>
      )}
    </button>
  );
}
