// `next dev` compiles each route on first request. Compile them all once before the suite so a cold start can
// never make an assertion time out under parallel workers.
const ROUTES = ["/", "/command", "/charter/new", "/charter/WARM", "/incident/new", "/incident/WARM", "/capability/WARM", "/target", "/audit", "/api/build-info", "/icon.svg"];

export default async function globalSetup(config: { projects: Array<{ use: { baseURL?: string } }> }) {
  const base = config.projects[0]?.use.baseURL ?? "http://localhost:3101";
  await Promise.all(ROUTES.map(async (route) => {
    const response = await fetch(`${base}${route}`);
    if (!response.ok) throw new Error(`warm-up failed for ${route}: HTTP ${response.status}`);
  }));
}
