"use client";

import { useState } from "react";

interface Props {
  text: string;
}

export default function CopyButton({ text }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy chat message"
      className="text-xs px-2 py-1 rounded transition-colors bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 whitespace-nowrap flex-shrink-0"
    >
      {copied ? "✓ Copied" : "⧉ Copy"}
    </button>
  );
}
