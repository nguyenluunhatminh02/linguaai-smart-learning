import { SetMetadata } from '@nestjs/common';

export const PAYLOAD_LIMIT_KEY = 'payload_limit';

export interface PayloadLimitMetadata {
  bytes: number;
}

/** Declare a body-size pre-check limit (bytes) for a route or controller. */
export const PayloadLimit = (bytes: number) =>
  SetMetadata(PAYLOAD_LIMIT_KEY, { bytes } satisfies PayloadLimitMetadata);
