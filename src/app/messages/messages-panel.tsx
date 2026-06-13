"use client";

import { useState } from "react";
import type { RecurringMessage } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

interface Props {
  initialMessages: RecurringMessage[];
}

const BLANK: Omit<RecurringMessage, "id" | "created_at" | "created_by" | "last_sent_at"> = {
  label: "",
  message: "",
  is_announcement: false,
  interval_minutes: 30,
  enabled: true,
};

export default function MessagesPanel({ initialMessages }: Props) {
  const [messages, setMessages] = useState<RecurringMessage[]>(initialMessages);
  const [editing, setEditing] = useState<string | null>(null); // id or "new"
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openNew() {
    setForm({ ...BLANK });
    setEditing("new");
    setError(null);
  }

  function openEdit(msg: RecurringMessage) {
    setForm({
      label: msg.label,
      message: msg.message,
      is_announcement: msg.is_announcement,
      interval_minutes: msg.interval_minutes,
      enabled: msg.enabled,
    });
    setEditing(msg.id);
    setError(null);
  }

  function cancelEdit() {
    setEditing(null);
    setError(null);
  }

  async function save() {
    if (!form.label.trim() || !form.message.trim()) {
      setError("Label and message are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        editing === "new" ? "/api/messages" : `/api/messages/${editing}`,
        {
          method: editing === "new" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }
      );
      if (!res.ok) {
        let errMsg = `Save failed (${res.status})`;
        try {
          const body = await res.json();
          errMsg = body.error ?? errMsg;
        } catch {
          errMsg = await res.text().then((t) => t.slice(0, 200)) || errMsg;
        }
        throw new Error(errMsg);
      }
      const saved: RecurringMessage = await res.json();
      if (editing === "new") {
        setMessages((prev) => [...prev, saved]);
      } else {
        setMessages((prev) => prev.map((m) => m.id === saved.id ? saved : m));
      }
      setEditing(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(msg: RecurringMessage) {
    const res = await fetch(`/api/messages/${msg.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !msg.enabled }),
    });
    if (res.ok) {
      const updated: RecurringMessage = await res.json();
      setMessages((prev) => prev.map((m) => m.id === updated.id ? updated : m));
    }
  }

  async function deleteMessage(id: string) {
    if (!confirm("Delete this message?")) return;
    const res = await fetch(`/api/messages/${id}`, { method: "DELETE" });
    if (res.ok) setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  async function sendNow(id: string) {
    await fetch(`/api/messages/${id}/send`, { method: "POST" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Recurring Messages</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            The bot sends these to Twitch chat on a timer while it&apos;s running.
          </p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-sm font-semibold transition-colors"
        >
          + New Message
        </button>
      </div>

      {/* Edit / New form */}
      {editing && (
        <div className="rounded-xl border border-purple-800/50 bg-zinc-900 p-5 space-y-4">
          <h2 className="font-semibold text-white text-sm">
            {editing === "new" ? "New Recurring Message" : "Edit Message"}
          </h2>

          {/* Label */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Label (internal name)</label>
            <input
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. FTK Queue Reminder"
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          {/* Message text */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Message</label>
            <textarea
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              placeholder="Text that will be sent to Twitch chat..."
              rows={3}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>

          {/* Type + Interval row */}
          <div className="flex gap-4 items-end">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Type</label>
              <div className="flex rounded-lg overflow-hidden border border-zinc-700">
                <button
                  onClick={() => setForm((f) => ({ ...f, is_announcement: false }))}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors",
                    !form.is_announcement ? "bg-zinc-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-750"
                  )}
                >
                  Chat
                </button>
                <button
                  onClick={() => setForm((f) => ({ ...f, is_announcement: true }))}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors",
                    form.is_announcement ? "bg-purple-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-750"
                  )}
                >
                  Announcement
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Every</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={form.interval_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, interval_minutes: Math.max(1, parseInt(e.target.value) || 1) }))}
                  className="w-20 rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 tabular-nums"
                />
                <span className="text-xs text-zinc-400">minutes</span>
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Start enabled</label>
              <button
                onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
                className={cn(
                  "w-12 h-7 rounded-full transition-colors relative",
                  form.enabled ? "bg-green-600" : "bg-zinc-700"
                )}
              >
                <span className={cn(
                  "absolute top-1 w-5 h-5 rounded-full bg-white transition-all",
                  form.enabled ? "left-6" : "left-1"
                )} />
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              onClick={cancelEdit}
              className="px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Message list */}
      {messages.length === 0 && !editing ? (
        <p className="text-sm text-zinc-600 italic py-8 text-center">
          No recurring messages yet. Click &quot;+ New Message&quot; to add one.
        </p>
      ) : (
        <div className="space-y-2">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "rounded-xl border px-4 py-3 flex items-start gap-4 transition-colors",
                msg.enabled
                  ? "border-zinc-800 bg-zinc-900"
                  : "border-zinc-800/50 bg-zinc-900/50"
              )}
            >
              {/* Toggle */}
              <button
                onClick={() => toggleEnabled(msg)}
                className={cn(
                  "mt-0.5 flex-shrink-0 w-10 h-6 rounded-full transition-colors relative",
                  msg.enabled ? "bg-green-600" : "bg-zinc-700"
                )}
                title={msg.enabled ? "Click to disable" : "Click to enable"}
              >
                <span className={cn(
                  "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                  msg.enabled ? "left-5" : "left-1"
                )} />
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={cn(
                    "font-medium text-sm",
                    msg.enabled ? "text-white" : "text-zinc-500"
                  )}>
                    {msg.label}
                  </span>
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded font-medium",
                    msg.is_announcement
                      ? "bg-purple-900/60 text-purple-300"
                      : "bg-zinc-800 text-zinc-400"
                  )}>
                    {msg.is_announcement ? "Announcement" : "Chat"}
                  </span>
                  <span className="text-xs text-zinc-600">
                    every {msg.interval_minutes}m
                  </span>
                  {msg.last_sent_at && (
                    <span className="text-xs text-zinc-700 ml-auto">
                      last sent {new Date(msg.last_sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
                <p className={cn(
                  "text-xs truncate",
                  msg.enabled ? "text-zinc-400" : "text-zinc-600"
                )}>
                  {msg.message}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => sendNow(msg.id)}
                  className="text-xs text-green-600 hover:text-green-400 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                  title="Queue for immediate send (fires within 60s)"
                >
                  Send Now
                </button>
                <button
                  onClick={() => openEdit(msg)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteMessage(msg.id)}
                  className="text-xs text-zinc-600 hover:text-red-400 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
