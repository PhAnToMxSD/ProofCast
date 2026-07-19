"use client";

// Match talk — a lightweight community wall under each match. Username and
// comments live in the browser's localStorage (no account, no backend), keyed
// per match. It's a fan-engagement layer: pick a name once, then chime in on any
// match. Names are self-set and unverified — fine for a casual comment wall.

import { useEffect, useRef, useState } from "react";

type Comment = { id: string; author: string; text: string; ts: number };

const NAME_KEY = "proofcast:username";
const commentsKey = (matchId: string) => `proofcast:comments:${matchId}`;
const MAX_LEN = 500;

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Comments({ matchId }: { matchId: string }) {
  const [username, setUsername] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Load persisted state after mount. Initial state matches the server render
  // (empty), so hydration is clean; values populate once localStorage is read.
  useEffect(() => {
    try {
      setUsername(localStorage.getItem(NAME_KEY) ?? "");
      const raw = localStorage.getItem(commentsKey(matchId));
      if (raw) setComments(JSON.parse(raw));
    } catch {
      /* ignore corrupt storage */
    }
  }, [matchId]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  const persist = (next: Comment[]) => {
    setComments(next);
    try {
      localStorage.setItem(commentsKey(matchId), JSON.stringify(next));
    } catch {
      /* storage full / disabled — keep in memory */
    }
  };

  const saveName = () => {
    const name = nameDraft.trim().slice(0, 32);
    if (!name) return;
    setUsername(name);
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
    setEditingName(false);
  };

  const post = () => {
    const text = draft.trim().slice(0, MAX_LEN);
    if (!text || !username) return;
    const c: Comment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      author: username,
      text,
      ts: Date.now(),
    };
    persist([c, ...comments]);
    setDraft("");
  };

  const remove = (id: string) => persist(comments.filter((c) => c.id !== id));

  const startEditing = () => {
    setNameDraft(username);
    setEditingName(true);
  };

  return (
    <section className="comments" aria-label="Match comments">
      <div className="cm-head">
        <h3>
          <span aria-hidden="true">💬</span> Match talk
          <span className="cm-count">{comments.length}</span>
        </h3>

        <div className="cm-user">
          {editingName ? (
            <div className="cm-name-edit">
              <input
                ref={nameInputRef}
                className="cm-name-input"
                type="text"
                maxLength={32}
                placeholder="Your name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
              />
              <button className="cm-name-save" onClick={saveName}>Save</button>
            </div>
          ) : username ? (
            <button className="cm-name-chip" onClick={startEditing} title="Change your name">
              <span className="cm-avatar" aria-hidden="true">{initials(username)}</span>
              {username}
              <span className="cm-edit" aria-hidden="true">✎</span>
            </button>
          ) : (
            <button className="cm-set-name" onClick={() => setEditingName(true)}>
              Set username
            </button>
          )}
        </div>
      </div>

      <div className="cm-compose">
        <textarea
          className="cm-textarea"
          rows={3}
          maxLength={MAX_LEN}
          placeholder={username ? "Share your take on this match…" : "Set a username to join the conversation."}
          value={draft}
          disabled={!username}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
          }}
        />
        <div className="cm-compose-foot">
          <span className="cm-hint">
            {username ? `${draft.length}/${MAX_LEN} · ⌘/Ctrl+Enter to post` : "Names are self-set and unverified."}
          </span>
          <button className="cm-post" onClick={post} disabled={!username || !draft.trim()}>
            Post comment
          </button>
        </div>
      </div>

      {comments.length === 0 ? (
        <p className="cm-empty">No comments yet — be the first to weigh in. 🎙️</p>
      ) : (
        <ul className="cm-list">
          {comments.map((c) => (
            <li key={c.id} className="cm-item">
              <span className="cm-avatar" aria-hidden="true">{initials(c.author)}</span>
              <div className="cm-body">
                <div className="cm-meta">
                  <span className="cm-author">{c.author}</span>
                  <span className="cm-time">{timeAgo(c.ts)}</span>
                  {c.author === username && (
                    <button className="cm-delete" onClick={() => remove(c.id)} title="Delete">
                      Delete
                    </button>
                  )}
                </div>
                <p className="cm-text">{c.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
