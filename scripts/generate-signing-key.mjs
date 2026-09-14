#!/usr/bin/env node
/**
 * Generates a new Ed25519 manifest-signing key and prints it as an env line.
 *
 *   npm run keys:generate
 *
 * Put the output in .env.local (or your host's secret store). Keep a secure
 * backup: if the key is lost, previously issued manifests can no longer be
 * verified against this issuer and every site must be re-signed.
 */
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ed25519");
const der = privateKey.export({ format: "der", type: "pkcs8" });
process.stdout.write(`TRUSTTAB_SIGNING_PRIVATE_KEY=${der.toString("base64")}\n`);
