import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DailyChatModelSelector } from "../client/src/components/daily-chat-model-selector";
import { DAILY_CHAT_MODELS } from "../shared/daily-chat-models";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function open() {
  fireEvent.pointerDown(screen.getByRole("combobox"), { button: 0, ctrlKey: false, pointerType: "mouse" });
}
it("mount and rerender never replace an existing model or save automatically", () => {
  const change = vi.fn();
  const view = render(<DailyChatModelSelector value="qwen-plus" legacyValue="qwen-plus" onValueChange={change} />);
  expect(screen.getByTestId("daily-chat-model-status")).toHaveTextContent("Konfigurasi lama dipertahankan");
  view.rerender(<DailyChatModelSelector value="gpt-4o" legacyValue="gpt-4o" onValueChange={change} />);
  expect(change).not.toHaveBeenCalled();
});
it("the four new daily choices exclude Claude, while an existing Claude setting can be retained", () => {
  const change = vi.fn();
  render(<DailyChatModelSelector value="claude-3-sonnet" legacyValue="claude-3-sonnet" onValueChange={change} />);
  open();
  for (const model of DAILY_CHAT_MODELS) expect(screen.getByRole("option", { name: model.label })).toBeInTheDocument();
  expect(screen.getByTestId("daily-chat-model-legacy")).toHaveTextContent("claude-3-sonnet");
  expect(screen.getAllByRole("option")).toHaveLength(5);
  expect(change).not.toHaveBeenCalled();
});
it("NVIDIA is emitted only after an explicit user selection and does not require browser key entry", () => {
  const change = vi.fn();
  render(<DailyChatModelSelector value="gpt-4o-mini" legacyValue="gpt-4o-mini" onValueChange={change} />);
  open();
  fireEvent.click(screen.getByRole("option", { name: "NVIDIA · Nemotron Super 49B" }));
  expect(change).toHaveBeenCalledExactlyOnceWith(DAILY_CHAT_MODELS[2].id);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByText(/Kunci platform dikelola di server/)).toBeInTheDocument();
});
it("unknown and empty values are represented honestly rather than silently selecting the first provider", () => {
  const change = vi.fn();
  const view = render(<DailyChatModelSelector value="chat:retired:model" onValueChange={change} />);
  expect(screen.getByTestId("daily-chat-model-status")).toHaveTextContent("Tidak ada penyedia lain yang dipilih otomatis");
  view.rerender(<DailyChatModelSelector value="" onValueChange={change} />);
  expect(screen.getByTestId("daily-chat-model-status")).toHaveTextContent("Tidak ada penyedia lain yang dipilih otomatis");
  expect(change).not.toHaveBeenCalled();
});
it("new choices explain the no-fallback rule, separate Claude role and quota caveat without promising free unlimited use", () => {
  render(<DailyChatModelSelector value={DAILY_CHAT_MODELS[2].id} onValueChange={vi.fn()} />);
  expect(screen.getByText(/tidak beralih diam-diam/)).toBeInTheDocument();
  expect(screen.getByText(/Claude/)).toBeInTheDocument();
  expect(screen.getByTestId("daily-chat-model-status")).toHaveTextContent("Kredit tetap mengikuti kuota penyedia");
});
