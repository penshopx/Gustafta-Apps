export function analysisResponse() {
  return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    kelayakan: { layak: true, alasan: "Perlu tinjauan manusia", syarat_kurang: [] },
    win_probability: { skor: 55, dasar: "Asumsi fixture" },
    kekuatan: [], risiko: [], rekomendasi: ["Tinjau data"], asumsi: ["[ASUMSI: fixture]"],
  }) } }] };
}
export interface FixtureAnalysisProvider {
  calls: number;
  next?: (signal: AbortSignal) => Promise<any>;
}
