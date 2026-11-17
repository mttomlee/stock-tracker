"use client";

import type { FormEvent } from "react";

type AddSymbolModalProps = {
  open: boolean;
  value: string;
  adding: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
};

export default function AddSymbolModal({
  open,
  value,
  adding,
  onChange,
  onSubmit,
  onClose,
}: AddSymbolModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="add-modal" onSubmit={onSubmit}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <h2>Add symbol</h2>
        <p>Enter a ticker symbol to add it to your watchlist.</p>
        <label htmlFor="symbol-input">Symbol</label>
        <input
          id="symbol-input"
          autoFocus
          maxLength={20}
          placeholder="e.g. MSFT"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <button className="submit-button" type="submit" disabled={adding || !value.trim()}>
          {adding ? "Adding…" : "Add symbol"}
        </button>
      </form>
    </div>
  );
}
