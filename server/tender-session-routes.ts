import type { Express } from "express";
import { z } from "zod";
import { storage, type IStorage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth";

const companyProfileExperienceSchema = z.object({
  projectName: z.string().max(500),
  year: z.string().max(30),
  role: z.string().max(500),
  summary: z.string().max(5000),
  value: z.string().max(200).optional(),
}).strict();
const companyProfilePersonnelSchema = z.object({
  name: z.string().max(255),
  position: z.string().max(255),
  education: z.string().max(500),
  certifications: z.array(z.object({
    name: z.string().max(255),
    number: z.string().max(255).optional(),
    issuer: z.string().max(255),
    validUntil: z.string().max(100).optional(),
  }).strict()).max(100),
  experiences: z.array(z.object({
    project: z.string().max(500),
    role: z.string().max(255),
    tasks: z.string().max(5000),
    output: z.string().max(5000),
    year: z.string().max(30),
  }).strict()).max(100),
  competencies: z.array(z.string().max(500)).max(100),
}).strict();
const companyProfileFields = {
  name: z.string().trim().min(1).max(255),
  businessType: z.string().max(80).optional(),
  nib: z.string().max(100).optional(),
  nibStatus: z.string().max(100).optional(),
  npwp: z.string().max(100).optional(),
  npwpStatus: z.string().max(100).optional(),
  address: z.string().max(5000).optional(),
  picName: z.string().max(255).optional(),
  picContact: z.string().max(255).optional(),
  experiences: z.array(companyProfileExperienceSchema).max(100).optional(),
  personnel: z.array(companyProfilePersonnelSchema).max(100).optional(),
};
const createCompanyProfileSchema = z.object(companyProfileFields).strict();
const updateCompanyProfileSchema = z.object(companyProfileFields).partial().strict();

const tenderSessionFields = {
  packType: z.enum(["pelaksana_konstruksi", "konsultansi_mk"]),
  companyProfileId: z.number().int().positive().nullable(),
  status: z.enum(["draft", "generating", "completed"]),
  selectedOutputs: z.array(z.string().min(1).max(100)).max(50),
  tenderProfile: z.record(z.string()),
  requirements: z.record(z.string()),
  technicalApproach: z.record(z.string()),
  complianceAnswers: z.record(z.string()),
  scoreKelengkapan: z.number().int().min(0).max(100).nullable(),
  scoreTeknis: z.number().int().min(0).max(100).nullable(),
  generatedChecklist: z.array(z.object({
    code: z.string(), section: z.string(), item: z.string(),
    status: z.enum(["Ada", "Belum", "Perlu revisi"]), note: z.string().optional(),
  }).strict()).nullable(),
  generatedRiskReview: z.array(z.object({
    level: z.enum(["red", "yellow", "green"]), finding: z.string(),
    impact: z.string(), recommendation: z.string(),
  }).strict()).nullable(),
  generatedDrafts: z.record(z.string()).nullable(),
};
const createTenderSessionSchema = z.object({
  packType: tenderSessionFields.packType.optional(),
  companyProfileId: tenderSessionFields.companyProfileId.optional(),
  status: tenderSessionFields.status.optional(),
  selectedOutputs: tenderSessionFields.selectedOutputs.optional(),
  tenderProfile: tenderSessionFields.tenderProfile.optional(),
  requirements: tenderSessionFields.requirements.optional(),
  technicalApproach: tenderSessionFields.technicalApproach.optional(),
  complianceAnswers: tenderSessionFields.complianceAnswers.optional(),
}).strict();
const updateTenderSessionSchema = z.object(tenderSessionFields).partial().strict();

export async function authorizeTenderAgentForWizard(
  req: any,
  agentId: unknown,
  dependencies: {
    getAgent: (agentId: string) => Promise<any>;
    assertCanAccessAgentChat: (req: any, agent: any) => Promise<{ ok: boolean; status?: number; error?: string }>;
  },
): Promise<{ ok: true; agent?: any } | { ok: false; status: number; error: string }> {
  if (agentId === undefined || agentId === null || agentId === "") return { ok: true };
  if ((typeof agentId !== "string" && typeof agentId !== "number") ||
      (typeof agentId === "number" && (!Number.isSafeInteger(agentId) || agentId <= 0)) ||
      !String(agentId).trim() || String(agentId).length > 128) {
    return { ok: false, status: 400, error: "agentId tidak valid" };
  }
  const agent = await dependencies.getAgent(String(agentId));
  if (!agent) return { ok: false, status: 404, error: "Agen tidak ditemukan" };
  const access = await dependencies.assertCanAccessAgentChat(req, agent);
  if (!access || access.ok !== true) {
    return {
      ok: false,
      status: access?.status || 403,
      error: access?.error || "Akses agen ditolak",
    };
  }
  return { ok: true, agent };
}

export function registerCompanyProfileRoutes(
  app: Express,
  tenderStorage: IStorage = storage,
  authenticate: typeof isAuthenticated = isAuthenticated,
) {
  const requestUserId = (req: any): string | undefined => {
    const id = req.session?.emailUser?.id || req.user?.claims?.sub || req.user?.id;
    return id == null || id === "" ? undefined : String(id);
  };
  const validProfileId = (rawId: string): number | undefined => {
    if (!/^[1-9]\d*$/.test(rawId)) return undefined;
    const id = Number(rawId);
    return Number.isSafeInteger(id) ? id : undefined;
  };

  app.get("/api/company-profiles", authenticate, async (req, res) => {
    const userId = requestUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      res.json(await tenderStorage.getCompanyProfiles(userId));
    } catch {
      res.status(500).json({ error: "Gagal mengambil profil perusahaan" });
    }
  });

  app.get("/api/company-profiles/:id", authenticate, async (req, res) => {
    const userId = requestUserId(req);
    const id = validProfileId(req.params.id as string);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "ID profil tidak valid" });
    try {
      const profile = await tenderStorage.getCompanyProfile(id, userId);
      if (!profile) return res.status(404).json({ error: "Profil tidak ditemukan" });
      res.json(profile);
    } catch {
      res.status(500).json({ error: "Gagal mengambil profil perusahaan" });
    }
  });

  app.post("/api/company-profiles", authenticate, async (req, res) => {
    const userId = requestUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const parsed = createCompanyProfileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data profil perusahaan tidak valid" });
    try {
      const profile = await tenderStorage.createCompanyProfile({ ...parsed.data, userId });
      res.status(201).json(profile);
    } catch {
      res.status(500).json({ error: "Gagal membuat profil perusahaan" });
    }
  });

  app.patch("/api/company-profiles/:id", authenticate, async (req, res) => {
    const userId = requestUserId(req);
    const id = validProfileId(req.params.id as string);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "ID profil tidak valid" });
    const parsed = updateCompanyProfileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data profil perusahaan tidak valid" });
    try {
      const profile = await tenderStorage.updateCompanyProfile(id, userId, parsed.data);
      if (!profile) return res.status(404).json({ error: "Profil tidak ditemukan" });
      res.json(profile);
    } catch {
      res.status(500).json({ error: "Gagal mengubah profil perusahaan" });
    }
  });

  app.delete("/api/company-profiles/:id", authenticate, async (req, res) => {
    const userId = requestUserId(req);
    const id = validProfileId(req.params.id as string);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "ID profil tidak valid" });
    try {
      const ok = await tenderStorage.deleteCompanyProfile(id, userId);
      if (!ok) return res.status(404).json({ error: "Profil tidak ditemukan" });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Gagal menghapus profil perusahaan" });
    }
  });
}

export function registerTenderSessionRoutes(
  app: Express,
  tenderStorage: IStorage = storage,
  authenticate: typeof isAuthenticated = isAuthenticated,
) {
  const requestUserId = (req: any): string | undefined => {
    const id = req.session?.emailUser?.id || req.user?.claims?.sub || req.user?.id;
    return id == null || id === "" ? undefined : String(id);
  };
  const validSessionId = (rawId: string): number | undefined => {
    if (!/^[1-9]\d*$/.test(rawId)) return undefined;
    const id = Number(rawId);
    return Number.isSafeInteger(id) ? id : undefined;
  };
  const ownsCompanyProfile = async (userId: string, profileId: number | null | undefined) => {
    if (profileId == null) return true;
    if (!Number.isSafeInteger(profileId) || profileId <= 0) return false;
    const profiles = await tenderStorage.getCompanyProfiles(userId);
    return profiles.some((profile) => profile.id === profileId);
  };

  app.get("/api/tender-sessions", authenticate, async (req, res) => {
    const userId = requestUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      res.json(await tenderStorage.getTenderSessions(userId));
    } catch {
      res.status(500).json({ error: "Gagal mengambil sesi tender" });
    }
  });

  app.get("/api/tender-sessions/:id", authenticate, async (req, res) => {
    const userId = requestUserId(req);
    const id = validSessionId(req.params.id as string);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "ID sesi tidak valid" });
    try {
      const session = await tenderStorage.getTenderSession(id, userId);
      if (!session) return res.status(404).json({ error: "Sesi tidak ditemukan" });
      res.json(session);
    } catch {
      res.status(500).json({ error: "Gagal mengambil sesi tender" });
    }
  });

  app.post("/api/tender-sessions", authenticate, async (req, res) => {
    const userId = requestUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const parsed = createTenderSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data sesi tender tidak valid" });
    try {
      if (!await ownsCompanyProfile(userId, parsed.data.companyProfileId)) {
        return res.status(400).json({ error: "Profil perusahaan tidak valid atau bukan milik Anda" });
      }
      const session = await tenderStorage.createTenderSession({ ...parsed.data, userId });
      res.status(201).json(session);
    } catch {
      res.status(500).json({ error: "Gagal membuat sesi tender" });
    }
  });

  app.patch("/api/tender-sessions/:id", authenticate, async (req, res) => {
    const userId = requestUserId(req);
    const id = validSessionId(req.params.id as string);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "ID sesi tidak valid" });
    const parsed = updateTenderSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data sesi tender tidak valid" });
    try {
      if (Object.prototype.hasOwnProperty.call(parsed.data, "companyProfileId") &&
          !await ownsCompanyProfile(userId, parsed.data.companyProfileId)) {
        return res.status(400).json({ error: "Profil perusahaan tidak valid atau bukan milik Anda" });
      }
      const session = await tenderStorage.updateTenderSession(id, userId, parsed.data);
      if (!session) return res.status(404).json({ error: "Sesi tidak ditemukan" });
      res.json(session);
    } catch {
      res.status(500).json({ error: "Gagal mengubah sesi tender" });
    }
  });

  app.delete("/api/tender-sessions/:id", authenticate, async (req, res) => {
    const userId = requestUserId(req);
    const id = validSessionId(req.params.id as string);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!id) return res.status(400).json({ error: "ID sesi tidak valid" });
    try {
      const ok = await tenderStorage.deleteTenderSession(id, userId);
      if (!ok) return res.status(404).json({ error: "Sesi tidak ditemukan" });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Gagal menghapus sesi tender" });
    }
  });
}