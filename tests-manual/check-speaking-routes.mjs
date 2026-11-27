// Check if speaking routes exist in NestJS Swagger JSON
const res = await fetch('http://localhost:3001/api/docs-json');
const json = await res.json();
const paths = Object.keys(json.paths || {});
const speakingPaths = paths.filter(p => p.includes('speaking'));
console.log('All speaking paths in Swagger:', speakingPaths);
if (speakingPaths.length === 0) {
  console.log('NO SPEAKING ROUTES REGISTERED — SpeakingModule failed to load');
} else {
  for (const p of speakingPaths) {
    console.log(`  ${p}:`, Object.keys(json.paths[p]));
  }
}

// Also check all registered routes
const allPaths = paths.sort();
console.log(`\nTotal routes: ${allPaths.length}`);
console.log('Sample routes:', allPaths.slice(0, 10));
