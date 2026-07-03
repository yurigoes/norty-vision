import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

/**
 * Argon2id com parametros conservadores (OWASP 2024):
 *   memoryCost: 19456 KiB (~19 MB), iterations: 2, parallelism: 1.
 * Hash result e uma string PHC: $argon2id$v=19$m=19456,t=2,p=1$...$...
 */
@Injectable()
export class ArgonService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain, this.options);
  }

  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, this.options);
    } catch {
      return true;
    }
  }
}
