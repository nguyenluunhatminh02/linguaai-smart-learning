import { AsyncLocalStorage } from 'async_hooks';

export interface RequestStore {
  requestId: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestStore>();
