import { CASHFLOW_TIERS } from "../shared/cashflow-tiers";
import { pool } from "./db";

export const CASHFLOW_AGENT_PRODUCTS = {
  "si-kas-claw": {
    productId: "GST-CFPBJ-SI-KAS",
    name: "CASHFLOW-PBJ — SI KAS",
  },
  "si-berkas-claw": {
    productId: "GST-CFPBJ-SI-BERKAS",
    name: "CASHFLOW-PBJ — SI BERKAS",
  },
  "si-pasal-claw": {
    productId: "GST-CFPBJ-SI-PASAL",
    name: "CASHFLOW-PBJ — SI PASAL",
  },
  "si-lapangan-claw": {
    productId: "GST-CFPBJ-SI-LAPANGAN",
    name: "CASHFLOW-PBJ — SI LAPANGAN",
  },
  "si-strategi-claw": {
    productId: "GST-CFPBJ-SI-STRATEGI",
    name: "CASHFLOW-PBJ — SI STRATEGI",
  },
  "si-pajak-claw": {
    productId: "GST-CFPBJ-SI-PAJAK",
    name: "CASHFLOW-PBJ — SI PAJAK",
  },
  "si-darurat-claw": {
    productId: "GST-CFPBJ-SI-DARURAT",
    name: "CASHFLOW-PBJ — SI DARURAT",
  },
  "cashflow-pbj-multiclaw": {
    productId: "GST-CFPBJ-PAK-ARGA",
    name: "CASHFLOW-PBJ — Pak Arga",
  },
} as const;

const TIER_AGENT_SLUGS = {
  mandor: ["si-kas-claw", "si-berkas-claw"],
  kontraktor: [
    "si-kas-claw",
    "si-berkas-claw",
    "si-pasal-claw",
    "si-lapangan-claw",
    "si-strategi-claw",
    "cashflow-pbj-multiclaw",
  ],
  direktur: [
    "si-kas-claw",
    "si-berkas-claw",
    "si-pasal-claw",
    "si-lapangan-claw",
    "si-strategi-claw",
    "si-pajak-claw",
    "si-darurat-claw",
    "cashflow-pbj-multiclaw",
  ],
} as const;

type CashflowTierKey = keyof typeof TIER_AGENT_SLUGS;
type CashflowAgentSlug = keyof typeof CASHFLOW_AGENT_PRODUCTS;

export type CashflowPackageDefinition = {
  key: string;
  packageId: string;
  tierKey: CashflowTierKey;
  tierName: string;
  durationMonths: 3 | 6 | 12;
  name: string;
  price: number;
  agentSlugs: CashflowAgentSlug[];
};

export function getCashflowPackageDefinitions(): CashflowPackageDefinition[] {
  return CASHFLOW_TIERS.flatMap((tier) => {
    const tierKey = tier.key as CashflowTierKey;
    const agentSlugs = [...TIER_AGENT_SLUGS[tierKey]] as CashflowAgentSlug[];
    return tier.durations.map((duration) => ({
      key: duration.key,
      packageId: duration.packageId,
      tierKey,
      tierName: tier.nama,
      durationMonths: duration.bulan,
      name: `CASHFLOW-PBJ ${tier.nama} — ${duration.bulan} Bulan`,
      price: duration.total,
      agentSlugs,
    }));
  });
}

/**
 * Reconcile the nine code-owned CASHFLOW packages into the generic Solution
 * Package Engine. Existing Scalev mappings are preserved. A material change
 * creates a new immutable snapshot rather than rewriting a live version.
 */
export async function seedCashflowPackages(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const solution = await client.query<{ id: number }>(
      `INSERT INTO solution_registry (name, slug, description, status)
       VALUES ('CASHFLOW-PBJ', 'cashflow-pbj', 'Sistem arus kas kontraktor proyek pemerintah', 'ACTIVE')
       ON CONFLICT (slug) DO UPDATE
         SET name=EXCLUDED.name, description=EXCLUDED.description, status='ACTIVE', updated_at=now()
       RETURNING id`,
    );
    const sector = await client.query<{ id: number }>(
      `INSERT INTO sector_registry (name, slug, description, status)
       VALUES ('Konstruksi PBJ', 'konstruksi-pbj', 'Kontraktor proyek pemerintah', 'ACTIVE')
       ON CONFLICT (slug) DO UPDATE
         SET name=EXCLUDED.name, description=EXCLUDED.description, status='ACTIVE', updated_at=now()
       RETURNING id`,
    );

    const tierIds = new Map<CashflowTierKey, number>();
    for (const [level, tier] of CASHFLOW_TIERS.entries()) {
      const tierKey = tier.key as CashflowTierKey;
      const row = await client.query<{ id: number }>(
        `INSERT INTO tier_registry (name, slug, description, level, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')
         ON CONFLICT (slug) DO UPDATE
           SET name=EXCLUDED.name, description=EXCLUDED.description,
               level=EXCLUDED.level, status='ACTIVE', updated_at=now()
         RETURNING id`,
        [tier.nama, `cashflow-${tierKey}`, tier.target, level + 1],
      );
      tierIds.set(tierKey, row.rows[0].id);
    }

    const productRows = new Map<
      CashflowAgentSlug,
      { id: number; productId: string; name: string }
    >();
    for (const [agentSlug, product] of Object.entries(CASHFLOW_AGENT_PRODUCTS) as Array<
      [CashflowAgentSlug, (typeof CASHFLOW_AGENT_PRODUCTS)[CashflowAgentSlug]]
    >) {
      const row = await client.query<{ id: number; product_id: string; name: string }>(
        `INSERT INTO product_registry (
           product_id, name, slug, product_type, category, short_description,
           product_url, price, currency, billing_type, status, engine_type,
           access_type, access_url, visibility, subscription_enabled, ai_enabled,
           usage_profile, updated_at
         ) VALUES (
           $1,$2,$3,'AI_SPECIALIST','CASHFLOW-PBJ',$4,$5,0,'IDR','FREE','ACTIVE',
           'GUSTAFTA_AGENT','LOGIN_GUSTAFTA',$5,'INCLUDED_ONLY',true,true,
           '["AI_CHAT","AGENT_EXECUTION"]'::jsonb,now()
         )
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, product_type='AI_SPECIALIST', category='CASHFLOW-PBJ',
           short_description=EXCLUDED.short_description, product_url=EXCLUDED.product_url,
           status='ACTIVE', engine_type='GUSTAFTA_AGENT', access_type='LOGIN_GUSTAFTA',
           access_url=EXCLUDED.access_url, visibility='INCLUDED_ONLY',
           subscription_enabled=true, ai_enabled=true,
           usage_profile='["AI_CHAT","AGENT_EXECUTION"]'::jsonb, updated_at=now()
         RETURNING id, product_id, name`,
        [
          product.productId,
          product.name,
          agentSlug,
          `Akses ${product.name} sesuai masa aktif paket CASHFLOW-PBJ.`,
          `/bot/${agentSlug}?claim=1`,
        ],
      );
      productRows.set(agentSlug, {
        id: row.rows[0].id,
        productId: row.rows[0].product_id,
        name: row.rows[0].name,
      });
    }

    for (const definition of getCashflowPackageDefinitions()) {
      const existing = await client.query<{
        id: number;
        version: number;
        price: number;
        duration_value: number;
        status: string;
      }>(
        `SELECT id, version, price, duration_value, status
           FROM package_registry
          WHERE package_id=$1
          LIMIT 1`,
        [definition.packageId],
      );
      const desiredProductIds = definition.agentSlugs.map(
        (slug) => productRows.get(slug)!.id,
      );
      const currentProductIds = existing.rows[0]
        ? (
            await client.query<{ product_id: number }>(
              `SELECT product_id FROM package_products WHERE package_id=$1 ORDER BY sort_order, product_id`,
              [existing.rows[0].id],
            )
          ).rows.map((row) => row.product_id)
        : [];
      const compositionChanged =
        currentProductIds.length !== desiredProductIds.length ||
        currentProductIds.some((id, index) => id !== desiredProductIds[index]);
      const materialChanged =
        !!existing.rows[0] &&
        (existing.rows[0].price !== definition.price ||
          existing.rows[0].duration_value !== definition.durationMonths ||
          compositionChanged);
      const version = existing.rows[0]
        ? existing.rows[0].version + (materialChanged ? 1 : 0)
        : 1;
      const packageRow = await client.query<{ id: number; version: number }>(
        `INSERT INTO package_registry (
           package_id, solution_id, sector_id, tier_id, name, slug, description,
           status, duration_value, duration_unit, price, currency, version,
           effective_from, gaia_enabled, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,'MONTH',$9,'IDR',$10,now(),false,now()
         )
         ON CONFLICT (package_id) DO UPDATE SET
           solution_id=EXCLUDED.solution_id, sector_id=EXCLUDED.sector_id,
           tier_id=EXCLUDED.tier_id, name=EXCLUDED.name, slug=EXCLUDED.slug,
           description=EXCLUDED.description, status='ACTIVE',
           duration_value=EXCLUDED.duration_value, duration_unit='MONTH',
           price=EXCLUDED.price, currency='IDR', version=EXCLUDED.version,
           effective_from=COALESCE(package_registry.effective_from, now()),
           updated_at=now()
         RETURNING id, version`,
        [
          definition.packageId,
          solution.rows[0].id,
          sector.rows[0].id,
          tierIds.get(definition.tierKey),
          definition.name,
          definition.packageId.toLowerCase(),
          `${definition.tierName}, masa akses ${definition.durationMonths} bulan.`,
          definition.durationMonths,
          definition.price,
          version,
        ],
      );
      const packageDbId = packageRow.rows[0].id;
      if (!existing.rows[0] || compositionChanged) {
        await client.query(`DELETE FROM package_products WHERE package_id=$1`, [
          packageDbId,
        ]);
        for (const [sortOrder, slug] of definition.agentSlugs.entries()) {
          await client.query(
            `INSERT INTO package_products (
               package_id, product_id, access_level, usage_limit, is_required, sort_order
             ) VALUES ($1,$2,'FULL',NULL,true,$3)`,
            [packageDbId, productRows.get(slug)!.id, sortOrder],
          );
        }
      }

      const composition = definition.agentSlugs.map((slug, sortOrder) => {
        const product = productRows.get(slug)!;
        return {
          productId: product.id,
          productRegistryId: product.productId,
          productName: product.name,
          accessLevel: "FULL",
          usageLimit: null,
          isRequired: true,
          sortOrder,
        };
      });
      await client.query(
        `INSERT INTO package_version_snapshots (
           package_db_id, package_id, version, name, price, currency,
           duration_value, duration_unit, composition
         ) VALUES ($1,$2,$3,$4,$5,'IDR',$6,'MONTH',$7::jsonb)
         ON CONFLICT (package_db_id, version) DO NOTHING`,
        [
          packageDbId,
          definition.packageId,
          version,
          definition.name,
          definition.price,
          definition.durationMonths,
          JSON.stringify(composition),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The generic Claw Factory intentionally keeps Store agents public. CASHFLOW is
 * sold as tiered access, so run this after seedClawCatalog to make its existing
 * token/subscription gate visible in the bot UI without changing other claws.
 */
export async function reconcileCashflowAgentRegistrationGate(): Promise<void> {
  await pool.query(
    `UPDATE agents
        SET require_registration=true
      WHERE slug = ANY($1::text[])`,
    [Object.keys(CASHFLOW_AGENT_PRODUCTS)],
  );
}