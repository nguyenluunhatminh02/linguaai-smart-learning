import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { requestContextStorage } from '../utils/request-context';

interface AiServiceError {
  response?: {
    status?: number;
    data?: unknown;
  };
}

@Injectable()
export class AiClientService {
  private client: AxiosInstance;
  private readonly logger = new Logger(AiClientService.name);
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 1000;

  constructor(private config: ConfigService) {
    const base = config.get('AI_SERVICE_URL', 'http://localhost:8000');
    // First key from AI_SERVICE_API_KEYS — used for server-to-server auth.
    const keys = (config.get<string>('AI_SERVICE_API_KEYS') || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const apiKey = keys[0];
    this.client = axios.create({
      baseURL: base.endsWith('/v1') ? base : `${base}/v1`,
      timeout: 60_000,
      headers: apiKey ? { 'X-API-Key': apiKey } : {},
    });
  }

  /**
   * Post to the AI service. Every call site triggers paid LLM generation, and
   * the AI service has no idempotency-key handling, so retrying a request that
   * may already have reached it would bill the same completion multiple times.
   * Only retry failures that provably happened before the request reached the
   * service (connection-level errors with no response received).
   */
  async post<T = unknown>(path: string, data: Record<string, unknown>): Promise<T> {
    let lastError: Error | null = null;
    let attemptsUsed = 0;
    const store = requestContextStorage.getStore();
    const requestId = store?.requestId;
    const headers = requestId ? { 'X-Request-ID': requestId } : {};

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        attemptsUsed = attempt;
        const res = await this.client.post(path, data, { headers });
        return res.data as T;
      } catch (error: unknown) {
        lastError = error as Error;
        const axiosError = error as AxiosError<AiServiceError>;
        const status = axiosError.response?.status;

        // Client errors are not transient.
        if (status && status >= 400 && status < 500) {
          const errorData = axiosError.response?.data as Record<string, unknown>;
          const message = errorData?.detail || 'AI service unavailable';
          throw new HttpException(message, status);
        }

        // A response (including 5xx) or a timeout means the service may already
        // have generated content — retrying would duplicate spend. A request
        // setup error cannot safely be retried either. Only connection errors
        // with no response are provably pre-send and safe to retry.
        const isConnectionError =
          !axiosError.response &&
          !axiosError.code?.includes('TIMEOUT') &&
          (axiosError.code === 'ECONNREFUSED' ||
            axiosError.code === 'ENOTFOUND' ||
            axiosError.code === 'EAI_AGAIN' ||
            axiosError.code === 'ECONNRESET' ||
            axiosError.code === 'ERR_NETWORK' ||
            axiosError.code === 'EPIPE');

        if (!isConnectionError) {
          this.logger.error(`AI service call failed without safe retry (attempt ${attempt}/${this.MAX_RETRIES}): ${lastError.message}`);
          break;
        }

        if (attempt < this.MAX_RETRIES) {
          this.logger.warn(`AI service connection failed before send (attempt ${attempt}/${this.MAX_RETRIES}): ${lastError.message}. Retrying...`);
          await this.sleep(this.RETRY_DELAY_MS * attempt);
        }
      }
    }

    // All retries exhausted (or a non-retryable failure occurred)
    this.logger.error(`AI service call failed after ${attemptsUsed} attempt(s): ${lastError?.message}`);
    throw new HttpException('AI service temporarily unavailable', HttpStatus.SERVICE_UNAVAILABLE);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
