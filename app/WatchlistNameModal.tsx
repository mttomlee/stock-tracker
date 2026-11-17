"use client";

import { FormEvent, KeyboardEvent, useRef, useState } from "react";

type WatchlistNameModalProps = {
  mode: "create" | "rename";
  initialName: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
};

export default function WatchlistNameModal({
  mode,
  initialName,
  onSubmit,
  onClose,
}: WatchlistNameModalProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const title = mode === "create" ? "New watchlist" : "Rename watchlist";
  const submitLabel = mode === "create" ? "Create watchlist" : "Save name";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a watchlist name.");
      return;
    }
    if (trimmed.length > 40) {
      setError("Watchlist names must be 40 characters or fewer.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    if (submitting) return;
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = formRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled)',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form
        ref={formRef}
        className="add-modal watchlist-name-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="watchlist-name-title"
        onSubmit={submit}
        onKeyDown={handleKeyDown}
      >
        <button className="modal-close" type="button" onClick={close} aria-label="Close">×</button>
        <h2 id="watchlist-name-title">{title}</h2>
        <p>
          {mode === "create"
            ? "Name a list to group your symbols."
            : "Choose a new name for this watchlist."}
        </p>
        <label htmlFor="watchlist-name-input">Name</label>
        <input
          id="watchlist-name-input"
          autoFocus
          maxLength={40}
          value={name}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "watchlist-name-error" : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {error && (
          <p className="watchlist-name-error" id="watchlist-name-error" role="alert">
            {error}
          </p>
        )}
        <div className="watchlist-name-actions">
          <button className="watchlist-name-cancel" type="button" onClick={close}>
            Cancel
          </button>
          <button className="submit-button" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
