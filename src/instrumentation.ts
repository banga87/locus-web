import { createOnRequestError } from '@axiomhq/nextjs';

import { logger } from '@/lib/axiom/server';

export const onRequestError = createOnRequestError(logger);
