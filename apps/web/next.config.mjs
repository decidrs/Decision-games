/** @type {import('next').NextConfig} */
export default { output: "standalone", transpilePackages: ["@games/spine", "@games/scoring-core"], experimental: { outputFileTracingRoot: new URL("../../", import.meta.url).pathname } };
