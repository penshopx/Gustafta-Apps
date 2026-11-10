import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { lmsCourses, lmsLessons, lmsEnrollments, lmsLessonProgress, lmsCertificates } from "@shared/schema";

// server/routes-lms imports server/db even when all tested routes use the
// injected adapter. Give that unused pool a deliberately unreachable target,
// never the shared DATABASE_URL (or its pooled override).
process.env.DATABASE_URL = "postgres://adapter:adapter@127.0.0.1:1/lms_adapter_no_db";
delete process.env.DATABASE_URL_POOLED;

type Row = Record<string, any>;

function matches(row: Row, expression: any): boolean {
  if (!expression?.queryChunks) return true;
  const chunks = expression.queryChunks as any[];
  const rowKey = (column: any) => column.name.replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase());
  const sqlText = chunks
    .filter((part) => Array.isArray(part?.value) && !part?.queryChunks)
    .map((part) => part.value.join(""))
    .join("")
    .toLowerCase();
  const column = chunks.find((part) => part?.table && typeof part?.name === "string");
  if (column && sqlText.includes(" is null")) return row[rowKey(column)] == null;
  if (column && sqlText.includes(" in ")) {
    const values = chunks.find((part) => Array.isArray(part) && part.every((p) => "value" in p)) ?? [];
    return values.some((value: any) => row[rowKey(column)] === value.value);
  }
  if (column && sqlText.includes(" = ")) {
    const parameter = chunks.find((part) => part && Object.hasOwn(part, "value") && !Array.isArray(part.value));
    return parameter ? row[rowKey(column)] === parameter.value : false;
  }
  const nested = chunks.filter((part) => part?.queryChunks);
  if (nested.length === 1 && !sqlText.includes(" and ") && !sqlText.includes(" or ")) {
    return matches(row, nested[0]);
  }
  if (nested.length) {
    const separator = sqlText.includes(" or ") ? "or" : "and";
    const results = nested.map((part) => matches(row, part));
    return separator === "or" ? results.some(Boolean) : results.every(Boolean);
  }
  return true;
}

class MemoryLmsDb {
  readonly rows = new Map<any, Row[]>([
    [lmsCourses, [
      { id: 101, title: "Paid course", price: 25, isActive: true },
      { id: 102, title: "Free course", price: 0, isActive: true },
      { id: 202, title: "Other course", price: 25, isActive: true },
      { id: 203, title: "Archived course", price: 25, isActive: true },
    ]],
    [lmsLessons, [
      { id: 11, courseId: 101, isActive: true, isPreview: false },
      { id: 12, courseId: 101, isActive: true, isPreview: false },
      { id: 13, courseId: 101, isActive: false, isPreview: true },
      { id: 14, courseId: 202, isActive: true, isPreview: false },
      { id: 21, courseId: 102, isActive: true, isPreview: false },
      { id: 31, courseId: 203, isActive: true, isPreview: false },
    ]],
    [lmsEnrollments, [
      { id: 1, userId: "student-id", courseId: 101, progress: 0 },
      { id: 2, userId: "student-claims", courseId: 101, progress: 0 },
    ]],
    [lmsLessonProgress, []],
    [lmsCertificates, [
      { id: 1, userId: "student-archived", courseId: null, courseTitle: "Archived course", certificateCode: "ORIGINAL-CERT" },
      { id: 2, userId: "student-same-course", courseId: 202, courseTitle: "Other course", certificateCode: "SAME-COURSE-CERT" },
    ]],
  ]);
  private transactionQueue = Promise.resolve();

  select(_fields?: any) {
    const owner = this;
    return {
      from(table: any) {
        let condition: any;
        const query: any = {
          where(value: any) { condition = value; return query; },
          orderBy() { return query; },
          limit() { return query; },
          for() { return query; },
          then(resolve: any, reject: any) {
            const result = (owner.rows.get(table) ?? []).filter((row) => matches(row, condition));
            return Promise.resolve(result.map((row) => ({ ...row }))).then(resolve, reject);
          },
        };
        return query;
      },
    };
  }

  insert(table: any) {
    const owner = this;
    let values: Row;
    let ignoreConflict = false;
    let completed = false;
    const insertNow = () => {
      if (completed) return [];
      completed = true;
      const rows = owner.rows.get(table) ?? [];
      const uniqueFields = table === lmsEnrollments
        ? ["userId", "courseId"]
        : table === lmsLessonProgress
          ? ["userId", "courseId", "lessonId"]
          : table === lmsCertificates
            ? ["userId", "courseId"]
            : [];
      const existing = uniqueFields.length && rows.some((row) =>
        uniqueFields.every((key) => row[key] === values[key]) &&
        !(table === lmsCertificates && values.courseId == null)
      );
      if (existing && ignoreConflict) return [];
      if (existing) throw new Error("unique conflict");
      const inserted = { id: rows.length + 1, ...values, completedAt: values.completedAt ?? new Date() };
      rows.push(inserted);
      owner.rows.set(table, rows);
      return [{ ...inserted }];
    };
    const builder: any = {
      values(value: Row) { values = value; return builder; },
      onConflictDoNothing() { ignoreConflict = true; return builder; },
      returning() { return Promise.resolve(insertNow()); },
      then(resolve: any, reject: any) { return Promise.resolve(insertNow()).then(resolve, reject); },
    };
    return builder;
  }

  update(table: any) {
    const owner = this;
    let values: Row;
    return {
      set(value: Row) {
        values = value;
        let condition: any;
        const query: any = {
          where(expression: any) { condition = expression; return query; },
          then(resolve: any, reject: any) {
            const rows = owner.rows.get(table) ?? [];
            for (const row of rows) if (matches(row, condition)) Object.assign(row, values);
            return Promise.resolve(undefined).then(resolve, reject);
          },
        };
        return query;
      },
    };
  }

  async transaction<T>(operation: (tx: this) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.transactionQueue;
    this.transactionQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation(this);
    } finally {
      release();
    }
  }

  async execute() { return { rows: [] }; }
}

let server: Server;
let baseUrl: string;
const memoryDb = new MemoryLmsDb();

before(async () => {
  const { registerLmsRoutes } = await import("../server/routes-lms");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    const id = req.headers["x-test-user"];
    const sub = req.headers["x-claims-user"];
    if (id) req.user = { id: String(id) };
    if (sub) req.user = { claims: { sub: String(sub) } };
    req.isAuthenticated = () => Boolean(id || sub);
    next();
  });
  registerLmsRoutes(app, async () => ({ added: 0, updated: 0 }), memoryDb);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function auth(userId?: string, claimsUserId?: string): Record<string, string> {
  return userId ? { "x-test-user": userId } : claimsUserId ? { "x-claims-user": claimsUserId } : {};
}

async function postProgress(body: any, userId = "student-id") {
  return postProgressWithHeaders(body, auth(userId));
}

async function postProgressWithHeaders(body: any, headers: Record<string, string>) {
  return fetch(`${baseUrl}/api/lms/progress`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("LMS lesson access validates numeric IDs, active state, course identity and paid enrollment", async () => {
  assert.equal((await fetch(`${baseUrl}/api/lms/lessons/11garbage`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/lms/lessons/13`)).status, 404);
  assert.equal((await postProgress({ lessonId: "11oops", courseId: 101 })).status, 400);
  assert.equal((await postProgress({ lessonId: 11, courseId: 202 })).status, 400);
  assert.equal((await postProgress({ lessonId: 14, courseId: 202 }, "un-enrolled")).status, 403);

  const inactiveCourse = memoryDb.rows.get(lmsCourses)!.find((row) => row.id === 202)!;
  inactiveCourse.isActive = false;
  assert.equal((await fetch(`${baseUrl}/api/lms/lessons/14`, { headers: auth("student-id") })).status, 404);
  inactiveCourse.isActive = true;
  assert.equal((await fetch(`${baseUrl}/api/lms/enroll/101junk`, { method: "POST", headers: auth("student-id") })).status, 400);
});

test("free lesson access auto-enrolls for claims auth, and progress is atomic/idempotent with one certificate", async () => {
  const freeLesson = await fetch(`${baseUrl}/api/lms/lessons/21`, { headers: auth(undefined, "free-student") });
  assert.equal(freeLesson.status, 200);
  assert.ok(memoryDb.rows.get(lmsEnrollments)!.some((row) => row.userId === "free-student" && row.courseId === 102));

  const [firstA, firstB] = await Promise.all([
    postProgress({ lessonId: 11, courseId: 101 }),
    postProgress({ lessonId: 12, courseId: 101 }),
  ]);
  assert.equal(firstA.status, 200);
  assert.equal(firstB.status, 200);
  const bodies = await Promise.all([firstA.json() as Promise<any>, firstB.json() as Promise<any>]);
  assert.ok(bodies.some((body) => body.progress === 100));
  const certificateCode = bodies.find((body) => body.certificateCode)?.certificateCode;
  assert.ok(certificateCode);

  const replay = await postProgress({ lessonId: 12, courseId: 101 });
  assert.equal(replay.status, 200);
  const replayBody = await replay.json() as any;
  assert.equal(replayBody.progress, 100);
  assert.equal(replayBody.certificateCode, certificateCode);
  assert.equal(memoryDb.rows.get(lmsLessonProgress)!.filter((row) => row.userId === "student-id").length, 2);
  assert.equal(memoryDb.rows.get(lmsCertificates)!.filter((row) => row.userId === "student-id" && row.courseId === 101).length, 1);

  const claimsCompletion = await Promise.all([
    postProgressWithHeaders({ lessonId: 11, courseId: 101 }, auth(undefined, "student-claims")),
    postProgressWithHeaders({ lessonId: 12, courseId: 101 }, auth(undefined, "student-claims")),
  ]);
  assert.deepEqual(claimsCompletion.map((response) => response.status), [200, 200]);
  const claimsBodies = await Promise.all(claimsCompletion.map((response) => response.json() as Promise<any>));
  assert.ok(claimsBodies.some((body) => body.progress === 100 && body.certificateCode));

  for (const headers of [auth("student-id"), auth(undefined, "student-claims")]) {
    const [coursesResponse, certificatesResponse] = await Promise.all([
      fetch(`${baseUrl}/api/lms/my-courses`, { headers }),
      fetch(`${baseUrl}/api/lms/certificates`, { headers }),
    ]);
    assert.equal(coursesResponse.status, 200);
    assert.equal(certificatesResponse.status, 200);
    const courses = await coursesResponse.json() as any[];
    const certificates = await certificatesResponse.json() as any[];
    const course = courses.find((entry) => entry.courseId === 101);
    assert.ok(course);
    assert.deepEqual(new Set(course.completedLessons), new Set([11, 12]));
    assert.ok(certificates.some((certificate) => certificate.courseId === 101));
  }
});

test("a same-titled new course does not inherit a detached certificate, which remains verifiable", async () => {
  const response = await fetch(`${baseUrl}/api/lms/enroll/203`, { method: "POST", headers: auth("student-archived") });
  assert.equal(response.status, 200);
  const enrollment = await response.json() as any;
  assert.equal(enrollment.progress, 0);

  const oldCertificate = await fetch(`${baseUrl}/api/lms/certificate/ORIGINAL-CERT`);
  assert.equal(oldCertificate.status, 200);
  const oldCertificateBody = await oldCertificate.json() as any;
  assert.equal(oldCertificateBody.certificateCode, "ORIGINAL-CERT");
  assert.equal(oldCertificateBody.courseId, null);
  assert.equal(oldCertificateBody.course.title, "Archived course");

  const progress = await postProgress({ lessonId: 31, courseId: 203 }, "student-archived");
  assert.equal(progress.status, 200);
  const body = await progress.json() as any;
  assert.ok(body.certificateCode);
  assert.notEqual(body.certificateCode, "ORIGINAL-CERT");
  const studentCertificates = memoryDb.rows.get(lmsCertificates)!.filter((row) => row.userId === "student-archived");
  assert.equal(studentCertificates.length, 2);
  assert.ok(studentCertificates.some((row) => row.courseId === null && row.certificateCode === "ORIGINAL-CERT"));
  assert.ok(studentCertificates.some((row) => row.courseId === 203 && row.certificateCode === body.certificateCode));
});

test("re-enrollment for the same course ID still preserves its issued certificate", async () => {
  const response = await fetch(`${baseUrl}/api/lms/enroll/202`, { method: "POST", headers: auth("student-same-course") });
  assert.equal(response.status, 200);
  const enrollment = await response.json() as any;
  assert.equal(enrollment.progress, 100);

  const progress = await postProgress({ lessonId: 14, courseId: 202 }, "student-same-course");
  assert.equal(progress.status, 200);
  const body = await progress.json() as any;
  assert.equal(body.certificateCode, "SAME-COURSE-CERT");
});