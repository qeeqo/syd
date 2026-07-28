#!/usr/bin/env bun
// Regenerates THIRD_PARTY_LICENSES.md from the production dependency tree.
//
// Why this exists: when syd is bundled/redistributed, every npm package baked
// into the artifact carries a license whose notice must travel with it (MIT/BSD
// require the copyright + permission text; Apache-2.0 additionally wants NOTICE).
// Hand-maintaining that list rots the moment a dependency changes, so we derive
// it from what's actually installed.
//
// Zero dependencies (Bun/Node built-ins only), fail-soft (a package we can't
// read is warned and skipped, never a throw), and deterministic (sorted output)
// so the file only changes when the dependency set really does.
//
// Run: `bun run licenses`  (see package.json scripts)

import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = process.cwd();
const PREAMBLE = join(ROOT, "scripts", "licenses-preamble.md");
const OUT = join(ROOT, "THIRD_PARTY_LICENSES.md");

// A license blob big enough to hold any real license text but capped so a
// package that dumps its whole README into a LICENSE file can't bloat the notices.
const MAX_LICENSE_CHARS = 20_000;

type PkgJson = {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
  dependencies?: Record<string, string>;
};

type Entry = {
  name: string;
  version: string;
  license: string;
  text: string | null; // verbatim LICENSE/COPYING/NOTICE text, if the package ships one
};

const warnings: string[] = [];

// Resolve an installed package's directory by walking node_modules upward from
// `fromDir` — the same lookup Node's resolver does, so it works with both
// hoisted and nested layouts.
function resolvePkgDir(name: string, fromDir: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Normalize the several shapes an SPDX id takes across old and new package.json.
function licenseId(pkg: PkgJson): string {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license === "object" && pkg.license.type) {
    return pkg.license.type;
  }
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map((l) => l.type).filter(Boolean);
    if (types.length) return types.join(" OR ");
  }
  return "UNKNOWN";
}

// The verbatim notice text a package ships, if any. LICENSE/LICENCE/COPYING hold
// the license; NOTICE is Apache-2.0's required-attribution file. We include both.
function readLicenseText(dir: string): string | null {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  const licenseFiles = files.filter((f) => /^licen[sc]e/i.test(f) || /^copying/i.test(f));
  const noticeFiles = files.filter((f) => /^notice/i.test(f));
  const chunks: string[] = [];
  for (const f of [...licenseFiles.sort(), ...noticeFiles.sort()]) {
    try {
      const body = readFileSync(join(dir, f), "utf8").trim();
      if (body) chunks.push(licenseFiles.includes(f) ? body : `NOTICE:\n\n${body}`);
    } catch {
      // Unreadable file — skip it, the SPDX id still records the license.
    }
  }
  if (chunks.length === 0) return null;
  let text = chunks.join("\n\n----\n\n");
  if (text.length > MAX_LICENSE_CHARS) {
    text = `${text.slice(0, MAX_LICENSE_CHARS)}\n\n[…truncated — see the package's LICENSE file for the full text]`;
  }
  return text;
}

// Breadth-first walk of the PRODUCTION dependency closure: start at the root
// package's `dependencies` and follow each package's own `dependencies`. This
// deliberately excludes devDependencies — build/lint tooling isn't shipped in a
// bundled artifact, so it doesn't need attribution.
function collectProdDeps(): Entry[] {
  const root: PkgJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const seen = new Map<string, Entry>(); // key: name@version
  const queue: Array<{ name: string; from: string }> = Object.keys(
    root.dependencies ?? {},
  ).map((name) => ({ name, from: ROOT }));

  while (queue.length > 0) {
    const { name, from } = queue.shift()!;
    const dir = resolvePkgDir(name, from);
    if (!dir) {
      warnings.push(`could not resolve "${name}" (referenced from ${from})`);
      continue;
    }
    let pkg: PkgJson;
    try {
      pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      warnings.push(`could not read package.json for "${name}" at ${dir}`);
      continue;
    }
    const version = pkg.version ?? "0.0.0";
    const key = `${pkg.name ?? name}@${version}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      name: pkg.name ?? name,
      version,
      license: licenseId(pkg),
      text: readLicenseText(dir),
    });
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      queue.push({ name: dep, from: dir });
    }
  }

  return [...seen.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

function render(entries: Entry[]): string {
  const preamble = readFileSync(PREAMBLE, "utf8").trimEnd();

  // A license summary line so a reviewer can eyeball the spread without reading
  // every entry — and spot a surprise copyleft id immediately.
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.license, (counts.get(e.license) ?? 0) + 1);
  const summary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lic, n]) => `${n}× ${lic}`)
    .join(" · ");

  const lines: string[] = [
    preamble,
    "",
    "---",
    "",
    "# Bundled npm dependencies",
    "",
    "<!-- GENERATED by scripts/generate-licenses.ts — do not edit by hand. Run `bun run licenses`. -->",
    "",
    `syd's production dependency tree, and the license notice each package ships. ${entries.length} packages.`,
    "",
    `License spread: ${summary}.`,
    "",
  ];

  for (const e of entries) {
    lines.push(`## ${e.name}@${e.version}`, "", `License: ${e.license}`, "");
    if (e.text) {
      lines.push("```", e.text, "```", "");
    } else {
      lines.push(
        `_This package bundles no LICENSE file; the SPDX id above (\`${e.license}\`) is its declared license._`,
        "",
      );
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function main() {
  if (!existsSync(PREAMBLE)) {
    console.error(`error: preamble not found at ${PREAMBLE}`);
    process.exit(1);
  }
  const entries = collectProdDeps();
  const output = render(entries);
  writeFileSync(OUT, output, "utf8");

  console.log(`Wrote ${OUT} — ${entries.length} production packages.`);
  const missing = entries.filter((e) => e.license === "UNKNOWN");
  if (missing.length > 0) {
    console.warn(
      `\n⚠ ${missing.length} package(s) declare no license — verify manually before shipping:`,
    );
    for (const e of missing) console.warn(`   ${e.name}@${e.version}`);
  }
  if (warnings.length > 0) {
    console.warn(`\n⚠ ${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`   ${w}`);
  }
}

main();
