import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/components/shared-header", () => ({
  SharedHeader: () => <header>Gustafta</header>,
}));
vi.mock("@/lib/contact", () => ({
  useContactNumbers: () => ({ secondary: "628000000000" }),
}));

import SolusiKonsultanISOPage from "../client/src/pages/solusi-konsultan-iso";
import RuangProyekLanding from "../client/src/pages/ruang-proyek-landing";

function expectExternalCards(
  sectionHeading: string,
  prefix: string,
  expected: ReadonlyArray<{ testId: string; name: string; href: string; stage?: string }>,
) {
  const section = screen.getByRole("heading", { name: sectionHeading }).closest("section");
  expect(section).not.toBeNull();
  const links = Array.from(section!.querySelectorAll<HTMLAnchorElement>(`a[data-testid^="link-${prefix}-app-"]`));
  expect(links).toHaveLength(expected.length);

  expected.forEach((app, index) => {
    const link = links[index];
    expect(link).toHaveAttribute("data-testid", app.testId);
    expect(within(link).getByRole("heading", { name: app.name })).toBeInTheDocument();
    if (app.stage) expect(link).toHaveTextContent(app.stage);
    expect(link).toHaveAttribute("href", app.href);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
}

describe("kartu aplikasi pada halaman ekosistem", () => {
  it("menampilkan dua aplikasi Konsultan ISO dengan tautan eksternal aman", () => {
    render(<SolusiKonsultanISOPage />);
    expectExternalCards("Pilih Ruang Kerja Sesuai Kebutuhan", "iso", [
      { testId: "link-iso-app-iso-hub", name: "ISO Hub", href: "https://iso-hub.gustafta.my.id" },
      { testId: "link-iso-app-smap-pancek", name: "SMAP–PANCEK", href: "https://smap-pancek.gustafta.my.id" },
    ]);
  });

  it("menampilkan tiga aplikasi Ruang Proyek sesuai urutan siklus dengan tautan eksternal aman", () => {
    render(<RuangProyekLanding />);
    expectExternalCards("Aplikasi untuk Setiap Tahap Siklus Proyek", "project", [
      { testId: "link-project-app-rancang-bangun", name: "Rancang–Bangun", stage: "01 · RENCANAKAN", href: "https://rancang-bangun.gustafta.my.id" },
      { testId: "link-project-app-sistem-informasi-proyek", name: "Sistem Informasi Proyek", stage: "02 · KENDALIKAN", href: "https://sistem-proyek.gustafta.my.id" },
      { testId: "link-project-app-tukangconnect", name: "TukangConnect", stage: "03 · HUBUNGKAN", href: "https://tukang-connect.gustafta.my.id" },
    ]);
  });
});