// regenerateManifest tests — nested-folder shape.
//
// Asserts that a brain with a two-level folder hierarchy emits a tree
// (folders nested under folders), preserves per-document metadata, and
// excludes documents whose `type` column is non-null (skills,
// agent-scaffolding, etc.).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { regenerateManifest, type Manifest } from '../manifest';
import {
  cleanupSeeds,
  readCurrentManifest,
  seedBrainWithNestedFolders,
} from './manifest.fixtures';

describe('regenerateManifest — nested folders', () => {
  let brainId: string;

  beforeEach(async () => {
    brainId = await seedBrainWithNestedFolders();
  });

  afterAll(async () => {
    await cleanupSeeds();
  });

  it('emits a tree with nested folders', async () => {
    await regenerateManifest(brainId);
    const m: Manifest = await readCurrentManifest(brainId);

    expect(m.folders).toHaveLength(2); // Brand, Product
    const product = m.folders.find((f) => f.slug === 'product-service')!;
    expect(product).toBeDefined();
    expect(product.folders).toHaveLength(1);
    expect(product.folders[0].slug).toBe('terravolt-products');
    expect(product.folders[0].documents).toHaveLength(2);
  });

  it('preserves document metadata (confidence, status, isCore, isPinned)', async () => {
    await regenerateManifest(brainId);
    const m = await readCurrentManifest(brainId);
    const brand = m.folders.find((f) => f.slug === 'brand-identity')!;
    const doc = brand.documents[0];
    expect(doc).toMatchObject({
      confidenceLevel: expect.stringMatching(/high|medium|low/),
      status: expect.stringMatching(/draft|active|archived/),
      isCore: expect.any(Boolean),
      isPinned: expect.any(Boolean),
    });
  });

  it('excludes documents with non-null type (agent-scaffolding, skill)', async () => {
    await regenerateManifest(brainId);
    const m = await readCurrentManifest(brainId);
    const allDocs: { title: string }[] = [];
    const walk = (fs: typeof m.folders): void => {
      for (const f of fs) {
        allDocs.push(...f.documents);
        walk(f.folders);
      }
    };
    walk(m.folders);
    expect(allDocs.find((d) => d.title === 'Skill Doc')).toBeUndefined();
  });

  it('includes documents with type: workflow', async () => {
    // Workflow docs must appear in the manifest so the Platform Agent can
    // reference them by name. This guards against a regression to a
    // blanket `isNull(type)` filter that would silently drop them.
    await regenerateManifest(brainId);
    const m = await readCurrentManifest(brainId);
    const allDocs: { title: string }[] = [];
    const walk = (fs: typeof m.folders): void => {
      for (const f of fs) {
        allDocs.push(...f.documents);
        walk(f.folders);
      }
    };
    walk(m.folders);
    expect(allDocs.find((d) => d.title === 'Weekly Error Report')).toBeDefined();
  });
});
