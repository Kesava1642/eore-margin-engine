"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const schemaPath = path.join(__dirname, "..", "prisma", "schema.prisma");

if (!fs.existsSync(schemaPath)) {
  console.log("[prisma-generate-if-schema] prisma/schema.prisma not found, skipping prisma generate.");
  process.exit(0);
}

console.log("[prisma-generate-if-schema] Running prisma generate...");
const result = spawnSync("npx", ["prisma", "generate"], {
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
  shell: process.platform === "win32",
});

process.exit(result.status !== null ? result.status : 0);
