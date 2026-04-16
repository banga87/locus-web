import { createProxyRouteHandler } from '@axiomhq/nextjs';

import { logger } from '@/lib/axiom/server';

export const POST = createProxyRouteHandler(logger);
