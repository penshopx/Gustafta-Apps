import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import ts from "typescript";
import { agents } from "../shared/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbStoragePath = resolve(__dirname, "../server/db-storage.ts");

function mappedAgentKeys(): Set<string> {
  const source = readFileSync(dbStoragePath, "utf8");
  const sourceFile = ts.createSourceFile(
    dbStoragePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let returnedObject: ts.ObjectLiteralExpression | undefined;

  function unwrap(expression: ts.Expression): ts.Expression {
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
      return unwrap(expression.expression);
    }
    return expression;
  }

  function visit(node: ts.Node): void {
    if (
      ts.isMethodDeclaration(node)
      && node.name.getText(sourceFile) === "mapAgentRow"
    ) {
      const findReturn = (child: ts.Node): void => {
        if (ts.isReturnStatement(child) && child.expression) {
          const expression = unwrap(child.expression);
          if (ts.isObjectLiteralExpression(expression)) returnedObject = expression;
        }
        ts.forEachChild(child, findReturn);
      };
      findReturn(node);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(returnedObject, "mapAgentRow harus mengembalikan object literal agar parity dapat diaudit.");

  return new Set(
    returnedObject.properties
      .filter(ts.isPropertyAssignment)
      .map((property) => property.name.getText(sourceFile).replace(/^["']|["']$/g, "")),
  );
}

test("mapAgentRow mengekspos setiap kolom agents kecuali pengecualian yang dijelaskan", () => {
  const schemaKeys = Object.keys(getTableColumns(agents));
  const mapperKeys = mappedAgentKeys();

  // Pengecualian harus disengaja dan memiliki komentar alasan di sini.
  const knownExclusions = new Set<string>([]);

  const missing = schemaKeys.filter(
    (key) => !mapperKeys.has(key) && !knownExclusions.has(key),
  );

  assert.deepEqual(
    missing,
    [],
    `Kolom agents berikut hilang dari mapAgentRow: ${missing.join(", ")}. `
      + "Petakan kolomnya, atau tambahkan ke knownExclusions dengan komentar alasan.",
  );
});