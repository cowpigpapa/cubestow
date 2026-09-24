import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/client/vendor", { recursive: true });
await mkdir("dist/server", { recursive: true });

for (const file of ["index.html", "styles.css", "layout-fixes.css", "v2.css", "v3-projects.css", "packing-engine.js", "engine-worker.js", "app.js", "project-model.js", "project-store.js", "load-insights.js", "sample-scenarios.js", "solution-validator.js"]) {
  await cp(file, `dist/client/${file}`);
}
await cp("vendor/three.min.js", "dist/client/vendor/three.min.js");
await cp("vendor/xlsx.full.min.js", "dist/client/vendor/xlsx.full.min.js");
await cp("vendor/supabase.js", "dist/client/vendor/supabase.js");
await cp("public/og.png", "dist/client/og.png");

const supabaseConfig = `window.LOADWISE_SUPABASE = ${JSON.stringify({url:process.env.SUPABASE_URL||'',publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY||''})};\n`;
await writeFile("dist/client/supabase-config.js", supabaseConfig);

const worker = `export default { async fetch(request, env) {\n  const url = new URL(request.url);\n  if (url.pathname === \"/\") url.pathname = \"/index.html\";\n  const response = await env.ASSETS.fetch(new Request(url, request));\n  return response.status === 404 ? env.ASSETS.fetch(new Request(new URL(\"/index.html\", request.url), request)) : response;\n} };\n`;
await writeFile("dist/server/index.js", worker);

const html = await readFile("dist/client/index.html", "utf8");
if (!html.includes("<title>Cubestow")) throw new Error("Cubestow metadata missing");
for(const [,src] of html.matchAll(/<script[^>]+src="([^"]+)"/g))if(!/^https?:/.test(src))await access(`dist/client/${src.split('?')[0]}`);
console.log("Cubestow build complete");
