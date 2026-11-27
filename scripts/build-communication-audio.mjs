import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMUNICATION_SCENARIOS } from '../apps/api/src/learning/communication-scenarios.ts';

const output = fileURLToPath(new URL('../apps/web/public/communication-audio/', import.meta.url));
const staging = mkdtempSync(join(tmpdir(), 'linguaai-dialogue-'));

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: staging, stdio: 'inherit' });
}

try {
  mkdirSync(output, { recursive: true });
  ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '0.42', 'pause.wav']);

  for (const scenario of COMMUNICATION_SCENARIOS) {
    const tracks = [];
    for (const [index, line] of scenario.dialogue.entries()) {
      const filename = `line-${index}`;
      const voice = ['slt', 'rms'][index % 2];
      writeFileSync(join(staging, `${filename}.txt`), line.text.replace(/[’‘]/g, "'"));
      ffmpeg(['-f', 'lavfi', '-i', `flite=textfile=${filename}.txt:voice=${voice}`, '-ar', '16000', `${filename}.wav`]);
      if (index > 0) tracks.push("file 'pause.wav'");
      tracks.push(`file '${filename}.wav'`);
    }
    writeFileSync(join(staging, 'tracks.txt'), tracks.join('\n'));
    ffmpeg(['-f', 'concat', '-safe', '1', '-i', 'tracks.txt', '-c:a', 'libmp3lame', '-b:a', '40k', join(output, `${scenario.slug}.mp3`)]);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
