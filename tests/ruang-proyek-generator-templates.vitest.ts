import { describe, expect, it } from "vitest";
import { GENERATOR_TEMPLATES } from "../client/src/data/ruang-proyek-standards";

const project = {
  projectName: "Pembangunan Gedung Pelayanan",
  client: "Dinas Pekerjaan Umum",
  location: "Bandung",
  contractValue: "Rp 1.250.000.000",
  startDate: "2026-09-01",
  endDate: "2026-11-30",
};

describe("template generator dokumen Ruang Proyek", () => {
  const expectedTemplates = [
    ["lap_harian", "LAPORAN HARIAN"],
    ["lap_mingguan", "LAPORAN MINGGUAN"],
    ["spmk", "SURAT PERINTAH MULAI KERJA"],
    ["ba_periksa", "BERITA ACARA PEMERIKSAAN PEKERJAAN"],
  ] as const;

  it.each(expectedTemplates)("menyediakan template %s dengan format resmi", (key, heading) => {
    const template = GENERATOR_TEMPLATES.find((item) => item.key === key);

    expect(template).toBeDefined();
    expect(template!.fields.length).toBeGreaterThan(0);
    expect(template!.render(project, {})).toContain(heading);
  });

  it.each(expectedTemplates)("mengisi data proyek otomatis pada template %s", (key) => {
    const output = GENERATOR_TEMPLATES.find((item) => item.key === key)!.render(project, {});

    expect(output).toContain(project.projectName);
    expect(output).toContain(project.client);
    expect(output).toContain(project.location);
  });
});