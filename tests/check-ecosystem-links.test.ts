import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate as flushTasks } from "node:timers/promises";
import test from "node:test";
import { checkEcosystemLinkHealth, checkEcosystemLinks, checkLink } from "../scripts/check-ecosystem-links";
import { ISO_ECOSYSTEM_APPS, PROJECT_ECOSYSTEM_APPS } from "../client/src/data/ecosystem-apps";

const app = { name: "ISO Hub", href: "https://iso-hub.gustafta.my.id" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test("fetch aplikasi yang mengabaikan abort berakhir tepat 10 detik lalu mencapai titik kontrol", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const request = deferred<Response>();
  const signals: AbortSignal[] = [];
  let probes = 0;
  let settled = false;
  const pending = checkEcosystemLinkHealth([app], async (url, init) => {
    if (url === app.href) {
      signals.push(init!.signal!);
      return request.promise;
    }
    probes++;
    return new Response(null, { status: 204 });
  }).then((result) => { settled = true; return result; });
  await flushTasks();
  t.mock.timers.tick(9_999);
  await flushTasks();
  assert.equal(settled, false);
  assert.equal(probes, 0);
  assert.equal(signals[0].aborted, false);
  t.mock.timers.tick(1);
  await flushTasks();
  assert.equal(settled, true);
  assert.equal(signals[0].aborted, true);
  assert.equal(probes, 2);
  const result = await pending;
  assert.deepEqual(result, {
    failures: ["ISO Hub: timeout setelah 10 detik"],
    networkUnavailable: false,
  });
  request.reject(new Error("late fetch rejection"));
  await flushTasks(); // node:test fails on any unhandled rejection.
  assert.deepEqual(result.failures, ["ISO Hub: timeout setelah 10 detik"]);
});

for (const status of [405, 501]) {
  test(`GET cadangan HTTP ${status} hanya memakai sisa tenggat HEAD`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const head = deferred<Response>();
    const get = deferred<Response>();
    const methods: string[] = [];
    const signals: AbortSignal[] = [];
    let settled = false;
    const pending = checkLink(app, async (_url, init) => {
      methods.push(init!.method!);
      signals.push(init!.signal!);
      return init!.method === "HEAD" ? head.promise : get.promise;
    }).then((result) => { settled = true; return result; });
    t.mock.timers.tick(6_000);
    head.resolve(new Response(null, { status }));
    await flushTasks();
    assert.deepEqual(methods, ["HEAD", "GET"]);
    assert.equal(signals[0], signals[1]);
    t.mock.timers.tick(3_999);
    await flushTasks();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    await flushTasks();
    assert.equal(settled, true);
    assert.ok(signals.every((signal) => signal.aborted));
    assert.equal(await pending, "ISO Hub: timeout setelah 10 detik");
    let cancellations = 0;
    get.resolve({
      status: 200,
      body: { cancel: async (): Promise<void> => { cancellations++; throw new Error("late body rejection"); } },
    } as Response);
    await flushTasks();
    assert.equal(cancellations, 1);
    assert.equal(await pending, "ISO Hub: timeout setelah 10 detik");
  });
}

for (const status of [200, 405, 501]) {
  for (const lateOutcome of ["resolve", "reject"] as const) {
    test(`body HTTP ${status} macet lalu ${lateOutcome}: tenggat tetap 10 detik tanpa GET terlambat`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const response = deferred<Response>();
      const cancellation = deferred<void>();
      const methods: string[] = [];
      let cancellations = 0;
      let settled = false;
      const pending = checkLink(app, async (_url, init) => {
        methods.push(init!.method!);
        return response.promise;
      }).then((result) => { settled = true; return result; });
      t.mock.timers.tick(7_000);
      response.resolve({
        status,
        body: { cancel: () => { cancellations++; return cancellation.promise; } },
      } as Response);
      await flushTasks();
      assert.equal(cancellations, 1);
      t.mock.timers.tick(2_999);
      await flushTasks();
      assert.equal(settled, false);
      t.mock.timers.tick(1);
      await flushTasks();
      assert.equal(settled, true);
      assert.equal(await pending, "ISO Hub: timeout setelah 10 detik");
      if (lateOutcome === "resolve") cancellation.resolve();
      else cancellation.reject(new Error("late body rejection"));
      await flushTasks();
      assert.deepEqual(methods, ["HEAD"]);
      assert.equal(await pending, "ISO Hub: timeout setelah 10 detik");
    });
  }
}

test("HEAD terlambat dibatalkan tanpa memulai GET atau mengubah timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const head = deferred<Response>();
  const methods: string[] = [];
  const pending = checkLink(app, async (_url, init) => {
    methods.push(init!.method!);
    return head.promise;
  });
  t.mock.timers.tick(10_000);
  assert.equal(await pending, "ISO Hub: timeout setelah 10 detik");
  let cancellations = 0;
  head.resolve({
    status: 405,
    body: { cancel: async () => { cancellations++; } },
  } as Response);
  await flushTasks();
  assert.equal(cancellations, 1);
  assert.deepEqual(methods, ["HEAD"]);
  assert.equal(await pending, "ISO Hub: timeout setelah 10 detik");
});

test("pembatalan body GET berbagi 10 detik dengan HEAD dan pembatalan body HEAD", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const head = deferred<Response>();
  const headCancellation = deferred<void>();
  const get = deferred<Response>();
  const getCancellation = deferred<void>();
  const methods: string[] = [];
  let settled = false;
  let getCancellations = 0;
  const pending = checkLink(app, async (_url, init) => {
    methods.push(init!.method!);
    return init!.method === "HEAD" ? head.promise : get.promise;
  }).then((result) => { settled = true; return result; });
  t.mock.timers.tick(2_000);
  head.resolve({ status: 405, body: { cancel: () => headCancellation.promise } } as Response);
  await flushTasks();
  t.mock.timers.tick(2_000);
  assert.deepEqual(methods, ["HEAD"]);
  headCancellation.resolve();
  await flushTasks();
  assert.deepEqual(methods, ["HEAD", "GET"]);
  t.mock.timers.tick(2_000);
  get.resolve({
    status: 200,
    body: { cancel: () => { getCancellations++; return getCancellation.promise; } },
  } as Response);
  await flushTasks();
  assert.equal(getCancellations, 1);
  t.mock.timers.tick(3_999);
  await flushTasks();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await flushTasks();
  assert.equal(settled, true);
  assert.equal(await pending, "ISO Hub: timeout setelah 10 detik");
  getCancellation.reject(new Error("late GET body rejection"));
  await flushTasks();
  assert.equal(await pending, "ISO Hub: timeout setelah 10 detik");
});

test("HEAD sukses tidak mengunduh isi halaman", async () => {
  const methods: string[] = [];
  const failure = await checkLink(app, async (_url, init) => {
    methods.push(init?.method ?? "");
    return new Response(null, { status: 204 });
  });
  assert.equal(failure, null);
  assert.deepEqual(methods, ["HEAD"]);
});

test("HEAD tidak didukung memakai GET tanpa mengikuti redirect", async () => {
  const methods: string[] = [];
  const failure = await checkLink(app, async (_url, init) => {
    assert.equal(init?.redirect, "manual");
    methods.push(init?.method ?? "");
    return new Response(null, { status: init?.method === "HEAD" ? 405 : 200 });
  });
  assert.equal(failure, null);
  assert.deepEqual(methods, ["HEAD", "GET"]);
});

test("redirect dan status gagal menyebut nama aplikasi tanpa URL", async () => {
  const links = [app, { name: "TukangConnect", href: "https://tukang-connect.gustafta.my.id" }];
  const failures = await checkEcosystemLinks(links, async (url) => {
    if (url === app.href) {
      return new Response(null, {
        status: 302,
        headers: { location: "/login?token=rahasia" },
      });
    }
    return new Response(null, { status: 503 });
  });
  assert.match(failures[0], /ISO Hub: redirect HTTP 302/);
  assert.doesNotMatch(failures[0], /rahasia/);
  assert.doesNotMatch(failures[0], /https:/);
  assert.match(failures[1], /TukangConnect.*HTTP 503/);
});

test("kegagalan jaringan dilaporkan per aplikasi tanpa menyembunyikan kegagalan lain", async () => {
  const failures = await checkEcosystemLinks([app, { name: "SMAP–PANCEK", href: "https://smap-pancek.gustafta.my.id" }], async () => {
    return new Response(null, { status: 204 });
  });
  assert.deepEqual(failures, []);
  const appFailures = await checkEcosystemLinks([app, { name: "SMAP–PANCEK", href: "https://smap-pancek.gustafta.my.id" }], async (url) => {
    if (url === app.href || url === "https://smap-pancek.gustafta.my.id") {
      throw new Error("DNS gagal untuk https://contoh.test/path?token=rahasia");
    }
    return new Response(null, { status: 403 }); // HTTP response from control is sufficient.
  });
  assert.equal(appFailures.length, 2);
  assert.match(appFailures[0], /ISO Hub: gagal terhubung/);
  assert.match(appFailures[1], /SMAP–PANCEK: gagal terhubung/);
  assert.doesNotMatch(appFailures.join("\n"), /rahasia|https:/);
});

test("dua titik kontrol gagal tetapi aplikasi menjawab HTTP: kegagalan koneksi tetap dilaporkan", async () => {
  const links = [app, { name: "SMAP–PANCEK", href: "https://smap-pancek.gustafta.my.id" }];
  let probes = 0;
  const result = await checkEcosystemLinkHealth(links, async (url) => {
    if (url === links[1].href) return new Response(null, { status: 503 });
    if (url !== app.href) probes++;
    throw new Error("https://private.test?token=rahasia");
  });
  assert.equal(probes, 0);
  assert.equal(result.networkUnavailable, false);
  assert.deepEqual(result.failures, ["ISO Hub: gagal terhubung", "SMAP–PANCEK: HTTP 503"]);
  assert.doesNotMatch(JSON.stringify(result), /private|rahasia|https:/);
});

test("HEAD ditutup penyedia, GET menerima HTTP: jangan menyembunyikan kegagalan aplikasi", async () => {
  const methods: string[] = [];
  const result = await checkEcosystemLinkHealth([app], async (url, init) => {
    if (url === app.href) throw new Error("token=rahasia");
    methods.push(init?.method ?? "");
    assert.equal(init?.redirect, "manual");
    if (init?.method === "HEAD") throw new Error("policy block https://private.test");
    return new Response(null, { status: 403 });
  });
  assert.deepEqual(methods.sort(), ["GET", "GET", "HEAD", "HEAD"]);
  assert.equal(result.networkUnavailable, false);
  assert.deepEqual(result.failures, ["ISO Hub: gagal terhubung"]);
  assert.doesNotMatch(JSON.stringify(result), /private|rahasia|https:/);
});

test("dua penyedia awal memblokir HEAD dan GET: penyedia ketiga membuktikan konektivitas tanpa membocorkan URL", async () => {
  const probes = new Map<string, string[]>();
  const output: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args) => { output.push(args.join(" ")); };
  console.log = (...args) => { output.push(args.join(" ")); };
  try {
    const result = await checkEcosystemLinkHealth([app], async (url, init) => {
      if (url === app.href) throw new Error("app tidak terhubung");
      const address = String(url);
      probes.set(address, [...(probes.get(address) ?? []), init?.method ?? ""]);
      if (address.includes("wikipedia.org") && init?.method === "GET") {
        return new Response(null, { status: 403 });
      }
      throw new Error(`penyedia memblokir ${address}`);
    });
    assert.equal(probes.size, 3);
    for (const methods of probes.values()) assert.deepEqual(methods, ["HEAD", "GET"]);
    assert.equal(result.networkUnavailable, false);
    assert.deepEqual(result.failures, ["ISO Hub: gagal terhubung"]);
    const reported = JSON.stringify(result) + output.join("\n");
    for (const address of probes.keys()) assert.equal(reported.includes(address), false);
    assert.doesNotMatch(reported, /https:|penyedia memblokir/);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test("respons HTTP titik kontrol tetap sah ketika pembatalan body gagal", async () => {
  const result = await checkEcosystemLinkHealth([app], async (url) => {
    if (url === app.href) throw new Error("gagal");
    return { status: 403, body: { cancel: async (): Promise<void> => { throw new Error("stream ditutup"); } } } as Response;
  });
  assert.equal(result.networkUnavailable, false);
  assert.deepEqual(result.failures, ["ISO Hub: gagal terhubung"]);
});

test("fetch titik kontrol yang mengabaikan abort tetap berakhir pada tenggat tiap gelombang", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals: AbortSignal[] = [];
  const methods: string[] = [];
  let settled = false;
  const pending = checkEcosystemLinkHealth([app], async (url, init) => {
    if (url === app.href) throw new Error("gagal");
    signals.push(init!.signal!);
    methods.push(init!.method!);
    return new Promise<Response>(() => {}); // Deliberately ignores abort forever.
  }).then((result) => { settled = true; return result; });
  await flushTasks();
  assert.equal(signals.length, 2);
  t.mock.timers.tick(4_999);
  await flushTasks();
  assert.equal(settled, false);
  assert.ok(signals.every((signal) => !signal.aborted));
  t.mock.timers.tick(1);
  await flushTasks();
  assert.equal(signals.length, 3);
  assert.ok(signals.slice(0, 2).every((signal) => signal.aborted));
  assert.equal(signals[2].aborted, false);
  t.mock.timers.tick(5_000);
  await flushTasks();
  assert.equal(settled, true);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.deepEqual(methods, ["HEAD", "HEAD", "HEAD"]);
  assert.deepEqual(await pending, { failures: [], networkUnavailable: true });
});

test("respons dan penolakan terlambat tidak mengubah status atau memulai GET setelah abort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const requests: Array<{
    resolve: (response: Response) => void;
    reject: (reason: Error) => void;
  }> = [];
  const methods: string[] = [];
  const pending = checkEcosystemLinkHealth([app], async (url, init) => {
    if (url === app.href) throw new Error("gagal");
    methods.push(init!.method!);
    return new Promise<Response>((resolve, reject) => { requests.push({ resolve, reject }); });
  });
  await flushTasks();
  t.mock.timers.tick(5_000);
  await flushTasks();
  t.mock.timers.tick(5_000);
  const result = await pending;
  assert.deepEqual(result, { failures: [], networkUnavailable: true });
  let cancellations = 0;
  requests[0].resolve({
    status: 204,
    body: { cancel: async (): Promise<void> => { cancellations++; throw new Error("late cancellation"); } },
  } as Response);
  requests[1].reject(new Error("late fetch rejection"));
  requests[2].resolve(new Response(null, { status: 403 }));
  // node:test reports unhandled rejections as failures, including late ones.
  await flushTasks();
  await flushTasks();
  assert.equal(cancellations, 1);
  assert.deepEqual(methods, ["HEAD", "HEAD", "HEAD"]);
  assert.deepEqual(result, { failures: [], networkUnavailable: true });
});

test("GET titik kontrol hanya memakai sisa tenggat HEAD", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const rejectHeads: Array<(reason: Error) => void> = [];
  const methods: string[] = [];
  const signals: AbortSignal[] = [];
  let settled = false;
  const pending = checkEcosystemLinkHealth([app], async (url, init) => {
    if (url === app.href) throw new Error("gagal");
    methods.push(init!.method!);
    signals.push(init!.signal!);
    return new Promise<Response>((_resolve, reject) => {
      if (init!.method === "HEAD") rejectHeads.push(reject);
    });
  }).then((result) => { settled = true; return result; });
  await flushTasks();
  t.mock.timers.tick(4_000);
  for (const reject of rejectHeads) reject(new Error("HEAD ditutup"));
  await flushTasks();
  assert.deepEqual(methods, ["HEAD", "HEAD", "GET", "GET"]);
  t.mock.timers.tick(1_000);
  await flushTasks();
  assert.ok(signals.slice(0, 4).every((signal) => signal.aborted));
  assert.deepEqual(methods, ["HEAD", "HEAD", "GET", "GET", "HEAD"]);
  t.mock.timers.tick(5_000);
  await flushTasks();
  assert.equal(settled, true);
  assert.deepEqual(await pending, { failures: [], networkUnavailable: true });
});

test("respons HTTP titik kontrol tidak menunggu pembatalan body yang macet", async () => {
  const result = await checkEcosystemLinkHealth([app], async (url) => {
    if (url === app.href) throw new Error("gagal");
    return {
      status: 403,
      body: { cancel: () => new Promise<void>(() => {}) },
    } as Response;
  });
  assert.deepEqual(result, { failures: ["ISO Hub: gagal terhubung"], networkUnavailable: false });
});

test("semua aplikasi dan ketiga titik kontrol tak menjawab: status tidak pasti, bukan pemulihan", async () => {
  const methods: string[] = [];
  const probes = new Set<string>();
  const result = await checkEcosystemLinkHealth([app], async (url, init) => {
    if (url !== app.href) {
      probes.add(String(url));
      methods.push(init?.method ?? "");
    }
    throw new Error("https://private.test?token=rahasia");
  });
  assert.equal(probes.size, 3);
  assert.deepEqual(methods.sort(), ["GET", "GET", "GET", "HEAD", "HEAD", "HEAD"]);
  assert.equal(result.networkUnavailable, true);
  assert.deepEqual(result.failures, []);
  const reported = JSON.stringify(result);
  for (const address of probes) assert.equal(reported.includes(address), false);
  assert.doesNotMatch(reported, /private|rahasia|https:/);
});

test("HTTP dari aplikasi sukses juga membuktikan konektivitas saat titik kontrol tak menjawab", async () => {
  const result = await checkEcosystemLinkHealth([app, { name: "SMAP–PANCEK", href: "https://smap-pancek.gustafta.my.id" }], async (url) => {
    if (url === app.href) return new Response(null, { status: 204 });
    throw new Error("tidak terhubung");
  });
  assert.equal(result.networkUnavailable, false);
  assert.deepEqual(result.failures, ["SMAP–PANCEK: gagal terhubung"]);
});

test("satu titik kontrol menjawab: kegagalan koneksi aplikasi tetap dilaporkan", async () => {
  const result = await checkEcosystemLinkHealth([app], async (url) => {
    if (url !== app.href && String(url).includes("cloudflare")) {
      return new Response(null, { status: 500 });
    }
    throw new Error("secret");
  });
  assert.equal(result.networkUnavailable, false);
  assert.deepEqual(result.failures, ["ISO Hub: gagal terhubung"]);
});

test("CLI: semua aplikasi HTTP 204 menulis penanda selesai tanpa alarm atau titik kontrol", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ecosystem-links-cli-success-"));
  const complete = join(directory, "complete");
  const unavailable = join(directory, "unavailable");
  const report = join(directory, "report.json");
  const trace = join(directory, "requests.jsonl");
  const preload = join(directory, "fetch-stub.mjs");
  const links = [...ISO_ECOSYSTEM_APPS, ...PROJECT_ECOSYSTEM_APPS];
  try {
    // Record every request, including unexpected connectivity probes, without
    // making any live network calls from the real CLI process.
    await writeFile(preload, `
      import { appendFileSync } from "node:fs";
      globalThis.fetch = async (url, init) => {
        appendFileSync(${JSON.stringify(trace)}, JSON.stringify({
          address: String(url), method: init?.method, redirect: init?.redirect
        }) + "\\n");
        return new Response(null, { status: 204 });
      };
    `);
    const result = spawnSync(process.execPath, [
      "--import", "tsx",
      "--import", preload,
      fileURLToPath(new URL("../scripts/check-ecosystem-links.ts", import.meta.url)),
    ], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: 15_000,
      // Only temporary test destinations are passed to the child process.
      env: {
        ECOSYSTEM_LINKS_COMPLETE: complete,
        ECOSYSTEM_NETWORK_UNAVAILABLE: unavailable,
        ECOSYSTEM_HEALTH_REPORT: report,
      },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${links.length} aplikasi eksternal dapat diakses.\n`);
    assert.deepEqual(JSON.parse(await readFile(report, "utf8")), []);
    assert.equal(await readFile(complete, "utf8"), "ok");
    assert.equal(existsSync(unavailable), false);
    const requests = (await readFile(trace, "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as { address: string; method: string; redirect: string });
    // Exact equality excludes all control addresses and any extra requests.
    assert.deepEqual(requests, links.map((link) => ({
      address: link.href, method: "HEAD", redirect: "manual",
    })));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const appsRespond of [true, false]) {
  test(appsRespond
    ? "CLI: laporan gagal ditulis meski semua aplikasi sukses, penanda selesai tidak dibuat"
    : "CLI: laporan gagal ditulis meski titik kontrol menjawab, penanda selesai tidak dibuat",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "ecosystem-links-cli-report-failure-"));
    const complete = join(directory, "complete");
    const unavailable = join(directory, "unavailable");
    const report = join(directory, "report.json");
    const trace = join(directory, "requests.jsonl");
    const preload = join(directory, "fetch-stub.mjs");
    const links = [...ISO_ECOSYSTEM_APPS, ...PROJECT_ECOSYSTEM_APPS];
    const controls = [
      "https://www.google.com/generate_204",
      "https://www.cloudflare.com/cdn-cgi/trace",
      "https://www.wikipedia.org/",
    ];
    try {
      // A directory cannot be overwritten by writeFile, even as root.
      // All outputs, including the deliberately invalid report, stay local.
      await mkdir(report);
      await writeFile(preload, `
        import { appendFileSync } from "node:fs";
        const controls = ${JSON.stringify(controls)};
        globalThis.fetch = async (url, init) => {
          const address = String(url);
          appendFileSync(${JSON.stringify(trace)}, JSON.stringify({
            address, method: init?.method, redirect: init?.redirect
          }) + "\\n");
          if (${appsRespond} || controls.includes(address)) {
            return new Response(null, { status: 204 });
          }
          throw new Error("Fetch exception detail: " + address + "?token=rahasia");
        };
      `);
      const result = spawnSync(process.execPath, [
        "--import", "tsx",
        "--import", preload,
        fileURLToPath(new URL("../scripts/check-ecosystem-links.ts", import.meta.url)),
      ], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        encoding: "utf8",
        timeout: 15_000,
        // Do not inherit monitor destinations or any other production settings.
        env: {
          ECOSYSTEM_LINKS_COMPLETE: complete,
          ECOSYSTEM_NETWORK_UNAVAILABLE: unavailable,
          ECOSYSTEM_HEALTH_REPORT: report,
        },
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      // Prove the exit was caused by report persistence, not app health.
      assert.match(result.stderr, /EISDIR/);
      assert.equal(existsSync(complete), false);
      assert.equal(existsSync(unavailable), false);
      const requests = (await readFile(trace, "utf8")).trim().split("\n")
        .map((line) => JSON.parse(line) as { address: string; method: string; redirect: string });
      assert.deepEqual(requests, [
        ...links.map((link) => ({
          address: link.href, method: "HEAD", redirect: "manual",
        })),
        ...(appsRespond ? [] : controls.slice(0, 2).map((address) => ({
          address, method: "HEAD", redirect: "manual",
        }))),
      ]);
      for (const address of controls) {
        for (const output of [result.stdout, result.stderr]) {
          assert.equal(output.includes(address), false);
        }
      }
      assert.doesNotMatch(result.stdout + result.stderr,
        /https?:|token=|rahasia|Fetch exception detail/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("CLI: ketiga titik kontrol macet meski abort, proses keluar dengan sinyal unavailable dalam batas waktu", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ecosystem-links-cli-stuck-"));
  const complete = join(directory, "complete");
  const unavailable = join(directory, "unavailable");
  const report = join(directory, "report.json");
  const trace = join(directory, "events.jsonl");
  const preload = join(directory, "fetch-stub.mjs");
  const controls = [
    "https://www.google.com/generate_204",
    "https://www.cloudflare.com/cdn-cgi/trace",
    "https://www.wikipedia.org/",
  ];
  const links = [...ISO_ECOSYSTEM_APPS, ...PROJECT_ECOSYSTEM_APPS];
  const processTimeoutMs = 20_000;
  try {
    // Replace every fetch before loading the real CLI. Abort is recorded but
    // deliberately never settles a control promise. Keep real deadline timers.
    await writeFile(preload, `
      import { appendFileSync } from "node:fs";
      const controls = ${JSON.stringify(controls)};
      const record = (event) =>
        appendFileSync(${JSON.stringify(trace)}, JSON.stringify(event) + "\\n");
      globalThis.fetch = async (url, init) => {
        const address = String(url);
        record({ event: "request", address, method: init?.method, redirect: init?.redirect });
        if (controls.includes(address)) {
          init.signal.addEventListener("abort", () => {
            record({ event: "abort", address });
          }, { once: true });
          return new Promise(() => {});
        }
        throw new Error("Permintaan aplikasi gagal");
      };
    `);
    const startedAt = performance.now();
    const result = spawnSync(process.execPath, [
      "--import", "tsx",
      "--import", preload,
      fileURLToPath(new URL("../scripts/check-ecosystem-links.ts", import.meta.url)),
    ], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: processTimeoutMs,
      // Never inherit credentials, preload options or production destinations.
      env: {
        ECOSYSTEM_LINKS_COMPLETE: complete,
        ECOSYSTEM_NETWORK_UNAVAILABLE: unavailable,
        ECOSYSTEM_HEALTH_REPORT: report,
      },
    });
    const elapsedMs = performance.now() - startedAt;
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.ok(elapsedMs < processTimeoutMs, `CLI took ${elapsedMs} ms`);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr,
      "Konektivitas pemeriksa tidak dapat dipastikan; kegagalan koneksi aplikasi tidak dilaporkan.\n");
    assert.deepEqual(JSON.parse(await readFile(report, "utf8")), []);
    assert.equal(await readFile(unavailable, "utf8"), "unavailable");
    assert.equal(existsSync(complete), false);
    const events = (await readFile(trace, "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line));
    const request = (address: string) => ({
      event: "request", address, method: "HEAD", redirect: "manual",
    });
    // Exact order proves both primary controls time out before fallback starts,
    // all three receive abort, and no GET or other extra request is attempted.
    assert.deepEqual(events, [
      ...links.map((link) => request(link.href)),
      ...controls.slice(0, 2).map(request),
      ...controls.slice(0, 2).map((address) => ({ event: "abort", address })),
      request(controls[2]),
      { event: "abort", address: controls[2] },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const fallbackResponds of [true, false]) {
  test(fallbackResponds
    ? "CLI: penyedia ketiga menjawab, penanda selesai dibuat dan kegagalan aplikasi dilaporkan"
    : "CLI: ketiga penyedia gagal, hanya sinyal gangguan pemeriksa dibuat tanpa penanda selesai",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "ecosystem-links-cli-"));
    const complete = join(directory, "complete");
    const unavailable = join(directory, "unavailable");
    const report = join(directory, "report.json");
    const trace = join(directory, "requests.jsonl");
    const preload = join(directory, "fetch-stub.mjs");
    const controls = [
      "https://www.google.com/generate_204",
      "https://www.cloudflare.com/cdn-cgi/trace",
      "https://www.wikipedia.org/",
    ];
    const links = [...ISO_ECOSYSTEM_APPS, ...PROJECT_ECOSYSTEM_APPS];
    try {
      // Preload replaces fetch before the real CLI entry point runs. No live
      // requests are made, and the trace proves all three providers were tried.
      await writeFile(preload, `
        import { appendFileSync } from "node:fs";
        globalThis.fetch = async (url, init) => {
          const address = String(url);
          appendFileSync(${JSON.stringify(trace)}, JSON.stringify({
            address, method: init?.method, redirect: init?.redirect
          }) + "\\n");
          if (${fallbackResponds} && address === ${JSON.stringify(controls[2])}
              && init?.method === "GET") {
            return new Response(null, { status: 403 });
          }
          throw new Error("Permintaan gagal: " + address + "?token=rahasia");
        };
      `);
      const result = spawnSync(process.execPath, [
        "--import", "tsx",
        "--import", preload,
        fileURLToPath(new URL("../scripts/check-ecosystem-links.ts", import.meta.url)),
      ], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        encoding: "utf8",
        timeout: 15_000,
        // Pass only test outputs, never production monitor destinations.
        env: {
          ECOSYSTEM_LINKS_COMPLETE: complete,
          ECOSYSTEM_NETWORK_UNAVAILABLE: unavailable,
          ECOSYSTEM_HEALTH_REPORT: report,
        },
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      const requests = (await readFile(trace, "utf8")).trim().split("\n")
        .map((line) => JSON.parse(line) as { address: string; method: string; redirect: string });
      assert.equal(requests.length, links.length + 6);
      assert.deepEqual(requests.slice(0, links.length), links.map((link) => ({
        address: link.href, method: "HEAD", redirect: "manual",
      })));
      for (const address of controls) {
        assert.deepEqual(requests.filter((request) => request.address === address), [
          { address, method: "HEAD", redirect: "manual" },
          { address, method: "GET", redirect: "manual" },
        ]);
        for (const output of [result.stdout, result.stderr]) {
          assert.equal(output.includes(address), false);
        }
      }
      assert.deepEqual(requests.slice(-2).map((request) => request.address),
        [controls[2], controls[2]]);
      assert.doesNotMatch(result.stdout + result.stderr, /https?:|token=|rahasia|Permintaan gagal/);
      const failures = JSON.parse(await readFile(report, "utf8"));
      if (fallbackResponds) {
        assert.equal(await readFile(complete, "utf8"), "ok");
        assert.equal(existsSync(unavailable), false);
        assert.deepEqual(failures, links.map((link) => `${link.name}: gagal terhubung`));
        assert.match(result.stderr, /Pemeriksaan aplikasi eksternal gagal/);
        for (const failure of failures) assert.ok(result.stderr.includes(`- ${failure}`));
        assert.doesNotMatch(result.stderr, /Konektivitas pemeriksa/);
      } else {
        assert.equal(existsSync(complete), false);
        assert.equal(await readFile(unavailable, "utf8"), "unavailable");
        assert.deepEqual(failures, []);
        assert.equal(result.stderr,
          "Konektivitas pemeriksa tidak dapat dipastikan; kegagalan koneksi aplikasi tidak dilaporkan.\n");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}