import { NextResponse } from "next/server";
import manifest from "@/deployment-manifest.public.json";

export const dynamic = "force-dynamic";

export function GET() {
  const env = process.env;
  return NextResponse.json(
    {
      project: "Mass",
      gitCommitSha: env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || env.NEXT_PUBLIC_GIT_COMMIT_SHA || "unknown",
      gitCommitRef: env.VERCEL_GIT_COMMIT_REF || env.GIT_COMMIT_REF || "unknown",
      deploymentId: env.VERCEL_DEPLOYMENT_ID || env.DEPLOYMENT_ID || "local",
      environment: env.VERCEL_ENV || env.NODE_ENV || "unknown",
      network: manifest.network,
      chainId: manifest.chainId,
      rpc: manifest.rpc,
      contracts: manifest.contracts,
      contractSourcesCommit: (manifest as { sourcesCommit?: string }).sourcesCommit ?? "",
      builtAt: env.BUILD_TIME || "unknown",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
