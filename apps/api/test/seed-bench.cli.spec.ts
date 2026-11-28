import {
  isMainModule,
  isProductionGateBlocked,
  parseArgs,
  runBenchSeed,
} from '../prisma/seed-bench';

const baseArgs = {
  target: '10k' as const,
  seed: 20260101,
  users: 200,
  dryRun: false,
  confirm: true,
  allowProduction: false,
};

describe('seed-bench CLI safety gates', () => {
  it('parses explicit options and rejects malformed ones', () => {
    expect(
      parseArgs([
        '--target=100k',
        '--seed=42',
        '--users=10',
        '--dry-run',
        '--confirm',
      ]),
    ).toEqual({
      target: '100k',
      seed: 42,
      users: 10,
      dryRun: true,
      confirm: true,
      allowProduction: false,
    });
    expect(() => parseArgs(['--target=1m', '--seed=-1'])).toThrow(
      /positive integer/,
    );
    expect(() => parseArgs(['--target=999m'])).toThrow(/--target/);
    expect(() => parseArgs(['--confirm', '--confirm'])).toThrow(/duplicate/);
  });

  it('does not run main() on import', () => {
    expect(isMainModule('/repo/prisma/seed-bench.ts', undefined)).toBe(false);
    expect(
      isMainModule('/repo/prisma/seed-bench.ts', '/repo/dist/main.js'),
    ).toBe(false);
    expect(
      isMainModule('/repo/prisma/seed-bench.ts', '/repo/prisma/seed-bench.ts'),
    ).toBe(true);
  });

  it('blocks production without a second explicit flag', () => {
    expect(isProductionGateBlocked({ NODE_ENV: 'production' }, baseArgs)).toBe(
      true,
    );
    expect(
      isProductionGateBlocked(
        { NODE_ENV: 'production' },
        { ...baseArgs, allowProduction: true },
      ),
    ).toBe(false);
    expect(isProductionGateBlocked({ NODE_ENV: 'test' }, baseArgs)).toBe(false);
  });

  it('requires --confirm before any work', async () => {
    await expect(runBenchSeed({ ...baseArgs, confirm: false })).rejects.toThrow(
      /--confirm/,
    );
  });

  it('performs zero writes in dry-run mode', async () => {
    // A dry run returns before any Pool/PrismaClient is constructed, so no
    // database connection or mock is needed for this assertion.
    await expect(
      runBenchSeed({ ...baseArgs, dryRun: true }),
    ).resolves.toBeUndefined();
  });
});
