declare module 'svg-captcha';
declare module 'passport-github2';
declare module 'passport-google-oauth20' {
  export class Strategy {
    constructor(options: any, verify: (...args: any[]) => void);
    name: string;
    authenticate(req: any, options?: any): void;
  }
  export type VerifyCallback = (error: any, user?: any, info?: any) => void;
}
declare module 'qrcode' {
  export function toDataURL(text: string, options?: any): Promise<string>;
  export function toString(text: string, options?: any): Promise<string>;
}
declare module 'nodemailer' {
  export interface Transporter {
    sendMail(options: any): Promise<any>;
    verify(): Promise<boolean>;
  }
  export interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user?: string; pass?: string };
    service?: string;
  }
  export function createTransport(options: TransportOptions | any): Transporter;
  export const createTestAccount: () => Promise<any>;
  export const getTestMessageUrl: (info: any) => string | false;
}
declare module 'pg' {
  export class Pool {
    constructor(options?: {
      connectionString?: string;
      max?: number;
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      database?: string;
      ssl?: any;
    });
    connect(): Promise<any>;
    end(): Promise<void>;
    query(text: string, values?: any[]): Promise<any>;
    on(event: string, listener: (...args: any[]) => void): this;
  }
  export class Client {
    constructor(options?: any);
    connect(): Promise<void>;
    end(): Promise<void>;
    query(text: string, values?: any[]): Promise<any>;
  }
}
declare namespace Express {
  namespace Multer {
    interface File {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      destination: string;
      filename: string;
      path: string;
      buffer: Buffer;
    }
  }
}
