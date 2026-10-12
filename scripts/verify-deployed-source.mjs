// Fetches the code stored on Studionet for every Mass contract and compares it byte-for-byte
// (and by sha256) to the repository source and to the sha256 recorded in the manifest.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const manifest = JSON.parse(readFileSync(new URL("../deployment-manifest.public.json", import.meta.url), "utf8"));
if (Number(manifest.chainId) !== 61999) throw new Error(`Refusing provenance check for chain ${manifest.chainId}`);
const client = createClient({ chain: studionet, endpoint: "https://studio.genlayer.com/api" });
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const eol = (b) => Buffer.from(b.toString("utf8").replace(/\r\n/g, "\n"), "utf8");

const failures = [];
for (const [name, address] of Object.entries(manifest.contracts)) {
  const spec = manifest.sources[name];
  if (!address || !spec) { failures.push(`${name}: missing address or source spec`); continue; }
  const repo = readFileSync(new URL(`../${spec.path}`, import.meta.url));
  let deployed;
  try {
    const b64 = await client.request({ method: "gen_getContractCode", params: [address] });
    if (typeof b64 === "string" && b64.length) deployed = Buffer.from(b64, "base64");
  } catch (e) { console.log(`${name}: gen_getContractCode unavailable: ${String(e).split("\n")[0]}`); }
  if (!deployed) { failures.push(`${name}: deployed source bytes unavailable from RPC`); continue; }
  const exact = deployed.equals(repo);
  const normalized = eol(deployed).equals(eol(repo));
  const manifestMatch = sha256(repo) === spec.sha256;
  console.log(`${name}: ${address}\n  deployed_sha256=${sha256(deployed)}\n  repository_sha256=${sha256(repo)}\n  manifest_sha256=${spec.sha256}\n  exact_byte_match=${exact} eol_normalized_match=${normalized} manifest_match=${manifestMatch}`);
  if (!normalized) failures.push(`${name}: deployed source differs from repository`);
  if (!manifestMatch) failures.push(`${name}: repository differs from manifest sha256`);
}
if (failures.length) { console.error(`UNVERIFIED: ${failures.join("; ")}`); process.exit(1); }
console.log("VERIFIED: every deployed contract matches the repository source and manifest.");
