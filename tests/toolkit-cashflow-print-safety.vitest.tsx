// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ToolkitCashflowPage from "../client/src/pages/toolkit-cashflow";
import { SURAT_TEMPLATES } from "../client/src/data/cashflow-toolkit";

const TOOL_TABS = [
  ["triage", "Cash Triage Matrix"],
  ["tracker", "Uang termin Anda"],
  ["buffer", "Buffer adalah oksigen"],
  ["surat", "12 template surat resmi"],
  ["zerodefect", "Satu berkas kurang"],
  ["friday", "Ritual Jumat 30 menit"],
  ["redflags", "Baca kontrak/SPK Anda"],
] as const;

describe("Toolkit CASHFLOW-PBJ browser safety", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it.each(SURAT_TEMPLATES)(
    "prints the complete $nama letter with HTML-like input encoded as literal text",
    (template) => {
    const write = vi.fn();
    const close = vi.fn();
    const print = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({
      document: { write, close },
      print,
    } as unknown as Window);

    render(<ToolkitCashflowPage />);
    fireEvent.click(screen.getByTestId("tab-surat"));
    fireEvent.change(screen.getByTestId("select-surat-template"), {
      target: { value: template.id },
    });

    const fields = Object.fromEntries(
      template.fields.map((field, index) => [
        field.key,
        `${field.key}-${index} <script>window.__cashflowXss = true</script> & <img src=x onerror=alert(1)>`,
      ]),
    );
    for (const [key, value] of Object.entries(fields)) {
      fireEvent.change(screen.getByTestId(`input-surat-${key}`), {
        target: { value },
      });
    }

    fireEvent.click(screen.getByTestId("button-surat-generate"));
    const completeDraft = template.render(fields);
    expect(screen.getByTestId("text-surat-hasil").textContent).toBe(completeDraft);

    fireEvent.click(screen.getByTestId("button-surat-cetak"));

    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(write).toHaveBeenCalledOnce();
    const printedHtml = write.mock.calls[0][0] as string;
    const encodedCompleteDraft = completeDraft
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;");
    expect(printedHtml).toContain(`<body>${encodedCompleteDraft}</body>`);
    expect(printedHtml).not.toContain("<script>");
    expect(printedHtml).not.toContain("<img");
    expect(close).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
    },
  );

  it("recovers from null and wrong-type cfpbj localStorage values", () => {
    const corruptValues: Record<string, unknown> = {
      "cfpbj-triage": null,
      "cfpbj-tracker": [],
      "cfpbj-buf-saldo": "bukan angka",
      "cfpbj-buf-burn": {},
      "cfpbj-buf-kontrak": [],
      "cfpbj-buf-sumber": null,
      "cfpbj-zerodefect": [],
      "cfpbj-friday": "bukan objek",
      "cfpbj-redflags": 99,
    };
    for (const [key, value] of Object.entries(corruptValues)) {
      localStorage.setItem(key, JSON.stringify(value));
    }

    render(<ToolkitCashflowPage />);

    for (const [tab, expectedCopy] of TOOL_TABS) {
      fireEvent.click(screen.getByTestId(`tab-${tab}`));
      expect(screen.getByText(new RegExp(expectedCopy, "i"))).toBeInTheDocument();
    }

    expect(screen.getByTestId("tab-triage")).toBeInTheDocument();
  });

  it.each(TOOL_TABS)("renders the %s tab without crashing", (tab, expectedCopy) => {
    render(<ToolkitCashflowPage />);
    fireEvent.click(screen.getByTestId(`tab-${tab}`));
    expect(screen.getByText(new RegExp(expectedCopy, "i"))).toBeInTheDocument();
  });
});